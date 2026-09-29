"""Prüfung von E-Mails (.eml) auf Fälschungs- und Phishing-Hinweise.

Grundlage sind die Header der Mail (Authentifizierung, Zustellweg), die Links,
die Anhänge und typische Phishing-Muster. Ergebnisse sind Indizien, keine Beweise.
"""

from __future__ import annotations

import email
import re
from datetime import datetime, timedelta, timezone
from email import policy
from email.message import EmailMessage
from email.utils import getaddresses, parsedate_to_datetime
from html.parser import HTMLParser

from . import datenbanken
from . import domains as d
from .bericht import Bericht
from .dokument import GEFAEHRLICHE_ENDUNGEN, MAKRO_ENDUNGEN, pruefe_dokument
from .klassifikation import klassifizieren

DRUCK_FORMULIERUNGEN = [
    "dringend", "sofort", "innerhalb von 24 stunden", "innerhalb von 48 stunden",
    "konto wurde gesperrt", "konto gesperrt", "eingeschränkt", "verifizieren sie",
    "bestätigen sie ihre", "ihre daten aktualisieren", "letzte mahnung",
    "ungewöhnliche aktivität", "verdächtige aktivität", "passwort läuft ab",
    "rückerstattung", "gewinn", "sie haben gewonnen", "inkasso", "pfändung",
    "urgent", "immediately", "verify your account", "account suspended",
    "unusual activity", "confirm your identity", "password expires", "final notice",
    "gift card", "geschenkkarte", "bitcoin", "überweisung heute noch",
]


class _LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.formulare: list[str] = []
        self._aktuell: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("href"):
            self._aktuell = attrs["href"]
            self._text = []
        elif tag == "form":
            self.formulare.append(attrs.get("action") or "")

    def handle_data(self, data):
        if self._aktuell is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._aktuell is not None:
            self.links.append((self._aktuell, " ".join("".join(self._text).split())))
            self._aktuell = None


def _adresse(msg: EmailMessage, header: str) -> tuple[str, str]:
    wert = msg.get(header)
    if not wert:
        return "", ""
    paare = getaddresses([str(wert)])
    return paare[0] if paare else ("", "")


def _gleiche_org(a: str, b: str) -> bool:
    return bool(a and b) and d.organisationsdomain(a) == d.organisationsdomain(b)


def pruefe_mail(roh: bytes, name: str = "mail.eml", online: bool = False,
                anhaenge_pruefen: bool = True) -> Bericht:
    bericht = Bericht("E-Mail-Prüfung", name)
    msg: EmailMessage = email.message_from_bytes(roh, policy=policy.default)  # type: ignore[assignment]

    if not msg.keys():
        bericht.add("mittel", "Format", "Keine Header gefunden – ist das wirklich eine .eml-Datei?")
        return bericht

    von_name, von_adr = _adresse(msg, "From")
    von_dom = d.domain_aus_adresse(von_adr)
    antwort_name, antwort_adr = _adresse(msg, "Reply-To")
    _, return_path = _adresse(msg, "Return-Path")
    rp_dom = d.domain_aus_adresse(return_path)
    msg_id = str(msg.get("Message-ID", ""))
    msgid_dom = msg_id.rsplit("@", 1)[1].strip(" >").lower() if "@" in msg_id else ""

    bericht.details["Betreff"] = str(msg.get("Subject", ""))
    bericht.details["Absender (From)"] = f"{von_name} <{von_adr}>" if von_name else von_adr
    bericht.details["Antwort an (Reply-To)"] = antwort_adr
    bericht.details["Return-Path"] = return_path
    bericht.details["Datum"] = str(msg.get("Date", ""))
    bericht.details["Message-ID"] = msg_id

    _pruefe_absender(bericht, msg, von_name, von_adr, von_dom, antwort_adr, rp_dom, msgid_dom)
    _pruefe_authentifizierung(bericht, msg, von_dom, rp_dom)
    _pruefe_zustellweg(bericht, msg)
    if online:
        _pruefe_online(bericht, roh, von_dom)
    gesamt_text, urls = _pruefe_inhalt(bericht, msg)
    if online:
        datenbanken.urls_in_bericht(bericht, urls)
    _pruefe_anhaenge(bericht, msg, anhaenge_pruefen, online)
    klassifizieren(bericht, gesamt_text, bool(urls))
    return bericht


# --------------------------------------------------------------------------- #

def _pruefe_absender(bericht, msg, von_name, von_adr, von_dom, antwort_adr, rp_dom, msgid_dom):
    if not von_adr or "@" not in von_adr:
        bericht.add("mittel", "Absender", "Keine gültige Absenderadresse (From) vorhanden.")
        return
    if len(msg.get_all("From", [])) > 1:
        bericht.add("hoch", "Absender", "Mehrere From-Header – typischer Trick, um Prüfungen zu umgehen.")

    for stufe, text in d.lookalike_pruefung(von_dom):
        bericht.add(stufe, "Absender", text)

    # Anzeigename enthält eine andere Mailadresse
    im_namen = re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", von_name or "")
    for adr in im_namen:
        if adr.lower() != von_adr.lower():
            bericht.add(
                "hoch", "Absender",
                f"Anzeigename zeigt die Adresse '{adr}', tatsächlich gesendet von '{von_adr}'.",
            )
    # Anzeigename nennt eine Marke, die Domain gehört nicht dazu
    name_klein = re.sub(r"[^a-z0-9äöü-]", " ", (von_name or "").lower())
    for marke in d.MARKEN:
        if len(marke) >= 4 and re.search(rf"\b{re.escape(marke)}\b", name_klein) \
                and marke.replace("-", "") not in von_dom.replace("-", ""):
            bericht.add(
                "mittel", "Absender",
                f"Anzeigename nennt '{marke}', die Absenderdomain '{von_dom}' passt aber nicht dazu.",
            )
            break

    if antwort_adr:
        antwort_dom = d.domain_aus_adresse(antwort_adr)
        if antwort_dom and not _gleiche_org(antwort_dom, von_dom):
            bericht.add(
                "mittel", "Absender",
                f"Antworten gehen an eine andere Domain ({antwort_dom}) als der Absender "
                f"({von_dom}) – häufig bei Betrugsmails (bei Newslettern teils normal).",
            )
            for stufe, text in d.lookalike_pruefung(antwort_dom):
                bericht.add(stufe, "Absender", text)
    if rp_dom and not _gleiche_org(rp_dom, von_dom):
        bericht.add(
            "info", "Absender",
            f"Return-Path-Domain ({rp_dom}) weicht vom Absender ab – bei Versanddienstleistern "
            "normal, entscheidend ist das DMARC-Ergebnis.",
        )
    if msgid_dom and not _gleiche_org(msgid_dom, von_dom) and not _gleiche_org(msgid_dom, rp_dom):
        bericht.add("info", "Absender", f"Message-ID stammt von einer anderen Domain ({msgid_dom}).")


# --------------------------------------------------------------------------- #

def _pruefe_authentifizierung(bericht: Bericht, msg: EmailMessage, von_dom: str, rp_dom: str) -> None:
    ar_header = msg.get_all("Authentication-Results") or []
    if not ar_header:
        bericht.add(
            "mittel", "Authentifizierung",
            "Kein 'Authentication-Results'-Header gefunden. SPF/DKIM/DMARC-Ergebnisse "
            "fehlen – bitte die Mail als Original (.eml) aus dem Postfach exportieren.",
        )
        _pruefe_dkim_signaturen(bericht, msg, von_dom)
        return

    # Nur der oberste Header stammt sicher vom eigenen Mailanbieter; tiefere
    # Header könnten vom Absender gefälscht worden sein.
    ar = " ".join(str(ar_header[0]).split())
    bericht.details["Authentication-Results (oberster)"] = ar[:300] + ("…" if len(ar) > 300 else "")
    ergebnisse: dict[str, str] = {}
    for mech, res in re.findall(r"\b(spf|dkim|dmarc|arc)\s*=\s*([a-zA-Z]+)", ar, re.I):
        mech = mech.lower()
        # bei mehreren DKIM-Signaturen zählt ein "pass"
        if mech not in ergebnisse or res.lower() == "pass":
            ergebnisse[mech] = res.lower()
    bericht.details["SPF"] = ergebnisse.get("spf", "–")
    bericht.details["DKIM"] = ergebnisse.get("dkim", "–")
    bericht.details["DMARC"] = ergebnisse.get("dmarc", "–")

    dmarc = ergebnisse.get("dmarc")
    if dmarc == "pass":
        bericht.add(
            "ok", "Authentifizierung",
            f"DMARC bestanden: Die Mail wurde nachweislich über Server versendet, die "
            f"'{von_dom}' autorisiert hat (schützt nicht vor gehackten Konten oder "
            "ähnlich aussehenden Domains).",
        )
    elif dmarc in ("fail", "permerror"):
        bericht.add(
            "hoch", "Authentifizierung",
            f"DMARC FEHLGESCHLAGEN – die Absenderadresse '{von_dom}' ist sehr wahrscheinlich gefälscht.",
        )
    elif dmarc in ("none", "temperror", None):
        bericht.add(
            "niedrig", "Authentifizierung",
            "Kein aussagekräftiges DMARC-Ergebnis (Domain hat evtl. keine DMARC-Richtlinie).",
        )

    spf = ergebnisse.get("spf")
    if spf in ("fail", "softfail", "permerror"):
        stufe = "mittel" if spf != "fail" else "hoch"
        if dmarc == "pass":
            stufe = "info"  # z. B. Weiterleitung – DKIM rettet DMARC
        bericht.add(stufe, "Authentifizierung", f"SPF-Ergebnis: {spf} – sendender Server nicht autorisiert.")
    elif spf == "pass":
        bericht.add("ok", "Authentifizierung", "SPF bestanden.")

    dkim = ergebnisse.get("dkim")
    if dkim == "fail":
        bericht.add(
            "info" if dmarc == "pass" else "mittel", "Authentifizierung",
            "DKIM-Signatur ungültig – Mail wurde evtl. unterwegs verändert.",
        )
    elif dkim == "pass":
        bericht.add("ok", "Authentifizierung", "DKIM-Signatur gültig.")
    elif dkim in (None, "none"):
        bericht.add("niedrig", "Authentifizierung", "Keine DKIM-Signatur geprüft/vorhanden.")

    _pruefe_dkim_signaturen(bericht, msg, von_dom)


def _pruefe_dkim_signaturen(bericht: Bericht, msg: EmailMessage, von_dom: str) -> None:
    domains = []
    for sig in msg.get_all("DKIM-Signature") or []:
        m = re.search(r"\bd\s*=\s*([^;\s]+)", str(sig))
        if m:
            domains.append(m.group(1).lower())
    bericht.details["DKIM-signierende Domains"] = domains
    if domains and von_dom and not any(_gleiche_org(x, von_dom) for x in domains):
        bericht.add(
            "info", "Authentifizierung",
            f"DKIM-Signatur stammt nicht von der Absenderdomain ({', '.join(domains)}) "
            "– bei Versanddienstleistern möglich.",
        )


# --------------------------------------------------------------------------- #

def _pruefe_zustellweg(bericht: Bericht, msg: EmailMessage) -> None:
    received = [" ".join(str(r).split()) for r in (msg.get_all("Received") or [])]
    bericht.details["Anzahl Zustell-Stationen (Received)"] = len(received)
    if not received:
        bericht.add("mittel", "Zustellweg", "Keine Received-Header – Zustellweg nicht nachvollziehbar.")
        return

    zeiten: list[datetime | None] = []
    for r in received:
        try:
            zeiten.append(parsedate_to_datetime(r.rsplit(";", 1)[1].strip()))
        except (IndexError, TypeError, ValueError):
            zeiten.append(None)

    # Oben = letzte Station, unten = erste Station. Zeiten sollten nach oben hin steigen.
    for i in range(len(zeiten) - 1):
        neuer, aelter = zeiten[i], zeiten[i + 1]
        if neuer and aelter and neuer.tzinfo and aelter.tzinfo and aelter - neuer > timedelta(minutes=10):
            bericht.add(
                "niedrig", "Zustellweg",
                "Zeitstempel im Zustellweg sind nicht chronologisch – Hinweis auf "
                "gefälschte Received-Header oder falsch gehende Server-Uhren.",
            )
            break

    erste = next((z for z in reversed(zeiten) if z and z.tzinfo), None)
    letzte = next((z for z in zeiten if z and z.tzinfo), None)
    if erste and letzte and letzte - erste > timedelta(hours=12):
        bericht.add("info", "Zustellweg", f"Zustellung dauerte ungewöhnlich lange ({letzte - erste}).")

    ursprung = received[-1]
    bericht.details["Erste Station (Ursprung)"] = ursprung[:200]
    ips = re.findall(r"\[(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+:[0-9a-fA-F:]+)\]", ursprung)
    if ips:
        bericht.details["Ursprungs-IP (laut Header)"] = ips[0]

    try:
        datum = parsedate_to_datetime(str(msg.get("Date", "")))
    except (TypeError, ValueError):
        datum = None
    if datum is None:
        bericht.add("niedrig", "Zustellweg", "Date-Header fehlt oder ist ungültig.")
    elif datum.tzinfo and letzte:
        if datum - letzte > timedelta(hours=1):
            bericht.add("mittel", "Zustellweg", "Das Sendedatum liegt NACH dem Empfang – manipuliert?")
        elif letzte - datum > timedelta(days=2):
            bericht.add("niedrig", "Zustellweg", "Sendedatum liegt mehr als 2 Tage vor dem Empfang.")


# --------------------------------------------------------------------------- #

def _pruefe_online(bericht: Bericht, roh: bytes, von_dom: str) -> None:
    try:
        import dns.resolver  # type: ignore
    except ImportError:
        bericht.add("info", "Online", "dnspython ist nicht installiert – DNS-Prüfungen übersprungen "
                                      "(pip install dnspython).")
        return

    def txt(name: str) -> list[str]:
        try:
            return [b"".join(r.strings).decode("utf-8", "replace")
                    for r in dns.resolver.resolve(name, "TXT", lifetime=5)]
        except Exception:
            return []

    if von_dom:
        org = d.organisationsdomain(von_dom)
        spf = [t for t in txt(von_dom) if t.lower().startswith("v=spf1")]
        dmarc = [t for t in txt(f"_dmarc.{von_dom}") or txt(f"_dmarc.{org}")
                 if t.lower().startswith("v=dmarc1")]
        bericht.details["SPF-Eintrag (DNS)"] = spf[0] if spf else "keiner"
        bericht.details["DMARC-Eintrag (DNS)"] = dmarc[0] if dmarc else "keiner"
        try:
            dns.resolver.resolve(von_dom, "MX", lifetime=5)
        except Exception:
            try:
                dns.resolver.resolve(von_dom, "A", lifetime=5)
            except Exception:
                bericht.add("hoch", "Online", f"Absenderdomain '{von_dom}' existiert im DNS nicht.")
        if not dmarc:
            bericht.add("niedrig", "Online", f"'{von_dom}' hat keine DMARC-Richtlinie – leichter fälschbar.")
        elif re.search(r"\bp\s*=\s*none", dmarc[0], re.I):
            bericht.add("info", "Online", f"DMARC-Richtlinie von '{von_dom}' ist 'none' (nur Beobachtung).")

    try:
        import dkim  # type: ignore
    except ImportError:
        bericht.add("info", "Online", "dkimpy nicht installiert – eigene DKIM-Prüfung übersprungen.")
        return
    try:
        gueltig = dkim.verify(roh)
    except Exception as exc:  # noqa: BLE001
        bericht.add("info", "Online", f"DKIM-Prüfung nicht möglich: {exc}")
        return
    if gueltig:
        bericht.add("ok", "Online", "Eigene DKIM-Prüfung: Signatur gültig – Inhalt unverändert.")
    else:
        bericht.add("mittel", "Online", "Eigene DKIM-Prüfung: Signatur ungültig oder fehlt.")


# --------------------------------------------------------------------------- #

def _text_teile(msg: EmailMessage) -> tuple[str, str]:
    html, text = [], []
    for teil in msg.walk():
        if teil.is_multipart() or teil.get_content_disposition() == "attachment":
            continue
        typ = teil.get_content_type()
        if typ not in ("text/html", "text/plain"):
            continue
        try:
            inhalt = teil.get_content()
        except (LookupError, UnicodeDecodeError, AssertionError):
            inhalt = (teil.get_payload(decode=True) or b"").decode("latin-1", "replace")
        (html if typ == "text/html" else text).append(inhalt)
    return "\n".join(html), "\n".join(text)


_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
_DOMAIN_IM_TEXT = re.compile(r"^(?:https?://)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#]|$)", re.I)


def _pruefe_inhalt(bericht: Bericht, msg: EmailMessage) -> tuple[str, list[str]]:
    html, text = _text_teile(msg)
    parser = _LinkParser()
    if html:
        try:
            parser.feed(html)
        except Exception:  # noqa: BLE001 – kaputtes HTML soll die Prüfung nicht abbrechen
            pass
    links = list(parser.links)
    for url in _URL_RE.findall(text):
        links.append((url, ""))

    hosts: set[str] = set()
    urls: list[str] = []
    gemeldet: set[tuple[str, str]] = set()

    def melde(stufe: str, txt: str) -> None:
        if (stufe, txt) not in gemeldet:
            gemeldet.add((stufe, txt))
            bericht.add(stufe, "Links", txt)

    for href, anzeige in links:
        href = href.strip()
        klein = href.lower()
        if klein.startswith(("mailto:", "tel:", "#", "cid:")):
            continue
        if klein.startswith(("javascript:", "data:", "vbscript:")):
            melde("hoch", f"Link mit ausführbarem Inhalt: {href[:80]}")
            continue
        host = d.host_aus_url(href)
        if not host:
            continue
        hosts.add(host)
        urls.append(href)
        try:
            netloc = href.split("//", 1)[1].split("/", 1)[0]
        except IndexError:
            netloc = ""
        if "@" in netloc:
            melde("hoch", f"Link-Trick mit '@' in der Adresse: {href[:100]} (Ziel ist in Wahrheit '{host}').")
        if d.ist_ip(host):
            melde("mittel", f"Link führt direkt zu einer IP-Adresse: {href[:100]}")
        if host in d.KURZLINK_DIENSTE:
            melde("niedrig", f"Kurzlink verschleiert das Ziel: {href[:100]}")
        for stufe, txt in d.lookalike_pruefung(host):
            melde(stufe, txt)
        m = _DOMAIN_IM_TEXT.match(anzeige or "")
        if m and "." in m.group(1) and not re.fullmatch(r"[\d.]+", m.group(1)):
            angezeigt = m.group(1).lower()
            if not _gleiche_org(angezeigt, host):
                melde(
                    "hoch",
                    f"Angezeigter Link '{anzeige[:60]}' führt in Wahrheit zu '{host}'.",
                )
    bericht.details["Link-Ziele (Domains)"] = sorted(hosts)

    for aktion in parser.formulare:
        melde("hoch", f"Mail enthält ein Formular (Ziel: {aktion or 'unbekannt'}) – echte Firmen "
                      "fragen keine Daten per Formular in der Mail ab.")

    gesamt = (str(msg.get("Subject", "")) + " " + text + " " + re.sub(r"<[^>]+>", " ", html)).lower()
    treffer = sorted({f for f in DRUCK_FORMULIERUNGEN if f in gesamt})
    if treffer:
        bericht.add(
            "niedrig" if len(treffer) < 3 else "mittel", "Inhalt",
            f"Typische Druck-/Lockformulierungen gefunden: {', '.join(treffer[:8])}.",
        )
    if re.search(r"(passwort|password|pin|tan\b|kreditkarte|iban|credit card)", gesamt) and links:
        bericht.add("niedrig", "Inhalt", "Mail spricht Zugangs- oder Zahlungsdaten an und enthält Links.")
    return gesamt, urls


# --------------------------------------------------------------------------- #

def _pruefe_anhaenge(bericht: Bericht, msg: EmailMessage, tief: bool, online: bool = False) -> None:
    namen = []
    for teil in msg.walk():
        if teil.is_multipart():
            continue
        dateiname = teil.get_filename()
        if not dateiname and teil.get_content_disposition() != "attachment":
            continue
        dateiname = dateiname or "unbenannter_anhang"
        namen.append(f"{dateiname} ({teil.get_content_type()})")
        endung = "." + dateiname.rsplit(".", 1)[-1].lower() if "." in dateiname else ""
        if endung in GEFAEHRLICHE_ENDUNGEN or endung in MAKRO_ENDUNGEN:
            bericht.add("hoch", "Anhang", f"Gefährlicher Anhang: {dateiname}")
        if "‮" in dateiname:
            bericht.add("hoch", "Anhang", f"Dateiname enthält Richtungs-Umkehrzeichen (Tarnung): {dateiname!r}")
        if tief:
            daten = teil.get_payload(decode=True) or b""
            if teil.get_content_type() == "message/rfc822" or dateiname.lower().endswith(".eml"):
                unter = pruefe_mail(daten, dateiname, online=online, anhaenge_pruefen=True)
            else:
                unter = pruefe_dokument(daten, dateiname, online=online)
            bericht.unterberichte.append(unter)
    bericht.details["Anhänge"] = namen


# --------------------------------------------------------------------------- #
# Eingefügter Text (z. B. aus dem Mailprogramm kopiert)
# --------------------------------------------------------------------------- #

_VON_ZEILE = re.compile(r"^\s*(?:von|from|absender)\s*:\s*(.+)$", re.I | re.M)


def ist_vollstaendige_mail(text: str) -> bool:
    kopf = text.lstrip()[:20000].split("\n\n", 1)[0]
    return bool(re.search(r"^From:", kopf, re.M)) and bool(
        re.search(r"^(Received|Message-ID|Authentication-Results|Return-Path):", kopf, re.M | re.I))


def pruefe_text(text: str, name: str = "eingefügter Text", online: bool = False) -> Bericht:
    """Prüft eine eingefügte Mail. Mit vollständigen Headern -> volle Mailprüfung,
    sonst eingeschränkte Prüfung von Absenderzeile, Links und Inhalt."""
    if ist_vollstaendige_mail(text):
        return pruefe_mail(text.lstrip().encode("utf-8"), name, online=online)

    bericht = Bericht("Text-Prüfung (ohne Mail-Header)", name)
    bericht.add(
        "info", "Eingeschränkt",
        "Nur Text ohne technische Kopfzeilen: Ob der Absender echt ist (SPF/DKIM/DMARC), "
        "kann so NICHT geprüft werden. Außerdem gehen beim Kopieren die echten Ziele von "
        "Buttons/Links oft verloren. Für eine vollständige Prüfung die Mail im Original "
        "einfügen (Gmail: ⋮ → 'Original anzeigen').",
    )
    m = _VON_ZEILE.search(text)
    if m:
        name_teil, adresse = getaddresses([m.group(1)])[0]
        if "@" in adresse:
            bericht.details["Absender (laut Text)"] = m.group(1).strip()
            dom = d.domain_aus_adresse(adresse)
            for stufe, txt in d.lookalike_pruefung(dom):
                bericht.add(stufe, "Absender", txt)
            name_klein = (name_teil or "").lower()
            for marke in d.MARKEN:
                if len(marke) >= 4 and re.search(rf"\b{re.escape(marke)}\b", name_klein) \
                        and marke.replace("-", "") not in dom.replace("-", ""):
                    bericht.add("mittel", "Absender",
                                f"Anzeigename nennt '{marke}', die Adresse '{adresse}' passt nicht dazu.")
                    break
            if dom in ("gmail.com", "googlemail.com", "gmx.de", "gmx.net", "web.de", "outlook.com",
                       "hotmail.com", "yahoo.com", "yahoo.de", "t-online.de", "icloud.com", "aol.com"):
                bericht.add("niedrig", "Absender",
                            f"Absender nutzt einen Freemail-Dienst ({dom}) – Firmen und Behörden tun das normalerweise nicht.")

    nachricht = EmailMessage()
    if re.search(r"<(a|p|div|html|table)\b", text, re.I):
        nachricht.set_content(text, subtype="html")
    else:
        nachricht.set_content(text)
    gesamt_text, urls = _pruefe_inhalt(bericht, nachricht)
    if online:
        datenbanken.urls_in_bericht(bericht, urls)
    klassifizieren(bericht, gesamt_text, bool(urls))
    return bericht

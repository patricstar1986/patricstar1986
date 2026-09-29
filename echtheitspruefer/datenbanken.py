"""Abgleich mit aktuellen Bedrohungs-Datenbanken (Phishing-Listen, Malware-Hashes).

Quellen ohne Schlüssel:
  * Phishing.Database (GitHub, community-gepflegt) – aktive Phishing-Domains
  * URLhaus (abuse.ch) – aktive Malware-Verteil-URLs (Text-Feed)

Quellen mit (kostenlosem) API-Schlüssel, per Umgebungsvariable:
  * VIRUSTOTAL_API_KEY       – Datei-Hashes und URLs (virustotal.com)
  * GOOGLE_SAFEBROWSING_KEY  – URLs (Google Safe Browsing v4)
  * ABUSECH_AUTH_KEY         – MalwareBazaar-Hashabfrage (abuse.ch)

Listen werden im Cache (~/.cache/echtheitspruefer) gespeichert und alle 6 Stunden
erneuert. Ein Treffer ist ein starkes Warnzeichen; KEIN Treffer bedeutet nur, dass
die Adresse bzw. Datei dort (noch) nicht gemeldet ist.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from . import domains as d

CACHE = Path(os.environ.get("ECHTHEITSPRUEFER_CACHE", Path.home() / ".cache" / "echtheitspruefer"))
MAX_ALTER = 6 * 3600
TIMEOUT = 20
USER_AGENT = "echtheitspruefer/0.2"

LISTEN = {
    "Phishing.Database": (
        "phishing_domains.txt",
        "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/"
        "master/phishing-domains-ACTIVE.txt",
    ),
    "URLhaus": ("urlhaus_online.txt", "https://urlhaus.abuse.ch/downloads/text_online/"),
}


# Große Plattformen mit Nutzerinhalten: Ein Listeneintrag betrifft meist nur einzelne
# Seiten darauf, nicht die Plattform selbst.
PLATTFORMEN = {
    "google.com", "googleusercontent.com", "microsoft.com", "live.com", "office.com",
    "sharepoint.com", "onedrive.com", "1drv.ms", "dropbox.com", "box.com", "github.io",
    "github.com", "wixsite.com", "weebly.com", "blogspot.com", "square.site",
    "firebaseapp.com", "web.app", "pages.dev", "vercel.app", "netlify.app",
    "notion.site", "canva.com", "jotform.com", "typeform.com", "forms.office.com",
    "amazonaws.com", "cloudfront.net", "wordpress.com", "webflow.io", "glitch.me",
    "ipfs.io", "linktr.ee", "adobe.com", "wetransfer.com", "docusign.net",
}


# Hosts, unter denen viele Nutzer Inhalte veröffentlichen (ohne eigene Subdomain).
GETEILTE_HOSTS = {
    "sites.google.com", "docs.google.com", "drive.google.com", "forms.gle",
    "storage.googleapis.com", "onedrive.live.com", "1drv.ms", "dropbox.com",
    "github.com", "forms.office.com", "forms.microsoft.com", "notion.so",
}


@dataclass
class Treffer:
    quelle: str
    objekt: str
    text: str
    stufe: str = "hoch"


@dataclass
class Ergebnis:
    treffer: list[Treffer] = field(default_factory=list)
    geprueft: list[str] = field(default_factory=list)   # erfolgreich befragte Quellen
    fehler: list[str] = field(default_factory=list)     # nicht erreichbare Quellen


def _anfrage(url: str, daten: bytes | None = None, header: dict | None = None) -> bytes:
    req = urllib.request.Request(url, data=daten, headers={"User-Agent": USER_AGENT, **(header or {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as antwort:
        return antwort.read()


def _liste(name: str, ergebnis: Ergebnis) -> set[str] | None:
    datei, url = LISTEN[name]
    pfad = CACHE / datei
    frisch = pfad.exists() and time.time() - pfad.stat().st_mtime < MAX_ALTER
    if not frisch:
        try:
            inhalt = _anfrage(url)
            CACHE.mkdir(parents=True, exist_ok=True)
            pfad.write_bytes(inhalt)
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            if not pfad.exists():
                ergebnis.fehler.append(f"{name}: nicht erreichbar ({exc})")
                return None
            ergebnis.fehler.append(f"{name}: Aktualisierung fehlgeschlagen, nutze Cache")
    zeilen = pfad.read_text("utf-8", "ignore").splitlines()
    ergebnis.geprueft.append(name)
    return {z.strip().lower() for z in zeilen if z.strip() and not z.startswith("#")}


def pruefe_urls(urls: list[str], ergebnis: Ergebnis | None = None) -> Ergebnis:
    ergebnis = ergebnis or Ergebnis()
    urls = list(dict.fromkeys(u.strip() for u in urls if u.strip()))
    if not urls:
        return ergebnis
    hosts = {d.host_aus_url(u) for u in urls} - {""}

    phishing = _liste("Phishing.Database", ergebnis)
    if phishing is not None:
        for h in sorted(hosts):
            org = d.organisationsdomain(h)
            exakt = {h, h.removeprefix("www.")} & phishing
            if not exakt and (org in PLATTFORMEN or org not in phishing):
                continue
            if h.removeprefix("www.") in GETEILTE_HOSTS:
                ergebnis.treffer.append(Treffer(
                    "Phishing.Database", h,
                    f"'{h}' ist ein gemeinsam genutzter Dienst, über den auch Phishing-Seiten "
                    "verbreitet werden (daher gelistet). Der konkrete Link kann echt oder "
                    "betrügerisch sein – dort keine Zugangsdaten eingeben.", "mittel"))
            else:
                ergebnis.treffer.append(Treffer(
                    "Phishing.Database", h, f"Domain '{h}' ist als aktive PHISHING-Seite gelistet."))

    urlhaus = _liste("URLhaus", ergebnis)
    if urlhaus is not None:
        for u in urls:
            if u.lower() in urlhaus or u.lower().rstrip("/") in urlhaus:
                ergebnis.treffer.append(Treffer(
                    "URLhaus", u, f"URL verteilt laut URLhaus aktiv SCHADSOFTWARE: {u[:100]}"))

    _google_safebrowsing(urls, ergebnis)
    _virustotal_urls(urls, ergebnis)
    return ergebnis


def _google_safebrowsing(urls: list[str], ergebnis: Ergebnis) -> None:
    schluessel = os.environ.get("GOOGLE_SAFEBROWSING_KEY")
    if not schluessel:
        return
    koerper = {
        "client": {"clientId": "echtheitspruefer", "clientVersion": "0.2"},
        "threatInfo": {
            "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE",
                            "POTENTIALLY_HARMFUL_APPLICATION"],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": u} for u in urls[:500]],
        },
    }
    try:
        antwort = json.loads(_anfrage(
            f"https://safebrowsing.googleapis.com/v4/threatMatches:find?key={schluessel}",
            json.dumps(koerper).encode(), {"Content-Type": "application/json"},
        ) or b"{}")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        ergebnis.fehler.append(f"Google Safe Browsing: {exc}")
        return
    ergebnis.geprueft.append("Google Safe Browsing")
    for m in antwort.get("matches", []):
        url = m.get("threat", {}).get("url", "")
        art = {"SOCIAL_ENGINEERING": "PHISHING/Betrug", "MALWARE": "SCHADSOFTWARE"}.get(
            m.get("threatType"), m.get("threatType"))
        ergebnis.treffer.append(Treffer("Google Safe Browsing", url, f"Google stuft {url[:80]} als {art} ein."))


def _vt_get(pfad: str) -> dict | None:
    schluessel = os.environ.get("VIRUSTOTAL_API_KEY")
    try:
        return json.loads(_anfrage(f"https://www.virustotal.com/api/v3/{pfad}", header={"x-apikey": schluessel}))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {}
        raise


def _vt_bewerten(objekt: str, daten: dict, ergebnis: Ergebnis, art: str) -> None:
    stats = daten.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
    boese, verdacht = stats.get("malicious", 0), stats.get("suspicious", 0)
    gesamt = sum(stats.values()) if stats else 0
    if boese >= 3:
        ergebnis.treffer.append(Treffer(
            "VirusTotal", objekt, f"{art} von {boese}/{gesamt} Virenscannern als SCHÄDLICH erkannt."))
    elif boese or verdacht:
        ergebnis.treffer.append(Treffer(
            "VirusTotal", objekt,
            f"{art}: {boese} Scanner melden schädlich, {verdacht} verdächtig (von {gesamt}).", "mittel"))


def _virustotal_urls(urls: list[str], ergebnis: Ergebnis) -> None:
    if not os.environ.get("VIRUSTOTAL_API_KEY"):
        return
    try:
        for u in urls[:4]:  # kostenloses Kontingent: 4 Anfragen/Minute
            uid = base64.urlsafe_b64encode(u.encode()).decode().strip("=")
            daten = _vt_get(f"urls/{uid}")
            if daten:
                _vt_bewerten(u[:80], daten, ergebnis, "Link")
        ergebnis.geprueft.append("VirusTotal (URLs)")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        ergebnis.fehler.append(f"VirusTotal: {exc}")


def pruefe_hash(sha256: str, ergebnis: Ergebnis | None = None) -> Ergebnis:
    ergebnis = ergebnis or Ergebnis()
    if os.environ.get("VIRUSTOTAL_API_KEY"):
        try:
            daten = _vt_get(f"files/{sha256}")
            ergebnis.geprueft.append("VirusTotal (Datei)")
            if daten:
                _vt_bewerten(sha256[:16] + "…", daten, ergebnis, "Datei")
            else:
                ergebnis.fehler.append("VirusTotal: Datei dort unbekannt (weder gut noch böse bewertet)")
        except (urllib.error.URLError, OSError, ValueError) as exc:
            ergebnis.fehler.append(f"VirusTotal: {exc}")
    schluessel = os.environ.get("ABUSECH_AUTH_KEY")
    if schluessel:
        try:
            antwort = json.loads(_anfrage(
                "https://mb-api.abuse.ch/api/v1/",
                f"query=get_info&hash={sha256}".encode(),
                {"Auth-Key": schluessel, "Content-Type": "application/x-www-form-urlencoded"},
            ))
            ergebnis.geprueft.append("MalwareBazaar")
            if antwort.get("query_status") == "ok":
                info = (antwort.get("data") or [{}])[0]
                familie = info.get("signature") or "unbekannte Familie"
                ergebnis.treffer.append(Treffer(
                    "MalwareBazaar", sha256[:16] + "…", f"Datei ist bekannte SCHADSOFTWARE ({familie})."))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            ergebnis.fehler.append(f"MalwareBazaar: {exc}")
    return ergebnis


def urls_in_bericht(bericht, urls: list[str]) -> None:
    """Gleicht URLs ab und trägt das Ergebnis in einen Bericht ein."""
    if not urls:
        return
    ergebnis = pruefe_urls(urls)
    for t in ergebnis.treffer:
        bericht.add(t.stufe, "Datenbank", f"[{t.quelle}] {t.text}")
    if ergebnis.geprueft and not ergebnis.treffer:
        bericht.add("ok", "Datenbank",
                    f"Kein Link ist in diesen Datenbanken gemeldet: {', '.join(ergebnis.geprueft)} "
                    "(neue Betrugsseiten sind oft noch nicht erfasst).")
    for f in ergebnis.fehler:
        bericht.add("info", "Datenbank", f)

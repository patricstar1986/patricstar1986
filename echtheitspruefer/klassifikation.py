"""Einstufung einer Nachricht: Phishing, Betrugsmasche, Schadsoftware, Spam …

Regelbasiert (Schlüsselwörter + technische Befunde). Das ist eine Heuristik:
Sie erklärt, WARUM eine Einstufung vorgeschlagen wird, kann aber irren.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .bericht import Bericht


@dataclass(frozen=True)
class Kategorie:
    name: str
    beschreibung: str
    muster: tuple[str, ...]
    rat: str


KATEGORIEN = (
    Kategorie(
        "Phishing (Datendiebstahl)",
        "Versucht, Zugangsdaten, TAN oder Kartendaten über eine gefälschte Seite abzugreifen.",
        (r"konto (wurde |ist )?(gesperrt|eingeschränkt|deaktiviert)", r"verifizier", r"bestätigen sie ihr",
         r"daten (aktualisieren|abgleichen|bestätigen)", r"anmelde|einloggen|login", r"passwort|kennwort",
         r"sicherheits(überprüfung|update|hinweis)", r"ungewöhnliche aktivität|verdächtige aktivität",
         r"pushtan|photo ?tan|\btan\b", r"kreditkarte|kartendaten", r"verify your|account (suspended|locked)",
         r"sign in|confirm your"),
        "Nicht auf Links klicken und nichts eingeben. Direkt über die offizielle App/Website "
        "anmelden. Falls schon Daten eingegeben: sofort Passwort ändern bzw. Bank anrufen (Sperr-Notruf 116 116).",
    ),
    Kategorie(
        "Betrug: Paket-/Zustellmasche",
        "Angebliche Paketzustellung mit kleiner Gebühr oder Link zur 'Neuzustellung'.",
        (r"paket|sendung|zustellung", r"zollgebühr|zollgebuehr|versandgebühr|nachgebühr",
         r"konnte nicht zugestellt", r"neue zustellung|zustellversuch", r"lieferadresse"),
        "Sendungsstatus nur in der offiziellen App oder auf der offiziellen Website des Paketdienstes prüfen.",
    ),
    Kategorie(
        "Betrug: Chef-/CEO-Masche",
        "Angeblicher Vorgesetzter verlangt dringend und vertraulich eine Überweisung oder Gutscheine.",
        (r"vertraulich|diskret", r"(bin|sitze) (gerade )?(in einem|im) meeting|nicht erreichbar",
         r"überweisung|ueberweisung|zahlung ausführen", r"gutschein|geschenkkarte|gift card|itunes|google play",
         r"sind sie (am platz|verfügbar)|kurze frage", r"chef|geschäftsführ|ceo"),
        "Immer über eine bekannte Telefonnummer beim angeblichen Absender rückfragen. Keine Zahlung auf Mail-Anweisung.",
    ),
    Kategorie(
        "Betrug: geänderte Bankverbindung",
        "Rechnung oder Mitteilung mit angeblich neuer IBAN (Rechnungsbetrug).",
        (r"neue(n)? (bankverbindung|iban|kontoverbindung)", r"(bankverbindung|iban|konto) (hat sich )?geändert",
         r"bitte nur noch auf", r"alte(s)? konto (ist )?(nicht mehr|gesperrt)", r"\biban\b"),
        "Neue Bankverbindung NIE per Mail übernehmen – telefonisch unter bekannter Nummer bestätigen lassen.",
    ),
    Kategorie(
        "Betrug: Vorschuss/Erbschaft/Gewinn",
        "Versprochenes Geld (Erbe, Lotteriegewinn, Geschäft) gegen Vorabgebühr oder persönliche Daten.",
        (r"erbschaft|nachlass|verstorben", r"gewinner|gewonnen|lotterie|gewinnspiel", r"millionen|million",
         r"bearbeitungsgebühr|vorab ?gebühr|gebühr (von|in höhe)", r"inheritance|beneficiary|lottery",
         r"treuhänder|anwalt des verstorbenen", r"spende|stiftung"),
        "Nicht antworten, nichts zahlen, keine Ausweiskopien senden.",
    ),
    Kategorie(
        "Erpressung (Sextortion)",
        "Behauptet, Gerät gehackt oder peinliche Videos zu haben, fordert Kryptowährung.",
        (r"webcam|kamera", r"video|aufnahme", r"bitcoin|btc|krypto|wallet", r"(gerät|geraet|computer|konto) gehackt|hacked",
         r"porn|erwachsenen|intime", r"48 stunden|24 stunden", r"kontakte (schicken|senden)|an (alle )?ihre kontakte"),
        "Nicht zahlen, nicht antworten – solche Mails sind fast immer Massenbluff. "
        "Wird ein altes Passwort genannt: dieses überall ändern.",
    ),
    Kategorie(
        "Betrug: Fake-Inkasso/Mahnung",
        "Erfundene Forderung mit Drohung (Inkasso, Pfändung, Anwalt).",
        (r"inkasso", r"mahnung|letzte zahlungsaufforderung", r"pfändung|gerichtsvollzieher|zwangsvollstreckung",
         r"offene(n)? forderung", r"schufa", r"anwalt|rechtsanwalt|kanzlei", r"mahnbescheid"),
        "Prüfen, ob die Forderung überhaupt existiert (Vertrag, Rechnung?). Echte gerichtliche "
        "Mahnbescheide kommen per Post, nicht per Mail. Verbraucherzentrale kann helfen.",
    ),
    Kategorie(
        "Betrug: Anlage/Krypto",
        "Verspricht hohe, 'garantierte' Renditen oder Trading-Gewinne.",
        (r"rendite|garantiert(e|er)? gewinn", r"trading|investment|investier", r"krypto|bitcoin|ethereum",
         r"passives einkommen", r"broker|plattform"),
        "Anbieter bei der BaFin-Unternehmensdatenbank und der BaFin-Warnliste prüfen. Kein Geld senden.",
    ),
    Kategorie(
        "Betrug: Job/Finanzagent",
        "Angebliches Jobangebot, oft Geldwäsche ('Finanzagent') oder Identitätsdiebstahl.",
        (r"nebenjob|homeoffice[- ]job|von zu hause", r"(pro|die) stunde verdienen|€ ?pro (tag|stunde)",
         r"finanzagent|zahlungsabwickler", r"keine erfahrung (nötig|erforderlich)", r"whatsapp|telegram"),
        "Nie Geld über das eigene Konto weiterleiten (Geldwäsche!), keine Ausweisdaten per Video-Ident an Unbekannte.",
    ),
    Kategorie(
        "Spam/Werbung",
        "Unerwünschte Werbung ohne erkennbaren Betrug.",
        (r"newsletter", r"abmelden|abbestellen|unsubscribe", r"angebot|rabatt|sale|gutscheincode", r"jetzt kaufen"),
        "Bei seriösem Absender abmelden, sonst als Spam markieren und löschen.",
    ),
)


def _treffer(text: str, kat: Kategorie) -> list[str]:
    """Liefert je passendem Muster die tatsächlich gefundene Textstelle."""
    gefunden = []
    for muster in kat.muster:
        m = re.search(muster, text)
        if m:
            gefunden.append(m.group(0).strip())
    return gefunden


def klassifizieren(bericht: Bericht, text: str, hat_links: bool) -> None:
    """Bewertet Text + bisherige Befunde und fügt eine Einstufung zum Bericht hinzu."""
    text = text.lower()
    technisch_unauffaellig = bericht.hoechste_stufe() in ("ok", "info", "niedrig")
    dmarc_ok = any(b.stufe == "ok" and "DMARC bestanden" in b.text for b in bericht.befunde)
    befunde = bericht.befunde + [b for u in bericht.unterberichte for b in u.befunde]
    kategorien_befunde = {(b.stufe, b.kategorie) for b in befunde}
    alle_texte = " ".join(b.text for b in befunde)

    # Technische Signale
    schadsoftware = any(b.stufe == "hoch" and b.kategorie in ("Anhang", "Dateityp", "Aktive Inhalte",
                                                              "Virenscan", "Archiv") for b in befunde) \
        or "SCHADSOFTWARE" in alle_texte
    phishing_db = "PHISHING" in alle_texte
    gefaelscht = ("hoch", "Authentifizierung") in kategorien_befunde or ("hoch", "Absender") in kategorien_befunde
    link_trick = ("hoch", "Links") in kategorien_befunde

    punkte: dict[str, float] = {}
    gruende: dict[str, list[str]] = {}
    for kat in KATEGORIEN:
        t = _treffer(text, kat)
        punkte[kat.name] = float(len(t))
        gruende[kat.name] = [f"Formulierung im Text: „{m}“" for m in t[:5]]

    ph = "Phishing (Datendiebstahl)"
    if hat_links:
        punkte[ph] += 0.5
    if link_trick:
        punkte[ph] += 3
        gruende[ph].append("Link-Täuschung erkannt")
    if any(b.kategorie in ("Absender", "Links") and ("Marke" in b.text or "imitiert" in b.text
                                                      or "ähnelt stark" in b.text or "Subdomain" in b.text)
           for b in befunde):
        punkte[ph] += 1.5
        gruende[ph].append("Adresse gibt sich als bekannte Marke aus")
    if phishing_db:
        punkte[ph] += 5
        gruende[ph].append("Link steht in Phishing-Datenbank")
    if gefaelscht:
        for k in punkte:
            if k != "Spam/Werbung" and punkte[k] >= 2:
                punkte[k] += 1.5
                gruende[k].append("Absender gefälscht/getarnt")

    ergebnisse = []
    if schadsoftware:
        ergebnisse.append(("Schadsoftware-Verteilung", 10.0,
                           ["Gefährlicher Anhang, Makro oder Virenfund"],
                           "Anhang auf keinen Fall öffnen. Falls schon geöffnet: Gerät vom Netz "
                           "trennen und mit aktuellem Virenscanner prüfen."))
    for kat in KATEGORIEN:
        if punkte[kat.name] >= 2:
            ergebnisse.append((kat.name, punkte[kat.name], gruende[kat.name], kat.rat))
    ergebnisse.sort(key=lambda e: -e[1])

    # Spam nur nennen, wenn nichts Ernsteres gefunden wurde
    if len(ergebnisse) > 1:
        ergebnisse = [e for e in ergebnisse if e[0] != "Spam/Werbung"]

    if not ergebnisse:
        stufe = bericht.hoechste_stufe()
        if stufe == "hoch":
            name = "Verdächtig (Art unklar)"
        elif stufe == "mittel":
            name = "Unklar – einzelne Auffälligkeiten"
        else:
            name = "Keine typische Betrugsmasche erkannt"
        bericht.details["Einstufung"] = name
        return

    haupt = ergebnisse[0]
    sicherheit = "hoch" if haupt[1] >= 5 else "mittel" if haupt[1] >= 3 else "niedrig"
    bericht.details["Einstufung"] = f"{haupt[0]} (Sicherheit der Einstufung: {sicherheit})"
    if len(ergebnisse) > 1:
        bericht.details["Weitere mögliche Einstufungen"] = [e[0] for e in ergebnisse[1:4]]
    bericht.details["Gründe für die Einstufung"] = haupt[2]
    bericht.details["Empfehlung"] = haupt[3]
    if haupt[0] == "Spam/Werbung":
        return
    if technisch_unauffaellig and dmarc_ok:
        bericht.add(
            "niedrig", "Einstufung",
            f"Der Text ähnelt der Masche '{haupt[0]}', technisch ist die Mail aber unauffällig "
            "und stammt nachweislich von der Absenderdomain. Trotzdem Links nicht blind folgen, "
            "sondern direkt über App/Website nachsehen.",
        )
        return
    stufe = "hoch" if sicherheit == "hoch" else "mittel"
    bericht.add(stufe, "Einstufung", f"Wahrscheinlich: {haupt[0]}")

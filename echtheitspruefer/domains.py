"""Hilfsfunktionen rund um Domains: Organisationsdomain, Lookalikes, Homoglyphen."""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlsplit

# Kleine Auswahl mehrteiliger Public Suffixes. Keine vollständige Public Suffix
# List – die Ermittlung der Organisationsdomain ist daher eine Näherung.
_MEHRTEILIGE_SUFFIXE = {
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
    "co.at", "or.at", "gv.at", "ac.at", "co.nz", "co.jp", "com.br", "com.tr",
    "com.cn", "co.za", "com.mx", "co.in", "com.es", "com.pl",
}

# Häufig imitierte Marken/Institutionen (Kennung = Label der Organisationsdomain).
MARKEN = {
    "paypal", "amazon", "apple", "icloud", "microsoft", "outlook",
    "google", "gmail", "facebook", "instagram", "whatsapp", "netflix", "ebay",
    "sparkasse", "volksbank", "commerzbank", "deutsche-bank", "postbank",
    "ing", "dkb", "comdirect", "consorsbank", "n26", "targobank", "hypovereinsbank",
    "raiffeisen", "dhl", "deutschepost", "dpd", "hermes", "ups", "fedex", "gls",
    "telekom", "vodafone", "o2online", "1und1", "gmx", "web", "t-online",
    "elster", "zoll", "bundesfinanzministerium", "arbeitsagentur", "klarna",
    "booking", "airbnb", "adobe", "dropbox", "docusign", "wetransfer",
    "mastercard", "visa", "americanexpress", "binance", "coinbase", "linkedin",
}

# Bekannte echte Domains, die einen Markennamen enthalten (erweiterbar).
BEKANNT_ECHT = {
    "amazonaws.com", "amazonses.com", "facebookmail.com", "googlemail.com",
    "googleusercontent.com", "microsoftonline.com", "linkedinmail.com",
}

KURZLINK_DIENSTE = {
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
    "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc",
}

# Buchstaben, die gerne vertauscht werden (Ziffer ↔ Buchstabe).
_ERSETZUNGEN = str.maketrans({"0": "o", "1": "l", "3": "e", "5": "s", "4": "a", "7": "t"})


def domain_aus_adresse(adresse: str | None) -> str:
    if not adresse or "@" not in adresse:
        return ""
    return adresse.rsplit("@", 1)[1].strip().strip(">").lower().rstrip(".")


def organisationsdomain(domain: str) -> str:
    """Näherung der registrierbaren Domain (z. B. mail.paypal.de -> paypal.de)."""
    domain = domain.lower().rstrip(".")
    if ist_ip(domain):
        return domain
    teile = domain.split(".")
    if len(teile) >= 3 and ".".join(teile[-2:]) in _MEHRTEILIGE_SUFFIXE:
        return ".".join(teile[-3:])
    return ".".join(teile[-2:])


def haupt_label(domain: str) -> str:
    """Label vor dem Suffix: paypal.de -> paypal."""
    return organisationsdomain(domain).split(".")[0]


def ist_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False


def host_aus_url(url: str) -> str:
    try:
        teile = urlsplit(url.strip())
    except ValueError:
        return ""
    return (teile.hostname or "").lower()


def levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    vorher = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        aktuell = [i]
        for j, cb in enumerate(b, 1):
            aktuell.append(min(vorher[j] + 1, aktuell[j - 1] + 1, vorher[j - 1] + (ca != cb)))
        vorher = aktuell
    return vorher[-1]


def lookalike_pruefung(domain: str) -> list[tuple[str, str]]:
    """Liefert (stufe, text)-Paare für verdächtige Domain-Eigenschaften."""
    ergebnisse: list[tuple[str, str]] = []
    if not domain:
        return ergebnisse
    if "xn--" in domain:
        ergebnisse.append((
            "mittel",
            f"Domain '{domain}' ist Punycode (internationalisiert) – häufig für "
            "Homoglyphen-Tricks genutzt (z. B. kyrillisches 'а' statt 'a').",
        ))
    if any(ord(c) > 127 for c in domain):
        ergebnisse.append((
            "mittel",
            f"Domain '{domain}' enthält Nicht-ASCII-Zeichen – mögliche Homoglyphen.",
        ))
    org = organisationsdomain(domain)
    sub_labels = domain[: -len(org)].rstrip(".").split(".") if domain != org else []
    for marke in MARKEN:
        if len(marke) >= 4 and marke in sub_labels and haupt_label(domain) != marke \
                and org not in BEKANNT_ECHT:
            ergebnisse.append((
                "hoch",
                f"'{marke}' steht nur in der Subdomain – die tatsächliche Domain ist '{org}'.",
            ))
            return ergebnisse
    label = haupt_label(domain)
    if label in MARKEN or len(label) < 4 or organisationsdomain(domain) in BEKANNT_ECHT:
        return ergebnisse
    normalisiert = label.translate(_ERSETZUNGEN).replace("rn", "m").replace("vv", "w")
    for marke in MARKEN:
        if len(marke) < 4:
            continue
        if normalisiert == marke:
            ergebnisse.append(("hoch", f"Domain '{domain}' imitiert '{marke}' durch Zeichenersatz."))
            break
        abstand = levenshtein(label, marke)
        if 0 < abstand <= (1 if len(marke) <= 5 else 2):
            ergebnisse.append(("hoch", f"Domain '{domain}' ähnelt stark '{marke}' (Tippfehler-Domain?)."))
            break
        if any(
            re.search(rf"(^|[-.]){re.escape(marke)}([-.]|$)", kandidat)
            or (marke in kandidat and len(marke) >= 6)
            for kandidat in (label, normalisiert)
        ):
            ergebnisse.append((
                "niedrig",
                f"Domain '{domain}' enthält den Markennamen '{marke}', ist aber nicht "
                "die bekannte Hauptdomain – prüfen, ob sie wirklich zur Marke gehört "
                "(bei Sparkassen/Volksbanken sind regionale Domains üblich).",
            ))
            break
    return ergebnisse

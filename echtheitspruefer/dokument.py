"""Prüfung von Dokumenten (PDF, Office, Bilder, …) auf Manipulations- und Gefahrenhinweise.

Wichtig: Alle Prüfungen sind Heuristiken auf Basis von Metadaten und Dateistruktur.
Sie können Hinweise auf Bearbeitung oder Gefahren liefern, aber weder Echtheit
beweisen noch eine Fälschung sicher nachweisen.
"""

from __future__ import annotations

import hashlib
import io
import re
import struct
import zipfile
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import PurePath
from xml.etree import ElementTree

from .bericht import Bericht

# --------------------------------------------------------------------------- #
# Dateityp-Erkennung
# --------------------------------------------------------------------------- #

GEFAEHRLICHE_ENDUNGEN = {
    ".exe", ".scr", ".com", ".pif", ".bat", ".cmd", ".vbs", ".vbe", ".js", ".jse",
    ".wsf", ".wsh", ".hta", ".ps1", ".msi", ".msix", ".jar", ".lnk", ".cpl", ".dll",
    ".reg", ".iso", ".img", ".vhd", ".vhdx", ".appx", ".application", ".url",
    ".chm", ".xll", ".one",
}
# Können Skripte/gefälschte Login-Seiten enthalten, sind aber nicht direkt ausführbar.
RISKANTE_ENDUNGEN = {".svg", ".html", ".htm", ".shtml", ".xhtml"}
MAKRO_ENDUNGEN = {".docm", ".dotm", ".xlsm", ".xltm", ".xlam", ".pptm", ".potm", ".ppsm"}

_ERWARTET = {
    ".pdf": "pdf",
    ".docx": "ooxml", ".docm": "ooxml", ".dotx": "ooxml", ".dotm": "ooxml",
    ".xlsx": "ooxml", ".xlsm": "ooxml", ".xltx": "ooxml",
    ".pptx": "ooxml", ".pptm": "ooxml", ".ppsx": "ooxml",
    ".doc": "ole", ".xls": "ole", ".ppt": "ole", ".msg": "ole",
    ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".gif": "gif",
    ".zip": "zip", ".rtf": "rtf", ".exe": "exe", ".dll": "exe",
    ".odt": "odf", ".ods": "odf", ".odp": "odf",
}


def erkenne_typ(daten: bytes) -> str:
    kopf = daten[:8]
    if b"%PDF-" in daten[:1024]:
        return "pdf"
    if kopf.startswith(b"PK\x03\x04") or kopf.startswith(b"PK\x05\x06"):
        try:
            with zipfile.ZipFile(io.BytesIO(daten)) as z:
                namen = z.namelist()
        except zipfile.BadZipFile:
            return "zip"
        if "[Content_Types].xml" in namen:
            return "ooxml"
        if "mimetype" in namen:
            return "odf"
        return "zip"
    if kopf.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "ole"
    if kopf.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if kopf.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if kopf.startswith(b"GIF8"):
        return "gif"
    if kopf.startswith(b"MZ"):
        return "exe"
    if kopf.startswith(b"\x7fELF"):
        return "exe"
    if kopf.startswith(b"{\\rt"):
        return "rtf"
    if daten[:512].lstrip().lower().startswith((b"<!doctype html", b"<html")):
        return "html"
    return "unbekannt"


# --------------------------------------------------------------------------- #
# Einstieg
# --------------------------------------------------------------------------- #

def pruefe_dokument(daten: bytes, name: str) -> Bericht:
    bericht = Bericht("Dokumentprüfung", name)
    typ = erkenne_typ(daten)
    endungen = [s.lower() for s in PurePath(name).suffixes]
    endung = endungen[-1] if endungen else ""

    bericht.details["Größe"] = f"{len(daten):,} Bytes".replace(",", ".")
    bericht.details["SHA-256"] = hashlib.sha256(daten).hexdigest()
    bericht.details["Erkannter Typ"] = typ

    _pruefe_endung(bericht, endungen, endung, typ)

    if typ == "pdf":
        _pruefe_pdf(bericht, daten)
    elif typ == "ooxml":
        _pruefe_ooxml(bericht, daten, endung)
    elif typ == "ole":
        _pruefe_ole(bericht, daten)
    elif typ == "rtf":
        _pruefe_rtf(bericht, daten)
    elif typ in ("jpeg", "png"):
        _pruefe_bild(bericht, daten, typ)
    elif typ == "zip":
        _pruefe_zip(bericht, daten)
    elif typ == "exe":
        bericht.add("hoch", "Dateityp", "Die Datei ist ein ausführbares Programm – nicht öffnen!")
    elif typ == "html" and endung not in RISKANTE_ENDUNGEN:
        bericht.add(
            "mittel", "Dateityp",
            "HTML-Datei: wird im Browser geöffnet und wird oft für gefälschte "
            "Login-Seiten als Anhang verwendet.",
        )
    return bericht


def _pruefe_endung(bericht: Bericht, endungen: list[str], endung: str, typ: str) -> None:
    if endung in GEFAEHRLICHE_ENDUNGEN:
        bericht.add("hoch", "Dateityp", f"Gefährliche Dateiendung '{endung}' – kann Code ausführen.")
    if endung in MAKRO_ENDUNGEN:
        bericht.add("hoch", "Dateityp", f"Dateiendung '{endung}' steht für Office-Dateien mit Makros.")
    if endung in RISKANTE_ENDUNGEN:
        bericht.add(
            "mittel", "Dateityp",
            f"'{endung}'-Dateien öffnen sich im Browser und können Skripte oder "
            "nachgebaute Login-Seiten enthalten.",
        )
    if len(endungen) >= 2 and endungen[-2] in {".pdf", ".doc", ".docx", ".jpg", ".png", ".xls", ".xlsx", ".txt"} \
            and endung in GEFAEHRLICHE_ENDUNGEN | {".zip", ".rar", ".7z", ".html", ".htm"}:
        bericht.add(
            "hoch", "Dateityp",
            f"Doppelte Endung '{''.join(endungen[-2:])}' – klassischer Tarntrick.",
        )
    erwartet = _ERWARTET.get(endung)
    if erwartet and typ != "unbekannt" and erwartet != typ:
        stufe = "hoch" if typ in ("exe", "html") else "mittel"
        bericht.add(
            stufe, "Dateityp",
            f"Endung '{endung}' passt nicht zum tatsächlichen Inhalt ({typ}).",
        )


# --------------------------------------------------------------------------- #
# PDF
# --------------------------------------------------------------------------- #

# Programme, die typischerweise zum nachträglichen Bearbeiten von PDFs genutzt werden.
PDF_EDITOREN = (
    "ilovepdf", "smallpdf", "sejda", "pdfescape", "pdf-xchange", "pdfxchange",
    "foxit phantompdf", "foxit pdf editor", "nitro", "pdffiller", "pdf candy",
    "pdf24", "soda pdf", "wondershare", "pdfelement", "inkscape", "libreoffice draw",
    "adobe acrobat pro", "photoshop", "gimp", "canva", "online2pdf", "pdfzorro",
    "pdf buddy", "dochub", "lightpdf", "pdfsimpli", "hipdf",
)


def _pdf_string(roh: bytes) -> str:
    """Dekodiert einen PDF-Literal- oder Hex-String (vereinfachte Implementierung)."""
    roh = roh.strip()
    if roh.startswith(b"<") and roh.endswith(b">"):
        try:
            daten = bytes.fromhex(re.sub(rb"\s", b"", roh[1:-1]).decode())
        except ValueError:
            return roh.decode("latin-1")
    else:
        inhalt = roh[1:-1] if roh.startswith(b"(") else roh
        daten = bytearray()
        i = 0
        while i < len(inhalt):
            c = inhalt[i]
            if c == 0x5C and i + 1 < len(inhalt):  # Backslash
                n = inhalt[i + 1]
                abbildung = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
                if n in abbildung:
                    daten.append(abbildung[n])
                    i += 2
                elif 0x30 <= n <= 0x37:
                    m = re.match(rb"[0-7]{1,3}", inhalt[i + 1:i + 4])
                    daten.append(int(m.group(), 8) & 0xFF)
                    i += 1 + len(m.group())
                elif n in (10, 13):
                    i += 2
                else:
                    daten.append(n)
                    i += 2
            else:
                daten.append(c)
                i += 1
        daten = bytes(daten)
    if daten.startswith(b"\xfe\xff"):
        return daten[2:].decode("utf-16-be", "replace")
    if daten.startswith(b"\xff\xfe"):
        return daten[2:].decode("utf-16-le", "replace")
    return daten.decode("latin-1")


def _pdf_datum(s: str) -> datetime | None:
    m = re.match(r"(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?", s.strip())
    if not m:
        return None
    j, mo, t, h, mi, se, tz, tzh, tzm = m.groups()
    try:
        dt = datetime(int(j), int(mo or 1), int(t or 1), int(h or 0), int(mi or 0), int(se or 0))
    except ValueError:
        return None
    if tz in ("+", "-") and tzh:
        delta = timedelta(hours=int(tzh), minutes=int(tzm or 0))
        return dt.replace(tzinfo=timezone(delta if tz == "+" else -delta))
    return dt.replace(tzinfo=timezone.utc)  # ohne Angabe: als UTC annehmen


def _iso_datum(s: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _pdf_inhalte(daten: bytes, limit: int = 60 * 1024 * 1024) -> bytes:
    """Rohdaten plus entpackte Flate-Streams (für die Suche nach Schlüsselwörtern)."""
    teile = [daten]
    gesamt = 0
    for m in re.finditer(rb"stream\r?\n", daten):
        start = m.end()
        ende = daten.find(b"endstream", start)
        if ende == -1:
            break
        try:
            entpackt = zlib.decompressobj().decompress(daten[start:ende], 20 * 1024 * 1024)
        except zlib.error:
            continue
        gesamt += len(entpackt)
        if gesamt > limit:
            break
        teile.append(entpackt)
    return b"\n".join(teile)


def _pruefe_pdf(bericht: Bericht, daten: bytes) -> None:
    kopf = re.search(rb"%PDF-(\d\.\d)", daten[:1024])
    if kopf:
        bericht.details["PDF-Version"] = kopf.group(1).decode()
    if not daten.startswith(b"%PDF-"):
        bericht.add("niedrig", "Struktur", "Vor dem PDF-Kopf stehen zusätzliche Daten (ungewöhnlich).")

    alles = _pdf_inhalte(daten)

    # --- Metadaten (Info-Dictionary) -------------------------------------
    info: dict[str, str] = {}
    for schluessel in ("Title", "Author", "Creator", "Producer", "CreationDate", "ModDate"):
        treffer = re.findall(
            rb"/" + schluessel.encode() + rb"\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)", alles, re.S,
        )
        if treffer:
            # Bei inkrementellen Updates gilt der letzte Eintrag.
            info[schluessel] = _pdf_string(treffer[-1])
    for k in ("Title", "Author", "Creator", "Producer", "CreationDate", "ModDate"):
        if k in info:
            bericht.details[f"Info/{k}"] = info[k]

    # --- XMP-Metadaten ----------------------------------------------------
    xmp: dict[str, str] = {}
    for tag in ("xmp:CreateDate", "xmp:ModifyDate", "xmp:CreatorTool", "pdf:Producer"):
        m = re.findall(rb"<" + tag.encode() + rb">([^<]*)</" + tag.encode() + rb">", alles)
        m += re.findall(rb"\b" + tag.encode() + rb"=\"([^\"]*)\"", alles)
        if m:
            xmp[tag] = m[-1].decode("utf-8", "replace")
    for k, v in xmp.items():
        bericht.details[f"XMP/{k}"] = v
    verlauf = re.findall(rb"<stEvt:softwareAgent>([^<]*)<", alles) + re.findall(
        rb"stEvt:softwareAgent=\"([^\"]*)\"", alles
    )
    if verlauf:
        bericht.details["XMP-Bearbeitungsverlauf"] = sorted({v.decode("utf-8", "replace") for v in verlauf})

    if not info and not xmp:
        bericht.add(
            "info", "Metadaten",
            "Keine Metadaten vorhanden – wurden evtl. entfernt (bei offiziellen "
            "Dokumenten eher ungewöhnlich, aber kein Beweis).",
        )

    # --- Datums-Plausibilität --------------------------------------------
    erstellt = _pdf_datum(info["CreationDate"]) if "CreationDate" in info else None
    geaendert = _pdf_datum(info["ModDate"]) if "ModDate" in info else None
    jetzt = datetime.now(timezone.utc)
    if erstellt and geaendert:
        if geaendert < erstellt - timedelta(minutes=1):
            bericht.add("mittel", "Metadaten", "Änderungsdatum liegt VOR dem Erstellungsdatum – inkonsistent.")
        elif geaendert - erstellt > timedelta(minutes=2):
            bericht.add(
                "niedrig", "Metadaten",
                f"Dokument wurde nach der Erstellung geändert "
                f"(erstellt {erstellt:%d.%m.%Y %H:%M}, geändert {geaendert:%d.%m.%Y %H:%M}).",
            )
    for label, dt in (("Erstellungsdatum", erstellt), ("Änderungsdatum", geaendert)):
        if dt and dt > jetzt + timedelta(days=1):
            bericht.add("mittel", "Metadaten", f"{label} liegt in der Zukunft ({dt:%d.%m.%Y}).")
    xmp_erstellt = _iso_datum(xmp["xmp:CreateDate"]) if "xmp:CreateDate" in xmp else None
    if erstellt and xmp_erstellt and abs(erstellt - xmp_erstellt) > timedelta(hours=1):
        bericht.add(
            "niedrig", "Metadaten",
            "Erstellungsdatum im Info-Dictionary und in den XMP-Daten weichen voneinander ab "
            "– tritt auf, wenn ein Werkzeug nur einen Teil der Metadaten aktualisiert.",
        )

    # --- Bearbeitungswerkzeuge -------------------------------------------
    werkzeuge = " | ".join(
        [info.get("Creator", ""), info.get("Producer", ""), xmp.get("xmp:CreatorTool", ""),
         xmp.get("pdf:Producer", "")] + [v.decode("utf-8", "replace") for v in verlauf]
    ).lower()
    gefunden = sorted({e for e in PDF_EDITOREN if e in werkzeuge})
    if gefunden:
        bericht.add(
            "mittel", "Bearbeitung",
            f"Mit PDF-Bearbeitungs-/Grafiksoftware verarbeitet: {', '.join(gefunden)}. "
            "Bei Rechnungen, Kontoauszügen oder Bescheiden, die direkt aus einem "
            "System des Ausstellers stammen sollten, ist das verdächtig.",
        )

    # --- Inkrementelle Updates -------------------------------------------
    eofs = daten.count(b"%%EOF")
    bericht.details["Speicherstände (%%EOF)"] = eofs
    if eofs > 1:
        bericht.add(
            "niedrig", "Bearbeitung",
            f"Die Datei enthält {eofs} Speicherstände (inkrementelle Updates) – "
            "sie wurde nach dem ersten Speichern ergänzt oder verändert "
            "(auch bei Signaturen oder ausgefüllten Formularen normal).",
        )

    # --- Schriften: mehrere Teilmengen derselben Schrift ------------------
    subsets: dict[str, set[str]] = {}
    for praefix, schrift in re.findall(rb"/BaseFont\s*/([A-Z]{6})\+([^\s/\[\]<>()]+)", alles):
        subsets.setdefault(schrift.decode("latin-1"), set()).add(praefix.decode())
    mehrfach = {s: p for s, p in subsets.items() if len(p) > 1}
    if mehrfach:
        bericht.add(
            "niedrig", "Bearbeitung",
            "Dieselbe Schrift ist mehrfach als separate Teilmenge eingebettet ("
            + ", ".join(sorted(mehrfach)[:5])
            + ") – typisches Muster, wenn Text nachträglich eingefügt wurde (Heuristik, "
            "kann auch beim Zusammenfügen von PDFs entstehen).",
        )

    # --- Aktive Inhalte ---------------------------------------------------
    if re.search(rb"/(JavaScript|JS)\b", alles):
        bericht.add("hoch", "Aktive Inhalte", "PDF enthält JavaScript.")
    if re.search(rb"/Launch\b", alles):
        bericht.add("hoch", "Aktive Inhalte", "PDF enthält eine /Launch-Aktion (kann Programme starten).")
    if re.search(rb"/EmbeddedFiles?\b", alles):
        bericht.add("mittel", "Aktive Inhalte", "PDF enthält eingebettete Dateien.")
    if re.search(rb"/OpenAction\b|/AA\b", alles) and re.search(rb"/(JavaScript|JS|Launch|URI|SubmitForm)\b", alles):
        bericht.add("mittel", "Aktive Inhalte", "PDF führt beim Öffnen automatisch eine Aktion aus.")
    if re.search(rb"/XFA\b", alles):
        bericht.add("niedrig", "Aktive Inhalte", "PDF enthält XFA-Formulare.")
    uris = sorted({u.decode("latin-1") for u in re.findall(rb"/URI\s*\(([^)]*)\)", alles)})
    if uris:
        bericht.details["Links im PDF"] = uris

    # --- Digitale Signaturen ---------------------------------------------
    byte_ranges = re.findall(rb"/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]", daten)
    if byte_ranges:
        bericht.add(
            "info", "Signatur",
            f"{len(byte_ranges)} digitale Signatur(en) gefunden. Die kryptografische "
            "Gültigkeit wird hier NICHT geprüft – dafür z. B. das Signaturfenster in "
            "Adobe Acrobat Reader verwenden.",
        )
        for a, b, c, d in byte_ranges:
            a, b, c, d = int(a), int(b), int(c), int(d)
            ende = c + d
            if a != 0 or c + d > len(daten):
                bericht.add("mittel", "Signatur", "Signatur-ByteRange ist fehlerhaft/ungewöhnlich.")
                continue
            rest = daten[ende:]
            if rest.strip(b" \r\n\t\x00%EOF"):
                bericht.add(
                    "mittel", "Signatur",
                    f"Nach einer Signatur wurden noch {len(rest)} Bytes angehängt – Inhalte "
                    "wurden nach dem Signieren ergänzt (legitim z. B. bei weiteren "
                    "Signaturen; sonst verdächtig). Im Reader prüfen, welche Änderungen "
                    "nach der Signatur erfolgten.",
                )


# --------------------------------------------------------------------------- #
# Office Open XML (docx/xlsx/pptx)
# --------------------------------------------------------------------------- #

_NS = {
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "ep": "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
}


def _xml(z: zipfile.ZipFile, name: str) -> ElementTree.Element | None:
    try:
        return ElementTree.fromstring(z.read(name))
    except (KeyError, ElementTree.ParseError):
        return None


def _pruefe_ooxml(bericht: Bericht, daten: bytes, endung: str) -> None:
    try:
        z = zipfile.ZipFile(io.BytesIO(daten))
    except zipfile.BadZipFile:
        bericht.add("mittel", "Struktur", "Office-Datei ist beschädigt (ZIP nicht lesbar).")
        return
    with z:
        namen = z.namelist()
        klein = [n.lower() for n in namen]

        core = _xml(z, "docProps/core.xml")
        erstellt = geaendert = None
        if core is not None:
            felder = {
                "Autor": "dc:creator", "Zuletzt geändert von": "cp:lastModifiedBy",
                "Erstellt": "dcterms:created", "Geändert": "dcterms:modified",
                "Revision": "cp:revision", "Titel": "dc:title",
            }
            werte = {}
            for label, pfad in felder.items():
                el = core.find(pfad, _NS)
                if el is not None and el.text:
                    werte[label] = el.text.strip()
                    bericht.details[label] = el.text.strip()
            erstellt = _iso_datum(werte["Erstellt"]) if "Erstellt" in werte else None
            geaendert = _iso_datum(werte["Geändert"]) if "Geändert" in werte else None
            if werte.get("Autor") and werte.get("Zuletzt geändert von") and \
                    werte["Autor"] != werte["Zuletzt geändert von"]:
                bericht.add(
                    "info", "Metadaten",
                    f"Erstellt von '{werte['Autor']}', zuletzt geändert von "
                    f"'{werte['Zuletzt geändert von']}'.",
                )
        else:
            bericht.add("info", "Metadaten", "Keine Dokumenteigenschaften (core.xml) vorhanden.")

        app = _xml(z, "docProps/app.xml")
        if app is not None:
            for label, tag in (("Anwendung", "ep:Application"), ("Version", "ep:AppVersion"),
                               ("Firma", "ep:Company"), ("Bearbeitungszeit (Min.)", "ep:TotalTime")):
                el = app.find(tag, _NS)
                if el is not None and el.text:
                    bericht.details[label] = el.text.strip()

        if erstellt and geaendert and geaendert < erstellt - timedelta(minutes=1):
            bericht.add("mittel", "Metadaten", "Änderungsdatum liegt vor dem Erstellungsdatum – inkonsistent.")
        jetzt = datetime.now(timezone.utc)
        for label, dt in (("Erstellungsdatum", erstellt), ("Änderungsdatum", geaendert)):
            if dt and dt > jetzt + timedelta(days=1):
                bericht.add("mittel", "Metadaten", f"{label} liegt in der Zukunft ({dt:%d.%m.%Y}).")

        # Makros / aktive Inhalte
        if any(n.endswith("vbaproject.bin") for n in klein):
            bericht.add("hoch", "Aktive Inhalte", "Dokument enthält VBA-Makros.")
        if any("activex" in n for n in klein):
            bericht.add("mittel", "Aktive Inhalte", "Dokument enthält ActiveX-Steuerelemente.")
        eingebettet = [n for n in namen if "/embeddings/" in n.lower() or "oleobject" in n.lower()]
        if eingebettet:
            bericht.add("mittel", "Aktive Inhalte", f"Dokument enthält {len(eingebettet)} eingebettete Objekte.")
            bericht.details["Eingebettete Objekte"] = eingebettet

        # Externe Verweise (u. a. Remote-Template-Injection)
        externe = []
        for n in namen:
            if not n.endswith(".rels"):
                continue
            try:
                rels = ElementTree.fromstring(z.read(n))
            except ElementTree.ParseError:
                continue
            for rel in rels:
                if rel.get("TargetMode") == "External":
                    typ = rel.get("Type", "").rsplit("/", 1)[-1]
                    ziel = rel.get("Target", "")
                    externe.append(f"{typ}: {ziel}")
                    if typ in ("attachedTemplate", "oleObject", "frame", "subDocument") and \
                            re.match(r"(?i)(https?|file|\\\\)", ziel):
                        bericht.add(
                            "hoch", "Aktive Inhalte",
                            f"Externer Verweis vom Typ '{typ}' auf {ziel} – bekannte Technik, "
                            "um beim Öffnen Schadcode nachzuladen.",
                        )
        if externe:
            bericht.details["Externe Verweise"] = externe

        # Überarbeitungen & Kommentare
        if "word/document.xml" in namen:
            dok = z.read("word/document.xml")
            ins, dele = dok.count(b"<w:ins "), dok.count(b"<w:del ")
            if ins or dele:
                bericht.add(
                    "info", "Bearbeitung",
                    f"Nachverfolgte Änderungen enthalten ({ins} Einfügungen, {dele} Löschungen).",
                )
            rsids = set(re.findall(rb'w:rsidR="([0-9A-F]{8})"', dok))
            if rsids:
                bericht.details["Bearbeitungssitzungen (rsid, Näherung)"] = len(rsids)
        if any(n.endswith("comments.xml") for n in klein):
            bericht.add("info", "Bearbeitung", "Dokument enthält Kommentare.")
        if any(n.startswith("_xmlsignatures/") for n in klein):
            bericht.add("info", "Signatur", "Dokument ist digital signiert (Gültigkeit hier nicht geprüft).")

        if endung in (".docx", ".xlsx", ".pptx") and any(n.endswith("vbaproject.bin") for n in klein):
            bericht.add("mittel", "Dateityp", "Makros in einer Datei mit makrofreier Endung – ungewöhnlich.")


# --------------------------------------------------------------------------- #
# Alte Office-Formate, RTF, ZIP
# --------------------------------------------------------------------------- #

def _pruefe_ole(bericht: Bericht, daten: bytes) -> None:
    bericht.add(
        "info", "Dateityp",
        "Altes Office-Format (OLE). Die Analyse ist hier eingeschränkt.",
    )
    utf16 = lambda s: s.encode("utf-16-le")  # noqa: E731
    if any(m in daten for m in (b"_VBA_PROJECT", utf16("_VBA_PROJECT"), utf16("Macros"), utf16("VBA"))):
        bericht.add("hoch", "Aktive Inhalte", "Datei enthält vermutlich VBA-Makros.")
    if b"Equation.3" in daten or utf16("Equation Native") in daten:
        bericht.add("hoch", "Aktive Inhalte", "Enthält Formel-Editor-Objekt (bekannter Exploit-Vektor).")
    if utf16("Ole10Native") in daten or utf16("ObjectPool") in daten:
        bericht.add("mittel", "Aktive Inhalte", "Enthält eingebettete OLE-Objekte.")


def _pruefe_rtf(bericht: Bericht, daten: bytes) -> None:
    if re.search(rb"\\objdata|\\objupdate|\\objocx|\\objemb", daten):
        bericht.add("hoch", "Aktive Inhalte", "RTF enthält eingebettete Objekte (häufiger Exploit-Weg).")


def _pruefe_zip(bericht: Bericht, daten: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(daten)) as z:
            eintraege = z.infolist()
    except zipfile.BadZipFile:
        bericht.add("mittel", "Struktur", "ZIP-Archiv ist beschädigt.")
        return
    namen = [e.filename for e in eintraege]
    bericht.details["Inhalt des Archivs"] = namen
    if any(e.flag_bits & 0x1 for e in eintraege):
        bericht.add(
            "mittel", "Archiv",
            "Archiv ist passwortgeschützt – wird oft genutzt, um Virenscanner zu umgehen.",
        )
    gefaehrlich = [n for n in namen
                   if PurePath(n).suffix.lower() in GEFAEHRLICHE_ENDUNGEN | MAKRO_ENDUNGEN]
    if gefaehrlich:
        bericht.add(
            "hoch", "Archiv",
            f"Archiv enthält {len(gefaehrlich)} gefährliche Datei(en): {', '.join(gefaehrlich[:5])}"
            + (" …" if len(gefaehrlich) > 5 else ""),
        )


# --------------------------------------------------------------------------- #
# Bilder
# --------------------------------------------------------------------------- #

BILD_EDITOREN = ("photoshop", "gimp", "lightroom", "affinity", "paint.net", "pixelmator",
                 "snapseed", "canva", "picsart", "facetune", "illustrator")


def _exif_aus_tiff(tiff: bytes) -> dict[str, str]:
    """Minimaler EXIF-Leser für einige relevante Tags."""
    if tiff[:2] == b"II":
        e = "<"
    elif tiff[:2] == b"MM":
        e = ">"
    else:
        return {}
    namen = {0x010F: "Hersteller", 0x0110: "Modell", 0x0131: "Software",
             0x0132: "Änderungsdatum", 0x9003: "Aufnahmedatum", 0x8769: "_exif"}
    ergebnis: dict[str, str] = {}

    def lies_ifd(offset: int, tiefe: int = 0) -> None:
        if tiefe > 2 or offset + 2 > len(tiff):
            return
        (anzahl,) = struct.unpack(e + "H", tiff[offset:offset + 2])
        for i in range(min(anzahl, 500)):
            pos = offset + 2 + i * 12
            if pos + 12 > len(tiff):
                return
            tag, typ, count, wert = struct.unpack(e + "HHII", tiff[pos:pos + 12])
            if tag not in namen:
                continue
            if tag == 0x8769:
                lies_ifd(wert, tiefe + 1)
            elif typ == 2:  # ASCII
                roh = tiff[pos + 8:pos + 8 + count] if count <= 4 else tiff[wert:wert + count]
                ergebnis[namen[tag]] = roh.split(b"\x00")[0].decode("latin-1").strip()

    (ifd0,) = struct.unpack(e + "I", tiff[4:8])
    lies_ifd(ifd0)
    return ergebnis


def _pruefe_bild(bericht: Bericht, daten: bytes, typ: str) -> None:
    exif: dict[str, str] = {}
    if typ == "jpeg":
        pos = 2
        while pos + 4 <= len(daten) and daten[pos] == 0xFF:
            marker = daten[pos + 1]
            (laenge,) = struct.unpack(">H", daten[pos + 2:pos + 4])
            segment = daten[pos + 4:pos + 2 + laenge]
            if marker == 0xE1 and segment.startswith(b"Exif\x00\x00"):
                try:
                    exif = _exif_aus_tiff(segment[6:])
                except struct.error:
                    pass
                break
            if marker == 0xDA:
                break
            pos += 2 + laenge
    elif typ == "png":
        for schluessel, wert in re.findall(rb"tEXt(Software|Creation Time)\x00([^\x00]{1,200})", daten):
            exif[schluessel.decode()] = wert.decode("latin-1")

    for k, v in exif.items():
        bericht.details[k] = v
    if not exif:
        bericht.add(
            "info", "Metadaten",
            "Keine EXIF-Daten – bei Fotos direkt von der Kamera ungewöhnlich; entsteht "
            "aber auch durch Messenger, soziale Netzwerke oder Screenshots.",
        )
    kette = (exif.get("Software", "") + " " + daten[:65536].decode("latin-1", "ignore")).lower()
    editoren = sorted({e for e in BILD_EDITOREN if e in kette})
    if editoren:
        bericht.add(
            "niedrig", "Bearbeitung",
            f"Bild wurde mit Bildbearbeitung gespeichert ({', '.join(editoren)}). "
            "Das beweist keine Fälschung, zeigt aber, dass es nicht unverändert aus der Kamera stammt.",
        )
    if exif.get("Aufnahmedatum") and exif.get("Änderungsdatum") and \
            exif["Aufnahmedatum"] != exif["Änderungsdatum"]:
        bericht.add(
            "info", "Metadaten",
            f"Aufnahme ({exif['Aufnahmedatum']}) und letzte Änderung "
            f"({exif['Änderungsdatum']}) unterscheiden sich.",
        )

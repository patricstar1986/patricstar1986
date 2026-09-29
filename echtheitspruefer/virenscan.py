"""Virenprüfung: lokaler Scan mit ClamAV (falls installiert) plus Hash-Abgleich
mit Online-Datenbanken (VirusTotal, MalwareBazaar – nur mit API-Schlüssel)."""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess

from . import datenbanken
from .bericht import Bericht


def clamav_scan(daten: bytes) -> tuple[str, str]:
    """Liefert (status, text). status: 'sauber', 'virus', 'nicht_verfuegbar', 'fehler'."""
    for programm in ("clamdscan", "clamscan"):
        pfad = shutil.which(programm)
        if not pfad:
            continue
        argumente = [pfad, "--no-summary", "-"]
        if programm == "clamdscan":
            argumente.insert(1, "--fdpass")
        try:
            lauf = subprocess.run(argumente, input=daten, capture_output=True, timeout=300)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return "fehler", f"{programm}: {exc}"
        ausgabe = (lauf.stdout + lauf.stderr).decode("utf-8", "replace")
        if lauf.returncode == 1:
            m = re.search(r":\s*(.+?)\s+FOUND", ausgabe)
            return "virus", m.group(1) if m else "unbekannte Signatur"
        if lauf.returncode == 0:
            return "sauber", programm
        if programm == "clamdscan":
            continue  # Dienst läuft nicht – mit clamscan weiterversuchen
        if "database" in ausgabe.lower():
            return "fehler", "ClamAV ist installiert, aber es sind keine Virensignaturen geladen (freshclam ausführen)."
        return "fehler", ausgabe.strip()[:200]
    return "nicht_verfuegbar", "ClamAV ist nicht installiert."


def virenpruefung(bericht: Bericht, daten: bytes, online: bool) -> None:
    status, text = clamav_scan(daten)
    if status == "virus":
        bericht.add("hoch", "Virenscan", f"ClamAV hat Schadsoftware gefunden: {text}")
    elif status == "sauber":
        bericht.add("ok", "Virenscan", "ClamAV: keine bekannte Schadsoftware gefunden.")
    elif status == "fehler":
        bericht.add("info", "Virenscan", f"ClamAV-Scan nicht möglich: {text}")
    else:
        bericht.add("info", "Virenscan", "Kein lokaler Virenscanner (ClamAV) gefunden – Virenscan übersprungen.")

    if online:
        ergebnis = datenbanken.pruefe_hash(hashlib.sha256(daten).hexdigest())
        for t in ergebnis.treffer:
            bericht.add(t.stufe, "Datenbank", f"[{t.quelle}] {t.text}")
        if ergebnis.geprueft and not ergebnis.treffer:
            bericht.add("ok", "Datenbank", f"Nicht als Schadsoftware bekannt bei: {', '.join(ergebnis.geprueft)}.")
        for f in ergebnis.fehler:
            bericht.add("info", "Datenbank", f)
        if not ergebnis.geprueft and not ergebnis.fehler:
            bericht.add("info", "Datenbank",
                        "Kein API-Schlüssel für VirusTotal/MalwareBazaar gesetzt – Hash-Abgleich übersprungen.")

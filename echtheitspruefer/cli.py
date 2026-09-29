"""Kommandozeile: python -m echtheitspruefer <datei> [...]"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .dokument import pruefe_dokument
from .mail import pruefe_mail, pruefe_text

MAIL_ENDUNGEN = {".eml", ".mbox_msg", ".mht"}


def _ist_mail(pfad: Path, daten: bytes) -> bool:
    if pfad.suffix.lower() in MAIL_ENDUNGEN:
        return True
    kopf = daten[:4096].decode("latin-1", "ignore")
    return pfad.suffix.lower() in ("", ".txt") and all(
        f"\n{h}:" in "\n" + kopf for h in ("From", "Date")
    ) and ("\nReceived:" in "\n" + kopf or "\nMessage-ID:" in "\n" + kopf)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="echtheitspruefer",
        description="Prüft E-Mails (.eml) und Dokumente (PDF, Office, Bilder, ZIP …) "
                    "auf Hinweise für Fälschung, Manipulation oder Schadcode.",
        epilog="Exit-Code: 0 = unauffällig, 1 = Auffälligkeiten, 2 = starke Warnzeichen.",
    )
    parser.add_argument("dateien", nargs="*", type=Path,
                        help="zu prüfende Datei(en); '-' liest eingefügten Mailtext von der Eingabe")
    parser.add_argument("--typ", choices=["auto", "mail", "dokument", "text"], default="auto",
                        help="Dateiart erzwingen (Standard: automatisch)")
    parser.add_argument("--online", action="store_true",
                        help="Abgleich mit Phishing-/Malware-Datenbanken sowie DNS-Prüfungen")
    parser.add_argument("--text", help="Mailtext direkt als Argument prüfen")
    parser.add_argument("--ohne-anhaenge", action="store_true", help="Anhänge nicht tiefer analysieren")
    parser.add_argument("--json", action="store_true", help="Ausgabe als JSON")
    parser.add_argument("--keine-farbe", action="store_true", help="farblose Ausgabe")
    args = parser.parse_args(argv)

    farbe = not args.keine_farbe and sys.stdout.isatty()
    code = 0
    ausgaben = []

    def ausgeben(bericht) -> None:
        nonlocal code
        code = max(code, bericht.exit_code())
        if args.json:
            ausgaben.append(bericht.to_dict())
        else:
            print(bericht.render_text(farbe))
            print()

    if args.text:
        ausgeben(pruefe_text(args.text, online=args.online))
    if not args.dateien and not args.text:
        if sys.stdin.isatty():
            print("Mailtext einfügen und mit Strg+D (Windows: Strg+Z, Enter) abschließen:", file=sys.stderr)
        args.dateien = [Path("-")]
    for pfad in args.dateien:
        if str(pfad) == "-":
            ausgeben(pruefe_text(sys.stdin.buffer.read().decode("utf-8", "replace"), online=args.online))
            continue
        try:
            daten = pfad.read_bytes()
        except OSError as exc:
            print(f"Fehler beim Lesen von {pfad}: {exc}", file=sys.stderr)
            code = max(code, 3)
            continue
        als_mail = args.typ == "mail" or (args.typ == "auto" and _ist_mail(pfad, daten))
        if als_mail:
            bericht = pruefe_mail(daten, pfad.name, online=args.online,
                                  anhaenge_pruefen=not args.ohne_anhaenge)
        elif args.typ == "text" or (args.typ == "auto" and pfad.suffix.lower() == ".txt"):
            bericht = pruefe_text(daten.decode("utf-8", "replace"), pfad.name, online=args.online)
        else:
            bericht = pruefe_dokument(daten, pfad.name, online=args.online)
        ausgeben(bericht)
    if args.json:
        print(json.dumps(ausgaben if len(ausgaben) != 1 else ausgaben[0], ensure_ascii=False, indent=2))
    return code

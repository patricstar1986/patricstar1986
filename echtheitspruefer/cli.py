"""Kommandozeile: python -m echtheitspruefer <datei> [...]"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .dokument import pruefe_dokument
from .mail import pruefe_mail

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
    parser.add_argument("dateien", nargs="+", type=Path, help="zu prüfende Datei(en)")
    parser.add_argument("--typ", choices=["auto", "mail", "dokument"], default="auto",
                        help="Dateiart erzwingen (Standard: automatisch)")
    parser.add_argument("--online", action="store_true",
                        help="zusätzliche DNS-Prüfungen (SPF/DMARC/DKIM) – benötigt dnspython/dkimpy")
    parser.add_argument("--ohne-anhaenge", action="store_true", help="Anhänge nicht tiefer analysieren")
    parser.add_argument("--json", action="store_true", help="Ausgabe als JSON")
    parser.add_argument("--keine-farbe", action="store_true", help="farblose Ausgabe")
    args = parser.parse_args(argv)

    farbe = not args.keine_farbe and sys.stdout.isatty()
    code = 0
    ausgaben = []
    for pfad in args.dateien:
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
        else:
            bericht = pruefe_dokument(daten, pfad.name)
        code = max(code, bericht.exit_code())
        if args.json:
            ausgaben.append(bericht.to_dict())
        else:
            print(bericht.render_text(farbe))
            print()
    if args.json:
        print(json.dumps(ausgaben if len(ausgaben) != 1 else ausgaben[0], ensure_ascii=False, indent=2))
    return code

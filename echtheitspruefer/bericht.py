"""Gemeinsame Datenstrukturen für Prüfberichte."""

from __future__ import annotations

from dataclasses import dataclass, field

STUFEN = ("ok", "info", "niedrig", "mittel", "hoch")
_RANG = {s: i for i, s in enumerate(STUFEN)}

_SYMBOL = {"ok": "✔", "info": "ℹ", "niedrig": "•", "mittel": "⚠", "hoch": "✖"}
_FARBE = {
    "ok": "\033[32m",
    "info": "\033[36m",
    "niedrig": "\033[33m",
    "mittel": "\033[33;1m",
    "hoch": "\033[31;1m",
}
_RESET = "\033[0m"


@dataclass
class Befund:
    stufe: str
    kategorie: str
    text: str


@dataclass
class Bericht:
    titel: str
    datei: str
    befunde: list[Befund] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    unterberichte: list["Bericht"] = field(default_factory=list)

    def add(self, stufe: str, kategorie: str, text: str) -> None:
        if stufe not in _RANG:
            raise ValueError(f"Unbekannte Stufe: {stufe}")
        self.befunde.append(Befund(stufe, kategorie, text))

    def hoechste_stufe(self) -> str:
        stufen = [b.stufe for b in self.befunde]
        stufen += [u.hoechste_stufe() for u in self.unterberichte]
        return max(stufen, key=_RANG.__getitem__, default="ok")

    def fazit(self) -> str:
        stufe = self.hoechste_stufe()
        if stufe == "hoch":
            return (
                "STARKE WARNZEICHEN – nicht vertrauen. Keine Links öffnen, keine "
                "Anhänge ausführen, Absender über einen unabhängigen Kanal "
                "(bekannte Telefonnummer, offizielle Website) kontaktieren."
            )
        if stufe == "mittel":
            return (
                "AUFFÄLLIGKEITEN gefunden – mit Vorsicht behandeln und die "
                "markierten Punkte gezielt nachprüfen."
            )
        return (
            "Keine technischen Auffälligkeiten gefunden. Das ist KEIN Beweis für "
            "Echtheit – geschickte Fälschungen oder kompromittierte echte Konten "
            "werden so nicht erkannt."
        )

    def exit_code(self) -> int:
        return {"hoch": 2, "mittel": 1}.get(self.hoechste_stufe(), 0)

    def to_dict(self) -> dict:
        return {
            "titel": self.titel,
            "datei": self.datei,
            "hoechste_stufe": self.hoechste_stufe(),
            "fazit": self.fazit(),
            "befunde": [b.__dict__ for b in self.befunde],
            "details": self.details,
            "unterberichte": [u.to_dict() for u in self.unterberichte],
        }

    def render_text(self, farbe: bool = True, _ebene: int = 0) -> str:
        pre = "    " * _ebene

        def f(stufe: str, s: str) -> str:
            return f"{_FARBE[stufe]}{s}{_RESET}" if farbe else s

        zeilen = [f"{pre}{'=' * 70}", f"{pre}{self.titel}: {self.datei}", f"{pre}{'=' * 70}"]

        if self.details:
            zeilen.append(f"{pre}Details:")
            for k, v in self.details.items():
                if isinstance(v, (list, tuple)):
                    if not v:
                        continue
                    zeilen.append(f"{pre}  {k}:")
                    for item in v[:25]:
                        zeilen.append(f"{pre}    - {item}")
                    if len(v) > 25:
                        zeilen.append(f"{pre}    … ({len(v) - 25} weitere)")
                elif v not in (None, ""):
                    zeilen.append(f"{pre}  {k}: {v}")
            zeilen.append("")

        zeilen.append(f"{pre}Befunde:")
        if not self.befunde:
            zeilen.append(f"{pre}  (keine)")
        for b in sorted(self.befunde, key=lambda b: -_RANG[b.stufe]):
            label = f"{_SYMBOL[b.stufe]} {b.stufe.upper():8}"
            zeilen.append(f"{pre}  {f(b.stufe, label)} [{b.kategorie}] {b.text}")

        for u in self.unterberichte:
            zeilen.append("")
            zeilen.append(u.render_text(farbe, _ebene + 1))

        if _ebene == 0:
            zeilen.append("")
            zeilen.append(f"Fazit: {f(self.hoechste_stufe(), self.fazit())}")
        return "\n".join(zeilen)

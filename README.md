# Echtheitsprüfer

Kommandozeilen-Tool, das **E-Mails** und **Dokumente** auf Hinweise für Fälschung,
Phishing, nachträgliche Bearbeitung oder Schadcode untersucht. Läuft komplett lokal,
nur mit der Python-Standardbibliothek (Python ≥ 3.9) – es werden keine Dateien hochgeladen.

> **Wichtig:** Das Tool liefert *Indizien*, keine Beweise. „Keine Auffälligkeiten“
> heißt **nicht**, dass eine Mail oder ein Dokument echt ist (z. B. bei gehackten
> echten Konten oder sauber gefälschten Dokumenten). Im Zweifel den Absender über
> einen unabhängigen, selbst recherchierten Kontaktweg fragen.

## Benutzung

```bash
python -m echtheitspruefer mail.eml
python -m echtheitspruefer rechnung.pdf vertrag.docx foto.jpg
python -m echtheitspruefer mail.eml --json          # maschinenlesbar
python -m echtheitspruefer mail.eml --online        # zusätzliche DNS-Prüfungen
```

Optional installieren (dann gibt es den Befehl `echtheitspruefer`):

```bash
pip install .            # nur Standardfunktionen
pip install ".[online]"  # inkl. DNS/DKIM-Prüfung (dnspython, dkimpy)
```

Exit-Code: `0` unauffällig · `1` Auffälligkeiten · `2` starke Warnzeichen.

### So bekommst du eine Mail als .eml-Datei

Wichtig ist das **Original mit allen Headern** – eine weitergeleitete Mail oder
kopierter Text reicht nicht.

- **Gmail:** Mail öffnen → ⋮ → „Original anzeigen“ → „Original herunterladen“
- **Thunderbird:** Mail auswählen → „Speichern unter…“ → Datei (.eml)
- **Outlook, Apple Mail, GMX, WEB.DE u. a.:** Es gibt meist eine Funktion wie
  „Speichern unter“, „Herunterladen“ oder „Quelltext anzeigen“ – die genauen
  Menünamen unterscheiden sich je nach Version. Outlook-Desktop speichert oft als
  `.msg`; dieses Format wird hier (noch) nicht als Mail ausgewertet.

## Was geprüft wird

### E-Mails
| Bereich | Prüfungen |
|---|---|
| Authentifizierung | SPF, DKIM, DMARC aus dem obersten `Authentication-Results`-Header (nur dieser stammt sicher vom eigenen Mailanbieter) |
| Absender | Tippfehler-/Lookalike-Domains (`paypa1`, `arnazon`), Punycode/Homoglyphen, Marke nur in der Subdomain (`paypal.com.evil.ru`), fremde Adresse im Anzeigenamen, abweichendes Reply-To |
| Zustellweg | Received-Kette, Zeitstempel-Reihenfolge, Sendedatum vs. Empfang |
| Links | angezeigter Link ≠ tatsächliches Ziel, IP-Adressen, `@`-Trick, Kurzlinks, `javascript:`/`data:`-Links, Formulare |
| Inhalt | typische Druck-/Lockformulierungen, Abfrage von Passwort/TAN/IBAN |
| Anhänge | gefährliche und doppelte Endungen, Makro-Formate, Tarnung per Unicode – und jeder Anhang wird zusätzlich als Dokument geprüft |
| `--online` | SPF-/DMARC-Einträge im DNS, Existenz der Domain, eigene DKIM-Signaturprüfung |

### Dokumente
| Typ | Prüfungen |
|---|---|
| alle | SHA-256 (z. B. für eine Suche bei VirusTotal), Dateiendung passt zum tatsächlichen Inhalt? |
| PDF | Metadaten (Info + XMP), Erstell-/Änderungsdatum, Bearbeitungssoftware (z. B. Online-PDF-Editoren), Anzahl Speicherstände, mehrfach eingebettete Schrift-Teilmengen (Hinweis auf eingefügten Text), JavaScript/Launch/eingebettete Dateien, Signaturen und Änderungen *nach* dem Signieren |
| Word/Excel/PowerPoint (OOXML) | Autor/Bearbeiter, Datums-Plausibilität, Makros, ActiveX, eingebettete Objekte, externe Vorlagen (Remote-Template-Injection), nachverfolgte Änderungen, Kommentare |
| alte Office-Formate, RTF | Makros, Formel-Editor-Objekte, eingebettete Objekte |
| JPEG/PNG | EXIF (Kamera, Software, Aufnahme-/Änderungsdatum), Bildbearbeitungssoftware |
| ZIP | Inhalt, Passwortschutz, gefährliche Dateien |

## Grenzen (ehrlich)

- Die **kryptografische Gültigkeit von PDF-/Office-Signaturen** wird nicht geprüft –
  dafür z. B. das Signaturfenster in Adobe Acrobat Reader nutzen.
- Metadaten lassen sich fälschen oder entfernen; fehlende Hinweise sind kein Echtheitsnachweis.
- Die Erkennung von Lookalike-Domains nutzt eine begrenzte Markenliste
  (`echtheitspruefer/domains.py`, `MARKEN`) und eine vereinfachte Ermittlung der
  Hauptdomain (keine vollständige Public Suffix List).
- Inhaltliche Fälschungen (z. B. geänderte Beträge in einem sauber neu erzeugten PDF)
  sind technisch oft nicht erkennbar – dann hilft nur Rückfrage beim Aussteller.
- Kein Virenscanner: ein unauffälliges Ergebnis heißt nicht „virenfrei“.

## Tests

```bash
python -m unittest -v
```

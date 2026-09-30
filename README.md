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
python -m echtheitspruefer mail.eml                 # Mail-Datei
python -m echtheitspruefer rechnung.pdf foto.jpg    # Dokumente (inkl. Virenscan)
python -m echtheitspruefer                          # Mailtext einfügen, mit Strg+D beenden
python -m echtheitspruefer --text "Ihr Konto wurde gesperrt …"
python -m echtheitspruefer mail.eml --online        # + Abgleich mit aktuellen Datenbanken
python -m echtheitspruefer mail.eml --json          # maschinenlesbar
```

Optional installieren (dann gibt es den Befehl `echtheitspruefer`):

```bash
pip install .            # nur Standardfunktionen
pip install ".[online]"  # inkl. DNS/DKIM-Prüfung (dnspython, dkimpy)
```

Exit-Code: `0` unauffällig · `1` Auffälligkeiten · `2` starke Warnzeichen.

### Einstufung: Was für eine Mail ist das?

Neben den Einzelbefunden schlägt das Tool eine **Einstufung** vor – mit Begründung
und konkreter Empfehlung:

- Phishing (Datendiebstahl) · Schadsoftware-Verteilung
- Betrug: Paket-/Zustellmasche · Chef-/CEO-Masche · geänderte Bankverbindung ·
  Vorschuss/Erbschaft/Gewinn · Fake-Inkasso/Mahnung · Anlage/Krypto · Job/Finanzagent
- Erpressung (Sextortion) · Spam/Werbung · keine typische Masche erkannt

Die Einstufung ist regelbasiert (Formulierungen + technische Befunde) und kann irren.

### Eingefügter Text vs. Original-Mail

Einfach kopierter Mailtext reicht für Einstufung, Links und Absenderzeile. Aber: Ob
der Absender **echt** ist (SPF/DKIM/DMARC), lässt sich nur mit dem **Original inkl.
Kopfzeilen** prüfen, und beim Kopieren gehen die echten Ziele von Buttons oft verloren.
Am besten das Original einfügen bzw. als .eml speichern (siehe unten).

### Abgleich mit aktuellen Datenbanken (`--online`)

| Quelle | Prüft | Schlüssel nötig? |
|---|---|---|
| [Phishing.Database](https://github.com/Phishing-Database/Phishing.Database) | aktive Phishing-Domains | nein |
| URLhaus (abuse.ch) | aktive Schadsoftware-URLs | nein (Text-Feed) |
| VirusTotal | Links und Datei-Hashes (Ergebnis von ~70 Virenscannern) | ja: `VIRUSTOTAL_API_KEY` |
| Google Safe Browsing | Links (Phishing/Malware) | ja: `GOOGLE_SAFEBROWSING_KEY` |
| MalwareBazaar (abuse.ch) | Datei-Hashes | ja: `ABUSECH_AUTH_KEY` |

Die Listen werden in `~/.cache/echtheitspruefer` zwischengespeichert und alle 6 Stunden
erneuert. Für die Schlüssel-Dienste gibt es kostenlose Konten; Schlüssel als
Umgebungsvariable setzen, z. B. `export VIRUSTOTAL_API_KEY=...`.
Bei VirusTotal & Co. wird nur der **Hash** einer Datei abgefragt, nicht die Datei hochgeladen.

**Kein Treffer heißt nicht „sicher“** – neue Betrugsseiten sind oft erst nach Stunden gelistet.

### Virenscan von Dokumenten

Dokumente und Mail-Anhänge werden automatisch mit **ClamAV** gescannt, sofern installiert:

- Linux: `sudo apt install clamav && sudo freshclam`
- macOS: `brew install clamav` (danach `freshclam` einrichten)
- Windows: Installer von clamav.net, danach `freshclam` ausführen

Zusätzlich (mit `--online` und API-Schlüssel) wird der Hash bei VirusTotal/MalwareBazaar abgefragt.
Ohne ClamAV und ohne Schlüssel gibt es nur die eingebauten Strukturprüfungen (Makros,
JavaScript, getarnte Programme …) – das ist **kein** vollwertiger Virenscan.

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

## Browser-Version (`web/echtheitspruefer.js`)

JavaScript-Portierung für Web-Apps, läuft komplett lokal im Browser (kein Server nötig):

```html
<script src="echtheitspruefer.js"></script>
<script>
  const bericht = await Echtheitspruefer.pruefeMail(bytesOderText, 'mail.eml', { online: true });
  // auch: pruefeText(text, {online}), pruefeDokument(bytes, name, {online})
  console.log(bericht.alsText());   // Markdown-Bericht, z. B. als Kontext für Claude
</script>
```

Eigene Marken und Domains (z. B. der eigenen Bank) lassen sich mit `Echtheitspruefer.setEigene({ marken: 'meinebank', domains: 'meinebank.at' })`
festlegen: Diese Domains gelten als echt, ähnlich aussehende oder den Namen enthaltende Fremd-Domains werden gewarnt.
`Echtheitspruefer.getEigene()` liefert den aktuellen Stand. Die Python-Version kennt diese Einstellung noch nicht.

Unterschiede zur Python-Version: kein ClamAV/VirusTotal (im Browser nicht möglich), Datenbank-Abgleich
nur mit Phishing.Database (wird alle 6 Std. geladen und in IndexedDB zwischengespeichert), keine DNS-Abfragen.
Tests: `node tests/test_web.mjs`

## Grenzen (ehrlich)

- Die **kryptografische Gültigkeit von PDF-/Office-Signaturen** wird nicht geprüft –
  dafür z. B. das Signaturfenster in Adobe Acrobat Reader nutzen.
- Metadaten lassen sich fälschen oder entfernen; fehlende Hinweise sind kein Echtheitsnachweis.
- Die Erkennung von Lookalike-Domains nutzt eine begrenzte Markenliste
  (`echtheitspruefer/domains.py`, `MARKEN`) und eine vereinfachte Ermittlung der
  Hauptdomain (keine vollständige Public Suffix List).
- Inhaltliche Fälschungen (z. B. geänderte Beträge in einem sauber neu erzeugten PDF)
  sind technisch oft nicht erkennbar – dann hilft nur Rückfrage beim Aussteller.
- Auch mit ClamAV/VirusTotal gilt: Brandneue Schadsoftware wird oft noch nicht erkannt.

## Tests

```bash
python -m unittest -v
```

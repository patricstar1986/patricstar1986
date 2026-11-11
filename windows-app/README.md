# Musik für Windows

Ein Windows-Programm mit Installer für die [Musik-App](../musik-app/README.md). Das Fenster
lädt die Oberfläche bei jedem Start aus deinem Home Assistant (`/local/musik/`). Updates der
Oberfläche kommen damit automatisch an, sobald die Dateien in Home Assistant aktualisiert
sind. Ein neuer Installer ist nur nötig, wenn sich am Windows-Programm selbst etwas ändert.

**Voraussetzung:** Die Musik-App liegt in Home Assistant unter `/config/www/musik/`
(siehe Anleitung der Musik-App).

## Installieren

1. `Musik-Setup-<Version>.exe` herunterladen und doppelklicken.
2. Windows zeigt wahrscheinlich „Der Computer wurde durch Windows geschützt“, weil der
   Installer nicht mit einem gekauften Zertifikat signiert ist. Auf **„Weitere Informationen“**
   und dann **„Trotzdem ausführen“** klicken.
3. Die Installation läuft ohne weitere Fragen und nur für dein Benutzerkonto (keine
   Administratorrechte nötig). Danach gibt es „Musik“ im Startmenü und auf dem Desktop.
4. Beim ersten Start die Adresse von Home Assistant eintragen, z. B.
   `http://homeassistant.local:8123` oder die IP-Adresse. Optional zusätzlich die Adresse für
   unterwegs (Nabu Casa). Die App nimmt zuerst die Adresse zu Hause und sonst die für unterwegs.
5. Mit Home Assistant anmelden.

Entfernen: Windows-Einstellungen → Apps → „Musik“ → Deinstallieren.

## Was das Programm zusätzlich zur Web-App kann

- **Medientasten** der Tastatur (Wiedergabe/Pause, Weiter, Zurück) steuern den gewählten Player,
  auch wenn das Fenster im Hintergrund ist. Abschaltbar im Menü. Solange „Musik“ läuft und die
  Option an ist, bekommen andere Programme (z. B. Spotify) diese Tasten nicht.
- **Knöpfe in der Taskleisten-Vorschau** (Maus über das Symbol halten): Zurück, Wiedergabe/Pause, Weiter.
- **Ton ohne zusätzlichen Klick:** „Dieses Gerät“ spielt sofort, der erste Tipp wie im Browser entfällt.
- Fenstergröße und -position werden gemerkt. Das Programm startet nur einmal.

**Menü:** Die Menüleiste ist ausgeblendet und erscheint mit der **Alt-Taste**.

| Tasten | Funktion |
|---|---|
| Strg + , | Adressen ändern |
| F5 | Neu laden (probiert die Adressen neu durch) |
| Strg + P | Wiedergabe / Pause |
| Strg + → / ← | Nächster / vorheriger Titel |
| F11 | Vollbild |

## Gut zu wissen

- **Am PC hören:** In der Geräteliste „Dieses Gerät“ wählen. Der PC erscheint in Music Assistant
  als „Windows-PC (Musik-App)“. Über die Adresse zu Hause (`http://`) verbindet er sich direkt
  mit Music Assistant, über Nabu Casa nur mit einem Admin-Konto.
- **Anmeldung je Adresse:** Zu Hause und über Nabu Casa meldest du dich je einmal an.
- **Keine automatischen Updates** des Windows-Programms. Für eine neue Version den neuen
  Installer ausführen, er ersetzt die alte.
- Fremde Internetseiten öffnet das Programm nie im eigenen Fenster, sondern im Standardbrowser.
- Die Einstellungen liegen in `%APPDATA%\Musik\einstellungen.json`.

## Selbst bauen

```bash
cd windows-app
npm install
npm start          # zum Ausprobieren
npm run dist       # Installer nach dist/Musik-Setup-<Version>.exe
```

Unter Windows genügt das. Unter Linux braucht `npm run dist` zusätzlich `wine` und `wine32`.

Bei jeder Änderung in diesem Ordner baut GitHub den Installer auf einem echten
Windows-Rechner, lässt die Tests laufen und installiert ihn zur Probe
(`.github/workflows/windows-app.yml`). Der fertige Installer hängt dann unter
*Actions → Windows-App → letzter Lauf → Artifacts*.

Tests (brauchen `npm install` hier und in `tests/musik-app`, außerdem Playwright):

```bash
node test/test.mjs                 # Windows
xvfb-run -a node test/test.mjs     # Linux ohne Bildschirm
```

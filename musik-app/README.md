# Musik – App für Music Assistant (über Home Assistant)

Eine Web-App (PWA) für **iPhone, iPad und Windows**, mit der du den Music Assistant
steuerst, der in deinem Home Assistant eingebunden ist. Sie braucht keinen App Store und
keinen Mac und läuft direkt aus deinem Home Assistant heraus.

**Funktionen**

- **Läuft gerade:** Cover, Titel, Fortschritt (antippen zum Springen), Wiedergabe/Pause,
  Zurück/Weiter, Zufall, Wiederholen, Lautstärke, Stumm und Ein/Aus (nur bei Playern, die das können)
- **Player wählen:** Es werden nur die Music-Assistant-Player angezeigt. Die App wählt
  automatisch den, der gerade spielt.
- **Bibliothek:** Playlists, Alben, Künstler, Titel, Radio, Podcasts und Hörbücher. Mit
  Filter, Sortierung und Favoriten. Alben und Playlists zeigen ihre Titel, Künstler ihre Alben.
- **Suche** in der Bibliothek und bei deinen Musikdiensten, auf Wunsch nur in der Bibliothek
- **Abspielen-Optionen** (⋮): Jetzt abspielen, Warteschlange ersetzen, Als Nächstes,
  Zur Warteschlange hinzufügen, Radio-Modus
- Die Verbindung wird automatisch wiederhergestellt, z. B. nach dem Entsperren des iPhones.
- Die App passt sich dem hellen bzw. dunklen Modus des Geräts an.

Die App spricht nur mit Home Assistant (WebSocket-API) und nutzt dessen Dienste
`music_assistant.get_library`, `music_assistant.search`, `music_assistant.play_media` und
`media_player.*`. Es werden keine Daten an andere Server geschickt. Ausnahme: Cover-Bilder,
die der Music Assistant als Internet-Adresse liefert (z. B. von Apple Music), lädt das Gerät
direkt von dort.

## Installation (ca. 5 Minuten)

### 1. Dateien nach Home Assistant kopieren

Kopiere den **Inhalt** dieses Ordners `musik-app/` nach `/config/www/musik/` in Home Assistant.
Dafür eignen sich z. B. die Apps (früher „Add-ons“) **Samba share**, **File editor** oder
**Studio Code Server**.

Danach sollte es so aussehen:

```
/config/www/musik/index.html
/config/www/musik/app.js
/config/www/musik/ha.js
/config/www/musik/style.css
/config/www/musik/sw.js
/config/www/musik/manifest.webmanifest
/config/www/musik/icons/…
```

> Falls es den Ordner `/config/www` vorher **noch nicht gab**, musst du Home Assistant einmal
> **neu starten**. Erst danach liefert Home Assistant den Ordner unter `/local/` aus.

### 2. Öffnen und anmelden

Öffne im Browser:

```
http://<adresse-von-home-assistant>:8123/local/musik/index.html
```

Ein Beispiel ist `http://homeassistant.local:8123/local/musik/index.html`. Statt
`homeassistant.local` geht auch die IP-Adresse deines Home Assistant.

Tippe auf **„Mit Home Assistant anmelden“**. Es erscheint die normale Anmeldeseite von
Home Assistant. Danach bist du in der App.

### 3. Als App auf den Startbildschirm legen

- **iPhone/iPad:** In **Safari** öffnen, auf **Teilen** tippen und dann **„Zum Home-Bildschirm“**
  wählen. Danach startet die App ohne Adressleiste.
- **Windows:** In **Edge** oder **Chrome** öffnen und im Menü (⋯) die App installieren:
  - Edge: „Apps“ → „Diese Website als App installieren“
  - Chrome: „Streamen, speichern und teilen“ → „Seite als App installieren“ bzw. „Verknüpfung erstellen…“
    mit dem Häkchen bei „Als Fenster öffnen“

  Wie diese Menüpunkte genau heißen, hängt von der Browser-Version ab. Über eine reine
  `http://`-Adresse bieten manche Versionen nur „Verknüpfung erstellen“ an. Das funktioniert
  genauso, nur ohne Offline-Zwischenspeicher.

### Von unterwegs

Wenn dein Home Assistant von außen erreichbar ist (z. B. über Home Assistant Cloud /
Nabu Casa), nutze dieselbe Adresse wie für Home Assistant, z. B.
`https://xxxx.ui.nabu.casa/local/musik/index.html`. Melde dich dort einmal an.

Einschränkung: Der Music Assistant liefert manche Cover als Adresse im Heimnetz
(`http://10.0.1.112:8095/imageproxy/…`). Unterwegs oder über `https` laden diese Bilder nicht,
die App zeigt dann einen Platzhalter. Steuerung, Bibliothek und Suche funktionieren trotzdem.
Das Cover unter „Läuft gerade“ kommt über Home Assistant und funktioniert auch unterwegs.

## Anmeldung mit Token (Alternative)

Falls die Anmeldung über die Anmeldeseite nicht klappt, gibt es eine Alternative. Das kann
z. B. passieren, wenn die App nicht über Home Assistant selbst ausgeliefert wird.

1. Home Assistant → dein Profil (unten links) → **Sicherheit** → **Langlebige Zugriffstoken** →
   **Token erstellen**
2. In der App „Stattdessen mit Token anmelden“ aufklappen, Adresse und Token eintragen.

Das Token wird nur im Browser bzw. in der App auf dem Gerät gespeichert. Über
**Einstellungen → Abmelden** wird es dort gelöscht. In Home Assistant kannst du es jederzeit
widerrufen.

## Häufige Probleme

| Problem | Lösung |
|---|---|
| Seite nicht gefunden (404) | Liegen die Dateien in `/config/www/musik/`? Gab es `www` vorher nicht, Home Assistant neu starten. |
| „Kein Music-Assistant-Player gefunden“ | Läuft der Music Assistant und ist die Integration unter *Einstellungen → Geräte & Dienste* geladen? |
| Bibliothek: „Integration wurde nicht gefunden“ | Die automatische Erkennung hat nicht geklappt (möglich z. B. bei Benutzern ohne Admin-Rechte). Dann die ID unter *Einstellungen (Zahnrad)* eintragen. Du findest sie in Home Assistant unter *Einstellungen → Geräte & Dienste → Music Assistant*, in der Browser-Adresse hinter `config_entry=`. |
| Anmeldung in der Startbildschirm-App auf dem iPhone hängt | Mit Token anmelden (siehe oben). |
| Hinweis „https / http“ auf der Anmeldeseite | Die App wurde über `https` geöffnet, Home Assistant läuft aber über `http`. Die App über dieselbe Adresse wie Home Assistant öffnen. |

## Sicherheit

- Alles in `/config/www` ist **ohne Anmeldung** abrufbar. Die App-Dateien enthalten aber
  keine Zugangsdaten. Die gibt es erst nach der Anmeldung, und sie bleiben auf deinem Gerät.
- Die App kann nur, was dein Home-Assistant-Benutzer darf.

## Was (noch) nicht drin ist

- Anzeige und Bearbeitung der Warteschlange
- Player gruppieren / Multiroom
- Steuerung auf dem Sperrbildschirm (iOS zeigt dort nur Wiedergabe, die auf dem Gerät selbst läuft)
- Eine „echte“ App aus dem App Store bzw. Microsoft Store

## Updates

Neue Dateien einfach wieder nach `/config/www/musik/` kopieren. Lädt das iPhone noch die alte
Version, die App einmal ganz schließen (App-Umschalter, nach oben wischen) und neu öffnen.

## Entwicklung und Tests

Die Tests laufen mit einem nachgebauten Home Assistant im Browser (Playwright):

```bash
cd tests/musik-app
npm install
node test.mjs            # automatische Tests
node mock-ha.mjs         # Test-Server zum Ausprobieren: http://localhost:8123/local/musik/index.html
```

# Musik – App für Music Assistant (über Home Assistant)

Eine Web-App (PWA) für **iPhone, iPad und Windows**. Du steuerst damit den Music Assistant,
der in deinem Home Assistant eingebunden ist, und kannst die Musik auch **direkt am Handy
oder PC hören**. Sie braucht keinen App Store und keinen Mac und läuft direkt aus deinem
Home Assistant heraus.

Der Aufbau folgt dem, was man von Musik-Apps kennt: unten eine schwebende Leiste mit **Startseite / Radio / Mediathek / Suchen**,
darüber der Mini-Player, und ein Tipp darauf öffnet die große Wiedergabe-Ansicht.

## Funktionen

- **Startseite:** große Kacheln und Reihen. Mit direktem Draht zu Music Assistant (siehe unten) kommen
  die **Empfehlungen deiner Musikdienste** und Reihen wie „Zuletzt gespielt“ oder „Vergessene Alben“ dazu.
  Außerdem „Neueste Alben“ (nach Erscheinungsjahr, aus deiner Mediathek) und Radiosender.
- **Stöbern:** In „Suchen“ (am PC: „Entdecken“) stehen Kacheln für Musikrichtungen. Ein Tipp zeigt
  Playlists, Beispiel-Interpreten und Alben dazu, von deinen Musikdiensten und aus deiner Mediathek.
- **Radio:** eigener Bereich mit deinen Sendern.
- **Suchen** in der Mediathek und bei deinen Musikdiensten, auf Wunsch nur in der Mediathek.
- **Mediathek:** Playlists, Alben, Künstler, Titel, Radio, Podcasts und Hörbücher. Mit Filter,
  Sortierung und Favoriten. Alben und Playlists zeigen ihre Titel, Künstler ihre Alben.
- **Wiedergabe-Ansicht:** Cover, Fortschritt (antippen zum Springen), Wiedergabe/Pause,
  Zurück/Weiter, Zufall, Wiederholen, Lautstärke und Stumm.
- **Geräte:** Lautsprecher wählen, laufende Musik auf ein anderes Gerät mitnehmen,
  mehrere Lautsprecher **gruppieren** (mit Lautstärke je Raum).
- **Dieses Gerät:** Das Handy bzw. der PC wird selbst zum Lautsprecher (siehe unten).
- **Warteschlange:** mit direktem Draht zu Music Assistant die ganze Liste (Titel anspringen, entfernen),
  sonst aktueller und nächster Titel. Dazu Zufall und Leeren.
- **Autoplay (∞):** Wenn die Warteschlange zu Ende ist, spielt Music Assistant passende Titel weiter.
  Der Knopf sitzt in der Wiedergabe-Ansicht und in der Warteschlange (nur mit direktem Draht).
- **Reihen blättern:** Am PC erscheinen an jeder Reihe Pfeile links und rechts, sobald die Maus darüber ist.
- **Am PC** (breites Fenster): Seitenleiste mit Suche, Mediathek und deinen Playlists, Wiedergabeleiste oben.
- **Abspielen-Optionen** (⋮): Jetzt abspielen, Warteschlange ersetzen, Als Nächstes,
  Zur Warteschlange hinzufügen, Radio starten.
- Die Verbindung wird automatisch wiederhergestellt, z. B. nach dem Entsperren des iPhones.
- Die App passt sich dem hellen bzw. dunklen Modus des Geräts an.

Die App spricht nur mit deinem Home Assistant und deinem Music Assistant. Es werden keine
Daten an andere Server geschickt. Ausnahme: Cover-Bilder, die der Music Assistant als
Internet-Adresse liefert (z. B. von Apple Music), lädt das Gerät direkt von dort.

## Installation (ca. 5 Minuten)

### 1. Dateien nach Home Assistant kopieren

Kopiere den **Inhalt** dieses Ordners `musik-app/` (mit den Unterordnern `icons` und `vendor`)
nach `/config/www/musik/` in Home Assistant. Dafür eignen sich z. B. die Apps (früher
„Add-ons“) **Samba share**, **File editor** oder **Studio Code Server**.

Danach sollte es so aussehen:

```
/config/www/musik/index.html
/config/www/musik/app.js
/config/www/musik/ha.js
/config/www/musik/local.js
/config/www/musik/ingress.js
/config/www/musik/ma.js
/config/www/musik/style.css
/config/www/musik/sw.js
/config/www/musik/manifest.webmanifest
/config/www/musik/icons/…
/config/www/musik/vendor/sendspin.js
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

## Musik direkt am Handy oder PC hören („Dieses Gerät“)

**Das ist der Standard:** Beim Start meldet die App das Gerät, auf dem sie läuft, bei Music
Assistant als Lautsprecher an und wählt es als Wiedergabegerät. Du suchst Musik aus, und sie
spielt auf dem Gerät, das du in der Hand hast.

- Beim **ersten Mal** dauert es etwa 20 Sekunden, bis Music Assistant das neue Gerät an
  Home Assistant weitergegeben hat. So lange ist noch ein anderer Lautsprecher gewählt.
- Einen anderen Lautsprecher wählst du über das Geräte-Feld oben rechts. Beim nächsten Start
  ist wieder dieses Gerät gewählt.
- Mit **„Aus“** in der Geräteliste schaltest du das ab, auch für künftige Starts. Wieder
  einschalten: „Dieses Gerät“ antippen oder in den Einstellungen (Zahnrad) den Haken bei
  „Beim Start immer dieses Gerät als Wiedergabegerät wählen“ setzen.
- Klappt die Verbindung nicht (z. B. ohne Admin-Konto über `https`), bleibt einfach ein
  anderer Lautsprecher gewählt. Den Grund zeigt die Geräteliste unter „Dieses Gerät“.

**So funktioniert es:** Music Assistant kann Geräte über das Protokoll „Sendspin“ als
Lautsprecher einbinden (geprüft mit Version 2.10.9). Die App nutzt dafür dieselbe Bibliothek wie die
Oberfläche von Music Assistant (`sendspin-js` 5.0.0, liegt im Ordner `vendor/`). Das Handy
erscheint danach in Music Assistant und Home Assistant als neuer Player mit dem Namen
z. B. „iPhone (Musik-App)“. Den Namen kannst du in den Einstellungen (Zahnrad) ändern. Das ist
nötig, wenn zwei gleichartige Geräte die App nutzen, denn die App erkennt ihr Gerät am Namen.

**Zwei Verbindungswege, die App probiert sie der Reihe nach:**

| Weg | Wann | Voraussetzung |
|---|---|---|
| direkt zu Music Assistant (Port 8927) | App über `http://` im Heimnetz geöffnet | Handy und Music Assistant im selben Netz |
| über Home Assistant (Ingress) | sonst, auch über `https://` und von unterwegs | Anmeldung mit einem **Admin-Konto** von Home Assistant |

**Was du wissen solltest:**

- **Der erste Ton braucht einen Tipp.** Browser erlauben Ton erst nach einer Berührung. Wenn es
  nach dem Öffnen der App stumm bleibt, einmal auf Wiedergabe tippen.
- **Gesperrter Bildschirm (iPhone):** Ob die Musik bei gesperrtem Bildschirm oder im Hintergrund
  zuverlässig weiterläuft, ist nicht gesichert. Das hängt von iOS ab und konnte hier nicht auf
  einem echten iPhone getestet werden. Wenn sie aussetzt, die App wieder nach vorne holen.
- **Datenmenge:** In Safari über `http://` überträgt Music Assistant unkomprimierten Ton
  (etwa 1,4 Mbit/s bei CD-Qualität). Im WLAN ist das unproblematisch.
- **Erscheint „Dieses Gerät“ nicht in Home Assistant?** Dann in Music Assistant unter
  *Einstellungen → Player* nachsehen, ob das Gerät dort auftaucht und aktiviert ist.

## Direkter Draht zu Music Assistant (Empfehlungen, Stöbern, volle Warteschlange)

Home Assistant gibt von Music Assistant nur die Mediathek und die Suche weiter. Empfehlungen,
Musikrichtungen und die vollständige Warteschlange holt die App deshalb direkt bei Music Assistant
ab, über denselben Weg wie „Dieses Gerät“ (Home-Assistant-Ingress).

**Voraussetzungen:** Die App ist aus Home Assistant geöffnet (`/local/musik/`, lokal oder über
Nabu Casa) und du bist mit einem **Admin-Konto** angemeldet. Ob die Verbindung steht, zeigen die
Einstellungen (Zahnrad) unter „Empfehlungen und volle Warteschlange“.

Ohne diese Verbindung läuft die App wie bisher mit den Reihen aus Home Assistant. Stöbern nach
Musikrichtung funktioniert dann trotzdem, zeigt aber nur die Treffer der Musikdienste.

Als Nebeneffekt laden über `https` (Nabu Casa) dann auch die Cover, die Music Assistant nur mit
einer Heimnetz-Adresse liefert.

**Was es nicht gibt:** Welche Empfehlungen erscheinen, bestimmt Music Assistant. Für Apple Music
sind das nach dem Quellcode von Version 2.10.9 die persönlichen Sender und Mixe, keine
Neuerscheinungen. Eine echte Liste „wer hat gerade ein neues Album“ bietet Music Assistant nicht an.
„Neueste Alben“ zeigt deshalb nur Alben aus deiner Mediathek, sortiert nach Erscheinungsjahr.

## Warteschlange und Gruppieren

- **Autoplay:** Das ∞-Symbol schaltet für das gewählte Gerät ein, dass nach dem letzten Titel passende
  Musik weiterläuft. Welche Titel das sind, bestimmt Music Assistant zusammen mit deinem Musikdienst.
  Die Einstellung gilt je Gerät und bleibt in Music Assistant gespeichert.

- **Warteschlange:** Mit dem direkten Draht siehst du die ganze Liste ab dem aktuellen Titel, kannst
  Titel anspringen und entfernen. Ohne ihn gibt Home Assistant nur den aktuellen und den nächsten
  Titel weiter.
- **Gruppieren:** In der Geräteliste steht hinter jedem passenden Lautsprecher ein **＋**. Damit
  spielt er dasselbe wie das gerade gewählte Gerät. Ein Tipp auf das Häkchen löst ihn wieder.
  Welche Lautsprecher sich miteinander gruppieren lassen, bestimmt Music Assistant.
- **Wiedergabe mitnehmen:** Wenn du ein anderes Gerät wählst, während noch Musik läuft, bietet
  die App unten „Hierher holen“ an.

## Von unterwegs

Wenn dein Home Assistant von außen erreichbar ist (z. B. über Home Assistant Cloud /
Nabu Casa), nutze dieselbe Adresse wie für Home Assistant, z. B.
`https://xxxx.ui.nabu.casa/local/musik/index.html`. Melde dich dort einmal an.

Einschränkung: Der Music Assistant liefert manche Cover als Adresse im Heimnetz
(`http://…:8095/imageproxy/…`). Unterwegs oder über `https` laden diese Bilder nicht,
die App zeigt dann einen Platzhalter. Steuerung, Bibliothek und Suche funktionieren trotzdem.
Das Cover in der Wiedergabe-Ansicht kommt über Home Assistant und funktioniert auch unterwegs.

## Anmeldung mit Token (Alternative)

Falls die Anmeldung über die Anmeldeseite nicht klappt, gibt es eine Alternative. Das kann
z. B. in der Startbildschirm-App auf dem iPhone passieren.

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
| Startseite/Mediathek: „Integration wurde nicht gefunden“ | Die automatische Erkennung hat nicht geklappt (möglich z. B. bei Benutzern ohne Admin-Rechte). Dann die ID unter *Einstellungen (Zahnrad)* eintragen. Du findest sie in Home Assistant unter *Einstellungen → Geräte & Dienste → Music Assistant*, in der Browser-Adresse hinter `config_entry=`. |
| „Dieses Gerät“: Verbindung fehlgeschlagen | Die Meldung unter dem Eintrag nennt den Grund. Im Heimnetz die App über `http://` öffnen oder mit einem Admin-Konto anmelden. Hat Music Assistant eine andere Adresse als Home Assistant, diese in den Einstellungen eintragen. |
| „Dieses Gerät“ ist verbunden, aber stumm | Einmal auf Wiedergabe tippen. Lautstärke des Geräts und den Stumm-Schalter am iPhone prüfen. |
| Anmeldung in der Startbildschirm-App auf dem iPhone hängt | Mit Token anmelden (siehe oben). |
| Hinweis „https / http“ auf der Anmeldeseite | Die App wurde über `https` geöffnet, Home Assistant läuft aber über `http`. Die App über dieselbe Adresse wie Home Assistant öffnen. |
| Nach einem Update sieht die App aus wie vorher | Die App ganz schließen (App-Umschalter, nach oben wischen) und neu öffnen. Im Browser die Seite neu laden. |

## Sicherheit

- Alles in `/config/www` ist **ohne Anmeldung** abrufbar. Die App-Dateien enthalten aber
  keine Zugangsdaten. Die gibt es erst nach der Anmeldung, und sie bleiben auf deinem Gerät.
- Die App kann nur, was dein Home-Assistant-Benutzer darf.
- „Dieses Gerät“ verbindet sich ohne Kopplung mit Music Assistant (Gastzugang von Sendspin).
  Die Verbindung ist verschlüsselt, aber nicht gegen einen Angreifer im eigenen Netz
  abgesichert, der sich aktiv dazwischenschaltet. Für Musik im Heimnetz ist das üblich.

## Was (noch) nicht drin ist

- Warteschlange umsortieren per Ziehen
- Neuerscheinungen der Musikdienste (bietet Music Assistant nicht an)
- Favoriten setzen und Playlists bearbeiten
- Eine „echte“ App aus dem App Store bzw. Microsoft Store

## Updates

Neue Dateien einfach wieder nach `/config/www/musik/` kopieren und die App neu öffnen.

## Entwicklung und Tests

Die Tests laufen mit einem nachgebauten Home Assistant im Browser (Playwright):

```bash
cd tests/musik-app
npm install
node test.mjs            # automatische Tests
node mock-ha.mjs         # Test-Server zum Ausprobieren: http://localhost:8123/local/musik/index.html
```

Die Schnittstelle von Music Assistant (Empfehlungen, Musikrichtungen, Warteschlange) ist im
Test-Server nach dem Quellcode von Music Assistant 2.10.9 nachgebaut. Gegen einen echten
Music-Assistant-Server wurde dieser Teil nicht getestet.

In den automatischen Tests ersetzt eine Attrappe die Sendspin-Bibliothek. Die echte Bibliothek
wurde getrennt gegen einen echten Sendspin-Server geprüft (`aiosendspin` 10.2.1, dieselbe
Version wie in Music Assistant 2.10.9): Anmeldung, Verschlüsselung und Freischaltung als
Abspielgerät. Fremdsoftware und Lizenzen: siehe `vendor/LIZENZEN.md`.

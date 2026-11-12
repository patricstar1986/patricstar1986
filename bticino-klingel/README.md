# BTicino Classe 300X → Home Assistant (Klingel-Erkennung)

Gerät: BTicino Classe 300X, Art.-Nr. 344642, Firmware 3.0.6, Door-Entry-App.
Cloud-Integrationen und Root-basierte Integrationen passen zu dieser Konstellation
nicht (siehe Gesprächsverlauf). Deshalb wird das Klingelsignal per Hardware abgegriffen.

## Klemmen auf der Rückseite (von links nach rechts)

| Block | Prägung | Bedeutung | Quelle |
|---|---|---|---|
| 1 | `1` `5M` | Zusatzläutwerk (zusätzlicher Klingelton) | Installationshandbuch 344642 |
| 2 | Taster-Symbol | Etagenruf-Taster (Klingeltaster an der Wohnungstür) – Eingang | Installationshandbuch |
| 3 | `BUS` | 2-Draht-SCS-BUS (hier hängen blau/schwarz) | Foto + Handbuch |
| 4 | `1` `2` | Zusatzversorgung 27 V DC (unbelegt) | Handbuch |

Jumper: `JMP` in J1/J2. Laut BTicino-Unterlagen heißt J1 gesteckt „Zusatzversorgung
deaktiviert“. Das passt zur Anzeige „Stromversorgung: Deaktiviert“.
Konfigurator `1` steckt in N, das passt zur Anzeige N=01, P=00, M=00.
**Nichts davon ändern.**

## Schritt 1: Messen (Pflicht, bevor etwas angeschlossen wird)

Die elektrischen Werte des Ausgangs 1–5M habe ich **nicht** gesichert gefunden.
Sie müssen gemessen werden:

1. Multimeter auf **DC V**, Messspitzen an `1` (COM) und `5M`.
2. Ruhezustand ablesen.
3. Jemand klingelt unten an der Tür → Wert ablesen.
4. Dasselbe mit **AC V** wiederholen. Der Ausgang könnte ein Wechsel- oder
   Pulssignal liefern.

Werte notieren: Ruhe DC / Ruhe AC / Klingeln DC / Klingeln AC.

## Schritt 2: Schaltung (galvanisch getrennt)

```
 Klemme 5M ──[ R 4,7 kΩ ]──┬──── Optokoppler LED-Eingang (Pin 1)
                           │
 Klemme 1  ────────────────┴──── Optokoppler LED-Eingang (Pin 2)

 Optokoppler Ausgang:  Kollektor ── ESP32 GPIO27
                       Emitter   ── ESP32 GND
```

- **Optokoppler PC814 oder H11AA1** (AC-Eingang, polaritätsunabhängig). So funktioniert
  die Schaltung bei DC und bei AC. Mit einem PC817 (nur DC) muss die Polarität stimmen,
  und eine 1N4148 gehört antiparallel zur LED.
- R = 4,7 kΩ ist für ca. 12–30 V ausgelegt (≈ 2,5–6 mA). Liegt der Messwert deutlich
  darunter, den Widerstand anpassen: R ≈ (U − 1,2 V) / 3 mA.
- Der ESP32 bekommt **ein eigenes USB-Netzteil**. Er wird nicht aus der Sprechanlage
  versorgt.
- Der ESP32 hat keine elektrische Verbindung zum BUS. Die Trennung macht der Optokoppler.

Annahme: Der Ausgang verträgt die kleine Last (wenige mA), weil er für ein
Zusatzläutwerk gedacht ist. Das ist nicht vom Hersteller bestätigt.

## Schritt 3: ESPHome

`klingel-esp32.yaml` in ESPHome (Add-on) übernehmen, `secrets.yaml` ergänzen, flashen.
In Home Assistant erscheinen:

- `binary_sensor.bticino_klingel_klingel_aktiv` (an, solange es klingelt)
- `event.bticino_klingel_klingel` (Türklingel-Ereignis)

## Schritt 4: Automation (Beispiel)

```yaml
alias: Klingel – Push aufs Handy
triggers:
  - trigger: state
    entity_id: event.bticino_klingel_klingel
conditions:
  - condition: template
    value_template: "{{ trigger.from_state.state not in ['unavailable', 'unknown'] }}"
actions:
  - action: notify.mobile_app_DEIN_IPHONE
    data:
      title: Es klingelt
      message: Jemand steht vor der Tür.
mode: single
```

`notify.mobile_app_DEIN_IPHONE` durch den eigenen Notify-Dienst ersetzen.

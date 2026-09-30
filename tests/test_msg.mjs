// Tests für Outlook-.msg (node tests/test_msg.mjs). Benötigt: npm install xlsx (nur für die Tests).
import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let CFB;
try { CFB = require('xlsx').CFB; } catch (e) { console.log('übersprungen: bitte "npm install xlsx" ausführen'); process.exit(0); }
require('../web/echtheitspruefer.js');
const { testNachrichten } = require('./msg_bauen.cjs');
const E = globalThis.Echtheitspruefer;
const t = testNachrichten();
const bytes = (k) => new Uint8Array(t[k]);
const texte = (b) => JSON.stringify(b.toJSON());
let ok = 0;
const test = async (name, fn) => { await fn(); ok++; console.log('✔', name); };

await test('unauffällige externe Mail mit PDF-Anhang', async () => {
  const b = await E.pruefeMsg(bytes('extern_ok'), 'extern_ok.msg', { CFB });
  assert(['ok', 'info', 'niedrig'].includes(b.hoechsteStufe()), b.alsText());
  assert(texte(b).includes('DMARC bestanden') && texte(b).includes('Kontoauszug.pdf'));
});
await test('Phishing-Mail (ANSI, DMARC-Fehler, getarnter Link, doppelte Endung)', async () => {
  const b = await E.pruefeMsg(bytes('phishing'), 'phishing.msg', { CFB });
  assert.equal(b.hoechsteStufe(), 'hoch');
  for (const s of ['DMARC FEHLGESCHLAGEN', "in Wahrheit zu '203.0.113.5'", 'Rechnung.pdf.exe', 'Anzeigename zeigt die Adresse']) assert(texte(b).includes(s), s);
});
await test('Umlaute aus ANSI (cp1252) kommen richtig an', () => {
  const eml = E.msgZuEml(bytes('phishing'), CFB).eml;
  const teil = E._intern.parseTeil(eml); const blaetter = []; (function w(x) { if (x.teile) x.teile.forEach(w); else blaetter.push(x); })(teil);
  assert(new TextDecoder().decode(blaetter.find(x => x.typ === 'text/plain').bytes).includes('(Prüfung)'));
});
await test('interne Mail: nur komprimierter RTF-Text, keine Internet-Kopfzeilen', async () => {
  const erg = E.msgZuEml(bytes('intern'), CFB);
  assert.equal(erg.hatKopfzeilen, false); assert(erg.senderIntern);
  const teil = E._intern.parseTeil(erg.eml);
  assert.equal(new TextDecoder().decode(teil.bytes), 'Hallo Welt\nZweite Zeile mit ü (ue) und Euro €.\nEnde');
  const b = await E.pruefeMsg(bytes('intern'), 'intern.msg', { CFB });
  assert(['ok', 'info', 'niedrig'].includes(b.hoechsteStufe()), b.alsText());
  assert.equal(b.details['Einstufung'], 'Keine typische Betrugsmasche erkannt');
});
await test('eingebettete Nachricht wird als Anhang geprüft', async () => {
  const b = await E.pruefeMsg(bytes('mit_eingebetteter'), 'fw.msg', { CFB });
  const u = b.unterberichte.find(x => x.datei === 'Dringend.eml');
  assert(u && u.hoechsteStufe() === 'hoch');
  assert(b.unterberichte.some(x => x.datei === 'logo.png'));
});
await test('defekte oder falsche Dateien ergeben eine Meldung statt eines Absturzes', async () => {
  for (const k of ['kaputt', 'kein_msg']) {
    const b = await E.pruefeMsg(bytes(k), k + '.msg', { CFB });
    assert.equal(b.hoechsteStufe(), 'mittel'); assert(b.befunde[0].text.includes('konnte nicht gelesen werden'));
  }
});
console.log(`\n${ok} Tests bestanden`);

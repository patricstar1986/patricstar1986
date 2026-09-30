// Tests der Browser-Version (läuft mit Node ≥ 18): node tests/test_web.mjs
import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('../web/echtheitspruefer.js');
const E = globalThis.Echtheitspruefer;

const PHISH = `Received: from mx.example.net (mx.example.net [192.0.2.10])
 by mail.empfaenger.de; Mon, 28 Sep 2026 10:00:05 +0200
Authentication-Results: mail.empfaenger.de; spf=fail smtp.mailfrom=paypa1-service.com;
 dkim=none; dmarc=fail header.from=paypa1-service.com
From: "PayPal Kundenservice service@paypal.de" <info@paypa1-service.com>
Reply-To: hilfe@irgendwo.ru
Subject: Dringend: Ihr Konto wurde gesperrt
Date: Mon, 28 Sep 2026 10:00:00 +0200
Message-ID: <x@paypa1-service.com>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: text/html; charset=utf-8

<p>Bitte verifizieren Sie Ihr Konto sofort:
<a href="http://203.0.113.5/login">https://www.paypal.de/login</a></p>
--B
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="Rechnung.pdf.exe"
Content-Transfer-Encoding: base64

TVqQAAMAAAAEAAAA
--B--
`;
const ECHT = `Received: from out.paypal.de (out.paypal.de [198.51.100.7]) by mx.example.net; Mon, 28 Sep 2026 10:00:02 +0200
Authentication-Results: mx; spf=pass smtp.mailfrom=paypal.de; dkim=pass header.d=paypal.de; dmarc=pass header.from=paypal.de
From: PayPal <service@paypal.de>
Reply-To: Kunde <kunde@gmail.c...>
Subject: Ihr Kontoauszug
Date: Mon, 28 Sep 2026 10:00:00 +0200
Content-Type: text/html; charset=utf-8

<p>Ihr Auszug: <a href="https://www.paypal.de/konto">www.paypal.de</a></p>
`;
const liste = new Set(['boese-bank-login.com']);
let ok = 0;
const test = async (name, fn) => { await fn(); ok++; console.log('✔', name); };

await test('Phishing-Mail', async () => {
  const b = await E.pruefeMail(PHISH, 'p.eml', { online: true, phishingListe: liste });
  const t = JSON.stringify(b.toJSON());
  assert.equal(b.hoechsteStufe(), 'hoch');
  for (const s of ['DMARC FEHLGESCHLAGEN', "in Wahrheit zu '203.0.113.5'", 'Rechnung.pdf.exe', 'ausführbares Programm', 'Anzeigename zeigt die Adresse']) assert(t.includes(s), s);
  const alle = b.details['Einstufung'] + ' ' + (b.details['Weitere mögliche Einstufungen'] || []).join(' ');
  assert.match(alle, /Schadsoftware/); assert.match(alle, /Phishing/);
});
await test('Echte Mail (inkl. abgekürzter Reply-To-Adresse) unauffällig', async () => {
  const b = await E.pruefeMail(ECHT, 'e.eml');
  assert(['ok', 'info', 'niedrig'].includes(b.hoechsteStufe()), b.alsText());
});
await test('Chef-Masche als Text', async () => {
  const b = await E.pruefeText('Von: Chef <chef.firma@gmail.com>\nSind Sie am Platz? Ich sitze gerade in einem Meeting. Bitte vertraulich eine Überweisung ausführen oder Google Play Gutscheine kaufen.');
  assert.match(b.details['Einstufung'], /Chef/);
});
await test('Phishing-Datenbank', async () => {
  const b = await E.pruefeText('Hier anmelden: https://login.boese-bank-login.com/', { online: true, phishingListe: liste });
  assert(JSON.stringify(b.toJSON()).includes('PHISHING-Seite'));
});
await test('Getarnte EXE als JPG', async () => {
  const b = await E.pruefeDokument(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), 'foto.jpg');
  assert.equal(b.hoechsteStufe(), 'hoch');
});
await test('Lookalikes', async () => {
  const L = E._intern.lookalike;
  assert(L('paypa1.com').length && L('paypal.com.evil.ru').length && L('arnazon.de').length);
  assert(!L('paypal.de').length && !L('host.de').length && !L('amazonaws.com').length);
});
await test('Bericht entschärft HTML', async () => {
  const b = await E.pruefeText('Von: X <a@b.de>\n<a href="https://evil.example/"><img src=x onerror=alert(1)>www.bank.de</a>');
  assert(!b.alsText().includes('<img'));
});
await test('VirusTotal: Treffer, unbekannt, blockiert', async () => {
  const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]);
  const echt = globalThis.fetch;
  try {
    globalThis.fetch = async (u, o) => { assert.equal(o.headers['x-apikey'], 'K'); return new Response(JSON.stringify({ data: { attributes: { last_analysis_stats: { malicious: 30, undetected: 10 } } } }), { status: 200 }); };
    let b = await E.pruefeDokument(pdf, 'x.pdf', { virustotalKey: 'K' });
    assert.equal(b.hoechsteStufe(), 'hoch');
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    b = await E.pruefeDokument(pdf, 'x.pdf', { virustotalKey: 'K' });
    assert(b.befunde.some(x => x.text.includes('unbekannt')));
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    b = await E.pruefeDokument(pdf, 'x.pdf', { virustotalKey: 'K' });
    assert(b.befunde.some(x => x.text.includes('CORS')) && b.details['VirusTotal (manuell prüfen)'].includes('/gui/file/'));
  } finally { globalThis.fetch = echt; }
});
await test('Eigene Marken und Domains', async () => {
  E.setEigene({ marken: 'MeineBank', domains: 'https://www.meinebank.at/login\nmeinebank.co.at' });
  const L = E._intern.lookalike;
  assert.deepEqual(L('meinebank.at'), []);
  assert.deepEqual(L('mail.meinebank.co.at'), []);
  const stufe = (d) => (L(d)[0] || [])[0];
  assert.equal(stufe('meinebank.com'), 'hoch');          // gleicher Name, fremde Domain
  assert.equal(stufe('meinebank.at.evil.ru'), 'hoch');   // Marke nur in Subdomain
  assert.equal(stufe('meinebnak.at'), 'hoch');           // Tippfehler
  assert.equal(stufe('me1nebank.at'), 'hoch');           // Zeichenersatz
  assert.equal(stufe('meinebank-sicherheit.com'), 'mittel');
  assert.equal(stufe('beispiel.de'), undefined);
  const b = await E.pruefeText('Von: MeineBank <info@meinebank-sicherheit.com>\nBitte anmelden: https://meinebank-sicherheit.com/login');
  assert(b.befunde.some(x => x.kategorie === 'Absender' && x.text.includes('eurer Marke')));
  E.setEigene({});
  assert.deepEqual(E.getEigene(), { marken: [], domains: [] });
  assert.deepEqual(L('meinebank.com'), []);
});
console.log(`\n${ok} Tests bestanden`);

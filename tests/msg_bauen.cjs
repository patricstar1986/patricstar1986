// Erzeugt .msg-Testnachrichten nach MS-OXMSG mit SheetJS als Container-Schreiber (npm install xlsx).
// Aufruf ohne Argument: liefert die Testnachrichten als Objekt; mit Ordner: schreibt sie als Dateien.
const fs = require('fs');
const CFB = require('xlsx').CFB;   // npm install xlsx
const u16 = (s, nul) => Buffer.from(s + (nul ? '\0' : ''), 'utf16le');
const cp1252 = (s, nul) => { const map = { '–': 0x96, '€': 0x80 }; const b = []; for (const ch of s) b.push(map[ch] || (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 63)); if (nul) b.push(0); return Buffer.from(b); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const filetime = (d) => { const v = BigInt(d.getTime()) * 10000n + 116444736000000000n; const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };

// spec: { str:[{id,typ:'001F'|'001E',value,nul}], bin:[{id,data}], fix:[{id,typ,value}], recips:[{name,smtp,addrtyp,typ}], attachs:[{...}] }
function schreibe(cfb, prefix, spec, kopfLaenge) {
  const pfad = (n) => '/' + (prefix ? prefix + '/' : '') + n;
  const eintraege = [];
  (spec.str || []).forEach(p => {
    const daten = p.typ === '001E' ? cp1252(p.value, p.nul) : u16(p.value, p.nul);
    CFB.utils.cfb_add(cfb, pfad(`__substg1.0_${p.id}${p.typ}`), daten);
    const t = parseInt(p.typ, 16); const e = Buffer.alloc(16); e.writeUInt32LE(((parseInt(p.id, 16) << 16) | t) >>> 0, 0); e.writeUInt32LE(6, 4); e.writeUInt32LE(daten.length + (p.nul ? 0 : (t === 0x1f ? 2 : 1)), 8); eintraege.push(e);
  });
  (spec.bin || []).forEach(p => {
    CFB.utils.cfb_add(cfb, pfad(`__substg1.0_${p.id}0102`), p.data);
    const e = Buffer.alloc(16); e.writeUInt32LE(((parseInt(p.id, 16) << 16) | 0x102) >>> 0, 0); e.writeUInt32LE(6, 4); e.writeUInt32LE(p.data.length, 8); eintraege.push(e);
  });
  (spec.fix || []).forEach(p => {
    const e = Buffer.alloc(16); e.writeUInt32LE(((p.id << 16) | p.typ) >>> 0, 0); e.writeUInt32LE(6, 4);
    if (p.typ === 3) e.writeInt32LE(p.value, 8); else if (p.typ === 0x40) filetime(p.value).copy(e, 8); eintraege.push(e);
  });
  (spec.recips || []).forEach((r, i) => {
    const rp = (prefix ? prefix + '/' : '') + `__recip_version1.0_#${String(i).padStart(8, '0')}`;
    schreibe(cfb, rp, { str: [{ id: '3001', typ: '001F', value: r.name }, { id: '3002', typ: '001F', value: r.addrtyp || 'SMTP' }, { id: '3003', typ: '001F', value: r.smtp || '' }, ...(r.smtp ? [{ id: '39FE', typ: '001F', value: r.smtp }] : [])], fix: [{ id: 0x0C15, typ: 3, value: r.typ || 1 }] }, 8);
  });
  (spec.attachs || []).forEach((a, i) => {
    const ap = (prefix ? prefix + '/' : '') + `__attach_version1.0_#${String(i).padStart(8, '0')}`;
    const s = { str: [], bin: [], fix: [{ id: 0x3705, typ: 3, value: a.embedded ? 5 : 1 }] };
    if (a.name) { s.str.push({ id: '3707', typ: '001F', value: a.name }); s.str.push({ id: '3704', typ: '001F', value: a.kurz || a.name.slice(0, 8) }); }
    if (a.ext) s.str.push({ id: '3703', typ: '001F', value: a.ext });
    if (a.mime) s.str.push({ id: '370E', typ: '001F', value: a.mime });
    if (a.cid) { s.str.push({ id: '3712', typ: '001F', value: a.cid }); s.fix.push({ id: 0x3714, typ: 3, value: 4 }); }
    if (a.data) s.bin.push({ id: '3701', data: a.data });
    schreibe(cfb, ap, s, 8);
    if (a.embedded) schreibe(cfb, ap + '/__substg1.0_3701000D', a.embedded, 24);
  });
  const kopf = Buffer.alloc(kopfLaenge);
  if (kopfLaenge >= 24) { kopf.writeUInt32LE((spec.recips || []).length, 8); kopf.writeUInt32LE((spec.attachs || []).length, 12); kopf.writeUInt32LE((spec.recips || []).length, 16); kopf.writeUInt32LE((spec.attachs || []).length, 20); }
  CFB.utils.cfb_add(cfb, pfad('__properties_version1.0'), Buffer.concat([kopf, ...eintraege]));
}
function msg(spec) {
  spec = { ...spec, str: [{ id: '001A', typ: spec.ansi ? '001E' : '001F', value: 'IPM.Note' }, ...(spec.str || [])], fix: [{ id: 0x340D, typ: 3, value: spec.ansi ? 0 : 0x40000 }, ...(spec.fix || [])] };
  (spec.attachs || []).forEach(a => { if (a.embedded) a.embedded = { ...a.embedded, str: [{ id: '001A', typ: '001F', value: 'IPM.Note' }, ...(a.embedded.str || [])], fix: [{ id: 0x340D, typ: 3, value: 0x40000 }, ...(a.embedded.fix || [])] }; });
  const cfb = CFB.utils.cfb_new(); schreibe(cfb, '', spec, 32);
  try { CFB.utils.cfb_del(cfb, '\u0001Sh33tJ5'); } catch (e) { /* Füll-Eintrag schon weg */ }
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}


function testNachrichten() {
  const out = { _geschrieben: {} };
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Producer (Mein Bankensystem) /CreationDate (D:20260928100000+02\'00\') >> endobj\ntrailer << /Root 1 0 R /Info 2 0 R >>\n%%EOF\n');
  const kopfOk = 'Received: from mx.example.net (mx.example.net [192.0.2.10]) by mail.empfaenger.de; Mon, 28 Sep 2026 10:00:05 +0200\r\nAuthentication-Results: mail.empfaenger.de; spf=pass smtp.mailfrom=paypal.de; dkim=pass header.d=paypal.de; dmarc=pass header.from=paypal.de\r\nContent-Type: multipart/alternative; boundary="ORIGINAL"\r\nMIME-Version: 1.0\r\nFrom: PayPal <service@paypal.de>\r\nTo: kunde@empfaenger.de\r\nSubject: Ihr Kontoauszug\r\nDate: Mon, 28 Sep 2026 10:00:00 +0200\r\nMessage-ID: <abc@paypal.de>\r\n';
  const htmlOk = '<html><body><p>Hallo, Ihr Auszug ist online: <a href="https://www.paypal.de/konto">www.paypal.de</a> Grüße für Müller</p></body></html>';
  // 1) unauffällige externe Mail: Unicode, Text + HTML (Binär, UTF-8), PDF-Anhang
  out['extern_ok'] = (msg({
    str: [{ id: '0037', typ: '001F', value: 'Ihr Kontoauszug', nul: true }, { id: '007D', typ: '001F', value: kopfOk }, { id: '1000', typ: '001F', value: 'Hallo, Ihr Auszug ist online: https://www.paypal.de/konto' }, { id: '0C1A', typ: '001F', value: 'PayPal' }],
    bin: [{ id: '1013', data: Buffer.from(htmlOk, 'utf8') }],
    fix: [{ id: 0x3FDE, typ: 3, value: 65001 }, { id: 0x0039, typ: 0x40, value: new Date('2026-09-28T08:00:00Z') }],
    attachs: [{ name: 'Kontoauszug.pdf', ext: '.pdf', data: pdf }] }));
  // 2) Phishing: ANSI (cp1252), DMARC-Fehler, getarnter Link, doppelte Endung
  const kopfPhish = 'Received: from mx.example.net (mx.example.net [192.0.2.10]) by mail.empfaenger.de; Mon, 28 Sep 2026 10:00:05 +0200\r\nAuthentication-Results: mail.empfaenger.de; spf=fail smtp.mailfrom=paypa1-service.com; dkim=none; dmarc=fail header.from=paypa1-service.com\r\nFrom: "PayPal Kundenservice service@paypal.de" <info@paypa1-service.com>\r\nReply-To: hilfe@irgendwo.ru\r\nSubject: Dringend: Ihr Konto wurde gesperrt\r\nDate: Mon, 28 Sep 2026 10:00:00 +0200\r\nMessage-ID: <x@paypa1-service.com>\r\n';
  const htmlPhish = '<p>Bitte verifizieren Sie Ihr Konto sofort: <a href="http://203.0.113.5/login">https://www.paypal.de/login</a></p>';
  out['phishing'] = (msg({
    str: [{ id: '0037', typ: '001E', value: 'Dringend: Ihr Konto wurde gesperrt – Prüfung', nul: true }, { id: '007D', typ: '001E', value: kopfPhish, nul: true }, { id: '1000', typ: '001E', value: 'Bitte verifizieren Sie Ihr Konto (Prüfung) sofort: http://203.0.113.5/login', nul: true }],
    bin: [{ id: '1013', data: cp1252(htmlPhish.replace('Konto sofort', 'Konto (Prüfung) sofort')) }],
    ansi: true, fix: [{ id: 0x3FFD, typ: 3, value: 1252 }, { id: 0x3FDE, typ: 3, value: 1252 }],
    attachs: [{ name: 'Rechnung.pdf.exe', ext: '.exe', data: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]) }] }));
  // 3) interne Exchange-Mail ohne Internet-Kopfzeilen, nur komprimierter RTF-Text, Empfängerliste
  out['intern'] = (msg({
    str: [{ id: '0037', typ: '001F', value: 'Wartungsfenster Samstag' }, { id: '0C1A', typ: '001F', value: 'Anna Beispiel' }, { id: '0C1E', typ: '001F', value: 'EX' }, { id: '0C1F', typ: '001F', value: '/O=BANK/OU=EXCHANGE/CN=ANNA' }, { id: '0E04', typ: '001F', value: 'Ben Muster; Chris Test' }],
    bin: [{ id: '1009', data: Buffer.from('jgAAALEAAABMWkZ1Z8k0KwMACgByY3BnMTI17jIA9AH3AqIgBxMCgAKRNQjmOwlvMAKACvMgSIMHQAkAIFdlbHQKo8Bad2VpdGUTUBOAGmwTsG0TkAMwJ2ZjhCAoClApIHVuElAORQhwErAMYDgzNjQsPy4KowAAKgmwZW6pBJBhdAWxVAeQdAKAEkUVIGV9GAA=', 'base64') }],
    fix: [{ id: 0x0039, typ: 0x40, value: new Date('2026-09-25T13:30:00Z') }],
    recips: [{ name: 'Ben Muster', smtp: 'ben.muster@bank.example', typ: 1 }, { name: 'Chris Test', smtp: 'chris.test@bank.example', typ: 2 }] }));
  // 4) Mail mit eingebetteter Nachricht (weitergeleitete Phishing-Mail) und Bild im Text
  out['mit_eingebetteter'] = (msg({
    str: [{ id: '0037', typ: '001F', value: 'WG: Verdächtige Mail' }, { id: '007D', typ: '001F', value: 'Received: from a (a [192.0.2.1]) by b; Mon, 28 Sep 2026 12:00:05 +0200\r\nAuthentication-Results: b; spf=pass smtp.mailfrom=bank.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example\r\nFrom: Kollege <kollege@bank.example>\r\nTo: it@bank.example\r\nSubject: WG: Verdächtige Mail\r\nDate: Mon, 28 Sep 2026 12:00:00 +0200\r\nMessage-ID: <fw1@bank.example>\r\n' }, { id: '1000', typ: '001F', value: 'Bitte prüfen, ist das echt?' }],
    attachs: [{ name: 'Dringend.msg', embedded: { str: [{ id: '0037', typ: '001F', value: 'Dringend: Ihr Konto wurde gesperrt' }, { id: '0C1A', typ: '001F', value: 'PayPal Service' }, { id: '5D01', typ: '001F', value: 'info@paypa1-service.com' }, { id: '1000', typ: '001F', value: 'Bitte verifizieren Sie Ihr Konto: http://203.0.113.5/login' }] } },
      { name: 'logo.png', ext: '.png', cid: 'logo@x', data: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex') }] }));
  out['kaputt'] = (Buffer.concat([Buffer.from('D0CF11E0A1B11AE1', 'hex'), Buffer.alloc(600, 7)]));
  out['kein_msg'] = (Buffer.from('Das ist nur Text mit der Endung .msg. '.repeat(30)));
  delete out._geschrieben;
  return out;
}

module.exports = { msg, testNachrichten };
if (require.main === module) { const d = process.argv[2]; const t = testNachrichten(); Object.entries(t).forEach(([k, v]) => fs.writeFileSync(d + '/' + k + '.msg', v)); console.log('Testnachrichten geschrieben:', Object.keys(t).join(', ')); }

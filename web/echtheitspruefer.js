/* Echtheitsprüfer (Browser-Version) – prüft E-Mails, Texte und Dokumente lokal im Browser
 * auf Hinweise für Fälschung, Phishing, Betrug, Manipulation und Schadcode.
 * Portierung von github.com/patricstar1986/patricstar1986 (Python-Paket echtheitspruefer).
 * Alle Ergebnisse sind Indizien, keine Beweise.
 *
 * API (alle async):
 *   Echtheitspruefer.pruefeMail(bytesOderText, name, {online})  -> Bericht
 *   Echtheitspruefer.pruefeText(text, {online})                  -> Bericht
 *   Echtheitspruefer.pruefeDokument(bytes, name, {online})        -> Bericht
 *   bericht.alsText()  -> Markdown-Text (für Chat/Claude)
 *   Echtheitspruefer.istVollstaendigeMail(text) -> bool
 */
(function (global) {
  'use strict';

  // ======================================================================
  // Bericht
  // ======================================================================
  const STUFEN = ['ok', 'info', 'niedrig', 'mittel', 'hoch'];
  const RANG = Object.fromEntries(STUFEN.map((s, i) => [s, i]));
  const SYMBOL = { ok: '✅', info: 'ℹ️', niedrig: '🔸', mittel: '⚠️', hoch: '⛔' };

  // Fremdtexte (aus Mails/Dokumenten) entschärfen, damit sie nie als HTML wirken.
  const sicher = (s) => String(s == null ? '' : s).replace(/</g, '‹').replace(/>/g, '›').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  class Bericht {
    constructor(titel, datei) {
      this.titel = titel; this.datei = datei;
      this.befunde = []; this.details = {}; this.unterberichte = [];
    }
    add(stufe, kategorie, text) {
      if (!(stufe in RANG)) throw new Error('Unbekannte Stufe ' + stufe);
      this.befunde.push({ stufe, kategorie, text });
    }
    hoechsteStufe() {
      let s = 'ok';
      for (const b of this.befunde) if (RANG[b.stufe] > RANG[s]) s = b.stufe;
      for (const u of this.unterberichte) { const us = u.hoechsteStufe(); if (RANG[us] > RANG[s]) s = us; }
      return s;
    }
    fazit() {
      const s = this.hoechsteStufe();
      if (s === 'hoch') return 'STARKE WARNZEICHEN – nicht vertrauen. Keine Links öffnen, keine Anhänge ausführen, Absender über einen unabhängigen Kanal (bekannte Telefonnummer, offizielle Website) kontaktieren.';
      if (s === 'mittel') return 'AUFFÄLLIGKEITEN gefunden – mit Vorsicht behandeln und die markierten Punkte gezielt nachprüfen.';
      return 'Keine technischen Auffälligkeiten gefunden. Das ist KEIN Beweis für Echtheit – geschickte Fälschungen oder gehackte echte Konten werden so nicht erkannt.';
    }
    toJSON() {
      return { titel: this.titel, datei: this.datei, hoechste_stufe: this.hoechsteStufe(), fazit: this.fazit(),
        befunde: this.befunde, details: this.details, unterberichte: this.unterberichte.map(u => u.toJSON()) };
    }
    alsText(ebene = 0) {
      const h = '#'.repeat(Math.min(ebene + 3, 6));
      const z = [`${h} ${sicher(this.titel)}: ${sicher(this.datei)}`, ''];
      if (ebene === 0) z.push(`**Gesamtergebnis:** ${SYMBOL[this.hoechsteStufe()]} ${this.fazit()}`, '');
      const det = Object.entries(this.details).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length));
      if (det.length) {
        z.push('**Details:**');
        for (const [k, v] of det) {
          if (Array.isArray(v)) {
            z.push(`- ${sicher(k)}:`);
            v.slice(0, 25).forEach(x => z.push(`  - ${sicher(x)}`));
            if (v.length > 25) z.push(`  - … (${v.length - 25} weitere)`);
          } else z.push(`- ${sicher(k)}: ${sicher(v)}`);
        }
        z.push('');
      }
      z.push('**Befunde:**');
      if (!this.befunde.length) z.push('- (keine)');
      [...this.befunde].sort((a, b) => RANG[b.stufe] - RANG[a.stufe])
        .forEach(b => z.push(`- ${SYMBOL[b.stufe]} **${b.stufe.toUpperCase()}** [${sicher(b.kategorie)}] ${sicher(b.text)}`));
      for (const u of this.unterberichte) { z.push(''); z.push(u.alsText(ebene + 1)); }
      return z.join('\n');
    }
  }

  // ======================================================================
  // Hilfsfunktionen: Bytes, Text, Hash
  // ======================================================================
  const enc = new TextEncoder();
  function alsBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (typeof x === 'string') return enc.encode(x);
    throw new Error('Unbekannter Datentyp');
  }
  // Bytes -> "Binärstring" (jedes Byte ein Zeichen, Latin-1)
  function latin1(bytes, start = 0, ende = bytes.length) {
    let s = '';
    const CH = 0x8000;
    for (let i = start; i < ende; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, ende)));
    return s;
  }
  function binZuBytes(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return b; }
  function dekodiere(bytes, charset) {
    try { return new TextDecoder((charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, ''), { fatal: false }).decode(bytes); }
    catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }
  async function sha256(bytes) {
    const c = global.crypto && global.crypto.subtle;
    if (!c) return '';
    const h = new Uint8Array(await c.digest('SHA-256', bytes));
    return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
  }
  async function inflate(bytes, limit = 20 * 1024 * 1024) {
    if (typeof DecompressionStream === 'undefined') return null;
    const teile = []; let gesamt = 0;
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes).catch(() => {}); writer.close().catch(() => {});
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        teile.push(value); gesamt += value.length;
        if (gesamt > limit) { reader.cancel().catch(() => {}); break; }
      }
    } catch (e) { /* Rest nach Datenende o. ä. – bisherige Daten behalten */ }
    if (!gesamt) return null;
    const out = new Uint8Array(gesamt); let o = 0;
    for (const t of teile) { out.set(t, o); o += t.length; }
    return out;
  }
  const endungVon = (name) => { const m = /\.([^.\/\\]+)$/.exec(name || ''); return m ? '.' + m[1].toLowerCase() : ''; };
  const endungen = (name) => (String(name || '').split(/[\/\\]/).pop().match(/\.[^.]+/g) || []).map(e => e.toLowerCase());

  // ======================================================================
  // Domains
  // ======================================================================
  const MEHRTEILIGE_SUFFIXE = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.at', 'or.at', 'gv.at', 'ac.at',
    'co.nz', 'co.jp', 'com.br', 'com.tr', 'com.cn', 'co.za', 'com.mx', 'co.in', 'com.es', 'com.pl']);
  const MARKEN = ['paypal', 'amazon', 'apple', 'icloud', 'microsoft', 'outlook', 'google', 'gmail', 'facebook', 'instagram', 'whatsapp', 'netflix', 'ebay',
    'sparkasse', 'volksbank', 'commerzbank', 'deutsche-bank', 'postbank', 'ing', 'dkb', 'comdirect', 'consorsbank', 'n26', 'targobank', 'hypovereinsbank',
    'raiffeisen', 'dhl', 'deutschepost', 'dpd', 'hermes', 'ups', 'fedex', 'gls', 'telekom', 'vodafone', 'o2online', '1und1', 'gmx', 'web', 't-online',
    'elster', 'zoll', 'bundesfinanzministerium', 'arbeitsagentur', 'klarna', 'booking', 'airbnb', 'adobe', 'dropbox', 'docusign', 'wetransfer',
    'mastercard', 'visa', 'americanexpress', 'binance', 'coinbase', 'linkedin',
    // Österreich
    'bawag', 'erstebank', 'bankaustria', 'oberbank', 'finanzonline', 'oesterreich', 'oebb'];
  const BEKANNT_ECHT = new Set(['amazonaws.com', 'amazonses.com', 'facebookmail.com', 'googlemail.com', 'googleusercontent.com', 'microsoftonline.com', 'linkedinmail.com']);
  const KURZLINKS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 't.ly', 'tiny.cc']);
  const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'web.de', 'outlook.com', 'hotmail.com', 'yahoo.com', 'yahoo.de',
    't-online.de', 'icloud.com', 'aol.com', 'aon.at', 'chello.at']);

  // Nur syntaktisch gültige Domains zurückgeben (z. B. nicht 'gmail.c...'), sonst ''.
  const domainAusAdresse = (a) => {
    if (!a || !a.includes('@')) return '';
    const d = a.split('@').pop().trim().replace(/[>\s]+$/, '').toLowerCase().replace(/\.$/, '');
    return /^(?:[a-z0-9\u00a1-\uffff](?:[a-z0-9\u00a1-\uffff-]*[a-z0-9\u00a1-\uffff])?\.)+[a-z\u00a1-\uffff][a-z0-9\u00a1-\uffff-]*$/i.test(d) || /^\[.*\]$/.test(d) ? d : '';
  };
  const istIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[?[0-9a-f:]+:[0-9a-f:]*\]?$/i.test(h);
  function orgDomain(domain) {
    domain = String(domain || '').toLowerCase().replace(/\.$/, '');
    if (istIp(domain)) return domain;
    const t = domain.split('.');
    if (t.length >= 3 && MEHRTEILIGE_SUFFIXE.has(t.slice(-2).join('.'))) return t.slice(-3).join('.');
    return t.slice(-2).join('.');
  }
  const hauptLabel = (d) => orgDomain(d).split('.')[0];
  function hostAusUrl(url) {
    try { return new URL(url.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch (e) { return ''; }
  }
  function levenshtein(a, b) {
    if (a.length < b.length) [a, b] = [b, a];
    let vorher = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const akt = [i];
      for (let j = 1; j <= b.length; j++) akt.push(Math.min(vorher[j] + 1, akt[j - 1] + 1, vorher[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
      vorher = akt;
    }
    return vorher[b.length];
  }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const gleicheOrg = (a, b) => !!(a && b) && orgDomain(a) === orgDomain(b);

  function lookalike(domain) {
    const erg = [];
    if (!domain) return erg;
    if (domain.includes('xn--')) erg.push(['mittel', `Domain '${domain}' ist Punycode (internationalisiert) – häufig für Homoglyphen-Tricks genutzt (z. B. kyrillisches 'а' statt 'a').`]);
    if (/[^\x00-\x7F]/.test(domain)) erg.push(['mittel', `Domain '${domain}' enthält Nicht-ASCII-Zeichen – mögliche Homoglyphen.`]);
    const org = orgDomain(domain);
    const sub = domain !== org ? domain.slice(0, -org.length).replace(/\.$/, '').split('.') : [];
    for (const m of MARKEN) {
      if (m.length >= 4 && sub.includes(m) && hauptLabel(domain) !== m && !BEKANNT_ECHT.has(org)) {
        erg.push(['hoch', `'${m}' steht nur in der Subdomain – die tatsächliche Domain ist '${org}'.`]);
        return erg;
      }
    }
    const label = hauptLabel(domain);
    if (MARKEN.includes(label) || label.length < 4 || BEKANNT_ECHT.has(org)) return erg;
    const norm = label.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/4/g, 'a').replace(/7/g, 't')
      .replace(/rn/g, 'm').replace(/vv/g, 'w');
    for (const m of MARKEN) {
      if (m.length < 4) continue;
      if (norm === m) { erg.push(['hoch', `Domain '${domain}' imitiert '${m}' durch Zeichenersatz.`]); break; }
      const ab = levenshtein(label, m);
      if (ab > 0 && ab <= (m.length <= 5 ? 1 : 2)) { erg.push(['hoch', `Domain '${domain}' ähnelt stark '${m}' (Tippfehler-Domain?).`]); break; }
      const re = new RegExp(`(^|[-.])${reEsc(m)}([-.]|$)`);
      if ([label, norm].some(k => re.test(k) || (k.includes(m) && m.length >= 6))) {
        erg.push(['niedrig', `Domain '${domain}' enthält den Markennamen '${m}', ist aber nicht die bekannte Hauptdomain – prüfen, ob sie wirklich zur Marke gehört (bei Banken sind regionale Domains üblich).`]);
        break;
      }
    }
    return erg;
  }

  // ======================================================================
  // Phishing-Datenbank (Phishing.Database, GitHub) mit Cache in IndexedDB
  // ======================================================================
  const PHISHING_URL = 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt';
  const MAX_ALTER_MS = 6 * 3600 * 1000;
  const PLATTFORMEN = new Set(['google.com', 'googleusercontent.com', 'microsoft.com', 'live.com', 'office.com', 'sharepoint.com', 'onedrive.com', '1drv.ms',
    'dropbox.com', 'box.com', 'github.io', 'github.com', 'wixsite.com', 'weebly.com', 'blogspot.com', 'square.site', 'firebaseapp.com', 'web.app', 'pages.dev',
    'vercel.app', 'netlify.app', 'notion.site', 'canva.com', 'jotform.com', 'typeform.com', 'amazonaws.com', 'cloudfront.net', 'wordpress.com', 'webflow.io',
    'glitch.me', 'ipfs.io', 'linktr.ee', 'adobe.com', 'wetransfer.com', 'docusign.net']);
  const GETEILTE_HOSTS = new Set(['sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.gle', 'storage.googleapis.com', 'onedrive.live.com',
    '1drv.ms', 'dropbox.com', 'github.com', 'forms.office.com', 'forms.microsoft.com', 'notion.so']);
  let phishingSet = null, phishingStand = 0;

  function idbOeffnen() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('kein IndexedDB'));
      const r = indexedDB.open('echtheitspruefer', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('listen');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) { const db = await idbOeffnen(); return new Promise((res, rej) => { const q = db.transaction('listen').objectStore('listen').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function idbSet(k, v) { const db = await idbOeffnen(); return new Promise((res, rej) => { const t = db.transaction('listen', 'readwrite'); t.objectStore('listen').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

  async function ladePhishingListe() {
    if (phishingSet && Date.now() - phishingStand < MAX_ALTER_MS) return { set: phishingSet, hinweis: '' };
    let gecacht = null;
    try { gecacht = await idbGet('phishing'); } catch (e) { /* ohne Cache weiter */ }
    if (gecacht && Date.now() - gecacht.stand < MAX_ALTER_MS) {
      phishingSet = new Set(gecacht.text.split('\n')); phishingStand = gecacht.stand;
      return { set: phishingSet, hinweis: '' };
    }
    try {
      const r = await fetch(PHISHING_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = (await r.text()).split('\n').map(z => z.trim().toLowerCase()).filter(z => z && !z.startsWith('#')).join('\n');
      phishingSet = new Set(text.split('\n')); phishingStand = Date.now();
      try { await idbSet('phishing', { text, stand: phishingStand }); } catch (e) { /* egal */ }
      return { set: phishingSet, hinweis: '' };
    } catch (e) {
      if (gecacht) {
        phishingSet = new Set(gecacht.text.split('\n')); phishingStand = gecacht.stand;
        return { set: phishingSet, hinweis: `Phishing-Liste konnte nicht aktualisiert werden (${e.message}), verwende Stand vom ${new Date(gecacht.stand).toLocaleString('de-DE')}.` };
      }
      return { set: null, hinweis: `Phishing-Datenbank nicht erreichbar (${e.message}).` };
    }
  }

  async function urlsAbgleichen(bericht, urls, liste) {
    if (!urls.length) return;
    let set = liste || null, hinweis = '';
    if (!set) ({ set, hinweis } = await ladePhishingListe());
    if (hinweis) bericht.add('info', 'Datenbank', hinweis);
    if (!set) return;
    const hosts = [...new Set(urls.map(hostAusUrl).filter(Boolean))].sort();
    let treffer = 0;
    for (const h of hosts) {
      const org = orgDomain(h), ohneWww = h.replace(/^www\./, '');
      const exakt = set.has(h) || set.has(ohneWww);
      if (!exakt && (PLATTFORMEN.has(org) || !set.has(org))) continue;
      treffer++;
      if (GETEILTE_HOSTS.has(ohneWww)) {
        bericht.add('mittel', 'Datenbank', `[Phishing.Database] '${h}' ist ein gemeinsam genutzter Dienst, über den auch Phishing-Seiten verbreitet werden (daher gelistet). Der konkrete Link kann echt oder betrügerisch sein – dort keine Zugangsdaten eingeben.`);
      } else {
        bericht.add('hoch', 'Datenbank', `[Phishing.Database] Domain '${h}' ist als aktive PHISHING-Seite gelistet.`);
      }
    }
    if (!treffer) bericht.add('ok', 'Datenbank', `Kein Link ist in der Phishing-Datenbank (Phishing.Database, ${set.size.toLocaleString('de-DE')} aktive Einträge) gemeldet – neue Betrugsseiten sind oft noch nicht erfasst.`);
  }

  // ======================================================================
  // VirusTotal (nur Hash-Abfrage – die Datei selbst wird NICHT hochgeladen)
  // ======================================================================
  async function virustotalHash(bericht, sha, schluessel) {
    let r;
    try {
      r = await fetch('https://www.virustotal.com/api/v3/files/' + sha, { headers: { 'x-apikey': schluessel } });
    } catch (e) {
      bericht.add('info', 'VirusTotal', 'VirusTotal konnte aus dem Browser nicht abgefragt werden – vermutlich blockiert VirusTotal direkte Anfragen von Webseiten (CORS) oder das Netzwerk sperrt die Adresse. Über den Link unter „VirusTotal (manuell prüfen)“ lässt sich die Datei trotzdem nachschlagen.');
      return;
    }
    if (r.status === 404) { bericht.add('info', 'VirusTotal', 'Datei ist bei VirusTotal unbekannt (wurde dort noch nie geprüft). Das ist weder gut noch schlecht – gezielt verschickte Schadsoftware ist oft neu.'); return; }
    if (r.status === 401 || r.status === 403) { bericht.add('info', 'VirusTotal', 'VirusTotal hat den API-Schlüssel abgelehnt – bitte in den Einstellungen prüfen.'); return; }
    if (r.status === 429) { bericht.add('info', 'VirusTotal', 'VirusTotal-Abfragelimit erreicht (kostenloser Zugang: wenige Abfragen pro Minute) – bitte später erneut versuchen.'); return; }
    if (!r.ok) { bericht.add('info', 'VirusTotal', `VirusTotal-Abfrage fehlgeschlagen (HTTP ${r.status}).`); return; }
    let daten;
    try { daten = await r.json(); } catch (e) { bericht.add('info', 'VirusTotal', 'Antwort von VirusTotal war nicht lesbar.'); return; }
    const attr = (daten.data && daten.data.attributes) || {};
    const st = attr.last_analysis_stats || {};
    const boese = st.malicious || 0, verdacht = st.suspicious || 0;
    const gesamt = Object.values(st).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    const wann = attr.last_analysis_date ? new Date(attr.last_analysis_date * 1000).toLocaleDateString('de-DE') : 'unbekannt';
    bericht.details['VirusTotal-Ergebnis'] = `${boese} schädlich, ${verdacht} verdächtig von ${gesamt} Scannern (letzte Analyse: ${wann})`;
    const namen = attr.popular_threat_classification && attr.popular_threat_classification.suggested_threat_label;
    if (boese >= 3) bericht.add('hoch', 'VirusTotal', `SCHADSOFTWARE: ${boese} von ${gesamt} Virenscannern erkennen diese Datei als schädlich${namen ? ` (${namen})` : ''}.`);
    else if (boese || verdacht) bericht.add('mittel', 'VirusTotal', `${boese} Virenscanner melden „schädlich“, ${verdacht} „verdächtig“ (von ${gesamt}) – einzelne Treffer können Fehlalarme sein, Vorsicht.`);
    else bericht.add('ok', 'VirusTotal', `Keiner von ${gesamt} Virenscannern bei VirusTotal meldet diese Datei (letzte Analyse: ${wann}).`);
  }

  // ======================================================================
  // MIME-Parser
  // ======================================================================
  function dekodiereWorte(s) {
    if (!s) return '';
    return s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (voll, cs, e, daten) => {
      try {
        let bin;
        if (e.toUpperCase() === 'B') bin = atob(daten.replace(/\s/g, ''));
        else bin = daten.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
        return dekodiere(binZuBytes(bin), cs.split('*')[0]);
      } catch (err) { return voll; }
    });
  }
  function parseKopf(text) {
    const liste = [];
    text.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n').forEach(z => {
      const m = /^([!-9;-~]+):[ \t]*(.*)$/.exec(z);
      if (m) liste.push([m[1].toLowerCase(), m[2]]);
    });
    return {
      liste,
      get: (n) => { const e = liste.find(x => x[0] === n); return e ? e[1] : ''; },
      getAll: (n) => liste.filter(x => x[0] === n).map(x => x[1]),
    };
  }
  function param(wert, name) {
    const stern = new RegExp(`${name}\\*=([^;]+)`, 'i').exec(wert);
    if (stern) {
      const v = stern[1].trim().replace(/^"|"$/g, '');
      const m = /^([^']*)'[^']*'(.*)$/.exec(v);
      try { return m ? dekodiere(binZuBytes(unescape(m[2])), m[1] || 'utf-8') : decodeURIComponent(v); } catch (e) { return v; }
    }
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, 'i').exec(wert);
    if (!m) return '';
    return dekodiereWorte(m[2] !== undefined ? m[2] : m[1]);
  }
  function trenneKopfKoerper(bin) {
    const m = /\r?\n\r?\n/.exec(bin);
    if (!m) return [bin, ''];
    return [bin.slice(0, m.index), bin.slice(m.index + m[0].length)];
  }
  function dekodiereKoerper(bin, cte) {
    cte = (cte || '').toLowerCase().trim();
    if (cte === 'base64') {
      try { return binZuBytes(atob(bin.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+(?=[^=])/g, ''))); } catch (e) { return binZuBytes(bin); }
    }
    if (cte === 'quoted-printable') {
      return binZuBytes(bin.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))));
    }
    return binZuBytes(bin);
  }
  // Liefert {kopf, typ, teile:[...]} bzw. Blatt {kopf, typ, bytes, dateiname, disposition}
  function parseTeil(bin, tiefe = 0) {
    const [kopfText, koerper] = trenneKopfKoerper(bin);
    const kopf = parseKopf(kopfText);
    const ct = kopf.get('content-type') || 'text/plain';
    const typ = ct.split(';')[0].trim().toLowerCase();
    const disp = kopf.get('content-disposition');
    const dateiname = param(disp, 'filename') || param(ct, 'name');
    const teil = { kopf, typ, ct, disposition: disp.split(';')[0].trim().toLowerCase(), dateiname };
    if (typ.startsWith('multipart/') && tiefe < 20) {
      const grenze = param(ct, 'boundary');
      teil.teile = [];
      if (grenze) {
        const stuecke = koerper.split(new RegExp('(?:^|\\r?\\n)--' + reEsc(grenze) + '(?:--)?[ \\t]*(?=\\r?\\n|$)'));
        stuecke.slice(1).forEach(s => {
          const inhalt = s.replace(/^\r?\n/, '');
          if (inhalt.trim()) teil.teile.push(parseTeil(inhalt, tiefe + 1));
        });
      }
      return teil;
    }
    teil.bytes = dekodiereKoerper(koerper, kopf.get('content-transfer-encoding'));
    teil.charset = param(ct, 'charset');
    return teil;
  }
  function blaetter(teil, aus = []) {
    if (teil.teile) teil.teile.forEach(t => blaetter(t, aus)); else aus.push(teil);
    return aus;
  }
  function adresse(wert) {
    wert = dekodiereWorte(wert || '').trim();
    if (!wert) return ['', ''];
    const m = /^(.*?)<([^<>]*)>\s*$/.exec(wert);
    if (m) return [m[1].trim().replace(/^"|"$/g, '').trim(), m[2].trim()];
    const a = /[^\s<>"]+@[^\s<>"]+/.exec(wert);
    return ['', a ? a[0] : wert];
  }
  function datum(s) {
    if (!s) return null;
    const t = Date.parse(s.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim());
    return isNaN(t) ? null : new Date(t);
  }

  // ======================================================================
  // HTML-Hilfen (ohne DOM, damit es überall läuft)
  // ======================================================================
  function entities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      e = e.toLowerCase();
      if (e[0] === '#') { const c = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch (x) { return m; } }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e];
    });
  }
  const ohneTags = (html) => entities(html.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  function links(html) {
    const erg = [];
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const h = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
      if (h) erg.push([entities(h[1] ?? h[2] ?? h[3] ?? '').trim(), ohneTags(m[2])]);
    }
    return erg;
  }
  const formulare = (html) => [...html.matchAll(/<form\b([^>]*)>/gi)].map(m => { const a = /\baction\s*=\s*["']?([^"'\s>]*)/i.exec(m[1]); return a ? entities(a[1]) : ''; });

  // ======================================================================
  // Dokumentprüfung
  // ======================================================================
  const GEFAEHRLICH = new Set(['.exe', '.scr', '.com', '.pif', '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.ps1', '.msi', '.msix',
    '.jar', '.lnk', '.cpl', '.dll', '.reg', '.iso', '.img', '.vhd', '.vhdx', '.appx', '.application', '.url', '.chm', '.xll', '.one']);
  const MAKRO = new Set(['.docm', '.dotm', '.xlsm', '.xltm', '.xlam', '.pptm', '.potm', '.ppsm']);
  const RISKANT = new Set(['.svg', '.html', '.htm', '.shtml', '.xhtml']);
  const ERWARTET = { '.pdf': 'pdf', '.docx': 'ooxml', '.docm': 'ooxml', '.dotx': 'ooxml', '.dotm': 'ooxml', '.xlsx': 'ooxml', '.xlsm': 'ooxml', '.xltx': 'ooxml',
    '.pptx': 'ooxml', '.pptm': 'ooxml', '.ppsx': 'ooxml', '.doc': 'ole', '.xls': 'ole', '.ppt': 'ole', '.msg': 'ole', '.jpg': 'jpeg', '.jpeg': 'jpeg',
    '.png': 'png', '.gif': 'gif', '.zip': 'zip', '.rtf': 'rtf', '.exe': 'exe', '.dll': 'exe', '.odt': 'odf', '.ods': 'odf', '.odp': 'odf' };
  const PDF_EDITOREN = ['ilovepdf', 'smallpdf', 'sejda', 'pdfescape', 'pdf-xchange', 'pdfxchange', 'foxit phantompdf', 'foxit pdf editor', 'nitro', 'pdffiller',
    'pdf candy', 'pdf24', 'soda pdf', 'wondershare', 'pdfelement', 'inkscape', 'libreoffice draw', 'adobe acrobat pro', 'photoshop', 'gimp', 'canva',
    'online2pdf', 'pdfzorro', 'pdf buddy', 'dochub', 'lightpdf', 'pdfsimpli', 'hipdf'];
  const BILD_EDITOREN = ['photoshop', 'gimp', 'lightroom', 'affinity', 'paint.net', 'pixelmator', 'snapseed', 'canva', 'picsart', 'facetune', 'illustrator'];

  // Einfacher ZIP-Leser (Zentralverzeichnis): Namen, Flags, Methode, Offsets
  function zipEintraege(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return null;
    const anzahl = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const liste = [];
    for (let n = 0; n < anzahl && p + 46 <= b.length; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true), methode = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), kl = dv.getUint16(p + 32, true);
      const lokal = dv.getUint32(p + 42, true);
      const name = dekodiere(b.subarray(p + 46, p + 46 + nl), (flags & 0x800) ? 'utf-8' : 'utf-8');
      liste.push({ name, flags, methode, csize, lokal });
      p += 46 + nl + el + kl;
    }
    return liste;
  }
  async function zipLesen(b, eintrag) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const p = eintrag.lokal;
    if (p + 30 > b.length || dv.getUint32(p, true) !== 0x04034b50) return null;
    const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
    const roh = b.subarray(start, start + eintrag.csize);
    if (eintrag.methode === 0) return roh;
    if (eintrag.methode !== 8 || typeof DecompressionStream === 'undefined') return null;
    // "deflate-raw" = ZIP-Deflate ohne zlib-Kopf
    try {
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter(); w.write(roh).catch(() => {}); w.close().catch(() => {});
      const buf = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }

  function erkenneTyp(b) {
    const k = latin1(b, 0, Math.min(8, b.length));
    if (latin1(b, 0, Math.min(1024, b.length)).includes('%PDF-')) return 'pdf';
    if (k.startsWith('PK\x03\x04') || k.startsWith('PK\x05\x06')) {
      const e = zipEintraege(b);
      if (!e) return 'zip';
      const namen = e.map(x => x.name);
      if (namen.includes('[Content_Types].xml')) return 'ooxml';
      if (namen.includes('mimetype')) return 'odf';
      return 'zip';
    }
    if (k.startsWith('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')) return 'ole';
    if (k.startsWith('\xff\xd8\xff')) return 'jpeg';
    if (k.startsWith('\x89PNG\r\n\x1a\n')) return 'png';
    if (k.startsWith('GIF8')) return 'gif';
    if (k.startsWith('MZ') || k.startsWith('\x7fELF')) return 'exe';
    if (k.startsWith('{\\rt')) return 'rtf';
    const anfang = latin1(b, 0, Math.min(512, b.length)).trimStart().toLowerCase();
    if (anfang.startsWith('<!doctype html') || anfang.startsWith('<html')) return 'html';
    return 'unbekannt';
  }

  async function pruefeDokument(daten, name, opt = {}) {
    const b = alsBytes(daten);
    const bericht = new Bericht('Dokumentprüfung', name || 'Datei');
    const typ = erkenneTyp(b);
    const ends = endungen(name), endung = ends.length ? ends[ends.length - 1] : '';
    bericht.details['Größe'] = b.length.toLocaleString('de-DE') + ' Bytes';
    bericht.details['SHA-256'] = await sha256(b);
    bericht.details['Erkannter Typ'] = typ;

    if (GEFAEHRLICH.has(endung)) bericht.add('hoch', 'Dateityp', `Gefährliche Dateiendung '${endung}' – kann Code ausführen.`);
    if (MAKRO.has(endung)) bericht.add('hoch', 'Dateityp', `Dateiendung '${endung}' steht für Office-Dateien mit Makros.`);
    if (RISKANT.has(endung)) bericht.add('mittel', 'Dateityp', `'${endung}'-Dateien öffnen sich im Browser und können Skripte oder nachgebaute Login-Seiten enthalten.`);
    if (ends.length >= 2 && ['.pdf', '.doc', '.docx', '.jpg', '.png', '.xls', '.xlsx', '.txt'].includes(ends[ends.length - 2])
      && (GEFAEHRLICH.has(endung) || ['.zip', '.rar', '.7z', '.html', '.htm'].includes(endung))) {
      bericht.add('hoch', 'Dateityp', `Doppelte Endung '${ends.slice(-2).join('')}' – klassischer Tarntrick.`);
    }
    const erw = ERWARTET[endung];
    if (erw && typ !== 'unbekannt' && erw !== typ) bericht.add(['exe', 'html'].includes(typ) ? 'hoch' : 'mittel', 'Dateityp', `Endung '${endung}' passt nicht zum tatsächlichen Inhalt (${typ}).`);

    if (typ === 'pdf') await pruefePdf(bericht, b);
    else if (typ === 'ooxml') await pruefeOoxml(bericht, b, endung);
    else if (typ === 'ole') pruefeOle(bericht, b);
    else if (typ === 'rtf') { if (/\\objdata|\\objupdate|\\objocx|\\objemb/.test(latin1(b))) bericht.add('hoch', 'Aktive Inhalte', 'RTF enthält eingebettete Objekte (häufiger Exploit-Weg).'); }
    else if (typ === 'jpeg' || typ === 'png') pruefeBild(bericht, b, typ);
    else if (typ === 'zip') pruefeZip(bericht, b);
    else if (typ === 'exe') bericht.add('hoch', 'Dateityp', 'Die Datei ist ein ausführbares Programm – nicht öffnen!');
    else if (typ === 'html' && !RISKANT.has(endung)) bericht.add('mittel', 'Dateityp', 'HTML-Datei: wird im Browser geöffnet und wird oft für gefälschte Login-Seiten als Anhang verwendet.');

    const sha = bericht.details['SHA-256'];
    if (sha) bericht.details['VirusTotal (manuell prüfen)'] = 'https://www.virustotal.com/gui/file/' + sha;
    if (opt.virustotalKey && sha) await virustotalHash(bericht, sha, opt.virustotalKey);
    else bericht.add('info', 'Virenscan', 'Im Browser ist kein Virenscanner verfügbar – geprüft wurden nur Struktur und Metadaten (Makros, JavaScript, getarnte Programme …). Ohne VirusTotal-Schlüssel kann die Datei über den Link „VirusTotal (manuell prüfen)“ nachgeschlagen werden (es wird nur der Prüfwert übertragen, nicht die Datei).');
    if (opt.online && Array.isArray(bericht.details['Links im PDF'])) await urlsAbgleichen(bericht, bericht.details['Links im PDF'], opt.phishingListe);
    return bericht;
  }

  function pdfString(roh) {
    roh = roh.trim();
    let bin;
    if (roh.startsWith('<') && roh.endsWith('>')) {
      const hex = roh.slice(1, -1).replace(/\s/g, '');
      bin = ''; for (let i = 0; i + 1 < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    } else {
      const s = roh.startsWith('(') ? roh.slice(1, -1) : roh;
      bin = '';
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length) {
          const n = s[i + 1];
          const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
          if (map[n]) { bin += map[n]; i++; }
          else if (/[0-7]/.test(n)) { const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; bin += String.fromCharCode(parseInt(m, 8) & 0xFF); i += m.length; }
          else if (n === '\n' || n === '\r') i++;
          else { bin += n; i++; }
        } else bin += c;
      }
    }
    if (bin.startsWith('\xfe\xff')) return dekodiere(binZuBytes(bin.slice(2)), 'utf-16be');
    if (bin.startsWith('\xff\xfe')) return dekodiere(binZuBytes(bin.slice(2)), 'utf-16le');
    return bin;
  }
  function pdfDatum(s) {
    const m = /(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?/.exec((s || '').trim());
    if (!m) return null;
    const [, j, mo, t, h, mi, se, tz, tzh, tzm] = m;
    let ms = Date.UTC(+j, (+mo || 1) - 1, +t || 1, +h || 0, +mi || 0, +se || 0);
    if ((tz === '+' || tz === '-') && tzh) { const d = ((+tzh) * 60 + (+tzm || 0)) * 60000; ms += tz === '+' ? -d : d; }
    return new Date(ms);
  }
  const isoDatum = (s) => { const t = Date.parse((s || '').trim()); return isNaN(t) ? null : new Date(t); };
  const fmt = (d) => d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function pruefePdf(bericht, b) {
    const roh = latin1(b);
    const kopf = /%PDF-(\d\.\d)/.exec(roh.slice(0, 1024));
    if (kopf) bericht.details['PDF-Version'] = kopf[1];
    if (!roh.startsWith('%PDF-')) bericht.add('niedrig', 'Struktur', 'Vor dem PDF-Kopf stehen zusätzliche Daten (ungewöhnlich).');

    const teile = [roh];
    let gesamt = 0;
    const re = /stream\r?\n/g; let m;
    while ((m = re.exec(roh)) && gesamt < 60 * 1024 * 1024) {
      const start = m.index + m[0].length;
      const ende = roh.indexOf('endstream', start);
      if (ende < 0) break;
      const ent = await inflate(b.subarray(start, ende));
      if (ent) { gesamt += ent.length; teile.push(latin1(ent)); }
      re.lastIndex = ende;
    }
    const alles = teile.join('\n');

    const info = {};
    for (const k of ['Title', 'Author', 'Creator', 'Producer', 'CreationDate', 'ModDate']) {
      const treffer = [...alles.matchAll(new RegExp('/' + k + '\\s*(\\((?:\\\\[\\s\\S]|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)', 'g'))];
      if (treffer.length) { info[k] = pdfString(treffer[treffer.length - 1][1]); bericht.details['Info/' + k] = info[k]; }
    }
    const xmp = {};
    for (const tag of ['xmp:CreateDate', 'xmp:ModifyDate', 'xmp:CreatorTool', 'pdf:Producer']) {
      const t = [...alles.matchAll(new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'g')), ...alles.matchAll(new RegExp('\\b' + tag + '="([^"]*)"', 'g'))];
      if (t.length) { xmp[tag] = dekodiere(binZuBytes(t[t.length - 1][1]), 'utf-8'); bericht.details['XMP/' + tag] = xmp[tag]; }
    }
    const verlauf = [...new Set([...alles.matchAll(/<stEvt:softwareAgent>([^<]*)</g), ...alles.matchAll(/stEvt:softwareAgent="([^"]*)"/g)].map(x => x[1]))];
    if (verlauf.length) bericht.details['XMP-Bearbeitungsverlauf'] = verlauf.sort();
    if (!Object.keys(info).length && !Object.keys(xmp).length) bericht.add('info', 'Metadaten', 'Keine Metadaten vorhanden – wurden evtl. entfernt (bei offiziellen Dokumenten eher ungewöhnlich, aber kein Beweis).');

    const erstellt = info.CreationDate ? pdfDatum(info.CreationDate) : null;
    const geaendert = info.ModDate ? pdfDatum(info.ModDate) : null;
    const jetzt = Date.now();
    if (erstellt && geaendert) {
      if (geaendert - erstellt < -60000) bericht.add('mittel', 'Metadaten', 'Änderungsdatum liegt VOR dem Erstellungsdatum – inkonsistent.');
      else if (geaendert - erstellt > 120000) bericht.add('niedrig', 'Metadaten', `Dokument wurde nach der Erstellung geändert (erstellt ${fmt(erstellt)}, geändert ${fmt(geaendert)}).`);
    }
    [['Erstellungsdatum', erstellt], ['Änderungsdatum', geaendert]].forEach(([l, d]) => { if (d && d - jetzt > 86400000) bericht.add('mittel', 'Metadaten', `${l} liegt in der Zukunft (${fmt(d)}).`); });
    const xmpErstellt = xmp['xmp:CreateDate'] ? isoDatum(xmp['xmp:CreateDate']) : null;
    if (erstellt && xmpErstellt && Math.abs(erstellt - xmpErstellt) > 3600000) bericht.add('niedrig', 'Metadaten', 'Erstellungsdatum im Info-Dictionary und in den XMP-Daten weichen voneinander ab – tritt auf, wenn ein Werkzeug nur einen Teil der Metadaten aktualisiert.');

    const werkzeuge = [info.Creator, info.Producer, xmp['xmp:CreatorTool'], xmp['pdf:Producer'], ...verlauf].filter(Boolean).join(' | ').toLowerCase();
    const gefunden = PDF_EDITOREN.filter(e => werkzeuge.includes(e)).sort();
    if (gefunden.length) bericht.add('mittel', 'Bearbeitung', `Mit PDF-Bearbeitungs-/Grafiksoftware verarbeitet: ${gefunden.join(', ')}. Bei Rechnungen, Kontoauszügen oder Bescheiden, die direkt aus einem System des Ausstellers stammen sollten, ist das verdächtig.`);

    const eofPos = [...roh.matchAll(/%%EOF/g)].map(x => x.index + 5);
    const eofs = eofPos.length;
    bericht.details['Speicherstände (%%EOF)'] = eofs;
    let inhaltErgaenzt = false;
    if (eofs > 1) {
      for (let i = 0; i < eofs - 1; i++) if (/\d+\s+\d+\s+obj\b/.test(roh.slice(eofPos[i], eofPos[i + 1]))) inhaltErgaenzt = true;
      if (inhaltErgaenzt) bericht.add('niedrig', 'Bearbeitung', `Die Datei enthält ${eofs} Speicherstände – nach dem ersten Speichern wurden Inhalte ergänzt oder verändert (auch bei Signaturen, ausgefüllten Formularen oder Nachbearbeitung durch Programme normal).`);
      else bericht.add('info', 'Bearbeitung', `Die Datei enthält ${eofs} Speicherstände, nachträglich wurden aber nur Verwaltungsdaten ergänzt (keine Inhalte) – unkritisch.`);
    }

    const subsets = {};
    for (const x of alles.matchAll(/\/BaseFont\s*\/([A-Z]{6})\+([^\s\/\[\]<>()]+)/g)) (subsets[x[2]] = subsets[x[2]] || new Set()).add(x[1]);
    const mehrfach = Object.keys(subsets).filter(k => subsets[k].size > 1).sort();
    if (mehrfach.length) bericht.add(inhaltErgaenzt || gefunden.length ? 'niedrig' : 'info', 'Bearbeitung', `Dieselbe Schrift ist mehrfach als separate Teilmenge eingebettet (${mehrfach.slice(0, 5).join(', ')}) – kann auf nachträglich eingefügten Text hinweisen, entsteht aber auch beim normalen Export aus Word oder beim Zusammenfügen von PDFs.`);

    if (/\/(JavaScript|JS)\b/.test(alles)) bericht.add('hoch', 'Aktive Inhalte', 'PDF enthält JavaScript.');
    if (/\/Launch\b/.test(alles)) bericht.add('hoch', 'Aktive Inhalte', 'PDF enthält eine /Launch-Aktion (kann Programme starten).');
    if (/\/EmbeddedFiles?\b/.test(alles)) bericht.add('mittel', 'Aktive Inhalte', 'PDF enthält eingebettete Dateien.');
    if (/\/OpenAction\b|\/AA\b/.test(alles) && /\/(JavaScript|JS|Launch|URI|SubmitForm)\b/.test(alles)) bericht.add('mittel', 'Aktive Inhalte', 'PDF führt beim Öffnen automatisch eine Aktion aus.');
    if (/\/XFA\b/.test(alles)) bericht.add('niedrig', 'Aktive Inhalte', 'PDF enthält XFA-Formulare.');
    const uris = [...new Set([...alles.matchAll(/\/URI\s*\(([^)]*)\)/g)].map(x => x[1]))].sort();
    if (uris.length) bericht.details['Links im PDF'] = uris;

    const br = [...roh.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
    if (br.length) {
      bericht.add('info', 'Signatur', `${br.length} digitale Signatur(en) gefunden. Die kryptografische Gültigkeit wird hier NICHT geprüft – dafür z. B. das Signaturfenster in Adobe Acrobat Reader verwenden.`);
      for (const x of br) {
        const [a, , c, d] = [+x[1], +x[2], +x[3], +x[4]];
        if (a !== 0 || c + d > b.length) { bericht.add('mittel', 'Signatur', 'Signatur-ByteRange ist fehlerhaft/ungewöhnlich.'); continue; }
        const rest = roh.slice(c + d);
        if (rest.replace(/[\s\x00%EOF]/g, '')) bericht.add('mittel', 'Signatur', `Nach einer Signatur wurden noch ${rest.length} Bytes angehängt – Inhalte wurden nach dem Signieren ergänzt (legitim z. B. bei weiteren Signaturen; sonst verdächtig). Im Reader prüfen, welche Änderungen nach der Signatur erfolgten.`);
      }
    }
  }

  const xmlText = (xml, tag) => { const m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]*)</' + tag + '>').exec(xml); return m ? entities(m[1]).trim() : ''; };

  async function pruefeOoxml(bericht, b, endung) {
    const eintraege = zipEintraege(b);
    if (!eintraege) { bericht.add('mittel', 'Struktur', 'Office-Datei ist beschädigt (ZIP nicht lesbar).'); return; }
    const namen = eintraege.map(e => e.name), klein = namen.map(n => n.toLowerCase());
    const lies = async (n) => { const e = eintraege.find(x => x.name === n); if (!e) return null; const d = await zipLesen(b, e); return d ? dekodiere(d, 'utf-8') : null; };

    const core = await lies('docProps/core.xml');
    let erstellt = null, geaendert = null;
    if (core) {
      const felder = { 'Autor': 'dc:creator', 'Zuletzt geändert von': 'cp:lastModifiedBy', 'Erstellt': 'dcterms:created', 'Geändert': 'dcterms:modified', 'Revision': 'cp:revision', 'Titel': 'dc:title' };
      const w = {};
      for (const [l, t] of Object.entries(felder)) { const v = xmlText(core, t); if (v) { w[l] = v; bericht.details[l] = v; } }
      erstellt = w['Erstellt'] ? isoDatum(w['Erstellt']) : null;
      geaendert = w['Geändert'] ? isoDatum(w['Geändert']) : null;
      if (w['Autor'] && w['Zuletzt geändert von'] && w['Autor'] !== w['Zuletzt geändert von']) bericht.add('info', 'Metadaten', `Erstellt von '${w['Autor']}', zuletzt geändert von '${w['Zuletzt geändert von']}'.`);
    } else bericht.add('info', 'Metadaten', 'Keine Dokumenteigenschaften (core.xml) vorhanden.');
    const app = await lies('docProps/app.xml');
    if (app) for (const [l, t] of [['Anwendung', 'Application'], ['Version', 'AppVersion'], ['Firma', 'Company'], ['Bearbeitungszeit (Min.)', 'TotalTime']]) { const v = xmlText(app, t); if (v) bericht.details[l] = v; }
    if (erstellt && geaendert && geaendert - erstellt < -60000) bericht.add('mittel', 'Metadaten', 'Änderungsdatum liegt vor dem Erstellungsdatum – inkonsistent.');
    [['Erstellungsdatum', erstellt], ['Änderungsdatum', geaendert]].forEach(([l, d]) => { if (d && d - Date.now() > 86400000) bericht.add('mittel', 'Metadaten', `${l} liegt in der Zukunft (${fmt(d)}).`); });

    const makros = klein.some(n => n.endsWith('vbaproject.bin'));
    if (makros) bericht.add('hoch', 'Aktive Inhalte', 'Dokument enthält VBA-Makros.');
    if (klein.some(n => n.includes('activex'))) bericht.add('mittel', 'Aktive Inhalte', 'Dokument enthält ActiveX-Steuerelemente.');
    const eingebettet = namen.filter(n => /\/embeddings\//i.test(n) || /oleobject/i.test(n));
    if (eingebettet.length) { bericht.add('mittel', 'Aktive Inhalte', `Dokument enthält ${eingebettet.length} eingebettete Objekte.`); bericht.details['Eingebettete Objekte'] = eingebettet; }

    const externe = [];
    for (const n of namen.filter(n => n.endsWith('.rels'))) {
      const x = await lies(n); if (!x) continue;
      for (const r of x.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        const attr = (a) => { const m = new RegExp('\\b' + a + '="([^"]*)"').exec(r[1]); return m ? entities(m[1]) : ''; };
        if (attr('TargetMode') !== 'External') continue;
        const typ = attr('Type').split('/').pop(), ziel = attr('Target');
        externe.push(`${typ}: ${ziel}`);
        if (['attachedTemplate', 'oleObject', 'frame', 'subDocument'].includes(typ) && /^(https?|file|\\\\)/i.test(ziel)) bericht.add('hoch', 'Aktive Inhalte', `Externer Verweis vom Typ '${typ}' auf ${ziel} – bekannte Technik, um beim Öffnen Schadcode nachzuladen.`);
      }
    }
    if (externe.length) bericht.details['Externe Verweise'] = externe;

    const dok = await lies('word/document.xml');
    if (dok) {
      const ins = (dok.match(/<w:ins /g) || []).length, del = (dok.match(/<w:del /g) || []).length;
      if (ins || del) bericht.add('info', 'Bearbeitung', `Nachverfolgte Änderungen enthalten (${ins} Einfügungen, ${del} Löschungen).`);
    }
    if (klein.some(n => n.endsWith('comments.xml'))) bericht.add('info', 'Bearbeitung', 'Dokument enthält Kommentare.');
    if (klein.some(n => n.startsWith('_xmlsignatures/'))) bericht.add('info', 'Signatur', 'Dokument ist digital signiert (Gültigkeit hier nicht geprüft).');
    if (['.docx', '.xlsx', '.pptx'].includes(endung) && makros) bericht.add('mittel', 'Dateityp', 'Makros in einer Datei mit makrofreier Endung – ungewöhnlich.');
  }

  function pruefeOle(bericht, b) {
    bericht.add('info', 'Dateityp', 'Altes Office-Format (OLE). Die Analyse ist hier eingeschränkt.');
    const s = latin1(b);
    const u16 = (t) => t.split('').join('\x00') + '\x00';
    if (['_VBA_PROJECT', u16('_VBA_PROJECT'), u16('Macros'), u16('VBA')].some(m => s.includes(m))) bericht.add('hoch', 'Aktive Inhalte', 'Datei enthält vermutlich VBA-Makros.');
    if (s.includes('Equation.3') || s.includes(u16('Equation Native'))) bericht.add('hoch', 'Aktive Inhalte', 'Enthält Formel-Editor-Objekt (bekannter Exploit-Vektor).');
    if (s.includes(u16('Ole10Native')) || s.includes(u16('ObjectPool'))) bericht.add('mittel', 'Aktive Inhalte', 'Enthält eingebettete OLE-Objekte.');
  }

  function pruefeZip(bericht, b) {
    const e = zipEintraege(b);
    if (!e) { bericht.add('mittel', 'Struktur', 'ZIP-Archiv ist beschädigt.'); return; }
    bericht.details['Inhalt des Archivs'] = e.map(x => x.name);
    if (e.some(x => x.flags & 1)) bericht.add('mittel', 'Archiv', 'Archiv ist passwortgeschützt – wird oft genutzt, um Virenscanner zu umgehen.');
    const bad = e.map(x => x.name).filter(n => GEFAEHRLICH.has(endungVon(n)) || MAKRO.has(endungVon(n)));
    if (bad.length) bericht.add('hoch', 'Archiv', `Archiv enthält ${bad.length} gefährliche Datei(en): ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ' …' : ''}`);
  }

  function exifAusTiff(t) {
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const le = t[0] === 0x49 && t[1] === 0x49;
    if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return {};
    const namen = { 0x010F: 'Hersteller', 0x0110: 'Modell', 0x0131: 'Software', 0x0132: 'Änderungsdatum', 0x9003: 'Aufnahmedatum' };
    const erg = {};
    const ifd = (off, tiefe) => {
      if (tiefe > 2 || off + 2 > t.length) return;
      const n = Math.min(dv.getUint16(off, le), 500);
      for (let i = 0; i < n; i++) {
        const p = off + 2 + i * 12; if (p + 12 > t.length) return;
        const tag = dv.getUint16(p, le), typ = dv.getUint16(p + 2, le), count = dv.getUint32(p + 4, le), wert = dv.getUint32(p + 8, le);
        if (tag === 0x8769) ifd(wert, tiefe + 1);
        else if (namen[tag] && typ === 2) {
          const roh = count <= 4 ? t.subarray(p + 8, p + 8 + count) : t.subarray(wert, wert + count);
          erg[namen[tag]] = latin1(roh).split('\x00')[0].trim();
        }
      }
    };
    try { ifd(dv.getUint32(4, le), 0); } catch (e) { /* defekte EXIF-Daten */ }
    return erg;
  }
  function pruefeBild(bericht, b, typ) {
    let exif = {};
    if (typ === 'jpeg') {
      let p = 2;
      while (p + 4 <= b.length && b[p] === 0xFF) {
        const marker = b[p + 1], laenge = (b[p + 2] << 8) | b[p + 3];
        if (marker === 0xE1 && latin1(b, p + 4, p + 10) === 'Exif\x00\x00') { exif = exifAusTiff(b.subarray(p + 10, p + 2 + laenge)); break; }
        if (marker === 0xDA) break;
        p += 2 + laenge;
      }
    } else {
      for (const m of latin1(b).matchAll(/tEXt(Software|Creation Time)\x00([^\x00]{1,200})/g)) exif[m[1]] = m[2];
    }
    Object.assign(bericht.details, exif);
    if (!Object.keys(exif).length) bericht.add('info', 'Metadaten', 'Keine EXIF-Daten – bei Fotos direkt von der Kamera ungewöhnlich; entsteht aber auch durch Messenger, soziale Netzwerke oder Screenshots.');
    const kette = ((exif.Software || '') + ' ' + latin1(b, 0, Math.min(65536, b.length))).toLowerCase();
    const ed = BILD_EDITOREN.filter(e => kette.includes(e)).sort();
    if (ed.length) bericht.add('niedrig', 'Bearbeitung', `Bild wurde mit Bildbearbeitung gespeichert (${ed.join(', ')}). Das beweist keine Fälschung, zeigt aber, dass es nicht unverändert aus der Kamera stammt.`);
    if (exif['Aufnahmedatum'] && exif['Änderungsdatum'] && exif['Aufnahmedatum'] !== exif['Änderungsdatum']) bericht.add('info', 'Metadaten', `Aufnahme (${exif['Aufnahmedatum']}) und letzte Änderung (${exif['Änderungsdatum']}) unterscheiden sich.`);
  }

  // ======================================================================
  // Einstufung (Betrugsmaschen)
  // ======================================================================
  const KATEGORIEN = [
    ['Phishing (Datendiebstahl)', [/konto (wurde |ist )?(gesperrt|eingeschränkt|deaktiviert)/, /verifizier/, /bestätigen sie ihr/, /daten (aktualisieren|abgleichen|bestätigen)/,
      /anmelde|einloggen|login/, /passwort|kennwort/, /sicherheits(überprüfung|update|hinweis)/, /ungewöhnliche aktivität|verdächtige aktivität/, /pushtan|photo ?tan|\btan\b/,
      /kreditkarte|kartendaten/, /verify your|account (suspended|locked)/, /sign in|confirm your/],
      'Nicht auf Links klicken und nichts eingeben. Direkt über die offizielle App/Website anmelden. Falls schon Daten eingegeben: sofort Passwort ändern bzw. Bank anrufen und Karte/Zugang sperren lassen.'],
    ['Betrug: Paket-/Zustellmasche', [/paket|sendung|zustellung/, /zollgebühr|zollgebuehr|versandgebühr|nachgebühr/, /konnte nicht zugestellt/, /neue zustellung|zustellversuch/, /lieferadresse/],
      'Sendungsstatus nur in der offiziellen App oder auf der offiziellen Website des Paketdienstes prüfen.'],
    ['Betrug: Chef-/CEO-Masche', [/vertraulich|diskret/, /(bin|sitze) (gerade )?(in einem|im) meeting|nicht erreichbar/, /überweisung|ueberweisung|zahlung ausführen/,
      /gutschein|geschenkkarte|gift card|itunes|google play/, /sind sie (am platz|verfügbar)|kurze frage/, /chef|geschäftsführ|ceo/],
      'Immer über eine bekannte Telefonnummer beim angeblichen Absender rückfragen. Keine Zahlung auf Mail-Anweisung.'],
    ['Betrug: geänderte Bankverbindung', [/neue(n)? (bankverbindung|iban|kontoverbindung)/, /(bankverbindung|iban|konto) (hat sich )?geändert/, /bitte nur noch auf/,
      /alte(s)? konto (ist )?(nicht mehr|gesperrt)/, /\biban\b/],
      'Neue Bankverbindung NIE per Mail übernehmen – telefonisch unter bekannter Nummer bestätigen lassen.'],
    ['Betrug: Vorschuss/Erbschaft/Gewinn', [/erbschaft|nachlass|verstorben/, /gewinner|gewonnen|lotterie|gewinnspiel/, /millionen|million/, /bearbeitungsgebühr|vorab ?gebühr|gebühr (von|in höhe)/,
      /inheritance|beneficiary|lottery/, /treuhänder|anwalt des verstorbenen/, /spende|stiftung/],
      'Nicht antworten, nichts zahlen, keine Ausweiskopien senden.'],
    ['Erpressung (Sextortion)', [/webcam|kamera/, /video|aufnahme/, /bitcoin|btc|krypto|wallet/, /(gerät|geraet|computer|konto) gehackt|hacked/, /porn|erwachsenen|intime/,
      /48 stunden|24 stunden/, /kontakte (schicken|senden)|an (alle )?ihre kontakte/],
      'Nicht zahlen, nicht antworten – solche Mails sind fast immer Massenbluff. Wird ein altes Passwort genannt: dieses überall ändern.'],
    ['Betrug: Fake-Inkasso/Mahnung', [/inkasso/, /mahnung|letzte zahlungsaufforderung/, /pfändung|gerichtsvollzieher|zwangsvollstreckung|exekution/, /offene(n)? forderung/, /schufa|ksv/,
      /anwalt|rechtsanwalt|kanzlei/, /mahnbescheid|zahlungsbefehl/],
      'Prüfen, ob die Forderung überhaupt existiert (Vertrag, Rechnung?). Echte gerichtliche Schreiben kommen per Post, nicht per Mail.'],
    ['Betrug: Anlage/Krypto', [/rendite|garantiert(e|er)? gewinn/, /trading|investment|investier/, /krypto|bitcoin|ethereum/, /passives einkommen/, /broker|plattform/],
      'Anbieter bei der Finanzaufsicht (FMA in Österreich, BaFin in Deutschland) prüfen, inkl. deren Warnlisten. Kein Geld senden.'],
    ['Betrug: Job/Finanzagent', [/nebenjob|homeoffice[- ]job|von zu hause/, /(pro|die) stunde verdienen|€ ?pro (tag|stunde)/, /finanzagent|zahlungsabwickler/, /keine erfahrung (nötig|erforderlich)/, /whatsapp|telegram/],
      'Nie Geld über das eigene Konto weiterleiten (Geldwäsche!), keine Ausweisdaten per Video-Ident an Unbekannte.'],
    ['Spam/Werbung', [/newsletter/, /abmelden|abbestellen|unsubscribe/, /angebot|rabatt|sale|gutscheincode/, /jetzt kaufen/],
      'Bei seriösem Absender abmelden, sonst als Spam markieren und löschen.'],
  ];

  function klassifizieren(bericht, text, hatLinks) {
    text = text.toLowerCase();
    const technischUnauffaellig = RANG[bericht.hoechsteStufe()] <= RANG.niedrig;
    const dmarcOk = bericht.befunde.some(b => b.stufe === 'ok' && b.text.includes('DMARC bestanden'));
    const befunde = bericht.befunde.concat(...bericht.unterberichte.map(u => u.befunde));
    const alleTexte = befunde.map(b => b.text).join(' ');
    const hat = (s, k) => befunde.some(b => b.stufe === s && b.kategorie === k);
    const schadsoftware = befunde.some(b => b.stufe === 'hoch' && ['Anhang', 'Dateityp', 'Aktive Inhalte', 'Virenscan', 'Archiv'].includes(b.kategorie)) || alleTexte.includes('SCHADSOFTWARE');
    const phishingDb = alleTexte.includes('PHISHING');
    const gefaelscht = hat('hoch', 'Authentifizierung') || hat('hoch', 'Absender');
    const linkTrick = hat('hoch', 'Links');

    const punkte = {}, gruende = {};
    for (const [name, muster] of KATEGORIEN) {
      const t = muster.map(re => { const m = re.exec(text); return m ? m[0].trim() : null; }).filter(Boolean);
      punkte[name] = t.length; gruende[name] = t.slice(0, 5).map(x => `Formulierung im Text: „${x}“`);
    }
    const ph = 'Phishing (Datendiebstahl)';
    if (hatLinks) punkte[ph] += 0.5;
    if (linkTrick) { punkte[ph] += 3; gruende[ph].push('Link-Täuschung erkannt'); }
    if (befunde.some(b => ['Absender', 'Links'].includes(b.kategorie) && /Marke|imitiert|ähnelt stark|Subdomain/.test(b.text))) { punkte[ph] += 1.5; gruende[ph].push('Adresse gibt sich als bekannte Marke aus'); }
    if (phishingDb) { punkte[ph] += 5; gruende[ph].push('Link steht in Phishing-Datenbank'); }
    if (gefaelscht) for (const k in punkte) if (k !== 'Spam/Werbung' && punkte[k] >= 2) { punkte[k] += 1.5; gruende[k].push('Absender gefälscht/getarnt'); }

    let erg = [];
    if (schadsoftware) erg.push(['Schadsoftware-Verteilung', 10, ['Gefährlicher Anhang, Makro oder aktive Inhalte'], 'Anhang auf keinen Fall öffnen. Falls schon geöffnet: Gerät vom Netz trennen und mit aktuellem Virenscanner prüfen, IT informieren.']);
    for (const [name, , rat] of KATEGORIEN) if (punkte[name] >= 2) erg.push([name, punkte[name], gruende[name], rat]);
    erg.sort((a, b) => b[1] - a[1]);
    if (erg.length > 1) erg = erg.filter(e => e[0] !== 'Spam/Werbung');

    if (!erg.length) {
      const s = bericht.hoechsteStufe();
      bericht.details['Einstufung'] = s === 'hoch' ? 'Verdächtig (Art unklar)' : s === 'mittel' ? 'Unklar – einzelne Auffälligkeiten' : 'Keine typische Betrugsmasche erkannt';
      return;
    }
    const [name, p, gr, rat] = erg[0];
    const sicherheit = p >= 5 ? 'hoch' : p >= 3 ? 'mittel' : 'niedrig';
    bericht.details['Einstufung'] = `${name} (Sicherheit der Einstufung: ${sicherheit})`;
    if (erg.length > 1) bericht.details['Weitere mögliche Einstufungen'] = erg.slice(1, 4).map(e => e[0]);
    bericht.details['Gründe für die Einstufung'] = gr;
    bericht.details['Empfehlung'] = rat;
    if (name === 'Spam/Werbung') return;
    if (technischUnauffaellig && dmarcOk) {
      bericht.add('niedrig', 'Einstufung', `Der Text ähnelt der Masche '${name}', technisch ist die Mail aber unauffällig und stammt nachweislich von der Absenderdomain. Trotzdem Links nicht blind folgen, sondern direkt über App/Website nachsehen.`);
      return;
    }
    bericht.add(sicherheit === 'hoch' ? 'hoch' : 'mittel', 'Einstufung', `Wahrscheinlich: ${name}`);
  }

  // ======================================================================
  // E-Mail-Prüfung
  // ======================================================================
  const DRUCK = ['dringend', 'sofort', 'innerhalb von 24 stunden', 'innerhalb von 48 stunden', 'konto wurde gesperrt', 'konto gesperrt', 'eingeschränkt', 'verifizieren sie',
    'bestätigen sie ihre', 'ihre daten aktualisieren', 'letzte mahnung', 'ungewöhnliche aktivität', 'verdächtige aktivität', 'passwort läuft ab', 'rückerstattung', 'gewinn',
    'sie haben gewonnen', 'inkasso', 'pfändung', 'urgent', 'immediately', 'verify your account', 'account suspended', 'unusual activity', 'confirm your identity',
    'password expires', 'final notice', 'gift card', 'geschenkkarte', 'bitcoin', 'überweisung heute noch'];

  function markeImNamen(name, dom) {
    const k = (name || '').toLowerCase().replace(/[^a-z0-9äöü-]/g, ' ');
    for (const m of MARKEN) if (m.length >= 4 && new RegExp(`\\b${reEsc(m)}\\b`).test(k) && !dom.replace(/-/g, '').includes(m.replace(/-/g, ''))) return m;
    return null;
  }

  function pruefeInhalt(bericht, html, text, betreff) {
    const alle = links(html);
    for (const u of (text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [])) alle.push([u, '']);
    const hosts = new Set(), urls = [], gemeldet = new Set();
    const melde = (s, t) => { if (!gemeldet.has(s + t)) { gemeldet.add(s + t); bericht.add(s, 'Links', t); } };
    for (let [href, anzeige] of alle) {
      const k = href.toLowerCase();
      if (/^(mailto:|tel:|#|cid:)/.test(k)) continue;
      if (/^(javascript:|data:|vbscript:)/.test(k)) { melde('hoch', `Link mit ausführbarem Inhalt: ${href.slice(0, 80)}`); continue; }
      const host = hostAusUrl(href);
      if (!host) continue;
      hosts.add(host); urls.push(href);
      const netloc = (href.split('//')[1] || '').split('/')[0];
      if (netloc.includes('@')) melde('hoch', `Link-Trick mit '@' in der Adresse: ${href.slice(0, 100)} (Ziel ist in Wahrheit '${host}').`);
      if (istIp(host)) melde('mittel', `Link führt direkt zu einer IP-Adresse: ${href.slice(0, 100)}`);
      if (KURZLINKS.has(host)) melde('niedrig', `Kurzlink verschleiert das Ziel: ${href.slice(0, 100)}`);
      lookalike(host).forEach(([s, t]) => melde(s, t));
      const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[\/:?#]|$)/i.exec(anzeige || '');
      if (m && !/^[\d.]+$/.test(m[1]) && !gleicheOrg(m[1].toLowerCase(), host)) melde('hoch', `Angezeigter Link '${anzeige.slice(0, 60)}' führt in Wahrheit zu '${host}'.`);
    }
    bericht.details['Link-Ziele (Domains)'] = [...hosts].sort();
    for (const a of formulare(html)) melde('hoch', `Mail enthält ein Formular (Ziel: ${a || 'unbekannt'}) – echte Firmen fragen keine Daten per Formular in der Mail ab.`);
    const gesamt = (betreff + ' ' + text + ' ' + ohneTags(html)).toLowerCase();
    const tr = DRUCK.filter(f => gesamt.includes(f)).sort();
    if (tr.length) bericht.add(tr.length < 3 ? 'niedrig' : 'mittel', 'Inhalt', `Typische Druck-/Lockformulierungen gefunden: ${tr.slice(0, 8).join(', ')}.`);
    if (/(passwort|password|pin|tan\b|kreditkarte|iban|credit card)/.test(gesamt) && alle.length) bericht.add('niedrig', 'Inhalt', 'Mail spricht Zugangs- oder Zahlungsdaten an und enthält Links.');
    return { gesamt, urls };
  }

  async function pruefeMail(daten, name, opt = {}) {
    const bytes = alsBytes(daten);
    const bin = latin1(bytes);
    const bericht = new Bericht('E-Mail-Prüfung', name || 'mail.eml');
    const wurzel = parseTeil(bin.replace(/^\s+/, ''));
    const k = wurzel.kopf;
    if (!k.liste.length) { bericht.add('mittel', 'Format', 'Keine Header gefunden – ist das wirklich eine E-Mail im Originalformat?'); return bericht; }

    const [vonName, vonAdr] = adresse(k.get('from'));
    const vonDom = domainAusAdresse(vonAdr);
    const [, antwortAdr] = adresse(k.get('reply-to'));
    const [, rp] = adresse(k.get('return-path'));
    const rpDom = domainAusAdresse(rp);
    const msgId = k.get('message-id');
    const msgidDom = msgId.includes('@') ? msgId.split('@').pop().replace(/[\s>]+$/, '').toLowerCase() : '';
    const betreff = dekodiereWorte(k.get('subject'));
    Object.assign(bericht.details, {
      'Betreff': betreff, 'Absender (From)': vonName ? `${vonName} <${vonAdr}>` : vonAdr, 'Antwort an (Reply-To)': antwortAdr,
      'Return-Path': rp, 'Datum': k.get('date'), 'Message-ID': msgId,
    });

    // --- Absender ---
    if (!vonAdr || !vonAdr.includes('@')) bericht.add('mittel', 'Absender', 'Keine gültige Absenderadresse (From) vorhanden.');
    else {
      if (k.getAll('from').length > 1) bericht.add('hoch', 'Absender', 'Mehrere From-Header – typischer Trick, um Prüfungen zu umgehen.');
      lookalike(vonDom).forEach(([s, t]) => bericht.add(s, 'Absender', t));
      for (const a of (vonName.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [])) if (a.toLowerCase() !== vonAdr.toLowerCase()) bericht.add('hoch', 'Absender', `Anzeigename zeigt die Adresse '${a}', tatsächlich gesendet von '${vonAdr}'.`);
      const mk = markeImNamen(vonName, vonDom);
      if (mk) bericht.add('mittel', 'Absender', `Anzeigename nennt '${mk}', die Absenderdomain '${vonDom}' passt aber nicht dazu.`);
      const aDom = domainAusAdresse(antwortAdr);
      if (aDom && !gleicheOrg(aDom, vonDom)) {
        bericht.add('mittel', 'Absender', `Antworten gehen an eine andere Domain (${aDom}) als der Absender (${vonDom}) – häufig bei Betrugsmails (bei Newslettern teils normal).`);
        lookalike(aDom).forEach(([s, t]) => bericht.add(s, 'Absender', t));
      }
      if (rpDom && !gleicheOrg(rpDom, vonDom)) bericht.add('info', 'Absender', `Return-Path-Domain (${rpDom}) weicht vom Absender ab – bei Versanddienstleistern normal, entscheidend ist das DMARC-Ergebnis.`);
      if (msgidDom && msgidDom.includes('.') && !gleicheOrg(msgidDom, vonDom) && !gleicheOrg(msgidDom, rpDom)) bericht.add('info', 'Absender', `Message-ID stammt von einer anderen Domain (${msgidDom}).`);
    }

    // --- Authentifizierung (nur oberster Header ist vertrauenswürdig) ---
    const ar = k.getAll('authentication-results');
    const dkimDomains = k.getAll('dkim-signature').map(s => (/\bd\s*=\s*([^;\s]+)/.exec(s) || [])[1]).filter(Boolean).map(s => s.toLowerCase());
    bericht.details['DKIM-signierende Domains'] = dkimDomains;
    if (!ar.length) {
      bericht.add('mittel', 'Authentifizierung', "Kein 'Authentication-Results'-Header gefunden. SPF/DKIM/DMARC-Ergebnisse fehlen – bitte die Mail als Original (.eml bzw. 'Original anzeigen') verwenden.");
    } else {
      const a = ar[0].replace(/\s+/g, ' ');
      bericht.details['Authentication-Results (oberster)'] = a.length > 300 ? a.slice(0, 300) + '…' : a;
      const e = {};
      for (const m of a.matchAll(/\b(spf|dkim|dmarc|arc)\s*=\s*([a-zA-Z]+)/gi)) {
        const mech = m[1].toLowerCase(), res = m[2].toLowerCase();
        if (!(mech in e) || res === 'pass') e[mech] = res;
      }
      bericht.details['SPF'] = e.spf || '–'; bericht.details['DKIM'] = e.dkim || '–'; bericht.details['DMARC'] = e.dmarc || '–';
      if (e.dmarc === 'pass') bericht.add('ok', 'Authentifizierung', `DMARC bestanden: Die Mail wurde nachweislich über Server versendet, die '${vonDom}' autorisiert hat (schützt nicht vor gehackten Konten oder ähnlich aussehenden Domains).`);
      else if (e.dmarc === 'fail' || e.dmarc === 'permerror') bericht.add('hoch', 'Authentifizierung', `DMARC FEHLGESCHLAGEN – die Absenderadresse '${vonDom}' ist sehr wahrscheinlich gefälscht.`);
      else bericht.add('niedrig', 'Authentifizierung', 'Kein aussagekräftiges DMARC-Ergebnis (Domain hat evtl. keine DMARC-Richtlinie).');
      if (['fail', 'softfail', 'permerror'].includes(e.spf)) bericht.add(e.dmarc === 'pass' ? 'info' : (e.spf === 'fail' ? 'hoch' : 'mittel'), 'Authentifizierung', `SPF-Ergebnis: ${e.spf} – sendender Server nicht autorisiert.`);
      else if (e.spf === 'pass') bericht.add('ok', 'Authentifizierung', 'SPF bestanden.');
      if (e.dkim === 'fail') bericht.add(e.dmarc === 'pass' ? 'info' : 'mittel', 'Authentifizierung', 'DKIM-Signatur ungültig – Mail wurde evtl. unterwegs verändert.');
      else if (e.dkim === 'pass') bericht.add('ok', 'Authentifizierung', 'DKIM-Signatur gültig.');
      else if (!e.dkim || e.dkim === 'none') bericht.add('niedrig', 'Authentifizierung', 'Keine DKIM-Signatur geprüft/vorhanden.');
    }
    if (dkimDomains.length && vonDom && !dkimDomains.some(x => gleicheOrg(x, vonDom))) bericht.add('info', 'Authentifizierung', `DKIM-Signatur stammt nicht von der Absenderdomain (${dkimDomains.join(', ')}) – bei Versanddienstleistern möglich.`);

    // --- Zustellweg ---
    const rec = k.getAll('received').map(r => r.replace(/\s+/g, ' '));
    bericht.details['Anzahl Zustell-Stationen (Received)'] = rec.length;
    if (!rec.length) bericht.add('mittel', 'Zustellweg', 'Keine Received-Header – Zustellweg nicht nachvollziehbar.');
    else {
      const zeiten = rec.map(r => { const i = r.lastIndexOf(';'); return i >= 0 ? datum(r.slice(i + 1)) : null; });
      for (let i = 0; i < zeiten.length - 1; i++) {
        if (zeiten[i] && zeiten[i + 1] && zeiten[i + 1] - zeiten[i] > 600000) { bericht.add('niedrig', 'Zustellweg', 'Zeitstempel im Zustellweg sind nicht chronologisch – Hinweis auf gefälschte Received-Header oder falsch gehende Server-Uhren.'); break; }
      }
      const erste = [...zeiten].reverse().find(Boolean), letzte = zeiten.find(Boolean);
      if (erste && letzte && letzte - erste > 12 * 3600000) bericht.add('info', 'Zustellweg', `Zustellung dauerte ungewöhnlich lange (${Math.round((letzte - erste) / 3600000)} Stunden).`);
      bericht.details['Erste Station (Ursprung)'] = rec[rec.length - 1].slice(0, 200);
      const ip = /\[(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+:[0-9a-fA-F:]+)\]/.exec(rec[rec.length - 1]);
      if (ip) bericht.details['Ursprungs-IP (laut Header)'] = ip[1];
      const d = datum(k.get('date'));
      if (!d) bericht.add('niedrig', 'Zustellweg', 'Date-Header fehlt oder ist ungültig.');
      else if (letzte) {
        if (d - letzte > 3600000) bericht.add('mittel', 'Zustellweg', 'Das Sendedatum liegt NACH dem Empfang – manipuliert?');
        else if (letzte - d > 2 * 86400000) bericht.add('niedrig', 'Zustellweg', 'Sendedatum liegt mehr als 2 Tage vor dem Empfang.');
      }
    }

    // --- Inhalt ---
    const bl = blaetter(wurzel);
    const htmlTeile = [], textTeile = [], anhaenge = [];
    for (const t of bl) {
      const istAnhang = t.disposition === 'attachment' || (t.dateiname && t.disposition !== 'inline') || t.typ === 'message/rfc822';
      if (!istAnhang && t.typ === 'text/html') htmlTeile.push(dekodiere(t.bytes, t.charset));
      else if (!istAnhang && t.typ === 'text/plain') textTeile.push(dekodiere(t.bytes, t.charset));
      else if (istAnhang || t.dateiname) anhaenge.push(t);
    }
    const { gesamt, urls } = pruefeInhalt(bericht, htmlTeile.join('\n'), textTeile.join('\n'), betreff);
    if (opt.online) await urlsAbgleichen(bericht, urls, opt.phishingListe);

    // --- Anhänge ---
    const namen = [];
    for (const t of anhaenge) {
      const dn = t.dateiname || (t.typ === 'message/rfc822' ? 'weitergeleitete_mail.eml' : 'unbenannter_anhang');
      namen.push(`${dn} (${t.typ})`);
      const e = endungVon(dn);
      if (GEFAEHRLICH.has(e) || MAKRO.has(e)) bericht.add('hoch', 'Anhang', `Gefährlicher Anhang: ${dn}`);
      if (dn.includes('‮')) bericht.add('hoch', 'Anhang', `Dateiname enthält Richtungs-Umkehrzeichen (Tarnung): ${dn}`);
      if (opt.anhaengePruefen !== false && (opt._tiefe || 0) < 3) {
        const unter = (t.typ === 'message/rfc822' || e === '.eml')
          ? await pruefeMail(t.bytes, dn, { ...opt, _tiefe: (opt._tiefe || 0) + 1 })
          : await pruefeDokument(t.bytes, dn, opt);
        bericht.unterberichte.push(unter);
      }
    }
    bericht.details['Anhänge'] = namen;
    klassifizieren(bericht, gesamt, urls.length > 0);
    return bericht;
  }

  // ======================================================================
  // Eingefügter Text
  // ======================================================================
  function istVollstaendigeMail(text) {
    const kopf = String(text || '').replace(/^\s+/, '').slice(0, 20000).replace(/\r\n/g, '\n').split('\n\n')[0];
    return /^From:/m.test(kopf) && /^(Received|Message-ID|Authentication-Results|Return-Path):/im.test(kopf);
  }

  async function pruefeText(text, opt = {}) {
    if (istVollstaendigeMail(text)) return pruefeMail(text.replace(/^\s+/, ''), 'eingefügte Mail (Original)', opt);
    const bericht = new Bericht('Text-Prüfung (ohne Mail-Header)', 'eingefügter Text');
    bericht.add('info', 'Eingeschränkt', "Nur Text ohne technische Kopfzeilen: Ob der Absender echt ist (SPF/DKIM/DMARC), kann so NICHT geprüft werden. Außerdem gehen beim Kopieren die echten Ziele von Buttons/Links oft verloren. Für eine vollständige Prüfung die Mail im Original einfügen (Gmail: ⋮ → 'Original anzeigen'; Outlook: Datei → Eigenschaften → Internetkopfzeilen) oder als .eml anhängen.");
    const m = /^\s*(?:von|from|absender)\s*:\s*(.+)$/im.exec(text);
    if (m) {
      const [n, a] = adresse(m[1]);
      if (a.includes('@')) {
        bericht.details['Absender (laut Text)'] = m[1].trim();
        const dom = domainAusAdresse(a);
        lookalike(dom).forEach(([s, t]) => bericht.add(s, 'Absender', t));
        const mk = markeImNamen(n, dom);
        if (mk) bericht.add('mittel', 'Absender', `Anzeigename nennt '${mk}', die Adresse '${a}' passt nicht dazu.`);
        if (FREEMAIL.has(dom)) bericht.add('niedrig', 'Absender', `Absender nutzt einen Freemail-Dienst (${dom}) – Firmen und Behörden tun das normalerweise nicht.`);
      }
    }
    const istHtml = /<(a|p|div|html|table)\b/i.test(text);
    const { gesamt, urls } = pruefeInhalt(bericht, istHtml ? text : '', istHtml ? '' : text, '');
    if (opt.online) await urlsAbgleichen(bericht, urls, opt.phishingListe);
    klassifizieren(bericht, gesamt, urls.length > 0);
    return bericht;
  }

  global.Echtheitspruefer = { pruefeMail, pruefeText, pruefeDokument, istVollstaendigeMail, ladePhishingListe, Bericht, _intern: { lookalike, orgDomain, parseTeil, zipEintraege } };
})(typeof window !== 'undefined' ? window : globalThis);

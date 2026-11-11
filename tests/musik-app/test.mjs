// Browser-Tests der Musik-App gegen den nachgebauten Home Assistant.
//   cd tests/musik-app && npm install && node test.mjs [--shots <ordner>]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startMock } from './mock-ha.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;

const mock = await startMock({ port: 0, quiet: true });
const APP = `${mock.url}/local/musik/index.html`;
const browser = await chromium.launch();
const errors = [];
let passed = 0;

// Attrappe für die Sendspin-Bibliothek: meldet sich beim Test-Server nur mit ihrem Namen an.
// (Die echte Bibliothek wurde getrennt gegen einen echten Sendspin-Server geprüft.)
const SENDSPIN_STUB = `
export class SendspinPlayer {
  constructor(cfg) { this.cfg = cfg; this.unlocked = 0; this.isConnected = false; window.__sendspin = this; }
  async unlock() { this.unlocked++; }
  async connect() {
    const u = new URL(this.cfg.baseUrl);
    const ws = new WebSocket((u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + u.pathname.replace(/\\/$/, '') + '/sendspin');
    this.ws = ws;
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Sendspin-Attrappe: keine Verbindung')); });
    ws.send(JSON.stringify({ type: 'hello', name: this.cfg.clientName, product: this.cfg.productName }));
    this.isConnected = true;
  }
  disconnect() { if (this.ws) this.ws.close(); this.isConnected = false; }
  get isPlaying() { return false; }
}`;

async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.log('  FEHLER', name); console.log(e); process.exitCode = 1; }
}
const lastCall = (pred) => [...mock.state.calls].reverse().find(pred);
const waitCall = async (page, pred) => {
  for (let i = 0; i < 60; i++) { const c = lastCall(pred); if (c) return c; await page.waitForTimeout(50); }
  throw new Error('Aufruf nicht gesehen');
};
const IGNORED = /broken\.jpg|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|:8927\/sendspin/;

async function newPage(opts = { viewport: { width: 1280, height: 860 } }) {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/vendor/sendspin.js', (r) => r.fulfill({ contentType: 'text/javascript', body: SENDSPIN_STUB }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.test(m.text() + ' ' + (m.location()?.url || ''))) errors.push(m.text()); });
  return page;
}
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const sheetNames = (page) => page.$$eval('#sheetBody .sheet-item .name', (els) => els.map((e) => e.textContent));

console.log('Musik-App – Browser-Tests');
const page = await newPage();

await test('Anmeldung über die Home-Assistant-Anmeldeseite', async () => {
  await page.goto(APP);
  await page.waitForSelector('#login:not([hidden])');
  assert.equal(await page.inputValue('#hassUrl'), mock.url, 'Adresse vorausgefüllt');
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not([hidden])');
  assert.ok(mock.state.calls.some((c) => c.auth === 'authorization_code'));
  assert.ok(!page.url().includes('code='), 'Code aus der Adresse entfernt');
});

await test('Startseite: Schnellzugriff, Reihen und Mini-Player', async () => {
  await page.waitForFunction(() => document.querySelectorAll('#home .quick:not(.skeleton)').length === 8);
  await page.waitForFunction(() => !document.querySelector('#home .skeleton'));
  const titles = await page.$$eval('#home .shelf-title', (h) => h.map((x) => x.textContent));
  assert.deepEqual(titles, ['Zuletzt gehört', 'Neu in deiner Bibliothek', 'Künstler aus deiner Bibliothek', 'Radiosender', 'Wiederentdecken']);
  assert.match(await page.textContent('#home .greeting'), /^Gute/);
  assert.equal(await page.textContent('#pageTitle'), 'Start');
  assert.equal(await page.textContent('#deviceName'), 'AMBEO Soundbar Plus', 'spielender Player automatisch gewählt');
  await page.waitForSelector('#mini:not([hidden])');
  assert.equal(await page.textContent('#miniTitle'), "I'm on Your Side");
  assert.match(await page.textContent('#miniSub'), /The Glorious Sons · AMBEO/);
  const recent = lastCall((c) => c.service === 'get_library' && c.data.order_by === 'last_played_desc' && c.data.media_type === 'album');
  assert.equal(recent.data.config_entry_id, '01TESTENTRY');
  await shot(page, 'desktop-start');
});

await test('Wiedergabe-Ansicht öffnen und steuern', async () => {
  assert.equal(await page.isVisible('#now'), false);
  await page.click('#miniOpen');
  await page.waitForSelector('#now:not([hidden])');
  assert.equal(await page.textContent('#nowTitle'), "I'm on Your Side");
  assert.equal(await page.textContent('#nowArtist'), 'The Glorious Sons');
  assert.equal(await page.textContent('#nowDevice'), 'AMBEO Soundbar Plus');
  await page.waitForSelector('#nowArt:not([hidden])');
  assert.match(await page.getAttribute('#nowArt', 'src'), /\/api\/media_player_proxy\//);
  assert.equal(await page.textContent('#durTime'), '3:45');
  assert.equal(await page.isVisible('#powerBtn'), false, 'kein Ein/Aus bei Playern, die das nicht können');
  await shot(page, 'desktop-wiedergabe');

  await page.click('#playBtn');
  const c = await waitCall(page, (x) => x.service === 'media_pause');
  assert.deepEqual(c.target, { entity_id: 'media_player.ambeo_soundbar_plus_cast' });
  await page.waitForFunction(() => document.querySelector('#playBtn').getAttribute('aria-label') === 'Wiedergabe');
  await page.click('#playBtn');
  await waitCall(page, (x) => x.service === 'media_play');

  await page.$eval('#volume', (v) => { v.value = '42'; v.dispatchEvent(new Event('input')); v.dispatchEvent(new Event('change')); });
  await waitCall(page, (x) => x.service === 'volume_set' && x.data.volume_level === 0.42);
  await page.click('#shuffleBtn');
  assert.equal((await waitCall(page, (x) => x.service === 'shuffle_set')).data.shuffle, false);
  await page.click('#repeatBtn');
  assert.equal((await waitCall(page, (x) => x.service === 'repeat_set')).data.repeat, 'all');
  const box = await page.locator('#progressBar').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const seek = await waitCall(page, (x) => x.service === 'media_seek');
  assert.ok(Math.abs(seek.data.seek_position - 112) <= 2, `Position ${seek.data.seek_position}`);
});

await test('Warteschlange: aktueller und nächster Titel', async () => {
  await page.click('#queueBtn');
  await page.waitForSelector('#sheetBody .queue-item');
  const text = await page.textContent('#sheetBody');
  assert.match(text, /Titel 5 von 18/);
  assert.match(text, /Läuft gerade.*I'm on Your Side/s);
  assert.match(text, /Als Nächstes.*Move Along/s);
  assert.match(text, /und 12 weitere Titel/);
  assert.deepEqual((await waitCall(page, (x) => x.service === 'get_queue')).target, { entity_id: 'media_player.ambeo_soundbar_plus_cast' });
  await shot(page, 'desktop-warteschlange');
  await page.keyboard.press('Escape');
  await page.click('#nextBtn');
  await waitCall(page, (x) => x.service === 'media_next_track');
  await page.waitForFunction(() => document.querySelector('#nowTitle').textContent === 'Move Along');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#now', { state: 'hidden' });
});

await test('Gerät wechseln und Wiedergabe mitnehmen', async () => {
  await page.click('#deviceBtn');
  assert.deepEqual(await sheetNames(page), ['Dieses Gerät', 'AMBEO Soundbar Plus', 'BRAVIA', 'Küche']);
  assert.match(await page.textContent('#sheetBody'), /1 nicht erreichbare/);
  await page.click('#sheetBody .sheet-item[data-entity="media_player.kuche_2"] .grow-btn');
  await page.waitForSelector('#sheet', { state: 'hidden' });
  assert.equal(await page.textContent('#deviceName'), 'Küche');
  await page.click('#toast button');
  const t = await waitCall(page, (x) => x.service === 'transfer_queue');
  assert.deepEqual(t.target, { entity_id: 'media_player.kuche_2' });
  assert.equal(t.data.source_player, 'media_player.ambeo_soundbar_plus_cast');
  await page.waitForFunction(() => /Move Along/.test(document.querySelector('#miniTitle').textContent)
    && /Küche/.test(document.querySelector('#miniSub').textContent));
});

await test('Lautsprecher gruppieren und wieder lösen', async () => {
  await page.click('#miniDevice');
  const ambeo = '#sheetBody .sheet-item[data-entity="media_player.ambeo_soundbar_plus_cast"]';
  await page.click(`${ambeo} .group-btn`);
  const j = await waitCall(page, (x) => x.service === 'join');
  assert.deepEqual(j.target, { entity_id: 'media_player.kuche_2' });
  assert.deepEqual(j.data.group_members, ['media_player.ambeo_soundbar_plus_cast']);
  await page.waitForSelector(`${ambeo} .group-btn.active`);
  assert.equal(await page.$$eval('#sheetBody .row-volume', (r) => r.length), 2, 'Lautstärke je Raum');
  assert.equal(await page.textContent('#deviceName'), 'Küche');
  assert.match(await page.textContent('#miniSub'), /Küche \+ 1/);
  await page.$eval(`${ambeo} + .row-volume input`, (v) => { v.value = '33'; v.dispatchEvent(new Event('input')); v.dispatchEvent(new Event('change')); });
  const v = await waitCall(page, (x) => x.service === 'volume_set' && x.data.volume_level === 0.33);
  assert.deepEqual(v.target, { entity_id: 'media_player.ambeo_soundbar_plus_cast' });
  await shot(page, 'desktop-geraete');
  await page.waitForTimeout(900);
  await page.click(`${ambeo} .group-btn`);
  assert.deepEqual((await waitCall(page, (x) => x.service === 'unjoin')).target, { entity_id: 'media_player.ambeo_soundbar_plus_cast' });
  await page.waitForSelector(`${ambeo} .group-btn:not(.active)`);
  await page.keyboard.press('Escape');
});

await test('Dieses Gerät: ohne Admin-Rechte verständliche Meldung', async () => {
  mock.state.admin = false;
  await page.click('#deviceBtn');
  await page.click('#localRow .grow-btn');
  await page.waitForSelector('#sheetBody .hint.error');
  assert.match(await page.textContent('#sheetBody .hint.error'), /Admin-Konto/);
  assert.equal(mock.state.sendspinClients.length, 0);
  mock.state.admin = true;
});

await test('Dieses Gerät: als Lautsprecher anmelden und Musik darauf starten', async () => {
  await page.click('#localRow .grow-btn');
  await page.waitForFunction(() => document.querySelector('#deviceName').textContent === 'Dieses Gerät', null, { timeout: 15000 });
  assert.deepEqual(mock.state.sendspinClients, ['Browser (Musik-App)']);
  assert.ok(mock.state.calls.some((c) => c.supervisor === '/ingress/session'));
  const cfg = await page.evaluate(() => ({ product: window.__sendspin.cfg.productName, base: window.__sendspin.cfg.baseUrl, unlocked: window.__sendspin.unlocked }));
  assert.equal(cfg.product, 'Musik-App', 'nicht „Web Player“, sonst gibt Music Assistant das Gerät nicht an HA weiter');
  assert.match(cfg.base, /\/api\/hassio_ingress\/TESTINGRESSTOKEN$/);
  assert.ok(cfg.unlocked > 0, 'Ton wurde per Nutzeraktion freigeschaltet');
  assert.ok(await page.$eval('#deviceBtn', (b) => b.classList.contains('local')));
  await page.keyboard.press('Escape');

  await page.click('.tab[data-tab=search]');
  await page.fill('#searchInput', 'antenne');
  await page.click('#searchResults .card:has-text("Antenne Vorarlberg") .card-hit');
  const c = await waitCall(page, (x) => x.service === 'play_media' && x.data.media_id === 'tunein://radio/s1');
  assert.deepEqual(c.target, { entity_id: 'media_player.browser_musik_app' });
  await page.waitForFunction(() => /Dieses Gerät/.test(document.querySelector('#miniSub').textContent));

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#deviceName').textContent === 'Dieses Gerät', null, { timeout: 15000 });
  assert.equal(mock.state.sendspinClients.length, 2, 'nach Neuladen automatisch wieder verbunden');
  await page.click('#deviceBtn');
  await page.waitForSelector('#localRow.selected');
  assert.ok(!(await sheetNames(page)).includes('Browser (Musik-App)'), 'eigenes Gerät nicht doppelt in der Liste');
  await shot(page, 'desktop-dieses-geraet');
  await page.click('#localRow .btn');
  await page.waitForFunction(() => document.querySelector('#deviceName').textContent !== 'Dieses Gerät');
  await page.keyboard.press('Escape');
});

await test('Bibliothek: Playlists laden, nachladen, kaputte Bilder, Favoriten', async () => {
  await page.click('.tab[data-tab=library]');
  assert.equal(await page.textContent('#pageTitle'), 'Bibliothek');
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 50);
  await page.locator('#libMore').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 60);
  await page.waitForFunction(() => document.querySelectorAll('#libList div.card-art').length >= 8, null, { timeout: 5000 });
  await page.click('#libFav');
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 12);
  await page.click('#libFav');
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 50);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'desktop-bibliothek');
});

await test('„Alle anzeigen“ führt in die passende Bibliotheksansicht', async () => {
  await page.click('.tab[data-tab=home]');
  await page.click('#home [data-shelf=new] .shelf-more');
  await page.waitForSelector('#libList .card:has-text("Classic Queen")');
  assert.equal(await page.inputValue('#libOrder'), 'timestamp_added_desc');
  assert.equal(await page.textContent('#libTypes .chip.active'), 'Alben');
});

await test('Album öffnen und einzelnen Titel abspielen', async () => {
  await page.click('#libList .card:has-text("1000 Jahre EAV") .card-hit');
  await page.waitForSelector('#detail .row:has-text("Woodstock")');
  assert.equal(await page.$$eval('#detail .row', (r) => r.length), 3);
  assert.equal(await page.textContent('#detail .row .row-num'), '1');
  await page.click('#detail .row:has-text("Woodstock") .row-main');
  const c = await waitCall(page, (x) => x.service === 'play_media' && x.data.media_id === 'apple_music://track/148812351');
  assert.equal(c.data.media_type, 'track');
  await page.click('#detail .btn.primary');
  const all = await waitCall(page, (x) => x.service === 'play_media' && x.data.media_id === 'library://album/4356');
  assert.equal(all.data.enqueue, 'replace');
  assert.equal(all.data.media_type, 'album');
  await page.click('#backBtn');
  await page.waitForSelector('#view-library:not([hidden])');
});

await test('Künstler → Alben → Album (verschachtelt)', async () => {
  await page.click('#libTypes .chip:has-text("Künstler")');
  await page.click('#libList .card:has-text("Queen") .card-hit');
  await page.waitForSelector('#detail .card:has-text("Innuendo")');
  await page.click('#detail .card:has-text("Innuendo") .card-hit');
  await page.waitForSelector('#detail .detail-title:has-text("Queen - Innuendo")');
  await page.waitForSelector('#detail .row');
  await page.click('#backBtn');
  await page.waitForSelector('#detail .detail-title:text-is("Queen")');
  await page.click('#backBtn');
});

await test('Suche mit Gruppen und „Als Nächstes“', async () => {
  await page.click('.tab[data-tab=search]');
  await page.fill('#searchInput', 'queen');
  await page.waitForSelector('#searchResults h3:has-text("Künstler")');
  const titles = await page.$$eval('#searchResults h3', (h) => h.map((x) => x.textContent));
  assert.deepEqual(titles, ['Künstler', 'Alben', 'Titel', 'Radio']);
  await page.click('#searchResults .row:has-text("50ft Queenie") .icon-btn');
  await page.click('#sheetBody .sheet-item:has-text("Als Nächstes")');
  const c = await waitCall(page, (x) => x.service === 'play_media' && x.data.enqueue === 'next');
  assert.equal(c.data.media_id, 'library://track/18335');
  await page.click('#searchTypes .chip:has-text("Radio")');
  await page.waitForFunction(() => document.querySelectorAll('#searchResults h3').length === 0 && document.querySelectorAll('#searchResults .card').length === 1);
});

await test('Warteschlange leeren', async () => {
  await page.click('#miniOpen');
  await page.click('#queueBtn');
  await page.click('#sheetBody .btn.danger');
  await waitCall(page, (x) => x.service === 'clear_playlist');
  await page.waitForFunction(() => /Die Warteschlange ist leer/.test(document.querySelector('#sheetBody').textContent));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#nowTitle').textContent === 'Nichts in der Wiedergabe');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#mini'), false, 'Mini-Player verschwindet ohne Musik');
});

await test('Verbindung bricht ab und wird wiederhergestellt', async () => {
  mock.dropConnections();
  await page.waitForSelector('#banner:not([hidden])');
  await page.waitForSelector('#banner[hidden]', { state: 'attached', timeout: 8000 });
  await page.click('#deviceBtn');
  await page.click('#sheetBody .sheet-item[data-entity="media_player.bravia"] .grow-btn');
  await page.click('.tab[data-tab=home]');
  await page.waitForSelector('#home .quick:not(.skeleton)');
  await page.click('#home .quick');
  await page.waitForSelector('#detail .detail-actions');
});

await test('Abmelden, falsches Token, richtiges Token', async () => {
  await page.click('#settingsBtn');
  await page.click('#sheetBody .btn.danger');
  await page.waitForSelector('#login:not([hidden])');
  assert.ok(mock.state.calls.some((c) => c.auth === 'revoke'));
  await page.click('.token-login summary');
  await page.fill('#token', 'falsch');
  await page.click('#tokenBtn');
  await page.waitForSelector('#loginError:not([hidden])');
  assert.match(await page.textContent('#loginError'), /Invalid access token/);
  await page.fill('#token', 'test-token');
  await page.click('#tokenBtn');
  await page.waitForSelector('#app:not([hidden])');
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
});

await test('iPhone: Bedienung passt auf den Bildschirm', async () => {
  // Ausgangslage wie am Anfang: AMBEO spielt
  await mock.state.calls.splice(0);
  const s = mock.state.states['media_player.ambeo_soundbar_plus_cast'];
  Object.assign(s.attributes, { media_title: "I'm on Your Side", media_artist: 'The Glorious Sons', media_album_name: 'A War on Everything',
    media_duration: 225, media_position: 64, media_position_updated_at: new Date().toISOString(), media_content_id: 'x',
    entity_picture_local: '/api/media_player_proxy/media_player.ambeo_soundbar_plus_cast?token=abc' });
  s.state = 'playing';
  mock.state.queues[s.entity_id] = { items: 18, index: 4 };

  const phone = await newPage({ ...devices['iPhone 13'] });
  await phone.goto(APP);
  await phone.click('.token-login summary');
  await phone.fill('#token', 'test-token');
  await phone.click('#tokenBtn');
  await phone.waitForSelector('#app:not([hidden])');
  await phone.waitForFunction(() => !document.querySelector('#home .skeleton') && document.querySelectorAll('#home .quick').length === 8);
  await phone.waitForSelector('#mini:not([hidden])');
  const overflow = () => phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(await overflow(), 0);
  await shot(phone, 'iphone-start');

  await phone.click('#miniOpen');
  await phone.waitForSelector('#nowArt:not([hidden])');
  await phone.waitForTimeout(300);
  const vh = phone.viewportSize().height;
  for (const sel of ['#nowClose', '#playBtn', '#volume', '#queueBtn', '#nowDeviceBtn']) {
    const b = await phone.locator(sel).boundingBox();
    assert.ok(b && b.y >= 0 && b.y + b.height <= vh, `${sel} ist ohne Scrollen sichtbar`);
  }
  await shot(phone, 'iphone-wiedergabe');
  await phone.click('#queueBtn');
  await phone.waitForSelector('#sheetBody .queue-item');
  await shot(phone, 'iphone-warteschlange');
  await phone.click('#sheetBackdrop', { position: { x: 10, y: 10 } });
  await phone.click('#nowDeviceBtn');
  await phone.waitForSelector('#localRow');
  await shot(phone, 'iphone-geraete');
  await phone.click('#sheetBackdrop', { position: { x: 10, y: 10 } });
  await phone.click('#nowClose');

  await phone.click('.tab[data-tab=library]');
  await phone.waitForSelector('#libList .card');
  assert.equal(await overflow(), 0);
  await phone.click('#libTypes .chip:has-text("Alben")');
  await phone.click('#libList .card:has-text("1000 Jahre EAV") .card-hit');
  await phone.waitForSelector('#detail .row');
  assert.equal(await overflow(), 0);
  await shot(phone, 'iphone-album');
  await phone.click('.tab[data-tab=search]');
  await phone.fill('#searchInput', 'queen');
  await phone.waitForSelector('#searchResults h3');
  assert.equal(await overflow(), 0);
  await shot(phone, 'iphone-suche');
});

await test('Keine JavaScript-Fehler', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
await mock.close();
console.log(`${passed} Tests bestanden${process.exitCode ? ', es gab Fehler' : ''}.`);

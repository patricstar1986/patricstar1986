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

async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.log('  FEHLER', name); console.log(e); process.exitCode = 1; }
}
const lastCall = (pred) => [...mock.state.calls].reverse().find(pred);
const waitCall = async (page, pred) => {
  for (let i = 0; i < 50; i++) { const c = lastCall(pred); if (c) return c; await page.waitForTimeout(50); }
  throw new Error('Aufruf nicht gesehen');
};

async function newPage(opts = { viewport: { width: 1280, height: 860 } }) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/broken\.jpg|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT/.test(m.text())) errors.push(m.text()); });
  return page;
}

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
  await page.waitForFunction(() => document.querySelector('#nowTitle').textContent === "I'm on Your Side");
});

await test('Läuft gerade: spielender Player wird automatisch gewählt', async () => {
  assert.equal(await page.textContent('#playerName'), 'AMBEO Soundbar Plus');
  assert.equal(await page.textContent('#nowArtist'), 'The Glorious Sons');
  await page.waitForSelector('#nowArt:not([hidden])');
  assert.match(await page.getAttribute('#nowArt', 'src'), /\/api\/media_player_proxy\//);
  assert.equal(await page.textContent('#durTime'), '3:45');
  assert.equal(await page.getAttribute('#playBtn', 'aria-label'), 'Pause');
  assert.ok(await page.$eval('#shuffleBtn', (b) => b.classList.contains('active')));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-laeuft.png` });
});

await test('Playerauswahl zeigt nur Music-Assistant-Player, die erreichbar sind', async () => {
  await page.click('#playerBtn');
  const names = await page.$$eval('#sheetBody .sheet-item .grow > span:first-child', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ['AMBEO Soundbar Plus', 'Küche']);
  assert.match(await page.textContent('#sheetBody'), /1 nicht erreichbare/);
  await page.click('#sheetBody .sheet-item:has-text("Küche")');
  await page.waitForFunction(() => document.querySelector('#nowTitle').textContent === 'Nichts in der Wiedergabe');
  assert.equal(await page.textContent('#playerName'), 'Küche');
  await page.click('#playerBtn');
  await page.click('#sheetBody .sheet-item:has-text("AMBEO")');
});

await test('Wiedergabe steuern: Pause, Lautstärke, Zufall, Wiederholen, Springen', async () => {
  await page.click('#playBtn');
  const c = await waitCall(page, (x) => x.service === 'media_pause');
  assert.deepEqual(c.target, { entity_id: 'media_player.ambeo_soundbar_plus_cast' });
  await page.waitForFunction(() => document.querySelector('#playBtn').getAttribute('aria-label') === 'Wiedergabe');
  await page.click('#playBtn');
  await waitCall(page, (x) => x.service === 'media_play');

  await page.$eval('#volume', (v) => { v.value = '42'; v.dispatchEvent(new Event('input')); v.dispatchEvent(new Event('change')); });
  const vc = await waitCall(page, (x) => x.service === 'volume_set' && x.data.volume_level === 0.42);
  assert.ok(vc);

  await page.click('#shuffleBtn');
  assert.equal((await waitCall(page, (x) => x.service === 'shuffle_set')).data.shuffle, false);
  await page.click('#repeatBtn');
  assert.equal((await waitCall(page, (x) => x.service === 'repeat_set')).data.repeat, 'all');
  await page.waitForFunction(() => document.querySelector('#repeatBtn').classList.contains('active'));

  const box = await page.locator('#progressBar').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const seek = await waitCall(page, (x) => x.service === 'media_seek');
  assert.ok(Math.abs(seek.data.seek_position - 112) <= 2, `Position ${seek.data.seek_position}`);
  await page.click('#nextBtn');
  await waitCall(page, (x) => x.service === 'media_next_track');
});

await test('Bibliothek: Playlists laden, nachladen, kaputte Bilder, Favoriten', async () => {
  await page.click('.tab[data-tab=library]');
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 50);
  const req = lastCall((x) => x.service === 'get_library');
  assert.equal(req.data.config_entry_id, '01TESTENTRY');
  assert.equal(req.data.media_type, 'playlist');
  await page.locator('#libMore').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 60);
  await page.waitForFunction(() => document.querySelectorAll('#libList div.card-art').length >= 8, null, { timeout: 5000 });
  assert.equal(await page.isVisible('#mini'), true, 'Mini-Player sichtbar');
  await page.click('#libFav');
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 12);
  await page.click('#libFav');
  await page.waitForFunction(() => document.querySelectorAll('#libList .card').length === 50);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-bibliothek.png` });
});

await test('Album öffnen und einzelnen Titel abspielen', async () => {
  await page.click('#libTypes .chip:has-text("Alben")');
  await page.waitForSelector('#libList .card:has-text("Classic Queen")');
  await page.click('#libList .card:has-text("1000 Jahre EAV") .card-hit');
  await page.waitForSelector('#detail .row:has-text("Woodstock")');
  assert.equal(await page.$$eval('#detail .row', (r) => r.length), 3);
  assert.equal(await page.textContent('#detail .row .row-num'), '1');
  await page.click('#detail .row:has-text("Woodstock") .row-main');
  const c = await waitCall(page, (x) => x.service === 'play_media');
  assert.equal(c.data.media_type, 'track');
  assert.equal(c.data.media_id, 'apple_music://track/148812351');
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
  await page.click('#searchResults .card .card-hit');
  const r = await waitCall(page, (x) => x.service === 'play_media' && x.data.media_type === 'radio');
  assert.equal(r.data.enqueue, undefined);
});

await test('Verbindung bricht ab und wird wiederhergestellt', async () => {
  mock.dropConnections();
  await page.waitForSelector('#banner:not([hidden])');
  await page.waitForSelector('#banner[hidden]', { state: 'attached', timeout: 8000 });
  await page.click('.tab[data-tab=now]');
  await page.click('#playBtn');
  await waitCall(page, (x) => x.service === 'media_pause' || x.service === 'media_play');
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

await test('iPhone-Darstellung ohne waagrechtes Scrollen', async () => {
  const phone = await newPage({ ...devices['iPhone 13'] });
  await phone.goto(APP);
  await phone.click('.token-login summary');
  await phone.fill('#token', 'test-token');
  await phone.click('#tokenBtn');
  await phone.waitForSelector('#app:not([hidden])');
  await phone.waitForFunction(() => document.querySelector('#nowTitle').textContent.length > 0 && document.querySelector('#playerName').textContent !== 'Player wählen');
  await phone.waitForTimeout(300);
  const overflow = () => phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(await overflow(), 0);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/iphone-laeuft.png` });
  await phone.click('.tab[data-tab=library]');
  await phone.waitForSelector('#libList .card');
  await phone.waitForTimeout(300);
  assert.equal(await overflow(), 0);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/iphone-bibliothek.png` });
  await phone.click('#libTypes .chip:has-text("Alben")');
  await phone.click('#libList .card:has-text("1000 Jahre EAV") .card-hit');
  await phone.waitForSelector('#detail .row');
  assert.equal(await overflow(), 0);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/iphone-album.png` });
  await phone.click('.tab[data-tab=search]');
  await phone.fill('#searchInput', 'queen');
  await phone.waitForSelector('#searchResults h3');
  await phone.waitForTimeout(300);
  assert.equal(await overflow(), 0);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/iphone-suche.png` });
  await phone.click('#playerBtn');
  await phone.waitForTimeout(400);
  if (SHOTS) await phone.screenshot({ path: `${SHOTS}/iphone-player.png` });
});

await test('Keine JavaScript-Fehler', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
await mock.close();
console.log(`${passed} Tests bestanden${process.exitCode ? ', es gab Fehler' : ''}.`);

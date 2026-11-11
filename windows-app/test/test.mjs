// Tests der Windows-App (Electron) gegen den nachgebauten Home Assistant.
//   Voraussetzung: npm install hier und in ../tests/musik-app
//   Linux ohne Bildschirm: xvfb-run -a node test/test.mjs [--shots <ordner>]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startMock } from '../../tests/musik-app/mock-ha.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;

const mock = await startMock({ port: 0, quiet: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'musik-win-test-'));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.log('  FEHLER', name); console.log(e); process.exitCode = 1; }
}
const launch = () => electron.launch({
  executablePath: require(path.join(APP_DIR, 'node_modules/electron')),
  args: [APP_DIR, '--no-sandbox', `--user-data-dir=${userData}`],
});
const waitCall = async (page, pred) => {
  for (let i = 0; i < 60; i++) { const c = [...mock.state.calls].reverse().find(pred); if (c) return c; await page.waitForTimeout(50); }
  throw new Error('Aufruf nicht gesehen');
};
const clickMenu = (app, top, index) => app.evaluate(({ Menu }, [t, i]) => Menu.getApplicationMenu().items[t].submenu.items[i].click(), [top, index]);

console.log('Musik für Windows – Tests');
let app = await launch();
let page = await app.firstWindow();

await test('Erster Start zeigt die Einrichtung', async () => {
  await page.waitForSelector('#home');
  assert.match(page.url(), /^file:.*setup\.html/);
  await page.waitForFunction(() => document.getElementById('home').value === 'http://homeassistant.local:8123');
  assert.match(await page.textContent('#version'), /Musik für Windows 1\./);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/windows-einrichtung.png` });
});

await test('Falsche Adresse wird verständlich abgelehnt', async () => {
  await page.fill('#home', 'http://127.0.0.1:9');
  await page.click('#save');
  await page.waitForSelector('#message:not([hidden])');
  assert.match(await page.textContent('#message'), /antwortet kein Home Assistant/);
  await page.fill('#home', 'kein gültiger name!');
  await page.click('#save');
  await page.waitForFunction(() => /ungültig/.test(document.getElementById('message').textContent));
});

await test('Richtige Adresse lädt die Musik-App aus Home Assistant', async () => {
  await page.fill('#home', mock.url.replace('http://', '') + '/');   // ohne http:// und mit Schrägstrich eingegeben
  await page.fill('#remote', 'https://beispiel.ui.nabu.casa');
  await page.click('#save');
  await page.waitForURL(`${mock.url}/local/musik/index.html`);
  await page.waitForSelector('#login:not([hidden])');
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => document.getElementById('miniTitle').textContent === "I'm on Your Side");
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Musik');
  assert.equal(await page.evaluate(() => typeof window.musikSetup), 'undefined', 'Seiten aus Home Assistant bekommen keinen Zugriff auf die Einstellungen');
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'einstellungen.json'), 'utf8'));
  assert.equal(saved.home, mock.url);
  assert.equal(saved.remote, 'https://beispiel.ui.nabu.casa');
  if (SHOTS) { await page.waitForFunction(() => !document.querySelector('#home .skeleton')); await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/windows-start.png` }); }
});

await test('Wiedergabe-Befehle aus Windows (Menü, Medientasten, Taskleiste) steuern den Player', async () => {
  await clickMenu(app, 1, 0);
  const c = await waitCall(page, (x) => x.service === 'media_pause');
  assert.deepEqual(c.target, { entity_id: 'media_player.ambeo_soundbar_plus_cast' });
  await clickMenu(app, 1, 1);
  await waitCall(page, (x) => x.service === 'media_next_track');
  const keys = await app.evaluate(({ globalShortcut }) => ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack'].map((k) => globalShortcut.isRegistered(k)));
  console.log('        Medientasten registriert:', keys.join(', '), '(unter Linux/Xvfb evtl. nicht möglich)');
});

await test('Fremde Adressen werden nicht im Fenster geöffnet', async () => {
  await app.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__extern = url; }; });
  await page.evaluate(() => { location.href = 'https://example.com/irgendwo'; });
  await page.waitForTimeout(600);
  assert.equal(page.url(), `${mock.url}/local/musik/index.html`);
  assert.equal(await app.evaluate(() => globalThis.__extern), 'https://example.com/irgendwo');
});

await test('Nach Neustart direkt in der App, Anmeldung bleibt erhalten', async () => {
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForURL(`${mock.url}/local/musik/index.html`);
  await page.waitForSelector('#app:not([hidden])');
});

await test('Home Assistant nicht erreichbar → Einrichtung mit Hinweis; Adressen ändern über das Menü', async () => {
  await app.close();
  const cfgFile = path.join(userData, 'einstellungen.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, home: 'http://127.0.0.1:9', remote: '' }));
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('#message:not([hidden])');
  assert.match(await page.textContent('#message'), /nicht erreichbar/);
  await page.fill('#home', mock.url);
  await page.click('#save');
  await page.waitForURL(`${mock.url}/local/musik/index.html`);
  await clickMenu(app, 0, 0);
  await page.waitForURL(/setup\.html/);
  assert.equal(await page.inputValue('#home'), mock.url);
});

await app.close();
await mock.close();
fs.rmSync(userData, { recursive: true, force: true });
console.log(`${passed} Tests bestanden${process.exitCode ? ', es gab Fehler' : ''}.`);

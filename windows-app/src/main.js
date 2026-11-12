// Musik für Windows: ein Fenster, das die Musik-App aus Home Assistant lädt
// (/local/musik/). Updates der Oberfläche kommen damit automatisch aus Home Assistant.
const { app, BrowserWindow, Menu, shell, globalShortcut, ipcMain, nativeImage, nativeTheme, net, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_PATH = '/local/musik/index.html';
const PROBE_PATH = '/local/musik/manifest.webmanifest';
const SETUP_FILE = path.join(__dirname, 'setup.html');

// Musik soll ohne zusätzlichen Klick starten können („Dieses Gerät“).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Medientasten behandelt die App selbst (siehe registerMediaKeys), nicht Chromium.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// ---------- Einstellungen ----------
const configFile = () => path.join(app.getPath('userData'), 'einstellungen.json');
let config = { home: '', remote: '', mediaKeys: true, bounds: null, maximized: false };

function loadConfig() {
  try { Object.assign(config, JSON.parse(fs.readFileSync(configFile(), 'utf8'))); } catch { /* erster Start */ }
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch (e) { console.error('Einstellungen konnten nicht gespeichert werden:', e.message); }
}

/** "homeassistant.local:8123/" → "http://homeassistant.local:8123"; ungültig → '' */
function normalizeUrl(input) {
  let u = String(input || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  try {
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.origin;
  } catch { return ''; }
}

const bases = () => [config.home, config.remote].filter(Boolean);
const allowedOrigin = (url) => { try { return bases().includes(new URL(url).origin); } catch { return false; } };

// ---------- Erreichbarkeit ----------
/** @returns {Promise<'ok'|'fehlt'|'weg'>} App vorhanden / HA da, aber App-Dateien fehlen / nicht erreichbar */
async function probe(base, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(base + PROBE_PATH, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok ? 'ok' : 'fehlt';
  } catch {
    return 'weg';
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Fenster ----------
let win = null;
let currentBase = '';

function createWindow() {
  const b = config.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1180,
    height: b.height || 800,
    x: b.x, y: b.y,
    minWidth: 380, minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101114' : '#f6f6f8',
    title: 'Musik',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (config.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    config.maximized = win.isMaximized();
    if (!config.maximized && !win.isMinimized() && !win.isFullScreen()) config.bounds = win.getBounds();
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', () => { remember(); saveConfig(); });
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  // Nur Home Assistant (und die eigene Einrichtungsseite) im Fenster; alles andere im Standardbrowser.
  const guard = (event, url) => {
    if (url.startsWith('file:') || allowedOrigin(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* abgebrochen */ || url.startsWith('file:')) return;
    showSetup(`Die Seite konnte nicht geladen werden (${desc}).`);
  });
  wc.on('page-title-updated', (e) => e.preventDefault()); // Fenstertitel bleibt „Musik“
  wc.on('did-finish-load', updateThumbar);
  return win;
}

function showSetup(message = '') {
  currentBase = '';
  if (!win) createWindow();
  win.loadFile(SETUP_FILE, { query: message ? { meldung: message } : {} });
}

async function openApp() {
  if (!win) createWindow();
  if (!bases().length) { showSetup(); return; }
  let missing = '';
  for (const base of bases()) {
    const r = await probe(base);
    if (r === 'ok') {
      currentBase = base;
      // Startseite immer frisch aus Home Assistant holen, nie aus dem Zwischenspeicher
      // (sonst bleibt nach einem Update in /config/www/musik die alte Version stehen).
      await win.loadURL(base + APP_PATH, { extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache\n' }).catch(() => {});
      return;
    }
    if (r === 'fehlt') missing = base;
  }
  showSetup(missing
    ? `Home Assistant ist unter ${missing} erreichbar, aber die Musik-App fehlt dort. Die Dateien müssen in /config/www/musik/ liegen.`
    : 'Home Assistant ist unter den eingetragenen Adressen nicht erreichbar.');
}

// ---------- Steuerung aus Windows heraus (Medientasten, Taskleiste) ----------
const CLICK = {
  play: "document.getElementById('playBtn')?.click()",
  next: "document.getElementById('nextBtn')?.click()",
  prev: "document.getElementById('prevBtn')?.click()",
};
function control(action) {
  if (!win || win.isDestroyed() || !currentBase) return;
  win.webContents.executeJavaScript(CLICK[action], true).catch(() => {});
}

function registerMediaKeys() {
  globalShortcut.unregisterAll();
  if (!config.mediaKeys) return;
  const map = { MediaPlayPause: 'play', MediaNextTrack: 'next', MediaPreviousTrack: 'prev' };
  for (const [key, action] of Object.entries(map)) {
    try { globalShortcut.register(key, () => control(action)); } catch { /* von anderem Programm belegt */ }
  }
}

function updateThumbar() {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return;
  if (!currentBase) { win.setThumbarButtons([]); return; }
  const theme = nativeTheme.shouldUseDarkColors ? 'hell' : 'dunkel';
  const img = (n) => nativeImage.createFromPath(path.join(__dirname, 'thumbar', `${n}-${theme}.png`));
  win.setThumbarButtons([
    { tooltip: 'Zurück', icon: img('prev'), click: () => control('prev') },
    { tooltip: 'Wiedergabe / Pause', icon: img('play'), click: () => control('play') },
    { tooltip: 'Weiter', icon: img('next'), click: () => control('next') },
  ]);
}
nativeTheme.on('updated', updateThumbar);

// ---------- Menü (mit Alt einblenden) ----------
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '&Musik',
      submenu: [
        { label: 'Adressen ändern …', accelerator: 'Ctrl+,', click: () => showSetup() },
        { label: 'Neu laden', accelerator: 'F5', click: () => openApp() },
        {
          label: 'Neu laden ohne Zwischenspeicher', accelerator: 'Ctrl+F5',
          click: async () => { await session.defaultSession.clearCache(); openApp(); },
        },
        { type: 'separator' },
        {
          label: 'Medientasten der Tastatur verwenden', type: 'checkbox', checked: config.mediaKeys,
          click: (item) => { config.mediaKeys = item.checked; saveConfig(); registerMediaKeys(); },
        },
        { type: 'separator' },
        { label: 'Beenden', role: 'quit' },
      ],
    },
    {
      label: '&Wiedergabe',
      submenu: [
        { label: 'Wiedergabe / Pause', accelerator: 'Ctrl+P', click: () => control('play') },
        { label: 'Nächster Titel', accelerator: 'Ctrl+Right', click: () => control('next') },
        { label: 'Vorheriger Titel', accelerator: 'Ctrl+Left', click: () => control('prev') },
      ],
    },
    {
      label: '&Ansicht',
      submenu: [
        { label: 'Vergrößern', role: 'zoomIn', accelerator: 'Ctrl+Plus' },
        { label: 'Verkleinern', role: 'zoomOut' },
        { label: 'Normale Größe', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Vollbild', role: 'togglefullscreen' },
        { label: 'Entwicklerwerkzeuge', role: 'toggleDevTools' },
      ],
    },
  ]));
}

// ---------- Einrichtungsseite ----------
ipcMain.handle('setup:get', () => ({ home: config.home, remote: config.remote, version: app.getVersion() }));
ipcMain.handle('setup:save', async (event, data) => {
  if (!event.senderFrame || !event.senderFrame.url.startsWith('file:')) return { ok: false, error: 'Nicht erlaubt.' };
  const home = normalizeUrl(data && data.home);
  const remote = normalizeUrl(data && data.remote);
  if ((data && data.home && !home) || (data && data.remote && !remote)) return { ok: false, error: 'Eine der Adressen ist ungültig.' };
  if (!home && !remote) return { ok: false, error: 'Bitte mindestens eine Adresse eintragen.' };
  const results = {};
  for (const base of [home, remote].filter(Boolean)) results[base] = await probe(base);
  const reachable = Object.entries(results).find(([, r]) => r === 'ok');
  if (!reachable) {
    const missing = Object.entries(results).find(([, r]) => r === 'fehlt');
    return {
      ok: false,
      error: missing
        ? `Home Assistant antwortet unter ${missing[0]}, aber die Musik-App fehlt dort. Die Dateien müssen in /config/www/musik/ liegen.`
        : 'Unter dieser Adresse antwortet kein Home Assistant. Stimmt die Adresse, und ist der PC im selben Netz?',
    };
  }
  config.home = home;
  config.remote = remote;
  saveConfig();
  setImmediate(openApp);
  return { ok: true };
});

// ---------- Start ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('musik.musicassistant.windows');
    loadConfig();
    // Nach einem Update des Windows-Programms einmal den Zwischenspeicher leeren.
    if (config.lastVersion !== app.getVersion()) {
      await session.defaultSession.clearCache().catch(() => {});
      config.lastVersion = app.getVersion();
      saveConfig();
    }
    // Die Seite braucht keine Sonderrechte (Kamera, Standort, Benachrichtigungen …).
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    buildMenu();
    registerMediaKeys();
    createWindow();
    openApp();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}

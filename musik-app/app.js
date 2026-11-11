// Musik – Music Assistant über Home Assistant steuern und direkt am Gerät hören.
import {
  AuthError, loadAuth, saveAuth, normalizeUrl, servedByHomeAssistant, startLogin,
  finishLoginFromUrl, logout, HAConnection, F, supports, currentPosition, formatTime,
} from './ha.js?v=2';
import { LocalPlayer, defaultDeviceName } from './local.js?v=2';

const APP_VERSION = '2.0.0';
const PAGE = 50;
const SETTINGS_KEY = 'musikapp.settings';
const GROUPING = 524288; // MediaPlayerEntityFeature.GROUPING

// ---------- Symbole ----------
const P = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  stop: 'M6 6h12v12H6z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  mute: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  power: 'M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z',
  speaker: 'M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 16c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
  phone: 'M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zM17 19H7V5h10v14z',
  down: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  library: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5c0 1.38-1.12 2.5-2.5 2.5S10 13.88 10 12.5s1.12-2.5 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  back: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  radio: 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 002 2h16a2 2 0 002-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z',
  artist: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  album: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
  playlist: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  playNext: 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z',
  replace: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  transfer: 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || P.note}"/></svg>`;
function setIcon(el, name) {
  const target = el.matches('.ico') ? el : el.querySelector('.ico');
  if (target && target.dataset.icon !== name) { target.dataset.icon = name; target.innerHTML = svg(name); }
}
function fillIcons(root = document) {
  root.querySelectorAll('.ico[data-icon]').forEach((el) => { if (!el.firstChild) el.innerHTML = svg(el.dataset.icon); });
}

// ---------- Kleine Helfer ----------
const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const icon = (name, cls = '') => el('span', { class: 'ico ' + cls, html: svg(name) });
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch { /* egal */ }
}

// ---------- Zustand ----------
const S = {
  auth: null,
  conn: null,
  connecting: false,
  freshLogin: false,
  reconnectDelay: 1000,
  reconnectTimer: null,
  states: {},
  maIds: null,
  players: [],
  settings: loadSettings(),
  configEntryId: null,
  maHosts: new Set(),
  tab: 'home',
  stack: [],
  home: { loaded: false, req: 0 },
  lib: { type: 'playlist', fav: false, order: 'name', filter: '', items: [], offset: 0, done: false, loading: false, req: 0, error: null },
  search: { q: '', type: 'all', libraryOnly: false, req: 0 },
  queue: { req: 0, lastKey: '' },
  draggingVolume: false,
  draggingSheetVolume: false,
  pendingLocalSelect: false,
  localConnectedAt: 0,
};

const local = new LocalPlayer({
  getConn: () => S.conn,
  getHassUrl: () => S.auth?.hassUrl || location.origin,
  getHostHints: () => [S.settings.maHost, ...S.maHosts].filter(Boolean),
});

const LIB_TYPES = [
  ['playlist', 'Playlists'], ['album', 'Alben'], ['artist', 'Künstler'], ['track', 'Titel'],
  ['radio', 'Radio'], ['podcast', 'Podcasts'], ['audiobook', 'Hörbücher'],
];
const SEARCH_TYPES = [
  ['all', 'Alles'], ['artist', 'Künstler'], ['album', 'Alben'], ['track', 'Titel'],
  ['playlist', 'Playlists'], ['radio', 'Radio'], ['podcast', 'Podcasts'], ['audiobook', 'Hörbücher'],
];
const RESULT_KEYS = [
  ['artists', 'Künstler'], ['albums', 'Alben'], ['tracks', 'Titel'], ['playlists', 'Playlists'],
  ['radio', 'Radio'], ['podcasts', 'Podcasts'], ['audiobooks', 'Hörbücher'],
];
const TYPE_LABEL = {
  artist: 'Künstler', album: 'Album', track: 'Titel', playlist: 'Playlist', radio: 'Radiosender',
  podcast: 'Podcast', audiobook: 'Hörbuch', folder: 'Ordner',
};
const PLAYABLE_TYPES = new Set(['artist', 'album', 'audiobook', 'folder', 'playlist', 'podcast', 'track', 'radio']);
const TYPE_ICON = { artist: 'artist', album: 'album', track: 'note', playlist: 'playlist', radio: 'radio', podcast: 'radio', audiobook: 'library' };
const TAB_TITLE = { home: 'Start', search: 'Suche', library: 'Bibliothek' };

// Reihen auf der Startseite. „quick“ = kompakte Kacheln ganz oben.
const HOME_SHELVES = [
  { key: 'quick', type: 'playlist', order: 'last_played_desc', limit: 8, quick: true },
  { key: 'recent', title: 'Zuletzt gehört', type: 'album', order: 'last_played_desc', limit: 14 },
  { key: 'new', title: 'Neu in deiner Bibliothek', type: 'album', order: 'timestamp_added_desc', limit: 14 },
  { key: 'artists', title: 'Künstler aus deiner Bibliothek', type: 'artist', order: 'random', limit: 14 },
  { key: 'radio', title: 'Radiosender', type: 'radio', order: 'name', limit: 14 },
  { key: 'discover', title: 'Wiederentdecken', type: 'album', order: 'random', limit: 14 },
];

// ---------- Anmeldung ----------
function showLogin(message) {
  if (S.conn) { S.conn.close(); S.conn = null; }
  closeNow();
  $('#app').hidden = true;
  $('#login').hidden = false;
  const url = $('#hassUrl');
  if (!url.value) url.value = S.settings.lastUrl || (servedByHomeAssistant() ? location.origin : '');
  updateMixedWarning();
  const err = $('#loginError');
  err.hidden = !message;
  err.textContent = message || '';
}

function updateMixedWarning() {
  const u = normalizeUrl($('#hassUrl').value);
  $('#mixedWarn').hidden = !(location.protocol === 'https:' && u.startsWith('http:'));
}

function readLoginUrl() {
  const u = normalizeUrl($('#hassUrl').value);
  if (!u) { showLogin('Bitte die Adresse von Home Assistant eingeben.'); return null; }
  S.settings.lastUrl = u;
  saveSettings();
  return u;
}

// ---------- Verbindung ----------
async function connect() {
  if (S.connecting || !S.auth) return;
  S.connecting = true;
  clearTimeout(S.reconnectTimer);
  if (!S.conn) showBanner('Verbinde mit Home Assistant …');
  const conn = new HAConnection(S.auth);
  try {
    await conn.connect();
  } catch (e) {
    S.connecting = false;
    if (e instanceof AuthError || S.freshLogin) {
      // Zugangsdaten funktionieren nicht (mehr) – zurück zur Anmeldung
      S.freshLogin = false;
      saveAuth(null);
      S.auth = null;
      showLogin(e.message);
      return;
    }
    if (!S.conn) showApp();
    showBanner(`${e.message} – neuer Versuch in ${Math.round(S.reconnectDelay / 1000)} s …`);
    scheduleReconnect();
    return;
  }
  S.connecting = false;
  S.freshLogin = false;
  if (S.conn) S.conn.close();
  S.conn = conn;
  S.reconnectDelay = 1000;
  conn.addEventListener('close', () => {
    if (S.conn !== conn) return;
    showBanner('Verbindung getrennt – verbinde neu …');
    scheduleReconnect(500);
  });
  showApp();
  try {
    await conn.subscribe({ type: 'subscribe_events', event_type: 'state_changed' }, onStateChanged);
    const states = await conn.send({ type: 'get_states' });
    S.states = {};
    for (const s of states) if (s.entity_id.startsWith('media_player.')) { S.states[s.entity_id] = s; noteHost(s.attributes.entity_picture); }
    await loadRegistry(conn);
    S.configEntryId = S.settings.configEntryId || await findConfigEntry(conn);
    hideBanner();
    updatePlayers();
    renderAll();
    if (!S.home.loaded) loadHome();
    if (S.tab === 'library' && !S.lib.items.length) loadLibrary(true);
    if (S.settings.localEnabled && !local.active) startLocal(S.settings.localSelected ? 'select' : false);
  } catch (e) {
    showBanner('Fehler beim Laden: ' + e.message);
  }
}

function scheduleReconnect(delay) {
  clearTimeout(S.reconnectTimer);
  const d = delay ?? S.reconnectDelay;
  S.reconnectDelay = Math.min(S.reconnectDelay * 2, 30_000);
  S.reconnectTimer = setTimeout(connect, d);
}

// iOS beendet Verbindungen im Hintergrund – beim Zurückkehren prüfen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.auth) return;
  if (local.active) local.refresh();
  if (!S.conn || !S.conn.open) { S.reconnectDelay = 1000; connect(); return; }
  S.conn.send({ type: 'ping' }, 5000).catch(() => {
    if (S.conn) S.conn.close();
    S.conn = null;
    S.reconnectDelay = 1000;
    connect();
  });
});

async function loadRegistry(conn) {
  try {
    const r = await conn.send({ type: 'config/entity_registry/list_for_display' });
    S.maIds = new Set(
      (r.entities || [])
        .filter((e) => e.pl === 'music_assistant' && e.ei.startsWith('media_player.') && !e.hb)
        .map((e) => e.ei),
    );
  } catch {
    S.maIds = null; // Fallback: Erkennung über Attribute
  }
}

async function findConfigEntry(conn) {
  try {
    const entries = await conn.send({ type: 'config_entries/get', domain: 'music_assistant' });
    const e = entries.find((x) => x.state === 'loaded') || entries[0];
    if (e) return e.entry_id;
  } catch { /* evtl. keine Admin-Rechte */ }
  const anyPlayer = S.players[0]?.entity_id || [...(S.maIds || [])][0];
  if (anyPlayer) {
    try {
      const r = await conn.send({ type: 'config/entity_registry/get', entity_id: anyPlayer });
      if (r.config_entry_id) return r.config_entry_id;
    } catch { /* egal */ }
  }
  return null;
}

function onStateChanged(event) {
  const { entity_id: id, new_state: ns } = event.data || {};
  if (!id || !id.startsWith('media_player.')) return;
  const known = isMaPlayer(id);
  if (ns) S.states[id] = ns; else delete S.states[id];
  if (ns) noteHost(ns.attributes.entity_picture);
  // Neue Player (z. B. dieses Gerät) stehen noch nicht in der beim Start geladenen Liste
  if (ns && !known && S.maIds && isMaState(ns)) S.maIds.add(id);
  if (!isMaPlayer(id)) return;
  updatePlayers();
  if (id === S.settings.playerId) { renderNow(); renderMini(); refreshQueueIfOpen(); }
  if (sheetKind() === 'devices' && !S.draggingSheetVolume) openDevices();
}

// ---------- Player ----------
const isMaState = (st) => !!(st && (st.attributes.mass_player_type !== undefined || st.attributes.app_id === 'music_assistant'));

function isMaPlayer(id) {
  if (S.maIds && S.maIds.size) return S.maIds.has(id);
  return isMaState(S.states[id]);
}

/** Die Home-Assistant-Entität, unter der dieses Gerät als Lautsprecher erscheint. */
function localEntity() {
  if (!S.settings.localEnabled || !S.settings.localName) return null;
  const same = S.players.filter((p) => p.attributes.friendly_name === S.settings.localName);
  return same.find((p) => p.state !== 'unavailable') || same[0] || null;
}
const isLocal = (st) => !!st && localEntity()?.entity_id === st.entity_id;

function playerName(st) {
  if (!st) return '';
  if (isLocal(st)) return 'Dieses Gerät';
  return st.attributes?.friendly_name || st.entity_id;
}

function updatePlayers() {
  S.players = Object.values(S.states)
    .filter((s) => isMaPlayer(s.entity_id))
    .sort((a, b) => (a.attributes.friendly_name || '').localeCompare(b.attributes.friendly_name || '', 'de'));

  const mine = localEntity();
  if (S.pendingLocalSelect && mine && mine.state !== 'unavailable') {
    const announce = S.pendingLocalSelect === 'announce';
    S.pendingLocalSelect = false;
    selectPlayer(mine.entity_id, { quiet: true });
    if (announce) toast('Dieses Gerät ist bereit – such dir Musik aus.');
  }

  const available = S.players.filter((p) => p.state !== 'unavailable');
  const cur = S.states[S.settings.playerId];
  if (!cur || !isMaPlayer(cur.entity_id) || (cur.state === 'unavailable' && available.length && !S.pendingLocalSelect)) {
    const pick = available.find((p) => p.state === 'playing') || available[0] || S.players[0];
    if (pick && pick.entity_id !== S.settings.playerId) {
      S.settings.playerId = pick.entity_id;
      saveSettings();
      renderNow(); renderMini();
    }
  }
  renderDeviceLabels();
}

const currentPlayer = () => S.states[S.settings.playerId] || null;

function renderDeviceLabels() {
  const p = currentPlayer();
  const mine = isLocal(p);
  const name = p ? playerName(p) : (S.players.length ? 'Gerät wählen' : 'Kein Gerät');
  $('#deviceName').textContent = name;
  $('#deviceBtn').classList.toggle('local', mine);
  setIcon($('#deviceBtn'), mine ? 'phone' : 'speaker');
  setIcon($('#miniDevice'), mine ? 'phone' : 'speaker');
  $('#miniDevice').classList.toggle('active', mine);
  $('#nowDevice').textContent = name;
  $('#nowDeviceBtnText').textContent = p ? groupLabel(p) : 'Geräte';
  $('#nowDeviceBtn').classList.toggle('local', mine);
  setIcon($('#nowDeviceBtn'), mine ? 'phone' : 'speaker');
}

const STATE_LABEL = {
  playing: 'Spielt', paused: 'Pausiert', idle: 'Bereit', on: 'An', off: 'Aus',
  buffering: 'Lädt …', unavailable: 'Nicht erreichbar', unknown: 'Unbekannt',
};

function selectPlayer(id, { quiet = false } = {}) {
  const prev = currentPlayer();
  if (prev?.entity_id === id) return;
  S.settings.playerId = id;
  S.settings.localSelected = localEntity()?.entity_id === id; // beim nächsten Start wieder dieses Gerät wählen
  saveSettings();
  updatePlayers();
  renderNow(); renderMini();
  const next = currentPlayer();
  if (isLocal(next)) local.unlock();
  if (!quiet && prev && next && prev.state === 'playing' && next.state !== 'playing') {
    toast(`Auf „${playerName(prev)}“ läuft noch Musik.`, false, {
      label: 'Hierher holen', onClick: () => transferQueue(prev.entity_id, next.entity_id),
    });
  }
}

async function transferQueue(fromId, toId) {
  try {
    await S.conn.callService('music_assistant', 'transfer_queue', { source_player: fromId, auto_play: true }, { entity_id: toId });
    toast(`Wiedergabe läuft jetzt auf „${playerName(S.states[toId])}“.`);
  } catch (e) {
    toast('Übertragen fehlgeschlagen: ' + e.message, true);
  }
}

// ---------- Gruppieren ----------
const groupMembers = (p) => (p?.attributes?.group_members || []).filter((id) => id !== p.entity_id && S.states[id]);

function groupLabel(p) {
  const n = groupMembers(p).length;
  return n ? `${playerName(p)} + ${n}` : playerName(p);
}

async function toggleGroup(memberId) {
  const leader = currentPlayer();
  if (!leader) return;
  const joined = groupMembers(leader).includes(memberId);
  try {
    if (joined) await S.conn.callService('media_player', 'unjoin', {}, { entity_id: memberId });
    else await S.conn.callService('media_player', 'join', { group_members: [memberId] }, { entity_id: leader.entity_id });
    toast(joined ? `„${playerName(S.states[memberId])}“ aus der Gruppe entfernt` : `„${playerName(S.states[memberId])}“ spielt jetzt mit`);
  } catch (e) {
    toast('Gruppieren fehlgeschlagen: ' + e.message, true);
  }
}

// ---------- Dieses Gerät ----------
/**
 * @param {false|'select'|'announce'} select  nach dem Verbinden als Wiedergabegerät wählen
 *        ('announce' = zusätzlich Hinweis zeigen, wenn der Nutzer es gerade selbst eingeschaltet hat)
 */
async function startLocal(select) {
  S.settings.localEnabled = true;
  if (!S.settings.localName) S.settings.localName = defaultDeviceName();
  saveSettings();
  if (select) S.pendingLocalSelect = select;
  try {
    await local.start(S.settings.localName);
    S.localConnectedAt = Date.now();
    updatePlayers();
  } catch (e) {
    S.pendingLocalSelect = false;
    updatePlayers();
    if (select === 'announce') toast('Dieses Gerät konnte nicht verbunden werden.', true);
  }
}

function stopLocal() {
  S.settings.localEnabled = false;
  S.settings.localSelected = false;
  S.pendingLocalSelect = false;
  saveSettings();
  local.stop();
  updatePlayers();
  renderNow(); renderMini();
}

local.addEventListener('change', () => {
  updatePlayers();
  if (sheetKind() === 'devices' && !S.draggingSheetVolume) openDevices();
});

// Browser erlauben Ton erst nach einer Nutzeraktion – jede Berührung schaltet ihn frei.
document.addEventListener('click', () => { if (local.active) local.unlock(); }, true);

function localRow() {
  const mine = localEntity();
  const selected = mine && mine.entity_id === S.settings.playerId;
  let sub; let busy = false; let err = false;
  if (local.state === 'off') sub = 'Musik direkt hier hören – tippen zum Einschalten';
  else if (local.state === 'connecting') { sub = 'Verbinde mit Music Assistant …'; busy = true; }
  else if (local.state === 'error') { sub = 'Verbindung fehlgeschlagen – tippen für neuen Versuch'; err = true; }
  else if (!mine || mine.state === 'unavailable') {
    const waited = Date.now() - S.localConnectedAt;
    busy = waited < 45_000;
    sub = busy ? 'Wird eingerichtet … (beim ersten Mal ca. 20 Sekunden)' : 'Verbunden, aber in Home Assistant noch nicht sichtbar';
    if (busy) setTimeout(() => { if (sheetKind() === 'devices' && !S.draggingSheetVolume) openDevices(); }, 5000);
  } else {
    const a = mine.attributes;
    sub = [STATE_LABEL[mine.state] || mine.state, (mine.state === 'playing' || mine.state === 'paused') && a.media_title].filter(Boolean).join(' · ');
  }
  const nodes = [el('div', { class: 'sheet-item' + (selected ? ' selected' : ''), id: 'localRow' },
    el('button', {
      class: 'grow-btn',
      onclick: () => {
        if (local.state === 'off' || local.state === 'error') { startLocal('announce'); openDevices(); }
        else if (mine && mine.state !== 'unavailable') { selectPlayer(mine.entity_id); closeSheet(); }
        else S.pendingLocalSelect = 'announce';
      },
    },
    busy ? el('span', { class: 'spinner small', style: 'margin:0 3px' }) : icon('phone'),
    el('span', { class: 'grow' }, el('span', { class: 'name' }, 'Dieses Gerät'), el('span', { class: 'sub' }, sub)),
    ),
    selected ? icon('check') : null,
    local.active || local.state === 'error' ? el('button', { class: 'btn slim', onclick: () => { stopLocal(); openDevices(); } }, 'Aus') : null,
  )];
  if (selected && supports(mine, F.VOLUME_SET)) nodes.push(volumeRow(mine));
  if (err) nodes.push(el('p', { class: 'hint error' }, local.error));
  else if (local.state === 'connected' && !busy && (!mine || mine.state === 'unavailable')) {
    nodes.push(el('p', { class: 'hint' },
      `Music Assistant hat „${S.settings.localName}“ noch nicht an Home Assistant weitergegeben. Öffne Music Assistant → Einstellungen → Player und prüfe, ob das Gerät dort aktiviert ist.`));
  }
  return nodes;
}

// ---------- Geräte-Auswahl ----------
function volumeRow(p) {
  const input = el('input', {
    type: 'range', min: '0', max: '100', step: '1', 'aria-label': `Lautstärke ${playerName(p)}`,
    value: String(Math.round((p.attributes.volume_level ?? 0) * 100)),
  });
  let timer = null;
  const send = () => S.conn?.callService('media_player', 'volume_set', { volume_level: Number(input.value) / 100 }, { entity_id: p.entity_id }).catch(() => {});
  input.addEventListener('input', () => {
    S.draggingSheetVolume = true;
    if (!timer) timer = setTimeout(() => { timer = null; send(); }, 250);
  });
  input.addEventListener('change', () => {
    clearTimeout(timer); timer = null;
    send();
    setTimeout(() => { S.draggingSheetVolume = false; }, 800);
  });
  return el('div', { class: 'row-volume' }, icon('volume', 'small'), input);
}

function openDevices() {
  const cur = currentPlayer();
  const mine = localEntity();
  const showAll = !!S.settings.showUnavailable;
  const others = S.players.filter((p) => p.entity_id !== mine?.entity_id
    && !(S.settings.localEnabled && p.attributes.friendly_name === S.settings.localName));
  const list = others.filter((p) => showAll || p.state !== 'unavailable');
  const hiddenCount = others.length - list.length;
  const members = cur ? groupMembers(cur) : [];
  const canLead = cur && cur.state !== 'unavailable' && supports(cur, GROUPING);

  const body = el('div', {});
  body.append(...localRow());
  body.append(el('div', { class: 'sheet-sub' }, 'Lautsprecher'));
  if (!list.length) body.append(el('p', { class: 'hint' }, 'Keine weiteren Music-Assistant-Player gefunden.'));
  for (const p of list) {
    const a = p.attributes;
    const selected = p.entity_id === cur?.entity_id;
    const inGroup = members.includes(p.entity_id);
    const sub = [inGroup ? 'Spielt mit' : (STATE_LABEL[p.state] || p.state)];
    if (!inGroup && (p.state === 'playing' || p.state === 'paused') && a.media_title) {
      sub.push([a.media_title, a.media_artist].filter(Boolean).join(' – '));
    }
    const groupable = canLead && !selected && p.state !== 'unavailable' && supports(p, GROUPING);
    body.append(el('div', { class: 'sheet-item' + (selected ? ' selected' : ''), dataset: { entity: p.entity_id } },
      el('button', {
        class: 'grow-btn', disabled: p.state === 'unavailable',
        onclick: () => { selectPlayer(p.entity_id); closeSheet(); },
      },
      el('span', { class: 'status-dot ' + (inGroup ? 'playing' : p.state) }),
      el('span', { class: 'grow' }, el('span', { class: 'name' }, a.friendly_name || p.entity_id), el('span', { class: 'sub' }, sub.join(' · '))),
      ),
      selected ? icon('check') : null,
      groupable ? el('button', {
        class: 'icon-btn group-btn' + (inGroup ? ' active' : ''),
        'aria-pressed': String(inGroup),
        'aria-label': inGroup ? `${a.friendly_name} aus der Gruppe entfernen` : `${a.friendly_name} mitspielen lassen`,
        onclick: () => toggleGroup(p.entity_id),
      }, icon(inGroup ? 'check' : 'add', 'small')) : null,
    ));
    if ((selected || inGroup) && p.state !== 'unavailable' && supports(p, F.VOLUME_SET)) body.append(volumeRow(p));
  }
  if (canLead && list.some((p) => p.entity_id !== cur.entity_id && supports(p, GROUPING))) {
    body.append(el('p', { class: 'hint' }, `Mit ＋ spielt ein weiterer Lautsprecher dasselbe wie „${playerName(cur)}“.`));
  }
  if (hiddenCount) body.append(el('p', { class: 'hint' }, `${hiddenCount} nicht erreichbare(r) Player ausgeblendet (siehe Einstellungen).`));
  openSheet('Wiedergabe auf', body, 'devices');
}

// ---------- Steuerung ----------
function svc(service, data = {}) {
  const p = currentPlayer();
  if (!p || !S.conn) return Promise.resolve();
  return S.conn.callService('media_player', service, data, { entity_id: p.entity_id })
    .catch((e) => toast('Fehler: ' + e.message, true));
}

function togglePlay() {
  const p = currentPlayer();
  if (!p) { openDevices(); return; }
  if (p.state === 'playing') svc(supports(p, F.PAUSE) ? 'media_pause' : 'media_stop');
  else if (p.state === 'off') svc('turn_on');
  else svc('media_play');
}

async function playMedia(item, extra = {}, label) {
  const p = currentPlayer();
  if (!p) { toast('Bitte zuerst ein Wiedergabegerät wählen.', true); openDevices(); return; }
  const data = { media_id: item.uri, ...extra };
  if (PLAYABLE_TYPES.has(item.media_type)) data.media_type = item.media_type;
  try {
    await S.conn.callService('music_assistant', 'play_media', data, { entity_id: p.entity_id });
    toast(label || `▶ ${item.name}`);
  } catch (e) {
    toast('Abspielen fehlgeschlagen: ' + e.message, true);
  }
}

function openItemActions(item) {
  const body = el('div', {});
  const add = (ic, text, extra, msg) => body.append(el('button', {
    class: 'sheet-item',
    onclick: () => { closeSheet(); playMedia(item, extra, msg); },
  }, icon(ic), el('span', { class: 'grow' }, text)));
  add('play', 'Jetzt abspielen', { enqueue: 'play' });
  add('replace', 'Warteschlange ersetzen', { enqueue: 'replace' }, `▶ ${item.name}`);
  add('playNext', 'Als Nächstes abspielen', { enqueue: 'next' }, `Als Nächstes: ${item.name}`);
  add('add', 'Zur Warteschlange hinzufügen', { enqueue: 'add' }, `Hinzugefügt: ${item.name}`);
  if (['track', 'artist', 'album', 'playlist'].includes(item.media_type)) {
    add('radio', 'Radio starten (ähnliche Musik)', { enqueue: 'replace', radio_mode: true }, `Radio: ${item.name}`);
  }
  if (item.expandable) {
    body.append(el('button', {
      class: 'sheet-item',
      onclick: () => { closeSheet(); closeNow(); openDetail(item); },
    }, icon('library'), el('span', { class: 'grow' }, 'Inhalt anzeigen')));
  }
  const p = currentPlayer();
  openSheet(`${item.name}${p ? ' → ' + playerName(p) : ''}`, body, 'actions');
}

// ---------- Bilder ----------
function noteHost(u) {
  const m = typeof u === 'string' && /^http:\/\/([^/:]+|\[[^\]]+\]):8095\//.exec(u);
  if (m) S.maHosts.add(m[1]);
}
function absUrl(u) {
  if (!u) return null;
  noteHost(u);
  if (u.startsWith('/')) return S.auth.hassUrl + u;
  return u;
}
function playerPicture(st) {
  const a = st?.attributes || {};
  return absUrl(a.entity_picture_local || a.entity_picture);
}
function artNode(url, type, cls) {
  const ph = () => el('div', { class: cls }, icon(TYPE_ICON[type] || 'note'));
  if (!url) return ph();
  const img = el('img', { class: cls, src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
  return img;
}
function setImg(img, phEl, url) {
  if (!url) { img.hidden = true; if (phEl) phEl.hidden = false; img.removeAttribute('src'); img.dataset.src = ''; return; }
  if (img.dataset.src === url) return;
  img.dataset.src = url;
  img.onload = () => { img.hidden = false; if (phEl) phEl.hidden = true; };
  img.onerror = () => { img.hidden = true; if (phEl) phEl.hidden = false; };
  img.src = url;
}

// ---------- Wiedergabe-Ansicht ----------
function openNow() {
  $('#now').hidden = false;
  document.body.classList.add('no-scroll');
  renderNow();
}
function closeNow() {
  $('#now').hidden = true;
  document.body.classList.remove('no-scroll');
}

function renderNow() {
  const p = currentPlayer();
  const a = p?.attributes || {};
  const active = p && ['playing', 'paused', 'buffering'].includes(p.state);
  const hasMedia = !!a.media_title;
  $('#nowTitle').textContent = hasMedia ? a.media_title
    : !p ? (S.players.length ? 'Kein Gerät gewählt' : 'Kein Music-Assistant-Player gefunden')
      : p.state === 'off' ? `${playerName(p)} ist aus`
        : p.state === 'unavailable' ? `${playerName(p)} ist nicht erreichbar`
          : 'Nichts in der Wiedergabe';
  $('#nowArtist').textContent = hasMedia ? (a.media_artist || '') : (!p ? '' : 'Such dir unter „Start“, „Suche“ oder „Bibliothek“ etwas aus.');
  $('#nowAlbum').textContent = hasMedia ? (a.media_album_name || '') : '';
  const pic = hasMedia || active ? playerPicture(p) : null;
  setImg($('#nowArt'), $('#nowArtPh'), pic);
  $('#nowBg').style.backgroundImage = pic ? `url("${pic.replace(/"/g, '%22')}")` : '';

  const off = !p || p.state === 'unavailable';
  const playBtn = $('#playBtn');
  playBtn.disabled = off;
  setIcon(playBtn, p?.state === 'playing' ? 'pause' : 'play');
  playBtn.setAttribute('aria-label', p?.state === 'playing' ? 'Pause' : 'Wiedergabe');
  $('#prevBtn').disabled = off || !supports(p, F.PREVIOUS_TRACK);
  $('#nextBtn').disabled = off || !supports(p, F.NEXT_TRACK);

  const sh = $('#shuffleBtn');
  sh.disabled = off || !supports(p, F.SHUFFLE_SET);
  sh.classList.toggle('active', !!a.shuffle);
  sh.setAttribute('aria-pressed', String(!!a.shuffle));

  const rp = $('#repeatBtn');
  rp.disabled = off || !supports(p, F.REPEAT_SET);
  rp.classList.toggle('active', a.repeat === 'all' || a.repeat === 'one');
  setIcon(rp, a.repeat === 'one' ? 'repeatOne' : 'repeat');
  rp.setAttribute('aria-label', { all: 'Wiederholen: alle', one: 'Wiederholen: einen Titel' }[a.repeat] || 'Wiederholen: aus');

  const vol = $('#volume');
  vol.disabled = off || !supports(p, F.VOLUME_SET);
  if (!S.draggingVolume && typeof a.volume_level === 'number') {
    vol.value = Math.round(a.volume_level * 100);
    $('#volVal').textContent = vol.value;
  }
  const mb = $('#muteBtn');
  mb.disabled = off || !supports(p, F.VOLUME_MUTE);
  setIcon(mb, a.is_volume_muted ? 'mute' : 'volume');
  mb.classList.toggle('active', !!a.is_volume_muted);

  const pw = $('#powerBtn');
  pw.hidden = !p || !(supports(p, F.TURN_ON) || supports(p, F.TURN_OFF));
  pw.disabled = off;
  pw.classList.toggle('active', !!p && p.state !== 'off');
  pw.setAttribute('aria-label', p?.state === 'off' ? 'Einschalten' : 'Ausschalten');

  $('#queueBtn').disabled = off;
  renderDeviceLabels();
  renderProgress();
  updateMediaSession();
}

function renderProgress() {
  const p = currentPlayer();
  const a = p?.attributes || {};
  const pos = currentPosition(p);
  const dur = typeof a.media_duration === 'number' && a.media_duration > 0 ? a.media_duration : null;
  const pct = pos != null && dur ? Math.min(100, (pos / dur) * 100) : 0;
  $('#progressFill').style.width = pct + '%';
  $('#miniProgress').style.width = pct + '%';
  $('#posTime').textContent = a.media_title ? formatTime(pos) : '–:––';
  $('#durTime').textContent = a.media_title && dur ? formatTime(dur) : (a.media_title ? 'Live' : '–:––');
  const bar = $('#progressBar');
  bar.classList.toggle('disabled', !dur || !supports(p, F.SEEK));
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
}

function renderMini() {
  const p = currentPlayer();
  const a = p?.attributes || {};
  const show = !!p && !!a.media_title && p.state !== 'off' && p.state !== 'unavailable';
  $('#mini').hidden = !show;
  if (!show) return;
  $('#miniTitle').textContent = a.media_title;
  const sub = $('#miniSub');
  sub.textContent = [a.media_artist, groupLabel(p)].filter(Boolean).join(' · ');
  sub.classList.toggle('local', isLocal(p));
  setImg($('#miniArt'), $('#miniArtPh'), playerPicture(p));
  setIcon($('#miniPlay'), p.state === 'playing' ? 'pause' : 'play');
  $('#miniPlay').setAttribute('aria-label', p.state === 'playing' ? 'Pause' : 'Wiedergabe');
  $('#miniNext').disabled = !supports(p, F.NEXT_TRACK);
}

function seekFromEvent(ev) {
  const p = currentPlayer();
  const dur = p?.attributes?.media_duration;
  if (!dur || !supports(p, F.SEEK)) return;
  const r = $('#progressBar').getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  svc('media_seek', { seek_position: Math.round(frac * dur) });
}

// Sperrbildschirm / Medientasten – nur wenn die Musik auf diesem Gerät läuft.
let mediaSessionReady = false;
function updateMediaSession() {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const p = currentPlayer();
  if (!isLocal(p) || !p.attributes.media_title) return;
  const a = p.attributes;
  const pic = playerPicture(p);
  const key = [a.media_title, a.media_artist, pic].join('|');
  if (updateMediaSession.key !== key) {
    updateMediaSession.key = key;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: a.media_title, artist: a.media_artist || '', album: a.media_album_name || '',
        artwork: pic ? [{ src: pic }] : [],
      });
    } catch { /* egal */ }
  }
  navigator.mediaSession.playbackState = p.state === 'playing' ? 'playing' : 'paused';
  if (mediaSessionReady) return;
  mediaSessionReady = true;
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* nicht unterstützt */ } };
  set('play', () => svc('media_play'));
  set('pause', () => svc('media_pause'));
  set('nexttrack', () => svc('media_next_track'));
  set('previoustrack', () => svc('media_previous_track'));
}

// ---------- Warteschlange ----------
const queueKey = (p) => [p?.entity_id, p?.attributes?.media_content_id, p?.attributes?.shuffle, p?.attributes?.repeat].join('|');

function queueItemNode(qi, label) {
  const mi = qi?.media_item || {};
  const artists = (mi.artists || []).map((x) => x.name).filter(Boolean).join(', ');
  return el('div', { class: 'queue-item' },
    artNode(absUrl(mi.image || mi.album?.image), mi.media_type || 'track', 'row-art'),
    el('span', { class: 'row-text' },
      el('span', { class: 'row-sub' }, label),
      el('span', { class: 'row-name' }, mi.name || qi?.name || 'Unbekannt'),
      el('span', { class: 'row-sub' }, [artists, qi?.duration ? formatTime(qi.duration) : ''].filter(Boolean).join(' · ')),
    ),
  );
}

async function openQueue() {
  const p = currentPlayer();
  if (!p) return;
  const req = ++S.queue.req;
  S.queue.lastKey = queueKey(p);
  if (sheetKind() !== 'queue') {
    openSheet('Warteschlange', el('div', { class: 'more' }, el('div', { class: 'spinner', 'aria-label': 'Lädt' })), 'queue');
  }
  let q;
  try {
    const r = await S.conn.callService('music_assistant', 'get_queue', {}, { entity_id: p.entity_id }, true);
    q = r?.response?.[p.entity_id];
  } catch (e) {
    if (req !== S.queue.req || sheetKind() !== 'queue') return;
    openSheet('Warteschlange', el('p', { class: 'empty' }, 'Warteschlange konnte nicht geladen werden: ' + e.message), 'queue');
    return;
  }
  if (req !== S.queue.req || sheetKind() !== 'queue') return;
  const body = el('div', {});
  const a = currentPlayer()?.attributes || {};
  if (!q || !q.items) {
    body.append(el('p', { class: 'empty' }, 'Die Warteschlange ist leer.'));
  } else {
    const pos = typeof q.current_index === 'number' ? q.current_index + 1 : null;
    body.append(el('p', { class: 'hint' }, [
      pos ? `Titel ${pos} von ${q.items}` : `${q.items} Titel`,
      q.shuffle_enabled ? 'Zufall an' : null,
      q.repeat_mode && q.repeat_mode !== 'off' ? (q.repeat_mode === 'one' ? 'ein Titel wird wiederholt' : 'alle werden wiederholt') : null,
    ].filter(Boolean).join(' · ')));
    if (q.current_item) body.append(queueItemNode(q.current_item, 'Läuft gerade'));
    if (q.next_item) body.append(queueItemNode(q.next_item, 'Als Nächstes'));
    else if (q.current_item) body.append(el('p', { class: 'hint' }, 'Danach ist die Warteschlange zu Ende.'));
    if (pos && q.items - pos > 1) body.append(el('p', { class: 'hint' }, `… und ${q.items - pos - 1} weitere Titel`));
  }
  body.append(el('div', { class: 'queue-actions' },
    el('button', { class: 'btn slim', 'aria-pressed': String(!!a.shuffle), onclick: () => svc('shuffle_set', { shuffle: !a.shuffle }) },
      icon('shuffle', 'small'), a.shuffle ? 'Zufall: an' : 'Zufall: aus'),
    q && q.items ? el('button', {
      class: 'btn slim danger',
      onclick: async () => { await svc('clear_playlist'); toast('Warteschlange geleert'); openQueue(); },
    }, icon('trash', 'small'), 'Leeren') : null,
  ));
  body.append(el('p', { class: 'hint' },
    'Home Assistant gibt nur den aktuellen und den nächsten Titel weiter. Die ganze Liste zum Umsortieren zeigt die Oberfläche von Music Assistant.'));
  openSheet(`Warteschlange · ${playerName(p)}`, body, 'queue');
}

const refreshQueueIfOpen = debounce(() => {
  if (sheetKind() === 'queue' && queueKey(currentPlayer()) !== S.queue.lastKey) openQueue();
}, 600);

// ---------- Bibliothek abfragen ----------
async function fetchLibrary(params) {
  const r = await S.conn.callService('music_assistant', 'get_library', { config_entry_id: S.configEntryId, ...params }, undefined, true);
  return (r?.response?.items || []).map(fromMa);
}

function itemSubtitle(item) {
  const artists = (item.artists || []).map((x) => x.name).filter(Boolean).join(', ');
  if (item.media_type === 'track') return [artists, item.album?.name].filter(Boolean).join(' · ');
  if (artists) return artists;
  if (item.version) return item.version;
  return item.media_type === 'artist' ? 'Künstler' : (TYPE_LABEL[item.media_type] || '');
}

const isExpandable = (t) => ['album', 'playlist', 'artist', 'podcast', 'audiobook'].includes(t);

/** Eintrag aus get_library/search in einheitliche Form bringen */
function fromMa(item) {
  return {
    uri: item.uri,
    name: item.name + (item.version && item.media_type === 'track' ? ` (${item.version})` : ''),
    media_type: item.media_type,
    image: absUrl(item.image),
    subtitle: itemSubtitle(item),
    favorite: !!item.favorite,
    expandable: isExpandable(item.media_type),
  };
}

/** Eintrag aus browse_media in einheitliche Form bringen */
function fromBrowse(child) {
  const type = child.media_class === 'music' ? 'track' : child.media_class;
  return {
    uri: child.media_content_id,
    name: child.title,
    media_type: type,
    browseType: child.media_class,
    image: absUrl(child.thumbnail),
    subtitle: '',
    expandable: !!child.can_expand && type !== 'track',
    playable: child.can_play !== false,
  };
}

function onItemClick(item) {
  if (item.expandable) openDetail(item);
  else playMedia(item);
}

function cardNode(item) {
  const round = item.media_type === 'artist';
  return el('div', { class: 'card' + (round ? ' round' : '') },
    el('button', { class: 'card-hit', onclick: () => onItemClick(item) },
      artNode(item.image, item.media_type, 'card-art'),
      el('span', { class: 'card-name' }, item.name),
      item.subtitle ? el('span', { class: 'card-sub' }, item.subtitle) : null,
    ),
    item.favorite ? el('span', { class: 'fav', title: 'Favorit' }, icon('heart', 'small')) : null,
    item.playable === false ? null : el('button', {
      class: 'icon-btn more-btn', 'aria-label': 'Weitere Aktionen', onclick: (e) => { e.stopPropagation(); openItemActions(item); },
    }, icon('more', 'small')),
  );
}

function rowNode(item, num, isCurrent) {
  return el('div', { class: 'row' + (isCurrent ? ' playing' : '') },
    el('button', { class: 'row-main', onclick: () => onItemClick(item) },
      num != null ? el('span', { class: 'row-num' }, String(num)) : artNode(item.image, item.media_type, 'row-art'),
      el('span', { class: 'row-text' },
        el('span', { class: 'row-name' }, item.name),
        item.subtitle ? el('span', { class: 'row-sub' }, item.subtitle) : null,
      ),
    ),
    item.playable === false ? null : el('button', {
      class: 'icon-btn', 'aria-label': 'Weitere Aktionen', onclick: () => openItemActions(item),
    }, icon('more', 'small')),
  );
}

function itemsNode(items, asList) {
  if (asList) return el('div', { class: 'list' }, items.map((i) => rowNode(i)));
  return el('div', { class: 'grid' }, items.map(cardNode));
}

function noConfigEntryNode() {
  return el('div', { class: 'empty' },
    el('p', {}, 'Die Music-Assistant-Integration wurde nicht gefunden.'),
    el('p', { class: 'small' }, 'Wenn sie eingerichtet ist, trage die ID in den Einstellungen (Zahnrad oben rechts) ein.'),
  );
}

// ---------- Ansicht: Start ----------
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

function quickNode(item) {
  return el('button', { class: 'quick', onclick: () => onItemClick(item) },
    artNode(item.image, item.media_type, 'quick-art'),
    el('span', { class: 'quick-name' }, item.name),
  );
}

async function loadHome() {
  const box = $('#home');
  if (!S.conn?.open) return;
  if (!S.configEntryId) { box.replaceChildren(noConfigEntryNode()); return; }
  const req = ++S.home.req;
  S.home.loaded = true;
  const sections = {};
  const nodes = [el('p', { class: 'greeting' }, greeting())];
  for (const sh of HOME_SHELVES) {
    const sec = el('section', { class: 'home-section', dataset: { shelf: sh.key } });
    if (sh.quick) {
      sec.append(el('div', { class: 'quick-grid' }, Array.from({ length: 4 }, () => el('div', { class: 'quick skeleton' }))));
    } else {
      sec.append(
        el('div', { class: 'shelf-head' },
          el('h2', { class: 'shelf-title' }, sh.title),
          el('button', { class: 'shelf-more', onclick: () => showInLibrary(sh.type, sh.order) }, 'Alle anzeigen')),
        el('div', { class: 'shelf' }, Array.from({ length: 5 }, () => el('div', { class: 'card' }, el('div', { class: 'card-art skeleton' })))),
      );
    }
    sections[sh.key] = sec;
    nodes.push(sec);
  }
  box.replaceChildren(...nodes);

  let filled = 0;
  await Promise.all(HOME_SHELVES.map(async (sh) => {
    let items = [];
    try { items = await fetchLibrary({ media_type: sh.type, order_by: sh.order, limit: sh.limit }); } catch { /* Reihe ausblenden */ }
    if (req !== S.home.req) return;
    const sec = sections[sh.key];
    if (!items.length) { sec.remove(); return; }
    filled++;
    if (sh.quick) sec.replaceChildren(el('div', { class: 'quick-grid' }, items.map(quickNode)));
    else sec.lastElementChild.replaceChildren(...items.map(cardNode));
  }));
  if (req === S.home.req && !filled) {
    box.append(el('p', { class: 'empty' }, 'Deine Bibliothek ist noch leer. Über „Suche“ findest du Musik bei deinen Musikdiensten.'));
  }
}

function showInLibrary(type, order) {
  S.lib.type = type;
  S.lib.order = order;
  S.lib.fav = false;
  S.lib.filter = '';
  $('#libFilter').value = '';
  $('#libOrder').value = order;
  $('#libFav').setAttribute('aria-pressed', 'false');
  S.lib.items = [];
  renderLibTypes();
  setTab('library');
}

// ---------- Ansicht: Bibliothek ----------
function renderLibTypes() {
  const box = $('#libTypes');
  box.replaceChildren(...LIB_TYPES.map(([t, label]) => el('button', {
    class: 'chip' + (S.lib.type === t ? ' active' : ''),
    role: 'tab',
    'aria-selected': String(S.lib.type === t),
    onclick: () => { if (S.lib.type !== t) { S.lib.type = t; renderLibTypes(); loadLibrary(true); } },
  }, label)));
}

async function loadLibrary(reset) {
  const L = S.lib;
  if (reset) {
    L.req++; L.items = []; L.offset = 0; L.done = false; L.loading = false; L.error = null;
    $('#libList').replaceChildren();
  }
  if (L.loading || L.done || !S.conn?.open) { renderLibMore(); return; }
  if (!S.configEntryId) { $('#libList').replaceChildren(noConfigEntryNode()); L.done = true; renderLibMore(); return; }
  const req = L.req;
  L.loading = true;
  renderLibMore();
  const params = { media_type: L.type, limit: PAGE, offset: L.offset, order_by: L.order };
  if (L.fav) params.favorite = true;
  if (L.filter) params.search = L.filter;
  try {
    const items = await fetchLibrary(params);
    if (req !== L.req) return;
    L.items.push(...items);
    L.offset += items.length;
    if (items.length < PAGE || L.order === 'random') L.done = true;
    const list = $('#libList');
    const asList = L.type === 'track';
    let container = list.firstElementChild;
    if (!container || !container.matches('.grid, .list')) {
      container = itemsNode([], asList);
      list.replaceChildren(container);
    }
    container.append(...items.map((i) => (asList ? rowNode(i) : cardNode(i))));
    if (!L.items.length) {
      list.replaceChildren(el('p', { class: 'empty' }, L.filter || L.fav ? 'Nichts gefunden.' : 'Hier ist noch nichts in deiner Bibliothek.'));
    }
  } catch (e) {
    if (req !== L.req) return;
    L.error = e.message;
  } finally {
    if (req === L.req) { L.loading = false; renderLibMore(); }
  }
}

function renderLibMore() {
  const L = S.lib;
  const box = $('#libMore');
  if (L.loading) box.replaceChildren(el('div', { class: 'spinner', 'aria-label': 'Lädt' }));
  else if (L.error) box.replaceChildren(el('div', { class: 'empty' }, el('p', {}, 'Fehler: ' + L.error), el('button', { class: 'btn', onclick: () => { L.error = null; loadLibrary(); } }, 'Erneut versuchen')));
  else if (!L.done && L.items.length) box.replaceChildren(el('button', { class: 'btn', onclick: () => loadLibrary() }, 'Mehr laden'));
  else box.replaceChildren();
}

// ---------- Ansicht: Suche ----------
function renderSearchTypes() {
  const box = $('#searchTypes');
  box.replaceChildren(
    ...SEARCH_TYPES.map(([t, label]) => el('button', {
      class: 'chip' + (S.search.type === t ? ' active' : ''),
      onclick: () => { S.search.type = t; renderSearchTypes(); runSearch(); },
    }, label)),
    el('button', {
      class: 'chip', 'aria-pressed': String(S.search.libraryOnly),
      onclick: () => { S.search.libraryOnly = !S.search.libraryOnly; renderSearchTypes(); runSearch(); },
    }, 'Nur Bibliothek'),
  );
}

async function runSearch() {
  const q = $('#searchInput').value.trim();
  const box = $('#searchResults');
  const s = S.search;
  s.q = q;
  const req = ++s.req;
  if (q.length < 2) {
    box.replaceChildren(el('p', { class: 'empty' }, 'Suche in deiner Bibliothek und bei deinen Musikdiensten.'));
    return;
  }
  if (!S.configEntryId) { box.replaceChildren(noConfigEntryNode()); return; }
  box.replaceChildren(el('div', { class: 'more' }, el('div', { class: 'spinner', 'aria-label': 'Sucht' })));
  const data = { config_entry_id: S.configEntryId, name: q, limit: s.type === 'all' ? 10 : 40, library_only: s.libraryOnly };
  if (s.type !== 'all') data.media_type = [s.type];
  try {
    const r = await S.conn.callService('music_assistant', 'search', data, undefined, true);
    if (req !== s.req) return;
    const res = r?.response || {};
    const frag = [];
    for (const [key, label] of RESULT_KEYS) {
      const items = (res[key] || []).map(fromMa);
      if (!items.length) continue;
      if (s.type === 'all') frag.push(el('h3', { class: 'section-title' }, label));
      frag.push(itemsNode(items, key === 'tracks'));
    }
    box.replaceChildren(...(frag.length ? frag : [el('p', { class: 'empty' }, `Keine Treffer für „${q}“.`)]));
  } catch (e) {
    if (req !== s.req) return;
    box.replaceChildren(el('p', { class: 'empty' }, 'Suche fehlgeschlagen: ' + e.message));
  }
}

// ---------- Detailansicht ----------
function openDetail(item) {
  S.stack.push(item);
  showView();
  renderDetail();
  window.scrollTo(0, 0);
}

async function renderDetail() {
  const item = S.stack[S.stack.length - 1];
  const box = $('#detail');
  if (!item) return;
  const browseEntity = [currentPlayer(), ...S.players].find((p) => p && p.state !== 'unavailable')?.entity_id;
  const head = el('div', { class: 'detail-head' },
    artNode(item.image, item.media_type, 'detail-art' + (item.media_type === 'artist' ? ' round' : '')),
    el('div', { class: 'detail-meta' },
      el('span', { class: 'detail-type' }, TYPE_LABEL[item.media_type] || ''),
      el('h2', { class: 'detail-title' }, item.name),
      item.subtitle && item.subtitle !== TYPE_LABEL[item.media_type] ? el('span', { class: 'muted' }, item.subtitle) : null,
      el('div', { class: 'detail-actions' },
        el('button', { class: 'btn primary', onclick: () => playMedia(item, { enqueue: 'replace' }) }, icon('play', 'small'), 'Abspielen'),
        currentPlayer() && supports(currentPlayer(), F.SHUFFLE_SET) ? el('button', {
          class: 'btn',
          onclick: async () => { await svc('shuffle_set', { shuffle: true }); playMedia(item, { enqueue: 'replace' }, `⤮ ${item.name}`); },
        }, icon('shuffle', 'small'), 'Zufällig') : null,
        el('button', { class: 'btn', 'aria-label': 'Weitere Aktionen', onclick: () => openItemActions(item) }, icon('more', 'small')),
      ),
    ),
  );
  const content = el('div', {}, el('div', { class: 'more' }, el('div', { class: 'spinner', 'aria-label': 'Lädt' })));
  box.replaceChildren(head, content);
  if (!browseEntity) { content.replaceChildren(el('p', { class: 'empty' }, 'Kein Player verfügbar, um Inhalte zu laden.')); return; }
  const depth = S.stack.length;
  try {
    const r = await S.conn.send({
      type: 'media_player/browse_media',
      entity_id: browseEntity,
      media_content_id: item.uri,
      media_content_type: item.browseType || item.media_type,
    });
    if (S.stack.length !== depth || S.stack[depth - 1] !== item) return;
    if (!item.image && r.thumbnail) {
      head.firstElementChild.replaceWith(artNode(absUrl(r.thumbnail), item.media_type, 'detail-art' + (item.media_type === 'artist' ? ' round' : '')));
    }
    const children = (r.children || []).map(fromBrowse);
    if (!children.length) { content.replaceChildren(el('p', { class: 'empty' }, 'Keine Inhalte.')); return; }
    const expandables = children.filter((c) => c.expandable);
    const tracks = children.filter((c) => !c.expandable);
    const nodes = [];
    if (expandables.length) {
      if (tracks.length) nodes.push(el('h3', { class: 'section-title' }, item.media_type === 'artist' ? 'Alben' : 'Inhalte'));
      nodes.push(el('div', { class: 'grid' }, expandables.map(cardNode)));
    }
    if (tracks.length) {
      if (expandables.length) nodes.push(el('h3', { class: 'section-title' }, 'Titel'));
      const numbered = item.media_type === 'album';
      const nowId = currentPlayer()?.attributes?.media_content_id;
      nodes.push(el('div', { class: 'list' }, tracks.map((t, i) => rowNode(t, numbered ? i + 1 : null, nowId && nowId === t.uri))));
    }
    content.replaceChildren(...nodes);
  } catch (e) {
    if (S.stack[S.stack.length - 1] !== item) return;
    content.replaceChildren(el('p', { class: 'empty' }, 'Inhalte konnten nicht geladen werden: ' + e.message));
  }
}

// ---------- Navigation ----------
function setTab(tab) {
  const again = S.tab === tab && !S.stack.length;
  S.tab = tab;
  S.stack = [];
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  showView();
  if (tab === 'home' && (again || !S.home.loaded)) loadHome();
  if (tab === 'library' && !S.lib.items.length && !S.lib.loading) loadLibrary(true);
  if (tab === 'search') {
    if (!$('#searchResults').childElementCount) runSearch();
    setTimeout(() => $('#searchInput').focus(), 50);
  }
  window.scrollTo(0, 0);
}

function showView() {
  const inDetail = S.stack.length > 0;
  $('#view-home').hidden = inDetail || S.tab !== 'home';
  $('#view-library').hidden = inDetail || S.tab !== 'library';
  $('#view-search').hidden = inDetail || S.tab !== 'search';
  $('#view-detail').hidden = !inDetail;
  $('#pageTitle').textContent = TAB_TITLE[S.tab];
}

function goBack() {
  S.stack.pop();
  showView();
  if (S.stack.length) renderDetail();
}

function renderAll() {
  renderNow();
  renderMini();
  renderLibTypes();
  renderSearchTypes();
}

// ---------- Auswahlfenster, Hinweise ----------
const sheetKind = () => ($('#sheet').hidden ? '' : $('#sheet').dataset.kind);

function openSheet(title, body, kind) {
  const sheet = $('#sheet');
  const sameKind = !sheet.hidden && sheet.dataset.kind === kind;
  const scroll = sameKind ? sheet.scrollTop : 0;
  sheet.dataset.kind = kind || '';
  $('#sheetTitle').textContent = title;
  $('#sheetBody').replaceChildren(body);
  if (sameKind) sheet.style.animation = 'none'; else sheet.style.animation = '';
  sheet.hidden = false;
  sheet.scrollTop = scroll;
  $('#sheetBackdrop').hidden = false;
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheetBackdrop').hidden = true;
  $('#sheet').dataset.kind = '';
  S.draggingSheetVolume = false;
}

let toastTimer;
function toast(msg, isError = false, action = null) {
  const t = $('#toast');
  t.replaceChildren(el('span', {}, msg));
  if (action) t.append(el('button', { onclick: () => { t.hidden = true; action.onClick(); } }, action.label));
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 8000 : isError ? 5000 : 2400);
}
function showBanner(msg) { const b = $('#banner'); b.textContent = msg; b.hidden = false; }
function hideBanner() { $('#banner').hidden = true; }

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}

function openNowMore() {
  const p = currentPlayer();
  const body = el('div', {});
  const add = (ic, text, fn, disabled) => body.append(el('button', { class: 'sheet-item', disabled, onclick: fn }, icon(ic), el('span', { class: 'grow' }, text)));
  add('speaker', 'Wiedergabegerät wählen / gruppieren', openDevices);
  add('queue', 'Warteschlange', openQueue, !p);
  add('stop', 'Wiedergabe beenden', () => { closeSheet(); svc('media_stop'); }, !p || !supports(p, F.STOP));
  openSheet(p?.attributes?.media_title || 'Wiedergabe', body, 'actions');
}

function openSettings() {
  const entryInput = el('input', { type: 'text', value: S.settings.configEntryId || '', placeholder: S.configEntryId ? `automatisch: ${S.configEntryId}` : 'z. B. 01ABC…', spellcheck: 'false' });
  const nameInput = el('input', { type: 'text', value: S.settings.localName || defaultDeviceName(), maxlength: '40' });
  const hostInput = el('input', { type: 'text', value: S.settings.maHost || '', placeholder: [...S.maHosts][0] ? `automatisch: ${[...S.maHosts][0]}` : 'z. B. 192.168.1.20', spellcheck: 'false' });
  const showAll = el('input', { type: 'checkbox' });
  showAll.checked = !!S.settings.showUnavailable;
  const localStatus = local.state === 'connected' ? `verbunden (${local.route})`
    : local.state === 'connecting' ? 'verbindet …'
      : local.state === 'error' ? 'Fehler' : 'aus';
  const body = el('div', { class: 'settings' },
    el('div', { class: 'kv' }, el('span', {}, 'Home Assistant'), el('span', {}, S.auth?.hassUrl || '–')),
    el('div', { class: 'kv' }, el('span', {}, 'Version'), el('span', {}, S.conn?.haVersion || '–')),
    el('div', { class: 'kv' }, el('span', {}, 'Anmeldung'), el('span', {}, S.auth?.type === 'token' ? 'Zugriffstoken' : 'Home-Assistant-Konto')),
    el('div', { class: 'kv' }, el('span', {}, 'Music-Assistant-Player'), el('span', {}, String(S.players.length))),
    el('div', { class: 'kv' }, el('span', {}, 'Dieses Gerät als Lautsprecher'), el('span', {}, localStatus)),
    el('label', {}, 'Name dieses Geräts (so erscheint es in Music Assistant und Home Assistant)'),
    nameInput,
    el('label', {}, 'Adresse von Music Assistant (nur falls „Dieses Gerät“ keine Verbindung findet)'),
    hostInput,
    el('label', {}, 'Music-Assistant-Integration (Config-Entry-ID, nur falls nicht automatisch erkannt)'),
    entryInput,
    el('label', { class: 'check' }, showAll, 'Nicht erreichbare Player anzeigen'),
    el('button', {
      class: 'btn primary wide',
      onclick: () => {
        const newName = nameInput.value.trim() || defaultDeviceName();
        const newHost = hostInput.value.trim().replace(/^https?:\/\//, '').replace(/[:/].*$/, '') || undefined;
        const localChanged = newName !== (S.settings.localName || defaultDeviceName()) || newHost !== S.settings.maHost;
        S.settings.localName = newName;
        S.settings.maHost = newHost;
        S.settings.configEntryId = entryInput.value.trim() || undefined;
        S.settings.showUnavailable = showAll.checked;
        saveSettings();
        if (S.settings.configEntryId) S.configEntryId = S.settings.configEntryId;
        closeSheet();
        toast('Gespeichert');
        S.lib.items = [];
        if (S.tab === 'library') loadLibrary(true);
        if (!S.settings.configEntryId && S.conn) findConfigEntry(S.conn).then((id) => { S.configEntryId = id; });
        if (localChanged && S.settings.localEnabled) startLocal(false);
      },
    }, 'Speichern'),
    el('button', {
      class: 'btn danger wide',
      onclick: async () => {
        closeSheet();
        const a = S.auth;
        S.auth = null;
        local.stop();
        if (S.conn) { S.conn.close(); S.conn = null; }
        await logout(a);
        S.home.loaded = false;
        showLogin();
      },
    }, icon('logout', 'small'), 'Abmelden'),
    el('p', { class: 'muted small' }, `Musik ${APP_VERSION}`),
  );
  openSheet('Einstellungen', body, 'settings');
}

// ---------- Ereignisse ----------
function bindUI() {
  fillIcons();
  $('#hassUrl').addEventListener('input', updateMixedWarning);
  $('#loginBtn').addEventListener('click', () => {
    const u = readLoginUrl();
    if (u) startLogin(u);
  });
  $('#hassUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginBtn').click(); });
  $('#tokenBtn').addEventListener('click', () => {
    const u = readLoginUrl();
    const token = $('#token').value.trim();
    if (!u) return;
    if (!token) { showLogin('Bitte ein Zugriffstoken einfügen.'); return; }
    S.auth = { type: 'token', hassUrl: u, access_token: token };
    saveAuth(S.auth);
    $('#token').value = '';
    $('#loginError').hidden = true;
    S.freshLogin = true;
    connect();
  });

  $('#deviceBtn').addEventListener('click', openDevices);
  $('#miniDevice').addEventListener('click', openDevices);
  $('#nowDeviceBtn').addEventListener('click', openDevices);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#sheet').hidden) closeSheet();
    else if (!$('#now').hidden) closeNow();
  });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  $('#backBtn').addEventListener('click', goBack);

  $('#miniOpen').addEventListener('click', openNow);
  $('#nowClose').addEventListener('click', closeNow);
  $('#nowMore').addEventListener('click', openNowMore);
  $('#queueBtn').addEventListener('click', openQueue);

  $('#playBtn').addEventListener('click', togglePlay);
  $('#miniPlay').addEventListener('click', togglePlay);
  $('#prevBtn').addEventListener('click', () => svc('media_previous_track'));
  $('#nextBtn').addEventListener('click', () => svc('media_next_track'));
  $('#miniNext').addEventListener('click', () => svc('media_next_track'));
  $('#shuffleBtn').addEventListener('click', () => svc('shuffle_set', { shuffle: !currentPlayer()?.attributes?.shuffle }));
  $('#repeatBtn').addEventListener('click', () => {
    const next = { off: 'all', all: 'one', one: 'off' }[currentPlayer()?.attributes?.repeat || 'off'] || 'off';
    svc('repeat_set', { repeat: next });
  });
  $('#muteBtn').addEventListener('click', () => svc('volume_mute', { is_volume_muted: !currentPlayer()?.attributes?.is_volume_muted }));
  $('#powerBtn').addEventListener('click', () => svc(currentPlayer()?.state === 'off' ? 'turn_on' : 'turn_off'));

  const vol = $('#volume');
  let volTimer = null;
  const sendVol = () => svc('volume_set', { volume_level: Number(vol.value) / 100 });
  vol.addEventListener('input', () => {
    S.draggingVolume = true;
    $('#volVal').textContent = vol.value;
    if (!volTimer) volTimer = setTimeout(() => { volTimer = null; sendVol(); }, 250);
  });
  vol.addEventListener('change', () => {
    clearTimeout(volTimer); volTimer = null;
    sendVol();
    setTimeout(() => { S.draggingVolume = false; }, 800);
  });

  $('#progressBar').addEventListener('click', seekFromEvent);
  $('#progressBar').addEventListener('keydown', (e) => {
    const p = currentPlayer();
    const pos = currentPosition(p);
    if (pos == null || !supports(p, F.SEEK)) return;
    if (e.key === 'ArrowRight') svc('media_seek', { seek_position: Math.round(pos + 10) });
    if (e.key === 'ArrowLeft') svc('media_seek', { seek_position: Math.max(0, Math.round(pos - 10)) });
  });

  const filter = debounce(() => { S.lib.filter = $('#libFilter').value.trim(); loadLibrary(true); }, 400);
  $('#libFilter').addEventListener('input', filter);
  $('#libOrder').addEventListener('change', (e) => { S.lib.order = e.target.value; loadLibrary(true); });
  $('#libFav').addEventListener('click', (e) => {
    S.lib.fav = !S.lib.fav;
    e.currentTarget.setAttribute('aria-pressed', String(S.lib.fav));
    loadLibrary(true);
  });
  // Automatisch nachladen, wenn das Ende der Liste sichtbar wird
  new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting) && S.tab === 'library' && !S.stack.length && S.lib.items.length) loadLibrary();
  }, { rootMargin: '400px' }).observe($('#libMore'));

  $('#searchInput').addEventListener('input', debounce(runSearch, 450));
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { runSearch(); e.target.blur(); } });

  setInterval(() => { if (currentPlayer()?.state === 'playing') renderProgress(); }, 1000);
}

// ---------- Start ----------
async function init() {
  bindUI();
  renderLibTypes();
  renderSearchTypes();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try {
    S.auth = await finishLoginFromUrl();
    if (S.auth) S.freshLogin = true;
  } catch (e) {
    showLogin(e.message);
    return;
  }
  S.auth = S.auth || loadAuth();
  if (!S.auth) { showLogin(); return; }
  connect();
}

init();

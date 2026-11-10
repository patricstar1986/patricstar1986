// Verbindung zu Home Assistant: Anmeldung (über die HA-Anmeldeseite oder mit Token)
// und die WebSocket-API. Keine externen Bibliotheken.

const AUTH_KEY = 'musikapp.auth';

export class AuthError extends Error {}

export function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}

export function saveAuth(auth) {
  try {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  } catch { /* privater Modus o. Ä. – dann gilt die Anmeldung nur bis zum Schließen */ }
}

/** "homeassistant.local:8123/" → "http://homeassistant.local:8123" */
export function normalizeUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}

/** Läuft die App direkt aus Home Assistant heraus (Ordner /config/www → /local/…)? */
export function servedByHomeAssistant() {
  return location.pathname.startsWith('/local/') || location.pathname.startsWith('/hacsfiles/');
}

const clientId = () => `${location.protocol}//${location.host}/`;
const redirectUri = () => location.origin + location.pathname;

/** Leitet zur Anmeldeseite von Home Assistant weiter (wie die offizielle App). */
export function startLogin(hassUrl) {
  const state = btoa(JSON.stringify({ hassUrl, clientId: clientId() }));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    state,
  });
  location.href = `${hassUrl}/auth/authorize?${q}`;
}

async function tokenRequest(hassUrl, params) {
  let res;
  try {
    res = await fetch(`${hassUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      credentials: 'omit',
    });
  } catch (e) {
    throw new Error('Home Assistant ist nicht erreichbar (' + e.message + ')');
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new AuthError('Anmeldung abgelaufen oder ungültig – bitte neu anmelden.');
  }
  if (!res.ok) throw new Error(`Anmeldung fehlgeschlagen (HTTP ${res.status})`);
  return res.json();
}

/** Nach der Rückkehr von der Anmeldeseite: Code gegen Token tauschen. */
export async function finishLoginFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') || !q.has('state')) return null;
  let st;
  try { st = JSON.parse(atob(q.get('state'))); } catch { return null; }
  history.replaceState(null, '', location.pathname);
  const d = await tokenRequest(st.hassUrl, {
    grant_type: 'authorization_code',
    code: q.get('code'),
    client_id: st.clientId,
  });
  const auth = {
    type: 'oauth',
    hassUrl: st.hassUrl,
    clientId: st.clientId,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires: Date.now() + d.expires_in * 1000,
  };
  saveAuth(auth);
  return auth;
}

/** Gültiges Zugriffstoken liefern, bei Bedarf erneuern. */
export async function getAccessToken(auth) {
  if (auth.type === 'token') return auth.access_token;
  if (auth.expires - 60_000 > Date.now()) return auth.access_token;
  const d = await tokenRequest(auth.hassUrl, {
    grant_type: 'refresh_token',
    refresh_token: auth.refresh_token,
    client_id: auth.clientId,
  });
  auth.access_token = d.access_token;
  auth.expires = Date.now() + d.expires_in * 1000;
  saveAuth(auth);
  return auth.access_token;
}

/** Abmelden: Refresh-Token bei HA widerrufen (best effort) und lokal löschen. */
export async function logout(auth) {
  if (auth && auth.type === 'oauth' && auth.refresh_token) {
    try {
      await fetch(`${auth.hassUrl}/auth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: auth.refresh_token }),
        credentials: 'omit',
      });
    } catch { /* egal */ }
  }
  saveAuth(null);
}

/**
 * Eine WebSocket-Verbindung zu Home Assistant.
 * Events: "close" (Verbindung verloren).
 */
export class HAConnection extends EventTarget {
  constructor(auth) {
    super();
    this.auth = auth;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.subscriptions = new Map();
    this.haVersion = null;
  }

  get open() { return this.ws && this.ws.readyState === WebSocket.OPEN && this.authed; }

  async connect() {
    const token = await getAccessToken(this.auth);
    const wsUrl = this.auth.hassUrl.replace(/^http/i, 'ws') + '/api/websocket';
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      this.authed = false;
      ws.onmessage = (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        for (const msg of Array.isArray(data) ? data : [data]) {
          if (msg.type === 'auth_required') {
            ws.send(JSON.stringify({ type: 'auth', access_token: token }));
          } else if (msg.type === 'auth_ok') {
            this.authed = true;
            this.haVersion = msg.ha_version;
            settled = true;
            resolve(this);
          } else if (msg.type === 'auth_invalid') {
            settled = true;
            reject(new AuthError(msg.message || 'Token ungültig'));
            ws.close();
          } else {
            this._handle(msg);
          }
        }
      };
      ws.onclose = () => {
        const wasAuthed = this.authed;
        this.authed = false;
        for (const p of this.pending.values()) p.reject(new Error('Verbindung getrennt'));
        this.pending.clear();
        this.subscriptions.clear();
        if (!settled) {
          settled = true;
          reject(new Error(`Keine Verbindung zu ${this.auth.hassUrl}`));
        }
        if (wasAuthed) this.dispatchEvent(new Event('close'));
      };
      ws.onerror = () => { /* onclose folgt */ };
    });
  }

  _handle(msg) {
    if (msg.type === 'result' || msg.type === 'pong') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (p.subscription) {
        // Ergebnis eines subscribe_*: Abo bleibt aktiv
        if (msg.success === false) { this.subscriptions.delete(msg.id); p.reject(haError(msg.error)); }
        else p.resolve(msg.id);
      } else if (msg.type === 'pong' || msg.success) p.resolve(msg.result);
      else p.reject(haError(msg.error));
      this.pending.delete(msg.id);
    } else if (msg.type === 'event') {
      const cb = this.subscriptions.get(msg.id);
      if (cb) cb(msg.event);
    }
  }

  send(message, timeoutMs = 30_000) {
    if (!this.open) return Promise.reject(new Error('Keine Verbindung zu Home Assistant'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Zeitüberschreitung'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ ...message, id }));
    });
  }

  subscribe(message, callback) {
    if (!this.open) return Promise.reject(new Error('Keine Verbindung zu Home Assistant'));
    const id = this.nextId++;
    this.subscriptions.set(id, callback);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, subscription: true });
      this.ws.send(JSON.stringify({ ...message, id }));
    });
  }

  callService(domain, service, serviceData = {}, target = undefined, returnResponse = false) {
    const msg = { type: 'call_service', domain, service, service_data: serviceData };
    if (target) msg.target = target;
    if (returnResponse) msg.return_response = true;
    return this.send(msg);
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.authed = false;
      this.ws.close();
    }
  }
}

function haError(err) {
  const e = new Error((err && err.message) || 'Unbekannter Fehler von Home Assistant');
  e.code = err && err.code;
  return e;
}

// Bits aus MediaPlayerEntityFeature (Home Assistant)
export const F = {
  PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS_TRACK: 16, NEXT_TRACK: 32,
  TURN_ON: 128, TURN_OFF: 256, PLAY_MEDIA: 512, STOP: 4096, PLAY: 16384,
  SHUFFLE_SET: 32768, BROWSE_MEDIA: 131072, REPEAT_SET: 262144,
};

export const supports = (stateObj, feature) =>
  ((stateObj?.attributes?.supported_features ?? 0) & feature) !== 0;

/** Aktuelle Wiedergabeposition in Sekunden (HA meldet sie nur bei Änderungen). */
export function currentPosition(stateObj, now = Date.now()) {
  const a = stateObj?.attributes || {};
  if (typeof a.media_position !== 'number') return null;
  let pos = a.media_position;
  if (stateObj.state === 'playing' && a.media_position_updated_at) {
    pos += (now - new Date(a.media_position_updated_at).getTime()) / 1000;
  }
  if (typeof a.media_duration === 'number' && a.media_duration > 0) pos = Math.min(pos, a.media_duration);
  return Math.max(0, pos);
}

export function formatTime(sec) {
  if (sec == null || !isFinite(sec)) return '–:––';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

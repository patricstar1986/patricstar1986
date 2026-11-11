// „Dieses Gerät“: Das Handy bzw. der PC meldet sich bei Music Assistant als eigener
// Lautsprecher an (Sendspin-Protokoll). Danach taucht es in Home Assistant als
// media_player auf und wird wie jeder andere Player gesteuert.
//
// Zwei Wege zum Sendspin-Server von Music Assistant:
//   1. direkt:   ws://<music-assistant>:8927/sendspin   (nur wenn die App über http läuft)
//   2. Ingress:  über Home Assistant (/api/hassio_ingress/…/sendspin) – braucht ein
//      Admin-Konto, funktioniert dafür auch über https und von unterwegs.

const SENDSPIN_PORT = 8927;
const PRODUCT_NAME = 'Musik-App'; // bewusst NICHT „Web Player“: sonst gibt Music Assistant das Gerät nicht an Home Assistant weiter

export function defaultDeviceName() {
  const ua = navigator.userAgent || '';
  const iPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const kind = iPad ? 'iPad'
    : /iPhone|iPod/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? 'Android-Handy'
        : /Windows/.test(ua) ? 'Windows-PC'
          : /Macintosh/.test(ua) ? 'Mac'
            : 'Browser';
  return `${kind} (Musik-App)`;
}

/** Lässt sich zu dieser Adresse überhaupt eine WebSocket-Verbindung aufbauen? */
function probe(wsUrl, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    let ws;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws && ws.close(); } catch { /* egal */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try { ws = new WebSocket(wsUrl); } catch { finish(false); return; }
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

const toWs = (baseUrl) => baseUrl.replace(/^http/i, 'ws') + '/sendspin';

/**
 * Zustände: off → connecting → connected | error
 * Events: "change"
 */
export class LocalPlayer extends EventTarget {
  /**
   * @param {object} o
   * @param {() => import('./ha.js').HAConnection|null} o.getConn  aktuelle HA-Verbindung
   * @param {() => string} o.getHassUrl
   * @param {() => string[]} o.getHostHints  mögliche Adressen des Music-Assistant-Servers
   */
  constructor({ getConn, getHassUrl, getHostHints }) {
    super();
    this.getConn = getConn;
    this.getHassUrl = getHassUrl;
    this.getHostHints = getHostHints;
    this.state = 'off';
    this.error = '';
    this.route = '';      // 'direkt' | 'Home Assistant'
    this.name = '';
    this.player = null;
    this.playing = false;
    this.ingress = null;  // { entry, session }
    this.ingressTimer = null;
    this.needsUnlock = true;
    this._starting = null;
  }

  get active() { return this.state === 'connecting' || this.state === 'connected'; }

  _set(state, error = '') {
    this.state = state;
    this.error = error;
    this.dispatchEvent(new Event('change'));
  }

  /** Aus einer Tipp-/Klick-Behandlung aufrufen: Browser erlauben Ton nur nach einer Nutzeraktion. */
  unlock() {
    if (!this.player) return;
    this.player.unlock().then(() => { this.needsUnlock = false; }).catch(() => {});
  }

  async start(name) {
    if (this._starting) return this._starting;
    this._starting = this._start(name).finally(() => { this._starting = null; });
    return this._starting;
  }

  async _start(name) {
    if (this.player) this.stop();
    this.name = name;
    this._set('connecting');
    try {
      const baseUrl = await this._findEndpoint();
      const mod = await import('./vendor/sendspin.js');
      this.player = new mod.SendspinPlayer({
        baseUrl,
        clientName: name,
        productName: PRODUCT_NAME,
        codecs: ['opus', 'flac', 'pcm'], // was der Browser nicht kann, filtert die Bibliothek selbst heraus
        correctionMode: 'quality-local', // einzelnes Gerät: beste Tonqualität statt exaktem Gleichlauf
        requiredLeadTimeMs: 250,
        minBufferMs: 500,
        onStateChange: (s) => {
          const playing = !!s.isPlaying;
          if (playing !== this.playing) { this.playing = playing; this.dispatchEvent(new Event('change')); }
        },
      });
      this.unlock();
      await this.player.connect();
      this._set('connected');
    } catch (e) {
      this._cleanup();
      this._set('error', e.message || String(e));
      throw e;
    }
  }

  stop() {
    this._cleanup();
    this._set('off');
  }

  _cleanup() {
    clearInterval(this.ingressTimer);
    this.ingressTimer = null;
    if (this.player) {
      try { this.player.disconnect('user_request'); } catch { /* egal */ }
      this.player = null;
    }
    this.playing = false;
    this.needsUnlock = true;
  }

  /** Nach Standby o. Ä.: Verbindung prüfen. Die Bibliothek verbindet selbst neu; hier nur der Ingress-Cookie. */
  async refresh() {
    if (this.route === 'Home Assistant' && this.active) await this._renewIngressSession().catch(() => {});
    this.needsUnlock = true;
  }

  async _findEndpoint() {
    const errors = [];
    const hassUrl = this.getHassUrl();

    if (location.protocol === 'http:') {
      const hosts = [...new Set([...this.getHostHints(), new URL(hassUrl).hostname].filter(Boolean))];
      for (const host of hosts) {
        const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
        const base = `http://${h}:${SENDSPIN_PORT}`;
        if (await probe(toWs(base))) { this.route = 'direkt'; return base; }
      }
      errors.push(`Music Assistant ist auf Port ${SENDSPIN_PORT} nicht direkt erreichbar (${hosts.join(', ')})`);
    }

    // Über Home Assistant (Ingress). Der Cookie gilt nur, wenn die App von Home Assistant selbst kommt.
    if (new URL(hassUrl).origin === location.origin) {
      try {
        const base = await this._prepareIngress();
        if (await probe(toWs(base), 6000)) {
          this.route = 'Home Assistant';
          this.ingressTimer = setInterval(() => this._renewIngressSession().catch(() => {}), 60_000);
          return base;
        }
        errors.push('Verbindung über Home Assistant wurde abgelehnt');
      } catch (e) {
        errors.push('Über Home Assistant nicht möglich: ' + (e.message || e));
      }
    } else if (location.protocol === 'https:') {
      errors.push('Die App muss dafür direkt aus Home Assistant geöffnet werden (/local/musik/)');
    }
    throw new Error(errors.join(' · ') || 'Kein Weg zu Music Assistant gefunden');
  }

  _supervisor(endpoint, method = 'get', data = undefined) {
    const conn = this.getConn();
    if (!conn) throw new Error('Keine Verbindung zu Home Assistant');
    const msg = { type: 'supervisor/api', endpoint, method };
    if (data) msg.data = data;
    return conn.send(msg, 10_000);
  }

  async _prepareIngress() {
    if (!this.ingress) {
      let list;
      try {
        list = await this._supervisor('/addons');
      } catch (e) {
        throw new Error(/unauthorized|admin/i.test(e.message) ? 'dafür ist ein Admin-Konto nötig' : e.message);
      }
      const addon = (list.addons || []).find((a) => /(^|_)music_assistant(_beta|_nightly|_dev)?$/.test(a.slug) && a.state === 'started')
        || (list.addons || []).find((a) => /music.?assistant/i.test(a.name || ''));
      if (!addon) throw new Error('die Music-Assistant-App wurde in Home Assistant nicht gefunden');
      const info = await this._supervisor(`/addons/${addon.slug}/info`);
      if (!info.ingress_entry) throw new Error('Music Assistant bietet keinen Zugang über Home Assistant an');
      this.ingress = { entry: info.ingress_entry, session: null };
    }
    await this._renewIngressSession(true);
    return this.getHassUrl() + this.ingress.entry;
  }

  async _renewIngressSession(forceNew = false) {
    if (!this.ingress) return;
    if (!forceNew && this.ingress.session) {
      try {
        await this._supervisor('/ingress/validate_session', 'post', { session: this.ingress.session });
        return;
      } catch { /* abgelaufen → neue Sitzung */ }
    }
    const r = await this._supervisor('/ingress/session', 'post');
    this.ingress.session = r.session;
    // genauso wie die Oberfläche von Home Assistant selbst
    document.cookie = `ingress_session=${r.session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === 'https:' ? ';Secure' : ''}`;
  }
}

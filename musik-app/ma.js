// Direkter Draht zu Music Assistant (über Home-Assistant-Ingress).
// Home Assistant gibt nur Mediathek und Suche weiter. Empfehlungen, Musikrichtungen und
// die vollständige Warteschlange gibt es nur in der Schnittstelle von Music Assistant selbst.
// Diese Verbindung ist eine Zugabe: Ohne sie (z. B. ohne Admin-Konto) läuft die App wie bisher.

const RETRY_AFTER_MS = 60_000;

export class MusicAssistantApi extends EventTarget {
  /** @param {import('./ingress.js').Ingress} ingress */
  constructor(ingress) {
    super();
    this.ingress = ingress;
    this.base = '';
    this.ws = null;
    this.ready = false;
    this.error = '';
    this.serverVersion = '';
    this.nextId = 1;
    this.pending = new Map();
    this._connecting = null;
    this._failedAt = 0;
  }

  /** Verbindung herstellen, falls nötig. Wirft, wenn Music Assistant so nicht erreichbar ist. */
  ensure() {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this._connecting) return this._connecting;
    if (this._failedAt && Date.now() - this._failedAt < RETRY_AFTER_MS) return Promise.reject(new Error(this.error));
    this._connecting = this._connect()
      .then(() => { this._failedAt = 0; this.error = ''; })
      .catch((e) => { this._failedAt = Date.now(); this.error = e.message || String(e); throw e; })
      .finally(() => { this._connecting = null; this.dispatchEvent(new Event('change')); });
    return this._connecting;
  }

  async _connect() {
    this.base = await this.ingress.prepare();
    const url = this.base.replace(/^http/i, 'ws') + '/ws';
    await new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { if (!settled) { settled = true; ws.close(); reject(new Error('Music Assistant antwortet nicht')); } }, 8000);
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!settled && msg.server_version) {
          // erste Nachricht: Angaben zum Server. Über Ingress ist man damit schon angemeldet.
          settled = true;
          clearTimeout(timer);
          this.ws = ws;
          this.ready = true;
          this.serverVersion = msg.server_version;
          resolve();
          return;
        }
        this._handle(msg);
      };
      ws.onclose = () => {
        if (this.ws === ws || !settled) { this.ready = false; }
        for (const p of this.pending.values()) p.reject(new Error('Verbindung zu Music Assistant getrennt'));
        this.pending.clear();
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Music Assistant hat die Verbindung abgelehnt')); }
      };
      ws.onerror = () => { /* onclose folgt */ };
    });
    // Texte (z. B. Namen von Musikrichtungen) nach Möglichkeit auf Deutsch
    this.send('translations/set_locale', { locale: 'de' }).catch(() => {});
  }

  _handle(msg) {
    const p = msg.message_id != null && this.pending.get(String(msg.message_id));
    if (!p) return; // Ereignisse des Servers interessieren hier nicht
    if ('error_code' in msg) {
      this.pending.delete(String(msg.message_id));
      p.reject(new Error(msg.details || `Music Assistant meldet Fehler ${msg.error_code}`));
    } else if (msg.partial) {
      if (Array.isArray(msg.result)) p.parts.push(...msg.result);
    } else {
      this.pending.delete(String(msg.message_id));
      p.resolve(p.parts.length && Array.isArray(msg.result) ? [...p.parts, ...msg.result] : (p.parts.length && msg.result == null ? p.parts : msg.result));
    }
  }

  /** Befehl an Music Assistant schicken (z. B. "music/recommendations"). */
  async send(command, args = undefined, timeoutMs = 20_000) {
    if (command !== 'translations/set_locale') await this.ensure();
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error('Zeitüberschreitung bei Music Assistant')); }, timeoutMs);
      this.pending.set(id, {
        parts: [],
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      const msg = { message_id: id, command };
      if (args) msg.args = args;
      try { this.ws.send(JSON.stringify(msg)); } catch (e) { this.pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }

  /** Adresse eines Bildes aus den Angaben von Music Assistant. Erlaubte Größen: 80, 160, 256, 512, 1024. */
  imageUrl(image, size = 256) {
    if (!image) return null;
    if (image.remotely_accessible && /^https?:/i.test(image.path || '')) return image.path;
    if (image.proxy_id && this.base) return `${this.base}/imageproxy/${image.proxy_id}?size=${size}`;
    return null;
  }

  /** Heimnetz-Adresse eines Bildes (http://…:8095/imageproxy/<id>) auf den Weg über Home Assistant umbiegen. */
  rewriteProxyUrl(url, size = 256) {
    const m = this.base && /^https?:\/\/[^/]+\/imageproxy\/([A-Za-z0-9_-]+)/.exec(url || '');
    return m ? `${this.base}/imageproxy/${m[1]}?size=${size}` : url;
  }

  close() {
    this.ready = false;
    this._failedAt = 0;
    if (this.ws) { try { this.ws.close(); } catch { /* egal */ } this.ws = null; }
  }
}

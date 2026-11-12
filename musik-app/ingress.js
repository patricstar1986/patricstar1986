// Zugang zu Music Assistant über Home Assistant („Ingress“).
// Home Assistant reicht Anfragen unter /api/hassio_ingress/<kennung>/… an die
// Music-Assistant-App weiter. Dafür braucht es eine Ingress-Sitzung (Cookie), die nur
// ein Admin-Konto anlegen darf, und die App muss von Home Assistant selbst kommen.

export class Ingress {
  /**
   * @param {object} o
   * @param {() => import('./ha.js').HAConnection|null} o.getConn  aktuelle HA-Verbindung
   * @param {() => string} o.getHassUrl
   */
  constructor({ getConn, getHassUrl }) {
    this.getConn = getConn;
    this.getHassUrl = getHassUrl;
    this.entry = '';
    this.session = '';
    this.timer = null;
    this._preparing = null;
  }

  /** Geht nur, wenn die App von derselben Adresse kommt wie Home Assistant (wegen des Cookies). */
  get possible() {
    try { return new URL(this.getHassUrl()).origin === location.origin; } catch { return false; }
  }

  _supervisor(endpoint, method = 'get', data = undefined) {
    const conn = this.getConn();
    if (!conn) throw new Error('Keine Verbindung zu Home Assistant');
    const msg = { type: 'supervisor/api', endpoint, method };
    if (data) msg.data = data;
    return conn.send(msg, 10_000);
  }

  /** Liefert die Basisadresse (ohne Schrägstrich am Ende), unter der Music Assistant erreichbar ist. */
  prepare() {
    if (!this._preparing) this._preparing = this._prepare().finally(() => { this._preparing = null; });
    return this._preparing;
  }

  async _prepare() {
    if (!this.possible) throw new Error('die App muss dafür direkt aus Home Assistant geöffnet werden (/local/musik/)');
    if (!this.entry) {
      let list;
      try {
        list = await this._supervisor('/addons');
      } catch (e) {
        throw new Error(/unauthorized|admin/i.test(e.message) ? 'dafür ist ein Admin-Konto nötig' : e.message);
      }
      const addons = list.addons || [];
      const addon = addons.find((a) => /(^|_)music_assistant(_beta|_nightly|_dev)?$/.test(a.slug) && a.state === 'started')
        || addons.find((a) => /music.?assistant/i.test(a.name || ''));
      if (!addon) throw new Error('die Music-Assistant-App wurde in Home Assistant nicht gefunden');
      const info = await this._supervisor(`/addons/${addon.slug}/info`);
      if (!info.ingress_entry) throw new Error('Music Assistant bietet keinen Zugang über Home Assistant an');
      this.entry = info.ingress_entry;
    }
    await this.renew(!this.session);
    if (!this.timer) this.timer = setInterval(() => this.renew().catch(() => {}), 60_000);
    return this.getHassUrl() + this.entry;
  }

  /** Sitzung verlängern bzw. neu anlegen (sie läuft sonst nach einigen Minuten ab). */
  async renew(forceNew = false) {
    if (!this.entry) return;
    if (!forceNew && this.session) {
      try {
        await this._supervisor('/ingress/validate_session', 'post', { session: this.session });
        return;
      } catch { /* abgelaufen → neue Sitzung */ }
    }
    const r = await this._supervisor('/ingress/session', 'post');
    this.session = r.session;
    // genauso wie die Oberfläche von Home Assistant selbst
    document.cookie = `ingress_session=${r.session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === 'https:' ? ';Secure' : ''}`;
  }

  /** Nach Abmelden o. Ä. */
  reset() {
    clearInterval(this.timer);
    this.timer = null;
    this.entry = '';
    this.session = '';
  }
}

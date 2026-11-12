// Nachgebauter Home-Assistant-Server für Tests der Musik-App.
// Liefert die App unter /local/musik/ aus und beantwortet die WebSocket-Befehle,
// die die App nutzt, im selben Format wie Home Assistant 2026.11 mit Music Assistant 2.10.
//
//   node mock-ha.mjs        → http://localhost:8123/local/musik/index.html
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../musik-app');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
export const TOKEN = 'test-token';
const ENTRY_ID = '01TESTENTRY';
const ADDON_SLUG = 'd5369777_music_assistant';
const INGRESS_ENTRY = '/api/hassio_ingress/TESTINGRESSTOKEN';
const MA_FEATURES = 8320575; // wie die echten Music-Assistant-Player (inkl. Gruppieren, ohne Ein/Aus)

const img = (c, c2 = '#0003') => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${c}"/><circle cx="7" cy="7" r="5" fill="${c2}"/></svg>`)}`;

function player(entity_id, name, state, extra = {}) {
  return {
    entity_id, state,
    attributes: {
      group_members: [], volume_level: 0.2, is_volume_muted: false, app_id: 'music_assistant',
      mass_player_type: 'player', active_queue: 'q_' + entity_id, device_class: 'speaker', friendly_name: name,
      supported_features: MA_FEATURES, shuffle: false, repeat: 'off', ...extra,
    },
    last_changed: new Date().toISOString(), last_updated: new Date().toISOString(), context: { id: 'x' },
  };
}

const TRACK = { title: "I'm on Your Side", artist: 'The Glorious Sons', album: 'A War on Everything', id: 'apple_music://track/1474250738', duration: 225 };
const NEXT_TRACK = { title: 'Move Along', artist: 'The All-American Rejects', album: 'Move Along (Deluxe Edition)', id: 'apple_music://track/6790495198', duration: 238 };

const mediaAttrs = (t, position = 0) => ({
  media_content_id: t.id, media_content_type: 'music', media_duration: t.duration, media_position: position,
  media_position_updated_at: new Date().toISOString(), media_title: t.title, media_artist: t.artist, media_album_name: t.album,
});
const MEDIA_KEYS = ['media_content_id', 'media_content_type', 'media_duration', 'media_position', 'media_position_updated_at',
  'media_title', 'media_artist', 'media_album_name', 'entity_picture_local'];

export function createState() {
  return {
    states: {
      'media_player.kuche_2': player('media_player.kuche_2', 'Küche', 'idle'),
      'media_player.ambeo_soundbar_plus_cast': player('media_player.ambeo_soundbar_plus_cast', 'AMBEO Soundbar Plus', 'playing', {
        ...mediaAttrs(TRACK, 20),
        entity_picture_local: '/api/media_player_proxy/media_player.ambeo_soundbar_plus_cast?token=abc',
        shuffle: true, volume_level: 0.1,
      }),
      'media_player.bravia': player('media_player.bravia', 'BRAVIA', 'off', { supported_features: 8320959 }),
      'media_player.werkstatt_apple_tv': { entity_id: 'media_player.werkstatt_apple_tv', state: 'unavailable', attributes: { friendly_name: 'Werkstatt Apple TV', supported_features: 0 } },
      'media_player.wohnzimmer_wohnzimmer': { entity_id: 'media_player.wohnzimmer_wohnzimmer', state: 'off', attributes: { friendly_name: 'Wohnzimmer (Apple TV)', supported_features: 450487 } },
      'light.kueche': { entity_id: 'light.kueche', state: 'on', attributes: {} },
    },
    queues: { 'media_player.ambeo_soundbar_plus_cast': { items: 18, index: 4 } },
    calls: [],
    admin: true,
    ingressSessions: new Set(),
    sendspinClients: [],
  };
}

const ALBUMS = [
  ['4356', '1000 Jahre EAV (Lieblingslieder aus 1000 Jahre EAV)', 'EAV', '4107', '#a5a'],
  ['5905', 'Classic Queen', 'Queen', '2975', null],
  ['11607', 'Zeit für Optimisten - EP', 'Silbermond', '3329', '#27a'],
  ['11606', 'Best of De Randfichten', 'De Randfichten', '864', '#7a2'],
  ['394', 'Innuendo', 'Queen', '2975', '#246'],
  ['3431', 'Tommy', 'The Who', '3909', '#a62'],
  ['2159', 'Rid of Me', 'PJ Harvey', '2917', '#933'],
];
const LIB = {
  playlist: Array.from({ length: 60 }, (_, i) => ({
    media_type: 'playlist', uri: `library://playlist/${i + 1}`, name: `Playlist ${String(i + 1).padStart(2, '0')}`,
    version: '', image: i % 7 === 3 ? 'http://127.0.0.1:1/broken.jpg' : img(['#c33', '#3c3', '#33c', '#cc3'][i % 4]), favorite: i % 5 === 0, explicit: null,
  })),
  album: ALBUMS.map(([id, name, artist, artistId, color], i) => ({
    media_type: 'album', uri: `library://album/${id}`, name, version: '', image: color ? img(color) : null, favorite: i === 1,
    artists: [{ media_type: 'artist', uri: `library://artist/${artistId}`, name: artist }],
  })),
  artist: [
    { media_type: 'artist', uri: 'library://artist/2975', name: 'Queen', version: '', image: img('#555', '#fff3'), favorite: false },
    { media_type: 'artist', uri: 'library://artist/4107', name: 'EAV', version: '', image: null, favorite: false },
    { media_type: 'artist', uri: 'library://artist/3329', name: 'Silbermond', version: '', image: img('#27a', '#fff3'), favorite: false },
  ],
  track: [{ media_type: 'track', uri: 'library://track/18335', name: '50ft Queenie', version: '', image: img('#933'), favorite: false, artists: [{ name: 'PJ Harvey' }], album: { name: 'Rid of Me' } }],
  radio: [
    { media_type: 'radio', uri: 'tunein://radio/s44910', name: "Queen's Radio", version: '', image: img('#393'), favorite: false },
    { media_type: 'radio', uri: 'tunein://radio/s1', name: 'Antenne Vorarlberg', version: '', image: img('#d60'), favorite: false },
    { media_type: 'radio', uri: 'tunein://radio/s2', name: 'Rock Antenne', version: '', image: img('#a11'), favorite: false },
  ],
  podcast: [], audiobook: [],
};

function browse(id) {
  if (id === 'library://artist/2975') {
    return {
      title: 'Queen', media_class: 'artist', media_content_type: 'artist', media_content_id: id, can_play: true, can_expand: true, thumbnail: null,
      children: [
        { title: 'Queen - Innuendo', media_class: 'album', media_content_type: 'music', media_content_id: 'library://album/394', can_play: true, can_expand: true, thumbnail: img('#246') },
        { title: 'Queen - Hot Space', media_class: 'album', media_content_type: 'music', media_content_id: 'library://album/1304', can_play: true, can_expand: true, thumbnail: null },
      ],
    };
  }
  return {
    title: 'Album', media_class: 'album', media_content_type: 'album', media_content_id: id, can_play: true, can_expand: true, thumbnail: null,
    children: ['Hereinspaziert', 'Woodstock', 'Afrika'].map((t, i) => ({
      title: `EAV - ${t}`, media_class: 'track', media_content_type: 'music', media_content_id: `apple_music://track/14881235${i}`,
      can_play: true, can_expand: false, thumbnail: img('#a5a'),
    })),
  };
}

const queueItem = (t) => ({
  queue_item_id: 'q' + t.id, name: `${t.artist} - ${t.title}`, duration: t.duration,
  media_item: {
    media_type: 'track', uri: t.id, name: t.title, version: '', image: img('#e83', '#fff'), favorite: false, explicit: null,
    artists: [{ media_type: 'artist', uri: 'x://artist/1', name: t.artist, version: '', image: null }],
    album: { media_type: 'album', uri: 'x://album/1', name: t.album, version: '', image: null },
  },
  stream_title: null,
});

export function startMock({ port = 8123, quiet = false } = {}) {
  const st = createState();
  const sockets = new Set();
  const log = (...a) => { if (!quiet) console.log(...a); };

  function emitState(id) {
    const ev = { event_type: 'state_changed', data: { entity_id: id, new_state: st.states[id] || null } };
    for (const s of sockets) for (const subId of s.subs) s.ws.send(JSON.stringify({ id: subId, type: 'event', event: ev }));
  }
  const emitSoon = (...ids) => setTimeout(() => ids.forEach(emitState), 30);

  function handleService(msg) {
    const { domain, service, service_data: d = {}, target } = msg;
    st.calls.push({ domain, service, data: d, target });
    log('call_service', domain, service, JSON.stringify(d), JSON.stringify(target || {}));
    const id = target?.entity_id;
    const p = st.states[id];
    if (domain === 'music_assistant') {
      if (service === 'get_library') {
        let items = [...(LIB[d.media_type] || [])];
        if (d.favorite) items = items.filter((x) => x.favorite);
        if (d.search) items = items.filter((x) => x.name.toLowerCase().includes(d.search.toLowerCase()));
        if (d.order_by && d.order_by !== 'name') items.reverse();
        const offset = d.offset || 0, limit = d.limit || 25;
        return { items: items.slice(offset, offset + limit), limit, offset, order_by: d.order_by || 'name', media_type: d.media_type };
      }
      if (service === 'search') {
        const q = d.name.toLowerCase();
        const f = (arr) => arr.filter((x) => x.name.toLowerCase().includes(q));
        const want = (t) => !d.media_type || d.media_type.includes(t);
        return {
          artists: want('artist') ? f(LIB.artist) : [], albums: want('album') ? f(LIB.album) : [],
          tracks: want('track') ? f(LIB.track) : [], playlists: want('playlist') ? f(LIB.playlist).slice(0, d.limit || 5) : [],
          radio: want('radio') ? f(LIB.radio) : [], audiobooks: [], podcasts: [],
        };
      }
      if (service === 'get_queue' && p) {
        const q = st.queues[id];
        const a = p.attributes;
        return {
          [id]: {
            queue_id: 'up' + id.length, active: !!q, name: a.friendly_name, items: q?.items || 0, shuffle_enabled: !!a.shuffle,
            repeat_mode: a.repeat || 'off', current_index: q ? q.index : null, elapsed_time: 20,
            current_item: q ? queueItem({ ...TRACK, title: a.media_title || TRACK.title }) : null,
            next_item: q && q.items > 1 ? queueItem(NEXT_TRACK) : null,
          },
        };
      }
      if (service === 'play_media' && p) {
        Object.assign(p.attributes, mediaAttrs({ id: String(d.media_id), title: `Gespielt: ${d.media_id}`, artist: 'Test', album: '', duration: 200 }),
          { entity_picture_local: `/api/media_player_proxy/${id}?token=abc` });
        p.state = 'playing';
        st.queues[id] = { items: 12, index: 0 };
        emitSoon(id);
        return null;
      }
      if (service === 'transfer_queue' && p) {
        const src = st.states[d.source_player];
        if (src) {
          for (const k of MEDIA_KEYS) { if (k in src.attributes) p.attributes[k] = src.attributes[k]; delete src.attributes[k]; }
          p.attributes.entity_picture_local = `/api/media_player_proxy/${id}?token=abc`;
          st.queues[id] = st.queues[d.source_player]; delete st.queues[d.source_player];
          src.state = 'idle';
          p.state = d.auto_play ? 'playing' : 'paused';
          emitSoon(d.source_player, id);
        }
        return null;
      }
      return null;
    }
    if (domain === 'media_player' && p) {
      const a = p.attributes;
      const changed = [id];
      switch (service) {
        case 'media_pause': p.state = 'paused'; break;
        case 'media_play': p.state = 'playing'; break;
        case 'media_stop': p.state = 'idle'; break;
        case 'volume_set': a.volume_level = d.volume_level; break;
        case 'volume_mute': a.is_volume_muted = d.is_volume_muted; break;
        case 'shuffle_set': a.shuffle = d.shuffle; break;
        case 'repeat_set': a.repeat = d.repeat; break;
        case 'media_seek': a.media_position = d.seek_position; a.media_position_updated_at = new Date().toISOString(); break;
        case 'media_next_track': Object.assign(a, mediaAttrs(NEXT_TRACK)); if (st.queues[id]) st.queues[id].index++; break;
        case 'clear_playlist': for (const k of MEDIA_KEYS) delete a[k]; delete st.queues[id]; p.state = 'idle'; break;
        case 'turn_off': p.state = 'off'; break;
        case 'turn_on': p.state = 'idle'; break;
        case 'join': {
          const members = [...new Set([id, ...(a.group_members || []), ...(d.group_members || [])])];
          for (const m of members) if (st.states[m]) { st.states[m].attributes.group_members = members; changed.push(m); }
          break;
        }
        case 'unjoin': {
          const members = (a.group_members || []).filter((m) => m !== id);
          const rest = members.length > 1 ? members : [];
          for (const m of members) if (st.states[m]) { st.states[m].attributes.group_members = rest; changed.push(m); }
          a.group_members = [];
          break;
        }
        default: break;
      }
      emitSoon(...new Set(changed));
    }
    return null;
  }

  function supervisor(msg) {
    if (!st.admin) return { error: ['unauthorized', 'Unauthorized'] };
    const { endpoint, method = 'get', data } = msg;
    st.calls.push({ supervisor: endpoint, method });
    if (endpoint === '/addons') return { result: { addons: [{ name: 'Mosquitto broker', slug: 'core_mosquitto', state: 'started' }, { name: 'Music Assistant', slug: ADDON_SLUG, state: 'started' }] } };
    if (endpoint === `/addons/${ADDON_SLUG}/info`) return { result: { slug: ADDON_SLUG, ingress: true, ingress_entry: INGRESS_ENTRY, ingress_port: 8094, host_network: true, state: 'started', version: '2.10.9' } };
    if (endpoint === '/ingress/session' && method === 'post') {
      const session = 'sess' + (st.ingressSessions.size + 1);
      st.ingressSessions.add(session);
      return { result: { session } };
    }
    if (endpoint === '/ingress/validate_session' && method === 'post') {
      return st.ingressSessions.has(data?.session) ? { result: {} } : { error: ['unknown_error', 'Session invalid'] };
    }
    return { error: ['not_found', 'Unknown endpoint'] };
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/auth/authorize') {
      // Echte HA zeigt hier die Anmeldemaske; der Test meldet sofort an.
      const r = new URL(url.searchParams.get('redirect_uri'));
      r.searchParams.set('code', 'auth-code');
      r.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: r.toString() });
      return res.end();
    }
    if (url.pathname === '/auth/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const p = new URLSearchParams(body);
        st.calls.push({ auth: p.get('grant_type') });
        if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'auth-code') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ access_token: TOKEN, refresh_token: 'refresh', expires_in: 1800, token_type: 'Bearer' }));
        }
        if (p.get('grant_type') === 'refresh_token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ access_token: TOKEN, expires_in: 1800, token_type: 'Bearer' }));
        }
        res.writeHead(400); res.end('{"error":"invalid_request"}');
      });
      return;
    }
    if (url.pathname === '/auth/revoke') { st.calls.push({ auth: 'revoke' }); res.writeHead(200); return res.end(); }
    if (url.pathname.startsWith('/api/media_player_proxy/')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#e83"/><circle cx="5" cy="5" r="3" fill="#fff"/></svg>');
    }
    if (url.pathname.startsWith(`${INGRESS_ENTRY}/imageproxy/`)) {
      // Bilder von Music Assistant über Home Assistant: nur mit gültiger Ingress-Sitzung
      if (!hasIngressSession(req)) { res.writeHead(401); return res.end(); }
      st.calls.push({ imageproxy: url.pathname.split('/').pop(), size: url.searchParams.get('size') });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0a7"/><rect x="2" y="2" width="6" height="6" fill="#fff8"/></svg>');
    }
    if (url.pathname.startsWith('/local/musik/')) {
      const rel = url.pathname.slice('/local/musik/'.length) || 'index.html';
      if (rel === 'index.html') st.indexRequests = (st.indexRequests || 0) + 1;
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // wie ein Server, der lange zwischenspeichern lässt
      const file = path.join(APP_DIR, rel);
      if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end('not found');
  });

  // --- WebSocket: Home-Assistant-API ---
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    const sock = { ws, subs: new Set(), authed: false };
    sockets.add(sock);
    ws.on('close', () => sockets.delete(sock));
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.11.1' }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      const reply = (result) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result }));
      const fail = (code, message) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code, message } }));
      if (!sock.authed) {
        if (msg.type === 'auth' && msg.access_token === TOKEN) { sock.authed = true; ws.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.11.1' })); }
        else { ws.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token or password' })); ws.close(); }
        return;
      }
      switch (msg.type) {
        case 'ping': return ws.send(JSON.stringify({ id: msg.id, type: 'pong' }));
        case 'subscribe_events': sock.subs.add(msg.id); return reply(null);
        case 'get_states': return reply(Object.values(st.states));
        case 'config/entity_registry/list_for_display':
          return reply({
            entity_categories: { 0: 'config', 1: 'diagnostic' },
            entities: Object.keys(st.states).map((ei) => ({
              ei, pl: ei.startsWith('light.') ? 'hue' : ei === 'media_player.wohnzimmer_wohnzimmer' ? 'apple_tv' : 'music_assistant',
            })),
          });
        case 'config_entries/get': return reply([{ entry_id: ENTRY_ID, domain: 'music_assistant', state: 'loaded', title: 'Music Assistant' }]);
        case 'media_player/browse_media': return reply(browse(msg.media_content_id));
        case 'supervisor/api': {
          const r = supervisor(msg);
          return r.error ? fail(...r.error) : reply(r.result);
        }
        case 'call_service': {
          if (msg.domain === 'music_assistant' && ['get_library', 'search'].includes(msg.service) && msg.service_data?.config_entry_id !== ENTRY_ID) {
            return fail('service_validation_error', 'Config entry not found');
          }
          const response = handleService(msg);
          return reply({ context: { id: 'ctx' }, ...(msg.return_response ? { response } : {}) });
        }
        default: return fail('unknown_command', 'Unknown command.');
      }
    });
  });

  // --- WebSocket: Schnittstelle von Music Assistant über Ingress (Empfehlungen, Musikrichtungen, Warteschlange) ---
  // Format wie in Music Assistant 2.10: erst Server-Angaben, dann {message_id, command, args} → {message_id, result}.
  const maItem = (type, id, name, extra = {}) => ({
    item_id: String(id), provider: 'library', name, version: '', media_type: type, uri: `library://${type}/${id}`, favorite: false,
    metadata: { images: [{ type: 'thumb', path: `/data/${id}.jpg`, provider: 'builtin', remotely_accessible: false, proxy_id: `px${id}` }] }, ...extra,
  });
  const MA_ROWS = [
    { item_id: 'fuer_dich', provider: 'apple_music--TEST', name: 'Für dich zusammengestellt', media_type: 'folder', enabled_by_default: true, items: [] },
    { item_id: 'recently_played', provider: 'recommendations', name: 'Recently played', translation_key: 'recently_played', media_type: 'folder', enabled_by_default: true, items: [] },
    { item_id: 'random_albums', provider: 'recommendations', name: 'Random albums', translation_key: 'random_albums', media_type: 'folder', enabled_by_default: false, items: [] },
    { item_id: 'forgotten_albums', provider: 'recommendations', name: 'Forgotten Albums', translation_key: 'forgotten_albums', media_type: 'folder', enabled_by_default: true, items: [] },
    { item_id: 'leer', provider: 'apple_music--TEST', name: 'Leere Reihe', media_type: 'folder', enabled_by_default: true, items: [] },
  ];
  const MA_ROW_ITEMS = {
    fuer_dich: [
      { item_id: 'ra.1', provider: 'apple_music--TEST', name: 'Patrics Sender', version: '', media_type: 'playlist', uri: 'apple_music--TEST://playlist/ra.1', favorite: false,
        metadata: { images: [{ type: 'thumb', path: 'https://example.invalid/sender.jpg', provider: 'apple_music', remotely_accessible: true }] } },
      maItem('playlist', 901, 'Energie'), maItem('playlist', 902, 'Chill-Mix'),
      { item_id: 'x', provider: 'library', name: 'Ordner', media_type: 'folder', uri: 'library://folder/x' },
    ],
    recently_played: [maItem('album', 4356, '1000 Jahre EAV', { artists: [{ name: 'EAV' }] }), maItem('track', 18335, '50ft Queenie', { artists: [{ name: 'PJ Harvey' }], album: { name: 'Rid of Me' } })],
    forgotten_albums: [maItem('album', 394, 'Innuendo', { artists: [{ name: 'Queen' }] })],
    leer: [],
  };
  const MA_GENRES = [{ item_id: '7', provider: 'library', name: 'Rock', translation_key: 'rock', media_type: 'genre' }, { item_id: '9', provider: 'library', name: 'Hip Hop', translation_key: 'hip_hop', media_type: 'genre' }];
  const maQueueItem = (i) => ({
    queue_id: 'q', queue_item_id: `qi${i}`, name: `Künstler ${i} - Titel ${i}`, duration: 180 + i, sort_index: i,
    media_item: { item_id: String(i), provider: 'library', name: `Titel ${i}`, media_type: 'track', uri: `library://track/${i}`, artists: [{ name: `Künstler ${i}` }] },
    image: { type: 'thumb', path: `/q/${i}.jpg`, provider: 'builtin', remotely_accessible: false, proxy_id: `pq${i}` },
  });
  const hasIngressSession = (req) => st.ingressSessions.has(/(?:^|;\s*)ingress_session=([^;]+)/.exec(req.headers.cookie || '')?.[1]);
  const maWss = new WebSocketServer({ noServer: true });
  maWss.on('connection', (ws) => {
    ws.send(JSON.stringify({ server_id: 'test', server_version: '2.10.9', schema_version: 32, min_supported_schema_version: 24, homeassistant_addon: true, onboard_done: true, name: 'Test' }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      const a = msg.args || {};
      st.calls.push({ ma: msg.command, args: a });
      const ok = (result, partial = false) => ws.send(JSON.stringify({ message_id: msg.message_id, result, ...(partial ? { partial: true } : {}) }));
      switch (msg.command) {
        case 'translations/set_locale': return ok({ locale: a.locale });
        case 'music/recommendations': return ok(MA_ROWS);
        case 'music/recommendations/items': return ok(MA_ROW_ITEMS[a.item_id] || []);
        case 'music/genres/library_items': return ok(MA_GENRES);
        case 'music/genres/overview':
          return ok(a.item_id === '7' ? [
            { item_id: 'genre_7_artists', provider: 'library', name: 'Artists', translation_key: 'artists', media_type: 'folder', items: [maItem('artist', 2975, 'Queen')] },
            { item_id: 'genre_7_albums', provider: 'library', name: 'Albums', translation_key: 'albums', media_type: 'folder', items: [maItem('album', 394, 'Innuendo', { artists: [{ name: 'Queen' }] })] },
            { item_id: 'genre_7_tracks', provider: 'library', name: 'Tracks', translation_key: 'tracks', media_type: 'folder', items: [] },
          ] : []);
        case 'player_queues/items': {
          // wie der echte Server bei langen Listen: in Teilen geliefert
          const all = Array.from({ length: Math.max(0, (st.maQueueLength ?? 18) - a.offset) }, (_, i) => maQueueItem(a.offset + i)).slice(0, a.limit);
          ok(all.slice(0, 5), true);
          return ok(all.slice(5));
        }
        case 'player_queues/get': return ok({ queue_id: a.queue_id, active: true, items: 18, autoplay_enabled: !!st.autoplay?.[a.queue_id], dont_stop_the_music_enabled: !!st.autoplay?.[a.queue_id] });
        case 'player_queues/autoplay': st.autoplay = { ...(st.autoplay || {}), [a.queue_id]: a.autoplay_enabled }; return ok(null);
        case 'player_queues/play_index': return ok(null);
        case 'player_queues/delete_item': st.maQueueLength = (st.maQueueLength ?? 18) - 1; return ok(null);
        default: return ws.send(JSON.stringify({ message_id: msg.message_id, error_code: 1, details: `Unbekannter Befehl ${msg.command}` }));
      }
    });
  });

  // --- WebSocket: Sendspin über Ingress (Music Assistant als Abspielziel für „Dieses Gerät“) ---
  // Die Tests ersetzen die echte Sendspin-Bibliothek durch eine Attrappe, die hier nur ihren Namen meldet.
  // Wie Music Assistant erscheint das Gerät danach als neuer media_player in Home Assistant.
  const sendspin = new WebSocketServer({ noServer: true });
  sendspin.on('connection', (ws) => {
    let entityId = null;
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type !== 'hello') return;
      st.sendspinClients.push(msg.name);
      entityId = 'media_player.' + msg.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      setTimeout(() => {
        if (ws.readyState !== ws.OPEN) return;
        st.states[entityId] = player(entityId, msg.name, 'idle', { volume_level: 1 });
        emitState(entityId);
      }, 250);
    });
    ws.on('close', () => {
      if (entityId && st.states[entityId]) { st.states[entityId].state = 'unavailable'; emitState(entityId); }
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/websocket') return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    if (url.pathname === `${INGRESS_ENTRY}/sendspin`) {
      if (hasIngressSession(req)) return sendspin.handleUpgrade(req, socket, head, (ws) => sendspin.emit('connection', ws, req));
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    } else if (url.pathname === `${INGRESS_ENTRY}/ws`) {
      if (hasIngressSession(req)) return maWss.handleUpgrade(req, socket, head, (ws) => maWss.emit('connection', ws, req));
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    }
    socket.destroy();
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve({
      url: `http://localhost:${server.address().port}`,
      state: st,
      emitState,
      dropConnections: () => { for (const s of sockets) s.ws.terminate(); },
      close: () => new Promise((r) => {
        for (const s of sockets) s.ws.terminate();
        for (const c of sendspin.clients) c.terminate();
        for (const c of maWss.clients) c.terminate();
        wss.close(); sendspin.close(); maWss.close(); server.close(r);
      }),
    });
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMock({ port: Number(process.env.PORT) || 8123 });
  console.log(`Test-Home-Assistant läuft: ${m.url}/local/musik/index.html  (Token: ${TOKEN})`);
  console.log('Hinweis: „Dieses Gerät“ braucht einen echten Music Assistant und funktioniert mit diesem Test-Server nicht.');
}

// Nachgebauter Home-Assistant-Server für Tests der Musik-App.
// Liefert die App unter /local/musik/ aus und beantwortet die WebSocket-Befehle,
// die die App nutzt, im selben Format wie Home Assistant 2026.11 mit Music Assistant.
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

const img = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${c}"/></svg>`)}`;

function player(entity_id, name, state, extra = {}) {
  return {
    entity_id, state,
    attributes: {
      group_members: [], volume_level: 0.2, is_volume_muted: false, app_id: 'music_assistant',
      mass_player_type: 'player', device_class: 'speaker', friendly_name: name,
      supported_features: 8320575, shuffle: false, repeat: 'off', ...extra,
    },
    last_changed: new Date().toISOString(), last_updated: new Date().toISOString(), context: { id: 'x' },
  };
}

export function createState() {
  return {
    states: {
      'media_player.kuche_2': player('media_player.kuche_2', 'Küche', 'idle'),
      'media_player.ambeo_soundbar_plus_cast': player('media_player.ambeo_soundbar_plus_cast', 'AMBEO Soundbar Plus', 'playing', {
        media_content_id: 'apple_music://track/1474250738', media_content_type: 'music',
        media_duration: 225, media_position: 20, media_position_updated_at: new Date().toISOString(),
        media_title: "I'm on Your Side", media_artist: 'The Glorious Sons', media_album_name: 'A War on Everything',
        entity_picture_local: '/api/media_player_proxy/media_player.ambeo_soundbar_plus_cast?token=abc',
        shuffle: true, volume_level: 0.1,
      }),
      'media_player.werkstatt_apple_tv': { entity_id: 'media_player.werkstatt_apple_tv', state: 'unavailable', attributes: { friendly_name: 'Werkstatt Apple TV', supported_features: 0 } },
      'media_player.wohnzimmer_wohnzimmer': { entity_id: 'media_player.wohnzimmer_wohnzimmer', state: 'off', attributes: { friendly_name: 'Wohnzimmer (Apple TV)', supported_features: 450487 } },
      'light.kueche': { entity_id: 'light.kueche', state: 'on', attributes: {} },
    },
    calls: [],
  };
}

const LIB = {
  playlist: Array.from({ length: 60 }, (_, i) => ({
    media_type: 'playlist', uri: `library://playlist/${i + 1}`, name: `Playlist ${String(i + 1).padStart(2, '0')}`,
    version: '', image: i % 7 === 3 ? 'http://127.0.0.1:1/broken.jpg' : img(['#c33', '#3c3', '#33c', '#cc3'][i % 4]), favorite: i % 5 === 0, explicit: null,
  })),
  album: [
    { media_type: 'album', uri: 'library://album/4356', name: '1000 Jahre EAV (Lieblingslieder aus 1000 Jahre EAV)', version: '', image: img('#a5a'), favorite: false, artists: [{ media_type: 'artist', uri: 'library://artist/4107', name: 'EAV' }] },
    { media_type: 'album', uri: 'library://album/5905', name: 'Classic Queen', version: '', image: null, favorite: true, artists: [{ media_type: 'artist', uri: 'library://artist/2975', name: 'Queen' }] },
  ],
  artist: [{ media_type: 'artist', uri: 'library://artist/2975', name: 'Queen', version: '', image: img('#555'), favorite: false }],
  track: [{ media_type: 'track', uri: 'library://track/18335', name: '50ft Queenie', version: '', image: img('#933'), favorite: false, artists: [{ name: 'PJ Harvey' }], album: { name: 'Rid of Me' } }],
  radio: [{ media_type: 'radio', uri: 'tunein://radio/s44910', name: "Queen's Radio", version: '', image: img('#393'), favorite: false }],
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

export function startMock({ port = 8123, quiet = false } = {}) {
  const st = createState();
  const sockets = new Set();
  const log = (...a) => { if (!quiet) console.log(...a); };

  function emitState(id) {
    const ev = { event_type: 'state_changed', data: { entity_id: id, new_state: st.states[id] } };
    for (const s of sockets) for (const subId of s.subs) s.ws.send(JSON.stringify({ id: subId, type: 'event', event: ev }));
  }

  function handleService(msg) {
    const { domain, service, service_data: d = {}, target } = msg;
    st.calls.push({ domain, service, data: d, target });
    log('call_service', domain, service, JSON.stringify(d), JSON.stringify(target || {}));
    if (domain === 'music_assistant' && service === 'get_library') {
      let items = LIB[d.media_type] || [];
      if (d.favorite) items = items.filter((x) => x.favorite);
      if (d.search) items = items.filter((x) => x.name.toLowerCase().includes(d.search.toLowerCase()));
      const offset = d.offset || 0, limit = d.limit || 25;
      return { response: { items: items.slice(offset, offset + limit), limit, offset, order_by: d.order_by || 'name', media_type: d.media_type } };
    }
    if (domain === 'music_assistant' && service === 'search') {
      const q = d.name.toLowerCase();
      const f = (arr) => arr.filter((x) => x.name.toLowerCase().includes(q));
      const want = (t) => !d.media_type || d.media_type.includes(t);
      return {
        response: {
          artists: want('artist') ? f(LIB.artist) : [], albums: want('album') ? f(LIB.album) : [],
          tracks: want('track') ? f(LIB.track) : [], playlists: want('playlist') ? f(LIB.playlist).slice(0, d.limit || 5) : [],
          radio: want('radio') ? f(LIB.radio) : [], audiobooks: [], podcasts: [],
        },
      };
    }
    const id = target?.entity_id;
    const p = st.states[id];
    if (domain === 'music_assistant' && service === 'play_media' && p) {
      Object.assign(p.attributes, { media_title: `Gespielt: ${d.media_id}`, media_artist: 'Test', media_duration: 200, media_position: 0, media_position_updated_at: new Date().toISOString() });
      p.state = 'playing';
      emitState(id);
      return { response: null };
    }
    if (domain === 'media_player' && p) {
      const a = p.attributes;
      switch (service) {
        case 'media_pause': p.state = 'paused'; break;
        case 'media_play': p.state = 'playing'; break;
        case 'volume_set': a.volume_level = d.volume_level; break;
        case 'volume_mute': a.is_volume_muted = d.is_volume_muted; break;
        case 'shuffle_set': a.shuffle = d.shuffle; break;
        case 'repeat_set': a.repeat = d.repeat; break;
        case 'media_seek': a.media_position = d.seek_position; a.media_position_updated_at = new Date().toISOString(); break;
        case 'media_next_track': a.media_title = 'Nächster Titel'; break;
        case 'turn_off': p.state = 'off'; break;
        case 'turn_on': p.state = 'idle'; break;
        default: break;
      }
      setTimeout(() => emitState(id), 30);
    }
    return { response: null };
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
    if (url.pathname.startsWith('/local/musik/')) {
      const rel = url.pathname.slice('/local/musik/'.length) || 'index.html';
      const file = path.join(APP_DIR, rel);
      if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end('not found');
  });

  const wss = new WebSocketServer({ server, path: '/api/websocket' });
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
            entities: [
              { ei: 'media_player.kuche_2', pl: 'music_assistant' },
              { ei: 'media_player.ambeo_soundbar_plus_cast', pl: 'music_assistant' },
              { ei: 'media_player.werkstatt_apple_tv', pl: 'music_assistant' },
              { ei: 'media_player.wohnzimmer_wohnzimmer', pl: 'apple_tv' },
              { ei: 'light.kueche', pl: 'hue' },
            ],
          });
        case 'config_entries/get': return reply([{ entry_id: ENTRY_ID, domain: 'music_assistant', state: 'loaded', title: 'Music Assistant' }]);
        case 'media_player/browse_media': return reply(browse(msg.media_content_id));
        case 'call_service': {
          if (msg.domain === 'music_assistant' && ['get_library', 'search'].includes(msg.service) && msg.service_data?.config_entry_id !== ENTRY_ID) {
            return fail('service_validation_error', 'Config entry not found');
          }
          const r = handleService(msg);
          return reply({ context: { id: 'ctx' }, ...(msg.return_response ? { response: r.response } : {}) });
        }
        default: return fail('unknown_command', 'Unknown command.');
      }
    });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve({
      url: `http://localhost:${server.address().port}`,
      state: st,
      dropConnections: () => { for (const s of sockets) s.ws.terminate(); },
      close: () => new Promise((r) => { for (const s of sockets) s.ws.terminate(); wss.close(); server.close(r); }),
    });
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = await startMock({ port: Number(process.env.PORT) || 8123 });
  console.log(`Test-Home-Assistant läuft: ${m.url}/local/musik/index.html  (Token: ${TOKEN})`);
}

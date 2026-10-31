/* iPod Classic for Spotify.
 * Plain browser JavaScript, no build step. Written for Chrome 88 on Android 5.1, so it avoids
 * anything newer (no top-level await, Array.at, structuredClone, container queries...).
 *
 * Playback goes through Spotify Connect: this page is the remote, and audio comes out of
 * whichever Spotify device is active (the Spotify app on this phone, a speaker, a PC...).
 * Spotify's in-browser player (Web Playback SDK) is also tried, but Spotify doesn't support
 * it on mobile browsers, so treat it as a bonus if it shows up under Settings > Play On.
 */
(function () {
  'use strict';

  // Optional: paste your Spotify app's Client ID here to skip typing it on the phone.
  var CLIENT_ID = '';

  var SCOPES = [
    'user-library-read', 'playlist-read-private', 'playlist-read-collaborative',
    'user-follow-read', 'user-read-playback-state', 'user-modify-playback-state',
    'user-read-currently-playing', 'streaming'
  ].join(' ');
  var REDIRECT_URI = location.origin + location.pathname;
  var ROWS = 8;          // visible menu rows
  var TICK_DEG = 15;     // degrees of wheel travel per click (24 per turn)

  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var val = function (v) { return typeof v === 'function' ? v() : v; };
  var fmt = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  };
  var shuffled = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  var store = {
    get: function (k) { try { return localStorage.getItem('ipod.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('ipod.' + k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('ipod.' + k); } catch (e) {} }
  };

  function userError(msg) { var e = new Error(msg); e.user = true; return e; }

  /* ===================== Spotify auth (Authorization Code + PKCE) ===================== */

  function randomString(n) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var bytes = crypto.getRandomValues(new Uint8Array(n));
    var out = '';
    for (var i = 0; i < n; i++) out += chars[bytes[i] % chars.length];
    return out;
  }
  function base64url(buf) {
    var s = '';
    var bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function tokenRequest(params) {
    var r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params)
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      var e = new Error(j.error_description || j.error || 'Token request failed');
      e.status = r.status; e.auth = true;
      throw e;
    }
    return j;
  }

  var Auth = {
    clientId: function () { return CLIENT_ID || store.get('clientId') || ''; },
    tokens: function () { try { return JSON.parse(store.get('tokens')); } catch (e) { return null; } },
    save: function (t) {
      var old = this.tokens() || {};
      store.set('tokens', JSON.stringify({
        access: t.access_token,
        refresh: t.refresh_token || old.refresh,
        expires: Date.now() + (t.expires_in - 60) * 1000
      }));
    },
    login: async function () {
      var verifier = randomString(64);
      var state = randomString(16);
      store.set('verifier', verifier);
      store.set('state', state);
      var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      var q = new URLSearchParams({
        response_type: 'code',
        client_id: this.clientId(),
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: base64url(digest),
        state: state
      });
      location.href = 'https://accounts.spotify.com/authorize?' + q.toString();
    },
    // Returns true when this page load is Spotify redirecting back with a code.
    handleRedirect: async function () {
      var q = new URLSearchParams(location.search);
      if (!q.has('code') && !q.has('error')) return false;
      history.replaceState(null, '', REDIRECT_URI);
      if (q.get('error')) throw userError('Spotify login was cancelled (' + q.get('error') + ').');
      if (q.get('state') !== store.get('state')) throw userError('Login expired. Please try again.');
      var t = await tokenRequest({
        grant_type: 'authorization_code',
        code: q.get('code'),
        redirect_uri: REDIRECT_URI,
        client_id: this.clientId(),
        code_verifier: store.get('verifier')
      });
      this.save(t);
      store.del('verifier');
      store.del('state');
      return true;
    },
    token: async function () {
      var t = this.tokens();
      if (!t) { var e = new Error('Not logged in'); e.auth = true; throw e; }
      return Date.now() < t.expires ? t.access : this.refresh();
    },
    refresh: function () {
      var self = this;
      var t = this.tokens();
      if (!t || !t.refresh) { var e = new Error('Not logged in'); e.auth = true; return Promise.reject(e); }
      if (!this._pending) {
        this._pending = tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.clientId() })
          .then(function (r) { self.save(r); return self.tokens().access; })
          .finally(function () { self._pending = null; });
      }
      return this._pending;
    },
    logout: function () { store.del('tokens'); }
  };

  async function api(method, path, body, retried) {
    var token = await Auth.token();
    var headers = { Authorization: 'Bearer ' + token };
    if (body) headers['Content-Type'] = 'application/json';
    var r = await fetch('https://api.spotify.com/v1' + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 401 && !retried) { await Auth.refresh(); return api(method, path, body, true); }
    if (r.status === 429 && !retried) {
      await sleep((Number(r.headers.get('Retry-After')) || 1) * 1000);
      return api(method, path, body, true);
    }
    var text = await r.text();
    var j = null;
    try { j = text ? JSON.parse(text) : null; } catch (e) {}
    if (!r.ok) {
      var err = j && j.error;
      var e2 = new Error((err && (err.message || err)) || ('Spotify error ' + r.status));
      e2.status = r.status;
      e2.reason = err && err.reason;
      throw e2;
    }
    return j;
  }

  /* ===================== Spotify backend ===================== */

  function pickArt(imgs) { return imgs && imgs.length ? (imgs[1] || imgs[0]).url : ''; }
  function nTrack(t) {
    if (!t) return null;
    var al = t.album || {};
    return {
      id: t.id, uri: t.uri, name: t.name,
      artist: (t.artists || []).map(function (a) { return a.name; }).join(', ') || (t.show && t.show.name) || '',
      album: al.name || (t.show && t.show.name) || '',
      art: pickArt(t.images || al.images),
      duration: t.duration_ms || 0
    };
  }
  function nAlbum(a) {
    if (!a) return null;
    return {
      id: a.id, uri: a.uri, name: a.name, art: pickArt(a.images),
      artist: (a.artists || []).map(function (x) { return x.name; }).join(', ')
    };
  }
  // Offset-paged list -> { items, total, next }
  async function page(path, next, map) {
    var offset = next || 0;
    var d = await api('GET', path + '&offset=' + offset);
    return {
      items: d.items.map(map).filter(Boolean),
      total: d.total,
      next: d.next ? offset + d.items.length : null
    };
  }

  var sdk = { deviceId: null, player: null, loading: false };
  function loadSdk() {
    if (sdk.loading) return;
    sdk.loading = true;
    window.onSpotifyWebPlaybackSDKReady = function () {
      try {
        var p = new window.Spotify.Player({
          name: 'iPod Classic (this browser)',
          getOAuthToken: function (cb) { Auth.token().then(cb).catch(function () {}); },
          volume: 0.8
        });
        p.addListener('ready', function (e) { sdk.deviceId = e.device_id; });
        p.addListener('not_ready', function () { sdk.deviceId = null; });
        ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(function (n) {
          p.addListener(n, function (e) { console.warn('Web Playback SDK', n, e && e.message); });
        });
        p.addListener('player_state_changed', function () { Player.soon(); });
        p.connect();
        sdk.player = p;
      } catch (e) { console.warn('Web Playback SDK unavailable', e); }
    };
    var s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    document.head.appendChild(s);
  }

  var SpotifyBackend = {
    demo: false,
    init: async function () {
      this.me = await api('GET', '/me');
      loadSdk();
    },
    likedSongs: function (next) { return page('/me/tracks?limit=50', next, function (i) { return nTrack(i.track); }); },
    playlists: function (next) {
      return page('/me/playlists?limit=50', next, function (p) {
        return p && { id: p.id, uri: p.uri, name: p.name, count: (p.items || p.tracks || {}).total };
      });
    },
    // Spotify only lists items for playlists you own or collaborate on (Feb 2026 rules);
    // others fail here and the UI falls back to "Play" / "Shuffle Play" for the whole playlist.
    playlistTracks: function (pl, next) {
      return page('/playlists/' + pl.id + '/items?limit=50', next, function (i) { return nTrack(i.item || i.track); });
    },
    albums: function (next) { return page('/me/albums?limit=50', next, function (i) { return nAlbum(i.album); }); },
    albumTracks: function (al, next) {
      return page('/albums/' + al.id + '/tracks?limit=50', next, function (t) {
        var n = nTrack(t); n.album = al.name; n.art = al.art; return n;
      });
    },
    artists: async function (next) {
      var d = await api('GET', '/me/following?type=artist&limit=50' + (next ? '&after=' + next : ''));
      var a = d.artists;
      return {
        items: a.items.map(function (x) { return { id: x.id, uri: x.uri, name: x.name }; }),
        total: a.total,
        next: a.next ? a.cursors.after : null
      };
    },
    artistAlbums: function (ar, next) {
      return page('/artists/' + ar.id + '/albums?include_groups=album,single,compilation&limit=50', next, nAlbum);
    },

    state: async function () {
      var s = await api('GET', '/me/player?additional_types=episode');
      if (!s) return null;
      return {
        playing: s.is_playing,
        progress: s.progress_ms || 0,
        duration: s.item ? s.item.duration_ms : 0,
        track: nTrack(s.item),
        device: s.device && {
          id: s.device.id, name: s.device.name,
          volume: s.device.volume_percent, supportsVolume: s.device.supports_volume !== false
        },
        shuffle: s.shuffle_state,
        repeat: s.repeat_state
      };
    },
    devices: async function () {
      var d = await api('GET', '/me/player/devices');
      return d.devices.map(function (x) {
        return { id: x.id, name: x.name, type: x.type, active: x.is_active, sdk: x.id === sdk.deviceId };
      });
    },
    // Active device first, then the one picked in Play On, then a real Spotify app, then this browser.
    pickDevice: async function () {
      var list = await this.devices();
      var active = list.find(function (d) { return d.active; });
      if (active) return active.id;
      var pref = store.get('device');
      if (pref && list.some(function (d) { return d.id === pref; })) return pref;
      var app = list.find(function (d) { return !d.sdk; });
      if (app) return app.id;
      return list.length ? list[0].id : null;
    },
    play: async function (body) {
      var dev = await this.pickDevice();
      if (!dev) throw userError('No Spotify device found. Open the Spotify app (Settings › Play On), then try again.');
      await api('PUT', '/me/player/play?device_id=' + dev, body);
    },
    resume: function () { return this.play(); },
    pause: function () { return api('PUT', '/me/player/pause'); },
    next: function () { return api('POST', '/me/player/next'); },
    prev: function () { return api('POST', '/me/player/previous'); },
    seek: function (ms) { return api('PUT', '/me/player/seek?position_ms=' + Math.round(ms)); },
    volume: function (v) { return api('PUT', '/me/player/volume?volume_percent=' + Math.round(v)); },
    shuffle: function (on) { return api('PUT', '/me/player/shuffle?state=' + on); },
    repeat: function (mode) { return api('PUT', '/me/player/repeat?state=' + mode); },
    transfer: function (id) { return api('PUT', '/me/player', { device_ids: [id], play: true }); }
  };

  /* ===================== Demo backend (no Spotify account needed) ===================== */

  function makeDemo() {
    var seed = 7;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var words = ['Neon', 'Summer', 'Echo', 'Gravity', 'Velvet', 'Static', 'Golden', 'Hollow', 'Paper',
      'River', 'Satellite', 'Ember', 'Northern', 'Lights', 'Glass', 'Fever', 'Dream', 'Motion', 'Signal',
      'Coast', 'Midnight', 'Wild', 'Silver', 'Bloom', 'Highway', 'Orchard', 'Arcade', 'Harbor', 'Tides'];
    var names = ['Glass Harbor', 'Juniper Coast', 'Midnight Arcade', 'Nora Vale', 'Ola Brandt',
      'Paper Satellites', 'The Low Tides', 'The Velvet Static', 'Wren & Ember'];
    var art = function (hue, text) {
      var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
        "<stop offset='0' stop-color='hsl(" + hue + ",70%,62%)'/><stop offset='1' stop-color='hsl(" + (hue + 50) + ",65%,28%)'/></linearGradient></defs>" +
        "<rect width='100' height='100' fill='url(#g)'/><text x='50' y='60' font-size='26' text-anchor='middle' fill='white' font-family='Helvetica,Arial' font-weight='bold'>" + text + '</text></svg>';
      return 'data:image/svg+xml,' + encodeURIComponent(svg);
    };
    var byUri = {};
    var artists = [], albums = [], tracks = [];
    names.forEach(function (n, i) {
      var ar = { id: 'ar' + i, uri: 'demo:artist:' + i, name: n, albums: [] };
      artists.push(ar);
      for (var k = 0; k < 2; k++) {
        var title = pick(words) + ' ' + pick(words);
        var al = {
          id: 'al' + i + k, uri: 'demo:album:' + i + k, name: title, artist: n,
          art: art(Math.floor(rnd() * 360), title.split(' ').map(function (w) { return w[0]; }).join('')),
          tracks: []
        };
        var count = 7 + Math.floor(rnd() * 5);
        for (var t = 0; t < count; t++) {
          var tr = {
            id: al.id + 't' + t, uri: 'demo:track:' + al.id + t,
            name: pick(words) + (rnd() > 0.5 ? ' ' + pick(words) : ''),
            artist: n, album: title, art: al.art, duration: 140000 + Math.floor(rnd() * 140000)
          };
          al.tracks.push(tr); tracks.push(tr); byUri[tr.uri] = tr;
        }
        ar.albums.push(al); albums.push(al); byUri[al.uri] = al;
      }
    });
    var liked = tracks.filter(function () { return rnd() > 0.55; });
    var playlists = ['Road Trip', 'Late Night', 'Workout', 'Sunday Morning', 'Favorites 2026'].map(function (n, i) {
      var pl = { id: 'pl' + i, uri: 'demo:playlist:' + i, name: n, tracks: tracks.filter(function () { return rnd() > 0.8; }) };
      pl.count = pl.tracks.length;
      byUri[pl.uri] = pl;
      return pl;
    });
    var slice = function (arr, next) {
      var o = next || 0;
      return Promise.resolve({ items: arr.slice(o, o + 50), total: arr.length, next: o + 50 < arr.length ? o + 50 : null });
    };

    var p = { q: [], i: 0, playing: false, pos: 0, at: 0, vol: 60, shuffle: false, repeat: 'off', device: 'demo-phone' };
    var cur = function () { return p.pos + (p.playing ? Date.now() - p.at : 0); };
    var settle = function () {
      while (p.playing && p.q[p.i] && cur() >= p.q[p.i].duration) {
        var over = cur() - p.q[p.i].duration;
        if (p.repeat !== 'track') p.i++;
        if (p.i >= p.q.length) {
          if (p.repeat === 'context') p.i = 0;
          else { p.i = p.q.length - 1; p.playing = false; p.pos = 0; return; }
        }
        p.pos = over; p.at = Date.now();
      }
    };
    var setPos = function (ms) { p.pos = ms; p.at = Date.now(); };

    return {
      demo: true,
      init: function () { return Promise.resolve(); },
      likedSongs: function (n) { return slice(liked, n); },
      playlists: function (n) { return slice(playlists, n); },
      playlistTracks: function (pl, n) { return slice(byUri[pl.uri].tracks, n); },
      albums: function (n) { return slice(albums, n); },
      albumTracks: function (al, n) { return slice(byUri[al.uri].tracks, n); },
      artists: function (n) { return slice(artists, n); },
      artistAlbums: function (ar, n) { return slice(artists.find(function (a) { return a.id === ar.id; }).albums, n); },
      state: function () {
        settle();
        var t = p.q[p.i];
        if (!t) return Promise.resolve(null);
        return Promise.resolve({
          playing: p.playing, progress: cur(), duration: t.duration, track: t,
          device: { id: p.device, name: p.device === 'demo-phone' ? 'This Phone' : 'Living Room', volume: p.vol, supportsVolume: true },
          shuffle: p.shuffle, repeat: p.repeat
        });
      },
      devices: function () {
        return Promise.resolve([
          { id: 'demo-phone', name: 'This Phone', type: 'Smartphone', active: p.device === 'demo-phone' },
          { id: 'demo-speaker', name: 'Living Room', type: 'Speaker', active: p.device === 'demo-speaker' }
        ]);
      },
      play: function (body) {
        if (body && (body.uris || body.context_uri)) {
          var list = body.uris ? body.uris.map(function (u) { return byUri[u]; }) : byUri[body.context_uri].tracks;
          var start = body.offset && body.offset.uri ? list.findIndex(function (t) { return t.uri === body.offset.uri; }) : 0;
          if (p.shuffle) {
            var first = start >= 0 ? list[start] : null;
            list = shuffled(list.filter(function (t) { return t !== first; }));
            if (first) list.unshift(first);
            start = 0;
          }
          p.q = list; p.i = Math.max(0, start); setPos(0);
        } else if (!p.q.length) {
          return Promise.reject(userError('Choose some music first.'));
        } else setPos(cur());
        p.playing = true;
        return Promise.resolve();
      },
      resume: function () { return this.play(); },
      pause: function () { setPos(cur()); p.playing = false; return Promise.resolve(); },
      next: function () { if (p.i < p.q.length - 1) { p.i++; setPos(0); } return Promise.resolve(); },
      prev: function () { if (cur() < 3000 && p.i > 0) p.i--; setPos(0); return Promise.resolve(); },
      seek: function (ms) { setPos(ms); return Promise.resolve(); },
      volume: function (v) { p.vol = v; return Promise.resolve(); },
      shuffle: function (on) { p.shuffle = on; return Promise.resolve(); },
      repeat: function (m) { p.repeat = m; return Promise.resolve(); },
      transfer: function (id) { p.device = id; return Promise.resolve(); }
    };
  }

  var backend = null;

  /* ===================== Player state ===================== */

  var Player = {
    state: null,
    at: 0,
    list: null, // { uris, total } of the list playback started from, for "3 of 12"
    refresh: async function () {
      if (!backend) return;
      try {
        this.state = await backend.state();
        this.at = Date.now();
      } catch (e) {
        if (e.auth) return sessionExpired();
      }
      onStateChange();
    },
    soon: function () {
      var self = this;
      setTimeout(function () { self.refresh(); }, 400);
      setTimeout(function () { self.refresh(); }, 1500);
    },
    progress: function () {
      var s = this.state;
      if (!s) return 0;
      return Math.min(s.duration, s.progress + (s.playing ? Date.now() - this.at : 0));
    },
    // Optimistic local update so the UI reacts before Spotify reports back.
    patch: function (fields) {
      if (!this.state) return;
      this.state.progress = this.progress();
      this.at = Date.now();
      Object.assign(this.state, fields);
      onStateChange();
    }
  };

  function friendly(e) {
    if (e.user) return e.message;
    if (e.auth) return 'Your Spotify session expired. Please log in again.';
    if (e.status === 403) {
      if (/premium/i.test(e.message) || e.reason === 'PREMIUM_REQUIRED') return 'Spotify Premium is required to control playback.';
      if (/registered|developer/i.test(e.message)) return 'This Spotify account isn’t on the app’s user list in the Spotify Developer Dashboard.';
      return 'Spotify refused that action: ' + e.message;
    }
    if (e.status === 404) return 'No active Spotify device. Open Spotify, or pick one in Settings › Play On.';
    if (e instanceof TypeError) return 'Network error. Check your connection.';
    return e.message || 'Something went wrong.';
  }

  // Runs a playback command; shows a toast on failure. Resolves true on success.
  function cmd(fn) {
    return Promise.resolve().then(fn).then(function () { Player.soon(); return true; }, function (e) {
      if (e.auth) { sessionExpired(); return false; }
      toast(friendly(e));
      Player.soon();
      return false;
    });
  }

  /* ===================== Screens ===================== */

  var ui = { stack: [], view: null };
  var top = function () { return ui.stack[ui.stack.length - 1]; };

  function MenuScreen(title, opts) {
    this.title = title;
    this.rows = opts.items || [];
    this.models = [];
    this.loader = opts.loader;
    this.map = opts.map;
    this.onError = opts.onError;
    this.afterLoad = opts.afterLoad;
    this.empty = opts.empty || 'No items';
    this.next = null;
    this.total = 0;
    this.done = !opts.loader;
    this.loading = false;
    this.error = null;
    this.sel = 0;
    this.top = 0;
  }
  MenuScreen.prototype.onShow = function () { if (!this.done && !this.models.length) this.load(); };
  MenuScreen.prototype.reload = function () {
    this.rows = []; this.models = []; this.next = null; this.done = false; this.error = null; this.sel = 0; this.top = 0;
    this.load();
  };
  MenuScreen.prototype.load = function () {
    var self = this;
    if (this.loading || this.done) return;
    this.loading = true;
    this.render();
    this.loader(this.next).then(function (res) {
      var start = self.models.length;
      self.models = self.models.concat(res.items);
      self.rows = self.rows.concat(res.items.map(function (m, k) { return self.map(m, start + k); }));
      self.next = res.next;
      self.total = res.total || self.models.length;
      self.done = res.next == null;
      if (self.done && self.afterLoad) self.afterLoad(self);
    }).catch(function (e) {
      if (e.auth) return sessionExpired();
      self.done = true;
      if (self.onError) self.rows = self.onError(e);
      else self.error = friendly(e);
    }).finally(function () {
      self.loading = false;
      self.render();
    });
  };
  MenuScreen.prototype.move = function (d) {
    if (!this.rows.length) return false;
    var s = clamp(this.sel + d, 0, this.rows.length - 1);
    if (s === this.sel) return false;
    this.sel = s;
    if (s < this.top) this.top = s;
    if (s >= this.top + ROWS) this.top = s - ROWS + 1;
    if (!this.done && s > this.rows.length - 12) this.load();
    this.render();
    return true;
  };
  MenuScreen.prototype.onTick = function (d) { return this.move(d); };
  MenuScreen.prototype.onSelect = function () {
    var r = this.rows[this.sel];
    if (r && r.action) r.action(this, this.sel);
  };
  MenuScreen.prototype.render = function () {
    var el = this.el;
    if (!el || el !== ui.view) return;
    if (!this.rows.length) {
      el.classList.remove('has-scroll');
      el.innerHTML = this.loading
        ? '<div class="loading"><div class="spinner"></div>Loading…</div>'
        : '<div class="empty">' + esc(this.error || this.empty) + '</div>';
      return;
    }
    var html = '<ul class="menu">';
    var end = Math.min(this.rows.length, this.top + ROWS);
    for (var i = this.top; i < end; i++) {
      var r = this.rows[i];
      var cls = (i === this.sel ? 'sel ' : '') + (r.arrow ? 'arrow ' : '') + (r.dim ? 'dim' : '');
      html += '<li data-i="' + i + '" class="' + cls + '"><span class="lbl">' + esc(val(r.label)) + '</span>' +
        (r.sub != null ? '<span class="sub">' + esc(val(r.sub)) + '</span>' : '') + '</li>';
    }
    html += '</ul>';
    var total = Math.max(this.rows.length, this.total);
    if (total > ROWS) {
      html += '<div class="scrollbar"><i style="top:' + (this.top / total * 100) + '%;height:' +
        Math.max(ROWS / total * 100, 6) + '%"></i></div>';
    }
    el.classList.toggle('has-scroll', total > ROWS);
    el.innerHTML = html;
  };

  /* ---------- Now Playing ---------- */

  var nowPlaying = {
    title: 'Now Playing',
    mode: 'progress', // progress | volume | scrub
    uri: null,
    onShow: function () { this.mode = 'progress'; Player.refresh(); },
    render: function () {
      var el = this.el;
      if (!el || el !== ui.view) return;
      var s = Player.state;
      this.uri = s && s.track ? s.track.uri : null;
      if (!this.uri) {
        el.innerHTML = '<div class="empty">Nothing playing.<br>Choose music, or pick a device in Settings › Play On.</div>';
        return;
      }
      var t = s.track;
      el.innerHTML =
        '<div class="np"><div class="np-top"><div class="np-art"></div><div class="np-meta">' +
        '<div class="idx"></div><div class="t">' + esc(t.name) + '</div><div>' + esc(t.artist) + '</div>' +
        '<div>' + esc(t.album) + '</div></div></div><div class="np-bottom"></div></div>';
      if (t.art) el.querySelector('.np-art').style.backgroundImage = 'url("' + t.art + '")';
      var list = Player.list;
      var idx = list ? list.uris.indexOf(t.uri) : -1;
      el.querySelector('.idx').textContent = idx >= 0 ? (idx + 1) + ' of ' + list.total : '';
      this.update();
    },
    update: function () {
      var el = this.el;
      if (!el || el !== ui.view) return;
      var s = Player.state;
      if ((s && s.track ? s.track.uri : null) !== this.uri) return this.render();
      var bottom = el.querySelector('.np-bottom');
      if (!bottom) return;
      var dur = s.duration || 1;
      if (this.mode === 'volume') {
        bottom.innerHTML = '<div class="vol-row"><span class="vol-icon">🔈︎</span><div class="bar"><i style="width:' +
          this.vol + '%"></i></div><span class="vol-icon">🔊︎</span></div><div class="np-mode">' +
          esc(s.device ? s.device.name : '') + '</div>';
      } else {
        var pos = this.mode === 'scrub' ? this.scrubPos : Player.progress();
        var pct = clamp(pos / dur * 100, 0, 100);
        bottom.innerHTML = '<div class="bar' + (this.mode === 'scrub' ? ' scrub' : '') + '"><i style="width:' + pct +
          '%"></i>' + (this.mode === 'scrub' ? '<b style="left:' + pct + '%"></b>' : '') + '</div>' +
          '<div class="times"><span>' + fmt(pos) + '</span><span>-' + fmt(dur - pos) + '</span></div>' +
          '<div class="np-mode">' + (this.mode === 'scrub' ? 'Scrubbing' : (s.shuffle ? 'Shuffle' : '') +
          (s.repeat && s.repeat !== 'off' ? (s.shuffle ? ' · ' : '') + (s.repeat === 'track' ? 'Repeat One' : 'Repeat') : '')) + '</div>';
      }
    },
    revertLater: function (ms) {
      var self = this;
      clearTimeout(this.modeTimer);
      this.modeTimer = setTimeout(function () { self.mode = 'progress'; self.update(); }, ms);
    },
    onTick: function (d) {
      var s = Player.state;
      if (!s || !s.track) return false;
      var self = this;
      if (this.mode === 'scrub') {
        this.scrubPos = clamp(this.scrubPos + d * 5000, 0, s.duration);
        clearTimeout(this.seekTimer);
        this.seekTimer = setTimeout(function () {
          var to = self.scrubPos;
          Player.patch({ progress: to });
          cmd(function () { return backend.seek(to); });
        }, 600);
        this.revertLater(4000);
      } else {
        if (s.device && !s.device.supportsVolume) { toast('This device doesn’t allow volume control.'); return false; }
        if (this.mode !== 'volume') this.vol = s.device ? s.device.volume : 50;
        this.mode = 'volume';
        this.vol = clamp(this.vol + d * 3, 0, 100);
        clearTimeout(this.volTimer);
        this.volTimer = setTimeout(function () {
          if (Player.state && Player.state.device) Player.state.device.volume = self.vol;
          cmd(function () { return backend.volume(self.vol); });
        }, 250);
        this.revertLater(2000);
      }
      this.update();
      return true;
    },
    onSelect: function () {
      if (!Player.state || !Player.state.track) return;
      if (this.mode === 'scrub') { this.mode = 'progress'; clearTimeout(this.modeTimer); }
      else { this.mode = 'scrub'; this.scrubPos = Player.progress(); this.revertLater(4000); }
      this.update();
    }
  };

  /* ---------- Navigation ---------- */

  function show(screen, dir) {
    var old = ui.view;
    var v = document.createElement('div');
    v.className = 'view' + (dir > 0 ? ' enter-right' : dir < 0 ? ' exit-left' : '');
    $('views').appendChild(v);
    ui.view = v;
    screen.el = v;
    screen.render();
    if (dir) {
      void v.offsetWidth; // start the slide from the off-screen position
      v.classList.remove('enter-right', 'exit-left');
    }
    if (old) {
      if (dir) {
        old.classList.add(dir > 0 ? 'exit-left' : 'enter-right');
        setTimeout(function () { old.remove(); }, 260);
      } else old.remove();
    }
    $('sb-title').textContent = screen.title;
    if (screen.onShow) screen.onShow();
  }
  function push(screen) { ui.stack.push(screen); show(screen, 1); }
  function pop() {
    if (ui.stack.length < 2) return false;
    ui.stack.pop();
    show(top(), -1);
    return true;
  }

  /* ---------- Menus ---------- */

  function playBody(body, list) {
    if (list) Player.list = list;
    return cmd(function () { return backend.play(body); }).then(function (ok) {
      if (ok && top() !== nowPlaying) push(nowPlaying);
    });
  }
  function playFrom(scr, i, contextUri) {
    var t = scr.models[i];
    var list = { uris: scr.models.map(function (m) { return m.uri; }), total: scr.total || scr.models.length };
    var body = contextUri
      ? { context_uri: contextUri, offset: { uri: t.uri } }
      : { uris: list.uris.slice(i, i + 100) };
    if (!contextUri) list = { uris: body.uris, total: body.uris.length };
    playBody(body, list);
  }
  function trackRow(contextUri) {
    return function (t) {
      return { label: t.name, action: function (scr, i) { playFrom(scr, i, contextUri); } };
    };
  }

  function mainMenu() {
    return new MenuScreen('iPod', {
      items: [
        { label: 'Music', arrow: true, action: function () { push(musicMenu()); } },
        { label: 'Playlists', arrow: true, action: function () { push(playlistsScreen()); } },
        { label: 'Shuffle Songs', action: shuffleSongs },
        { label: 'Settings', arrow: true, action: function () { push(settingsMenu()); } },
        { label: 'Now Playing', arrow: true, action: function () { push(nowPlaying); } }
      ]
    });
  }

  function musicMenu() {
    return new MenuScreen('Music', {
      items: [
        { label: 'Playlists', arrow: true, action: function () { push(playlistsScreen()); } },
        { label: 'Artists', arrow: true, action: function () { push(artistsScreen()); } },
        { label: 'Albums', arrow: true, action: function () { push(albumsScreen(backend.albums.bind(backend), 'Albums')); } },
        { label: 'Songs', arrow: true, action: function () { push(songsScreen()); } }
      ]
    });
  }

  function songsScreen() {
    return new MenuScreen('Songs', {
      loader: backend.likedSongs.bind(backend),
      map: trackRow(null),
      empty: 'No liked songs yet.'
    });
  }

  function playlistsScreen() {
    return new MenuScreen('Playlists', {
      loader: backend.playlists.bind(backend),
      map: function (pl) { return { label: pl.name, arrow: true, action: function () { push(playlistScreen(pl)); } }; },
      empty: 'No playlists.'
    });
  }

  function playlistScreen(pl) {
    var playWhole = function (shuffle) {
      return function () {
        Player.list = null;
        cmd(function () { return backend.shuffle(shuffle); }).then(function () {
          playBody({ context_uri: pl.uri });
        });
      };
    };
    return new MenuScreen(pl.name, {
      loader: function (next) { return backend.playlistTracks(pl, next); },
      map: trackRow(pl.uri),
      empty: 'This playlist is empty.',
      onError: function () {
        return [
          { label: 'Play', action: playWhole(false) },
          { label: 'Shuffle Play', action: playWhole(true) },
          { label: pl.count != null ? pl.count + ' songs' : 'Songs', dim: true },
          { label: 'Track list not shared by Spotify', dim: true }
        ];
      }
    });
  }

  function artistsScreen() {
    return new MenuScreen('Artists', {
      loader: backend.artists.bind(backend),
      map: function (ar) {
        return { label: ar.name, arrow: true, action: function () {
          push(albumsScreen(function (next) { return backend.artistAlbums(ar, next); }, ar.name));
        } };
      },
      empty: 'No followed artists.'
    });
  }

  function albumsScreen(loader, title) {
    return new MenuScreen(title, {
      loader: loader,
      map: function (al) {
        return { label: al.name, arrow: true, action: function () {
          push(new MenuScreen(al.name, {
            loader: function (next) { return backend.albumTracks(al, next); },
            map: trackRow(al.uri)
          }));
        } };
      },
      empty: 'No saved albums.'
    });
  }

  async function shuffleSongs() {
    toast('Shuffling your liked songs…');
    try {
      var all = [];
      var next = null;
      do {
        var res = await backend.likedSongs(next);
        all = all.concat(res.items);
        next = res.next;
      } while (next != null && all.length < 250);
      if (!all.length) return toast('No liked songs to shuffle.');
      var uris = shuffled(all).slice(0, 100).map(function (t) { return t.uri; });
      playBody({ uris: uris }, { uris: uris, total: uris.length });
    } catch (e) {
      if (e.auth) return sessionExpired();
      toast(friendly(e));
    }
  }

  function devicesScreen() {
    return new MenuScreen('Play On', {
      loader: function () {
        return backend.devices().then(function (d) { return { items: d, total: d.length, next: null }; });
      },
      map: function (d) {
        return {
          label: d.name, sub: d.active ? '✓' : d.type,
          action: function (scr) {
            store.set('device', d.id);
            cmd(function () { return backend.transfer(d.id); }).then(function (ok) {
              if (ok) { toast('Playing on ' + d.name); setTimeout(function () { scr.reload(); }, 800); }
            });
          }
        };
      },
      afterLoad: function (scr) {
        if (backend.demo) return;
        scr.rows.push({ label: 'Open Spotify App', action: openSpotifyApp });
        scr.rows.push({ label: 'Refresh', action: function (s) { s.reload(); } });
      },
      empty: 'No devices found.'
    });
  }

  function openSpotifyApp() {
    // Android intent: opens the Spotify app if it is installed. Come back here once it's open.
    location.href = 'intent://open#Intent;scheme=spotify;package=com.spotify.music;end';
  }

  function settingsMenu() {
    var s = function () { return Player.state || {}; };
    var repeatNames = { off: 'Off', context: 'All', track: 'One' };
    return new MenuScreen('Settings', {
      items: [
        { label: 'Play On', arrow: true, action: function () { push(devicesScreen()); } },
        { label: 'Shuffle', sub: function () { return s().shuffle ? 'Songs' : 'Off'; }, action: function (scr) {
          var on = !s().shuffle;
          cmd(function () { return backend.shuffle(on); }).then(function (ok) { if (ok) { Player.patch({ shuffle: on }); scr.render(); } });
        } },
        { label: 'Repeat', sub: function () { return repeatNames[s().repeat || 'off']; }, action: function (scr) {
          var nextMode = { off: 'context', context: 'track', track: 'off' }[s().repeat || 'off'];
          cmd(function () { return backend.repeat(nextMode); }).then(function (ok) { if (ok) { Player.patch({ repeat: nextMode }); scr.render(); } });
        } },
        { label: 'Theme', sub: function () { return document.body.classList.contains('theme-black') ? 'Black' : 'Silver'; }, action: function (scr) {
          setTheme(document.body.classList.contains('theme-black') ? 'silver' : 'black'); scr.render();
        } },
        { label: 'Clicker', sub: function () { return clicker.on ? 'On' : 'Off'; }, action: function (scr) {
          clicker.on = !clicker.on; store.set('clicker', clicker.on ? '1' : '0'); scr.render();
        } },
        { label: function () { return backend.demo ? 'Exit Demo' : 'Log Out'; }, action: function () {
          store.del('demo');
          Auth.logout();
          backend = null;
          Player.state = null;
          showSetup();
        } }
      ]
    });
  }

  /* ===================== Chrome: status bar, toast, sounds ===================== */

  function onStateChange() {
    var s = Player.state;
    $('sb-play').textContent = s && s.track ? (s.playing ? '▶' : '❚❚') : '';
    if (top() === nowPlaying) nowPlaying.update();
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  var clicker = { on: store.get('clicker') !== '0', ctx: null, buf: null };
  function click() {
    if (!clicker.on || !clicker.ctx) return;
    try {
      if (!clicker.buf) {
        var n = Math.floor(clicker.ctx.sampleRate * 0.004);
        clicker.buf = clicker.ctx.createBuffer(1, n, clicker.ctx.sampleRate);
        var d = clicker.buf.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3) * 0.5;
      }
      var src = clicker.ctx.createBufferSource();
      src.buffer = clicker.buf;
      src.connect(clicker.ctx.destination);
      src.start();
    } catch (e) {}
  }

  function setTheme(name) {
    document.body.classList.toggle('theme-black', name === 'black');
    document.body.classList.toggle('theme-silver', name !== 'black');
    store.set('theme', name);
  }

  function initBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      var paint = function () {
        $('sb-battery').firstElementChild.style.width = Math.round(b.level * 100) + '%';
        $('sb-battery').classList.toggle('low', b.level < 0.2 && !b.charging);
      };
      paint();
      b.addEventListener('levelchange', paint);
      b.addEventListener('chargingchange', paint);
    }).catch(function () {});
  }

  /* ===================== Input: click wheel, taps, keyboard ===================== */

  var gestured = false;
  var wakeLock = null;
  function requestWakeLock() {
    if (!navigator.wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
  }
  function firstGesture(e) {
    if (gestured) return;
    gestured = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) clicker.ctx = new AC();
    } catch (err) {}
    if (e && e.pointerType === 'touch' && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () {});
    }
    requestWakeLock();
    if (sdk.player && sdk.player.activateElement) sdk.player.activateElement();
  }

  function tick(d) {
    var s = top();
    if (s && s.onTick && s.onTick(d)) click();
  }
  function center() {
    click();
    var s = top();
    if (s && s.onSelect) s.onSelect();
  }
  function menuButton() { click(); pop(); }
  function playPause() {
    click();
    if (!backend) return;
    var s = Player.state;
    if (s && s.playing) {
      Player.patch({ playing: false });
      cmd(function () { return backend.pause(); });
    } else {
      if (s) Player.patch({ playing: true });
      cmd(function () { return backend.resume(); });
    }
  }
  function skip(dir) {
    click();
    if (!backend) return;
    cmd(function () { return dir > 0 ? backend.next() : backend.prev(); });
  }

  function initInput() {
    var wheel = $('wheel');
    var hub = $('center');
    var tr = null;
    var angleOf = function (e) {
      var r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
    };

    wheel.addEventListener('pointerdown', function (e) {
      firstGesture(e);
      var a = angleOf(e);
      tr = { id: e.pointerId, start: a, last: a, acc: 0, travel: 0 };
      wheel.setPointerCapture(e.pointerId);
      wheel.classList.add('down');
    });
    wheel.addEventListener('pointermove', function (e) {
      if (!tr || e.pointerId !== tr.id) return;
      var a = angleOf(e);
      var d = a - tr.last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      tr.last = a;
      tr.acc += d;
      tr.travel += Math.abs(d);
      while (tr.acc >= TICK_DEG) { tr.acc -= TICK_DEG; tick(1); }
      while (tr.acc <= -TICK_DEG) { tr.acc += TICK_DEG; tick(-1); }
    });
    var end = function (e) {
      if (!tr || e.pointerId !== tr.id) return;
      wheel.classList.remove('down');
      // A press without turning is a button press; which one depends on where it landed.
      if (e.type === 'pointerup' && tr.travel < 12) {
        var a = tr.start; // 0 = right, 90 = bottom (screen y grows downward)
        if (a > -135 && a <= -45) menuButton();
        else if (a > -45 && a <= 45) skip(1);
        else if (a > 45 && a <= 135) playPause();
        else skip(-1);
      }
      tr = null;
    };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', end);

    hub.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      firstGesture(e);
      hub.classList.add('down');
      hub.setPointerCapture(e.pointerId);
    });
    hub.addEventListener('pointerup', function (e) {
      e.stopPropagation();
      if (!hub.classList.contains('down')) return;
      hub.classList.remove('down');
      center();
    });
    hub.addEventListener('pointercancel', function () { hub.classList.remove('down'); });

    // Tapping a row on the screen works too.
    $('views').addEventListener('click', function (e) {
      firstGesture(e);
      var li = e.target.closest('li[data-i]');
      var s = top();
      if (!li || !(s instanceof MenuScreen)) return;
      s.sel = Number(li.getAttribute('data-i'));
      s.render();
      center();
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || !backend) return;
      var k = e.key;
      if (k === 'ArrowDown') tick(1);
      else if (k === 'ArrowUp') tick(-1);
      else if (k === 'Enter') center();
      else if (k === 'Escape' || k === 'Backspace') menuButton();
      else if (k === ' ') playPause();
      else if (k === 'ArrowRight') skip(1);
      else if (k === 'ArrowLeft') skip(-1);
      else return;
      e.preventDefault();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { Player.refresh(); if (gestured) requestWakeLock(); }
    });
  }

  /* ===================== Setup & boot ===================== */

  function showSetup(msg) {
    $('setup').hidden = false;
    $('client-id').value = Auth.clientId();
    if (CLIENT_ID) $('client-id').parentNode.querySelector('label[for=client-id]').hidden = $('client-id').hidden = true;
    ui.stack = [];
    $('views').innerHTML = '';
    ui.view = null;
    $('sb-title').textContent = 'iPod';
    $('sb-play').textContent = '';
    if (msg) toast(msg);
  }

  function sessionExpired() {
    if (!backend || backend.demo) return;
    Auth.logout();
    backend = null;
    showSetup('Your Spotify session expired. Please log in again.');
  }

  async function start(b) {
    backend = b;
    $('setup').hidden = true;
    ui.stack = [];
    push(mainMenu());
    try {
      await b.init();
    } catch (e) {
      if (e.auth || e.status === 401) return sessionExpired();
      toast(friendly(e));
    }
    Player.refresh();
  }

  function initSetup() {
    $('redirect-uri').textContent = REDIRECT_URI;
    $('btn-login').addEventListener('click', function () {
      var id = (CLIENT_ID || $('client-id').value).trim();
      if (!/^[0-9a-f]{32}$/i.test(id)) return toast('Enter the 32-character Client ID from your Spotify app.');
      if (!window.crypto || !crypto.subtle) return toast('This page must be opened over https:// to log in.');
      store.set('clientId', id);
      store.del('demo');
      Auth.login().catch(function (e) { toast(friendly(e)); });
    });
    $('btn-demo').addEventListener('click', function () {
      store.set('demo', '1');
      start(makeDemo());
    });
  }

  async function boot() {
    setTheme(store.get('theme') || 'silver');
    initSetup();
    initInput();
    initBattery();
    setInterval(function () { if (top() === nowPlaying) nowPlaying.update(); }, 500);
    setInterval(function () { if (backend && !document.hidden) Player.refresh(); }, 3000);

    try {
      await Auth.handleRedirect();
    } catch (e) {
      return showSetup(friendly(e));
    }
    if (store.get('demo') === '1') return start(makeDemo());
    if (Auth.tokens()) return start(SpotifyBackend);
    showSetup();
  }

  boot();
})();

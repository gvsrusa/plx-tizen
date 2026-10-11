'use strict';
// PlxTizen — Plex client for Samsung Tizen TVs. ES2017 only: 2018 sets ship Chromium 56.
var PRODUCT = 'PlxTizen', VERSION = '0.1.0';
var S = { cid: null, token: null, server: null, stack: [], seq: 0 };
var P = {}; // current playback
var KINDS = ['movie', 'show', 'season', 'episode'];
var KEY = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  10009: 'back', 27: 'back', 8: 'back',
  10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw'
};
// ponytail: conservative whitelist for HTML5 <video>; everything else goes through Plex HLS
var DIRECT = { container: ['mp4', 'm4v', 'mov'], video: ['h264', 'hevc'], audio: ['aac', 'ac3', 'eac3', 'mp3'] };

// ---------- pure helpers (covered by test.js) ----------
function qs(o) {
  return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
}

// Index of the rect closest to `from` in direction `dir`, or -1. Off-axis distance weighs 3x
// so left/right stays in its row and up/down lands on the nearest column.
function nearest(from, cands, dir) {
  var fx = from.left + from.width / 2, fy = from.top + from.height / 2, best = -1, bestD = Infinity;
  var horiz = dir === 'left' || dir === 'right';
  cands.forEach(function (r, i) {
    var dx = r.left + r.width / 2 - fx, dy = r.top + r.height / 2 - fy;
    var ok = dir === 'left' ? dx < -1 : dir === 'right' ? dx > 1 : dir === 'up' ? dy < -1 : dy > 1;
    if (!ok) return;
    var d = horiz ? Math.abs(dx) + 3 * Math.abs(dy) : Math.abs(dy) + 3 * Math.abs(dx);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function canDirect(media) {
  return !!media && DIRECT.container.indexOf(media.container) >= 0 &&
    DIRECT.video.indexOf(media.videoCodec) >= 0 && DIRECT.audio.indexOf(media.audioCodec) >= 0;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return (h ? h + ':' + pad(m) : m) + ':' + pad(sec % 60);
}

// ---------- DOM ----------
function $(s) { return document.querySelector(s); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(label, fn) { var b = el('button', 'btn focusable', label); b.onclick = fn; return b; }
function show(id) { ['login', 'app', 'player', 'msg'].forEach(function (s) { $('#' + s).hidden = s !== id; }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function timeout(p, ms) { return Promise.race([p, sleep(ms).then(function () { throw new Error('timeout'); })]); }
function focus(e) {
  if (!e) return;
  e.focus();
  e.scrollIntoView({ block: 'center', inline: 'center' });
}

// ---------- network ----------
function headers(token) {
  var h = {
    Accept: 'application/json', 'X-Plex-Product': PRODUCT, 'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': S.cid, 'X-Plex-Platform': 'Tizen', 'X-Plex-Device': 'Samsung TV'
  };
  if (token) h['X-Plex-Token'] = token;
  return h;
}
async function api(url, opts) {
  opts = opts || {};
  var r = await fetch(url, { method: opts.method || 'GET', headers: headers(opts.token) });
  if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 401 ? ' — sign out and back in' : ''));
  var t = await r.text();
  return t ? JSON.parse(t) : {};
}
function pms(path, params) {
  var url = S.server.uri + path + (path.indexOf('?') < 0 ? '?' : '&') + qs(params || {});
  return api(url, { token: S.server.token }).then(function (j) { return j.MediaContainer || {}; });
}
function img(path, w, h) {
  return S.server.uri + '/photo/:/transcode?' +
    qs({ width: w, height: h, minSize: 1, upscale: 1, url: path, 'X-Plex-Token': S.server.token });
}

// ---------- startup, sign-in, server ----------
function boot() {
  S.cid = localStorage.cid || (localStorage.cid = 'plx-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  try {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind']
      .forEach(function (k) { tizen.tvinputdevice.registerKey(k); });
  } catch (e) { /* not on a TV */ }
  document.addEventListener('keydown', onKey);
  start();
}

async function start() {
  S.stack = [];
  try {
    S.token = localStorage.token || await signIn();
    S.server = await connect();
    await buildNav();
    go(home);
  } catch (e) { fail(e); }
}

function fail(e) {
  show('msg');
  var m = $('#msg');
  m.textContent = '';
  m.append(el('p', null, (e && e.message) || String(e)), button('Retry', start), button('Sign out', signOut));
  focus(m.querySelector('.focusable'));
}

function signOut() {
  localStorage.removeItem('token');
  localStorage.removeItem('server');
  location.reload();
}

async function signIn() {
  show('login');
  for (;;) {
    var pin = await api('https://plex.tv/api/v2/pins', { method: 'POST' });
    $('#code').textContent = pin.code;
    var until = Date.now() + (pin.expiresIn || 900) * 1000;
    while (Date.now() < until) {
      await sleep(2000);
      var p = await api('https://plex.tv/api/v2/pins/' + pin.id);
      if (p.authToken) return (localStorage.token = p.authToken);
    }
  }
}

async function connect() {
  var res = await api('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { token: S.token });
  var servers = res.filter(function (r) { return (r.provides || '').indexOf('server') >= 0; });
  if (!servers.length) throw new Error('No Plex Media Server on this account.');
  var srv = servers.filter(function (s) { return s.clientIdentifier === localStorage.server; })[0] ||
    (servers.length === 1 ? servers[0] : await pickServer(servers));
  localStorage.server = srv.clientIdentifier;
  return reach(srv);
}

function pickServer(servers) {
  return new Promise(function (ok) {
    show('msg');
    var m = $('#msg');
    m.textContent = '';
    m.append(el('h2', null, 'Choose a server'));
    servers.forEach(function (s) {
      m.append(button(s.name + (s.owned ? '' : ' (shared)'), function () { ok(s); }));
    });
    focus(m.querySelector('.focusable'));
  });
}

// First connection to answer wins — local beats relay on its own.
function reach(srv) {
  var conns = srv.connections || [];
  return new Promise(function (ok, no) {
    var left = conns.length;
    if (!left) no(new Error(srv.name + ' has no connections.'));
    conns.forEach(function (c) {
      timeout(api(c.uri + '/identity', { token: srv.accessToken }), 6000).then(
        function () { ok({ uri: c.uri, token: srv.accessToken, name: srv.name }); },
        function () { if (!--left) no(new Error("Can't reach " + srv.name + '.')); });
    });
  });
}

// ---------- navigation ----------
async function buildNav() {
  var secs = (await pms('/library/sections')).Directory || [];
  var nav = $('#nav');
  nav.textContent = '';
  nav.append(tab('Home', home), tab('Search', search));
  secs.filter(function (d) { return d.type === 'movie' || d.type === 'show'; })
    .forEach(function (d) { nav.append(tab(d.title, library(d))); });
  nav.append(
    button('Server', function () { localStorage.removeItem('server'); start(); }),
    button('Sign out', signOut));
}
function tab(label, view) { return button(label, function () { S.stack = []; go(view); }); }

function focusables() { return Array.prototype.slice.call($('#main').querySelectorAll('.focusable')); }

function go(view) {
  var top = S.stack[S.stack.length - 1];
  if (top) top.focus = focusables().indexOf(document.activeElement);
  S.stack.push({ view: view });
  render();
}

function back() {
  if (S.stack.length > 1) { S.stack.pop(); render(); return; }
  try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* browser */ }
}

async function render() {
  var seq = ++S.seq, entry = S.stack[S.stack.length - 1], main = $('#main');
  show('app');
  main.textContent = '';
  main.append(el('p', 'empty', 'Loading…'));
  try {
    var node = await entry.view();
    if (seq !== S.seq) return; // user moved on
    main.textContent = '';
    main.append(node);
    if (!$('#nav').contains(document.activeElement)) {
      var f = focusables();
      focus(f[entry.focus] || f[0] || $('#nav .focusable'));
    }
  } catch (e) { if (seq === S.seq) fail(e); }
}

function onKey(e) {
  var k = KEY[e.keyCode];
  if (!k) return;
  var inInput = e.target.tagName === 'INPUT';
  if (k === 'back' && e.keyCode === 8 && inInput) return;
  if (!$('#player').hidden) { e.preventDefault(); playerKey(k); return; }
  if (k === 'back') { e.preventDefault(); back(); return; }
  if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
    if (inInput && (k === 'left' || k === 'right')) return;
    e.preventDefault();
    move(k);
  }
}

function move(dir) {
  var scope = document.querySelector('.screen:not([hidden])');
  var all = Array.prototype.slice.call(scope.querySelectorAll('.focusable'));
  var cur = document.activeElement;
  if (all.indexOf(cur) < 0) { focus(all[0]); return; }
  var i = nearest(cur.getBoundingClientRect(), all.map(function (a) { return a.getBoundingClientRect(); }), dir);
  if (i >= 0) focus(all[i]);
}

// ---------- views ----------
async function home() {
  var hubs = (await pms('/hubs', { count: 20 })).Hub || [];
  var f = el('div');
  hubs.forEach(function (h) { if ((h.Metadata || []).some(browsable)) f.append(row(h.title, h.Metadata)); });
  if (!f.childNodes.length) f.append(el('p', 'empty', 'Nothing here yet.'));
  return f;
}

function library(d) {
  return async function () {
    // ponytail: first 1000 items; page on scroll when a library outgrows it
    var mc = await pms('/library/sections/' + d.key + '/all',
      { sort: 'titleSort', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 1000 });
    return grid(d.title, mc.Metadata || []);
  };
}

function children(m) {
  return async function () {
    var mc = await pms('/library/metadata/' + m.ratingKey + '/children');
    return grid((m.parentTitle ? m.parentTitle + ' — ' : '') + m.title, mc.Metadata || []);
  };
}

async function search() {
  var wrap = el('div'), out = el('div'), input = el('input', 'search focusable'), t;
  input.type = 'search';
  input.placeholder = 'Search movies and shows';
  input.oninput = function () { clearTimeout(t); t = setTimeout(run, 400); };
  async function run() {
    var q = input.value.trim();
    out.textContent = '';
    if (q.length < 2) return;
    try {
      var hubs = (await pms('/hubs/search', { query: q, limit: 20 })).Hub || [];
      if (q !== input.value.trim()) return;
      hubs.forEach(function (h) { if ((h.Metadata || []).some(browsable)) out.append(row(h.title, h.Metadata)); });
      if (!out.childNodes.length) out.append(el('p', 'empty', 'No results.'));
    } catch (e) { out.append(el('p', 'empty', e.message)); }
  }
  wrap.append(input, out);
  return wrap;
}

function browsable(m) { return KINDS.indexOf(m.type) >= 0; }

function row(title, items) {
  var s = el('section', 'row'), r = el('div', 'scroller');
  items.filter(browsable).forEach(function (m) { r.append(card(m)); });
  s.append(el('h2', null, title), r);
  return s;
}

function grid(title, items) {
  var s = el('section'), g = el('div', 'grid');
  items.filter(browsable).forEach(function (m) { g.append(card(m)); });
  s.append(el('h2', null, title), g);
  if (!g.childNodes.length) s.append(el('p', 'empty', 'Empty.'));
  return s;
}

function card(m) {
  var b = el('button', 'card focusable'), poster = el('div', 'poster'), pic = el('img');
  var t = m.type === 'episode' ? (m.grandparentThumb || m.parentThumb || m.thumb) : (m.thumb || m.parentThumb);
  pic.alt = '';
  if (t) pic.src = img(t, 240, 360);
  poster.append(pic);
  if (m.viewOffset && m.duration) {
    var bar = el('div', 'progress');
    bar.style.width = (100 * m.viewOffset / m.duration) + '%';
    poster.append(bar);
  }
  var title = m.type === 'episode' ? m.grandparentTitle : m.title;
  var sub = m.type === 'episode' ? 'S' + m.parentIndex + ' · E' + m.index + '  ' + m.title :
    m.type === 'season' ? (m.leafCount || '') + (m.leafCount ? ' episodes' : '') : (m.year || '');
  b.append(poster, el('span', 'title', title), el('span', 'sub', sub));
  b.onclick = function () { (m.type === 'movie' || m.type === 'episode') ? play(m).catch(fail) : go(children(m)); };
  return b;
}

// ---------- player ----------
function streamUrl(m, direct) {
  if (direct) return S.server.uri + m.Media[0].Part[0].key + '?' + qs({ 'X-Plex-Token': S.server.token });
  // 'Chrome' platform → server's web profile: H.264/AAC HLS, which every Tizen <video> plays
  return S.server.uri + '/video/:/transcode/universal/start.m3u8?' + qs({
    path: '/library/metadata/' + m.ratingKey, mediaIndex: 0, partIndex: 0, protocol: 'hls',
    fastSeek: 1, directPlay: 0, directStream: 1, directStreamAudio: 1, subtitles: 'burn',
    videoQuality: 100, maxVideoBitrate: 20000, session: P.session,
    'X-Plex-Session-Identifier': P.session, 'X-Plex-Client-Identifier': S.cid,
    'X-Plex-Product': PRODUCT, 'X-Plex-Platform': 'Chrome', 'X-Plex-Token': S.server.token
  });
}

async function play(item) {
  var m = ((await pms('/library/metadata/' + item.ratingKey)).Metadata || [])[0];
  if (!m || !m.Media || !m.Media.length) throw new Error('Nothing to play.');
  var v = $('#video'), resume = (m.viewOffset || 0) / 1000;
  P = { m: m, session: 'plx' + Date.now(), direct: canDirect(m.Media[0]), last: 0, from: document.activeElement };
  $('#osd-title').textContent = m.type === 'episode'
    ? m.grandparentTitle + ' — S' + m.parentIndex + 'E' + m.index + ' ' + m.title : m.title;
  v.onloadedmetadata = function () { if (resume > 5) v.currentTime = resume; };
  v.ontimeupdate = tick;
  v.onended = stop;
  v.onerror = function () {
    if (P.direct) { P.direct = false; resume = v.currentTime || resume; v.src = streamUrl(m, false); v.play(); return; }
    stop();
    fail(new Error('Playback failed.'));
  };
  v.src = streamUrl(m, P.direct);
  show('player');
  v.play();
  osd();
}

function tick() {
  var v = $('#video'), dur = P.m.duration / 1000;
  $('#bar').style.width = (100 * v.currentTime / dur) + '%';
  $('#time').textContent = fmt(v.currentTime) + ' / ' + fmt(dur);
  if (Date.now() - P.last > 10000) { P.last = Date.now(); timeline(v.paused ? 'paused' : 'playing'); }
}

function timeline(state) {
  return pms('/:/timeline', {
    ratingKey: P.m.ratingKey, key: '/library/metadata/' + P.m.ratingKey, state: state,
    time: Math.floor($('#video').currentTime * 1000), duration: P.m.duration,
    'X-Plex-Session-Identifier': P.session
  }).catch(function () { /* progress is best-effort */ });
}

function stop() {
  if (!P.m) return;
  var v = $('#video'), from = P.from;
  timeline('stopped');
  if (!P.direct) pms('/video/:/transcode/universal/stop', { session: P.session }).catch(function () {});
  v.onerror = v.onended = v.ontimeupdate = null;
  v.pause();
  v.removeAttribute('src');
  v.load();
  P = {};
  show('app');
  focus(from);
}

function osd() {
  var o = $('#osd');
  o.hidden = false;
  clearTimeout(osd.t);
  osd.t = setTimeout(function () { o.hidden = true; }, 4000);
}

function playerKey(k) {
  var v = $('#video');
  osd();
  if (k === 'back' || k === 'stop') return stop();
  if (k === 'enter' || k === 'playpause') return v.paused ? v.play() : v.pause();
  if (k === 'play') return v.play();
  if (k === 'pause') return v.pause();
  var d = { left: -10, right: 10, rw: -30, ff: 30 }[k];
  if (d) v.currentTime = Math.max(0, v.currentTime + d);
}

if (typeof module === 'object' && module.exports) module.exports = { qs: qs, nearest: nearest, canDirect: canDirect, fmt: fmt };
else boot();

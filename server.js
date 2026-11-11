/* KanbanGame a squadre — server autorevole (Node >= 18, nessuna dipendenza npm).
   Una simulazione per stanza (squadra), stato inviato ai client via Server-Sent Events. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const KG = require('./team/engine.js');

const PORT = +process.env.PORT || 3000;
const PIN = process.env.DOCENTE_PIN || 'lean';
const SPEED = Math.max(1, Math.round(+process.env.KG_SPEED || 1)); // passi da 0,1 s simulati per ogni tick da 100 ms
const TEST_DUR = +process.env.KG_TEST_DUR || 0;                     // sovrascrive la durata dei round (test)
const ROOT = __dirname;
const TEAM_DIR = path.join(ROOT, 'team');
const ROLES = ['legs', 'body', 'head', 'mizu', 'asm'];
const IMPS = ['heijunka', 'pitch', 'smed', 'std'];
const DURS = [120, 180, 240, 300];
const NEXT = { lobby: 'g1', s1: 'inter', inter: 'g2', s2: 'retro', retro: 'g3', s3: 'debrief' };
const ROOM_RE = /^[A-Z0-9_-]{1,24}$/;
const ROOM_TTL = 24 * 3600 * 1000;
const LEAVE_GRACE = +process.env.KG_LEAVE_MS || 8000;            // attesa prima di liberare i ruoli di chi esce
/* Apertura del gioco: parte CHIUSO (sul piano free di Render ogni risveglio è un riavvio, quindi un «chiuso» in memoria
   tornerebbe aperto). Il docente lo apre dalla regia; si richiude da solo dopo KG_OPEN_HOURS ore (predefinito 3). */
const OPEN_MS = Math.round((+process.env.KG_OPEN_HOURS > 0 ? +process.env.KG_OPEN_HOURS : 3) * 3600 * 1000);
const EXTEND_MS = 3600 * 1000;                                       // «+1 ora» dalla regia

const newSeed = () => 1 + Math.floor(Math.random() * 1e9);
const session = { dur: 180, seed: newSeed(), lang: 'it', open: process.env.KG_OPEN === '1', openUntil: 0 };
if (session.open) session.openUntil = Date.now() + OPEN_MS;
const sess = () => ({ dur: session.dur, lang: session.lang, open: session.open, openUntil: session.open ? session.openUntil : null });
const rooms = new Map();
const viewers = new Set(); // tutte le risposte SSE aperte (per reset)

/* ---------- stanze ---------- */
function newRoom(id) {
  return {
    id, name: id, phase: 'lobby', round: 0,
    roles: { legs: null, body: null, head: null, mizu: null, asm: null },
    cfg: { nP: { legs: 2, body: 2, head: 2 }, nW: { legs: 2, body: 2, head: 2 }, imp: [] },
    results: [null, null, null], sim: null, ev: [], tickN: 0, lastRoles: new Map(),
    members: new Map(), // cid -> {name, conns:Set, view, timer}
    touched: Date.now(), emptySince: Date.now(),
  };
}
function getRoom(id, create) {
  if (!id) return null;
  id = String(id).toUpperCase();
  if (!ROOM_RE.test(id)) return null;
  let r = rooms.get(id);
  if (!r && create) { r = newRoom(id); rooms.set(id, r); }
  return r || null;
}
const pub = r => ({ id: r.id, name: r.name, phase: r.phase, round: r.round, roles: Object.assign({}, r.roles), cfg: JSON.parse(JSON.stringify(r.cfg)), results: r.results });
const peers = r => [...r.members].filter(([, m]) => !m.view).map(([c, m]) => ({ c, name: m.name }));
const humans = r => ROLES.filter(k => r.roles[k]);
const inGame = r => /^g[123]$/.test(r.phase);

function send(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* ignorato */ } }
function broadcast(r, obj) {
  const s = 'data: ' + JSON.stringify(obj) + '\n\n';
  for (const m of r.members.values()) for (const res of m.conns) { try { res.write(s); } catch (e) { /* ignorato */ } }
}
const sendState = r => broadcast(r, { type: 'state', room: pub(r) });
const sendPeers = r => broadcast(r, { type: 'peers', peers: peers(r) });
function syncHuman(r) { if (r.sim) { const h = r.sim.S.human; h.length = 0; humans(r).forEach(k => h.push(k)); } }

function freeRoles(r, c) {
  let ch = false;
  ROLES.forEach(k => { if (r.roles[k] === c) { r.roles[k] = null; ch = true; } });
  if (ch) syncHuman(r);
  return ch;
}

/* ---------- apertura e chiusura del gioco ---------- */
/* chiude il gioco: avvisa tutti i client (membri e spettatori), chiude le connessioni, elimina le stanze (nessuna simulazione resta attiva) */
function closeGame() {
  session.open = false; session.openUntil = 0;
  session.seed = newSeed();
  for (const r of rooms.values()) {
    broadcast(r, { type: 'closed' });
    r.sim = null;
    for (const m of r.members.values()) {
      if (m.timer) { clearTimeout(m.timer); m.timer = null; }
      for (const x of m.conns) { viewers.delete(x); try { x.end(); } catch (e) { /* ignorato */ } }
      m.conns.clear();
    }
    r.members.clear();
  }
  rooms.clear();
}
/* true se aperto; se la scadenza è passata chiude subito (controllo pigro, oltre al timer) */
function isOpen() {
  if (session.open && Date.now() >= session.openUntil) { console.log('gioco chiuso automaticamente (scadenza)'); closeGame(); }
  return session.open;
}
setInterval(isOpen, 1000).unref();

/* ---------- partita ---------- */
function startRound(r, n) {
  r.round = n; r.phase = 'g' + n;
  const cfg = r.cfg;
  r.sim = KG.makeSim({
    mode: n === 1 ? 'push' : 'kanban', dur: TEST_DUR || session.dur, seqSeed: session.seed,
    nP: Object.assign({}, cfg.nP), nW: Object.assign({}, cfg.nW), imp: n === 3 ? cfg.imp.slice() : [], human: humans(r),
  });
  r.ev = []; r.tickN = 0;
}
function decimate(a, max) {
  if (!Array.isArray(a) || a.length <= max) return a;
  const out = [], step = (a.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(a[Math.round(i * step)]);
  return out;
}
function endRound(r) {
  const res = r.sim.result();
  res.samples = decimate(res.samples, 90);
  r.results[r.round - 1] = JSON.parse(JSON.stringify(res));
  broadcast(r, { type: 'tick', S: r.sim.snapshot(), ev: r.ev.splice(0) });
  r.sim = null;
  r.phase = 's' + r.round;
  sendState(r);
}
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.sim || !inGame(r)) continue;
    try { tickRoom(r); } catch (e) { console.error('tick ' + r.id + ':', e && e.stack || e); }
  }
}, 100);
function tickRoom(r) {
    const S = r.sim.S;
    for (let i = 0; i < SPEED && !S.ended; i++) {
      r.sim.step(0.1);
      if (S.ev.length) { r.ev.push(...S.ev); S.ev.length = 0; }
    }
    if (r.ev.length > 400) r.ev.splice(0, r.ev.length - 400);
    if (S.ended) { endRound(r); return; }
    if (++r.tickN % 2 === 0) broadcast(r, { type: 'tick', S: r.sim.snapshot(), ev: r.ev.splice(0) });
}

/* pulizia: stanze senza client da 24 h; ping SSE ogni 15 s */
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    const conns = [...r.members.values()].reduce((s, m) => s + m.conns.size, 0);
    if (conns) r.emptySince = now;
    else if (now - r.emptySince > ROOM_TTL) rooms.delete(id);
  }
}, 10 * 60 * 1000).unref();
setInterval(() => { for (const res of viewers) { try { res.write(': ping\n\n'); } catch (e) { /* ignorato */ } } }, 15000).unref();

/* ---------- HTTP ---------- */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
function json(res, code, obj) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }, CORS));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
const cleanName = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n || 24);

function sse(req, res, q) {
  const r = getRoom(q.get('room'), true);
  if (!r) return json(res, 400, { ok: false, error: 'room' });
  const c = cleanName(q.get('c'), 64) || ('anon' + Math.random().toString(36).slice(2, 8));
  const view = q.get('view') === '1';
  res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }, CORS));
  res.write('retry: 2000\n\n');
  let m = r.members.get(c), isNew = false;
  if (!m) { m = { name: '', conns: new Set(), view, timer: null }; r.members.set(c, m); isNew = true; }
  if (m.timer) { clearTimeout(m.timer); m.timer = null; }
  m.name = cleanName(q.get('name')) || m.name || 'Anonimo';
  if (!view && m.view) { m.view = false; isNew = true; }
  m.conns.add(res); viewers.add(res);
  let back = false;
  if (isNew && !view && r.lastRoles.has(c)) { /* rientro dopo l'uscita (telefono bloccato, rete persa): ridà i ruoli ancora liberi */
    r.lastRoles.get(c).forEach(k => { if (!r.roles[k]) { r.roles[k] = c; back = true; } });
    r.lastRoles.delete(c);
    if (back) syncHuman(r);
  }
  r.touched = Date.now(); r.emptySince = Date.now();
  const init = { type: 'init', room: pub(r), peers: peers(r), session: sess() };
  if (r.sim) init.S = r.sim.snapshot();
  send(res, init);
  if (isNew && !view) sendPeers(r);
  if (back) sendState(r);
  req.on('close', () => {
    m.conns.delete(res); viewers.delete(res);
    if (m.conns.size || r.members.get(c) !== m) return;
    m.timer = setTimeout(() => {
      m.timer = null;
      if (m.conns.size || r.members.get(c) !== m) return;
      r.members.delete(c);
      const had = ROLES.filter(k => r.roles[k] === c);
      if (had.length && !m.view) r.lastRoles.set(c, had);
      const ch = freeRoles(r, c);
      if (!m.view) sendPeers(r);
      if (ch) sendState(r);
    }, LEAVE_GRACE);
  });
}

function validN(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  for (const k of ['legs', 'body', 'head']) {
    const v = Math.round(+o[k]);
    if (!(v >= 1 && v <= 5)) return null;
    out[k] = v;
  }
  return out;
}

function op(r, b) {
  const c = b.c, m = c != null ? r.members.get(String(c)) : null;
  switch (b.a) {
    case 'role': case 'unrole': {
      if (!m || m.view) return 'notMember';
      if (!ROLES.includes(b.role)) return 'role';
      if (b.a === 'role') {
        if (r.roles[b.role] === c) return '';
        if (r.roles[b.role]) return 'taken';
        r.roles[b.role] = c;
        for (const l of r.lastRoles.values()) { const i = l.indexOf(b.role); if (i >= 0) l.splice(i, 1); }
      } else {
        if (r.roles[b.role] !== c) return 'notYours';
        r.roles[b.role] = null;
      }
      syncHuman(r); sendState(r); return '';
    }
    case 'cfg': {
      if (r.phase !== 'inter' && r.phase !== 'retro') return 'phase';
      const nc = JSON.parse(JSON.stringify(r.cfg));
      if (b.nP !== undefined) { const v = validN(b.nP); if (!v) return 'nP'; nc.nP = v; }
      if (b.nW !== undefined) { const v = validN(b.nW); if (!v) return 'nW'; nc.nW = v; }
      if (b.imp !== undefined) {
        if (r.phase !== 'retro') return 'phase';
        if (!Array.isArray(b.imp) || b.imp.length > 2 || b.imp.some(x => !IMPS.includes(x)) || new Set(b.imp).size !== b.imp.length) return 'imp';
        nc.imp = b.imp.slice();
      }
      r.cfg = nc; sendState(r); return '';
    }
    case 'next': {
      if (b.from != null && b.from !== r.phase) return 'phase';
      const nx = NEXT[r.phase];
      if (!nx) return 'phase';
      if (/^g/.test(nx)) startRound(r, +nx[1]);
      else { r.phase = nx; r.sim = null; }
      sendState(r);
      if (r.sim) broadcast(r, { type: 'tick', S: r.sim.snapshot(), ev: [] });
      return '';
    }
    case 'act': {
      if (!inGame(r) || !r.sim) return 'phase';
      if (!ROLES.includes(b.role)) return 'role';
      if (c == null || r.roles[b.role] !== c) return 'notYours';
      const why = r.sim.can(b.role, b.action, b.arg);
      if (why) return why;
      r.sim.act(b.role, b.action, b.arg);
      if (r.sim.S.ev.length) { r.ev.push(...r.sim.S.ev); r.sim.S.ev.length = 0; }
      return '';
    }
    case 'name': {
      const n = cleanName(b.name);
      if (!n) return 'name';
      r.name = n; sendState(r); return '';
    }
  }
  return 'unknown';
}

function roomsInfo() {
  const sumPN = o => KG.PN.reduce((s, p) => s + o[p].length, 0);
  const list = [...rooms.values()].map(r => {
    const nameOf = c => { const m = c && r.members.get(c); return m ? m.name : null; };
    const roles = {}; ROLES.forEach(k => roles[k] = nameOf(r.roles[k]));
    let live = null;
    if (r.sim) {
      const S = r.sim.S;
      live = { t: S.t, dur: S.dur, delivered: S.delivered.length, waiting: S.queue.length, stock: sumPN(S.super) + sumPN(S.line) + S.mizu.full.length };
    }
    return {
      room: r.id, name: r.name, peers: peers(r).map(p => p.name), phase: r.phase, round: r.round, roles,
      cards: KG.COMPS.reduce((s, k) => s + 4 * (r.cfg.nP[k] + r.cfg.nW[k]), 0), imp: r.cfg.imp.slice(),
      results: r.results.map(x => x ? { points: x.points, delivered: x.delivered, backlog: x.backlog, wip: x.wip, lead: x.lead, noWait: x.noWait } : null),
      live,
    };
  });
  return { rooms: list, session: sess(), now: Date.now() };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
function serveFile(res, file, head) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Non trovato'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
    if (head) return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p.includes('\0')) { res.writeHead(400); return res.end(); }
  const head = req.method === 'HEAD';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(TEAM_DIR, '.' + path.posix.normalize(p));
  if (file !== TEAM_DIR && !file.startsWith(TEAM_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file, head);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error('richiesta ' + req.url + ':', e && e.stack || e);
    try { if (!res.headersSent) json(res, 500, { ok: false, error: 'server' }); else res.end(); } catch (x) { /* ignorato */ }
  });
});
async function handle(req, res) {
  let u;
  try { u = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  const q = u.searchParams, pn = u.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (pn.startsWith('/api/')) {
    const open = isOpen();
    if (pn === '/api/ping') return json(res, 200, { ok: true, app: 'kanban-game', lang: session.lang, open, openUntil: open ? session.openUntil : null });
    if (pn === '/api/events' && req.method === 'GET') return open ? sse(req, res, q) : json(res, 403, { ok: false, error: 'closed' });
    if (pn === '/api/rooms' && req.method === 'GET') return json(res, 200, roomsInfo());
    if (pn === '/api/pin') return json(res, 200, { ok: q.get('pin') === PIN });
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });
    const b = await readBody(req);
    if (pn === '/api/op') {
      if (!b || typeof b !== 'object') return json(res, 400, { ok: false, error: 'body' });
      if (!open) return json(res, 403, { ok: false, error: 'closed' });
      const r = getRoom(q.get('room'), false);
      if (!r) return json(res, 404, { ok: false, error: 'noRoom' });
      if (b.c != null) b.c = String(b.c);
      r.touched = Date.now();
      const err = op(r, b);
      return json(res, 200, err ? { ok: false, error: err } : { ok: true });
    }
    if (pn === '/api/session' || pn === '/api/reset') {
      if (q.get('pin') !== PIN) return json(res, 403, { ok: false, error: 'pin' });
      if (pn === '/api/session') {
        const hasD = b && b.dur != null, hasL = b && b.lang != null, d = +(b && b.dur);
        const hasO = b && b.open != null, hasX = !!(b && b.extend);
        if (!hasD && !hasL && !hasO && !hasX) return json(res, 400, { ok: false, error: 'dur' });
        if (hasD && !DURS.includes(d)) return json(res, 400, { ok: false, error: 'dur' });
        if (hasL && b.lang !== 'it' && b.lang !== 'en') return json(res, 400, { ok: false, error: 'lang' });
        if (hasO && typeof b.open !== 'boolean') return json(res, 400, { ok: false, error: 'open' });
        if (hasX && !(hasO ? b.open : open)) return json(res, 409, { ok: false, error: 'closed' }); /* +1 ora solo a gioco aperto */
        if (hasD) session.dur = d;
        if (hasL) session.lang = b.lang;
        if (hasO && b.open) { session.open = true; session.openUntil = Date.now() + OPEN_MS; }
        if (hasX) session.openUntil += EXTEND_MS;
        if (hasO && !b.open) closeGame();
        else for (const r of rooms.values()) broadcast(r, { type: 'session', session: sess() });
        return json(res, 200, { ok: true, session: sess() });
      }
      session.seed = newSeed();
      for (const r of rooms.values()) {
        broadcast(r, { type: 'reset' });
        for (const m of r.members.values()) { if (m.timer) clearTimeout(m.timer); for (const x of m.conns) { viewers.delete(x); try { x.end(); } catch (e) { /* ignorato */ } } }
      }
      rooms.clear();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: 'notFound' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pn);
}
process.on('uncaughtException', e => console.error('errore non gestito:', e && e.stack || e));
process.on('unhandledRejection', e => console.error('promessa rifiutata:', e && e.stack || e));
server.listen(PORT, () => console.log('kanban-game in ascolto sulla porta ' + PORT + (session.open ? ' (gioco aperto, KG_OPEN=1)' : ' (gioco chiuso: lo apre il docente dalla regia)') + (SPEED > 1 ? ' (KG_SPEED=' + SPEED + ')' : '') + (TEST_DUR ? ' (KG_TEST_DUR=' + TEST_DUR + ')' : '')));

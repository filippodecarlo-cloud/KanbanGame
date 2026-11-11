/* Test automatico del server KanbanGame a squadre: `node test-server.js` (esce con 0 se tutto va bene). */
'use strict';
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PIN = 'testpin';
let PORT = 0, srv = null, failures = 0, checks = 0;
const log = (...a) => console.log(...a);
function ok(cond, msg) { checks++; if (cond) log('  ok   ' + msg); else { failures++; log('  FAIL ' + msg); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', d => b += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) { /* non JSON */ } resolve({ status: res.statusCode, headers: res.headers, body: b, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const get = p => req('GET', p);
const post = (p, b) => req('POST', p, b);

/* client SSE minimale */
function sse(room, c, name, view) {
  const cl = { msgs: [], last: {}, S: null, room: null, closed: false, waiters: [] };
  const p = `/api/events?room=${encodeURIComponent(room)}&c=${encodeURIComponent(c)}&name=${encodeURIComponent(name)}${view ? '&view=1' : ''}`;
  cl.req = http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
    cl.status = res.statusCode; cl.ctype = res.headers['content-type'];
    let buf = ''; res.setEncoding('utf8');
    res.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        chunk.split('\n').forEach(line => {
          if (line.startsWith('retry:')) cl.retry = +line.slice(6);
          if (!line.startsWith('data: ')) return;
          const m = JSON.parse(line.slice(6));
          cl.msgs.push(m); cl.last[m.type] = m;
          if (m.room) cl.room = m.room;
          if (m.S) cl.S = m.S;
          cl.waiters = cl.waiters.filter(w => !w(m));
        });
      }
    });
    res.on('end', () => { cl.closed = true; });
  });
  cl.req.on('error', () => { cl.closed = true; });
  cl.close = () => { cl.req.destroy(); cl.closed = true; };
  cl.wait = (pred, ms, what) => new Promise((resolve, reject) => {
    const found = cl.msgs.find(pred);
    if (found) return resolve(found);
    const t = setTimeout(() => reject(new Error('timeout: ' + (what || 'messaggio'))), ms || 5000);
    cl.waiters.push(m => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
  cl.waitNew = (pred, ms, what) => { const n = cl.msgs.length; return cl.wait(m => cl.msgs.indexOf(m) >= n && pred(m), ms, what); };
  return cl;
}

/* giocatore automatico lato client: decide le azioni dai tick (usa solo S.can) */
function autoPlayer(room, c, roles, policy) {
  const st = { acts: 0, rejected: 0, stop: false, busy: false };
  st.onTick = async S => {
    if (st.stop || st.busy || !S || S.ended) return;
    st.busy = true;
    try {
      for (const role of roles) {
        const a = policy(role, S);
        if (!a) continue;
        const r = await post(`/api/op?room=${room}`, { c, a: 'act', role, action: a.action, arg: a.arg });
        if (r.json && r.json.ok) st.acts++; else st.rejected++;
      }
    } finally { st.busy = false; }
  };
  return st;
}
function policy(role, S) {
  const can = S.can[role]; if (!can) return null;
  if (role === 'legs' || role === 'body' || role === 'head') {
    if (can.produce === '') return { action: 'produce' };
    if (can.produceType === '') return { action: 'produceType', arg: ['cow', 'horse', 'sheep', 'duck'][Math.floor(S.t) % 4] };
    return null;
  }
  if (role === 'asm') return can.assemble === '' ? { action: 'assemble' } : null;
  if (role === 'mizu') {
    const order = ['deliver', 'collect', 'swap', 'loadAll'];
    for (const a of order) if (can[a] === '') return { action: a };
    if (S.mizu.loc === 'line' && can.goSuper === '' && (S.mode === 'push' || S.mizu.empty.length)) return { action: 'goSuper' };
    if (S.mizu.loc === 'super' && can.goLine === '') return { action: 'goLine' };
  }
  return null;
}

/* avvia il server su una porta libera (KG_OPEN e KG_OPEN_HOURS tolti dall'ambiente se non indicati) */
async function startServer(extra) {
  if (srv) { srv.kill(); srv = null; }
  PORT = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(PORT), DOCENTE_PIN: PIN, KG_SPEED: '10', KG_TEST_DUR: '60', KG_LEAVE_MS: '1200' });
  delete env.KG_OPEN; delete env.KG_OPEN_HOURS;
  srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign(env, extra || {}), stdio: ['ignore', 'pipe', 'inherit'] });
  srv.stdout.resume(); /* consuma l'output (log) */
  await new Promise((res, rej) => { srv.stdout.once('data', () => res()); srv.once('exit', c => rej(new Error('server uscito ' + c))); });
}

async function main() {
  await startServer();

  log('# ping');
  let r = await get('/api/ping');
  ok(r.status === 200 && r.json.ok === true && r.json.app === 'kanban-game', 'ping');
  ok(r.headers['access-control-allow-origin'] === '*', 'CORS *');
  r = await get('/api/pin?pin=' + PIN); ok(r.json.ok === true, 'pin giusto');
  r = await get('/api/pin?pin=xx'); ok(r.json.ok === false, 'pin sbagliato');

  log('# gioco chiuso all\'avvio (KG_OPEN non impostato)');
  r = await get('/api/ping');
  ok(r.json.open === false && r.json.openUntil === null, 'ping: open false, openUntil null');
  r = await get('/api/events?room=T0&c=x&name=y');
  ok(r.status === 403 && r.json && r.json.ok === false && r.json.error === 'closed' && !/event-stream/.test(r.headers['content-type']), 'events da chiuso: 403 closed (JSON, niente SSE)');
  r = await get('/api/events?room=T0&c=x&name=y&view=1');
  ok(r.status === 403 && r.json && r.json.error === 'closed', 'events spettatore da chiuso: 403 closed');
  r = await post('/api/op?room=T0', { c: 'x', a: 'next' }); ok(r.json && r.json.ok === false && r.json.error === 'closed', 'op da chiuso: closed');
  r = await get('/api/rooms'); ok(r.status === 200 && r.json.rooms.length === 0 && r.json.session.open === false && r.json.session.openUntil === null, '/api/rooms funziona da chiuso (session.open false)');
  r = await post('/api/session?pin=sbagliato', { open: true }); ok(r.status === 403 && r.json.error === 'pin', 'apertura con pin sbagliato rifiutata');
  r = await get('/api/ping'); ok(r.json.open === false, 'resta chiuso');
  r = await post('/api/session?pin=' + PIN, { extend: 1 }); ok(r.status === 409 && r.json.error === 'closed', '+1 ora rifiutato a gioco chiuso');
  r = await post('/api/session?pin=' + PIN, { open: 'si' }); ok(r.status === 400 && r.json.error === 'open', 'open non booleano rifiutato');
  let t0 = Date.now();
  r = await post('/api/session?pin=' + PIN, { open: true });
  ok(r.json.ok === true && r.json.session.open === true && Math.abs(r.json.session.openUntil - (t0 + 3 * 3600e3)) < 5000, 'apertura con pin giusto: openUntil = ora + 3 h');
  const until0 = r.json.session.openUntil;
  r = await get('/api/ping'); ok(r.json.open === true && r.json.openUntil === until0, 'ping: aperto con openUntil');
  r = await post('/api/session?pin=' + PIN, { extend: 1 }); ok(r.json.ok && r.json.session.openUntil === until0 + 3600e3, '+1 ora allunga openUntil di un\'ora');
  r = await get('/api/rooms'); ok(r.json.session.open === true && r.json.session.openUntil === until0 + 3600e3, '/api/rooms: session con open/openUntil');

  log('# ingresso nella stanza');
  const ROOM = 'TEST1';
  const A = sse('test1', 'cidA', 'Anna');
  let init = await A.wait(m => m.type === 'init', 3000, 'init A');
  ok(A.ctype && A.ctype.startsWith('text/event-stream'), 'content-type SSE');
  ok(A.retry === 2000, 'retry 2000');
  ok(init.room.id === ROOM && init.room.phase === 'lobby' && init.session.dur === 180, 'init stato pubblico (id maiuscolo, lobby, dur)');
  ok(init.session.open === true && typeof init.session.openUntil === 'number', 'init.session con open/openUntil');
  ok(JSON.stringify(init.room.cfg) === JSON.stringify({ nP: { legs: 2, body: 2, head: 2 }, nW: { legs: 2, body: 2, head: 2 }, imp: [] }), 'cfg di default');
  const B = sse(ROOM, 'cidB', 'Bruno');
  await B.wait(m => m.type === 'init', 3000, 'init B');
  const pe = await A.wait(m => m.type === 'peers' && m.peers.length === 2, 3000, 'peers 2');
  ok(pe.peers.map(p => p.name).sort().join() === 'Anna,Bruno', 'peers con i nomi');
  const V = sse(ROOM, 'cidV', 'Docente', true);
  await V.wait(m => m.type === 'init', 3000, 'init V');
  await sleep(150);
  ok(A.last.peers.peers.length === 2, 'lo spettatore non compare tra i membri');
  r = await get('/api/events?room=bad%20id&c=x&name=y'); ok(r.status === 400, 'id stanza non valido rifiutato');

  log('# ruoli');
  const op = (c, b) => post(`/api/op?room=${ROOM}`, Object.assign({ c }, b));
  r = await op('cidA', { a: 'role', role: 'mizu' }); ok(r.json.ok, 'A prende mizu');
  r = await op('cidB', { a: 'role', role: 'mizu' }); ok(!r.json.ok && r.json.error === 'taken', 'B non puo prendere mizu (occupato)');
  r = await op('cidB', { a: 'role', role: 'legs' }); ok(r.json.ok, 'B prende legs');
  r = await op('cidB', { a: 'unrole', role: 'mizu' }); ok(!r.json.ok, 'B non puo lasciare un ruolo non suo');
  r = await op('cidB', { a: 'role', role: 'pilot' }); ok(!r.json.ok, 'ruolo inesistente rifiutato');
  r = await op('cidV', { a: 'role', role: 'head' }); ok(!r.json.ok, 'lo spettatore non prende ruoli');
  r = await op('cidX', { a: 'role', role: 'head' }); ok(!r.json.ok, 'sconosciuto non prende ruoli');
  r = await op('cidA', { a: 'role', role: 'head' }); ok(r.json.ok, 'A prende anche head');
  r = await op('cidA', { a: 'unrole', role: 'head' }); ok(r.json.ok, 'A lascia head');
  let st = await B.wait(m => m.type === 'state' && m.room.roles.legs === 'cidB' && m.room.roles.mizu === 'cidA' && !m.room.roles.head, 3000, 'state ruoli');
  ok(!!st, 'state con ruoli aggiornati');
  r = await op('cidA', { a: 'act', role: 'mizu', action: 'goSuper' }); ok(!r.json.ok && r.json.error === 'phase', 'act fuori partita rifiutato');
  r = await op('cidA', { a: 'cfg', nP: { legs: 3, body: 3, head: 3 } }); ok(!r.json.ok && r.json.error === 'phase', 'cfg in lobby rifiutato');
  r = await op('cidA', { a: 'name', name: 'Le Mucche Volanti' }); ok(r.json.ok, 'nome squadra');
  r = await post('/api/op?room=NOPE', { c: 'cidA', a: 'next' }); ok(!r.json.ok, 'op su stanza inesistente');

  /* gioca un round con giocatori umani automatici */
  async function playRound(n, mode) {
    log(`# round ${n} (${mode})`);
    const pA = autoPlayer(ROOM, 'cidA', ['mizu'], policy), pB = autoPlayer(ROOM, 'cidB', ['legs'], policy);
    const tickA = m => { if (m.type === 'tick') pA.onTick(m.S); };
    const tickB = m => { if (m.type === 'tick') pB.onTick(m.S); };
    A.waiters.push(m => { tickA(m); return false; }); B.waiters.push(m => { tickB(m); return false; });
    const sP = A.waitNew(m => m.type === 'state' && m.room && m.room.phase === 'g' + n, 3000, 'state g' + n); /* in ascolto prima del POST: lo state può arrivare prima della risposta */
    const r1 = await op('cidA', { a: 'next' });
    ok(r1.json.ok, 'next avvia il round ' + n);
    const s = await sP;
    ok(s.room.phase === 'g' + n && s.room.round === n, 'fase g' + n);
    const tk = await A.waitNew(m => m.type === 'tick', 3000, 'tick');
    ok(tk.S && tk.S.mode === mode && Array.isArray(tk.ev), 'tick con S e ev, modo ' + mode);
    ok(tk.S.can && tk.S.can.mizu && 'swap' in tk.S.can.mizu && tk.S.can.asm && 'assemble' in tk.S.can.asm && tk.S.can.legs && 'produce' in tk.S.can.legs, 'mappa can completa');
    ok(typeof tk.S.swapPossible === 'boolean', 'swapPossible');
    ok(tk.S.human.includes('mizu') && tk.S.human.includes('legs') && tk.S.human.length === 2, 'S.human = ruoli presi');
    ok(!('seq' in tk.S) && !('samples' in tk.S) && !('stockT' in tk.S) && typeof tk.S.wip === 'number' && typeof tk.S.delivered.n === 'number', 'snapshot ridotto');
    let rr = await op('cidA', { a: 'next' }); ok(!rr.json.ok, 'next ignorato in partita');
    rr = await op('cidB', { a: 'act', role: 'mizu', action: 'goSuper' }); ok(!rr.json.ok && rr.json.error === 'notYours', 'act con ruolo altrui rifiutato');
    rr = await op('cidA', { a: 'cfg', nP: { legs: 3, body: 3, head: 3 } }); ok(!rr.json.ok, 'cfg in partita rifiutato');
    if (n === 1) {
      /* ruolo preso e lasciato a partita in corso */
      rr = await op('cidB', { a: 'role', role: 'asm' }); ok(rr.json.ok, 'B prende asm in partita');
      await B.waitNew(m => m.type === 'tick' && m.S.human.includes('asm'), 3000, 'human con asm');
      ok(true, 'S.human aggiornato con asm');
      rr = await op('cidB', { a: 'unrole', role: 'asm' }); ok(rr.json.ok, 'B lascia asm');
      await B.waitNew(m => m.type === 'tick' && !m.S.human.includes('asm'), 3000, 'human senza asm');
      ok(true, 'S.human aggiornato senza asm');
    }
    const ttStart = Date.now();
    const end = await A.waitNew(m => m.type === 'state' && m.room.phase === 's' + n, 60000, 'fine round ' + n);
    pA.stop = pB.stop = true;
    await sleep(100);
    const res = end.room.results[n - 1];
    ok(!!res && res.mode === mode && typeof res.points === 'number', `risultato round ${n}: ${res && res.points} punti, ${res && res.delivered} spediti (${Date.now() - ttStart} ms)`);
    ok(res && Array.isArray(res.samples) && res.samples.length <= 90 && res.samples.length > 5, 'samples decimati (' + (res && res.samples.length) + ')');
    ok(res && res.human.includes('mizu') && res.human.includes('legs'), 'risultato registra ruoli umani');
    ok(pA.acts > 3, `mizu umano ha agito (${pA.acts} azioni)`);
    ok(pB.acts > 1, `legs umano ha agito (${pB.acts} azioni)`);
    const lastS = A.S;
    ok(lastS.cells.legs.made > 0, 'reparto zampe ha prodotto (' + lastS.cells.legs.made + ')');
    ok(lastS.mizu.trips > 0, 'mizusumashi ha viaggiato (' + lastS.mizu.trips + ' giri)');
    if (mode === 'kanban') ok(lastS.mizu.swaps > 0, 'scambi di cartellini (' + lastS.mizu.swaps + ')');
    return res;
  }

  const r1 = await playRound(1, 'push');
  r = await op('cidA', { a: 'cfg', nP: { legs: 3, body: 3, head: 3 } }); ok(!r.json.ok, 'cfg in s1 rifiutato');
  let stP = A.waitNew(m => m.type === 'state' && m.room.phase === 'inter', 3000, 'state inter'); /* in ascolto prima del POST: lo state può arrivare prima della risposta */
  r = await op('cidB', { a: 'next' }); ok(r.json.ok, 'next s1 -> inter');
  st = await stP; ok(st.room.phase === 'inter', 'fase inter');
  stP = B.waitNew(m => m.type === 'state' && m.room.phase === 'inter' && m.room.cfg.nW.legs === 1, 3000, 'cfg propagata');
  r = await op('cidA', { a: 'cfg', nP: { legs: 3, body: 3, head: 2 }, nW: { legs: 1, body: 2, head: 2 } }); ok(r.json.ok, 'cfg nP/nW in inter');
  st = await stP; ok(st.room.cfg.nP.legs === 3 && st.room.cfg.nW.legs === 1, 'cfg propagata a tutti');
  r = await op('cidA', { a: 'cfg', imp: ['smed'] }); ok(!r.json.ok, 'imp in inter rifiutato');
  r = await op('cidA', { a: 'cfg', nP: { legs: 6, body: 3, head: 3 } }); ok(!r.json.ok, 'nP fuori 1..5 rifiutato');
  const r2 = await playRound(2, 'kanban');
  ok(r2.nP.legs === 3 && r2.nW.legs === 1 && r2.imp.length === 0, 'round 2 usa la cfg scelta, senza miglioramenti');
  stP = A.waitNew(m => m.type === 'state' && m.room.phase === 'retro', 3000, 'state retro');
  r = await op('cidA', { a: 'next' }); ok(r.json.ok, 'next s2 -> retro');
  st = await stP; ok(st.room.phase === 'retro', 'fase retro');
  r = await op('cidA', { a: 'cfg', imp: ['heijunka', 'smed', 'std'] }); ok(!r.json.ok, 'piu di 2 miglioramenti rifiutato');
  r = await op('cidA', { a: 'cfg', imp: ['magic'] }); ok(!r.json.ok, 'miglioramento sconosciuto rifiutato');
  r = await op('cidA', { a: 'cfg', imp: ['heijunka', 'smed'], nP: { legs: 2, body: 2, head: 2 } }); ok(r.json.ok, 'imp + nP in retro');
  const r3 = await playRound(3, 'kanban');
  ok(r3.imp.join() === 'heijunka,smed', 'round 3 con miglioramenti');
  stP = A.waitNew(m => m.type === 'state' && m.room.phase === 'debrief', 3000, 'state debrief');
  r = await op('cidA', { a: 'next' }); ok(r.json.ok, 'next s3 -> debrief');
  st = await stP; ok(st.room.phase === 'debrief' && st.room.results.every(x => x), 'fase debrief con 3 risultati');
  r = await op('cidA', { a: 'next' }); ok(!r.json.ok, 'next in debrief ignorato');
  log(`  punti: R1 ${r1.points}  R2 ${r2.points}  R3 ${r3.points}`);

  log('# /api/rooms e sessione');
  r = await get('/api/rooms');
  const room = r.json.rooms.find(x => x.room === ROOM);
  ok(!!room, 'stanza elencata');
  ok(room && room.name === 'Le Mucche Volanti' && room.phase === 'debrief' && room.round === 3, 'nome, fase, round');
  ok(room && room.peers.sort().join() === 'Anna,Bruno', 'membri per nome');
  ok(room && room.roles.mizu === 'Anna' && room.roles.legs === 'Bruno' && room.roles.head === null, 'ruoli per nome');
  ok(room && room.cards === 44 && room.imp.join() === 'heijunka,smed', 'cartellini e miglioramenti');
  ok(room && room.results.length === 3 && room.results.every(x => x && 'points' in x && 'lead' in x && 'noWait' in x && !('samples' in x)), 'risultati sintetici');
  ok(room && room.live === null, 'live null fuori partita');
  ok(r.json.session.dur === 180 && typeof r.json.now === 'number', 'session e now');
  r = await post('/api/session?pin=sbagliato', { dur: 240 }); ok(r.status === 403, 'session con pin sbagliato');
  r = await post('/api/session?pin=' + PIN, { dur: 999 }); ok(!r.json.ok, 'durata non ammessa');
  r = await post('/api/session?pin=' + PIN, { dur: 240 }); ok(r.json.ok, 'durata 240');
  r = await get('/api/rooms'); ok(r.json.session.dur === 240, 'durata aggiornata');

  log('# live in partita (stanza 2, tutti automatici)');
  const C = sse('TEST2', 'cidC', 'Carla');
  await C.wait(m => m.type === 'init');
  await post('/api/op?room=TEST2', { c: 'cidC', a: 'next' });
  await C.waitNew(m => m.type === 'tick', 3000);
  r = await get('/api/rooms');
  const r2live = r.json.rooms.find(x => x.room === 'TEST2');
  ok(r2live && r2live.live && typeof r2live.live.t === 'number' && 'waiting' in r2live.live && 'stock' in r2live.live && r2live.live.dur === 60, 'live presente in partita');
  const C2 = sse('TEST2', 'cidD', 'Dario');
  const ci = await C2.wait(m => m.type === 'init', 3000);
  ok(ci.S && ci.S.can, 'init in partita include S');
  C2.close();

  log('# uscita e riconnessione');
  B.close();
  await sleep(300);
  const B2 = sse(ROOM, 'cidB', 'Bruno');
  await B2.wait(m => m.type === 'init', 3000);
  await sleep(1600);
  r = await get('/api/rooms');
  ok(r.json.rooms.find(x => x.room === ROOM).roles.legs === 'Bruno', 'riconnessione rapida mantiene il ruolo');
  B2.close();
  const freed = await A.waitNew(m => m.type === 'state' && !m.room.roles.legs, 5000, 'ruolo liberato');
  ok(!!freed && freed.room.roles.mizu === 'cidA', 'chi esce libera i ruoli');
  ok(A.last.peers.peers.length === 1, 'peers aggiornati dopo l\'uscita');

  log('# file statici');
  r = await get('/');
  ok(r.status === 200 || r.status === 404, '/ risponde (' + r.status + ')');
  ok(r.headers['cache-control'] === 'no-cache' || r.status === 404, 'Cache-Control no-cache');
  r = await get('/engine.js'); ok(r.status === 200 && r.body.includes('makeSim') && /javascript/.test(r.headers['content-type']), '/engine.js servito da team/');
  r = await get('/solo/'); ok(r.status === 404, '/solo/ non più servito (niente versione singola dal server)');
  r = await get('/../server.js'); ok(r.status !== 200 || !r.body.includes('createServer'), 'traversal ../ bloccato');
  r = await get('/%2e%2e/server.js'); ok(r.status !== 200 || !r.body.includes('createServer'), 'traversal %2e%2e bloccato');
  r = await get('/..%2fserver.js'); ok(r.status !== 200 || !r.body.includes('createServer'), 'traversal %2f bloccato');
  r = await get('/nonesiste.js'); ok(r.status === 404, '404 per file mancante');

  log('# reset');
  r = await post('/api/reset?pin=sbagliato', {}); ok(r.status === 403, 'reset con pin sbagliato rifiutato');
  r = await get('/api/rooms'); ok(r.json.rooms.length === 2, 'stanze intatte');
  r = await post('/api/reset?pin=' + PIN, {}); ok(r.json.ok, 'reset con pin giusto');
  await A.wait(m => m.type === 'reset', 3000, 'reset A'); ok(true, 'broadcast reset');
  await C.wait(m => m.type === 'reset', 3000, 'reset C');
  r = await get('/api/rooms'); ok(r.json.rooms.length === 0, 'stanze azzerate');
  [A, C, V].forEach(x => x.close());
  r = await get('/api/ping'); ok(r.json.open === true, 'il reset non chiude il gioco');

  log('# chiusura dalla regia');
  const M = sse('CHIUSA', 'cidM', 'Marta'), W = sse('CHIUSA', 'cidW', 'Docente', true), M2 = sse('ALTRA', 'cidN', 'Nico');
  await M.wait(m => m.type === 'init', 3000, 'init M'); await W.wait(m => m.type === 'init', 3000, 'init W'); await M2.wait(m => m.type === 'init', 3000, 'init M2');
  r = await post('/api/op?room=CHIUSA', { c: 'cidM', a: 'role', role: 'mizu' }); ok(r.json.ok, 'M prende mizu');
  r = await post('/api/op?room=CHIUSA', { c: 'cidM', a: 'next' }); ok(r.json.ok, 'round 1 avviato');
  await M.waitNew(m => m.type === 'tick', 3000, 'tick prima della chiusura');
  r = await post('/api/session?pin=sbagliato', { open: false }); ok(r.status === 403, 'chiusura con pin sbagliato rifiutata');
  r = await get('/api/rooms'); ok(r.json.rooms.length === 2 && r.json.rooms.some(x => x.live), 'stanze e partita ancora attive');
  r = await post('/api/session?pin=' + PIN, { open: false });
  ok(r.json.ok && r.json.session.open === false && r.json.session.openUntil === null, 'chiusura con pin giusto');
  await M.wait(m => m.type === 'closed', 3000, 'closed M'); ok(true, 'membro riceve closed');
  await W.wait(m => m.type === 'closed', 3000, 'closed W'); ok(true, 'spettatore riceve closed');
  await M2.wait(m => m.type === 'closed', 3000, 'closed M2'); ok(true, 'membro di un\'altra stanza riceve closed');
  await sleep(300);
  ok(M.closed && W.closed && M2.closed, 'connessioni SSE chiuse dal server');
  const nAfter = M.msgs.length;
  r = await get('/api/rooms'); ok(r.json.rooms.length === 0 && r.json.session.open === false, '/api/rooms vuoto dopo la chiusura');
  r = await get('/api/events?room=CHIUSA&c=cidM&name=Marta'); ok(r.status === 403 && r.json.error === 'closed', 'events di nuovo 403');
  r = await post('/api/op?room=CHIUSA', { c: 'cidM', a: 'next' }); ok(r.json.error === 'closed', 'op di nuovo closed');
  await sleep(500);
  r = await get('/api/rooms'); ok(r.json.rooms.length === 0 && M.msgs.length === nAfter, 'nessuna simulazione resta attiva (niente stanze, niente tick)');
  r = await post('/api/session?pin=' + PIN, { dur: 180 }); ok(r.json.ok && r.json.session.open === false, 'durata modificabile anche da chiuso');
  r = await post('/api/reset?pin=' + PIN, {}); ok(r.json.ok, 'reset funziona anche da chiuso');
  r = await post('/api/session?pin=' + PIN, { open: true }); ok(r.json.ok && r.json.session.open, 'riapertura');
  const M3 = sse('CHIUSA', 'cidM', 'Marta');
  init = await M3.wait(m => m.type === 'init', 3000, 'init M3');
  ok(init.room.phase === 'lobby' && init.room.roles.mizu === null, 'dopo la riapertura la stanza riparte da zero');
  M3.close();

  log('# chiusura automatica (KG_OPEN=1, KG_OPEN_HOURS=0.001 = 3,6 s)');
  await startServer({ KG_OPEN: '1', KG_OPEN_HOURS: '0.001' });
  r = await get('/api/ping'); ok(r.json.open === true && r.json.openUntil - Date.now() > 0 && r.json.openUntil - Date.now() <= 3600, 'KG_OPEN=1: parte aperto (' + (r.json.openUntil - Date.now()) + ' ms alla chiusura)');
  const Z = sse('AUTO', 'cidZ', 'Zeno');
  await Z.wait(m => m.type === 'init', 3000, 'init Z');
  await post('/api/op?room=AUTO', { c: 'cidZ', a: 'next' });
  await Z.wait(m => m.type === 'closed', 8000, 'closed automatico'); ok(true, 'chiusura automatica: closed inviato');
  await sleep(300);
  ok(Z.closed, 'chiusura automatica: connessione chiusa');
  r = await get('/api/rooms'); ok(r.json.rooms.length === 0 && r.json.session.open === false, 'chiusura automatica: stanze eliminate, chiuso');
  r = await get('/api/events?room=AUTO&c=cidZ&name=Zeno'); ok(r.status === 403, 'chiusura automatica: events 403');
  t0 = Date.now();
  r = await post('/api/session?pin=' + PIN, { open: true });
  ok(r.json.session.open && Math.abs(r.json.session.openUntil - (t0 + 3600)) < 500, 'KG_OPEN_HOURS frazionario: openUntil = ora + 3,6 s');
  await sleep(4200);
  r = await get('/api/ping'); ok(r.json.open === false, 'si richiude da solo anche senza client');
}

main().catch(e => { failures++; console.error('ERRORE', e && e.stack || e); }).finally(() => {
  if (srv) srv.kill();
  log(`\n${checks} controlli, ${failures} falliti`);
  process.exit(failures ? 1 : 0);
});

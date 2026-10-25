// Servidor multiplayer — Power Rangers Battle World
// Fácil: quem digitar o MESMO código de sala cai na mesma partida (sem código = sala PUBLICA). Sem lobby, sem líder.
// Rodar: npm install && npm start   (usa a porta da variável PORT, como Render/Railway/Fly exigem)
const http = require('http');
const { WebSocketServer } = require('ws');
const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/plain' }); r.end('Servidor Power Rangers online'); }); // health-check das hospedagens
const wss = new WebSocketServer({ server });
const rooms = new Map(), MAXSP = 9, BOUND = 145, MAXP = 8;
const send = (ws, o) => { if (ws.readyState === 1 && ws.bufferedAmount < 262144) ws.send(JSON.stringify(o)); }; // não empilha mensagens em conexão lenta (evita travar)
const bc = (r, o, except) => r.players.forEach(p => p.id !== except && send(p.ws, o));
const pickHost = r => { r.host = r.players.size ? [...r.players.keys()][0] : null; r.players.forEach(p => send(p.ws, { t: 'host', v: p.id === r.host })); };
const clean = c => String(c || 'PUBLICA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLICA';

function leave(p) {
  const r = p.room; if (!r) return; p.room = null; r.players.delete(p.id);
  if (!r.players.size) return void rooms.delete(r.code);
  if (r.host === p.id) pickHost(r);
}
wss.on('connection', ws => {
  let p = null; ws.alive = true; ws.on('pong', () => ws.alive = true);
  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.t === 'join') {
      const id = String(d.id || '').slice(0, 12); if (!id) return; const code = clean(d.code);
      let r = rooms.get(code); if (!r) { r = { code, host: null, world: 0, mega: null, megaCd: 0, players: new Map() }; rooms.set(code, r); }
      if (r.players.size >= MAXP && !r.players.has(id)) return send(ws, { t: 'full' });
      if (p) leave(p);
      p = { id, name: String(d.name || 'Ranger').slice(0, 12), x: 0, z: 0, y: 0, ry: 0, ch: -1, m: 0, w: r.world, ws, last: Date.now(), room: r };
      r.players.set(id, p); if (!r.host || !r.players.has(r.host)) r.host = id;
      send(ws, { t: 'host', v: id === r.host }); send(ws, { t: 'warp', w: r.world }); send(ws, { t: 'room', code, n: r.players.size }); return;
    }
    if (!p || !p.room) return; const r = p.room, id = p.id, host = r.host === id;
    switch (d.t) {
      case 'pos': {
        const now = Date.now(), dt = Math.max(now - p.last, 50) / 1000; p.last = now;
        const nx = Math.max(-BOUND, Math.min(BOUND, +d.x || 0)), nz = Math.max(-BOUND, Math.min(BOUND, +d.z || 0));
        if (Math.hypot(nx - p.x, nz - p.z) > MAXSP * dt * 1.8 + 10) send(ws, { t: 'kick' }); else { p.x = nx; p.z = nz; }
        p.y = Math.max(0, Math.min(4, +d.y || 0)); p.ry = +d.ry || 0; p.ch = d.ch | 0; p.m = d.m ? 1 : 0; p.w = d.w | 0; break; }
      case 'fx': case 'morph': bc(r, { ...d, id }, id); break;
      case 'chat': bc(r, { t: 'chat', name: p.name, text: String(d.text).slice(0, 80) }); break;
      case 'en': if (host) bc(r, d, id); break;
      case 'hit': { const h = r.players.get(r.host); if (h && !host) send(h.ws, { t: 'hit', id: d.id, d: Math.min(+d.d || 0, 2500) }); break; }
      case 'dmg': { const q = r.players.get(d.to); if (q && host) send(q.ws, { t: 'dmg', d: Math.min(+d.d || 0, 200) }); break; }
      case 'xp': case 'portal': case 'win': case 'rg': if (host) bc(r, d, id); break;
      case 'world': r.world = Math.max(0, Math.min(99, d.w | 0)); r.players.forEach(q => q.w = r.world); r.mega = null; bc(r, { t: 'warp', w: r.world }); break;
      case 'sig': { const q = r.players.get(d.to); if (q) send(q.ws, { t: 'sig', from: id, d: d.d }); break; }
      case 'vc': bc(r, { t: 'vc', id, on: d.on ? 1 : 0 }, id); break;
      case 'mega': {
        if (r.mega || Date.now() < r.megaCd) return;
        const o = [...r.players.values()].filter(q => q.id !== id && q.w === p.w);
        r.mega = { pilot: id, gunner: o[0] ? o[0].id : id, shield: o[1] ? o[1].id : id };
        bc(r, { t: 'megaOn', ...r.mega, x: p.x, z: p.z, w: p.w });
        setTimeout(() => { r.mega = null; r.megaCd = Date.now() + 60000; bc(r, { t: 'megaOff' }); }, 27000); break; }
      case 'mz': if (r.mega && id === r.mega.pilot) bc(r, { t: 'mz', x: +d.x || 0, z: +d.z || 0, ry: +d.ry || 0 }, id); break;
      case 'mzfx': if (r.mega && [r.mega.pilot, r.mega.gunner, r.mega.shield].includes(id)) bc(r, { t: 'mzfx', k: d.k }, id); break;
    }
  });
  ws.on('close', () => p && leave(p)); ws.on('error', () => {});
});
setInterval(() => rooms.forEach(r => bc(r, { t: 'state', p: [...r.players.values()].map(({ id, name, x, z, y, ry, ch, m, w }) => ({ id, name, x, z, y, ry, ch, m, w })) })), 100);
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 25000); // derruba conexões mortas
server.listen(process.env.PORT || 8080, () => console.log('Servidor Power Rangers na porta', process.env.PORT || 8080));

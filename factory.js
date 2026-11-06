// Krillion Latin: Factory mode.
// Side-view factory floor with parallax depth. Each player owns a section:
//   spawner → conveyor → compactor ........ holo pad → SELL bin
// Press E to grab an item from your conveyor, E at your bin to drop it in.
// Bins sell 1 item / 5s, or 1 / 0.5s while the owner stands on their pad.
// You can steal a random item from someone else's bin (never from hands or conveyors).
//
// Networking: the host is authoritative for pickups, bins, money and the clock.
// Conveyor items are deterministic (seeded by section + spawn index), so every
// browser draws the same belts without sending them. Positions are sent by each
// player a few times a second while moving.
window.Factory = (() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => UI.esc(s);

  // ---------- World layout (internal pixels) ----------
  const SW = 380;                       // section width
  const SPAWNER = { x: 22, w: 40, h: 46 };
  const CONV = { x0: 62, x1: 222 };     // belt runs left → right
  const COMP = { x: 222, w: 40, h: 50 };
  const PAD = { x: 292, rx: 18 };
  const BIN = { x: 322, w: 38, h: 30 };
  const SPEED = 26;                     // belt speed px/s
  const INTERVAL = 1700;                // ms between spawns
  const RIDE = ((CONV.x1 - CONV.x0) / SPEED) * 1000;
  const WALK = 100, ACCEL = 900;
  const SLOW_SELL = 5000, FAST_SELL = 500;
  const COUNTDOWN = 3500;
  const ENERGY_GAIN = 100, DRAIN_IDLE = 5, DRAIN_WALK = 10;   // energy per correct answer / drain per second
  const TILE_COLORS = ['amber', 'teal', 'pink', 'blue', 'purple', 'green', 'orange', 'slate'];

  const ITEMS = [
    { name: 'Clay Pot', tier: 'Common', color: '#c3cdd8', value: 5, w: 54,
      map: ['..OOOO..', '...oo...', '..oooo..', '.ohoooo.', '.ohoooO.', '.ooooOO.', '..oOOO..', '...OO...'], pal: { o: '#c8743c', O: '#8a4a22', h: '#eaa36d' } },
    { name: 'Bronze Coin', tier: 'Uncommon', color: '#7bd389', value: 12, w: 26,
      map: ['..YYYY..', '.YhhyyY.', 'YhyYYyyY', 'YhyYyyyY', 'YyyYYyyY', 'YyyyyyyY', '.YyyyyY.', '..YYYY..'], pal: { y: '#d08a3c', Y: '#8a5520', h: '#f3c07a' } },
    { name: 'Oil Lamp', tier: 'Rare', color: '#4cc9f0', value: 30, w: 12.5,
      map: ['......f.', '.....rf.', '......B.', '..bbbbb.', '.bhbbbbB', 'bbbbbbB.', '.BBBBB..', '..BB....'], pal: { b: '#9fb8cf', B: '#5d7690', h: '#e3f1ff', f: '#ffd166', r: '#ff7b3a' } },
    { name: 'Gladius', tier: 'Epic', color: '#b77dff', value: 75, w: 5.3,
      map: ['.......s', '......sS', '.....sS.', '....sS..', '.g.sS...', '..gg....', '.wg.g...', 'w.......'], pal: { s: '#eef3f8', S: '#9aa7b5', g: '#ffd166', w: '#7a4a24' } },
    { name: 'Golden Aquila', tier: 'Legendary', color: '#ffb238', value: 200, w: 1.7,
      map: ['G.....G.', 'GG.gg.GG', 'gGGggGGg', '.gggggg.', '..gGGg..', '...gg...', '..g..g..', '.GGGGGG.'], pal: { g: '#ffd166', G: '#c99a12' } },
    { name: 'Orb of Jupiter', tier: 'Mythical', color: '#ff5dc8', value: 500, w: 0.5,
      map: ['..PPPP..', '.PpphhP.', 'PppphwhP', 'PpppphpP', 'PpppppPP', 'PPppPPP.', '.PPPPP..', '..ggg...'], pal: { p: '#ff5dc8', P: '#9b1d7a', h: '#ffd6f2', w: '#ffffff', g: '#ffd166' } },
  ];
  const NOTIFY_TIER = 4; // Legendary and up: everyone is told
  const TOTAL_W = ITEMS.reduce((a, it) => a + it.w, 0);

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function hash32(a, b, c) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rarityFor(seed, sec, k) {
    let r = hash32(seed, sec, k) * TOTAL_W;
    for (let i = 0; i < ITEMS.length; i++) { if ((r -= ITEMS[i].w) < 0) return i; }
    return 0;
  }
  const money = (n) => '$' + Math.round(n).toLocaleString();
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const secX = (s) => s * SW;
  const offsetFor = (s) => (s * 577) % INTERVAL;
  const spawnTime = (fx, s, k) => fx.startAt + offsetFor(s) + k * INTERVAL;

  // ---------- module state ----------
  let ctx = null;              // hooks into Game (me, send, getS, broadcast, touch)
  let active = false;
  let cv, g, tcv, tg, W = 480, H = 270, SCALE = 2, dpr = 1, groundY = 220;
  let layers = null;
  let camX = 0, last = 0;
  let clockOffset = null;      // host time - local time
  let fx = null, S = null;     // latest state
  const me = { x: 0, vx: 0, f: 1, moving: false, placed: false, sent: 0, sentX: null };
  const others = new Map();    // id -> { x, tx, f, m }
  const keys = { left: false, right: false };
  const parts = [], floaters = [];
  let pending = null;          // optimistic pickup { sec, k, item, at }
  let lastEvN = -1, prompt = null, bannerTimer = 0;
  const eaten = new Set();     // conveyor items already shown going into the compactor
  let quizOpen = false;
  const quiz = { q: null, serial: -1, locked: false, next: null, unlockTimer: 0 };
  let energyAt = { v: 0, t: 0 };  // last energy from the host, for smooth local prediction

  const now = () => Date.now() + (clockOffset || 0);   // shared game clock (host time)

  // ---------- pixel primitives ----------
  function rect(c, x, y, w, h) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function ellipse(cx, cy, rx, ry, c, gg = g) {
    gg.fillStyle = c;
    const R = Math.max(1, Math.round(ry));
    for (let y = -R; y <= R; y++) {
      const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (R * R))));
      if (hw > 0) gg.fillRect(Math.round(cx) - hw, Math.round(cy) + y, hw * 2, 1);
    }
  }
  function sprite(item, x, y, outline = '#0b1320') {
    const it = ITEMS[item]; const m = it.map;
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = outline;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      if (m[j][i] === '.') continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const a = m[j + dy] && m[j + dy][i + dx];
        if (!a || a === '.') g.fillRect(x + i + dx, y + j + dy, 1, 1);
      }
    }
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const ch = m[j][i]; if (ch === '.') continue;
      g.fillStyle = it.pal[ch]; g.fillRect(x + i, y + j, 1, 1);
    }
  }
  function text(str, x, y, color = '#fff', size = 7, align = 'center', alpha = 1, outline = true) {
    const k = SCALE * dpr, px = Math.round(size * k * 0.9);
    tg.globalAlpha = alpha;
    tg.font = `700 ${px}px 'Pixelify Sans', sans-serif`;
    tg.textAlign = align; tg.textBaseline = 'middle';
    const X = (x - camX) * k, Y = y * k;
    if (outline) { tg.lineJoin = 'round'; tg.lineWidth = Math.max(3, px * 0.24); tg.strokeStyle = '#070b12'; tg.strokeText(str, X, Y); }
    tg.fillStyle = color; tg.fillText(str, X, Y);
    tg.globalAlpha = 1;
  }

  // ---------- parallax layers (procedural pixel machinery) ----------
  function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeLayer(tw, draw) { const c = document.createElement('canvas'); c.width = tw; c.height = H; draw(c.getContext('2d'), mulberry(tw * 7 + H)); return c; }
  function buildLayers() {
    const sky = makeLayer(4, (c) => {
      const stops = ['#121a29', '#162034', '#1a263b', '#1d2a40', '#202e45'];
      for (let y = 0; y < H; y++) { c.fillStyle = stops[Math.min(stops.length - 1, Math.floor((y / H) * stops.length))]; c.fillRect(0, y, 4, 1); }
    });
    // far: tanks, chimneys and lit windows
    const far = makeLayer(520, (c, r) => {
      const base = groundY - 6;
      for (let i = 0; i < 9; i++) {
        const x = r() * 520, w = 30 + r() * 50, h = 50 + r() * (H * 0.45);
        const col = ['#1f2a3e', '#222f45', '#1c2639'][i % 3];
        c.fillStyle = col; c.fillRect(Math.round(x), Math.round(base - h), Math.round(w), Math.round(h));
        c.fillRect(Math.round(x + 2), Math.round(base - h - 3), Math.round(w - 4), 3);
        c.fillStyle = 'rgba(255,200,90,.16)';
        for (let wy = base - h + 8; wy < base - 10; wy += 10) for (let wx = x + 5; wx < x + w - 6; wx += 9) if (r() < 0.45) c.fillRect(Math.round(wx), Math.round(wy), 3, 4);
      }
      for (let i = 0; i < 4; i++) {
        const x = r() * 520, h = H * 0.5 + r() * H * 0.25;
        c.fillStyle = '#1a2335'; c.fillRect(Math.round(x), Math.round(base - h), 10, Math.round(h));
        c.fillStyle = '#2a3650'; c.fillRect(Math.round(x - 1), Math.round(base - h), 12, 3); c.fillRect(Math.round(x - 1), Math.round(base - h + 12), 12, 2);
      }
    });
    // mid: pipes, vats, catwalk
    const mid = makeLayer(560, (c, r) => {
      const cw = Math.round(H * 0.38);
      c.fillStyle = '#2a3549'; c.fillRect(0, cw, 560, 3);
      for (let x = 0; x < 560; x += 14) c.fillRect(x, cw - 9, 2, 9);
      c.fillRect(0, cw - 9, 560, 2);
      for (let i = 0; i < 3; i++) {
        const y = Math.round(H * (0.18 + i * 0.13 + r() * 0.04)), th = 5 + Math.round(r() * 4);
        c.fillStyle = '#2d3a51'; c.fillRect(0, y, 560, th);
        c.fillStyle = '#3c4b66'; c.fillRect(0, y, 560, 1);
        c.fillStyle = '#243046'; for (let x = Math.round(r() * 40); x < 560; x += 46) c.fillRect(x, y - 2, 4, th + 4);
      }
      for (let i = 0; i < 4; i++) {
        const x = Math.round(30 + i * 140 + r() * 40), w = 34 + Math.round(r() * 16), top = Math.round(groundY - 70 - r() * 30);
        c.fillStyle = '#2b374d'; c.fillRect(x, top, w, groundY - top);
        c.fillStyle = '#36445e'; c.fillRect(x, top, w, 2); c.fillRect(x + 2, top + 2, 3, groundY - top - 2);
        c.fillStyle = i % 2 ? '#2ec4b6' : '#7bd389'; c.globalAlpha = 0.5; c.fillRect(x + w / 2 - 4, top + 10, 8, 20); c.globalAlpha = 1;
        c.fillStyle = '#1d2738'; c.fillRect(x + w / 2 - 5, top + 9, 10, 1); c.fillRect(x + w / 2 - 5, top + 30, 10, 1);
      }
      for (let i = 0; i < 5; i++) { const x = Math.round(r() * 560); c.fillStyle = '#28344a'; c.fillRect(x, cw + 3, 5, groundY - cw - 3); }
    });
    // near: big pipes, hooks on chains, gauges
    const near = makeLayer(600, (c, r) => {
      for (let i = 0; i < 2; i++) {
        const y = Math.round(H * (0.08 + i * 0.08)), th = 9;
        c.fillStyle = '#34425a'; c.fillRect(0, y, 600, th);
        c.fillStyle = '#4a5b78'; c.fillRect(0, y + 1, 600, 2);
        c.fillStyle = '#28334a'; c.fillRect(0, y + th - 2, 600, 2);
        for (let x = Math.round(r() * 60); x < 600; x += 70) { c.fillStyle = '#2a3549'; c.fillRect(x, y - 2, 5, th + 4); }
      }
      for (let i = 0; i < 4; i++) {
        const x = Math.round(40 + i * 150 + r() * 60), len = Math.round(H * (0.2 + r() * 0.15));
        c.fillStyle = '#3a4760'; for (let y = Math.round(H * 0.24); y < H * 0.24 + len; y += 3) c.fillRect(x, y, 2, 2);
        const hy = Math.round(H * 0.24 + len);
        c.fillRect(x - 2, hy, 6, 2); c.fillRect(x + 2, hy + 2, 2, 4); c.fillRect(x - 1, hy + 5, 4, 2);
      }
      for (let i = 0; i < 3; i++) {
        const x = Math.round(80 + i * 200 + r() * 40), y = Math.round(H * 0.3 + r() * 20);
        ellipse(x, y, 7, 7, '#3d4c66', c); ellipse(x, y, 5, 5, '#d8e2ec', c);
        c.fillStyle = '#e2453c'; c.fillRect(x, y - 3, 1, 4);
      }
    });
    // foreground: girders on top, railing + pipe bundle at the bottom
    const fg = makeLayer(640, (c, r) => {
      c.fillStyle = '#0a0f18';
      c.fillRect(0, 0, 640, 7); c.fillRect(0, 7, 640, 2);
      for (let x = 0; x < 640; x += 32) { c.fillRect(x, 7, 3, 8); c.fillRect(x + 3, 9, 1, 1); }
      for (let i = 0; i < 3; i++) {
        const x = Math.round(60 + i * 210 + r() * 40);
        c.fillRect(x, 9, 2, 16); c.fillRect(x - 6, 25, 14, 4); c.fillStyle = 'rgba(255,190,90,.35)'; c.fillRect(x - 5, 29, 12, 2); c.fillStyle = '#0a0f18';
      }
      const by = H - 6;
      c.fillRect(0, by, 640, 6);
      c.fillStyle = '#121a27'; c.fillRect(0, by - 4, 640, 4); c.fillStyle = '#0a0f18';
      for (let x = Math.round(r() * 30); x < 640; x += 58) { c.fillRect(x, by - 12, 3, 12); c.fillRect(x - 1, by - 13, 5, 2); }
    });
    layers = { sky, far, mid, near, fg };
  }
  function drawLayer(c, factor, alpha = 1) {
    const tw = c.width;
    let off = -((camX * factor) % tw); if (off > 0) off -= tw;
    g.globalAlpha = alpha;
    for (let x = Math.round(off); x < W; x += tw) g.drawImage(c, x, 0);
    g.globalAlpha = 1;
  }

  // ---------- section drawing ----------
  function ownerOf(sec) { if (!fx) return null; for (const id in fx.sec) if (fx.sec[id] === sec) return id; return null; }
  function player(id) { return S ? S.players.find((p) => p.id === id) : null; }
  function colorOf(id) { const p = player(id); return p ? Scene.COLORS[p.look.c] || '#fff' : '#888'; }

  function drawFloor() {
    const top = groundY;
    rect('#3a4456', 0, top, W, H - top);
    rect('#56627a', 0, top, W, 1);
    rect('#2c3444', 0, top + 1, W, 1);
    const off = Math.floor(-camX) % 24;
    for (let x = off - 24; x < W; x += 24) { rect('#323b4c', x, top + 2, 1, H - top); rect('#4a556a', x + 4, top + 5, 1, 1); rect('#4a556a', x + 18, top + 5, 1, 1); }
  }

  function drawSection(s, t) {
    const X = secX(s) - camX;
    if (X > W + 10 || X + SW < -10) return;
    const owner = ownerOf(s), oc = owner ? colorOf(owner) : '#5f7f98';
    const live = fx && fx.startAt && now() >= fx.startAt && S.phase === 'play';
    // back panel + owner stripe
    g.globalAlpha = 0.35; rect('#0d1422', X + 10, groundY - 86, SW - 20, 86); g.globalAlpha = 1;
    rect(oc, X + 10, groundY - 87, SW - 20, 2);
    // divider post with hazard stripes
    for (let y = groundY - 92; y < groundY; y += 6) { rect((Math.floor(y / 6) % 2) ? '#ffd166' : '#14141f', X + SW - 5, y, 5, 6); }
    // spawner
    const sx = X + SPAWNER.x, sy = groundY - SPAWNER.h;
    rect('#0b1320', sx - 1, sy - 1, SPAWNER.w + 2, SPAWNER.h + 1);
    rect('#7b889c', sx, sy, SPAWNER.w, SPAWNER.h); rect('#98a5b8', sx, sy, SPAWNER.w, 2); rect('#5d6a7e', sx + SPAWNER.w - 3, sy, 3, SPAWNER.h);
    rect('#5d6a7e', sx + 6, sy - 8, SPAWNER.w - 12, 8); rect('#98a5b8', sx + 6, sy - 8, SPAWNER.w - 12, 1);
    rect('#14141f', sx + SPAWNER.w - 8, groundY - 30, 8, 12);
    const blink = live && ((now() - fx.startAt - offsetFor(s)) % INTERVAL) < 300;
    rect(blink ? '#7bd389' : '#2f5a3b', sx + 6, sy + 6, 4, 4);
    for (const [rx, ry] of [[3, 14], [3, 38], [SPAWNER.w - 7, 14]]) rect('#5d6a7e', sx + rx, sy + ry, 1, 1);
    // conveyor
    const cy = groundY - 22, x0 = X + CONV.x0, x1 = X + CONV.x1;
    for (let lx = x0 + 6; lx < x1; lx += 26) { rect('#2c3444', lx, cy + 6, 3, groundY - cy - 6); }
    rect('#0b1320', x0, cy - 1, x1 - x0, 8);
    rect('#4a566b', x0, cy, x1 - x0, 6);
    rect('#2a3140', x0, cy, x1 - x0, 2);
    const shift = live ? Math.floor(((now() - fx.startAt) / 1000) * SPEED) % 6 : 0;
    for (let bx = x0 + shift; bx < x1; bx += 6) rect('#1c222d', bx, cy, 2, 2);
    ellipse(x0 + 2, cy + 3, 3, 3, '#6b7a8f'); ellipse(x1 - 2, cy + 3, 3, 3, '#6b7a8f');
    // conveyor items
    if (live) drawBeltItems(s, X, cy, t);
    // compactor
    const cx = X + COMP.x, cyy = groundY - COMP.h;
    const pump = Math.round(Math.abs(Math.sin(t / 260)) * 5);
    rect('#5d6a7e', cx + 12, cyy - 12 + pump, 16, 12 - pump); rect('#98a5b8', cx + 14, cyy - 16, 12, 4);
    rect('#0b1320', cx - 1, cyy - 1, COMP.w + 2, COMP.h + 1);
    rect('#6f7c90', cx, cyy, COMP.w, COMP.h); rect('#8c99ad', cx, cyy, COMP.w, 2); rect('#55627a', cx + COMP.w - 3, cyy, 3, COMP.h);
    rect('#08090d', cx, groundY - 32, 12, 16);
    for (let ty = groundY - 32; ty < groundY - 16; ty += 4) rect('#c3cdd8', cx + 10, ty, 2, 2);
    rect(Math.floor(t / 400) % 2 ? '#e2453c' : '#6a1d1d', cx + COMP.w - 10, cyy + 5, 4, 4);
    // holo sell pad
    drawPad(s, X + PAD.x, owner, t);
    // sell bin
    drawBin(s, X + BIN.x, owner, t);
    // signs (text layer)
    const p = owner && player(owner);
    text(p ? `${p.name}'s factory` : 'Empty section', secX(s) + SW / 2, groundY - 96, oc, 7);
    text('SELL', secX(s) + BIN.x + BIN.w / 2 - 1, groundY - BIN.h + 14.5, '#3a2600', 6, 'center', 1, false);
  }

  function drawBeltItems(s, X, cy, t) {
    const T = now();
    const kMax = Math.floor((T - fx.startAt - offsetFor(s)) / INTERVAL);
    const kMin = Math.max(0, Math.floor((T - fx.startAt - offsetFor(s) - RIDE) / INTERVAL));
    const taken = new Set((fx.taken && fx.taken[s]) || []);
    for (let k = kMin; k <= kMax; k++) {
      if (taken.has(k) || (pending && pending.sec === s && pending.k === k)) continue;
      const age = T - spawnTime(fx, s, k);
      if (age < 0 || age > RIDE) {
        const key = s + ':' + k;
        if (age > RIDE && age < RIDE + 400 && !eaten.has(key)) { eaten.add(key); burst(secX(s) + COMP.x + 4, cy - 4, 6, ['#c3cdd8', '#ffd166'], 30); }
        continue;
      }
      const item = rarityFor(fx.seed, s, k);
      const ix = X + CONV.x0 + (age / 1000) * SPEED;
      if (item >= 2) { g.globalAlpha = 0.25 + 0.1 * Math.sin(t / 200 + k); ellipse(ix, cy - 5, 7, 6, ITEMS[item].color); g.globalAlpha = 1; }
      if (item >= 3 && Math.random() < 0.06) parts.push({ x: ix + camX - 4 + Math.random() * 8, y: cy - 10, vx: 0, vy: -12, life: 0, max: 0.7, c: ITEMS[item].color, s: 1 });
      sprite(item, ix - 4, cy - 9);
    }
  }

  function drawPad(s, px, owner, t) {
    const on = owner && posOf(owner) != null && Math.abs(posOf(owner) - (secX(s) + PAD.x)) < PAD.rx - 2;
    ellipse(px, groundY - 1, PAD.rx + 2, 5, '#0b1320');
    ellipse(px, groundY - 1, PAD.rx, 4, on ? '#ffe08a' : '#e0a93a');
    ellipse(px, groundY - 2, PAD.rx - 4, 2, on ? '#fff3c4' : '#ffd166');
    // rotating dashed ring + rising holo beams
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + t / (on ? 180 : 600);
      if (i % 2) continue;
      rect('#fff3c4', px + Math.cos(a) * (PAD.rx - 1), groundY - 1 + Math.sin(a) * 4, 2, 1);
    }
    for (let i = -2; i <= 2; i++) {
      const h = Math.round(16 + Math.sin(t / 300 + i * 1.7) * 6 + (on ? 12 : 0));
      for (let y = 0; y < h; y++) {
        g.globalAlpha = (on ? 0.5 : 0.24) * (1 - y / h);
        rect(i % 2 ? '#fff3c4' : '#ffd166', px + i * 6, groundY - 3 - y, 1, 1);
      }
    }
    g.globalAlpha = 1;
    if (Math.random() < (on ? 0.4 : 0.08)) parts.push({ x: px + camX + (Math.random() - 0.5) * PAD.rx * 1.6, y: groundY - 3, vx: 0, vy: -18 - Math.random() * 14, g: 0, life: 0, max: 0.9, c: '#ffe08a', s: 1 });
    if (on) text('FAST SELL', px + camX, groundY - 34, '#ffd166', 5);
  }

  function drawBin(s, bx, owner, t) {
    const by = groundY - BIN.h;
    const bin = (fx && owner && fx.bins[owner]) || [];
    rect('#0b1320', bx - 1, by - 1, BIN.w + 2, BIN.h + 1);
    rect('#2f6f5c', bx, by, BIN.w, BIN.h); rect('#3f8f75', bx, by, BIN.w, 2); rect('#245446', bx + BIN.w - 3, by, 3, BIN.h);
    for (let x = bx + 6; x < bx + BIN.w - 4; x += 8) rect('#245446', x, by + 6, 1, BIN.h - 8);
    // items peeking out of the top
    bin.slice(-3).forEach((it, i) => sprite(it, bx + 4 + i * 10, by - 6));
    // SELL label painted on the front of the bin
    rect('#0b1320', bx + 4, by + 9, BIN.w - 8, 11); rect('#ffd166', bx + 5, by + 10, BIN.w - 10, 9);
    // progress to next sale
    if (fx && owner && bin.length && fx.nextSell && fx.nextSell[owner]) {
      const span = fx.fast && fx.fast[owner] ? FAST_SELL : SLOW_SELL;
      const p = clamp(1 - (fx.nextSell[owner] - now()) / span, 0, 1);
      rect('#0b1320', bx, groundY + 3, BIN.w, 4); rect('#7bd389', bx + 1, groundY + 4, (BIN.w - 2) * p, 2);
    }
    if (bin.length) text('x' + bin.length, secX(s) + BIN.x + BIN.w + 2, by - 2, '#ffffff', 5, 'left');
  }

  // ---------- players ----------
  function posOf(id) {
    if (ctx && id === ctx.me.id && me.placed) return me.x;
    const o = others.get(id); return o ? o.x : null;
  }
  function heldOf(id) {
    if (ctx && id === ctx.me.id && pending && now() - pending.at < 1500) return pending.item;
    return fx && fx.held ? fx.held[id] : null;
  }
  function drawPlayer(p, x, moving, t, isMe) {
    const sx = x - camX;
    if (sx < -30 || sx > W + 30) return;
    ellipse(sx, groundY, 7, 2, 'rgba(0,0,0,.35)');
    const bob = moving ? (Math.floor(t / 120) % 2) : Math.floor((t + p.id.length * 97) / 450) % 2;
    const ice = frozen(p.id);
    Scene.drawCharacter(g, sx, groundY, p.look, { bob: ice ? 0 : bob });
    if (ice) {
      g.globalAlpha = 0.45; rect('#bfe9ff', sx - 9, groundY - 19, 18, 19); g.globalAlpha = 0.9;
      rect('#e6f7ff', sx - 9, groundY - 19, 18, 1); rect('#e6f7ff', sx - 9, groundY - 19, 1, 19); rect('#7fc8e8', sx + 8, groundY - 19, 1, 19); rect('#7fc8e8', sx - 9, groundY - 1, 18, 1);
      rect('#ffffff', sx - 6, groundY - 16, 2, 1); rect('#ffffff', sx - 6, groundY - 15, 1, 2);
      g.globalAlpha = 1;
    }
    const held = heldOf(p.id);
    if (held != null) {
      const it = ITEMS[held];
      if (held >= 2) { g.globalAlpha = 0.3 + 0.15 * Math.sin(t / 150); ellipse(sx, groundY - 26, 8, 7, it.color); g.globalAlpha = 1; }
      sprite(held, sx - 4, groundY - 30 - (Math.floor(t / 300) % 2));
      text(it.tier.toUpperCase(), x, groundY - 38, it.color, 5);
      text(p.name, x, groundY - 46, isMe ? '#ffd166' : '#fff', 6);
    } else text(p.name, x, groundY - 26, isMe ? '#ffd166' : '#fff', 6);
    if (ice) text('FROZEN', x, groundY - (held != null ? 54 : 34), '#9fe3ff', 5);
  }

  // ---------- effects ----------
  function burst(x, y, n, colors, sp = 50) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.4, g: 120, life: 0, max: 0.5 + Math.random() * 0.5, c: colors[i % colors.length], s: 1 }); }
  }
  function floatText(x, y, str, color, size = 7) { floaters.push({ x, y, str, color, size, t0: performance.now() }); }
  function banner(html, ms = 3200) {
    const b = $('#fxBanner'); b.innerHTML = html; b.hidden = false;
    b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.hidden = true), ms);
  }

  // ---------- energy ----------
  function gameLive() { return !!(fx && S && S.phase === 'play' && fx.startAt && now() >= fx.startAt); }
  function serverEnergy(id) { return fx && fx.energy ? fx.energy[id] || 0 : 0; }
  function frozen(id) { return gameLive() && fx.energy && (fx.energy[id] || 0) <= 0; }
  function myEnergy() {
    if (!gameLive()) return serverEnergy(ctx.me.id);
    const el = (performance.now() - energyAt.t) / 1000;
    return Math.max(0, energyAt.v - el * (me.moving ? DRAIN_WALK : DRAIN_IDLE));
  }
  function renderEnergy() {
    const e = myEnergy(), live = gameLive(), playing = amPlaying();
    const out = live && serverEnergy(ctx.me.id) <= 0;
    for (const el of [$('#fxEnergy'), $('#fxqEnergy')]) {
      el.querySelector('i').style.width = Math.min(100, e) + '%';
      el.querySelector('b').textContent = Math.ceil(e);
      el.classList.toggle('low', e < 25 && !out);
      el.classList.toggle('out', out);
    }
    $('#fxEnergy').hidden = !playing;
    $('#fxQBtn').hidden = !playing || S.phase !== 'play';
    $('#fxQBtn').classList.toggle('urgent', live && e < 25);
  }

  // ---------- questions (full-screen, multiple choice) ----------
  const decQ = (x) => { try { return JSON.parse(decodeURIComponent(escape(atob(x)))); } catch (e) { return null; } };
  function openQuiz() {
    if (!amPlaying() || S.phase !== 'play' || quizOpen) return;
    quizOpen = true; keys.left = keys.right = false;
    const el = $('#fxQuiz'); el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    if (!quiz.q && !quiz.next) { showLoading(); ctx.send({ t: 'fx-q', from: ctx.me.id }); }
    else if (!quiz.locked && quiz.next) showQuestion();
  }
  function closeQuiz() { quizOpen = false; $('#fxQuiz').hidden = true; }
  function toggleQuiz() { quizOpen ? closeQuiz() : openQuiz(); }
  function showLoading() {
    $('#fxqTag').hidden = true; $('#fxqText').textContent = 'Loading a question…'; $('#fxqFocus').textContent = '';
    $('#fxqChoices').innerHTML = ''; $('#fxqFeedback').textContent = '';
  }
  function onQuestion(m) {
    if (!ctx || m.id !== ctx.me.id) return;
    const q = decQ(m.qx); if (!q) return;
    quiz.next = { ...q, serial: m.serial };
    if (!quiz.locked) showQuestion();
  }
  function showQuestion() {
    if (!quiz.next) return;
    quiz.q = quiz.next; quiz.next = null; quiz.serial = quiz.q.serial; quiz.locked = false;
    const q = quiz.q;
    $('#fxqTag').textContent = q.tag || ''; $('#fxqTag').hidden = !q.tag;
    $('#fxqText').textContent = q.q; $('#fxqFocus').textContent = q.focus || '';
    $('#fxqFeedback').textContent = ''; $('#fxqFeedback').className = 'quiz-feedback';
    $('#fxqChoices').innerHTML = q.choices.map((c, i) => `<button class="tile ${TILE_COLORS[i % TILE_COLORS.length]}" data-i="${i}"><span class="key">${i + 1}</span><span class="txt">${esc(c)}</span></button>`).join('');
    $('#fxqChoices').dataset.n = q.choices.length;
    const card = $('#fxqCard'); card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
  }
  function answer(i) {
    if (!quiz.q || quiz.locked || i >= quiz.q.choices.length) return;
    quiz.locked = true;
    const tile = $(`#fxqChoices .tile[data-i="${i}"]`); if (tile) tile.classList.add('chosen');
    $('#fxqChoices').classList.add('locked');
    ctx.send({ t: 'fx-ans', from: ctx.me.id, serial: quiz.serial, choice: i });
    clearTimeout(quiz.unlockTimer);
    quiz.unlockTimer = setTimeout(() => { quiz.locked = false; $('#fxqChoices').classList.remove('locked'); showQuestion(); }, 4000); // safety net
  }
  function onAnswerResult(ev) {
    if (!quiz.q) return;
    const tiles = [...document.querySelectorAll('#fxqChoices .tile')];
    tiles.forEach((t) => { const txt = quiz.q.choices[Number(t.dataset.i)]; if (txt === ev.right) t.classList.add('right'); else if (Number(t.dataset.i) === ev.pick) t.classList.add('wrong'); });
    const fb = $('#fxqFeedback');
    if (ev.ok) { fb.innerHTML = `+${ENERGY_GAIN} <span>⚡</span> energy!`; fb.className = 'quiz-feedback good'; energyAt = { v: myEnergy() + ENERGY_GAIN, t: performance.now() }; }
    else { fb.innerHTML = `Not quite. The answer was <b>${esc(ev.right)}</b>`; fb.className = 'quiz-feedback bad'; }
    clearTimeout(quiz.unlockTimer);
    quiz.unlockTimer = setTimeout(() => { quiz.locked = false; $('#fxqChoices').classList.remove('locked'); showQuestion(); }, ev.ok ? 750 : 1600);
  }

  // ---------- input & interaction ----------
  function typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  function onKey(e, down) {
    if (!active) return;
    if (down && !e.repeat && quizOpen) {
      if (/^[1-9]$/.test(e.key)) { answer(Number(e.key) - 1); e.preventDefault(); return; }
      if (e.key === 'Escape') { closeQuiz(); e.preventDefault(); return; }
    }
    if (typing()) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (down && !e.repeat) toggleQuiz(); return; }
    if (quizOpen) return;
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'arrowleft') { keys.left = down; e.preventDefault(); }
    else if (k === 'd' || k === 'arrowright') { keys.right = down; e.preventDefault(); }
    else if (k === 'e' && down && !e.repeat) { interact(); e.preventDefault(); }
  }
  function mySection() { return fx && ctx ? fx.sec[ctx.me.id] : undefined; }
  function amPlaying() { return S && ctx && S.players.some((p) => p.id === ctx.me.id) && mySection() != null; }

  // What would E do right now?
  function findAction() {
    if (!amPlaying() || !fx || S.phase !== 'play' || now() < fx.startAt) return null;
    const id = ctx.me.id, x = me.x, held = heldOf(id);
    const ownSec = mySection();
    if (frozen(id)) return { type: 'frozen' };
    if (held == null) {
      // dropped items on the floor (anyone can grab)
      let fl = null, fd = 16;
      for (const it of fx.floor || []) { const d = Math.abs(it.x - x); if (d < fd) { fd = d; fl = it; } }
      if (fl) return { type: 'grab', fid: fl.fid, item: fl.item };
      // own conveyor
      const X = secX(ownSec);
      if (x > X + CONV.x0 - 12 && x < X + CONV.x1 + 6) {
        const T = now(), taken = new Set(fx.taken[ownSec] || []);
        const kMax = Math.floor((T - fx.startAt - offsetFor(ownSec)) / INTERVAL);
        let best = null, bd = 16;
        for (let k = Math.max(0, kMax - 12); k <= kMax; k++) {
          if (taken.has(k)) continue;
          const age = T - spawnTime(fx, ownSec, k); if (age < 0 || age > RIDE) continue;
          const ix = X + CONV.x0 + (age / 1000) * SPEED, d = Math.abs(ix - x);
          if (d < bd) { bd = d; best = { k, item: rarityFor(fx.seed, ownSec, k) }; }
        }
        if (best) return { type: 'pick', ...best, sec: ownSec };
      }
      // someone else's bin
      for (const oid in fx.sec) {
        if (oid === id) continue;
        const bx = secX(fx.sec[oid]) + BIN.x + BIN.w / 2;
        if (Math.abs(x - bx) < 26) {
          const n = (fx.bins[oid] || []).length, p = player(oid);
          return n ? { type: 'steal', from: oid, name: p ? p.name : 'their' } : { type: 'emptyBin', name: p ? p.name : 'Their' };
        }
      }
    } else {
      const bx = secX(ownSec) + BIN.x + BIN.w / 2;
      if (Math.abs(x - bx) < 26) return { type: 'drop', item: held };
      const X = secX(ownSec);
      if (x > X + CONV.x0 - 12 && x < X + CONV.x1 + 6) return { type: 'full' };
    }
    return null;
  }
  function interact() {
    const a = findAction(); if (!a) return;
    if (a.type === 'pick') { pending = { sec: a.sec, k: a.k, item: a.item, at: now() }; ctx.send({ t: 'fx-pick', from: ctx.me.id, sec: a.sec, k: a.k }); burst(me.x, groundY - 22, 8, ['#ffffff', ITEMS[a.item].color], 40); }
    else if (a.type === 'drop') ctx.send({ t: 'fx-drop', from: ctx.me.id, x: me.x });
    else if (a.type === 'steal') ctx.send({ t: 'fx-steal', from: ctx.me.id, victim: a.from, x: me.x });
    else if (a.type === 'grab') ctx.send({ t: 'fx-grab', from: ctx.me.id, fid: a.fid, x: me.x });
    else if (a.type === 'frozen') openQuiz();
  }
  function renderPrompt() {
    const a = findAction(), el = $('#fxPrompt');
    const key = a ? a.type + (a.k != null ? a.k : '') + (a.from || '') + (a.fid || '') : '';
    if (key === prompt) return; prompt = key;
    if (!a) { el.hidden = true; return; }
    const it = a.item != null ? ITEMS[a.item] : null;
    const label = {
      pick: () => `Pick up <b style="color:${it.color}">${esc(it.name)}</b> <small>${it.tier}</small>`,
      drop: () => `Drop <b style="color:${it.color}">${esc(it.name)}</b> in your bin`,
      steal: () => `Steal from <b>${esc(a.name)}</b>’s bin`,
      emptyBin: () => `${esc(a.name)}’s bin is empty`,
      full: () => 'Your hands are full. Drop it in your bin first',
      grab: () => `Pick up <b style="color:${it.color}">${esc(it.name)}</b> <small>${it.tier} · on the floor</small>`,
      frozen: () => 'Out of energy! Answer questions to move again',
    }[a.type]();
    const showKey = ['pick', 'drop', 'steal', 'grab'].includes(a.type);
    el.innerHTML = `${showKey ? '<kbd>E</kbd>' : a.type === 'frozen' ? '<kbd>Space</kbd>' : ''}<span>${label}</span>`;
    el.classList.toggle('alert', a.type === 'frozen');
    el.classList.toggle('muted', !showKey);
    el.hidden = false;
  }

  // ---------- networking (client side) ----------
  // Positions use "dead reckoning": send where you are and which way you're walking only when
  // that changes (start / stop / turn), plus a 1-second correction while walking. Everyone else
  // predicts the movement in between, so a walking player sends ~1-2 messages a second, not 5+.
  function sendPos() {
    if (!S || !S.players.some((p) => p.id === ctx.me.id) || mySection() == null) return;
    const t = performance.now(), v = me.dir * WALK;
    const changed = v !== me.sentV, heartbeat = v !== 0 && t - me.sent > 1000;
    if (!changed && !heartbeat) return;
    me.sent = t; me.sentV = v;
    ctx.send({ t: 'pos', id: ctx.me.id, x: Math.round(me.x * 10) / 10, v, f: me.f });
  }
  function onPos(m) {
    if (!ctx || m.id === ctx.me.id) return;
    const v = m.v != null ? m.v : m.m ? WALK * (m.f || 1) : 0;
    let o = others.get(m.id);
    if (!o) { o = { x: m.x }; others.set(m.id, o); }
    Object.assign(o, { bx: m.x, v, at: performance.now(), f: m.f, m: v !== 0 });
    if (ctx.me.host) hostPos.set(m.id, { x: m.x, v, at: performance.now() });
  }
  const worldW = () => Math.max(1, fx ? Object.keys(fx.sec).length : 1) * SW;
  const extrapolate = (bx, v, at) => clamp(bx + v * Math.min(1.5, (performance.now() - at) / 1000), 8, worldW() - 8);

  function handleEvents() {
    if (!fx || !fx.evs) return;
    const evs = fx.evs;
    if (lastEvN === -1) { lastEvN = evs.length ? evs[evs.length - 1].n : 0; return; }
    for (const ev of evs) {
      if (ev.n <= lastEvN) continue;
      lastEvN = ev.n;
      const p = player(ev.id), it = ev.item != null ? ITEMS[ev.item] : null;
      if (ev.type === 'sold') {
        const s = fx.sec[ev.id]; if (s == null) continue;
        const bx = secX(s) + BIN.x + BIN.w / 2;
        floatText(bx, groundY - BIN.h - 14, '+' + money(it.value), it.color, ev.item >= 4 ? 10 : 7);
        burst(bx, groundY - BIN.h - 4, ev.item >= 3 ? 14 : 6, ['#ffd166', it.color], 45);
      } else if (ev.type === 'pick') {
        if (ev.id === ctx.me.id) pending = null;
        if (ev.item >= NOTIFY_TIER) {
          const who = ev.id === ctx.me.id ? 'You' : esc(p ? p.name : 'Someone');
          banner(`✨ ${who} picked up a <b style="color:${it.color}">${it.tier.toUpperCase()}</b> ${esc(it.name)}!`);
        }
      } else if (ev.type === 'pickFail') {
        if (ev.id === ctx.me.id) { pending = null; prompt = null; }
      } else if (ev.type === 'drop') {
        const s = fx.sec[ev.id]; if (s != null) burst(secX(s) + BIN.x + BIN.w / 2, groundY - BIN.h, 6, ['#9aa7b8', '#ffffff'], 30);
      } else if (ev.type === 'steal') {
        const v = player(ev.victim), s = fx.sec[ev.victim];
        if (s != null) floatText(secX(s) + BIN.x + BIN.w / 2, groundY - BIN.h - 26, 'STOLEN!', '#ff5d5d', 8);
        if (ev.victim === ctx.me.id) banner(`🦝 <b>${esc(p ? p.name : 'Someone')}</b> stole a <b style="color:${it.color}">${it.tier}</b> ${esc(it.name)} from your bin!`);
        else if (ev.id === ctx.me.id) banner(`You grabbed a <b style="color:${it.color}">${it.tier}</b> ${esc(it.name)} from ${esc(v ? v.name : 'their')}’s bin`);
      } else if (ev.type === 'ans') {
        if (ev.id === ctx.me.id) onAnswerResult(ev);
        const x = posOf(ev.id);
        if (ev.ok && x != null) { floatText(x, groundY - 40, `+${ENERGY_GAIN}⚡`, '#ffd166', 7); burst(x, groundY - 12, 10, ['#ffd166', '#fff3c4'], 40); }
      } else if (ev.type === 'drained' || ev.type === 'frozen') {
        const x = posOf(ev.id);
        if (x != null) { floatText(x, groundY - 40, ev.type === 'drained' ? 'DROPPED!' : 'FROZEN!', '#9fe3ff', 7); burst(x, groundY - 10, 12, ['#bfe9ff', '#ffffff'], 40); }
        if (ev.id === ctx.me.id) banner(ev.type === 'drained' ? `❄️ Out of energy! You dropped your <b style="color:${it.color}">${esc(it.name)}</b>. Anyone can grab it. Press <kbd>Space</kbd> to answer questions.` : '❄️ Out of energy! Press <kbd>Space</kbd> to answer questions and move again.', 4500);
      } else if (ev.type === 'grab') {
        if (ev.from && ev.from === ctx.me.id && ev.id !== ctx.me.id) banner(`<b>${esc(p ? p.name : 'Someone')}</b> grabbed the <b style="color:${it.color}">${esc(it.name)}</b> you dropped!`);
      } else if (ev.type === 'over') {
        const playing = S.players.some((q) => q.id === ctx.me.id);
        if (playing) { Store.bump('games'); if (ev.id === ctx.me.id) Store.bump('wins'); }
      }
    }
  }

  // ---------- HUD ----------
  function renderHud() {
    if (!fx || !S) return;
    const list = S.players.slice().sort((a, b) => (fx.money[b.id] || 0) - (fx.money[a.id] || 0));
    $('#fxBoard').innerHTML = list.slice(0, 8).map((p, i) => `<li class="${p.id === ctx.me.id ? 'me' : ''}${p.gone ? ' gone' : ''}"><span class="rank">${i + 1}</span><span class="dot" style="background:${Scene.COLORS[p.look.c]}"></span><span class="nm">${esc(p.name)}</span><b>${money(fx.money[p.id] || 0)}</b></li>`).join('');
    if (fx.winMode === 'money') {
      const top = list.length ? fx.money[list[0].id] || 0 : 0;
      $('#fxGoal').innerHTML = `<span>First to ${money(fx.goal)}</span><i style="width:${clamp((top / fx.goal) * 100, 0, 100)}%"></i>`;
    } else $('#fxGoal').innerHTML = '';
  }
  function statusText(s) {
    const f = s.fx;
    if (s.phase === 'lobby') return 'Lobby';
    if (s.phase === 'over') return 'Game over';
    if (!f || !f.startAt) return 'Starting';
    const T = now();
    if (T < f.startAt) return 'Starting…';
    if (f.winMode === 'time') { const left = Math.max(0, f.endAt - T); return `⏱ ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left`; }
    return `Goal ${money(f.goal)}`;
  }
  function drawMinimap() {
    const c = $('#fxMini'); if (!c || !fx) return;
    const n = Math.max(1, Object.keys(fx.sec).length), world = n * SW;
    const cw = c.clientWidth, ch = c.clientHeight;
    const k = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(cw * k)) { c.width = Math.round(cw * k); c.height = Math.round(ch * k); }
    const m = c.getContext('2d'); m.setTransform(k, 0, 0, k, 0, 0);
    m.clearRect(0, 0, cw, ch);
    const sx = (x) => 4 + (x / world) * (cw - 8);
    for (const id in fx.sec) {
      const s = fx.sec[id], x0 = sx(secX(s)), x1 = sx(secX(s) + SW);
      m.fillStyle = colorOf(id); m.globalAlpha = 0.22; m.fillRect(x0, 6, x1 - x0 - 1, ch - 12); m.globalAlpha = 1;
      m.fillRect(x0, ch - 7, x1 - x0 - 1, 2);
      m.fillStyle = '#ffd166'; m.fillRect(sx(secX(s) + BIN.x), ch - 13, 3, 4);
    }
    // viewport
    m.strokeStyle = 'rgba(255,255,255,.55)'; m.lineWidth = 1;
    m.strokeRect(sx(camX) + 0.5, 3.5, Math.max(4, sx(camX + W) - sx(camX)), ch - 7);
    // player dots
    for (const p of S.players) {
      const x = posOf(p.id); if (x == null || p.gone) continue;
      m.fillStyle = '#070b12'; m.fillRect(sx(x) - 3, ch / 2 - 3, 6, 6);
      m.fillStyle = Scene.COLORS[p.look.c]; m.fillRect(sx(x) - 2, ch / 2 - 2, 4, 4);
      if (p.id === ctx.me.id) { m.fillStyle = '#fff'; m.fillRect(sx(x) - 1, ch / 2 - 6, 2, 2); }
    }
  }

  // ---------- frame loop ----------
  function update(dt) {
    const playing = S && S.players.some((p) => p.id === ctx.me.id) && mySection() != null;
    const n = Math.max(1, fx ? Object.keys(fx.sec).length : 1), world = n * SW;
    if (playing) {
      if (!me.placed) { me.x = secX(mySection()) + SW / 2; me.placed = true; }
      const canMove = !quizOpen && !frozen(ctx.me.id);
      const dir = canMove ? (keys.right ? 1 : 0) - (keys.left ? 1 : 0) : 0;
      me.dir = dir;
      const target = dir * WALK;
      me.vx += clamp(target - me.vx, -ACCEL * dt, ACCEL * dt);
      me.x = clamp(me.x + me.vx * dt, 8, world - 8);
      if (dir) me.f = dir;
      me.moving = Math.abs(me.vx) > 2;
      sendPos();
      const view = visibleArea();
      camX = lerp(camX, clamp(me.x - view.center, Math.min(0, (world - W) / 2), Math.max(0, world - W + view.right)), 1 - Math.exp(-dt * 6));
    } else {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); // spectators pan the camera
      camX = clamp(camX + dir * 180 * dt, Math.min(0, (world - W) / 2), Math.max(0, world - W));
      if (world <= W) camX = (world - W) / 2;
    }
    for (const o of others.values()) { if (o.at) o.x = lerp(o.x, extrapolate(o.bx, o.v, o.at), 1 - Math.exp(-dt * 12)); }
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life += dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.life > p.max) parts.splice(i, 1); }
    for (let i = floaters.length - 1; i >= 0; i--) if (performance.now() - floaters[i].t0 > 1200) floaters.splice(i, 1);
  }

  function draw(t) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, tcv.width, tcv.height);
    g.drawImage(layers.sky, 0, 0, W, H);
    drawLayer(layers.far, 0.2);
    drawLayer(layers.mid, 0.45);
    drawLayer(layers.near, 0.72);
    drawFloor();
    const n = Math.max(1, fx ? Object.keys(fx.sec).length : 1);
    for (let s = 0; s < n; s++) drawSection(s, t);
    // items dropped on the floor
    for (const it of (fx && fx.floor) || []) {
      const sx = it.x - camX; if (sx < -20 || sx > W + 20) continue;
      const bob = Math.floor(t / 350) % 2;
      g.globalAlpha = 0.3 + 0.15 * Math.sin(t / 180 + it.fid); ellipse(sx, groundY - 5, 8, 6, ITEMS[it.item].color); g.globalAlpha = 1;
      ellipse(sx, groundY, 5, 1, 'rgba(0,0,0,.4)');
      sprite(it.item, sx - 4, groundY - 10 - bob);
      text(ITEMS[it.item].tier.toUpperCase(), it.x, groundY - 16, ITEMS[it.item].color, 4.5);
    }
    // players (me last)
    if (S) {
      for (const p of S.players) {
        if (p.id === ctx.me.id || p.gone) continue;
        const o = others.get(p.id);
        const x = o ? o.x : fx && fx.sec[p.id] != null ? secX(fx.sec[p.id]) + SW / 2 : null;
        if (x != null) drawPlayer(p, x, o && o.m, t, false);
      }
      const mine = S.players.find((p) => p.id === ctx.me.id);
      if (mine && me.placed) drawPlayer(mine, me.x, me.moving, t, true);
    }
    for (const p of parts) { g.globalAlpha = clamp(1 - p.life / p.max, 0, 1); rect(p.c, p.x - camX, p.y, p.s, p.s); }
    g.globalAlpha = 1;
    drawLayer(layers.fg, 1.35, 0.95);
    for (const f of floaters) {
      const p = (performance.now() - f.t0) / 1200;
      text(f.str, f.x, f.y - p * 18, f.color, f.size, 'center', p > 0.7 ? (1 - p) / 0.3 : 1);
    }
    // countdown
    if (fx && fx.startAt && S.phase === 'play') {
      const left = fx.startAt - now();
      if (left > 0) text(String(Math.ceil(left / 1000)), camX + W / 2, H * 0.4, '#ffd166', 28);
      else if (left > -900) text('GO!', camX + W / 2, H * 0.4, '#7bd389', 28, 'center', 1 + left / 900);
    }
  }

  // Part of the screen not covered by the chat panel (internal px).
  function visibleArea() {
    const page = $('#gamePage'), side = $('#sidePanel');
    const right = window.innerWidth >= 900 && !page.classList.contains('panel-closed') ? (side.offsetWidth + 24) / SCALE : 0;
    return { right, center: (W - right) / 2 };
  }

  function frame() {
    if (!active) return;
    const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (layers && S) {
      update(dt); draw(t); renderPrompt(); drawMinimap(); renderEnergy();
      $('#gRound').textContent = statusText(S);
    }
    requestAnimationFrame(frame);
  }

  function resize() {
    if (!cv) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    SCALE = Math.max(2, Math.floor(Math.min(vh / 200, vw / 340)));
    W = Math.ceil(vw / SCALE); H = Math.ceil(vh / SCALE);
    groundY = H - 30;
    cv.width = W; cv.height = H; cv.style.width = W * SCALE + 'px'; cv.style.height = H * SCALE + 'px';
    dpr = Math.min(2, window.devicePixelRatio || 1);
    tcv.width = Math.round(W * SCALE * dpr); tcv.height = Math.round(H * SCALE * dpr);
    tcv.style.width = cv.style.width; tcv.style.height = cv.style.height;
    g = cv.getContext('2d'); g.imageSmoothingEnabled = false; tg = tcv.getContext('2d');
    buildLayers();
  }

  // ---------- host (authoritative) ----------
  const hostPos = new Map();
  let evN = 0, dirtyAt = 0;
  const host = {
    initState(opts) {
      return { winMode: opts.winMode || 'time', minutes: opts.minutes || 5, goal: opts.goal || 2500, sec: {}, money: {}, held: {}, bins: {}, taken: {}, nextSell: {}, fast: {}, energy: {}, floor: [], evs: [], startAt: 0, endAt: 0, seed: 0 };
    },
    // Sections follow the lobby order; leavers keep theirs during a game.
    assignSections(S) {
      const f = S.fx; if (!f) return;
      if (S.phase === 'lobby') { f.sec = {}; S.players.forEach((p, i) => (f.sec[p.id] = i)); }
      f.energy = f.energy || {}; f.floor = f.floor || [];
      for (const p of S.players) { if (f.energy[p.id] == null) f.energy[p.id] = 0; if (f.money[p.id] == null) f.money[p.id] = 0; if (!f.bins[p.id]) f.bins[p.id] = []; if (f.held[p.id] === undefined) f.held[p.id] = null; }
    },
    configure(S, o) { Object.assign(S.fx, o); },
    qsrc: [], qstate: new Map(), lastTick: 0, lastPush: 0, fid: 0,
    start(S, src) {
      const f = S.fx;
      this.qsrc = (src || []).filter((q) => q.answers && q.answers.filter((a) => String(a).trim()).length);
      this.qstate.clear();
      this.reset(S);
      f.seed = Math.floor(Math.random() * 1e9);
      f.startAt = Date.now() + COUNTDOWN;
      f.endAt = f.winMode === 'time' ? f.startAt + f.minutes * 60000 : 0;
      S.phase = 'play';
      this.ev(S, { type: 'start' });
    },
    reset(S) {
      const f = S.fx;
      Object.assign(f, { money: {}, held: {}, bins: {}, taken: {}, nextSell: {}, fast: {}, energy: {}, floor: [], evs: [], startAt: 0, endAt: 0 });
      this.lastTick = 0;
      this.assignSections(S);
      S.players.forEach((p) => (p.score = 0));
    },
    ev(S, e) { const f = S.fx; f.evs.push({ n: ++evN, ...e }); if (f.evs.length > 30) f.evs.splice(0, f.evs.length - 30); dirtyAt = dirtyAt || Date.now(); },
    posOf(id) { if (id === ctx.me.id) return me.x; const h = hostPos.get(id); return h ? extrapolate(h.x, h.v, h.at) : null; },
    walking(id) { if (id === ctx.me.id) return !!me.dir; const h = hostPos.get(id); return !!(h && h.v); },
    // Each player gets their own shuffled deck; choices are shuffled and the right answer stays on the host.
    sendQuestion(S, id) {
      const qs = this.qsrc; if (!qs.length) return;
      let st = this.qstate.get(id);
      if (!st) { st = { deck: [], serial: 0, cur: null }; this.qstate.set(id, st); }
      if (!st.deck.length) st.deck = shuffle(qs.map((_, i) => i));
      const q = qs[st.deck.pop()];
      const right = String(q.answers[q.correct]).trim();
      const choices = shuffle([...new Set(q.answers.map((a) => String(a).trim()).filter(Boolean))]);
      st.cur = { right, choices }; st.serial++;
      const qx = btoa(unescape(encodeURIComponent(JSON.stringify({ q: q.q, tag: q.tag || '', focus: q.focus || '', choices }))));
      ctx.send({ t: 'fx-qa', id, serial: st.serial, qx });
    },
    onMessage(S, m) {
      const f = S.fx; if (!f || S.phase !== 'play') return;
      const id = m.from, p = S.players.find((q) => q.id === id); if (!p || p.gone) return;
      if (m.t === 'fx-q') { const st = this.qstate.get(id); if (!st || !st.cur) this.sendQuestion(S, id); return; }
      if (m.t === 'fx-ans') {
        const st = this.qstate.get(id);
        if (!st || !st.cur || m.serial !== st.serial) return;
        const ok = st.cur.choices[m.choice] === st.cur.right;
        if (ok) f.energy[id] = (f.energy[id] || 0) + ENERGY_GAIN;
        this.ev(S, { type: 'ans', id, ok, right: st.cur.right, pick: m.choice });
        st.cur = null;
        this.sendQuestion(S, id);
        return;
      }
      if (Date.now() < f.startAt) return;
      const hasEnergy = (f.energy[id] || 0) > 0;
      if (m.t === 'fx-pick') {
        const s = f.sec[id], T = Date.now();
        const ok = hasEnergy && s === m.sec && f.held[id] == null && !(f.taken[s] || []).includes(m.k);
        const age = T - spawnTime(f, s, m.k);
        if (ok && age >= -150 && age <= RIDE + 500) {
          const item = rarityFor(f.seed, s, m.k);
          (f.taken[s] = f.taken[s] || []).push(m.k);
          f.held[id] = item;
          this.ev(S, { type: 'pick', id, item });
        } else this.ev(S, { type: 'pickFail', id });
      } else if (m.t === 'fx-drop') {
        const s = f.sec[id], item = f.held[id];
        if (item == null || !hasEnergy || Math.abs(m.x - (secX(s) + BIN.x + BIN.w / 2)) > 40) return;
        f.held[id] = null;
        const bin = f.bins[id] = f.bins[id] || [];
        if (!bin.length) f.nextSell[id] = Date.now() + (f.fast[id] ? FAST_SELL : SLOW_SELL);
        bin.push(item);
        this.ev(S, { type: 'drop', id, item });
      } else if (m.t === 'fx-steal') {
        const v = m.victim, bin = f.bins[v] || [];
        if (v === id || !hasEnergy || f.held[id] != null || !bin.length || f.sec[v] == null) return;
        if (Math.abs(m.x - (secX(f.sec[v]) + BIN.x + BIN.w / 2)) > 40) return;
        const item = bin.splice(Math.floor(Math.random() * bin.length), 1)[0];
        f.held[id] = item;
        this.ev(S, { type: 'steal', id, victim: v, item });
      } else if (m.t === 'fx-grab') {
        const i = f.floor.findIndex((it) => it.fid === m.fid);
        if (i < 0 || !hasEnergy || f.held[id] != null || Math.abs(m.x - f.floor[i].x) > 40) return;
        const it = f.floor.splice(i, 1)[0];
        f.held[id] = it.item;
        this.ev(S, { type: 'grab', id, item: it.item, from: it.owner });
      }
    },
    tick(S, broadcast) {
      const f = S.fx; if (!f) return;
      const T = Date.now();
      if (S.phase === 'play' && T >= f.startAt) {
        // energy drain: 5/s standing, 10/s walking. Hitting 0 freezes you and drops what you hold.
        const dt = this.lastTick ? Math.min(1, (T - this.lastTick) / 1000) : 0;
        this.lastTick = T;
        for (const id in f.sec) {
          const p = S.players.find((q) => q.id === id);
          if (!p || p.gone || (f.energy[id] || 0) <= 0) continue;
          const e = Math.max(0, f.energy[id] - (this.walking(id) ? DRAIN_WALK : DRAIN_IDLE) * dt);
          f.energy[id] = Math.round(e * 10) / 10;
          if (e <= 0) {
            if (f.held[id] != null) {
              const px = this.posOf(id) ?? secX(f.sec[id]) + SW / 2;
              const x = clamp(px + 16, 10, worldW() - 10); // lands next to you, not under you
              f.floor.push({ fid: ++this.fid, item: f.held[id], x, owner: id });
              this.ev(S, { type: 'drained', id, item: f.held[id] });
              f.held[id] = null;
            } else this.ev(S, { type: 'frozen', id });
          }
        }
        if (T - this.lastPush > 1000) { this.lastPush = T; dirtyAt = dirtyAt || T; }
        for (const id in f.sec) {
          const x = this.posOf(id);
          const onPad = x != null && Math.abs(x - (secX(f.sec[id]) + PAD.x)) < PAD.rx - 2;
          if (onPad !== !!f.fast[id]) {
            f.fast[id] = onPad;
            if (f.nextSell[id]) f.nextSell[id] = Math.min(f.nextSell[id], T + (onPad ? FAST_SELL : SLOW_SELL));
            dirtyAt = dirtyAt || T;
          }
          const bin = f.bins[id];
          if (bin && bin.length && T >= (f.nextSell[id] || 0)) {
            const item = bin.shift();
            f.money[id] = (f.money[id] || 0) + ITEMS[item].value;
            const p = S.players.find((q) => q.id === id); if (p) p.score = f.money[id];
            f.nextSell[id] = T + (onPad ? FAST_SELL : SLOW_SELL);
            this.ev(S, { type: 'sold', id, item });
          }
        }
        // prune old taken markers
        for (const s in f.taken) f.taken[s] = f.taken[s].filter((k) => T - spawnTime(f, Number(s), k) < RIDE + 3000);
        // win conditions
        let winner = null;
        if (f.winMode === 'time' && T >= f.endAt) winner = Object.keys(f.money).sort((a, b) => f.money[b] - f.money[a])[0] || null;
        if (f.winMode === 'money') for (const id in f.money) if (f.money[id] >= f.goal) winner = id;
        if (winner !== null && S.phase === 'play') {
          S.phase = 'over'; S.winner = winner;
          this.ev(S, { type: 'over', id: winner });
          broadcast(); dirtyAt = 0; return;
        }
      }
      if (dirtyAt && T - dirtyAt >= 120) { dirtyAt = 0; broadcast(); }
    },
  };

  // ---------- lifecycle ----------
  function activate() {
    if (active) return;
    active = true;
    $('#fxStage').hidden = false;
    if (!cv) {
      cv = $('#fxCanvas'); tcv = $('#fxText');
      window.addEventListener('resize', resize);
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      window.addEventListener('blur', () => { keys.left = keys.right = false; });
      const hold = (id, k) => {
        const b = $(id);
        const on = (e) => { e.preventDefault(); keys[k] = true; }, off = () => { keys[k] = false; };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      };
      hold('#fxLeft', 'left'); hold('#fxRight', 'right');
      $('#fxUse').addEventListener('pointerdown', (e) => { e.preventDefault(); interact(); });
      $('#fxQBtn').addEventListener('click', () => { openQuiz(); $('#fxQBtn').blur(); });
      $('#fxQuizClose').addEventListener('click', closeQuiz);
      $('#fxqChoices').addEventListener('click', (e) => { const b = e.target.closest('.tile'); if (b) answer(Number(b.dataset.i)); });
    }
    resize();
    last = performance.now();
    requestAnimationFrame(frame);
  }
  function deactivate() {
    active = false;
    if ($('#fxStage')) $('#fxStage').hidden = true;
    others.clear(); parts.length = 0; floaters.length = 0; hostPos.clear(); eaten.clear();
    Object.assign(me, { x: 0, vx: 0, placed: false, sentX: null, moving: false });
    pending = null; lastEvN = -1; fx = null; S = null; clockOffset = null; prompt = null; camX = 0;
    closeQuiz(); Object.assign(quiz, { q: null, serial: -1, locked: false, next: null }); clearTimeout(quiz.unlockTimer);
    energyAt = { v: 0, t: 0 }; me.dir = 0; me.sentV = undefined; lastPhase = null;
    keys.left = keys.right = false;
    $('#fxPrompt').hidden = true; $('#fxBanner').hidden = true;
  }
  let lastPhase = null; // tracked separately: on the host, the state object is updated in place
  function onState(s) {
    const prevPhase = lastPhase; lastPhase = s.phase;
    S = s; fx = s.fx;
    if (fx && fx.hostNow) {
      // hostNow - localNow = true offset - network delay; the largest sample has the least delay.
      const off = fx.hostNow - Date.now();
      if (clockOffset == null || off > clockOffset) clockOffset = off;
    }
    if (ctx.me.host) clockOffset = 0;
    activate();
    if (prevPhase && prevPhase !== s.phase && s.phase === 'lobby') { lastEvN = -1; me.placed = false; pending = null; }
    if (prevPhase && prevPhase !== s.phase && s.phase !== 'play') { closeQuiz(); Object.assign(quiz, { q: null, next: null, locked: false }); }
    if (s.phase === 'play' && prevPhase === 'lobby') {
      me.placed = false; Object.assign(quiz, { q: null, next: null, locked: false });
      // Everyone starts with 0 energy, so open the questions right away.
      if (S.players.some((p) => p.id === ctx.me.id)) setTimeout(openQuiz, 300);
    }
    energyAt = { v: serverEnergy(ctx.me.id), t: performance.now() };
    handleEvents();
    if (pending && fx.held[ctx.me.id] != null) pending = null;
    renderHud();
    prompt = null;
  }

  // Read-only snapshot for automated tests.
  function debug() {
    const sec = mySection();
    const items = [];
    if (fx && sec != null && fx.startAt) {
      const T = now(), kMax = Math.floor((T - fx.startAt - offsetFor(sec)) / INTERVAL), taken = new Set(fx.taken[sec] || []);
      for (let k = Math.max(0, kMax - 12); k <= kMax; k++) { const age = T - spawnTime(fx, sec, k); if (age >= 0 && age <= RIDE && !taken.has(k)) items.push({ k, x: secX(sec) + CONV.x0 + (age / 1000) * SPEED, item: rarityFor(fx.seed, sec, k) }); }
    }
    const binX = (id) => (fx && fx.sec[id] != null ? secX(fx.sec[id]) + BIN.x + BIN.w / 2 : null);
    return { energy: myEnergy(), serverEnergy: serverEnergy(ctx.me.id), frozen: frozen(ctx.me.id), quizOpen, question: quiz.q, floor: (fx && fx.floor) || [], x: me.x, sec, action: findAction(), items, myBin: ctx && binX(ctx.me.id), padX: sec != null ? secX(sec) + PAD.x : null, binX: fx ? Object.fromEntries(Object.keys(fx.sec).map((id) => [id, binX(id)])) : {}, held: ctx && heldOf(ctx.me.id), started: !!(fx && fx.startAt && now() >= fx.startAt), W, H, camX };
  }

  return {
    ITEMS, debug,
    attach(c) { ctx = c; },
    host,
    onState, onPos, onQuestion, deactivate, statusText,
    isActive: () => active,
  };
})();

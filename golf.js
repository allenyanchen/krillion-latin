// Puffer: Via Golf (2D top-down mini golf through Roman landmarks).
// Everyone plays the same hole at once; balls pass through each other. Each correct answer in the shared
// quiz gives one shot (up to MAX_SAVED). Drag back on the hole and let go to shoot (or aim with A/D or
// ◀▶, set power with W/S or ▲▼, and shoot with E). Walls and columns bounce, sand slows, slopes push,
// water sends the ball back to where it was hit from (+1 stroke). When every ball is in or the hole's time
// runs out, the next hole starts; unfinished players score par + 3 (or their strokes + 1 if more).
// Lowest total after the last hole wins.
//
// Networking matches the other movement modes: the host is authoritative. A client sends 'gf-shot' with
// an integer velocity; the host runs simulate() and broadcasts where the ball stops plus the shot itself.
// simulate() uses only + - * / and Math.sqrt, so every browser replays exactly the same roll.
window.Golf = (() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => UI.esc(s);
  const TILE_COLORS = ['amber', 'teal', 'pink', 'blue', 'purple', 'green', 'orange', 'slate'];

  // ---------- holes ----------
  // ' ' outside (solid), '#' marble block (solid), '.' green, 's' sand, '~' water, 'o' column,
  // 'T' tee, 'O' cup, '>' '<' '^' 'v' slopes that push the ball that way.
  const TS = 12, N = 20, WS = TS * N;
  const HOLES = [
    { name: 'Via Appia', par: 2, map: [
      '',
      ' ...........ss..... ',
      ' .................. ',
      ' ...........o....O. ',
      ' .................. ',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ....',
      ' ..T.',
      ' ....',
      ' ....',
    ] },
    { name: 'Forum Fountain', par: 3, map: [
      '',
      '  ................',
      '  .......O........',
      '  ................',
      '  ..o..........o..',
      '  ................',
      '  ......~~~~......',
      '  .....~~~~~~.....',
      '  ....o~~~~~~o....',
      '  .....~~~~~~.....',
      '  ......~~~~......',
      '  ................',
      '  ..o..........o..',
      '  ................',
      '  ss............ss',
      '  ss............ss',
      '  .......T........',
      '  ................',
    ] },
    { name: 'Aqueduct', par: 4, map: [
      '',
      ' .................. ',
      ' .O................ ',
      ' .................. ',
      ' ##########.....### ',
      ' ...........vvvv... ',
      ' ...........vvvv... ',
      ' .o..o..o..o....... ',
      ' .................. ',
      ' ...<<<<<<<<<<<<<.. ',
      ' .................. ',
      ' ...o..o..o..o..... ',
      ' .................. ',
      ' ...~~~~~~~~~...... ',
      ' .................. ',
      ' .................. ',
      ' ...............T.. ',
      ' .................. ',
    ] },
    { name: 'Circus Maximus', par: 3, map: [
      '',
      '',
      '   ..............',
      '  ....ss....ss....',
      ' .......O.......... ',
      ' .................. ',
      ' ...############... ',
      ' .................. ',
      ' ...s..........s... ',
      ' .................. ',
      ' ...############... ',
      ' .................. ',
      ' .......T.......... ',
      '  ....ss....ss....',
      '   ..............',
    ] },
    { name: 'Tiber Bridge', par: 3, map: [
      '',
      '',
      ' .................. ',
      ' .....O............ ',
      ' .................. ',
      ' ...o.......o...... ',
      ' .................. ',
      ' ~~~~~~~~..~~~~~~~~ ',
      ' ~~~~~~~~..~~~~~~~~ ',
      ' ~~~~~~~~..~~~~~~~~ ',
      ' .................. ',
      ' ......ss.......... ',
      ' .................. ',
      ' .............o.... ',
      ' .................. ',
      ' ...............T.. ',
      ' .................. ',
    ] },
    { name: 'Colosseum', par: 4, map: [
      '',
      '    ............',
      '  ................',
      ' ....##########.... ',
      ' ...#..........#... ',
      ' ..#....^^^^....#.. ',
      ' ..#...<....>...#.. ',
      ' ..#..<..o...>..#.. ',
      ' ......<.O..>...... ',
      ' ..#..<..o...>..#.. ',
      ' ..#...<....>...#.. ',
      ' ..#....vvvv....#.. ',
      ' ...#..........#... ',
      ' ....####..####.... ',
      ' .................. ',
      '  ................',
      '    .....T......',
    ] },
  ];
  for (const h of HOLES) {
    h.grid = Array.from({ length: N }, (_, j) => (h.map[j] || '').padEnd(N, ' ').slice(0, N));
    h.cols = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = h.grid[j][i], p = { x: i * TS + TS / 2, y: j * TS + TS / 2 };
      if (c === 'T') h.tee = p; else if (c === 'O') h.cup = p; else if (c === 'o') h.cols.push(p);
    }
  }

  // ---------- physics (deterministic: same input, same roll in every browser) ----------
  const DT = 1 / 240, FRAME_MS = 1000 / 120, MAX_STEPS = 7200;
  const MAX_V = 420, GRASS = 240, SAND = 1000, SLOPE = 330, REST = 0.72, COL_E = 0.85;
  const BR = 2.5, COL_R = 4, CUP_R = 4.5, CAPTURE = 240, STOP = 6;
  const tile = (h, x, y) => { const i = Math.floor(x / TS), j = Math.floor(y / TS); return i < 0 || j < 0 || i >= N || j >= N ? ' ' : h.grid[j][i]; };
  const solid = (c) => c === ' ' || c === '#';
  const isSlope = (c) => c === '>' || c === '<' || c === '^' || c === 'v';
  const blocked = (h, x, y) => solid(tile(h, x - BR, y - BR)) || solid(tile(h, x + BR, y - BR)) || solid(tile(h, x - BR, y + BR)) || solid(tile(h, x + BR, y + BR));
  // Rolls a ball from (x, y) with velocity (vx, vy) world px/s. path holds x,y pairs at 120 per second.
  function simulate(h, x, y, vx, vy) {
    const path = [x, y];
    let sunk = false, water = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const c = tile(h, x, y);
      if (c === '>') vx += SLOPE * DT; else if (c === '<') vx -= SLOPE * DT; else if (c === 'v') vy += SLOPE * DT; else if (c === '^') vy -= SLOPE * DT;
      let sp = Math.sqrt(vx * vx + vy * vy);
      const fr = (c === 's' ? SAND : GRASS) * DT;
      if (sp <= fr) { vx = 0; vy = 0; } else { const k = (sp - fr) / sp; vx *= k; vy *= k; }
      let nx = x + vx * DT;
      if (blocked(h, nx, y)) { vx = -vx * REST; nx = x; }
      let ny = y + vy * DT;
      if (blocked(h, nx, ny)) { vy = -vy * REST; ny = y; }
      for (const col of h.cols) {
        const dx = nx - col.x, dy = ny - col.y, m = BR + COL_R, d2 = dx * dx + dy * dy;
        if (d2 >= m * m) continue;
        const d = Math.sqrt(d2) || 1e-6, ux = dx / d, uy = dy / d;
        nx = col.x + ux * m; ny = col.y + uy * m;
        const dot = vx * ux + vy * uy;
        if (dot < 0) { vx -= (1 + COL_E) * dot * ux; vy -= (1 + COL_E) * dot * uy; }
      }
      if (blocked(h, nx, ny)) { nx = x; ny = y; }
      x = nx; y = ny;
      if (tile(h, x, y) === '~') { water = true; break; }
      sp = Math.sqrt(vx * vx + vy * vy);
      const cx = x - h.cup.x, cy = y - h.cup.y;
      if (cx * cx + cy * cy < CUP_R * CUP_R && sp < CAPTURE) { sunk = true; x = h.cup.x; y = h.cup.y; break; }
      if (sp < STOP && !isSlope(tile(h, x, y))) break;
      if (step & 1) path.push(x, y);
    }
    path.push(x, y);
    return { path, x, y, sunk, water, dur: Math.round((path.length / 2 - 1) * FRAME_MS) };
  }
  // Velocity a client sends: whole numbers, never faster than MAX_V (the host checks the same way).
  function shotVel(vx, vy) {
    vx = Math.round(vx); vy = Math.round(vy);
    const sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > MAX_V) { vx = Math.round((vx * MAX_V) / sp); vy = Math.round((vy * MAX_V) / sp); }
    return { vx, vy };
  }

  // ---------- helpers ----------
  const COUNTDOWN = 3500, RECAP_MS = 4500, MAX_SAVED = 3;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };
  const toPar = (d) => (d === 0 ? 'E' : d > 0 ? '+' + d : '−' + -d);
  const scoreName = (strokes, par) => {
    if (strokes === 1) return 'Hole in one!';
    return { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' }[strokes - par] || `${strokes - par > 0 ? '+' : ''}${strokes - par}`;
  };

  // ---------- module state ----------
  let ctx = null, active = false;
  let cv, g, tcv, tg, wc, wg, dpr = 1, last = 0;
  let clockOffset = null, fx = null, S = null;
  const view = { ox: 0, oy: 0, k: 1 };
  const keys = { left: false, right: false, up: false, down: false };
  const aim = { a: -Math.PI / 2, p: 0.5, kb: false, drag: null, holeSeen: -1 };
  let pred = null;                      // my shot, rolling locally before the host's copy arrives
  const parts = [], floaters = [], seenEnd = new Map(), paths = new Map();
  let lastEvN = -1, prompt = null, bannerTimer = 0, lastPhase = null, holeCv = null, holeCvFor = -1;
  let quizOpen = false;
  const quiz = { q: null, serial: -1, locked: false, next: null, unlockTimer: 0, wait: false, readyAt: 0, contTimer: 0 };
  const now = () => Date.now() + (clockOffset || 0);

  const hole = () => HOLES[fx && fx.hole != null ? fx.hole : 0];
  function player(id) { return S ? S.players.find((p) => p.id === id) : null; }
  function colorOf(id) { const p = player(id); return p ? Scene.COLORS[p.look.c] || '#fff' : '#888'; }
  const mySection = () => (fx && ctx ? fx.sec[ctx.me.id] : undefined);
  const amPlaying = () => !!(S && ctx && S.players.some((p) => p.id === ctx.me.id) && mySection() != null);
  const gameLive = () => !!(fx && S && S.phase === 'play' && fx.startAt && now() >= fx.startAt);
  const between = () => !!(fx && fx.between && now() < fx.between);
  const shotsOf = (id) => (fx && fx.shots ? fx.shots[id] || 0 : 0);
  const strokesOf = (id, i) => (fx && fx.strokes && fx.strokes[id] ? fx.strokes[id][i] || 0 : 0);
  // Total against par over the holes already finished (plus the current one during its recap).
  function totalToPar(id) {
    if (!fx) return 0;
    const done = fx.between ? fx.hole + 1 : fx.hole;
    let d = 0; for (let i = 0; i < done && i < HOLES.length; i++) d += strokesOf(id, i) - HOLES[i].par;
    return d;
  }
  function totalStrokes(id, upTo) { let n = 0; for (let i = 0; i < upTo; i++) n += strokesOf(id, i); return n; }

  // ---------- where each ball is right now ----------
  function pathOf(id, s, h) {
    const key = id + ':' + s.n;
    let r = paths.get(key);
    if (!r) { r = simulate(h, s.x0, s.y0, s.vx, s.vy); paths.set(key, r); if (paths.size > 40) paths.delete(paths.keys().next().value); }
    return r;
  }
  function shotStart(id, s) { return pred && id === ctx.me.id && pred.n === s.n ? pred.start : s.at; }
  function ballView(id) {
    const b = fx && fx.balls && fx.balls[id]; if (!b) return null;
    const s = fx.shot && fx.shot[id], h = hole(), T = now();
    if (id === ctx.me.id && pred && (!s || s.n < pred.n)) {
      const r = pred.r, i = Math.min(r.path.length / 2 - 1, Math.max(0, Math.floor((T - pred.start) / FRAME_MS)));
      return { x: r.path[i * 2], y: r.path[i * 2 + 1], moving: T - pred.start < r.dur, sunk: false };
    }
    if (s && s.hole === fx.hole) {
      const el = T - shotStart(id, s);
      if (el < s.dur) {
        const r = pathOf(id, s, h), i = Math.max(0, Math.floor(el / FRAME_MS));
        if (el < 0) return { x: s.x0, y: s.y0, moving: true, sunk: false };
        return { x: r.path[i * 2], y: r.path[i * 2 + 1], moving: true, sunk: false };
      }
    }
    return { x: b.x, y: b.y, moving: false, sunk: !!b.sunk };
  }
  function atRest(id) {
    const s = fx && fx.shot && fx.shot[id];
    if (id === ctx.me.id && pred) return false;
    return !s || s.hole !== fx.hole || now() >= s.at + s.dur;
  }
  function canShoot() {
    if (!amPlaying() || !gameLive() || between() || quizOpen) return false;
    const b = fx.balls[ctx.me.id];
    return !!b && !b.sunk && atRest(ctx.me.id) && shotsOf(ctx.me.id) > 0;
  }

  // ---------- layout: the hole fits in the space the HUD leaves free ----------
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight, page = $('#gamePage');
    const wide = vw >= 900, touch = matchMedia('(pointer: coarse)').matches, lobby = !S || S.phase === 'lobby';
    // touch: stay above the prompt, which sits in the backpack's slot of the HUD stack (290px + its height)
    let l = 12, r = vw - 12, t = $('#gTop').getBoundingClientRect().bottom + 10, b = vh - (touch && !lobby ? 346 : 56);
    if (wide && !page.classList.contains('panel-closed')) r = $('#sidePanel').getBoundingClientRect().left - 12;
    const card = lobby ? $('#lobbyCard') : $('#fxStage .fx-hud');
    if (card && card.offsetParent) { const cr = card.getBoundingClientRect(); if (wide) l = cr.right + 12; else t = Math.max(t, cr.bottom + 8); }
    const fit = Math.max(0.5, Math.min((r - l) / WS, (b - t) / WS));
    const kd = fit >= 2 ? Math.floor(fit * dpr) : Math.max(1, fit * dpr); // whole device pixels when there's room, else fill the space
    view.k = kd / dpr;
    view.ox = Math.round(l + (r - l - WS * view.k) / 2); view.oy = Math.round(t + Math.max(0, (b - t - WS * view.k) / 2));
  }
  const toScreen = (x, y) => ({ x: view.ox + x * view.k, y: view.oy + y * view.k });
  const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.k, y: (sy - view.oy) / view.k });

  // ---------- drawing ----------
  const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  function disc(c, cx, cy, r, col) { for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); R(c, col, cx - w, cy + y, w * 2 + 1, 1); } }
  function buildHole(h) {
    const c = document.createElement('canvas'); c.width = WS; c.height = WS;
    const x = c.getContext('2d');
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ch = h.grid[j][i], X = i * TS, Y = j * TS;
      if (ch === ' ') {
        // garden: hedge green with speckles, a few cypress trees
        R(x, '#2d5a35', X, Y, TS, TS);
        for (let k = 0; k < 10; k++) R(x, hash(i * 31 + k, j) < 0.5 ? '#264d2d' : '#356a3d', X + Math.floor(hash(i, j * 7 + k) * TS), Y + Math.floor(hash(j, i * 5 + k) * TS), 1, 1);
        if (hash(i, j) < 0.12) { const tx = X + 6, ty = Y + 2; R(x, '#15301b', tx - 2, ty + 1, 5, 9); R(x, '#1f4426', tx - 1, ty, 3, 10); R(x, '#5a3a1e', tx, ty + 10, 1, 2); }
      } else if (ch === '#') {
        R(x, '#8f8676', X, Y, TS, TS); R(x, '#e2dccd', X, Y, TS, TS - 3); R(x, '#f4efe3', X, Y, TS, 2); R(x, '#c9c1b0', X + TS - 1, Y, 1, TS - 3);
        if ((i + j) % 2) R(x, '#d3ccbb', X + 3, Y + 5, 6, 1);
      } else if (ch === '~') {
        R(x, '#2f7fc0', X, Y, TS, TS);
        for (let k = 0; k < 3; k++) R(x, '#4aa3dc', X + Math.floor(hash(i * 3 + k, j) * 8), Y + 2 + k * 4, 4, 1);
      } else if (ch === 's') {
        R(x, '#e8d08f', X, Y, TS, TS);
        for (let k = 0; k < 8; k++) R(x, '#cdb06b', X + Math.floor(hash(i + k, j * 3) * TS), Y + Math.floor(hash(j + k, i * 3) * TS), 1, 1);
      } else {
        R(x, isSlope(ch) ? '#6fc257' : (i + j) % 2 ? '#5fb346' : '#57a940', X, Y, TS, TS);
        for (let k = 0; k < 4; k++) R(x, '#4f9a3a', X + Math.floor(hash(i * 7 + k, j) * TS), Y + Math.floor(hash(j * 7 + k, i) * TS), 1, 1);
      }
    }
    // stone rim wherever the course meets the garden or a block
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (solid(h.grid[j][i])) continue;
      const X = i * TS, Y = j * TS, out = (di, dj) => solid((h.grid[j + dj] || '')[i + di] || ' ');
      if (out(0, -1)) { R(x, '#7d735f', X, Y, TS, 1); R(x, '#cfc6b3', X, Y + 1, TS, 2); R(x, '#3f7d33', X, Y + 3, TS, 1); }
      if (out(0, 1)) { R(x, '#cfc6b3', X, Y + TS - 3, TS, 2); R(x, '#7d735f', X, Y + TS - 1, TS, 1); }
      if (out(-1, 0)) { R(x, '#7d735f', X, Y, 1, TS); R(x, '#cfc6b3', X + 1, Y, 2, TS); }
      if (out(1, 0)) { R(x, '#cfc6b3', X + TS - 3, Y, 2, TS); R(x, '#7d735f', X + TS - 1, Y, 1, TS); }
    }
    // tee mat and markers
    R(x, '#3f8f3a', h.tee.x - 8, h.tee.y - 5, 16, 10); R(x, '#ffffff', h.tee.x - 7, h.tee.y - 1, 2, 2); R(x, '#ffffff', h.tee.x + 5, h.tee.y - 1, 2, 2);
    // cup
    disc(x, h.cup.x, h.cup.y, 5, '#3c7a30'); disc(x, h.cup.x, h.cup.y, 4, '#10140f'); R(x, '#2a2f28', h.cup.x - 3, h.cup.y - 4, 6, 1);
    // marble columns
    // marble columns seen from above: a stone ring around a fluted top, so they never look like a ball
    for (const col of h.cols) {
      disc(x, col.x + 2, col.y + 3, 5, 'rgba(10,30,10,.4)'); disc(x, col.x, col.y, 5, '#5b5346'); disc(x, col.x, col.y, 4, '#b8ad95');
      disc(x, col.x, col.y, 2, '#8c8370'); R(x, '#d9d0bb', col.x - 3, col.y - 1, 1, 2); R(x, '#d9d0bb', col.x + 3, col.y - 1, 1, 2); R(x, '#d9d0bb', col.x - 1, col.y - 4, 2, 1); R(x, '#d9d0bb', col.x - 1, col.y + 3, 2, 1);
    }
    return c;
  }
  function drawBall(x, y, color, mine, t) {
    x = Math.round(x); y = Math.round(y);
    R(wg, 'rgba(0,0,0,.3)', x - 2, y + 2, 5, 2);
    R(wg, '#0b1320', x - 2, y - 3, 5, 7); R(wg, '#0b1320', x - 3, y - 2, 7, 5);
    R(wg, color, x - 2, y - 2, 5, 5); R(wg, color, x - 1, y - 3, 3, 1); R(wg, '#ffffff', x - 1, y - 2, 2, 1);
    if (mine && canShoot() && !aim.drag && !aim.kb) { const b = Math.floor(t / 300) % 2; R(wg, '#ffffff', x - 1, y - 9 - b, 3, 1); R(wg, '#ffffff', x, y - 8 - b, 1, 1); }
  }
  function drawAim(bx, by, a, p) {
    const len = 10 + p * 60, col = p < 0.45 ? '#7bd389' : p < 0.8 ? '#ffd166' : '#ff6b6b';
    for (let d = 6; d < len; d += 4) { const x = bx + Math.cos(a) * d, y = by + Math.sin(a) * d; R(wg, '#0b1320', x - 1, y - 1, 3, 3); R(wg, col, x, y, 1, 1); }
  }
  function draw(t) {
    const h = hole(), hi = fx ? fx.hole : 0;
    if (!holeCv || holeCvFor !== hi) { holeCv = buildHole(h); holeCvFor = hi; }
    wg.drawImage(holeCv, 0, 0);
    // water shimmer and slope arrows move with time
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ch = h.grid[j][i], X = i * TS, Y = j * TS;
      if (ch === '~' && Math.floor(t / 400 + hash(i, j) * 6) % 3 === 0) R(wg, '#9fd3f5', X + 2 + Math.floor(hash(j, i) * 7), Y + 3 + Math.floor(t / 400) % 6, 3, 1);
      else if (isSlope(ch)) {
        const o = Math.floor(t / 90) % TS, dx = ch === '>' ? 1 : ch === '<' ? -1 : 0, dy = ch === 'v' ? 1 : ch === '^' ? -1 : 0;
        const cx = X + TS / 2 + dx * (o - TS / 2), cy = Y + TS / 2 + dy * (o - TS / 2);
        R(wg, '#a8e08f', cx - (dy ? 2 : 0) - (dx < 0 ? -1 : dx > 0 ? 1 : 0), cy - (dx ? 2 : 0), dy ? 5 : 1, dx ? 5 : 1);
        R(wg, '#a8e08f', cx - (dy ? 1 : 0), cy - (dx ? 1 : 0), dy ? 3 : 1, dx ? 3 : 1);
      }
    }
    // flag
    const fl = Math.floor(t / 250) % 2;
    R(wg, '#2b2b2b', h.cup.x, h.cup.y - 16, 1, 16); R(wg, '#e2453c', h.cup.x + 1, h.cup.y - 16, 7, 4 + fl); R(wg, '#ff7b6e', h.cup.x + 1, h.cup.y - 16, 7, 1);
    // players: character beside the ball (lined up at the tee in the lobby)
    const list = S ? S.players.filter((p) => !p.gone && fx && fx.sec[p.id] != null) : [];
    const lobby = !S || S.phase === 'lobby';
    const drawn = [];
    list.forEach((p, i) => {
      let bx, by, sunk = false;
      if (lobby || !fx.balls || !fx.balls[p.id]) { bx = h.tee.x + (i - (list.length - 1) / 2) * 18; by = h.tee.y + 10; }
      else { const v = ballView(p.id); bx = v.x; by = v.y; sunk = v.sunk; }
      drawn.push({ p, bx, by, sunk, i });
    });
    const meId = ctx.me.id;
    drawn.sort((a, b) => (a.p.id === meId) - (b.p.id === meId) || a.by - b.by);
    for (const d of drawn) {
      const cx = lobby ? d.bx : d.sunk ? h.cup.x - 9 : d.bx - 8, sy = lobby ? d.by : d.sunk ? h.cup.y + 6 : d.by + 3;
      Scene.drawCharacter(wg, cx, sy, d.p.look, { bob: Math.floor((t + d.i * 170) / 450) % 2 });
      if (!lobby && !d.sunk) drawBall(d.bx, d.by, colorOf(d.p.id), d.p.id === meId, t);
    }
    // my aim
    const mine = drawn.find((d) => d.p.id === meId);
    if (mine && canShoot()) {
      if (aim.drag && aim.drag.p > 0) drawAim(mine.bx, mine.by, aim.drag.a, aim.drag.p);
      else if (aim.kb) drawAim(mine.bx, mine.by, aim.a, aim.p);
    }
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i], el = (t - q.t0) / 1000;
      if (el > q.max) { parts.splice(i, 1); continue; }
      R(wg, q.c, q.x + q.vx * el, q.y + q.vy * el + 60 * el * el, 1, 1);
    }
    // to the screen
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
    g.fillStyle = '#1f3d26'; g.fillRect(0, 0, cv.width, cv.height);
    const k = view.k * dpr, X = view.ox * dpr, Y = view.oy * dpr;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(X + 4 * dpr, Y + 6 * dpr, WS * k, WS * k);
    g.drawImage(wc, X, Y, WS * k, WS * k);
    // text layer: names, floating results, countdown
    tg.clearRect(0, 0, tcv.width, tcv.height);
    // names: yours first, then any that don't overlap one already shown (players often stand close together)
    const shown = [];
    tg.font = `700 ${Math.round(11 * dpr)}px 'Pixelify Sans', sans-serif`;
    for (const d of drawn.slice().reverse()) {
      const cx = lobby ? d.bx : d.sunk ? h.cup.x - 9 : d.bx - 8, top = (lobby ? d.by : d.sunk ? h.cup.y + 6 : d.by + 3) - 24;
      const s = toScreen(cx, top), w = tg.measureText(d.p.name).width / dpr + 6;
      const box = { l: s.x - w / 2, r: s.x + w / 2, t: s.y - 8, b: s.y + 8 };
      if (shown.some((o) => box.l < o.r && o.l < box.r && box.t < o.b && o.t < box.b)) continue;
      shown.push(box);
      text(d.p.name, s.x, s.y, d.p.id === meId ? '#ffd166' : '#ffffff', 11);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i], el = (performance.now() - f.t0) / 1400;
      if (el > 1) { floaters.splice(i, 1); continue; }
      const s = toScreen(f.x, f.y);
      text(f.str, s.x, s.y - 30 * el, f.color, f.size, el > 0.7 ? (1 - el) / 0.3 : 1);
    }
    if (fx && fx.startAt && S.phase === 'play') {
      const left = fx.startAt - now(), c = toScreen(WS / 2, WS / 2);
      if (left > 0) text(String(Math.ceil(left / 1000)), c.x, c.y, '#ffd166', 64);
      else if (left > -900) text('Tee off!', c.x, c.y, '#7bd389', 44, 1 + left / 900);
      if (between()) text(`Hole ${fx.hole + 1} done`, c.x, c.y, '#ffffff', 34);
    }
  }
  function text(str, x, y, color, size, alpha = 1) {
    if (alpha <= 0) return;
    const px = Math.round(size * dpr);
    tg.globalAlpha = Math.min(1, alpha);
    tg.font = `700 ${px}px 'Pixelify Sans', sans-serif`; tg.textAlign = 'center'; tg.textBaseline = 'middle';
    tg.lineJoin = 'round'; tg.lineWidth = Math.max(3, px * 0.24); tg.strokeStyle = '#070b12';
    tg.strokeText(str, x * dpr, y * dpr); tg.fillStyle = color; tg.fillText(str, x * dpr, y * dpr);
    tg.globalAlpha = 1;
  }
  function burst(x, y, n, colors, sp = 50) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.6, c: colors[i % colors.length], t0, max: 0.5 + Math.random() * 0.5 }); }
  }
  function floatText(x, y, str, color, size = 16) { floaters.push({ x, y, str, color, size, t0: performance.now() }); }
  function banner(html, ms = 3200) {
    const b = $('#fxBanner'); b.innerHTML = html; b.hidden = false;
    b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.hidden = true), ms);
  }

  // ---------- shooting ----------
  function shoot(vx, vy) {
    if (!canShoot()) return;
    const v = shotVel(vx, vy);
    if (v.vx * v.vx + v.vy * v.vy < 100) return; // a tiny drag is a cancel
    const b = fx.balls[ctx.me.id], s = fx.shot[ctx.me.id];
    pred = { n: (s ? s.n : 0) + 1, start: now(), r: simulate(hole(), b.x, b.y, v.vx, v.vy), sentAt: performance.now() };
    ctx.send({ t: 'gf-shot', from: ctx.me.id, vx: v.vx, vy: v.vy });
    aim.kb = false; prompt = null;
  }
  function onPointerDown(e) {
    if (!active || e.button > 0) return;
    if (!canShoot()) { if (amPlaying() && gameLive() && !between() && shotsOf(ctx.me.id) < 1 && fx.balls[ctx.me.id] && !fx.balls[ctx.me.id].sunk) banner('Answer a question to get a shot', 1800); return; }
    cv.setPointerCapture(e.pointerId);
    aim.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, a: 0, p: 0 };
    e.preventDefault();
  }
  const PULL = () => Math.min(170, 70 * view.k + 40); // drag distance (css px) for full power
  function onPointerMove(e) {
    const d = aim.drag; if (!d || e.pointerId !== d.id) return;
    const dx = d.sx - e.clientX, dy = d.sy - e.clientY, len = Math.sqrt(dx * dx + dy * dy);
    d.a = Math.atan2(dy, dx); d.p = len < 12 ? 0 : clamp(len / PULL(), 0, 1);
  }
  function onPointerUp(e) {
    const d = aim.drag; if (!d || e.pointerId !== d.id) return;
    aim.drag = null;
    if (e.type === 'pointerup' && d.p > 0) shoot(Math.cos(d.a) * d.p * MAX_V, Math.sin(d.a) * d.p * MAX_V);
  }
  function aimAtCup() {
    const b = fx && fx.balls && fx.balls[ctx.me.id]; if (!b) return;
    aim.a = Math.atan2(hole().cup.y - b.y, hole().cup.x - b.x); aim.p = 0.5; aim.holeSeen = fx.hole;
  }

  // ---------- questions (shared full-screen quiz, as in island.js) ----------
  const decQ = (x) => { try { return JSON.parse(decodeURIComponent(escape(atob(x)))); } catch (e) { return null; } };
  function openQuiz() {
    if (!amPlaying() || S.phase !== 'play' || quizOpen) return;
    quizOpen = true; keys.left = keys.right = keys.up = keys.down = false; aim.drag = null;
    const hint = $('#fxQuiz .quiz-hint'); if (hint) hint.innerHTML = `Each correct answer gives <b>+1 shot</b> (save up to ${MAX_SAVED})`;
    $('#fxQuizClose').innerHTML = 'Back to the course <kbd>Space</kbd>';
    $('#fxqEnergy').hidden = true;
    const el = $('#fxQuiz'); el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    if (!quiz.q && !quiz.next) { showLoading(); ctx.send({ t: 'fx-q', from: ctx.me.id }); }
    else if (!quiz.locked && quiz.next) showQuestion();
  }
  function closeQuiz() { if (quiz.wait && performance.now() >= quiz.readyAt) cont(); quizOpen = false; $('#fxQuiz').hidden = true; }
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
    $('#fxqChoices').classList.remove('locked');
    const card = $('#fxqCard'); card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
  }
  function answer(i) {
    if (performance.now() - (quiz.contAt || 0) < 400) return; // the click that continued must not also answer
    if (!quiz.q || quiz.locked || quiz.wait || i >= quiz.q.choices.length || !$('#fxqChoices .tile')) return;
    quiz.locked = true;
    const tile = $(`#fxqChoices .tile[data-i="${i}"]`); if (tile) tile.classList.add('chosen');
    $('#fxqChoices').classList.add('locked');
    ctx.send({ t: 'fx-ans', from: ctx.me.id, serial: quiz.serial, choice: i });
    clearTimeout(quiz.unlockTimer);
    quiz.unlockTimer = setTimeout(() => { if (!quiz.wait) { quiz.locked = false; showQuestion(); } }, 4000); // safety net
  }
  function onAnswerResult(ev) {
    if (!quiz.q) return;
    document.querySelectorAll('#fxqChoices .tile').forEach((tl) => { const txt = quiz.q.choices[Number(tl.dataset.i)]; if (txt === ev.right) tl.classList.add('right'); else if (Number(tl.dataset.i) === ev.pick) tl.classList.add('wrong'); });
    const fb = $('#fxqFeedback');
    if (ev.ok) { fb.innerHTML = ev.full ? `Right! You already have ${MAX_SAVED} shots saved.` : '+1 <span>⛳</span> shot!'; fb.className = 'quiz-feedback good'; Store.bump('correct'); }
    else { fb.innerHTML = `Not quite. The answer was <b>${esc(ev.right)}</b>`; fb.className = 'quiz-feedback bad'; }
    clearTimeout(quiz.unlockTimer);
    quiz.wait = true; quiz.readyAt = performance.now() + (ev.ok ? 250 : WRONG_WAIT); renderCont();
  }
  const WRONG_WAIT = 3000;
  function renderCont() {
    const el = $('#fxqCont'); clearTimeout(quiz.contTimer);
    if (!quiz.wait) { el.hidden = true; $('#fxQuiz').classList.remove('can-continue'); return; }
    const left = quiz.readyAt - performance.now();
    el.hidden = false;
    $('#fxQuiz').classList.toggle('can-continue', left <= 0);
    if (left > 0) {
      el.className = 'quiz-continue wait'; el.textContent = `Continue in ${Math.ceil(left / 1000)}…`;
      quiz.contTimer = setTimeout(renderCont, Math.min(left, ((left - 1) % 1000) + 1));
    } else { el.className = 'quiz-continue'; el.textContent = matchMedia('(pointer: coarse)').matches ? 'Tap anywhere to continue' : 'Click or press any key to continue'; }
  }
  function cont() {
    if (!quiz.wait || performance.now() < quiz.readyAt) return false;
    quiz.wait = false; quiz.locked = false; quiz.contAt = performance.now(); renderCont();
    if (quiz.next) showQuestion(); else showLoading();
    return true;
  }

  // ---------- input ----------
  function typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  function onKey(e, down) {
    if (!active) return;
    if (down && !e.repeat && quizOpen) {
      if (e.key !== 'Escape' && e.key !== ' ' && e.code !== 'Space' && cont()) { e.preventDefault(); return; } // Space and Esc always close
      if (/^[1-9]$/.test(e.key)) { answer(Number(e.key) - 1); e.preventDefault(); return; }
      if (e.key === 'Escape') { closeQuiz(); e.preventDefault(); return; }
    }
    if (typing()) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (down && !e.repeat) toggleQuiz(); return; }
    if (quizOpen) return;
    const k = e.key.toLowerCase();
    const map = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down' };
    if (map[k]) { keys[map[k]] = down; if (down && canShoot()) aim.kb = true; e.preventDefault(); }
    else if ((k === 'e' || k === 'enter') && down && !e.repeat) { useKey(); e.preventDefault(); }
  }
  // E (or the on-screen E button): show the aim first, then shoot with it
  function useKey() {
    if (!canShoot()) { if (amPlaying() && gameLive() && shotsOf(ctx.me.id) < 1) openQuiz(); return; }
    if (!aim.kb) { aim.kb = true; return; }
    shoot(Math.cos(aim.a) * aim.p * MAX_V, Math.sin(aim.a) * aim.p * MAX_V);
  }

  // ---------- HUD ----------
  function renderPrompt() {
    const el = $('#fxPrompt');
    let key = '', html = '', cls = '';
    if (amPlaying() && gameLive() && !between() && !quizOpen && fx.balls[ctx.me.id]) {
      const b = fx.balls[ctx.me.id], touch = matchMedia('(pointer: coarse)').matches;
      if (b.sunk) { key = 'sunk'; html = '<span>In the cup! Waiting for the others</span>'; cls = 'muted'; }
      else if (!atRest(ctx.me.id)) key = '';
      else if (shotsOf(ctx.me.id) < 1) { key = 'noshot'; html = '<kbd>Space</kbd><span>Answer a question to get a shot</span>'; cls = 'alert'; }
      else if (aim.kb) { key = 'kb'; html = touch ? '<span>◀ ▶ aim · ▲ ▼ power · E shoots</span>' : '<kbd>A</kbd><kbd>D</kbd><span>aim</span><kbd>W</kbd><kbd>S</kbd><span>power</span><kbd>E</kbd><span>shoot</span>'; }
      else { key = 'shoot' + touch; html = touch ? '<span>Drag back and let go to shoot</span>' : '<kbd>E</kbd><span>Aim with keys, or drag back and let go to shoot</span>'; }
    }
    if (key === prompt) return; prompt = key;
    el.hidden = !key; el.innerHTML = html;
    el.classList.toggle('muted', cls === 'muted'); el.classList.toggle('alert', cls === 'alert');
  }
  function renderShots() {
    const n = shotsOf(ctx.me.id), el = $('#gfShots');
    el.hidden = !(amPlaying() && S.phase === 'play');
    el.querySelectorAll('.pip').forEach((p, i) => p.classList.toggle('on', i < n));
    el.querySelector('b').textContent = n;
    el.classList.toggle('empty', n < 1 && gameLive());
    $('#fxQBtn').hidden = el.hidden;
  }
  function renderHud() {
    if (!fx || !S) return;
    const h = hole(), list = S.players.filter((p) => fx.sec[p.id] != null);
    list.sort((a, b) => totalToPar(a.id) - totalToPar(b.id) || totalStrokes(a.id, fx.hole) - totalStrokes(b.id, fx.hole));
    $('#fxBoard').innerHTML = list.slice(0, 8).map((p, i) => {
      const b = fx.balls[p.id], st = strokesOf(p.id, fx.hole);
      return `<li class="${p.id === ctx.me.id ? 'me' : ''}${p.gone ? ' gone' : ''}"><span class="rank">${i + 1}</span><span class="dot" style="background:${Scene.COLORS[p.look.c]}"></span><span class="nm">${esc(p.name)}</span><b class="hole-n" title="Strokes on this hole">${b && b.sunk ? '✓' : ''}${S.phase === 'lobby' ? '' : st}</b><b title="Total against par">${toPar(totalToPar(p.id))}</b></li>`;
    }).join('');
    $('#fxGoal').innerHTML = S.phase === 'play' ? `<span>Hole ${fx.hole + 1} of ${fx.holes} · ${esc(h.name)} · Par ${h.par}</span>` : '';
  }
  function statusText(s) {
    const f = s.fx;
    if (s.phase === 'lobby') return 'Lobby';
    if (s.phase === 'over') return 'Game over';
    if (!f || !f.startAt) return 'Starting';
    const T = now();
    if (T < f.startAt) return 'Starting…';
    if (f.between && T < f.between) return 'Next hole…';
    const left = Math.max(0, f.holeEnd - T);
    return `Hole ${f.hole + 1}/${f.holes} · ⏱ ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  }

  // ---------- events from the host ----------
  function handleEvents() {
    if (!fx || !fx.evs) return;
    if (lastEvN === -1) { lastEvN = fx.evs.length ? fx.evs[fx.evs.length - 1].n : 0; return; }
    for (const ev of fx.evs) {
      if (ev.n <= lastEvN) continue;
      lastEvN = ev.n;
      const mine = ev.id === ctx.me.id;
      if (ev.type === 'ans') { if (mine) onAnswerResult(ev); }
      else if (ev.type === 'hole') { const h = HOLES[ev.hole]; banner(`⛳ Hole ${ev.hole + 1}: <b>${esc(h.name)}</b> · Par ${h.par}`, 3000); aimAtCup(); }
      else if (ev.type === 'holeEnd' && amPlaying()) {
        const n = strokesOf(ctx.me.id, ev.hole), par = HOLES[ev.hole].par, sunk = ev.sunk && ev.sunk.includes(ctx.me.id);
        banner(sunk ? `Hole ${ev.hole + 1}: <b>${n}</b> strokes · ${scoreName(n, par)}` : `Time's up! Hole ${ev.hole + 1} counts as <b>${n}</b> strokes`, 4000);
      }
    }
  }
  // Effects when a roll finishes on this screen (the end of the animation, not when the message arrives).
  function rollEffects() {
    if (!fx || !fx.shot) return;
    for (const id in fx.shot) {
      const s = fx.shot[id]; if (!s || s.hole !== fx.hole || (seenEnd.get(id) || 0) >= s.n) continue;
      if (now() < shotStart(id, s) + s.dur) continue;
      seenEnd.set(id, s.n);
      const mine = id === ctx.me.id, p = player(id), h = hole(), r = pathOf(id, s, h);
      const ex = r.path[r.path.length - 2], ey = r.path[r.path.length - 1];
      if (s.water) { burst(ex, ey, 14, ['#9fd3f5', '#ffffff', '#4aa3dc'], 40); if (mine) floatText(ex, ey, 'Splash! +1 stroke', '#9fd3f5'); }
      else if (s.sunk) {
        burst(h.cup.x, h.cup.y, 20, ['#ffd166', '#7bd389', '#ffffff', colorOf(id)], 60);
        const n = strokesOf(id, fx.hole);
        if (mine) floatText(h.cup.x, h.cup.y - 12, scoreName(n, h.par), '#ffd166', 20);
        else banner(`⛳ <b>${esc(p ? p.name : 'Someone')}</b> sank it in ${n}!`, 2200);
      }
    }
  }

  // ---------- frame loop ----------
  function update(dt) {
    if (pred) {
      const s = fx.shot && fx.shot[ctx.me.id];
      if (s && s.n >= pred.n && now() >= Math.max(pred.start, s.at) + pred.r.dur) pred = null; // both copies have finished rolling: no jump back
      else if ((!s || s.n < pred.n) && performance.now() - pred.sentAt > 2500) pred = null; // the host turned the shot down
    }
    if (canShoot() && aim.kb) {
      aim.a += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * 2.2 * dt;
      aim.p = clamp(aim.p + ((keys.up ? 1 : 0) - (keys.down ? 1 : 0)) * 0.8 * dt, 0.05, 1);
    }
    if (fx && aim.holeSeen !== fx.hole && fx.balls && fx.balls[ctx.me.id]) aimAtCup();
    rollEffects();
  }
  function frame() {
    if (!active) return;
    const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (S) {
      layout(); update(dt); draw(t); renderPrompt(); renderShots();
      $('#gRound').textContent = statusText(S);
    }
    requestAnimationFrame(frame);
  }
  function resize() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    for (const c of [cv, tcv]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; }
    g = cv.getContext('2d'); tg = tcv.getContext('2d');
  }

  // ---------- host (authoritative) ----------
  let evN = 0, dirtyAt = 0;
  const host = {
    qsrc: [], qstate: new Map(),
    initState(opts) {
      const holes = clamp(Number(opts.gfHoles) || 3, 1, HOLES.length), secs = [60, 90, 120].includes(Number(opts.gfSecs)) ? Number(opts.gfSecs) : 90;
      return { holes, secs, sec: {}, shots: {}, strokes: {}, balls: {}, shot: {}, hole: 0, holeEnd: 0, between: 0, startAt: 0, evs: [] };
    },
    assignSections(S) {
      const f = S.fx; if (!f) return;
      if (S.phase === 'lobby') { f.sec = {}; S.players.forEach((p, i) => (f.sec[p.id] = i)); }
      for (const p of S.players) { if (f.shots[p.id] == null) f.shots[p.id] = 0; if (!f.strokes[p.id]) f.strokes[p.id] = []; }
    },
    start(S, src) {
      const f = S.fx;
      this.qsrc = (src || []).filter((q) => q.answers && q.answers.filter((a) => String(a).trim()).length);
      this.qstate.clear();
      this.reset(S);
      f.startAt = Date.now() + COUNTDOWN;
      this.beginHole(S, 0, f.startAt);
      S.phase = 'play';
      this.ev(S, { type: 'start' });
    },
    beginHole(S, i, at) {
      const f = S.fx, h = HOLES[i];
      f.hole = i; f.holeEnd = at + f.secs * 1000; f.between = 0;
      for (const id in f.sec) { f.balls[id] = { x: h.tee.x, y: h.tee.y, sunk: false }; (f.strokes[id] = f.strokes[id] || [])[i] = 0; }
      this.ev(S, { type: 'hole', hole: i });
    },
    reset(S) {
      const f = S.fx;
      Object.assign(f, { shots: {}, strokes: {}, balls: {}, shot: {}, hole: 0, holeEnd: 0, between: 0, startAt: 0, evs: [] });
      this.assignSections(S);
      S.players.forEach((p) => (p.score = 0));
    },
    ev(S, e) { const f = S.fx; f.evs.push({ n: ++evN, ...e }); if (f.evs.length > 30) f.evs.splice(0, f.evs.length - 30); dirtyAt = dirtyAt || Date.now(); },
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
      const id = m.from, p = S.players.find((q) => q.id === id); if (!p || p.gone || f.sec[id] == null) return;
      if (m.t === 'fx-q') { const st = this.qstate.get(id); if (!st || !st.cur) this.sendQuestion(S, id); return; }
      if (m.t === 'fx-ans') {
        const st = this.qstate.get(id);
        if (!st || !st.cur || m.serial !== st.serial) return;
        const ok = st.cur.choices[m.choice] === st.cur.right, full = ok && (f.shots[id] || 0) >= MAX_SAVED;
        if (ok && !full) f.shots[id] = (f.shots[id] || 0) + 1;
        this.ev(S, { type: 'ans', id, ok, full, right: st.cur.right, pick: m.choice });
        st.cur = null;
        this.sendQuestion(S, id);
        return;
      }
      if (m.t !== 'gf-shot') return;
      const T = Date.now(), b = f.balls[id], prev = f.shot[id];
      if (T < f.startAt || f.between || !b || b.sunk || (f.shots[id] || 0) < 1) return;
      if (prev && prev.hole === f.hole && T < prev.at + prev.dur) return; // still rolling
      const v = shotVel(Number(m.vx) || 0, Number(m.vy) || 0);
      if (v.vx * v.vx + v.vy * v.vy < 100) return;
      const r = simulate(HOLES[f.hole], b.x, b.y, v.vx, v.vy);
      f.shots[id]--;
      f.strokes[id][f.hole] = (f.strokes[id][f.hole] || 0) + 1 + (r.water ? 1 : 0);
      f.shot[id] = { n: (prev ? prev.n : 0) + 1, hole: f.hole, x0: b.x, y0: b.y, vx: v.vx, vy: v.vy, at: T + 120, dur: r.dur, water: r.water, sunk: r.sunk };
      if (!r.water) { b.x = r.x; b.y = r.y; }
      b.sunk = r.sunk;
      dirtyAt = dirtyAt || T;
    },
    endHole(S) {
      const f = S.fx, par = HOLES[f.hole].par, sunk = [];
      for (const id in f.sec) {
        const st = f.strokes[id] || (f.strokes[id] = []);
        if (f.balls[id] && f.balls[id].sunk) sunk.push(id);
        else st[f.hole] = Math.max((st[f.hole] || 0) + 1, par + 3);
      }
      for (const p of S.players) { let n = 0; for (let i = 0; i <= f.hole; i++) n += (f.strokes[p.id] || [])[i] || 0; p.score = n; }
      f.between = Date.now() + RECAP_MS;
      this.ev(S, { type: 'holeEnd', hole: f.hole, sunk });
    },
    tick(S, broadcast) {
      const f = S.fx; if (!f || S.phase !== 'play') return;
      const T = Date.now();
      if (T >= f.startAt) {
        if (f.between) {
          if (T >= f.between) {
            if (f.hole + 1 < f.holes) this.beginHole(S, f.hole + 1, T);
            else {
              const ps = S.players.filter((p) => f.sec[p.id] != null);
              ps.sort((a, b) => a.score - b.score);
              S.phase = 'over'; S.winner = ps.length ? ps[0].id : null;
              this.ev(S, { type: 'over', id: S.winner });
            }
            dirtyAt = 0; broadcast(); return;
          }
        } else {
          const ids = Object.keys(f.sec).filter((id) => { const p = S.players.find((q) => q.id === id); return p && !p.gone; });
          const rest = ids.every((id) => { const s = f.shot[id]; return !s || s.hole !== f.hole || T >= s.at + s.dur; });
          const allIn = ids.length > 0 && ids.every((id) => f.balls[id] && f.balls[id].sunk);
          if (rest && (allIn || T >= f.holeEnd)) { this.endHole(S); dirtyAt = 0; broadcast(); return; }
        }
      }
      if (dirtyAt && T - dirtyAt >= 80) { dirtyAt = 0; broadcast(); }
    },
  };

  // ---------- lifecycle ----------
  function activate() {
    if (active) return;
    active = true;
    $('#fxStage').hidden = false;
    if (!cv) {
      cv = $('#gfCanvas'); tcv = $('#gfText');
      wc = document.createElement('canvas'); wc.width = WS; wc.height = WS; wg = wc.getContext('2d');
      window.addEventListener('resize', () => active && resize());
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      window.addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; aim.drag = null; });
      cv.addEventListener('pointerdown', onPointerDown);
      cv.addEventListener('pointermove', onPointerMove);
      cv.addEventListener('pointerup', onPointerUp);
      cv.addEventListener('pointercancel', onPointerUp);
      const hold = (sel, k) => {
        const b = $(sel);
        const on = (e) => { if (!active) return; e.preventDefault(); keys[k] = true; if (canShoot()) aim.kb = true; }, off = () => { keys[k] = false; };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      };
      hold('#fxLeft', 'left'); hold('#fxRight', 'right'); hold('#fxUp', 'up'); hold('#fxDown', 'down');
      $('#fxUse').addEventListener('pointerdown', (e) => { if (!active) return; e.preventDefault(); useKey(); });
      $('#fxQBtn').addEventListener('click', () => { if (active) { openQuiz(); $('#fxQBtn').blur(); } });
      $('#fxQuizClose').addEventListener('click', () => active && closeQuiz());
      $('#fxQuiz').addEventListener('pointerdown', (e) => { if (active && !e.target.closest('#fxQuizClose') && cont()) e.preventDefault(); });
      $('#fxqChoices').addEventListener('click', (e) => { if (!active) return; const b = e.target.closest('.tile'); if (b) answer(Number(b.dataset.i)); });
    }
    $('#fxQBtn .bolt').textContent = '⛳'; // answers give shots here, not energy
    resize();
    last = performance.now();
    requestAnimationFrame(frame);
  }
  function deactivate() {
    const was = active;
    active = false;
    if (was && $('#fxStage')) $('#fxStage').hidden = true;
    parts.length = 0; floaters.length = 0; seenEnd.clear(); paths.clear();
    lastEvN = -1; fx = null; S = null; clockOffset = null; prompt = null; lastPhase = null; pred = null; holeCvFor = -1;
    keys.left = keys.right = keys.up = keys.down = false; Object.assign(aim, { kb: false, drag: null, holeSeen: -1 });
    if (was) {
      closeQuiz(); Object.assign(quiz, { q: null, serial: -1, locked: false, next: null, wait: false }); clearTimeout(quiz.unlockTimer); renderCont();
      if ($('#fxPrompt')) { $('#fxPrompt').hidden = true; $('#fxBanner').hidden = true; }
      $('#gfShots').hidden = true;
      $('#fxQuizClose').innerHTML = 'Back to factory <kbd>Space</kbd>';
      $('#fxQBtn .bolt').textContent = '⚡'; $('#fxqEnergy').hidden = false;
    }
  }
  function onState(s) {
    const prevPhase = lastPhase; lastPhase = s.phase;
    S = s; fx = s.fx;
    if (fx && fx.hostNow) { const off = fx.hostNow - Date.now(); if (clockOffset == null || off > clockOffset) clockOffset = off; }
    if (ctx.me.host) clockOffset = 0;
    activate();
    if (prevPhase && prevPhase !== s.phase && s.phase === 'lobby') { lastEvN = -1; seenEnd.clear(); paths.clear(); pred = null; }
    if (prevPhase && prevPhase !== s.phase && s.phase !== 'play') { closeQuiz(); Object.assign(quiz, { q: null, next: null, locked: false }); aim.drag = null; }
    if (s.phase === 'play' && prevPhase === 'lobby') {
      Object.assign(quiz, { q: null, next: null, locked: false });
      if (amPlaying()) setTimeout(openQuiz, 300); // everyone starts with no shots
    }
    handleEvents();
    renderHud();
    prompt = null;
  }

  // Read-only snapshot for automated tests, plus helpers so tests can shoot exactly.
  function debug() {
    return {
      phase: S && S.phase, started: gameLive(), hole: fx ? fx.hole : 0, shots: ctx ? shotsOf(ctx.me.id) : 0, canShoot: canShoot(), quizOpen,
      ball: ctx && fx && fx.balls ? ballView(ctx.me.id) : null, view: { ...view }, between: between(), aimKeys: aim.kb,
      balls: fx && fx.balls ? Object.fromEntries(Object.keys(fx.balls).map((id) => [id, ballView(id)])) : {},
    };
  }
  const test = {
    HOLES, simulate,
    shoot(vx, vy) { shoot(vx, vy); },
    toScreen,
  };

  return {
    HOLES, debug, test,
    attach(c) { ctx = c; },
    host,
    onState, onPos() {}, onQuestion, deactivate, statusText,
    isActive: () => active,
  };
})();

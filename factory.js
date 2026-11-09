// Puffer: Factory mode (2.5D).
// A factory floor with depth: walk left/right AND toward/away from the back wall (WASD / arrows).
// Each player owns a section:
//   back wall:  spawner → conveyor → compactor
//   on the floor (further forward): holo sell pad + SELL bin
// Answer multiple-choice questions for energy (host picks +50…+200, default +100). Energy drains 10/s
// while walking only (standing still is free);
// at 0 you freeze and drop what you hold until you answer more. E picks up / drops / steals / grabs floor items.
//
// Networking: the host is authoritative for pickups, bins, money, energy and the clock.
// Conveyor items are deterministic (seeded by section + spawn index). Positions use dead
// reckoning: position + walking direction are sent only on start / stop / turn (+1s correction).
window.Factory = (() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => UI.esc(s);

  // ---------- World layout (internal pixels). z = depth: 0 at the back wall, DZ at the front. ----------
  const SW = 440;                        // section width
  const DZ = 92;                         // floor depth
  const PERSP = 0.14;                    // the back of the floor is 14% narrower (one-point perspective)
  const SPAWNER = { x0: 16, x1: 58, z0: 0, z1: 18, h: 46 };
  const CONV = { x0: 58, x1: 252, z0: 2, z1: 16, h: 15, zi: 9 };
  const COMP = { x0: 252, x1: 298, z0: 0, z1: 20, h: 54 };
  const PAD = { x: 334, z: 56, rx: 22, rz: 9 };
  const BIN = { x0: 370, x1: 410, z0: 38, z1: 60, h: 30 };
  const BIN_C = { x: (BIN.x0 + BIN.x1) / 2, z: (BIN.z0 + BIN.z1) / 2 };
  const SOLIDS = [SPAWNER, CONV, COMP, BIN];          // footprints you can't walk through
  const SPEED = 26;                      // belt speed px/s
  const INTERVAL = 1700;                 // ms between spawns
  const RIDE = ((CONV.x1 - CONV.x0) / SPEED) * 1000;
  const WALK = 95, WALKZ = 62, ACCEL = 900;
  const GRAB_MS = 600;                   // stand still this long to pick something up off the floor
  const SLOW_SELL = 10000, FAST_SELL = 1000; // bin on its own: 1 item / 10 s; standing on the pad: 1 / s
  const COUNTDOWN = 3500;
  const GAIN_DEFAULT = 100, DRAIN_IDLE = 0, DRAIN_WALK = 10;
  const gain = () => (fx && fx.gain) || GAIN_DEFAULT;
  const TILE_COLORS = ['amber', 'teal', 'pink', 'blue', 'purple', 'green', 'orange', 'slate'];

  // 20 items in 6 tiers. r = tier rank (0 Common … 5 Mythical); w = spawn weight (tier odds split evenly).
  const ITEMS = [
    { name: 'Clay Pot', tier: 'Common', r: 0, color: '#c3cdd8', value: 5, w: 10.8,
      map: ['..OOOO..', '...oo...', '..oooo..', '.ohoooo.', '.ohoooO.', '.ooooOO.', '..oOOO..', '...OO...'], pal: { o: '#c8743c', O: '#8a4a22', h: '#eaa36d' } },
    { name: 'Bread Loaf', tier: 'Common', r: 0, color: '#c3cdd8', value: 4, w: 10.8,
      map: ['........', '..BBBB..', '.BhhbbB.', 'BhbhbbbB', 'BbbbhbbB', 'BbbbbbbB', '.BBBBBB.', '........'], pal: { b: '#d9a05b', B: '#9a6330', h: '#f3d19a' } },
    { name: 'Wax Tablet', tier: 'Common', r: 0, color: '#c3cdd8', value: 6, w: 10.8,
      map: ['WWWWWWWW', 'WxxxxxxW', 'WxllxlxW', 'WxxxxxxW', 'WxlxllxW', 'WxxxxxxW', 'WWWWWWWW', '........'], pal: { W: '#8a5a2c', x: '#3b3f4a', l: '#c9b27a' } },
    { name: 'Amphora', tier: 'Common', r: 0, color: '#c3cdd8', value: 7, w: 10.8,
      map: ['...OO...', '.O.oo.O.', '.OOooOO.', '..ohoo..', '.ohooOo.', '.ohoooO.', '..oooO..', '...OO...'], pal: { o: '#b8673a', O: '#7a3e1c', h: '#e59a68' } },
    { name: 'Wool Ball', tier: 'Common', r: 0, color: '#c3cdd8', value: 5, w: 10.8,
      map: ['..WWWW..', '.WwwhwW.', 'WwhwwwwW', 'WwwwhwwW', 'WwhwwwwW', 'WwwwwhwW', '.WwwwwW.', '..WWWW..'], pal: { w: '#efe6d8', W: '#b8ab96', h: '#ffffff' } },
    { name: 'Bronze Coin', tier: 'Uncommon', r: 1, color: '#7bd389', value: 12, w: 6.5,
      map: ['..YYYY..', '.YhhyyY.', 'YhyYYyyY', 'YhyYyyyY', 'YyyYYyyY', 'YyyyyyyY', '.YyyyyY.', '..YYYY..'], pal: { y: '#d08a3c', Y: '#8a5520', h: '#f3c07a' } },
    { name: 'Papyrus Scroll', tier: 'Uncommon', r: 1, color: '#7bd389', value: 14, w: 6.5,
      map: ['r......r', 'rPPPPPPr', 'rpllplpr', 'rpppppPr', 'rplplppr', 'rpppppPr', 'rPPPPPPr', 'r......r'], pal: { p: '#ead8a6', P: '#b09452', r: '#7a4a24', l: '#6b5a3a' } },
    { name: 'Leather Sandal', tier: 'Uncommon', r: 1, color: '#7bd389', value: 11, w: 6.5,
      map: ['...s....', '..sLs...', '.s.L.s..', '.LLLLL..', '.llllll.', 'Llllllll', 'LLLLLLLL', '........'], pal: { l: '#a8693a', L: '#6b3e1c', s: '#d89a5c' } },
    { name: 'Grape Bunch', tier: 'Uncommon', r: 1, color: '#7bd389', value: 10, w: 6.5,
      map: ['....sg..', '...sgg..', '.vVvVv..', '.hvvvVv.', '..vhvV..', '..vvVv..', '...vV...', '....v...'], pal: { v: '#8e4bd0', V: '#5a2690', h: '#c79bf5', g: '#6cbf4a', s: '#7a4a24' } },
    { name: 'Oil Lamp', tier: 'Rare', r: 2, color: '#4cc9f0', value: 30, w: 3.1,
      map: ['......f.', '.....rf.', '......B.', '..bbbbb.', '.bhbbbbB', 'bbbbbbB.', '.BBBBB..', '..BB....'], pal: { b: '#9fb8cf', B: '#5d7690', h: '#e3f1ff', f: '#ffd166', r: '#ff7b3a' } },
    { name: 'Silver Denarius', tier: 'Rare', r: 2, color: '#4cc9f0', value: 34, w: 3.1,
      map: ['..SSSS..', '.ShsssS.', 'SssfffsS', 'SsffsfsS', 'SsfffssS', 'SssfsssS', '.SsssSS.', '..SSSS..'], pal: { s: '#dfe6ee', S: '#8a96a3', h: '#ffffff', f: '#b9c3cf' } },
    { name: 'Mosaic Tile', tier: 'Rare', r: 2, color: '#4cc9f0', value: 28, w: 3.1,
      map: ['KKKKKKKK', 'KabKcdaK', 'KdcKbacK', 'KKKKKKKK', 'KcaKdbcK', 'KbdKacdK', 'KKKKKKKK', '........'], pal: { a: '#2ec4b6', b: '#ff7b3a', c: '#ffd166', d: '#4a6cd8', K: '#2a2f3a' } },
    { name: 'Bronze Helmet', tier: 'Rare', r: 2, color: '#4cc9f0', value: 32, w: 3.1,
      map: ['.rrrrrr.', 'rrRRRRrr', '..YYYY..', '.YhyyyY.', 'YhyyyyyY', 'Yyy..yyY', 'Yy....yY', 'YY....YY'], pal: { y: '#d08a3c', Y: '#8a5520', h: '#f3c07a', r: '#d8323c', R: '#8e1a22' } },
    { name: 'Gladius', tier: 'Epic', r: 3, color: '#b77dff', value: 75, w: 1.75,
      map: ['.......s', '......sS', '.....sS.', '....sS..', '.g.sS...', '..gg....', '.wg.g...', 'w.......'], pal: { s: '#eef3f8', S: '#9aa7b5', g: '#ffd166', w: '#7a4a24' } },
    { name: 'Laurel Wreath', tier: 'Epic', r: 3, color: '#b77dff', value: 70, w: 1.75,
      map: ['..gGGg..', '.g....g.', 'G......G', 'g......g', 'G......G', '.g....g.', '..gyyg..', '...yy...'], pal: { g: '#7fd35a', G: '#3e8a2a', y: '#ffd166' } },
    { name: 'Marble Bust', tier: 'Epic', r: 3, color: '#b77dff', value: 85, w: 1.75,
      map: ['..MMMM..', '.MmmhmM.', '.MmMmmM.', '.MmmmmM.', '..MmmM..', '.MmmmmmM', '..pppp..', '.pppppp.'], pal: { m: '#eef0f3', M: '#a9b0ba', h: '#ffffff', p: '#7c8592' } },
    { name: 'Golden Aquila', tier: 'Legendary', r: 4, color: '#ffb238', value: 200, w: 0.85,
      map: ['G.....G.', 'GG.gg.GG', 'gGGggGGg', '.gggggg.', '..gGGg..', '...gg...', '..g..g..', '.GGGGGG.'], pal: { g: '#ffd166', G: '#c99a12' } },
    { name: 'Golden Lyre', tier: 'Legendary', r: 4, color: '#ffb238', value: 220, w: 0.85,
      map: ['G......G', 'g......g', 'gGGGGGGg', 'gs.s.s.g', 'gs.s.s.g', '.gs.s.g.', '..gGGg..', '...GG...'], pal: { g: '#ffd166', G: '#c99a12', s: '#fff3c4' } },
    { name: 'Orb of Jupiter', tier: 'Mythical', r: 5, color: '#ff5dc8', value: 500, w: 0.25,
      map: ['..PPPP..', '.PpphhP.', 'PppphwhP', 'PpppphpP', 'PpppppPP', 'PPppPPP.', '.PPPPP..', '..ggg...'], pal: { p: '#ff5dc8', P: '#9b1d7a', h: '#ffd6f2', w: '#ffffff', g: '#ffd166' } },
    { name: 'Trident of Neptune', tier: 'Mythical', r: 5, color: '#ff5dc8', value: 550, w: 0.25,
      map: ['.t..t..t', '.T..T..T', '.TtttttT', '....s...', '....s...', '....s...', '....s...', '....T...'], pal: { t: '#4ce0ff', T: '#1a7fa8', s: '#ffd166' } },
  ];
  const NOTIFY_TIER = 4; // tier rank: Legendary and up, everyone is told
  const TOTAL_W = ITEMS.reduce((a, it) => a + it.w, 0);

  // Tiny pixel font so labels painted on machines move exactly with them.
  const FONT = {
    S: ['111', '100', '111', '001', '111'], E: ['111', '100', '110', '100', '111'], L: ['100', '100', '100', '100', '111'],
    x: ['000', '101', '010', '101', '000'], 0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
    2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '011', '001', '111'], 4: ['101', '101', '111', '001', '001'],
    5: ['111', '100', '111', '001', '111'], 6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'],
    8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'], '+': ['000', '010', '111', '010', '000'],
  };

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix32 = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16; return h >>> 0; };
  function hash32(a, b, c, d = 0) {
    let h = mix32(a >>> 0);
    h = mix32((h ^ Math.imul(b + 1, 0x9e3779b9)) >>> 0);
    h = mix32((h ^ Math.imul(c + 1, 0x85ebca6b)) >>> 0);
    h = mix32((h ^ Math.imul(d + 1, 0xc2b2ae35)) >>> 0);
    return h / 4294967296;
  }
  const pickItem = (r) => { r *= TOTAL_W; for (let i = 0; i < ITEMS.length; i++) { if ((r -= ITEMS[i].w) < 0) return i; } return 0; };
  // Which item spawn k on section sec is. Deterministic (every browser agrees), different for every
  // player's conveyor, and re-rolled once if it would repeat the item just before it.
  function rarityFor(seed, sec, k) {
    const a = pickItem(hash32(seed, sec, k));
    if (k > 0 && a === pickItem(hash32(seed, sec, k - 1))) return pickItem(hash32(seed, sec, k, 1));
    return a;
  }
  const money = (n) => '$' + Math.round(n).toLocaleString();
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const secX = (s) => s * SW;
  const offsetFor = (s) => (s * 577) % INTERVAL;
  const spawnTime = (fx, s, k) => fx.startAt + offsetFor(s) + k * INTERVAL;
  const near = (x, z, cx, cz, rx, rz) => Math.abs(x - cx) < rx && Math.abs(z - cz) < rz;

  // ---------- module state ----------
  let ctx = null;              // hooks into Game (me, send)
  let active = false;
  let cv, g, tcv, tg, W = 480, H = 270, SCALE = 2, dpr = 1, backY = 120, groundY = 120;
  let layers = null;
  let camX = 0, cam = 0, VC = 240, last = 0;
  let clockOffset = null;      // host time - local time
  let fx = null, S = null;     // latest state
  const me = { x: 0, z: 70, vx: 0, vz: 0, f: 1, dx: 0, dz: 0, moving: false, placed: false, sent: 0, sentV: null, sentX: null, sentZ: null };
  const others = new Map();    // id -> { x, z, bx, bz, vx, vz, at, m }
  const keys = { left: false, right: false, up: false, down: false };
  const parts = [], floaters = [];
  let pending = null;          // optimistic pickup { sec, k, item, at }
  let lastEvN = -1, prompt = null, bannerTimer = 0, lastPhase = null;
  const eaten = new Set();
  let quizOpen = false;
  const quiz = { q: null, serial: -1, locked: false, next: null, unlockTimer: 0, wait: false, readyAt: 0, contTimer: 0 };
  let energyAt = { v: 0, t: 0 };

  const now = () => Date.now() + (clockOffset || 0);   // shared game clock (host time)

  // ---------- projection: world (x, z, height) → screen ----------
  const SX = (x, z) => { const wx = x - cam, k = 1 - (PERSP * (DZ - z)) / DZ; return VC + (wx - VC) * k; };
  const SY = (z, h = 0) => backY + z - h;
  const KZ = (z) => 1 - (PERSP * (DZ - z)) / DZ;

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
  function poly(pts, color) {
    g.fillStyle = color;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.round(minY); y < Math.round(maxY); y++) {
      const yc = y + 0.5; let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((yc >= y1 && yc < y2) || (yc >= y2 && yc < y1)) { const x = x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1); lo = Math.min(lo, x); hi = Math.max(hi, x); }
      }
      if (hi > lo) g.fillRect(Math.round(lo), y, Math.round(hi) - Math.round(lo), 1);
    }
  }
  function line(x0, y0, x1, y1, c) {
    g.fillStyle = c;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) g.fillRect(Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n)), 1, 1);
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
  function pixelText(str, x, y, color) {
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = color;
    for (const ch of str) {
      const gl = FONT[ch]; if (gl) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (gl[j][i] === '1') g.fillRect(x + i, y + j, 1, 1);
      x += 4;
    }
  }
  const pixelTextW = (str) => str.length * 4 - 1;
  // Crisp overlay text, in SCREEN coordinates (camera already applied).
  function text(str, x, y, color = '#fff', size = 7, align = 'center', alpha = 1) {
    const k = SCALE * dpr, px = Math.round(size * k * 0.9);
    tg.globalAlpha = alpha;
    tg.font = `700 ${px}px 'Pixelify Sans', sans-serif`;
    tg.textAlign = align; tg.textBaseline = 'middle';
    const X = Math.round(x) * k, Y = Math.round(y) * k;
    tg.lineJoin = 'round'; tg.lineWidth = Math.max(3, px * 0.24); tg.strokeStyle = '#070b12'; tg.strokeText(str, X, Y);
    tg.fillStyle = color; tg.fillText(str, X, Y);
    tg.globalAlpha = 1;
  }

  // A 3D box on the floor: x0..x1, z0 (back) .. z1 (front), height h, raised by `base`.
  // Faces: top, front, and whichever side faces the middle of the screen.
  function box(x0, x1, z0, z1, h, col, base = 0) {
    const yb = SY(z1, base), yt = yb - h, yb0 = SY(z0, base), yt0 = yb0 - h;
    const fl = SX(x0, z1), fr = SX(x1, z1), bl = SX(x0, z0), br = SX(x1, z0);
    const edge = col.edge || '#0b1320';
    if (br > fr + 0.6) { poly([[fr, yb], [fr, yt], [br, yt0], [br, yb0]], col.side); line(br, yt0, br, yb0, edge); }
    if (bl < fl - 0.6) { poly([[fl, yb], [fl, yt], [bl, yt0], [bl, yb0]], col.side); line(bl, yt0, bl, yb0, edge); }
    poly([[fl, yt], [fr, yt], [br, yt0], [bl, yt0]], col.top);
    line(bl, yt0, br, yt0, edge);
    rect(col.front, fl, yt, fr - fl, h);
    rect(col.hi || col.top, fl, yt, fr - fl, 1);
    rect(edge, fl - 1, yt, 1, h + 1); rect(edge, fr, yt, 1, h + 1); rect(edge, fl, yb, fr - fl, 1);
    line(fl, yt, bl, yt0, edge); line(fr, yt, br, yt0, edge);
    return { fl: Math.round(fl), fr: Math.round(fr), yt: Math.round(yt), yb: Math.round(yb), w: Math.round(fr - fl), bl, br, yt0 };
  }

  // ---------- parallax layers (procedural pixel machinery behind the back wall) ----------
  function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeLayer(tw, draw) { const c = document.createElement('canvas'); c.width = tw; c.height = H; draw(c.getContext('2d'), mulberry(tw * 7 + H)); return c; }
  function buildLayers() {
    const sky = makeLayer(4, (c) => {
      const stops = ['#121a29', '#162034', '#1a263b', '#1d2a40', '#202e45'];
      for (let y = 0; y < H; y++) { c.fillStyle = stops[Math.min(stops.length - 1, Math.floor((y / backY) * stops.length))]; c.fillRect(0, y, 4, 1); }
    });
    const far = makeLayer(520, (c, r) => {
      const base = groundY;
      for (let i = 0; i < 9; i++) {
        const x = r() * 520, w = 30 + r() * 50, h = 30 + r() * (backY * 0.7);
        c.fillStyle = ['#1f2a3e', '#222f45', '#1c2639'][i % 3]; c.fillRect(Math.round(x), Math.round(base - h), Math.round(w), Math.round(h));
        c.fillRect(Math.round(x + 2), Math.round(base - h - 3), Math.round(w - 4), 3);
        c.fillStyle = 'rgba(255,200,90,.16)';
        for (let wy = base - h + 8; wy < base - 10; wy += 10) for (let wx = x + 5; wx < x + w - 6; wx += 9) if (r() < 0.45) c.fillRect(Math.round(wx), Math.round(wy), 3, 4);
      }
      for (let i = 0; i < 4; i++) {
        const x = r() * 520, h = backY * 0.8 + r() * backY * 0.2;
        c.fillStyle = '#1a2335'; c.fillRect(Math.round(x), Math.round(base - h), 10, Math.round(h));
        c.fillStyle = '#2a3650'; c.fillRect(Math.round(x - 1), Math.round(base - h), 12, 3); c.fillRect(Math.round(x - 1), Math.round(base - h + 12), 12, 2);
      }
    });
    const mid = makeLayer(560, (c, r) => {
      const cw = Math.round(backY * 0.42);
      c.fillStyle = '#2a3549'; c.fillRect(0, cw, 560, 3);
      for (let x = 0; x < 560; x += 14) c.fillRect(x, cw - 9, 2, 9);
      c.fillRect(0, cw - 9, 560, 2);
      for (let i = 0; i < 3; i++) {
        const y = Math.round(backY * (0.12 + i * 0.12 + r() * 0.04)), th = 5 + Math.round(r() * 4);
        c.fillStyle = '#2d3a51'; c.fillRect(0, y, 560, th);
        c.fillStyle = '#3c4b66'; c.fillRect(0, y, 560, 1);
        c.fillStyle = '#243046'; for (let x = Math.round(r() * 40); x < 560; x += 46) c.fillRect(x, y - 2, 4, th + 4);
      }
      for (let i = 0; i < 4; i++) {
        const x = Math.round(30 + i * 140 + r() * 40), w = 34 + Math.round(r() * 16), top = Math.round(groundY - 50 - r() * 30);
        c.fillStyle = '#2b374d'; c.fillRect(x, top, w, groundY - top);
        c.fillStyle = '#36445e'; c.fillRect(x, top, w, 2); c.fillRect(x + 2, top + 2, 3, groundY - top - 2);
        c.fillStyle = i % 2 ? '#2ec4b6' : '#7bd389'; c.globalAlpha = 0.5; c.fillRect(x + w / 2 - 4, top + 10, 8, 20); c.globalAlpha = 1;
      }
    });
    const near = makeLayer(600, (c, r) => {
      for (let i = 0; i < 2; i++) {
        const y = Math.round(backY * (0.06 + i * 0.09)), th = 9;
        c.fillStyle = '#34425a'; c.fillRect(0, y, 600, th);
        c.fillStyle = '#4a5b78'; c.fillRect(0, y + 1, 600, 2);
        c.fillStyle = '#28334a'; c.fillRect(0, y + th - 2, 600, 2);
        for (let x = Math.round(r() * 60); x < 600; x += 70) { c.fillStyle = '#2a3549'; c.fillRect(x, y - 2, 5, th + 4); }
      }
      for (let i = 0; i < 4; i++) {
        const x = Math.round(40 + i * 150 + r() * 60), len = Math.round(backY * (0.15 + r() * 0.15));
        c.fillStyle = '#3a4760'; for (let y = Math.round(backY * 0.22); y < backY * 0.22 + len; y += 3) c.fillRect(x, y, 2, 2);
        const hy = Math.round(backY * 0.22 + len);
        c.fillRect(x - 2, hy, 6, 2); c.fillRect(x + 2, hy + 2, 2, 4); c.fillRect(x - 1, hy + 5, 4, 2);
      }
    });
    const fg = makeLayer(640, (c, r) => {
      c.fillStyle = '#0a0f18';
      c.fillRect(0, 0, 640, 7); c.fillRect(0, 7, 640, 2);
      for (let x = 0; x < 640; x += 32) { c.fillRect(x, 7, 3, 8); }
      for (let i = 0; i < 3; i++) {
        const x = Math.round(60 + i * 210 + r() * 40);
        c.fillRect(x, 9, 2, 16); c.fillRect(x - 6, 25, 14, 4); c.fillStyle = 'rgba(255,190,90,.35)'; c.fillRect(x - 5, 29, 12, 2); c.fillStyle = '#0a0f18';
      }
      const by = H - 5;
      c.fillRect(0, by, 640, 5);
      for (let x = Math.round(r() * 30); x < 640; x += 64) { c.fillRect(x, by - 10, 3, 10); c.fillRect(x - 1, by - 11, 5, 2); }
      c.fillStyle = '#121a27'; c.fillRect(0, by - 6, 640, 2);
    });
    layers = { sky, far, mid, near, fg };
  }
  function drawLayer(c, factor, alpha = 1, clipY = H) {
    const tw = c.width;
    let off = -((cam * factor) % tw); if (off > 0) off -= tw;
    g.globalAlpha = alpha;
    for (let x = Math.round(off); x < W; x += tw) g.drawImage(c, 0, 0, tw, clipY, x, 0, tw, clipY);
    g.globalAlpha = 1;
  }

  // ---------- state lookups ----------
  function ownerOf(sec) { if (!fx) return null; for (const id in fx.sec) if (fx.sec[id] === sec) return id; return null; }
  function player(id) { return S ? S.players.find((p) => p.id === id) : null; }
  function colorOf(id) { const p = player(id); return p ? Scene.COLORS[p.look.c] || '#fff' : '#888'; }
  const nSections = () => Math.max(1, fx ? Object.keys(fx.sec).length : 1);
  const worldW = () => nSections() * SW;
  function posOf(id) {
    if (ctx && id === ctx.me.id && me.placed) return { x: me.x, z: me.z };
    const o = others.get(id); return o ? { x: o.x, z: o.z } : null;
  }
  function heldOf(id) {
    if (ctx && id === ctx.me.id && pending && now() - pending.at < 1500) return pending.item;
    return fx && fx.held ? fx.held[id] : null;
  }
  function onPad(id) {
    const p = posOf(id); if (!p || !fx || fx.sec[id] == null) return false;
    const cx = secX(fx.sec[id]) + PAD.x;
    return ((p.x - cx) / PAD.rx) ** 2 + ((p.z - PAD.z) / PAD.rz) ** 2 <= 1;
  }

  // ---------- floor & back wall ----------
  function drawFloor(t) {
    // floor rows get taller toward the front (perspective)
    const rows = [0, 7, 15, 25, 37, 51, 67, 84, DZ];
    for (let i = 0; i < rows.length - 1; i++) rect(i % 2 ? '#3b4558' : '#38425a', 0, SY(rows[i]), W, SY(rows[i + 1]) - SY(rows[i]));
    for (const z of rows.slice(1, -1)) rect('#2f3849', 0, SY(z), W, 1);
    rect('#56627a', 0, SY(0), W, 1);
    // seams converge toward the middle of the screen
    const x0 = Math.floor((cam - W) / 34) * 34;
    for (let x = x0; x < cam + W * 2; x += 34) {
      const a = SX(x, 0), b = SX(x, DZ);
      if (Math.max(a, b) < -2 || Math.min(a, b) > W + 2) continue;
      line(a, SY(0), b, SY(DZ), '#30394a');
      for (const z of [15, 51]) rect('#4b5670', SX(x, z) + 2, SY(z) + 2, 1, 1);
    }
    // front lip
    rect('#56627a', 0, SY(DZ), W, 1);
    rect('#262d3a', 0, SY(DZ) + 1, W, H - SY(DZ) - 1);
    for (let x = -((cam * 1) % 18) - 18; x < W; x += 18) rect('#2e3646', x, SY(DZ) + 3, 9, 2);
  }

  function drawWall(s, t) {
    const X = secX(s), owner = ownerOf(s), oc = owner ? colorOf(owner) : '#5f7f98';
    const l = SX(X + 4, 0), r = SX(X + SW - 4, 0), top = backY - 92;
    if (r < -10 || l > W + 10) return;
    g.globalAlpha = 0.55; rect('#0d1422', l, top, r - l, 92); g.globalAlpha = 1;
    rect(oc, l, top, r - l, 2);
    rect('#1a2335', l, top + 2, r - l, 1);
    // wall details: pipe run, vent, lamp with light cone, hazard sign by the compactor
    const pipeY = top + 14;
    rect('#34425a', l, pipeY, r - l, 4); rect('#4a5b78', l, pipeY, r - l, 1);
    for (let x = X + 30; x < X + SW - 10; x += 70) rect('#2a3549', SX(x, 0), pipeY - 1, 3, 6);
    const vx = SX(X + 120, 0);
    rect('#1b2333', vx, top + 30, 26, 14);
    for (let i = 0; i < 4; i++) rect('#2c3850', vx + 2, top + 32 + i * 3, 22, 1);
    const lx = SX(X + 200, 0);
    rect('#2a3549', lx + 3, top + 2, 2, 22); rect('#0b1320', lx - 2, top + 24, 12, 4);
    const glow = 0.12 + 0.03 * Math.sin(t / 700 + s);
    g.globalAlpha = glow; poly([[lx - 1, top + 28], [lx + 9, top + 28], [lx + 40, backY + 40], [lx - 32, backY + 40]], '#ffd59a'); g.globalAlpha = 1;
    rect('#ffd59a', lx, top + 27, 8, 1);
    const hx = SX(X + COMP.x0 + 12, 0);
    rect('#0b1320', hx - 1, top + 38, 18, 15); rect('#ffd166', hx, top + 39, 16, 13);
    poly([[hx + 8, top + 41], [hx + 14, top + 50], [hx + 2, top + 50]], '#14141f'); rect('#ffd166', hx + 7, top + 44, 2, 3); rect('#ffd166', hx + 7, top + 48, 2, 1);
    // divider pillar between sections
    const px = SX(X + SW, 0);
    for (let y = top; y < backY; y += 6) rect((Math.floor((y - top) / 6) % 2) ? '#ffd166' : '#14141f', px - 3, y, 6, 6);
    text(owner && player(owner) ? `${player(owner).name}'s factory` : 'Empty section', SX(X + SW / 2, 0), top + 8, oc, 6.5);
  }

  function drawFloorMarks(s, t) {
    const X = secX(s), owner = ownerOf(s);
    if (SX(X + SW, DZ) < -20 || SX(X, DZ) > W + 20) return;
    // section divider painted on the floor
    for (let z = 0; z < DZ; z += 6) { const c = Math.floor(z / 6) % 2 ? '#ffd166' : '#14141f'; poly([[SX(X + SW - 1.5, z), SY(z)], [SX(X + SW + 1.5, z), SY(z)], [SX(X + SW + 1.5, z + 6), SY(z + 6)], [SX(X + SW - 1.5, z + 6), SY(z + 6)]], c); }
    // hazard zone in front of the compactor
    for (let z = COMP.z1 + 1; z < COMP.z1 + 9; z++) {
      const a = SX(X + COMP.x0, z), b = SX(X + COMP.x1, z), y = SY(z);
      for (let x = Math.round(a); x < b; x++) if ((x + y) % 8 < 4) { g.fillStyle = 'rgba(255,209,102,.55)'; g.fillRect(x, y, 1, 1); }
    }
    // dashed walkway from the belt to the bin, with an arrow
    for (let x = X + 70; x < X + BIN.x0 - 18; x += 14) poly([[SX(x, 31), SY(31)], [SX(x + 7, 31), SY(31)], [SX(x + 7, 33), SY(33)], [SX(x, 33), SY(33)]], 'rgba(255,209,102,.45)');
    const ax = X + BIN.x0 - 18;
    poly([[SX(ax, 27), SY(27)], [SX(ax + 8, 32), SY(32)], [SX(ax, 37), SY(37)]], 'rgba(255,209,102,.6)');
    // floor grate next to the pad
    const gx = SX(X + 300, 78), gy = SY(78);
    rect('#262d3a', gx - 12, gy - 3, 24, 6); for (let i = -10; i < 12; i += 3) rect('#3d475b', gx + i, gy - 2, 1, 4);
    // sell pad
    drawPad(s, owner, t);
  }

  function drawPad(s, owner, t) {
    const X = secX(s), cx = SX(X + PAD.x, PAD.z), cy = SY(PAD.z), rx = PAD.rx * KZ(PAD.z);
    const on = owner && onPad(owner);
    ellipse(cx, cy + 1, rx + 2, PAD.rz + 2, '#0b1320');
    ellipse(cx, cy + 1, rx + 1, PAD.rz + 1, '#7a5a1c');
    ellipse(cx, cy, rx, PAD.rz, on ? '#ffe08a' : '#e0a93a');
    ellipse(cx, cy, rx - 5, PAD.rz - 3, on ? '#fff3c4' : '#ffd166');
    ellipse(cx, cy, rx - 11, PAD.rz - 5, on ? '#ffe08a' : '#f0be4e');
    for (let i = 0; i < 12; i++) {
      if (i % 2) continue;
      const a = (i / 12) * Math.PI * 2 + t / (on ? 180 : 600);
      rect('#fff3c4', cx + Math.cos(a) * (rx - 2), cy + Math.sin(a) * (PAD.rz - 1), 2, 1);
    }
    for (let i = -2; i <= 2; i++) {
      const h = Math.round(16 + Math.sin(t / 300 + i * 1.7) * 6 + (on ? 14 : 0));
      for (let y = 0; y < h; y++) { g.globalAlpha = (on ? 0.5 : 0.22) * (1 - y / h); rect(i % 2 ? '#fff3c4' : '#ffd166', cx + i * 6, cy - 2 - y, 1, 1); }
    }
    g.globalAlpha = 1;
    if (Math.random() < (on ? 0.4 : 0.07)) parts.push({ x: X + PAD.x + (Math.random() - 0.5) * PAD.rx * 1.6, z: PAD.z, y: cy - 2, vx: 0, vy: -18 - Math.random() * 14, g: 0, life: 0, max: 0.9, c: '#ffe08a', s: 1 });
    if (on) text('FAST SELL', cx, cy - 36, '#ffd166', 5);
  }

  // ---------- machines ----------
  const GREY = { top: '#aeb9c9', hi: '#cdd6e2', front: '#7f8ca0', side: '#5c6880' };
  const DARK = { top: '#8e9aae', hi: '#b3bece', front: '#66738a', side: '#4c576c' };
  function drawSpawner(s, t, live) {
    const X = secX(s);
    const b = box(X + SPAWNER.x0, X + SPAWNER.x1, SPAWNER.z0, SPAWNER.z1, SPAWNER.h, GREY);
    // panel lines, rivets, screen, status lamp
    rect('#6d7a8f', b.fl + 2, b.yt + 14, b.w - 4, 1);
    rect('#0d1320', b.fl + 5, b.yt + 4, 16, 8); rect('#14324a', b.fl + 6, b.yt + 5, 14, 6);
    const scan = Math.floor(t / 120) % 14; rect('#4cc9f0', b.fl + 6 + scan, b.yt + 7, 1, 2);
    const blink = live && ((now() - fx.startAt - offsetFor(s)) % INTERVAL) < 300;
    rect('#0b1320', b.fr - 9, b.yt + 4, 6, 6); rect(blink ? '#7bd389' : '#2f5a3b', b.fr - 8, b.yt + 5, 4, 4);
    for (const [rx, ry] of [[2, 2], [b.w - 3, 2], [2, SPAWNER.h - 3], [b.w - 3, SPAWNER.h - 3]]) rect('#55627a', b.fl + rx, b.yt + ry, 1, 1);
    // output chute at belt height
    const cy = SY(SPAWNER.z1, CONV.h) - 2;
    rect('#0b1320', b.fr - 10, cy - 10, 10, 11); rect('#05070b', b.fr - 9, cy - 9, 9, 9);
    rect('#ffd166', b.fr - 10, cy - 11, 10, 1);
    // hopper + feed pipe
    box(X + SPAWNER.x0 + 8, X + SPAWNER.x1 - 10, 4, 14, 8, DARK, SPAWNER.h);
    rect('#34425a', SX(X + SPAWNER.x0 + 18, 9), backY - 92 + 18, 4, SY(9, SPAWNER.h + 8) - (backY - 92 + 18));
  }

  function drawConveyor(s, t, live) {
    const X = secX(s);
    const z0 = CONV.z0, z1 = CONV.z1, x0 = X + CONV.x0, x1 = X + CONV.x1;
    // legs
    for (let x = x0 + 8; x < x1 - 4; x += 24) {
      const lx = SX(x, z1);
      rect('#232a37', lx, SY(z1, CONV.h - 6), 3, CONV.h - 6); rect('#232a37', SX(x, z0 + 3) , SY(z0 + 3, CONV.h - 6), 2, CONV.h - 6);
    }
    rect('#232a37', SX(x0 + 8, z1), SY(z1, 4), SX(x1 - 8, z1) - SX(x0 + 8, z1), 1);
    // frame (a thin box on legs) + belt surface
    const b = box(x0, x1, z0, z1, 5, { top: '#2a3140', hi: '#3a4456', front: '#5d6a7e', side: '#465166' }, CONV.h - 5);
    // moving cleats across the belt
    const shift = live ? (((now() - fx.startAt) / 1000) * SPEED) % 8 : 0;
    for (let x = x0 + shift; x < x1; x += 8) line(SX(x, z0 + 1), SY(z0 + 1, CONV.h), SX(x, z1 - 1), SY(z1 - 1, CONV.h), '#1c222d');
    // bolts and rollers on the frame
    for (let x = x0 + 6; x < x1; x += 20) rect('#8796ab', SX(x, z1), b.yt + 2, 1, 1);
    ellipse(SX(x0 + 3, z1), b.yt + 2, 3, 3, '#8796ab'); ellipse(SX(x0 + 3, z1), b.yt + 2, 1, 1, '#3a4456');
    ellipse(SX(x1 - 3, z1), b.yt + 2, 3, 3, '#8796ab'); ellipse(SX(x1 - 3, z1), b.yt + 2, 1, 1, '#3a4456');
    if (live) drawBeltItems(s, t);
  }

  function drawBeltItems(s, t) {
    const T = now();
    const kMax = Math.floor((T - fx.startAt - offsetFor(s)) / INTERVAL);
    const kMin = Math.max(0, Math.floor((T - fx.startAt - offsetFor(s) - RIDE) / INTERVAL));
    const taken = new Set((fx.taken && fx.taken[s]) || []);
    for (let k = kMin; k <= kMax; k++) {
      if (taken.has(k) || (pending && pending.sec === s && pending.k === k)) continue;
      const age = T - spawnTime(fx, s, k);
      if (age < 0 || age > RIDE) {
        const key = s + ':' + k;
        if (age > RIDE && age < RIDE + 400 && !eaten.has(key)) { eaten.add(key); burst(secX(s) + COMP.x0 + 2, CONV.zi, SY(CONV.zi, CONV.h + 4), 6, ['#c3cdd8', '#ffd166', '#ff8a5c'], 30); }
        continue;
      }
      const item = rarityFor(fx.seed, s, k);
      const wx = secX(s) + CONV.x0 + (age / 1000) * SPEED;
      const ix = SX(wx, CONV.zi), iy = SY(CONV.zi, CONV.h);
      ellipse(ix, iy, 4, 1, 'rgba(0,0,0,.35)');
      if (ITEMS[item].r >= 2) { g.globalAlpha = 0.25 + 0.1 * Math.sin(t / 200 + k); ellipse(ix, iy - 5, 7, 6, ITEMS[item].color); g.globalAlpha = 1; }
      if (ITEMS[item].r >= 3 && Math.random() < 0.06) parts.push({ x: wx - 4 + Math.random() * 8, z: CONV.zi, y: iy - 10, vx: 0, vy: -12, life: 0, max: 0.7, c: ITEMS[item].color, s: 1 });
      sprite(item, ix - 4, iy - 9);
    }
  }

  function drawCompactor(s, t) {
    const X = secX(s);
    const b = box(X + COMP.x0, X + COMP.x1, COMP.z0, COMP.z1, COMP.h, DARK);
    // intake mouth with teeth at belt height
    const my = SY(COMP.z1, CONV.h + 12);
    rect('#0b1320', b.fl, my - 1, 14, 16); rect('#05070b', b.fl + 1, my, 12, 14);
    for (let y = my + 1; y < my + 14; y += 4) rect('#c3cdd8', b.fl + 11, y, 2, 2);
    // hazard stripes along the bottom
    for (let x = b.fl; x < b.fr; x++) for (let y = b.yb - 7; y < b.yb; y++) if ((x + y) % 8 < 4) { g.fillStyle = '#ffd166'; g.fillRect(x, y, 1, 1); } else { g.fillStyle = '#14141f'; g.fillRect(x, y, 1, 1); }
    rect('#4c576c', b.fl + 16, b.yt + 6, b.w - 20, 16); rect('#3a4456', b.fl + 17, b.yt + 7, b.w - 22, 14);
    for (let i = 0; i < 3; i++) rect('#2a3140', b.fl + 19, b.yt + 9 + i * 4, b.w - 26, 2);
    // piston + warning beacon on top
    const pump = Math.round(Math.abs(Math.sin(t / 260)) * 6);
    box(X + COMP.x0 + 14, X + COMP.x1 - 14, 6, 14, 10 - Math.min(6, pump), { top: '#cdd6e2', front: '#98a5b8', side: '#7a879b' }, COMP.h);
    const on = Math.floor(t / 400) % 2;
    const bx = SX(X + COMP.x1 - 8, 10), by = SY(10, COMP.h) - 2;
    rect('#0b1320', bx - 2, by - 5, 5, 5); rect(on ? '#ff5d5d' : '#6a1d1d', bx - 1, by - 4, 3, 3);
    if (on) { g.globalAlpha = 0.18; ellipse(bx, by - 3, 9, 6, '#ff5d5d'); g.globalAlpha = 1; }
  }

  function drawBin(s, t) {
    const X = secX(s), owner = ownerOf(s);
    const bin = (fx && owner && fx.bins[owner]) || [];
    ellipse(SX(X + BIN_C.x, BIN.z1), SY(BIN.z1) + 1, (BIN.x1 - BIN.x0) * 0.6, 3, 'rgba(0,0,0,.3)');
    const b = box(X + BIN.x0, X + BIN.x1, BIN.z0, BIN.z1, BIN.h, { top: '#5cbf9d', hi: '#7fd8b8', front: '#2f7a62', side: '#235a49' });
    // open top: dark inside with items peeking out
    const it0 = SX(X + BIN.x0 + 4, BIN.z1 - 4), it1 = SX(X + BIN.x1 - 4, BIN.z1 - 4), ib0 = SX(X + BIN.x0 + 4, BIN.z0 + 4), ib1 = SX(X + BIN.x1 - 4, BIN.z0 + 4);
    poly([[it0, SY(BIN.z1 - 4, BIN.h)], [it1, SY(BIN.z1 - 4, BIN.h)], [ib1, SY(BIN.z0 + 4, BIN.h)], [ib0, SY(BIN.z0 + 4, BIN.h)]], '#10241e');
    bin.slice(-3).forEach((it, i) => sprite(it, SX(X + BIN.x0 + 8 + i * 10, BIN.z1 - 10) - 4, SY(BIN.z1 - 10, BIN.h) - 6));
    // ribs and metal bands
    for (let x = b.fl + 5; x < b.fr - 3; x += 7) rect('#276652', x, b.yt + 3, 1, BIN.h - 6);
    rect('#3f9479', b.fl, b.yt + 2, b.w, 1); rect('#1f4f40', b.fl, b.yb - 3, b.w, 2);
    // SELL plate painted on the front (pixel font, so it moves with the bin)
    const pw = pixelTextW('SELL') + 6, px = Math.round(b.fl + (b.w - pw) / 2), py = b.yt + 8;
    rect('#0b1320', px - 1, py - 1, pw + 2, 9); rect('#ffd166', px, py, pw, 7); rect('#ffe7a3', px, py, pw, 1);
    pixelText('SELL', px + 3, py + 1, '#3a2600');
    // item count + progress to next sale, also on the bin
    if (bin.length) { const c = 'x' + bin.length; pixelText(c, b.fr - pixelTextW(c) - 3, b.yb - 10, '#e9fff6'); }
    if (owner && bin.length && fx.nextSell && fx.nextSell[owner]) {
      const span = fx.fast && fx.fast[owner] ? FAST_SELL : SLOW_SELL;
      const p = clamp(1 - (fx.nextSell[owner] - now()) / span, 0, 1);
      rect('#0b1320', b.fl + 3, b.yb - 4, b.w - 6, 3); rect('#7bd389', b.fl + 4, b.yb - 3, (b.w - 8) * p, 1);
    }
  }

  // ---------- players & floor items ----------
  function frozen(id) { return gameLive() && fx.energy && (fx.energy[id] || 0) <= 0; }
  function drawPlayer(p, pos, moving, t, isMe) {
    const sx = SX(pos.x, pos.z), sy = SY(pos.z);
    if (sx < -30 || sx > W + 30) return;
    ellipse(sx, sy, 7, 2, 'rgba(0,0,0,.35)');
    const ice = frozen(p.id);
    const bob = ice ? 0 : moving ? Math.floor(t / 120) % 2 : Math.floor((t + p.id.length * 97) / 450) % 2;
    Scene.drawCharacter(g, sx, sy, p.look, { bob });
    if (ice) {
      g.globalAlpha = 0.45; rect('#bfe9ff', sx - 9, sy - 19, 18, 19); g.globalAlpha = 0.9;
      rect('#e6f7ff', sx - 9, sy - 19, 18, 1); rect('#e6f7ff', sx - 9, sy - 19, 1, 19); rect('#7fc8e8', sx + 8, sy - 19, 1, 19); rect('#7fc8e8', sx - 9, sy - 1, 18, 1);
      rect('#ffffff', sx - 6, sy - 16, 2, 1); rect('#ffffff', sx - 6, sy - 15, 1, 2); g.globalAlpha = 1;
    }
    const held = heldOf(p.id);
    let ly = sy - 26;
    if (held != null) {
      const it = ITEMS[held];
      if (held >= 2) { g.globalAlpha = 0.3 + 0.15 * Math.sin(t / 150); ellipse(sx, sy - 26, 8, 7, it.color); g.globalAlpha = 1; }
      sprite(held, sx - 4, sy - 30 - (Math.floor(t / 300) % 2));
      text(it.tier.toUpperCase(), sx, sy - 38, it.color, 5);
      ly = sy - 46;
    }
    text(p.name, sx, ly, isMe ? '#ffd166' : '#fff', 6);
    if (ice) text('FROZEN', sx, ly - 8, '#9fe3ff', 5);
  }
  function drawFloorItem(it, t) {
    const sx = SX(it.x, it.z), sy = SY(it.z);
    if (sx < -20 || sx > W + 20) return;
    const bob = Math.floor(t / 350) % 2;
    g.globalAlpha = 0.3 + 0.15 * Math.sin(t / 180 + it.fid); ellipse(sx, sy - 5, 8, 6, ITEMS[it.item].color); g.globalAlpha = 1;
    ellipse(sx, sy, 5, 1, 'rgba(0,0,0,.4)');
    sprite(it.item, sx - 4, sy - 10 - bob);
    text(ITEMS[it.item].tier.toUpperCase(), sx, sy - 16, ITEMS[it.item].color, 4.5);
  }

  // ---------- effects ----------
  function burst(x, z, y, n, colors, sp = 50) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random()); parts.push({ x, z, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.4, g: 120, life: 0, max: 0.5 + Math.random() * 0.5, c: colors[i % colors.length], s: 1 }); }
  }
  function floatText(x, z, h, str, color, size = 7) { floaters.push({ x, z, h, str, color, size, t0: performance.now() }); }
  function banner(html, ms = 3200) {
    const b = $('#fxBanner'); b.innerHTML = html; b.hidden = false;
    b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.hidden = true), ms);
  }

  // ---------- energy ----------
  function gameLive() { return !!(fx && S && S.phase === 'play' && fx.startAt && now() >= fx.startAt); }
  function serverEnergy(id) { return fx && fx.energy ? fx.energy[id] || 0 : 0; }
  function myEnergy() {
    if (!gameLive()) return serverEnergy(ctx.me.id);
    const el = (performance.now() - energyAt.t) / 1000;
    return Math.max(0, energyAt.v - el * (me.moving ? DRAIN_WALK : DRAIN_IDLE));
  }
  function renderEnergy() {
    const e = myEnergy(), live = gameLive(), playing = amPlaying();
    const out = live && serverEnergy(ctx.me.id) <= 0;
    for (const el of [$('#fxEnergy'), $('#fxqEnergy')]) {
      el.querySelector('i').style.width = Math.min(100, (e / gain()) * 100) + '%';
      el.querySelector('b').textContent = Math.ceil(e);
      el.classList.toggle('low', e < gain() * 0.25 && !out);
      el.classList.toggle('out', out);
    }
    $('#fxEnergy').hidden = !playing;
    $('#fxQBtn').hidden = !playing || S.phase !== 'play';
    $('#fxQBtn').classList.toggle('urgent', live && e < gain() * 0.25);
  }

  // ---------- questions (full-screen, multiple choice) ----------
  const decQ = (x) => { try { return JSON.parse(decodeURIComponent(escape(atob(x)))); } catch (e) { return null; } };
  function openQuiz() {
    if (!amPlaying() || S.phase !== 'play' || quizOpen) return;
    quizOpen = true; keys.left = keys.right = keys.up = keys.down = false;
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
    document.querySelectorAll('#fxqChoices .tile').forEach((t) => { const txt = quiz.q.choices[Number(t.dataset.i)]; if (txt === ev.right) t.classList.add('right'); else if (Number(t.dataset.i) === ev.pick) t.classList.add('wrong'); });
    const fb = $('#fxqFeedback');
    if (ev.ok) { fb.innerHTML = `+${gain()} <span>⚡</span> energy!`; fb.className = 'quiz-feedback good'; energyAt = { v: myEnergy() + gain(), t: performance.now() }; }
    else { fb.innerHTML = `Not quite. The answer was <b>${esc(ev.right)}</b>`; fb.className = 'quiz-feedback bad'; }
    clearTimeout(quiz.unlockTimer);
    quiz.wait = true; quiz.readyAt = performance.now() + (ev.ok ? 250 : WRONG_WAIT); renderCont();
  }
  // After an answer the result stays up until the player clicks or presses a key.
  // A wrong answer makes them wait WRONG_WAIT ms first so they read the right answer.
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


  // ---------- input & interaction ----------
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
    if (map[k]) { keys[map[k]] = down; e.preventDefault(); }
    else if (k === 'e' && down && !e.repeat) { interact(); e.preventDefault(); }
  }
  function mySection() { return fx && ctx ? fx.sec[ctx.me.id] : undefined; }
  function amPlaying() { return S && ctx && S.players.some((p) => p.id === ctx.me.id) && mySection() != null; }

  // What would E do right now?
  function findAction() {
    if (!amPlaying() || !fx || S.phase !== 'play' || now() < fx.startAt) return null;
    const id = ctx.me.id, x = me.x, z = me.z, held = heldOf(id);
    const ownSec = mySection();
    if (frozen(id)) return { type: 'frozen' };
    if (held == null) {
      let fl = null, fd = 1;
      for (const it of fx.floor || []) { const d = Math.hypot((it.x - x) / 16, (it.z - z) / 12); if (d < fd) { fd = d; fl = it; } }
      if (fl) return { type: 'grab', fid: fl.fid, item: fl.item };
      const X = secX(ownSec);
      if (z <= CONV.z1 + 16 && x > X + CONV.x0 - 10 && x < X + CONV.x1 + 6) {
        const T = now(), taken = new Set(fx.taken[ownSec] || []);
        const kMax = Math.floor((T - fx.startAt - offsetFor(ownSec)) / INTERVAL);
        let best = null, bd = 16;
        for (let k = Math.max(0, kMax - 14); k <= kMax; k++) {
          if (taken.has(k)) continue;
          const age = T - spawnTime(fx, ownSec, k); if (age < 0 || age > RIDE) continue;
          const d = Math.abs(X + CONV.x0 + (age / 1000) * SPEED - x);
          if (d < bd) { bd = d; best = { k, item: rarityFor(fx.seed, ownSec, k) }; }
        }
        if (best) return { type: 'pick', ...best, sec: ownSec };
      }
      for (const oid in fx.sec) {
        if (oid === id) continue;
        if (near(x, z, secX(fx.sec[oid]) + BIN_C.x, BIN_C.z, 30, 24)) {
          const n = (fx.bins[oid] || []).length, p = player(oid);
          return n ? { type: 'steal', from: oid, name: p ? p.name : 'their' } : { type: 'emptyBin', name: p ? p.name : 'Their' };
        }
      }
    } else {
      if (near(x, z, secX(ownSec) + BIN_C.x, BIN_C.z, 30, 24)) return { type: 'drop', item: held };
      const X = secX(ownSec);
      if (z <= CONV.z1 + 16 && x > X + CONV.x0 - 10 && x < X + CONV.x1 + 6) return { type: 'full' };
    }
    return null;
  }
  function interact() {
    const a = findAction(); if (!a) return;
    const base = { from: ctx.me.id, x: me.x, z: me.z };
    if (a.type === 'pick') { pending = { sec: a.sec, k: a.k, item: a.item, at: now() }; ctx.send({ t: 'fx-pick', ...base, sec: a.sec, k: a.k }); burst(me.x, me.z, SY(me.z, 22), 8, ['#ffffff', ITEMS[a.item].color], 40); }
    else if (a.type === 'drop') ctx.send({ t: 'fx-drop', ...base });
    else if (a.type === 'steal') ctx.send({ t: 'fx-steal', ...base, victim: a.from });
    else if (a.type === 'grab') { if (!me.chan) me.chan = { fid: a.fid, start: performance.now() }; } // stay still for a moment, like on the island
    else if (a.type === 'frozen') openQuiz();
  }
  // picking something up off the floor: walking away cancels
  function updateGrab() {
    const ch = me.chan; if (!ch) return;
    if (!(fx.floor || []).some((it) => it.fid === ch.fid) || !gameLive() || quizOpen || frozen(ctx.me.id) || me.dx || me.dz) { me.chan = null; return; }
    if (performance.now() - ch.start >= GRAB_MS) { me.chan = null; ctx.send({ t: 'fx-grab', from: ctx.me.id, x: me.x, z: me.z, fid: ch.fid }); }
  }
  function renderPrompt() {
    const a = quizOpen ? null : findAction(), el = $('#fxPrompt');
    const busy = !!me.chan && a && a.type === 'grab';
    const key = a ? a.type + (a.k != null ? a.k : '') + (a.from || '') + (a.fid || '') + (busy ? 'busy' : '') : '';
    if (key === prompt) return; prompt = key;
    if (!a) { el.hidden = true; return; }
    const it = a.item != null ? ITEMS[a.item] : null;
    const label = {
      pick: () => `Pick up <b style="color:${it.color}">${esc(it.name)}</b> <small>${it.tier}</small>`,
      drop: () => `Drop <b style="color:${it.color}">${esc(it.name)}</b> in your bin`,
      steal: () => `Steal from <b>${esc(a.name)}</b>’s bin`,
      emptyBin: () => `${esc(a.name)}’s bin is empty`,
      full: () => 'Your hands are full. Drop it in your bin first',
      grab: () => busy ? 'Picking up… stay still' : `Pick up <b style="color:${it.color}">${esc(it.name)}</b> <small>${it.tier} · on the floor</small>`,
      frozen: () => 'Out of energy! Answer questions to move again',
    }[a.type]();
    const showKey = ['pick', 'drop', 'steal', 'grab'].includes(a.type) && !busy;
    el.innerHTML = `${showKey ? '<kbd>E</kbd>' : a.type === 'frozen' ? '<kbd>Space</kbd>' : ''}<span>${label}</span>`;
    el.classList.toggle('muted', !showKey && a.type !== 'frozen' && !busy);
    el.classList.toggle('alert', a.type === 'frozen');
    el.hidden = false;
  }

  // ---------- networking: dead-reckoned positions ----------
  function sendPos() {
    if (!S || !S.players.some((p) => p.id === ctx.me.id) || mySection() == null) return;
    const t = performance.now();
    const vx = Math.round(me.dx * WALK * me.norm), vz = Math.round(me.dz * WALKZ * me.norm);
    const v = vx + ',' + vz;
    const changed = v !== me.sentV, heartbeat = (vx || vz) && t - me.sent > 1000;
    const settle = !vx && !vz && !me.moving && me.sentX != null && (Math.abs(me.x - me.sentX) > 0.5 || Math.abs(me.z - me.sentZ) > 0.5);
    if (!changed && !heartbeat && !settle) return;
    me.sent = t; me.sentV = v; me.sentX = me.x; me.sentZ = me.z;
    ctx.send({ t: 'pos', id: ctx.me.id, x: Math.round(me.x * 10) / 10, z: Math.round(me.z * 10) / 10, vx, vz, f: me.f });
  }
  const clampX = (x) => clamp(x, 8, worldW() - 8), clampZ = (z) => clamp(z, 3, DZ - 2);
  const predict = (b, at) => { const dt = Math.min(1.5, (performance.now() - at) / 1000); return { x: clampX(b.x + b.vx * dt), z: clampZ(b.z + b.vz * dt) }; };
  function onPos(m) {
    if (!ctx || m.id === ctx.me.id) return;
    const b = { x: m.x, z: m.z != null ? m.z : DZ * 0.7, vx: m.vx != null ? m.vx : m.v || 0, vz: m.vz || 0 };
    let o = others.get(m.id);
    if (!o) { o = { x: b.x, z: b.z }; others.set(m.id, o); }
    Object.assign(o, { b, at: performance.now(), m: !!(b.vx || b.vz) });
    if (ctx.me.host) hostPos.set(m.id, { b, at: performance.now() });
  }

  // Walls: you can't walk through machines or bins.
  function blocked(x, z) {
    const s = Math.floor(x / SW), lx = x - secX(s);
    for (const o of SOLIDS) if (lx > o.x0 - 5 && lx < o.x1 + 5 && z > o.z0 - 2 && z < o.z1 + 3) return true;
    return false;
  }

  // ---------- events ----------
  function handleEvents() {
    if (!fx || !fx.evs) return;
    const evs = fx.evs;
    if (lastEvN === -1) { lastEvN = evs.length ? evs[evs.length - 1].n : 0; return; }
    for (const ev of evs) {
      if (ev.n <= lastEvN) continue;
      lastEvN = ev.n;
      const p = player(ev.id), it = ev.item != null ? ITEMS[ev.item] : null;
      if (ev.type === 'sold') {
        const s = fx.sec[ev.id]; if (s == null || ev.id !== ctx.me.id) continue; // only the seller sees their sale
        floatText(secX(s) + BIN_C.x, BIN.z1, BIN.h + 12, '+' + money(it.value), it.color, it.r >= 4 ? 10 : 7);
        burst(secX(s) + BIN_C.x, BIN.z1, SY(BIN.z1, BIN.h + 2), it.r >= 3 ? 14 : 6, ['#ffd166', it.color], 45);
      } else if (ev.type === 'pick') {
        if (ev.id === ctx.me.id) pending = null;
        if (it.r >= NOTIFY_TIER) banner(`✨ ${ev.id === ctx.me.id ? 'You' : esc(p ? p.name : 'Someone')} picked up a <b style="color:${it.color}">${it.tier.toUpperCase()}</b> ${esc(it.name)}!`);
      } else if (ev.type === 'pickFail') {
        if (ev.id === ctx.me.id) { pending = null; prompt = null; }
      } else if (ev.type === 'drop') {
        const s = fx.sec[ev.id]; if (s != null) burst(secX(s) + BIN_C.x, BIN.z1, SY(BIN.z1, BIN.h), 6, ['#9aa7b8', '#ffffff'], 30);
      } else if (ev.type === 'steal') {
        const v = player(ev.victim), s = fx.sec[ev.victim];
        if (s != null) floatText(secX(s) + BIN_C.x, BIN.z1, BIN.h + 12, 'STOLEN!', '#ff5d5d', 8);
        if (ev.victim === ctx.me.id) banner(`🦝 <b>${esc(p ? p.name : 'Someone')}</b> stole a <b style="color:${it.color}">${it.tier}</b> ${esc(it.name)} from your bin!`);
        else if (ev.id === ctx.me.id) banner(`You grabbed a <b style="color:${it.color}">${it.tier}</b> ${esc(it.name)} from ${esc(v ? v.name : 'their')}’s bin`);
      } else if (ev.type === 'ans') {
        if (ev.id === ctx.me.id) onAnswerResult(ev);
        const pp = posOf(ev.id);
        if (ev.ok && pp && ev.id === ctx.me.id) { floatText(pp.x, pp.z, 40, `+${gain()}⚡`, '#ffd166', 7); burst(pp.x, pp.z, SY(pp.z, 12), 10, ['#ffd166', '#fff3c4'], 40); }
      } else if (ev.type === 'drained' || ev.type === 'frozen') {
        const pp = posOf(ev.id);
        if (pp) { floatText(pp.x, pp.z, 40, ev.type === 'drained' ? 'DROPPED!' : 'FROZEN!', '#9fe3ff', 7); burst(pp.x, pp.z, SY(pp.z, 10), 12, ['#bfe9ff', '#ffffff'], 40); }
        if (ev.id === ctx.me.id) banner(ev.type === 'drained' ? `❄️ Out of energy! You dropped your <b style="color:${it.color}">${esc(it.name)}</b>. Anyone can pick it up. Answer questions to move again.` : '❄️ Out of energy! Answer questions to move again.', 4500);
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
  // Pixel-art map: drawn at half resolution (1 map pixel = 2 screen pixels) and scaled up crisp.
  function drawMinimap() {
    const c = $('#fxMini'); if (!c || !fx) return;
    const PXS = 2, w = Math.max(40, Math.floor(c.clientWidth / PXS)), h = Math.max(16, Math.floor(c.clientHeight / PXS));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const m = c.getContext('2d'), t = performance.now();
    const R = (x, y, ww, hh, col) => { m.fillStyle = col; m.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(ww)), Math.max(1, Math.round(hh))); };
    const world = worldW(), WALL = 5, x0 = 2, y0 = 2, iw = w - 4, ih = h - 4;
    const mx = (x) => x0 + Math.floor((x / world) * iw), mz = (z) => y0 + WALL + Math.floor((clamp(z, 0, DZ) / DZ) * (ih - WALL - 1));
    // frame: dark edge, bevel highlight, floor
    R(0, 0, w, h, '#070b12'); R(1, 1, w - 2, h - 2, '#2a3a52'); R(x0, y0, iw, ih, '#121c2b');
    for (let y = y0 + WALL; y < y0 + ih; y += 2) for (let x = x0 + ((y >> 1) & 1); x < x0 + iw; x += 2) R(x, y, 1, 1, '#16233a'); // checker floor
    for (const id in fx.sec) {
      const s = fx.sec[id], col = colorOf(id), sx0 = mx(secX(s)), sx1 = mx(secX(s) + SW);
      // owner tint + back wall
      m.globalAlpha = 0.18; R(sx0, y0 + WALL, sx1 - sx0, ih - WALL, col); m.globalAlpha = 1;
      R(sx0, y0, sx1 - sx0, WALL, '#1d2a3e'); R(sx0, y0, sx1 - sx0, 1, col);
      // spawner, belt (animated dashes), compactor
      const bx0 = mx(secX(s) + CONV.x0), bx1 = mx(secX(s) + CONV.x1);
      R(mx(secX(s) + SPAWNER.x0), y0 + 1, Math.max(2, bx0 - mx(secX(s) + SPAWNER.x0)), WALL - 1, '#7d8a99');
      R(bx0, y0 + 3, bx1 - bx0, 2, '#39424e');
      const off = Math.floor(t / 180) % 3;
      for (let x = bx0 + off; x < bx1; x += 3) R(x, y0 + 3, 1, 1, '#5d6b7c');
      R(bx1, y0 + 1, Math.max(2, mx(secX(s) + COMP.x1) - bx1), WALL - 1, '#596574');
      // items riding the belt (only the rarer ones glow on the map)
      const kMax = Math.floor((now() - fx.startAt - offsetFor(s)) / INTERVAL), taken = new Set((fx.taken && fx.taken[s]) || []);
      if (gameLive()) for (let k = Math.max(0, kMax - 14); k <= kMax; k++) {
        const age = now() - spawnTime(fx, s, k); if (age < 0 || age > RIDE || taken.has(k)) continue;
        const it = ITEMS[rarityFor(fx.seed, s, k)];
        R(mx(secX(s) + CONV.x0 + (age / 1000) * SPEED), y0 + 3, 1, 1, it.r >= 2 ? it.color : '#c3cdd8');
      }
      // sell pad (blinks while the owner stands on it) and bin with a fill bar
      const fast = fx.fast && fx.fast[id];
      const padC = fast && Math.floor(t / 250) % 2 ? '#fff3c4' : '#ffd166', pdx = mx(secX(s) + PAD.x), pdz = mz(PAD.z);
      R(pdx - 2, pdz - 1, 5, 3, '#070b12'); R(pdx - 3, pdz, 7, 1, '#070b12'); R(pdx - 1, pdz - 1, 3, 3, '#b8860b'); R(pdx - 2, pdz, 5, 1, padC); R(pdx - 1, pdz, 3, 1, padC);
      const binX = mx(secX(s) + BIN.x0), binW = Math.max(3, mx(secX(s) + BIN.x1) - binX), binY = mz(BIN.z0), binH = Math.max(3, mz(BIN.z1) - binY);
      R(binX - 1, binY - 1, binW + 2, binH + 2, '#070b12'); R(binX, binY, binW, binH, '#2d6b55');
      const n = ((fx.bins && fx.bins[id]) || []).length;
      if (n) R(binX, binY + binH - Math.min(binH, Math.ceil(n / 2)), binW, Math.min(binH, Math.ceil(n / 2)), '#5cbf9d');
      if (s > 0) for (let y = y0 + WALL; y < y0 + ih; y++) R(sx0, y, 1, 1, Math.floor(y / 2) % 2 ? '#ffd166' : '#070b12'); // hazard-stripe divider
    }
    // dropped items sparkle
    for (const it of fx.floor || []) if (Math.floor(t / 300 + it.fid) % 2) R(mx(it.x), mz(it.z), 1, 1, ITEMS[it.item].color);
    // camera view: pixel corner brackets
    const vx0 = clamp(mx(cam), x0, x0 + iw - 1), vx1 = clamp(mx(cam + W) - 1, x0, x0 + iw - 1), vy0 = y0, vy1 = y0 + ih - 1, L = 3;
    for (const [x, y, dx, dy] of [[vx0, vy0, 1, 1], [vx1, vy0, -1, 1], [vx0, vy1, 1, -1], [vx1, vy1, -1, -1]]) {
      R(dx > 0 ? x : x - L + 1, y, L, 1, '#ffffff'); R(x, dy > 0 ? y : y - L + 1, 1, L, '#ffffff');
    }
    // players: outlined 2×2 markers; you get a bobbing white arrow
    for (const p of S.players) {
      const pos = posOf(p.id); if (!pos || p.gone) continue;
      const px = mx(pos.x), pz = mz(pos.z);
      R(px - 2, pz - 2, 4, 4, '#070b12'); R(px - 1, pz - 1, 2, 2, Scene.COLORS[p.look.c] || '#fff');
      if (p.id === ctx.me.id) { const by = pz - 5 - (Math.floor(t / 400) % 2); R(px - 1, by, 2, 1, '#ffffff'); R(px - 1, by - 1, 2, 1, '#070b12'); }
      else if (frozen(p.id)) R(px, pz - 1, 1, 1, '#bfe9ff');
    }
  }

  // ---------- frame loop ----------
  function visibleArea() {
    const page = $('#gamePage'), side = $('#sidePanel');
    const right = window.innerWidth >= 900 && !page.classList.contains('panel-closed') ? (side.offsetWidth + 24) / SCALE : 0;
    return { right, center: (W - right) / 2 };
  }
  function update(dt) {
    const playing = S && S.players.some((p) => p.id === ctx.me.id) && mySection() != null;
    const world = worldW(), view = visibleArea();
    VC = view.center;
    if (playing) {
      if (!me.placed) { me.x = secX(mySection()) + SW / 2; me.z = 72; me.placed = true; }
      const canMove = gameLive() && !quizOpen && !frozen(ctx.me.id); // no walking in the lobby or the countdown
      me.dx = canMove ? (keys.right ? 1 : 0) - (keys.left ? 1 : 0) : 0;
      me.dz = canMove ? (keys.down ? 1 : 0) - (keys.up ? 1 : 0) : 0;
      me.norm = me.dx && me.dz ? 0.78 : 1;
      const tx = me.dx * WALK * me.norm, tz = me.dz * WALKZ * me.norm;
      me.vx += clamp(tx - me.vx, -ACCEL * dt, ACCEL * dt);
      me.vz += clamp(tz - me.vz, -ACCEL * dt, ACCEL * dt);
      const nx = clampX(me.x + me.vx * dt), nz = clampZ(me.z + me.vz * dt);
      if (!blocked(nx, me.z)) me.x = nx; else me.vx = 0;
      if (!blocked(me.x, nz)) me.z = nz; else me.vz = 0;
      if (me.dx) me.f = me.dx;
      me.moving = Math.abs(me.vx) > 2 || Math.abs(me.vz) > 2;
      sendPos();
      updateGrab();
      camX = lerp(camX, clamp(me.x - view.center, Math.min(0, (world - W) / 2), Math.max(0, world - W + view.right)), 1 - Math.exp(-dt * 6));
    } else {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); // spectators pan the camera
      camX = clamp(camX + dir * 180 * dt, Math.min(0, (world - W) / 2), Math.max(0, world - W));
      if (world <= W) camX = (world - W) / 2;
    }
    cam = Math.round(camX); // draw with a whole-pixel camera so canvas art and text never drift apart
    for (const o of others.values()) { if (o.at) { const p = predict(o.b, o.at); o.x = lerp(o.x, p.x, 1 - Math.exp(-dt * 12)); o.z = lerp(o.z, p.z, 1 - Math.exp(-dt * 12)); } }
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life += dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.life > p.max) parts.splice(i, 1); }
    for (let i = floaters.length - 1; i >= 0; i--) if (performance.now() - floaters[i].t0 > 1200) floaters.splice(i, 1);
  }

  function draw(t) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, tcv.width, tcv.height);
    g.drawImage(layers.sky, 0, 0, W, H);
    drawLayer(layers.far, 0.2, 1, backY);
    drawLayer(layers.mid, 0.45, 1, backY);
    drawLayer(layers.near, 0.72, 1, backY);
    drawFloor(t);
    const n = nSections(), live = !!(fx && fx.startAt && now() >= fx.startAt && S.phase === 'play');
    const visible = [];
    for (let s = 0; s < n; s++) if (SX(secX(s) + SW, DZ) > -40 && SX(secX(s), DZ) < W + 40) visible.push(s);
    for (const s of visible) drawWall(s, t);
    for (const s of visible) drawFloorMarks(s, t);
    // everything that stands on the floor, sorted back-to-front
    const list = [];
    for (const s of visible) {
      list.push({ z: SPAWNER.z1, f: () => drawSpawner(s, t, live) });
      list.push({ z: CONV.z1, f: () => drawConveyor(s, t, live) });
      list.push({ z: COMP.z1, f: () => drawCompactor(s, t) });
      list.push({ z: BIN.z1, f: () => drawBin(s, t) });
    }
    for (const it of (fx && fx.floor) || []) list.push({ z: it.z, f: () => drawFloorItem(it, t) });
    if (S) {
      for (const p of S.players) {
        if (p.gone) continue;
        if (p.id === ctx.me.id) { if (me.placed) list.push({ z: me.z + 0.01, f: () => drawPlayer(p, me, me.moving, t, true) }); continue; }
        const o = others.get(p.id);
        const pos = o ? { x: o.x, z: o.z } : fx && fx.sec[p.id] != null ? { x: secX(fx.sec[p.id]) + SW / 2, z: 72 } : null;
        if (pos) list.push({ z: pos.z, f: () => drawPlayer(p, pos, o && o.m, t, false) });
      }
    }
    list.sort((a, b) => a.z - b.z).forEach((d) => d.f());
    for (const p of parts) { g.globalAlpha = clamp(1 - p.life / p.max, 0, 1); rect(p.c, SX(p.x, p.z), p.y, p.s, p.s); }
    g.globalAlpha = 1;
    drawLayer(layers.fg, 1.35, 0.95);
    for (const f of floaters) {
      const p = (performance.now() - f.t0) / 1200;
      text(f.str, SX(f.x, f.z), SY(f.z, f.h) - p * 18, f.color, f.size, 'center', p > 0.7 ? (1 - p) / 0.3 : 1);
    }
    if (fx && fx.startAt && S.phase === 'play') {
      const left = fx.startAt - now();
      if (left > 0) text(String(Math.ceil(left / 1000)), VC, H * 0.4, '#ffd166', 28);
      else if (left > -900) text('GO!', VC, H * 0.4, '#7bd389', 28, 'center', 1 + left / 900);
    }
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
    SCALE = Math.max(2, Math.floor(Math.min(vh / 220, vw / 360)));
    W = Math.ceil(vw / SCALE); H = Math.ceil(vh / SCALE);
    backY = H - 16 - DZ; groundY = backY;
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
    qsrc: [], qstate: new Map(), lastTick: 0, lastPush: 0, fid: 0,
    initState(opts) {
      return { winMode: opts.winMode || 'time', minutes: opts.minutes || 5, goal: opts.goal || 2500, gain: opts.gain || GAIN_DEFAULT, sec: {}, money: {}, held: {}, bins: {}, taken: {}, nextSell: {}, fast: {}, energy: {}, floor: [], evs: [], startAt: 0, endAt: 0, seed: 0 };
    },
    // Sections follow the lobby order; leavers keep theirs during a game.
    assignSections(S) {
      const f = S.fx; if (!f) return;
      if (S.phase === 'lobby') { f.sec = {}; S.players.forEach((p, i) => (f.sec[p.id] = i)); }
      f.energy = f.energy || {}; f.floor = f.floor || [];
      for (const p of S.players) { if (f.energy[p.id] == null) f.energy[p.id] = 0; if (f.money[p.id] == null) f.money[p.id] = 0; if (!f.bins[p.id]) f.bins[p.id] = []; if (f.held[p.id] === undefined) f.held[p.id] = null; }
    },
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
    posOf(id) { if (id === ctx.me.id) return me.placed ? { x: me.x, z: me.z } : null; const h = hostPos.get(id); return h ? predict(h.b, h.at) : null; },
    walking(id) { if (id === ctx.me.id) return !!(me.dx || me.dz); const h = hostPos.get(id); return !!(h && (h.b.vx || h.b.vz)); },
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
        if (ok) f.energy[id] = (f.energy[id] || 0) + (f.gain || GAIN_DEFAULT);
        this.ev(S, { type: 'ans', id, ok, right: st.cur.right, pick: m.choice });
        st.cur = null;
        this.sendQuestion(S, id);
        return;
      }
      if (Date.now() < f.startAt) return;
      const hasEnergy = (f.energy[id] || 0) > 0;
      const mz = m.z != null ? m.z : BIN_C.z;
      if (m.t === 'fx-pick') {
        const s = f.sec[id], T = Date.now();
        const ok = hasEnergy && s === m.sec && f.held[id] == null && !(f.taken[s] || []).includes(m.k) && mz <= CONV.z1 + 30;
        const age = T - spawnTime(f, s, m.k);
        if (ok && age >= -150 && age <= RIDE + 500) {
          const item = rarityFor(f.seed, s, m.k);
          (f.taken[s] = f.taken[s] || []).push(m.k);
          f.held[id] = item;
          this.ev(S, { type: 'pick', id, item });
        } else this.ev(S, { type: 'pickFail', id });
      } else if (m.t === 'fx-drop') {
        const s = f.sec[id], item = f.held[id];
        if (item == null || !hasEnergy || !near(m.x, mz, secX(s) + BIN_C.x, BIN_C.z, 45, 34)) return;
        f.held[id] = null;
        const bin = (f.bins[id] = f.bins[id] || []);
        if (!bin.length) f.nextSell[id] = Date.now() + (f.fast[id] ? FAST_SELL : SLOW_SELL);
        bin.push(item);
        this.ev(S, { type: 'drop', id, item });
      } else if (m.t === 'fx-steal') {
        const v = m.victim, bin = f.bins[v] || [];
        if (v === id || !hasEnergy || f.held[id] != null || !bin.length || f.sec[v] == null) return;
        if (!near(m.x, mz, secX(f.sec[v]) + BIN_C.x, BIN_C.z, 45, 34)) return;
        const item = bin.splice(Math.floor(Math.random() * bin.length), 1)[0];
        f.held[id] = item;
        this.ev(S, { type: 'steal', id, victim: v, item });
      } else if (m.t === 'fx-grab') {
        const i = f.floor.findIndex((it) => it.fid === m.fid);
        if (i < 0 || !hasEnergy || f.held[id] != null || !near(m.x, mz, f.floor[i].x, f.floor[i].z, 40, 26)) return;
        const it = f.floor.splice(i, 1)[0];
        f.held[id] = it.item;
        this.ev(S, { type: 'grab', id, item: it.item, from: it.owner });
      }
    },
    tick(S, broadcast) {
      const f = S.fx; if (!f) return;
      const T = Date.now();
      if (S.phase === 'play' && T >= f.startAt) {
        // energy drain: 10/s walking, nothing while standing still. Hitting 0 freezes you and drops what you hold.
        const dt = this.lastTick ? Math.min(1, (T - this.lastTick) / 1000) : 0;
        this.lastTick = T;
        for (const id in f.sec) {
          const p = S.players.find((q) => q.id === id);
          if (!p || p.gone || (f.energy[id] || 0) <= 0) continue;
          const e = Math.max(0, f.energy[id] - (this.walking(id) ? DRAIN_WALK : DRAIN_IDLE) * dt);
          f.energy[id] = Math.round(e * 10) / 10;
          if (e <= 0) {
            if (f.held[id] != null) { // you drop what you hold; anyone can grab it with E
              const pp = this.posOf(id) || { x: secX(f.sec[id]) + SW / 2, z: 72 };
              let x = clampX(pp.x + 16), z = pp.z;
              if (blocked(x, z)) x = clampX(pp.x - 16);
              f.floor.push({ fid: ++this.fid, item: f.held[id], x, z, owner: id });
              this.ev(S, { type: 'drained', id, item: f.held[id] });
              f.held[id] = null;
            } else this.ev(S, { type: 'frozen', id });
          }
        }
        if (T - this.lastPush > 1000) { this.lastPush = T; dirtyAt = dirtyAt || T; }
        for (const id in f.sec) {
          const pp = this.posOf(id), cx = secX(f.sec[id]) + PAD.x;
          const pad = !!pp && ((pp.x - cx) / PAD.rx) ** 2 + ((pp.z - PAD.z) / PAD.rz) ** 2 <= 1.15;
          if (pad !== !!f.fast[id]) {
            f.fast[id] = pad;
            if (f.nextSell[id]) f.nextSell[id] = Math.min(f.nextSell[id], T + (pad ? FAST_SELL : SLOW_SELL));
            dirtyAt = dirtyAt || T;
          }
          const bin = f.bins[id];
          if (bin && bin.length && T >= (f.nextSell[id] || 0)) {
            const item = bin.shift();
            f.money[id] = (f.money[id] || 0) + ITEMS[item].value;
            const p = S.players.find((q) => q.id === id); if (p) p.score = f.money[id];
            f.nextSell[id] = T + (pad ? FAST_SELL : SLOW_SELL);
            this.ev(S, { type: 'sold', id, item });
          }
        }
        for (const s in f.taken) f.taken[s] = f.taken[s].filter((k) => T - spawnTime(f, Number(s), k) < RIDE + 3000);
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
      window.addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; });
      const hold = (id, k) => {
        const b = $(id);
        const on = (e) => { e.preventDefault(); keys[k] = true; }, off = () => { keys[k] = false; };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      };
      hold('#fxLeft', 'left'); hold('#fxRight', 'right'); hold('#fxUp', 'up'); hold('#fxDown', 'down');
      $('#fxUse').addEventListener('pointerdown', (e) => { e.preventDefault(); interact(); });
      $('#fxQBtn').addEventListener('click', () => { openQuiz(); $('#fxQBtn').blur(); });
      $('#fxQuizClose').addEventListener('click', closeQuiz);
      $('#fxQuiz').addEventListener('pointerdown', (e) => { if (active && !e.target.closest('#fxQuizClose') && cont()) e.preventDefault(); });
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
    Object.assign(me, { x: 0, z: 72, vx: 0, vz: 0, dx: 0, dz: 0, placed: false, sentX: null, sentZ: null, sentV: null, moving: false });
    pending = null; lastEvN = -1; fx = null; S = null; clockOffset = null; prompt = null; camX = 0; cam = 0; lastPhase = null;
    keys.left = keys.right = keys.up = keys.down = false;
    closeQuiz(); Object.assign(quiz, { q: null, serial: -1, locked: false, next: null, wait: false }); clearTimeout(quiz.unlockTimer); renderCont();
    energyAt = { v: 0, t: 0 };
    if ($('#fxPrompt')) { $('#fxPrompt').hidden = true; $('#fxBanner').hidden = true; }
  }
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
      if (S.players.some((p) => p.id === ctx.me.id)) setTimeout(openQuiz, 300); // everyone starts at 0 energy
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
      for (let k = Math.max(0, kMax - 14); k <= kMax; k++) { const age = T - spawnTime(fx, sec, k); if (age >= 0 && age <= RIDE && !taken.has(k)) items.push({ k, x: secX(sec) + CONV.x0 + (age / 1000) * SPEED, item: rarityFor(fx.seed, sec, k) }); }
    }
    const bin = (id) => (fx && fx.sec[id] != null ? { x: secX(fx.sec[id]) + BIN_C.x, z: BIN.z1 + 8 } : null);
    return {
      energy: myEnergy(), serverEnergy: serverEnergy(ctx.me.id), frozen: frozen(ctx.me.id), quizOpen, question: quiz.q, floor: (fx && fx.floor) || [],
      x: me.x, z: me.z, sec, action: findAction(), items, beltZ: CONV.z1 + 6,
      myBin: ctx && bin(ctx.me.id), pad: sec != null ? { x: secX(sec) + PAD.x, z: PAD.z } : null,
      bins: fx ? Object.fromEntries(Object.keys(fx.sec).map((id) => [id, bin(id)])) : {},
      held: ctx && heldOf(ctx.me.id), started: !!(fx && fx.startAt && now() >= fx.startAt), W, H, camX,
    };
  }

  return {
    ITEMS, debug,
    attach(c) { ctx = c; },
    host,
    onState, onPos, onQuestion, deactivate, statusText,
    isActive: () => active,
  };
})();

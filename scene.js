// Krillion Latin: pixel scene renderer.
// Draws a low-resolution canvas that CSS scales up with crisp (pixelated) edges.
// Pseudo-3D look: one-point perspective on platform blocks, shading, depth sorting.
window.Scene = (() => {
  'use strict';

  // ---------- Customization data ----------
  const COLORS = ['#ff6b6b', '#ff9f43', '#ffd166', '#7bd389', '#2ec4b6', '#4cc9f0', '#4361ee', '#9b5de5', '#f15bb5', '#e9ecef'];
  const HATS = [['none', 'None'], ['laurel', 'Laurel'], ['crown', 'Crown'], ['cap', 'Cap'], ['helmet', 'Galea'], ['wizard', 'Wizard'], ['bow', 'Bow']];
  const EYES = [['dot', 'Dot'], ['wide', 'Wide'], ['happy', 'Happy'], ['sleepy', 'Sleepy'], ['shades', 'Shades']];

  const PAL = {
    g: '#5fbf4a', G: '#3d8a2f', y: '#ffd23f', Y: '#c99a12', r: '#e2453c', R: '#a82820', b: '#4cc9f0',
    c: '#2b59c3', C: '#1d3f8f', w: '#ffffff', s: '#c3ced8', S: '#7f8c99', p: '#9b5de5', P: '#6a3fb0',
    m: '#f15bb5', M: '#b83b85', k: '#14141f', h: '#ff4d6d', H: '#c9184a', x: '#3b4558', X: '#2a3142',
  };
  const HAT_MAPS = {
    laurel: { dy: -1, map: ['.g.g.g..g.g.g.', 'gGgGgG..GgGgGg'] },
    crown: { dy: -5, map: ['y..y..y', 'yy.y.yy', 'yyyyyyy', 'yrybyry', 'YYYYYYY'] },
    cap: { dy: -4, map: ['...cccccc.....', '..cccwwccc....', '.cccccccccc...', '.CCCCCCCCCCCCC'] },
    helmet: { dy: -5, map: ['.....rrrr.....', '....rRRRRr....', '...ssssssss...', '..sSSSSSSSSs..', '.ssssssssssss.', '.S..........S.'] },
    wizard: { dy: -9, map: ['.......p......', '......pp......', '......ppp.....', '.....pypp.....', '.....pppp.....', '....ppppPp....', '...pppppppp...', '..pppppppppp..', 'PPPPPPPPPPPPPP'] },
    bow: { dy: -3, ox: 3, map: ['mm.mm', 'mmMmm', 'mm.mm'] },
  };
  const HEART = ['.hh.hh.', 'hwhhhhh', 'hhhhhhh', '.hhhhh.', '..hhh..', '...h...'];
  const HEART_LOST = HEART.map((r) => r.replace(/[hw]/g, 'x'));

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const easeOutBounce = (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };
  function hash(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
  function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(hex, to, t) { const a = rgb(hex), b = to === 'w' ? [255, 255, 255] : to === 'k' ? [10, 14, 30] : rgb(to); return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`; }
  const now = () => performance.now();

  // ---------- State ----------
  let cv, ctx, W = 480, H = 270, SCALE = 2;
  let bg = null;
  let insetR = 0, insetB = 0; // css px reserved for UI
  let phase = 'home';
  let maxLives = 3;
  let VX = 240;
  const ents = new Map();
  const parts = [], texts = [], heartBits = [];
  let shake = 0, flashA = 0;
  const fish = { mode: 'none', owner: null, x: 0, y: 0, sx: 0, sy: 0, to: null, t0: 0, dur: 0, bump: 0, face: 1 };
  let fuseEnd = 0, fuseTotal = 1;
  const aim = { on: false, onPick: null, mx: -999, my: -999, hover: null };
  let celebrateUntil = 0, winnerId = null;
  const motes = [];
  let last = now();

  // ---------- Pixel primitives ----------
  function rect(c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function drawMap(map, x0, y0, pal = PAL, c = ctx) {
    for (let j = 0; j < map.length; j++) {
      const row = map[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        c.fillStyle = pal[ch] || ch;
        c.fillRect(Math.round(x0) + i, Math.round(y0) + j, 1, 1);
      }
    }
  }
  // Crisp scanline fill of a convex polygon (no anti-aliasing).
  function fillPoly(c, pts, color, g = ctx) {
    g.fillStyle = color;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    minY = Math.round(minY); maxY = Math.round(maxY);
    for (let y = minY; y < maxY; y++) {
      const yc = y + 0.5;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((yc >= y1 && yc < y2) || (yc >= y2 && yc < y1)) {
          const x = x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1);
          lo = Math.min(lo, x); hi = Math.max(hi, x);
        }
      }
      if (hi > lo) g.fillRect(Math.round(lo), y, Math.round(hi) - Math.round(lo), 1);
    }
  }
  function text(str, x, y, color = '#fff', size = 8, align = 'center', outline = '#0a1020') {
    ctx.font = `${size}px Silkscreen, monospace`;
    ctx.textAlign = align; ctx.textBaseline = 'top';
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = outline;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) ctx.fillText(str, x + dx, y + dy);
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function disc(cx, cy, r, color, g = ctx) {
    g.fillStyle = color;
    for (let y = -r; y <= r; y++) {
      const hw = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
      g.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
  }

  // ---------- Character ----------
  function normLook(l) {
    l = l || {};
    return {
      c: clamp(l.c | 0, 0, COLORS.length - 1),
      h: HATS.some((x) => x[0] === l.h) ? l.h : 'none',
      e: EYES.some((x) => x[0] === l.e) ? l.e : 'dot',
    };
  }
  function drawCharacter(g, x, standY, look, opts = {}) {
    const save = ctx; ctx = g;
    look = normLook(look);
    const base = COLORS[look.c];
    const light = mix(base, 'w', 0.4), dark = mix(base, 'k', 0.35), out = '#0b1320';
    const bob = opts.bob || 0;
    const x0 = Math.round(x) - 6;
    const by = Math.round(standY) - 13 - bob;
    const body = opts.flash ? '#ffffff' : base;
    // feet
    rect(out, x0 + 1, standY - 3, 5, 3); rect(out, x0 + 6, standY - 3, 5, 3);
    rect(dark, x0 + 2, standY - 3, 3, 2); rect(dark, x0 + 7, standY - 3, 3, 2);
    // outline + body
    rect(out, x0, by - 1, 12, 1); rect(out, x0 - 1, by, 14, 11); rect(out, x0, by + 11, 12, 1);
    rect(body, x0 + 1, by, 10, 1); rect(body, x0, by + 1, 12, 9); rect(body, x0 + 1, by + 10, 10, 1);
    if (!opts.flash) {
      rect(dark, x0 + 11, by + 2, 1, 8); rect(dark, x0 + 1, by + 9, 10, 2);
      rect(light, x0 + 1, by + 1, 4, 1); rect(light, x0 + 1, by + 2, 1, 3);
    }
    // face
    const k = '#14141f';
    switch (look.e) {
      case 'wide': rect('#fff', x0 + 2, by + 3, 3, 3); rect('#fff', x0 + 7, by + 3, 3, 3); rect(k, x0 + 3, by + 4, 2, 2); rect(k, x0 + 8, by + 4, 2, 2); break;
      case 'happy': for (const ox of [2, 7]) { rect(k, x0 + ox, by + 5, 1, 1); rect(k, x0 + ox + 1, by + 4, 1, 1); rect(k, x0 + ox + 2, by + 5, 1, 1); } break;
      case 'sleepy': rect(k, x0 + 2, by + 5, 3, 1); rect(k, x0 + 7, by + 5, 3, 1); break;
      case 'shades': rect(k, x0, by + 3, 12, 1); rect(k, x0 + 1, by + 4, 4, 2); rect(k, x0 + 7, by + 4, 4, 2); rect('#fff', x0 + 2, by + 4, 1, 1); rect('#fff', x0 + 8, by + 4, 1, 1); break;
      default: rect(k, x0 + 3, by + 4, 1, 2); rect(k, x0 + 8, by + 4, 1, 2);
    }
    if (look.e !== 'shades') { rect('#ff8fab', x0 + 1, by + 6, 2, 1); rect('#ff8fab', x0 + 9, by + 6, 2, 1); }
    rect(k, x0 + 5, by + 7, 2, 1);
    // hat
    const hat = HAT_MAPS[look.h];
    if (hat) drawMap(hat.map, Math.round(x) - Math.floor(hat.map[0].length / 2) + (hat.ox || 0), by + hat.dy, PAL, g);
    ctx = save;
  }

  // ---------- Background (angled top-down seafloor) ----------
  let horizonY = 50;
  function ellipseRows(g, cx, cy, rx, ry, color, seed) {
    g.fillStyle = color;
    const R = Math.max(1, Math.round(ry));
    for (let y = -R; y <= R; y++) {
      let hw = rx * Math.sqrt(Math.max(0, 1 - (y * y) / (R * R)));
      if (seed != null) hw += (hash(seed + y * 31) - 0.5) * 2.2;
      hw = Math.round(hw);
      if (hw > 0) g.fillRect(Math.round(cx) - hw, Math.round(cy) + y, hw * 2, 1);
    }
  }
  function buildBackground() {
    horizonY = Math.round(H * 0.2);
    bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    const water = ['#0a2742', '#0c2f4d', '#0f3858', '#124163'].map(rgb);
    const floor = ['#173d5f', '#1b466c', '#1f5079', '#235884', '#26608d'].map(rgb);
    const img = g.createImageData(W, H);
    const bayer = [0, 2, 3, 1];
    for (let y = 0; y < H; y++) {
      const isFloor = y >= horizonY;
      const cols = isFloor ? floor : water;
      const t = isFloor ? ((y - horizonY) / (H - horizonY)) * (cols.length - 1) : (y / horizonY) * (cols.length - 1);
      const i = Math.min(cols.length - 2, Math.floor(t)), f = t - i;
      for (let x = 0; x < W; x++) {
        const th = (bayer[(y & 1) * 2 + (x & 1)] + 0.5) / 4;
        let c = f > th ? cols[i + 1] : cols[i];
        if (isFloor) {
          const h = hash(x * 7919 + y * 104729);
          if (h < 0.07) c = c.map((v) => Math.min(255, v + 16));
          else if (h > 0.94) c = c.map((v) => Math.max(0, v - 12));
        }
        const o = (y * W + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // sand ripples, spaced wider toward the camera
    for (let i = 0; i < 14; i++) {
      const yy = horizonY + 6 + Math.pow(i / 14, 1.6) * (H - horizonY - 6);
      g.fillStyle = 'rgba(190,225,255,0.05)';
      for (let x = 0; x < W; x++) {
        if (hash(x + i * 977) < 0.35) continue;
        g.fillRect(x, Math.round(yy + Math.sin(x / (12 + i * 3) + i) * (1 + i * 0.12)), 1, 1);
      }
    }
    // far reef silhouettes along the horizon
    const branch = (x, y, a, len, d) => {
      for (let k = 0; k < len; k++) { g.fillRect(Math.round(x), Math.round(y), 1, 1); x += Math.cos(a); y += Math.sin(a); }
      if (d > 0) { branch(x, y, a - 0.45, len * 0.72, d - 1); branch(x, y, a + 0.4, len * 0.72, d - 1); }
    };
    g.fillStyle = '#0d3150';
    for (let x = -10; x < W + 10; x += 34) branch(x + hash(x + 3) * 20, horizonY + 3, -Math.PI / 2 + (hash(x) - 0.5) * 0.3, 7 + hash(x + 9) * 7, 3);
    for (let x = -8; x < W + 8; x += 13) ellipseRows(g, x + hash(x + 1) * 8, horizonY + 2, 5 + hash(x + 2) * 8, 3 + hash(x + 4) * 4, '#0f3555', x);
    for (let x = -4; x < W + 4; x += 9) ellipseRows(g, x + hash(x + 5) * 6, horizonY + 4, 3 + hash(x + 6) * 5, 2 + hash(x + 7) * 2, '#123b5c', x + 50);
  }
  function spike(g, cx, baseY, w, h, lightC, darkC, tipC) {
    for (let i = 0; i < h; i++) {
      const y = baseY - h + i;
      const ww = Math.max(1, Math.round((w * (i + 1)) / h));
      const x0 = Math.round(cx - ww / 2);
      const half = Math.ceil(ww / 2);
      g.fillStyle = i < 2 ? tipC : lightC; g.fillRect(x0, y, half, 1);
      g.fillStyle = i < 2 ? mix(tipC, 'k', 0.3) : darkC; g.fillRect(x0 + half, y, ww - half, 1);
    }
  }
  // Spike pit in the middle of the ring (where knocked-out players fall).
  const pit = { c: null, r: 0, ry: 0, x: 0, y: 0, tx: 0, ty: 0, placed: false };
  function buildPit(r, ry) {
    r = Math.round(r); ry = Math.max(6, Math.round(ry));
    const w = r * 2 + 12, h = ry * 2 + 12;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const cx = w / 2, cy = h / 2;
    ellipseRows(g, cx + 1, cy + 3, r + 5, ry + 3, 'rgba(5,15,30,0.35)');
    ellipseRows(g, cx, cy + 1, r + 4, ry + 3, '#3b4555', 7);
    ellipseRows(g, cx, cy, r + 3, ry + 2, '#6b7a8f', 7);
    ellipseRows(g, cx, cy - 1, r + 1, ry + 1, '#8796ab', 9);
    ellipseRows(g, cx, cy, r, ry, '#2b3445');
    g.save();
    g.beginPath(); g.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2); g.clip();
    ellipseRows(g, cx, cy + Math.max(3, ry * 0.35), r, ry, '#05080f');
    ellipseRows(g, cx, cy + ry * 0.5, r * 0.8, ry * 0.6, 'rgba(226,69,60,0.22)');
    const rows = 4;
    for (let j = 0; j < rows; j++) {
      const yrow = cy - ry * 0.2 + (j / (rows - 1)) * ry * 1.05;
      const front = j / (rows - 1);
      const sw = 4 + Math.round(front * 3), sh = 5 + Math.round(front * 4);
      const half = r * Math.sqrt(Math.max(0, 1 - Math.pow((yrow - cy) / ry, 2)));
      for (let x = cx - half + sw / 2 + ((j % 2) * sw) / 2; x < cx + half - 1; x += sw + 1) {
        if (front > 0.5) spike(g, x, yrow + 2, sw, sh, '#d4dde8', '#7d8b9c', '#e2453c');
        else spike(g, x, yrow + 2, sw, sh, '#7d8b9c', '#4a566b', '#b33a3a');
      }
    }
    g.restore();
    return c;
  }

  // ---------- Layout: players on a ring around the pit, you at the bottom ----------
  let ring = { cx: 0, cy: 0, rx: 80, ry: 30 };
  function layout() {
    const list = [...ents.values()].filter((e) => !e.leaving);
    const n = list.length;
    const areaW = W - insetR / SCALE;
    const areaH = H - insetB / SCALE;
    const top = horizonY + 44, bottom = areaH - 22;
    const ry = Math.max(16, (bottom - top) / 2);
    const rx = Math.max(40, Math.min(areaW / 2 - 50, ry * 2.6));
    ring = { cx: areaW / 2, cy: (top + bottom) / 2, rx, ry };
    VX = ring.cx;
    const meIdx = list.findIndex((e) => e.isMe);
    const ordered = meIdx > 0 ? [...list.slice(meIdx), ...list.slice(0, meIdx)] : list;
    const two = n > 12;
    const outerN = two ? Math.ceil(n * 0.6) : n;
    ordered.forEach((e, k) => {
      const inner = k >= outerN;
      const cnt = inner ? n - outerN : outerN;
      const i = inner ? k - outerN : k;
      const sc = inner ? 0.58 : 1;
      const a = Math.PI / 2 + (Math.PI * 2 * i) / cnt + (inner ? Math.PI / cnt : 0);
      e.tx = ring.cx + Math.cos(a) * rx * sc;
      e.ty = ring.cy + Math.sin(a) * ry * sc;
    });
    const pr = clamp((two ? rx * 0.58 : rx) * 0.3, 16, 52);
    if (!pit.c || Math.abs(pit.r - pr) > 1.5) { pit.r = pr; pit.ry = Math.max(6, Math.round(pr * (ry / rx))); pit.c = buildPit(pr, pit.ry); }
    pit.tx = ring.cx; pit.ty = ring.cy;
    if (!pit.placed) { pit.x = pit.tx; pit.y = pit.ty; pit.placed = true; }
  }

  function setPlayers(list, opts = {}) {
    if (opts.maxLives) maxLives = opts.maxLives;
    const ids = new Set(list.map((p) => p.id));
    for (const e of ents.values()) if (!ids.has(e.id) && !e.leaving) { e.leaving = true; e.appearT0 = now(); }
    for (const p of list) {
      let e = ents.get(p.id);
      if (!e || e.leaving) {
        e = { id: p.id, x: 0, y: 0, tx: 0, ty: 0, appearT0: now(), seed: strHash(p.id), hitUntil: 0, fall: null, ghost: false, leaving: false, placed: false, catchAt: 0 };
        ents.set(p.id, e);
      }
      e.name = p.name; e.look = p.look; e.isMe = !!p.isMe; e.gone = !!p.gone;
      e.lives = p.lives == null ? maxLives : p.lives;
      if (p.out && !e.out && !e.fall) e.ghost = true;
      if (!p.out) { e.ghost = false; e.fall = null; }
      e.out = !!p.out;
      if (e.appearHearts == null && ['intro', 'play', 'pop', 'over'].includes(phase)) e.appearHearts = now();
    }
    layout();
    for (const e of ents.values()) if (!e.placed) { e.x = e.tx; e.y = e.ty; e.placed = true; }
  }

  // ---------- Effects ----------
  function burst(x, y, n, colors, speed = 60, size = 1, grav = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, g: grav, life: 0, max: 0.5 + Math.random() * 0.6, c: colors[i % colors.length], s: size + (Math.random() < 0.3 ? 1 : 0) });
    }
  }
  function floatText(x, y, str, color, size = 8) { texts.push({ x, y, str, color, size, t0: now(), dur: 1100 }); }
  function standY(e) { return e.y + 1; }
  function fishHome(e) { return { x: e.x, y: standY(e) - 46 }; }

  function fishDrop(id) {
    const e = ents.get(id); if (!e) return;
    const h = fishHome(e);
    Object.assign(fish, { mode: 'drop', to: id, owner: null, sx: h.x, sy: -24, t0: now(), dur: 750 });
  }
  function fishThrow(from, to) {
    const e = ents.get(to); if (!e) return fishHold(to);
    if (fish.mode === 'throw' && fish.to === to) return;
    const h = fishHome(e);
    const sx = fish.mode === 'none' ? h.x : fish.x, sy = fish.mode === 'none' ? h.y : fish.y;
    const dist = Math.hypot(h.x - sx, h.y - sy);
    fish.face = h.x >= sx ? 1 : -1;
    Object.assign(fish, { mode: 'throw', to, owner: null, sx, sy, t0: now(), dur: clamp(450 + dist * 1.6, 500, 950) });
  }
  function fishHold(id) { fish.mode = id ? 'held' : 'none'; fish.owner = id; fish.to = id; }
  function fishBusy() { return fish.mode === 'drop' || fish.mode === 'throw'; }
  function fishTarget() { return fish.to; }

  function wrong(id) {
    fish.bump = 1;
    const e = ents.get(id);
    const p = e ? fishHome(e) : { x: fish.x, y: fish.y };
    floatText(p.x + 12, p.y - 6, '-4s', '#ff5d5d', 16);
    burst(fish.x, fish.y, 10, ['#ff5d5d', '#ffd166'], 50);
    shake = Math.max(shake, 3);
    if (e) e.hitUntil = now() + 250;
  }
  function right(id) {
    const e = ents.get(id); if (!e) return;
    floatText(e.x, standY(e) - 32, '+100', '#ffd166', 8);
    burst(e.x, standY(e) - 8, 14, ['#ffd166', '#7bd389', '#ffffff'], 70);
  }
  function pop(id, out) {
    const e = ents.get(id);
    const fx = fish.x, fy = fish.y;
    const r = 13;
    burst(fx, fy, 46, ['#ffd166', '#ff9f43', '#e2453c', '#ffffff', '#c9861a'], 140, 1, 160);
    burst(fx, fy, 14, ['#bfe9ff'], 40, 2, -30);
    fish.mode = 'none'; fish.owner = null; fish.to = null;
    shake = 8; flashA = 0.55;
    floatText(fx, fy - r - 6, 'POP!', '#ffffff', 16);
    if (e) {
      e.hitUntil = now() + 700;
      const idx = Math.max(0, (e.lives || 1) - 1);
      const hx = heartX(e, idx), hy = standY(e) - 28;
      heartBits.push({ x: hx, y: hy, vx: -30, vy: -60, t0: now(), half: 0 }, { x: hx + 4, y: hy, vx: 30, vy: -60, t0: now(), half: 1 });
      if (out) e.fall = { t0: now() + 450, dur: 650, sink: 450, landed: false };
    }
  }
  function celebrate(id) { winnerId = id; celebrateUntil = now() + 5000; }

  function heartX(e, i) { const total = maxLives * 8 - 1; return Math.round(e.x - total / 2) + i * 8; }

  // ---------- Input ----------
  function toInternal(ev) {
    const r = cv.getBoundingClientRect();
    const p = ev.touches ? ev.touches[0] : ev;
    return { x: (p.clientX - r.left) / SCALE, y: (p.clientY - r.top) / SCALE };
  }
  function hitTest(x, y) {
    let best = null;
    for (const e of ents.values()) {
      if (e.leaving || e.out || e.gone || e.isMe) continue;
      if (x > e.x - 22 && x < e.x + 22 && y > standY(e) - 40 && y < e.y + 16) best = e;
    }
    return best;
  }
  function onMove(ev) {
    const p = toInternal(ev); aim.mx = p.x; aim.my = p.y;
    aim.hover = aim.on ? hitTest(p.x, p.y) : null;
    cv.style.cursor = aim.hover ? 'pointer' : aim.on ? 'crosshair' : 'default';
  }
  function onClick(ev) {
    if (!aim.on) return;
    onMove(ev);
    if (aim.hover && aim.onPick) { const id = aim.hover.id; aim.on = false; aim.hover = null; cv.style.cursor = 'default'; aim.onPick(id); }
  }
  function setAim(on, onPick) {
    aim.on = !!on; aim.onPick = onPick;
    if (!on) { aim.hover = null; if (cv) cv.style.cursor = 'default'; }
  }

  // ---------- Drawing ----------
  function drawPlatform(e, x, y, alpha, highlight) {
    const rx = 17, ry = 7, side = 6;
    const dim = e.gone || e.out;
    ctx.globalAlpha = alpha;
    ellipseRows(ctx, x + 2, y + side + 3, rx + 3, ry + 1, 'rgba(5,15,30,0.4)');
    ellipseRows(ctx, x, y + side, rx, ry, '#2f3747', e.seed);
    rect('#465166', x - rx, y, rx * 2, side);
    rect('#56627a', x - rx, y, 3, side);
    rect('#3a4456', x + rx - 3, y, 3, side);
    for (let j = 0; j < 7; j++) rect('#3a4456', x - rx + 3 + hash(e.seed + j) * (rx * 2 - 6), y + 1 + Math.floor(hash(e.seed + 20 + j) * (side + 2)), 1, 2);
    if (highlight) ellipseRows(ctx, x, y, rx + 2, ry + 2, '#ffd166');
    ellipseRows(ctx, x, y, rx, ry, dim ? '#3f6b63' : '#2f8f73', e.seed);
    ellipseRows(ctx, x - 1, y - 1, rx - 3, ry - 2, dim ? '#4f7d74' : '#3fae8c', e.seed + 3);
    rect(dim ? '#5f8f85' : '#6fd6ad', x - rx * 0.55, y - ry, rx * 1.1, 1);
    for (let j = 0; j < 8; j++) {
      const a = hash(e.seed + 50 + j) * Math.PI * 2, d = hash(e.seed + 70 + j) * 0.8;
      rect(j % 2 ? '#2b7d66' : '#5cc79f', x + Math.cos(a) * rx * d, y + Math.sin(a) * ry * d, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawFish(cx, cy, inf, face, t) {
    const r = Math.round(6 + inf * 6 + fish.bump * 2);
    cx = Math.round(cx); cy = Math.round(cy);
    const hue = 48 - inf * 42;
    const base = `hsl(${hue},95%,58%)`, dark = `hsl(${hue},80%,36%)`, light = `hsl(${hue},100%,78%)`;
    // spikes
    const len = 1 + Math.round(inf * 3 + fish.bump * 2);
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.13;
      for (let s = 1; s <= len; s++) {
        ctx.fillStyle = s === len ? '#fff1cf' : dark;
        ctx.fillRect(cx + Math.round(Math.cos(a) * (r + s)), cy + Math.round(Math.sin(a) * (r + s)), 1, 1);
      }
    }
    // tail
    const wag = Math.round(Math.sin(t / 120));
    for (let i = 0; i < 4; i++) rect(dark, cx - face * (r + 1 + i) - (face < 0 ? 0 : 0), cy - i - 1 + wag, 1, i * 2 + 2);
    disc(cx, cy, r + 1, '#1b1b2f');
    disc(cx, cy, r, base);
    // shading: lower-right dark crescent, upper-left shine
    for (let y = -r; y <= r; y++) {
      const hw = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
      if (y > r * 0.35) { ctx.fillStyle = '#fff1cf'; ctx.fillRect(cx - hw + 2, cy + y, Math.max(0, hw * 2 - 3), 1); }
      ctx.fillStyle = dark; ctx.fillRect(cx + hw, cy + y, 1, 1);
      if (y > r * 0.75) ctx.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
    rect(light, cx - Math.round(r * 0.55), cy - Math.round(r * 0.6), 3, 1);
    rect(light, cx - Math.round(r * 0.65), cy - Math.round(r * 0.6) + 1, 1, 2);
    // fin
    rect(dark, cx - face * 2, cy + 1, 2, 3);
    // eye
    const ex = cx + face * Math.round(r * 0.45), ey = cy - Math.round(r * 0.3);
    rect('#ffffff', ex - 1, ey - 1, 4, 4);
    rect('#14141f', ex + (face > 0 ? 1 : 0), ey, 2, 2);
    // mouth
    rect('#c2453c', cx + face * r - (face > 0 ? 1 : 0), cy + Math.round(r * 0.2), 1, 2);
    return r;
  }

  function drawPit(t) {
    ctx.drawImage(pit.c, Math.round(pit.x - pit.c.width / 2), Math.round(pit.y - pit.c.height / 2));
    for (const e of ents.values()) {
      const f = e.fall;
      if (!f || f.landed || t < f.t0) continue;
      const p = clamp((t - f.t0) / f.dur, 0, 1);
      const sx = e.x, sy = standY(e), ex = pit.x, ey = pit.y - 1;
      if (p < 1) {
        const q = easeInOut(p);
        drawCharacter(ctx, lerp(sx, ex, q), lerp(sy, ey, q) - 34 * 4 * q * (1 - q), e.look, { flash: Math.floor(t / 80) % 2 === 0 });
      } else {
        const q = clamp((t - f.t0 - f.dur) / f.sink, 0, 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, Math.round(pit.y));
        ctx.ellipse(Math.round(pit.x), Math.round(pit.y), pit.r, pit.ry, 0, 0, Math.PI * 2);
        ctx.clip();
        drawCharacter(ctx, ex, ey + easeOutCubic(q) * 24, e.look, { flash: true });
        ctx.restore();
      }
    }
  }

  function update(dt, t) {
    const k = 1 - Math.exp(-dt / 0.12);
    for (const e of ents.values()) {
      e.x = lerp(e.x, e.tx, k); e.y = lerp(e.y, e.ty, k);
      if (e.leaving && t - e.appearT0 > 350) ents.delete(e.id);
      if (e.fall && !e.fall.landed && t > e.fall.t0 + e.fall.dur + e.fall.sink) {
        e.fall.landed = true; e.ghost = true;
        burst(pit.x, pit.y, 26, ['#d4dde8', '#ffffff', '#9aa7b8'], 80, 2, 120);
        burst(pit.x, pit.y, 10, ['#e2453c'], 60);
        floatText(pit.x, pit.y - 30, 'OUT!', '#ff5d5d', 16);
        shake = Math.max(shake, 5);
      }
    }
    pit.x = lerp(pit.x, pit.tx, k); pit.y = lerp(pit.y, pit.ty, k);
    // fish motion
    if (fish.mode === 'drop' || fish.mode === 'throw') {
      const e = ents.get(fish.to);
      const p = clamp((t - fish.t0) / fish.dur, 0, 1);
      const h = e ? fishHome(e) : { x: fish.sx, y: fish.sy };
      if (fish.mode === 'drop') { fish.x = h.x; fish.y = lerp(fish.sy, h.y, easeOutBounce(p)); }
      else {
        const q = easeInOut(p);
        const arc = 40 + Math.abs(h.x - fish.sx) * 0.25;
        fish.x = lerp(fish.sx, h.x, q); fish.y = lerp(fish.sy, h.y, q) - arc * 4 * q * (1 - q);
        if (Math.random() < 0.5) parts.push({ x: fish.x, y: fish.y, vx: 0, vy: -10, g: -20, life: 0, max: 0.6, c: '#bfe9ff', s: 1 });
      }
      if (p >= 1) {
        fish.owner = fish.to; fish.mode = 'held';
        if (e) { e.catchAt = t; burst(e.x, standY(e) - 2, 12, ['#e6f4ff', '#9fd8ef'], 50, 1, 60); }
        shake = Math.max(shake, 2);
      }
    } else if (fish.mode === 'held') {
      const e = ents.get(fish.owner);
      if (e) {
        const h = fishHome(e);
        fish.x = h.x; fish.y = h.y + (Math.floor(t / 400) % 2);
        // face toward aim/hover
        if (aim.on && e.isMe) fish.face = (aim.hover ? aim.hover.x : aim.mx) >= fish.x ? 1 : -1;
      }
    }
    fish.bump = Math.max(0, fish.bump - dt * 3);
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985;
      if (p.life > p.max) parts.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) if (t - texts[i].t0 > texts[i].dur) texts.splice(i, 1);
    for (let i = heartBits.length - 1; i >= 0; i--) {
      const b = heartBits[i]; b.vy += 300 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (t - b.t0 > 900) heartBits.splice(i, 1);
    }
    for (const m of motes) { m.y -= m.v * dt; m.x += Math.sin(t / 1000 + m.p) * 4 * dt; if (m.y < -2) { m.y = H + 2; m.x = Math.random() * W; } }
    shake = Math.max(0, shake - dt * 18);
    flashA = Math.max(0, flashA - dt * 1.8);
    if (t < celebrateUntil && Math.random() < 0.7) {
      for (let i = 0; i < 2; i++) parts.push({ x: Math.random() * W, y: -4, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 30, g: 30, life: 0, max: 4, c: COLORS[(Math.random() * COLORS.length) | 0], s: 2 });
    }
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    // light rays
    for (let i = 0; i < 4; i++) {
      const x = W * (0.12 + i * 0.26) + Math.sin(t / 3000 + i) * 10;
      ctx.globalAlpha = 0.05 + 0.03 * Math.sin(t / 1700 + i * 2);
      fillPoly(null, [[x, 0], [x + 18, 0], [x + 70, H * 0.8], [x + 30, H * 0.8]], '#bdf1ff');
    }
    ctx.globalAlpha = 1;
    for (const m of motes) { ctx.globalAlpha = m.a; rect('#cdefff', m.x, m.y, 1, 1); }
    ctx.globalAlpha = 1;

    const sx = shake > 0.3 ? Math.round((Math.random() - 0.5) * shake) : 0;
    const sy = shake > 0.3 ? Math.round((Math.random() - 0.5) * shake) : 0;
    ctx.setTransform(1, 0, 0, 1, sx, sy);

    const inGame = phase === 'intro' || phase === 'play' || phase === 'pop' || phase === 'over';
    const items = [...ents.values()];
    if (pit.c) items.push({ isPit: true, y: pit.y });
    items.sort((a, b) => a.y - b.y);
    for (const e of items) {
      if (e.isPit) { drawPit(t); continue; }
      const p = clamp((t - e.appearT0) / 550, 0, 1);
      const appear = e.leaving ? 1 - clamp((t - e.appearT0) / 350, 0, 1) : easeOutBack(p);
      const x = Math.round(e.x), y = Math.round(e.y + (1 - appear) * 24);
      const alpha = clamp(e.leaving ? appear : p * 2, 0, 1) * (e.gone ? 0.5 : 1);
      const hl = aim.on && aim.hover === e && Math.floor(t / 150) % 2 === 0;
      drawPlatform(e, x, y, alpha, hl);
      const sY = y + 1;
      // shadow
      ctx.globalAlpha = 0.35 * alpha; rect('#0b2a26', x - 6, sY - 1, 12, 2); ctx.globalAlpha = 1;
      // character
      ctx.globalAlpha = alpha;
      if (e.ghost && !(e.fall && !e.fall.landed)) {
        ctx.globalAlpha = 0.4 * alpha;
        drawCharacter(ctx, x, sY - 3 + Math.round(Math.sin(t / 400 + e.seed) * 2), e.look, {});
      } else if (e.fall && t > e.fall.t0 && !e.fall.landed) {
        // drawn by drawPit (flies into the spike pit)
      } else {
        let bob = Math.floor((t + e.seed % 900) / 450) % 2;
        if (t - e.catchAt < 160) bob = -1;
        const jump = winnerId === e.id ? Math.round(Math.abs(Math.sin(t / 180)) * 12) : 0;
        const flash = t < e.hitUntil && Math.floor(t / 70) % 2 === 0;
        drawCharacter(ctx, x, sY - jump, e.look, { bob: jump ? 0 : bob, flash });
      }
      ctx.globalAlpha = alpha;
      // hearts
      if (inGame) {
        for (let i = 0; i < maxLives; i++) {
          const hp = clamp((t - e.appearHearts - i * 90) / 300, 0, 1);
          if (e.appearHearts == null || hp <= 0) continue;
          const dy = Math.round((1 - easeOutBack(hp)) * 8);
          drawMap(i < e.lives ? HEART : HEART_LOST, heartX(e, i), sY - 28 + dy);
        }
      } else if (e.isMe) {
        const b = Math.floor(t / 300) % 2;
        drawMap(['yyyyy', '.yyy.', '..y..'], x - 2, sY - 24 - b);
      }
      // name
      text(e.name || '', x, y + 15, e.isMe ? '#ffd166' : '#ffffff');
      ctx.globalAlpha = 1;
    }


    // heart fragments
    for (const b of heartBits) {
      const p = clamp((t - b.t0) / 900, 0, 1);
      ctx.globalAlpha = 1 - p;
      drawMap(HEART.map((r) => (b.half ? '...' + r.slice(4) : r.slice(0, 4))), b.x, b.y);
    }
    ctx.globalAlpha = 1;

    // aim arc
    if (aim.on && fish.mode === 'held') {
      const tx = aim.hover ? fishHome(aim.hover).x : aim.mx, ty = aim.hover ? fishHome(aim.hover).y : aim.my;
      if (tx > -500) {
        const arc = 40 + Math.abs(tx - fish.x) * 0.25;
        const off = (t / 60) % 4;
        for (let i = 0; i <= 40; i++) {
          if ((i + Math.floor(off)) % 4 > 1) continue;
          const q = i / 40;
          const ax = lerp(fish.x, tx, q), ay = lerp(fish.y, ty, q) - arc * 4 * q * (1 - q);
          rect(aim.hover ? '#ffd166' : 'rgba(255,255,255,0.7)', ax, ay, 2, 2);
        }
        if (aim.hover) text('THROW!', aim.hover.x, standY(aim.hover) - 64 - (Math.floor(t / 250) % 2), '#ffd166');
      }
    }

    // fish
    if (fish.mode !== 'none') {
      const left = Math.max(0, fuseEnd - Date.now());
      const inf = phase === 'play' || phase === 'intro' ? clamp(1 - left / fuseTotal, 0, 1) : 0;
      const r = drawFish(fish.x, fish.y, inf, fish.face, t);
      if (fish.mode === 'held' && phase === 'play') {
        const secs = Math.ceil(Math.min(left, fuseTotal) / 1000);
        const urgent = secs <= 5;
        const blink = urgent && Math.floor(t / 250) % 2 === 0;
        text(String(secs), fish.x, fish.y - r - (urgent ? 22 : 14), urgent ? (blink ? '#ffffff' : '#ff5d5d') : '#ffffff', urgent ? 16 : 8);
      }
    }

    // particles
    for (const p of parts) {
      ctx.globalAlpha = clamp(1 - p.life / p.max, 0, 1) * 1.4;
      rect(p.c, p.x, p.y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    // floating texts
    for (const f of texts) {
      const p = (t - f.t0) / f.dur;
      ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
      const pop = p < 0.12 ? Math.round((1 - p / 0.12) * 4) : 0;
      text(f.str, f.x, f.y - easeOutCubic(p) * 18 - pop, f.color, f.size);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (flashA > 0) { ctx.globalAlpha = flashA; rect('#ffffff', 0, 0, W, H); ctx.globalAlpha = 1; }
  }

  function frame() {
    const t = now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    update(dt, t);
    draw(t);
    requestAnimationFrame(frame);
  }

  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    SCALE = Math.max(2, Math.floor(Math.min(vh / 230, vw / 380)));
    W = Math.ceil(vw / SCALE); H = Math.ceil(vh / SCALE);
    cv.width = W; cv.height = H;
    cv.style.width = W * SCALE + 'px'; cv.style.height = H * SCALE + 'px';
    ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    buildBackground();
    motes.length = 0;
    for (let i = 0; i < Math.round(W / 9); i++) motes.push({ x: Math.random() * W, y: Math.random() * H, v: 4 + Math.random() * 8, p: Math.random() * 6, a: 0.2 + Math.random() * 0.4 });
    layout();
    for (const e of ents.values()) { e.x = e.tx; e.y = e.ty; }
    pit.x = pit.tx; pit.y = pit.ty;
  }

  function init(canvas) {
    cv = canvas;
    resize();
    window.addEventListener('resize', resize);
    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('click', onClick);
    cv.addEventListener('touchstart', (e) => { onMove(e); onClick(e); }, { passive: true });
    requestAnimationFrame(frame);
  }

  function setPhase(p) {
    const wasGame = ['intro', 'play', 'pop', 'over'].includes(phase);
    const isGame = ['intro', 'play', 'pop', 'over'].includes(p);
    if (isGame && !wasGame) { const t = now(); for (const e of ents.values()) e.appearHearts = t + 200; }
    if (!isGame) { fish.mode = 'none'; fish.owner = null; fish.to = null; winnerId = null; celebrateUntil = 0; }
    phase = p;
  }
  function setInsets(r, b) {
    if (Math.abs(r - insetR) < 2 && Math.abs(b - insetB) < 2) return;
    insetR = r; insetB = b; layout();
  }
  function setTimer(end, total) { fuseEnd = end; fuseTotal = Math.max(1, total); }

  function drawPreview(canvas, look) {
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    drawCharacter(g, canvas.width / 2, canvas.height - 2, look, {});
  }

  // Screen positions of characters (used by automated tests).
  function debug() { return [...ents.values()].map((e) => ({ id: e.id, name: e.name, out: e.out, isMe: e.isMe, x: e.x * SCALE, y: (e.y - 14) * SCALE })); }

  return {
    debug, COLORS, HATS, EYES, init, setPlayers, setPhase, setInsets, setTimer, setAim,
    fishDrop, fishThrow, fishHold, fishBusy, fishTarget, wrong, right, pop, celebrate, drawPreview, normLook,
  };
})();

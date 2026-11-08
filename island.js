// Krillion Latin: Survival Island mode (top-down pixel island).
// Answer multiple-choice questions for energy (same rules as Factory: walking uses 10/s, standing is free,
// at 0 you freeze). Explore the island to dig up hidden antiques (the same 20 items as Factory) and grab
// coins, sell antiques at the Trader, and buy ship parts from the Shipwright. When the timer ends everyone
// is teleported to their ship and sails through the storm: every obstacle checks one or two ship stats.
// The ship that gets furthest (then with the most hull left) wins.
//
// Networking matches Factory: the host is authoritative for energy, digs, coins, money, purchases and the
// voyage results. Positions are dead-reckoned ('pos' on start / stop / turn + 1 s heartbeat).
window.Island = (() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => UI.esc(s);
  const ITEMS = Factory.ITEMS;
  const TOTAL_W = ITEMS.reduce((a, it) => a + it.w, 0);
  const NOTIFY_TIER = 4;

  // ---------- world (internal pixels) ----------
  const WW = 1600, WH = 1088, G = 2, GW = WW / G, GH = WH / G;
  const ISLAND_SEED = 4172;
  const CX = WW * 0.5, CY = WH * 0.45, RX = WW * 0.45, RY = WH * 0.4;
  const SHORE_Y = 790;                          // the straight harbor beach
  const HARBOR = { x0: 470, x1: 1130 };
  const TRADER = { x: 710, y: 700 }, MARKET = { x: 890, y: 700 };
  const PLAZA = { x: 800, y: 694, rx: 170, ry: 58 };
  const PIER_LEN = 74, PIER_W = 10;
  const WALK = 92, ACCEL = 900;
  const COUNTDOWN = 3500;
  const GAIN_DEFAULT = 100, DRAIN_WALK = 10;
  const PACK = 5, DIG_R = 18, DIG_MS = 1200, COIN_MS = 600, SEE_R = 48, GLINT_R = 140, COIN_R = 10, STAND_R = 40;
  const V_TELE = 2600, V_OBS = 3400, V_END = 3200;  // 2D fallback storm timing (ms)
  // The storm film (voyage3d.js): intro, one shot per captain, set sail, one segment per danger, ending.
  const VP = { intro: 6000, crew: 2800, crewMax: 6, sail: 4000, obs: 7000, end: 9000 };
  const Z = { DEEP: 0, WATER: 1, SHALLOW: 2, SAND: 3, GRASS: 4, FOREST: 5, HILL: 6, PLAZA: 7 };
  const DIFF = {
    easy: { label: 'Easy', trs: 46, coins: 30, coin: [5, 10] },
    medium: { label: 'Medium', trs: 36, coins: 22, coin: [4, 8] },
    hard: { label: 'Hard', trs: 28, coins: 16, coin: [3, 6] },
  };
  const TILE_COLORS = ['amber', 'teal', 'pink', 'blue', 'purple', 'green', 'orange', 'slate'];

  // ---------- ship parts ----------
  // slot h = hull, s = sail, k = keel (each replaced by a better tier), x = extras (one of each).
  const PARTS = [
    { id: 'h0', slot: 'h', tier: 0, name: 'Log Raft', price: 0, st: { hull: 1 }, desc: 'Where everyone starts.',
      map: ['........', '........', 'LlLlLlLl', 'llllllll', 'LlLlLlLl', 'llllllll', 'LlLlLlLl', '........'], pal: { L: '#7a4a24', l: '#a8693a' } },
    { id: 'h1', slot: 'h', tier: 1, name: 'Plank Hull', price: 60, st: { hull: 3 }, desc: 'Nailed planks. Much sturdier than logs.',
      map: ['........', '........', '........', 'HhhhhhhH', 'HppppppH', '.HppppH.', '..HHHH..', '........'], pal: { H: '#6b3e1c', h: '#d9a96a', p: '#b07a45' } },
    { id: 'h2', slot: 'h', tier: 2, name: 'Oak Hull', price: 180, st: { hull: 5, bal: 1 }, desc: 'Thick oak with a deck rail.',
      map: ['........', '........', 'RRRRRRRR', 'HhhhhhhH', 'HppppppH', '.HppppH.', '..HHHH..', '........'], pal: { R: '#3d2410', H: '#3d2410', h: '#9a6330', p: '#7a4a24' } },
    { id: 'h3', slot: 'h', tier: 3, name: 'Copper-Clad Hull', price: 420, st: { hull: 8, bal: 1 }, desc: 'Copper plating shrugs off rocks and waves.',
      map: ['........', '........', 'RRRRRRRR', 'HhohhohH', 'HppppppH', '.HccccH.', '..HHHH..', '........'], pal: { R: '#2f1a0b', H: '#2f1a0b', h: '#7a4a24', o: '#ffd166', p: '#6b3d1e', c: '#d9823b' } },
    { id: 's1', slot: 's', tier: 1, name: 'Patched Sail', price: 40, st: { spd: 2 }, desc: 'Holes and all, it catches the wind.',
      map: ['...M....', '...Mss..', '...Mscs.', '...Msss.', '...Mcsss', '...M....', 'HHHHHHHH', '.HHHHHH.'], pal: { M: '#5a3618', s: '#e9dcb8', c: '#c9a46a', H: '#7a4a24' } },
    { id: 's2', slot: 's', tier: 2, name: 'Canvas Sail', price: 140, st: { spd: 4 }, desc: 'A tall mast with fresh canvas.',
      map: ['...M....', '..sMsss.', '.ssMssss', '.ssMssss', '..sMsss.', '...M....', 'HHHHHHHH', '.HHHHHH.'], pal: { M: '#5a3618', s: '#f4f1e8', H: '#7a4a24' } },
    { id: 's3', slot: 's', tier: 3, name: 'Twin Masts', price: 360, st: { spd: 7 }, desc: 'Two masts of sail. Outruns any storm.',
      map: ['.M...M..', '.Ms..Ms.', '.Mss.Mss', '.Mss.Mss', '.Ms..Ms.', '.M...M..', 'HHHHHHHH', '.HHHHHH.'], pal: { M: '#5a3618', s: '#ffffff', H: '#6b3d1e' } },
    { id: 'k1', slot: 'k', tier: 1, name: 'Ballast Stones', price: 50, st: { bal: 2 }, desc: 'Heavy stones low in the hull.',
      map: ['........', '........', '........', '..SS....', '.SsSS.S.', 'SSSssSSs', '.SSSSSS.', '........'], pal: { S: '#6f7884', s: '#a9b3bd' } },
    { id: 'k2', slot: 'k', tier: 2, name: 'Wooden Keel', price: 130, st: { bal: 4 }, desc: 'A fin under the hull keeps you steady.',
      map: ['........', 'HHHHHHHH', '.HhhhhH.', '..HHHH..', '...kk...', '...kk...', '...kk...', '........'], pal: { H: '#7a4a24', h: '#b07a45', k: '#5a3618' } },
    { id: 'k3', slot: 'k', tier: 3, name: 'Iron Keel', price: 300, st: { bal: 6 }, desc: 'A deep iron keel. Almost impossible to tip.',
      map: ['........', 'HHHHHHHH', '.HhhhhH.', '..HHHH..', '..kKKk..', '..kKKk..', '...kk...', '........'], pal: { H: '#7a4a24', h: '#b07a45', k: '#5f6974', K: '#a9b3bd' } },
    { id: 'oars', slot: 'x', name: 'Oars', price: 45, st: { spd: 1, nav: 1 }, desc: 'Row when the wind dies.',
      map: ['W.......', '.W......', '..W.....', '...W....', '....W...', '.....BB.', '.....BBB', '......BB'], pal: { W: '#a8693a', B: '#d9a96a' } },
    { id: 'rope', slot: 'x', name: 'Rope Coil', price: 25, st: { hull: 1 }, desc: 'Lash everything down.',
      map: ['..rrrr..', '.rRRRRr.', 'rRr..rRr', 'rR....Rr', 'rR....Rr', 'rRr..rRr', '.rRRRRr.', '..rrrr..'], pal: { r: '#9a7a4a', R: '#d8c08a' } },
    { id: 'tar', slot: 'x', name: 'Tar Barrel', price: 55, st: { hull: 2 }, desc: 'Seal the leaks.',
      map: ['.bbbbbb.', 'bBBBBBBb', 'bkkkkkkb', 'bBBBBBBb', 'bkkkkkkb', 'bBBBBBBb', 'bkkkkkkb', '.bbbbbb.'], pal: { b: '#1c1c22', B: '#5a3618', k: '#2b2b33' } },
    { id: 'pump', slot: 'x', name: 'Bilge Pump', price: 150, st: { hull: 3 }, desc: 'Pumps out water before it sinks you.',
      map: ['..GGG...', '..G.....', '.GGGG...', '.GggG..p', '.GggGppp', '.GggG...', '.GGGG...', 'GGGGGG..'], pal: { G: '#5f6974', g: '#a9b3bd', p: '#4cc9f0' } },
    { id: 'anchor', slot: 'x', name: 'Anchor', price: 60, st: { bal: 2 }, desc: 'Steadies the ship in rough water.',
      map: ['...gg...', '..g..g..', '...gg...', 'gggggggg', '...gg...', 'g..gg..g', 'gg.gg.gg', '.gggggg.'], pal: { g: '#8a96a3' } },
    { id: 'lantern', slot: 'x', name: 'Lantern', price: 50, st: { nav: 2 }, desc: 'See through the dark and fog.',
      map: ['...kk...', '..k..k..', '.kkkkkk.', '.kyyyyk.', '.kyYYyk.', '.kyyyyk.', '.kkkkkk.', '........'], pal: { k: '#3b3f4a', y: '#ffd166', Y: '#fff3c4' } },
    { id: 'compass', slot: 'x', name: 'Compass', price: 90, st: { nav: 3 }, desc: 'Always know which way is home.',
      map: ['..GGGG..', '.GwwwwG.', 'GwwrwwwG', 'GwwrwwwG', 'GwwbwwwG', 'GwwbwwwG', '.GwwwwG.', '..GGGG..'], pal: { G: '#c99a12', w: '#eef3f8', r: '#e2453c', b: '#3b3f4a' } },
    { id: 'spyglass', slot: 'x', name: 'Spyglass', price: 120, st: { nav: 3 }, desc: 'Spot rocks long before you hit them.',
      map: ['......GG', '.....GbG', '....GbG.', '...BbG..', '..BbB...', '.BbB....', 'BbB.....', 'BB......'], pal: { G: '#c99a12', b: '#d08a3c', B: '#8a5520' } },
    { id: 'water', slot: 'x', name: 'Water Barrels', price: 35, st: { sup: 2 }, desc: 'Fresh water for the trip.',
      map: ['.bb..bb.', 'bBBbbBBb', 'bWWbbWWb', 'bBBbbBBb', 'bWWbbWWb', 'bBBbbBBb', 'bBBbbBBb', '.bb..bb.'], pal: { b: '#5a3618', B: '#a8693a', W: '#4cc9f0' } },
    { id: 'food', slot: 'x', name: 'Food Crates', price: 45, st: { sup: 2 }, desc: 'Bread, olives and dried fish.',
      map: ['CCCCCCCC', 'CcCccCcC', 'CCcccCCC', 'CccCCccC', 'CccCCccC', 'CCcccCCC', 'CcCccCcC', 'CCCCCCCC'], pal: { C: '#7a4a24', c: '#c79a5c' } },
    { id: 'net', slot: 'x', name: 'Fishing Net', price: 70, st: { sup: 3 }, desc: 'Catch dinner on the way.',
      map: ['n.n.n.n.', '.n.n.n.n', 'n.n.n.n.', '.n.n.n.n', 'n.n.n.n.', '.n.n.n.f', 'n.n.n.ff', '.n.n.n.f'], pal: { n: '#d8c08a', f: '#4cc9f0' } },
    { id: 'figure', slot: 'x', name: 'Golden Figurehead', price: 250, st: { hull: 1, spd: 1, bal: 1, nav: 1, sup: 1 }, desc: 'Lucky! +1 to every stat.',
      map: ['..gg....', '.gGGg...', '.gGkGg..', '..gGGGg.', '...gGGgg', '....gGGg', '.....ggg', '......gg'], pal: { g: '#c99a12', G: '#ffd166', k: '#3b3f4a' } },
  ];
  const PART = Object.fromEntries(PARTS.map((p) => [p.id, p]));
  const partFor = (slot, tier) => PARTS.find((p) => p.slot === slot && p.tier === tier);
  const STATS = [
    { k: 'hull', name: 'Hull', max: 15, color: '#d9a96a' },
    { k: 'spd', name: 'Speed', max: 9, color: '#4cc9f0' },
    { k: 'bal', name: 'Balance', max: 10, color: '#7bd389' },
    { k: 'nav', name: 'Navigation', max: 10, color: '#ffd166' },
    { k: 'sup', name: 'Supplies', max: 8, color: '#ff9e6b' },
  ];
  const STAT_NAME = Object.fromEntries(STATS.map((s) => [s.k, s.name]));
  const newShip = () => ({ h: 0, s: 0, k: 0, x: [] });
  function shipStats(sh) {
    sh = sh || newShip();
    const st = { hull: 0, spd: 0, bal: 0, nav: 0, sup: 0 };
    const add = (p) => { if (p) for (const k in p.st) st[k] += p.st[k]; };
    add(partFor('h', sh.h || 0)); if (sh.s) add(partFor('s', sh.s)); if (sh.k) add(partFor('k', sh.k));
    for (const id of sh.x || []) add(PART[id]);
    return st;
  }
  const shipScore = (st) => st.hull + st.spd + st.bal + st.nav + st.sup;
  const owns = (sh, p) => (p.slot === 'x' ? (sh.x || []).includes(p.id) : (sh[p.slot] || 0) >= p.tier);

  // ---------- the storm ----------
  const OBST = {
    choppy: { name: 'Choppy Waters', icon: '🌊', stats: ['bal'], need: { easy: 1, medium: 2, hard: 3 }, dmg: 1 },
    reef: { name: 'Reef Rocks', icon: '🪨', stats: ['nav'], need: { easy: 2, medium: 3, hard: 4 }, dmg: 2 },
    squall: { name: 'Lightning Squall', icon: '⚡', stats: ['spd'], need: { easy: 2, medium: 4, hard: 5 }, dmg: 2 },
    whirl: { name: 'Whirlpool', icon: '🌀', stats: ['spd', 'bal'], need: { easy: 5, medium: 9, hard: 12 }, dmg: 2 },
    fog: { name: 'Fog Bank', icon: '🌫️', stats: ['nav'], need: { easy: 4, medium: 6, hard: 8 }, dmg: 2 },
    wave: { name: 'Huge Wave', icon: '🌊', stats: ['hull', 'bal'], need: { easy: 7, medium: 12, hard: 16 }, dmg: 5 },
    kraken: { name: 'The Kraken', icon: '🐙', stats: ['hull', 'nav'], need: { easy: 99, medium: 99, hard: 14 }, dmg: 4 },
    haul: { name: 'Long Haul Home', icon: '🍞', stats: ['sup'], need: { easy: 2, medium: 4, hard: 5 }, dmg: 2 },
  };
  const ROUTES = {
    easy: ['choppy', 'reef', 'squall', 'whirl', 'fog', 'wave', 'haul'],
    medium: ['choppy', 'reef', 'squall', 'whirl', 'fog', 'wave', 'haul'],
    hard: ['choppy', 'reef', 'squall', 'whirl', 'fog', 'wave', 'kraken', 'haul'],
  };
  const hp0Of = (st) => 3 + st.hull;
  // Deterministic: the same ship always gets the same result, so the forecast in the shop is honest.
  function simulate(sh, route, diff) {
    const st = shipStats(sh), hp0 = hp0Of(st), steps = [];
    let hp = hp0, sunk = -1;
    route.forEach((k, i) => {
      if (sunk >= 0) return;
      const o = OBST[k], v = o.stats.reduce((a, s) => a + st[s], 0), need = o.need[diff];
      const p = v >= need;
      if (!p) hp = Math.max(0, hp - o.dmg);
      steps.push({ v, need, p: p ? 1 : 0, hp });
      if (hp <= 0) sunk = i;
    });
    return { hp0, steps, sunk, hp, score: shipScore(st) };
  }
  const reached = (r, n) => (r.sunk < 0 ? n + 1 : r.sunk);
  // The film's timeline. Host and players build the same durations (dangers after every ship has sunk
  // are skipped); players see their own captain first.
  function voyagePlan(V, meId) {
    const n = V.route.length, ids = Object.keys(V.res);
    let last = -1;
    for (const id of ids) { const r = V.res[id]; last = Math.max(last, r.sunk < 0 ? n - 1 : r.sunk); }
    const crew = ids.slice().sort((a, b) => (a === meId ? -1 : b === meId ? 1 : 0)).slice(0, VP.crewMax);
    const segs = []; let t = 0;
    const add = (o, dur) => { segs.push({ ...o, t0: t, dur }); t += dur; };
    add({ kind: 'intro' }, VP.intro);
    for (const id of crew) add({ kind: 'crew', id }, VP.crew);
    add({ kind: 'sail' }, VP.sail);
    for (let i = 0; i <= last; i++) add({ kind: 'obs', i, ob: V.route[i] }, VP.obs);
    add({ kind: 'end' }, VP.end);
    return { segs, total: t };
  }

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
  const money = (n) => '$' + Math.round(n).toLocaleString();
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

  // ---------- world generation (fixed island, built once) ----------
  let world = null;
  function buildWorld() {
    if (world) return world;
    const octs = [192, 96, 48, 24].map((p, i) => {
      const nx = Math.ceil(WW / p) + 2, ny = Math.ceil(WH / p) + 2, v = new Float32Array(nx * ny);
      for (let j = 0; j < v.length; j++) v[j] = hash32(ISLAND_SEED, i, j);
      return { p, nx, v, a: 0.5 ** (i + 1) };
    });
    const fbm = (x, y) => {
      let s = 0, n = 0;
      for (const o of octs) {
        const fx = x / o.p, fy = y / o.p, xi = fx | 0, yi = fy | 0, u = fx - xi, w = fy - yi;
        const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w), k = yi * o.nx + xi;
        s += o.a * lerp(lerp(o.v[k], o.v[k + 1], su), lerp(o.v[k + o.nx], o.v[k + o.nx + 1], su), sw); n += o.a;
      }
      return s / n;
    };
    const Hh = new Float32Array(GW * GH), Zn = new Uint8Array(GW * GH), walk = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const x = gx * G + 1, y = gy * G + 1;
      const d = Math.hypot((x - CX) / RX, (y - CY) / RY);
      let h = 0.7 - d * 0.8 + (fbm(x, y) - 0.5) * 0.55 - Math.max(0, d - 0.95) * 2;
      // a straight harbor beach cut into the south coast
      const hx = clamp(1 - Math.max(HARBOR.x0 - x, x - HARBOR.x1, 0) / 90, 0, 1);
      if (hx > 0 && y > SHORE_Y - 200) {
        const target = y >= SHORE_Y ? -0.05 - (y - SHORE_Y) / 500 : y >= SHORE_Y - 34 ? 0.03 : Math.max(h, 0.12);
        h = lerp(h, target, hx * clamp((y - (SHORE_Y - 200)) / 40, 0, 1));
      }
      // keep the village flat and open
      const pd = ((x - PLAZA.x) / (PLAZA.rx + 60)) ** 2 + ((y - PLAZA.y) / (PLAZA.ry + 50)) ** 2;
      if (pd < 1) h = lerp(clamp(h, 0.1, 0.22), h, pd * pd);
      const i = gy * GW + gx;
      Hh[i] = h;
      let z = h < -0.16 ? Z.DEEP : h < -0.07 ? Z.WATER : h < 0 ? Z.SHALLOW : h < 0.06 ? Z.SAND : h < 0.3 ? Z.GRASS : h < 0.47 ? Z.FOREST : Z.HILL;
      if (z >= Z.SAND && ((x - PLAZA.x) / PLAZA.rx) ** 2 + ((y - PLAZA.y) / PLAZA.ry) ** 2 < 1) z = Z.PLAZA;
      if (z >= Z.SAND && Math.abs(x - PLAZA.x) < 14 && y > PLAZA.y && y < SHORE_Y - 6) z = Z.PLAZA; // path to the beach
      Zn[i] = z; walk[i] = z >= Z.SAND ? 1 : 0;
    }
    const zoneAt = (x, y) => (x < 0 || y < 0 || x >= WW || y >= WH ? Z.DEEP : Zn[(y >> 1) * GW + (x >> 1)]);

    // trees, palms and rocks (deterministic)
    const objs = [];
    const harborBand = (x, y) => y > SHORE_Y - 70 && x > HARBOR.x0 - 30 && x < HARBOR.x1 + 30;
    const deco = [];
    for (let ty = 0; ty < WH / 8; ty++) for (let tx = 0; tx < WW / 8; tx++) {
      const x = Math.round(tx * 8 + 4 + (hash32(ISLAND_SEED, tx, ty, 1) - 0.5) * 6), y = Math.round(ty * 8 + 4 + (hash32(ISLAND_SEED, tx, ty, 2) - 0.5) * 6);
      const z = zoneAt(x, y), r = hash32(ISLAND_SEED, tx, ty, 3), v = hash32(ISLAND_SEED, tx, ty, 4);
      if (z < Z.SAND || z === Z.PLAZA || harborBand(x, y)) continue;
      if (((x - PLAZA.x) / (PLAZA.rx + 30)) ** 2 + ((y - PLAZA.y) / (PLAZA.ry + 26)) ** 2 < 1) continue;
      let k = null;
      if (z === Z.SAND) { if (r < 0.05 && Hh[(y >> 1) * GW + (x >> 1)] < 0.035) k = 'palm'; else if (r < 0.08) deco.push({ k: 'shell', x, y, v }); }
      else if (z === Z.GRASS) { if (r < 0.03) k = 'tree'; else if (r < 0.065) k = 'bush'; else if (r < 0.075) k = 'palm'; else if (r < 0.12) deco.push({ k: 'flower', x, y, v }); }
      else if (z === Z.FOREST) { if (r < 0.34) k = 'tree'; else if (r < 0.42) k = 'bush'; }
      else if (z === Z.HILL) { if (r < 0.08) k = 'rock'; else if (r < 0.16) k = 'pine'; else if (r < 0.22) deco.push({ k: 'pebble', x, y, v }); }
      if (k) objs.push({ k, x, y, v });
    }
    const BLOCK = { tree: 3, palm: 2, pine: 3, rock: 5 };
    const blockCircle = (cx, cy, r) => {
      for (let gy = Math.floor((cy - r) / G); gy <= Math.floor((cy + r) / G); gy++) for (let gx = Math.floor((cx - r) / G); gx <= Math.floor((cx + r) / G); gx++) {
        if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
        if (Math.hypot(gx * G + 1 - cx, gy * G + 1 - cy) <= r) walk[gy * GW + gx] = 0;
      }
    };
    for (const o of objs) if (BLOCK[o.k]) blockCircle(o.x, o.y - 1, BLOCK[o.k]);
    // stalls are solid too
    for (const s of [TRADER, MARKET]) for (let y = s.y - 16; y <= s.y; y += G) for (let x = s.x - 24; x <= s.x + 24; x += G) walk[(y >> 1) * GW + (x >> 1)] = 0;
    objs.sort((a, b) => a.y - b.y);
    const rows = []; for (const o of objs) (rows[o.y >> 4] = rows[o.y >> 4] || []).push(o);

    // bake the ground into one big image
    const terrain = document.createElement('canvas'); terrain.width = WW; terrain.height = WH;
    const tc = terrain.getContext('2d'), img = tc.createImageData(WW, WH), px = img.data;
    const shore = [];
    const isLand = (gx, gy) => gx >= 0 && gy >= 0 && gx < GW && gy < GH && Zn[gy * GW + gx] >= Z.SAND;
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx, z = Zn[i], h = Hh[i], v = hash32(7, gx, gy), patch = hash32(9, gx >> 2, gy >> 2) > 0.5;
      let c;
      if (z <= Z.SHALLOW) {
        const edge = isLand(gx - 1, gy) || isLand(gx + 1, gy) || isLand(gx, gy - 1) || isLand(gx, gy + 1);
        if (edge) { c = [222, 244, 250]; shore.push({ x: gx * G, y: gy * G, i: (gx * 7 + gy * 13) % 9 }); }
        else if (z === Z.SHALLOW) c = h > -0.03 ? (v < 0.5 ? [96, 196, 214] : [90, 190, 210]) : (v < 0.5 ? [72, 176, 204] : [66, 168, 198]);
        else if (z === Z.WATER) c = v < 0.5 ? [40, 128, 184] : [37, 121, 176];
        else c = patch ? [30, 92, 150] : [28, 86, 142];
      } else if (z === Z.SAND) c = h < 0.012 ? [208, 188, 132] : v < 0.1 ? [214, 188, 124] : [232, 210, 150];
      else if (z === Z.GRASS) c = v < 0.04 ? [122, 190, 92] : patch ? [96, 170, 76] : [86, 158, 70];
      else if (z === Z.FOREST) c = v < 0.05 ? [74, 138, 66] : patch ? [60, 124, 58] : [54, 114, 52];
      else if (z === Z.HILL) c = patch ? (v < 0.3 ? [140, 142, 124] : [128, 134, 112]) : (v < 0.1 ? [124, 152, 96] : [112, 140, 88]);
      else c = v < 0.06 ? [172, 140, 96] : patch ? [200, 166, 112] : [190, 156, 104];
      for (let dy = 0; dy < G; dy++) for (let dx = 0; dx < G; dx++) {
        const o = ((gy * G + dy) * WW + gx * G + dx) * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
    tc.putImageData(img, 0, 0);
    for (const d of deco) {
      if (d.k === 'flower') { tc.fillStyle = ['#ff7eb6', '#ffd166', '#ffffff', '#a77bff'][Math.floor(d.v * 4)]; tc.fillRect(d.x, d.y, 2, 2); tc.fillStyle = '#3f8a3a'; tc.fillRect(d.x, d.y + 2, 1, 2); }
      else if (d.k === 'shell') { tc.fillStyle = d.v < 0.5 ? '#f6e7d6' : '#ffb3a7'; tc.fillRect(d.x, d.y, 3, 2); tc.fillStyle = '#c9a98a'; tc.fillRect(d.x + 1, d.y + 1, 1, 1); }
      else { tc.fillStyle = '#9aa1a8'; tc.fillRect(d.x, d.y, 3, 2); tc.fillStyle = '#6f7680'; tc.fillRect(d.x, d.y + 1, 3, 1); }
    }
    // plaza paving stones
    for (let y = PLAZA.y - PLAZA.ry; y < PLAZA.y + PLAZA.ry; y += 6) for (let x = PLAZA.x - PLAZA.rx; x < PLAZA.x + PLAZA.rx; x += 8) {
      const ox = x + ((y / 6) % 2) * 4;
      if (zoneAt(ox, y) === Z.PLAZA && hash32(5, ox, y) < 0.5) { tc.fillStyle = 'rgba(120, 90, 60, .25)'; tc.fillRect(ox, y, 6, 1); }
    }
    const shoreRows = []; for (const s of shore) (shoreRows[s.y >> 4] = shoreRows[s.y >> 4] || []).push(s);
    world = { Hh, Zn, walk, zoneAt, objs, rows, terrain, shoreRows, mini: null, miniKey: '' };
    return world;
  }
  const zoneAt = (x, y) => buildWorld().zoneAt(Math.floor(x), Math.floor(y));

  // ---------- sprites ----------
  function makeSprite(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); fn(x); return c; }
  const R = (c, col, x, y, w, h) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  function ellC(c, cx, cy, rx, ry, col) {
    c.fillStyle = col; const r = Math.max(1, Math.round(ry));
    for (let y = -r; y <= r; y++) { const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (r * r)))); if (hw > 0) c.fillRect(Math.round(cx) - hw, Math.round(cy) + y, hw * 2, 1); }
  }
  function polyC(c, pts, col) {
    c.fillStyle = col;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.round(minY); y < Math.round(maxY); y++) {
      const yc = y + 0.5; let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((yc >= y1 && yc < y2) || (yc >= y2 && yc < y1)) { const x = x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1); lo = Math.min(lo, x); hi = Math.max(hi, x); }
      }
      if (hi > lo) c.fillRect(Math.round(lo), y, Math.round(hi) - Math.round(lo), 1);
    }
  }
  let SPR = null;
  function buildSprites() {
    if (SPR) return SPR;
    const shadow = (c, cx, cy, rx) => ellC(c, cx, cy, rx, 2, 'rgba(0,0,0,.28)');
    const tree = (dark, mid, hi) => makeSprite(18, 22, (c) => {
      shadow(c, 9, 20, 6); R(c, '#4a2c14', 8, 13, 3, 7); R(c, '#6b3e1c', 8, 13, 1, 7);
      ellC(c, 9, 9, 8, 7, '#16301a'); ellC(c, 9, 9, 7, 6, dark); ellC(c, 8, 7, 6, 4, mid); ellC(c, 7, 5, 3, 2, hi);
    });
    const pine = makeSprite(14, 24, (c) => {
      shadow(c, 7, 22, 5); R(c, '#4a2c14', 6, 17, 2, 5);
      polyC(c, [[7, 0], [13, 10], [1, 10]], '#1f4a2c'); polyC(c, [[7, 4], [14, 16], [0, 16]], '#2a5f38'); polyC(c, [[7, 9], [14, 19], [0, 19]], '#2f6b3f');
      R(c, '#4f8f5a', 6, 5, 1, 3); R(c, '#4f8f5a', 5, 11, 1, 3);
    });
    const palm = makeSprite(22, 26, (c) => {
      shadow(c, 11, 24, 5);
      for (let i = 0; i < 16; i++) { const x = 10 + Math.round(Math.sin(i / 6) * 2), y = 23 - i; R(c, i % 3 ? '#9a6a3a' : '#7a4a24', x, y, 2, 1); }
      const top = [12, 7];
      for (const [dx, dy] of [[-9, 3], [-7, -3], [0, -6], [7, -3], [9, 3], [3, 5], [-4, 5]]) {
        const n = 8;
        for (let i = 1; i <= n; i++) { const x = top[0] + (dx * i) / n, y = top[1] + (dy * i) / n + (i * i) / 18; R(c, i > n - 2 ? '#2f7a2f' : '#3f9a3a', x, y, 2, 1); }
      }
      R(c, '#6b3e1c', 11, 8, 2, 2); R(c, '#6b3e1c', 13, 9, 2, 2);
    });
    const bush = makeSprite(12, 9, (c) => { shadow(c, 6, 7, 5); ellC(c, 6, 4, 5, 3, '#2f6b2f'); ellC(c, 5, 3, 4, 2, '#4f9a42'); R(c, '#e2453c', 3, 3, 1, 1); R(c, '#e2453c', 8, 4, 1, 1); });
    const rock = makeSprite(14, 11, (c) => { shadow(c, 7, 9, 6); ellC(c, 7, 6, 6, 4, '#4f5660'); ellC(c, 7, 5, 6, 3, '#7d8590'); ellC(c, 5, 4, 3, 1, '#a9b0ba'); });
    SPR = {
      tree: [tree('#2f6b2f', '#3f8a3a', '#5aa64a'), tree('#2a5f2a', '#367c34', '#4f9a42'), tree('#3a6b2a', '#4f8f36', '#6fb04f')],
      pine, palm, bush, rock,
    };
    return SPR;
  }
  // Item and part icons as little images for the HTML panels.
  const iconCache = new Map();
  function iconURL(key, map, pal) {
    if (iconCache.has(key)) return iconCache.get(key);
    const c = makeSprite(10, 10, (x) => {
      x.fillStyle = '#0b1320';
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        if (map[j][i] === '.') continue;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const a = map[j + dy] && map[j + dy][i + dx]; if (!a || a === '.') x.fillRect(i + 1 + dx, j + 1 + dy, 1, 1); }
      }
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const ch = map[j][i]; if (ch !== '.') { x.fillStyle = pal[ch]; x.fillRect(i + 1, j + 1, 1, 1); } }
    });
    const u = c.toDataURL(); iconCache.set(key, u); return u;
  }
  const itemIcon = (i) => iconURL('i' + i, ITEMS[i].map, ITEMS[i].pal);
  const partIcon = (p) => iconURL('p' + p.id, p.map, p.pal);

  // ---------- module state ----------
  let ctx = null, active = false;
  let cv, g, tcv, tg, W = 480, H = 270, SCALE = 2, dpr = 1, last = 0;
  let camx = 0, camy = 0, cx0 = 0, cy0 = 0;
  let clockOffset = null, fx = null, S = null;
  const me = { x: 0, y: 0, vx: 0, vy: 0, f: 1, dx: 0, dy: 0, norm: 1, moving: false, placed: false, sent: 0, sentV: null, sentX: null, sentY: null, chan: null };
  const others = new Map();
  const keys = { left: false, right: false, up: false, down: false };
  const parts = [], floaters = [];
  let lastEvN = -1, prompt = null, bannerTimer = 0, lastPhase = null;
  const eatenCoins = new Map(), pendingDig = new Map();
  let quizOpen = false, shopOpen = false, shopSig = '', packSig = '';
  const quiz = { q: null, serial: -1, locked: false, next: null, unlockTimer: 0, wait: false, readyAt: 0, contTimer: 0 };
  let energyAt = { v: 0, t: 0 };
  let shipCv = null, flashAt = 0;
  const now = () => Date.now() + (clockOffset || 0);

  // ---------- pixel primitives on the main canvas ----------
  const rect = (c, x, y, w, h) => R(g, c, x, y, w, h);
  const ellipse = (cx, cy, rx, ry, c) => ellC(g, cx, cy, rx, ry, c);
  function sprite(item, x, y) {
    const it = ITEMS[item], m = it.map;
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = '#0b1320';
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      if (m[j][i] === '.') continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const a = m[j + dy] && m[j + dy][i + dx]; if (!a || a === '.') g.fillRect(x + i + dx, y + j + dy, 1, 1); }
    }
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const ch = m[j][i]; if (ch !== '.') { g.fillStyle = it.pal[ch]; g.fillRect(x + i, y + j, 1, 1); } }
  }
  // Crisp overlay text in SCREEN coordinates.
  function text(str, x, y, color = '#fff', size = 7, align = 'center', alpha = 1) {
    if (alpha <= 0) return;
    const k = SCALE * dpr, px = Math.round(size * k * 0.9);
    tg.globalAlpha = Math.min(1, alpha);
    tg.font = `700 ${px}px 'Pixelify Sans', sans-serif`;
    tg.textAlign = align; tg.textBaseline = 'middle';
    const X = Math.round(x) * k, Y = Math.round(y) * k;
    tg.lineJoin = 'round'; tg.lineWidth = Math.max(3, px * 0.24); tg.strokeStyle = '#070b12'; tg.strokeText(str, X, Y);
    tg.fillStyle = color; tg.fillText(str, X, Y);
    tg.globalAlpha = 1;
  }
  const SXw = (x) => Math.round(x) - cx0, SYw = (y) => Math.round(y) - cy0;

  // ---------- state lookups ----------
  function player(id) { return S ? S.players.find((p) => p.id === id) : null; }
  function colorOf(id) { const p = player(id); return p ? Scene.COLORS[p.look.c] || '#fff' : '#888'; }
  const nSections = () => Math.max(1, fx ? Object.keys(fx.sec).length : 1);
  function pierX(i) {
    const n = nSections(), span = HARBOR.x1 - HARBOR.x0, sp = Math.min(84, span / n);
    return Math.round((HARBOR.x0 + HARBOR.x1) / 2 - (sp * n) / 2 + sp * (i + 0.5));
  }
  const spawnPos = (id) => { const s = fx && fx.sec[id]; return s == null ? { x: PLAZA.x, y: SHORE_Y - 20 } : { x: pierX(s), y: SHORE_Y - 16 }; };
  const shipPos = (id) => { const s = fx && fx.sec[id]; return s == null ? null : { x: pierX(s) + PIER_W / 2 + 9, y: SHORE_Y + 42 }; };
  const shipOf = (id) => (fx && fx.ships && fx.ships[id]) || newShip();
  function inPier(x, y) {
    if (!fx || y < SHORE_Y - 8 || y > SHORE_Y + PIER_LEN) return false;
    for (let i = 0, n = nSections(); i < n; i++) if (Math.abs(x - pierX(i)) <= PIER_W / 2 - 1) return true;
    return false;
  }
  function walkAt(x, y) {
    if (inPier(x, y)) return true;
    if (x < 0 || y < 0 || x >= WW || y >= WH) return false;
    return world.walk[(Math.floor(y) >> 1) * GW + (Math.floor(x) >> 1)] === 1;
  }
  const canStand = (x, y) => walkAt(x, y) && walkAt(x - 3, y) && walkAt(x + 3, y) && walkAt(x, y - 2);
  function posOf(id) {
    if (ctx && id === ctx.me.id && me.placed) return { x: me.x, y: me.y };
    const o = others.get(id); return o ? { x: o.x, y: o.y } : null;
  }
  const packOf = (id) => (fx && fx.pack && fx.pack[id]) || [];
  const mySection = () => (fx && ctx ? fx.sec[ctx.me.id] : undefined);
  const amPlaying = () => !!(S && ctx && S.players.some((p) => p.id === ctx.me.id) && mySection() != null);
  function gameLive() { return !!(fx && S && S.phase === 'play' && fx.startAt && now() >= fx.startAt); }
  function frozen(id) { return gameLive() && fx.energy && (fx.energy[id] || 0) <= 0; }
  const gain = () => (fx && fx.gain) || GAIN_DEFAULT;

  // ---------- drawing: the island ----------
  function visibleArea() {
    const page = $('#gamePage'), side = $('#sidePanel');
    const right = window.innerWidth >= 900 && !page.classList.contains('panel-closed') ? (side.offsetWidth + 24) / SCALE : 0;
    return { right, cx: (W - right) / 2, cy: H / 2 + 8 };
  }
  function drawWater(t) {
    const c0 = Math.floor(cx0 / 14), c1 = Math.ceil((cx0 + W) / 14), r0 = Math.floor(cy0 / 14), r1 = Math.ceil((cy0 + H) / 14);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = c * 14 + 7, y = r * 14 + 7, z = zoneAt(x, y);
      if (z > Z.SHALLOW) continue;
      const ph = hash32(11, c, r), s = Math.sin(t / 700 + ph * 40);
      if (s > 0.82) rect(z === Z.SHALLOW ? '#c4f1f7' : '#7cc3e6', x - cx0 + Math.floor(ph * 6) - 3, y - cy0, s > 0.96 ? 3 : 2, 1);
    }
    const step = Math.floor(t / 240);
    for (let r = (cy0 >> 4) - 1; r <= ((cy0 + H) >> 4) + 1; r++) {
      const row = world.shoreRows[r]; if (!row) continue;
      for (const p of row) if (p.x >= cx0 - 2 && p.x <= cx0 + W && (p.i + step) % 9 === 0) rect('#ffffff', p.x - cx0, p.y - cy0, 2, 2);
    }
  }
  function drawPier(i, t) {
    const x = pierX(i), y0 = SHORE_Y - 8, y1 = SHORE_Y + PIER_LEN;
    const sx = SXw(x), sy0 = SYw(y0), sy1 = SYw(y1);
    if (sx < -60 || sx > W + 60 || sy1 < -10 || sy0 > H + 60) return;
    for (let y = y0 + 10; y <= y1; y += 16) { rect('#3d2410', sx - PIER_W / 2 - 1, SYw(y), 2, 5); rect('#3d2410', sx + PIER_W / 2 - 1, SYw(y), 2, 5); }
    rect('#5a3618', sx - PIER_W / 2, sy0, PIER_W, sy1 - sy0 + 2);
    for (let y = y0; y < y1; y += 3) rect((y / 3) % 2 ? '#b07a45' : '#a06a38', sx - PIER_W / 2 + 1, SYw(y), PIER_W - 2, 2);
    rect('#d9a96a', sx - PIER_W / 2 + 1, sy0, 1, sy1 - sy0);
  }
  function drawShipTop(id, t) {
    const sp = shipPos(id); if (!sp) return;
    const sx = SXw(sp.x), sy = SYw(sp.y) + (Math.floor(t / 600 + sp.x) % 2);
    if (sx < -40 || sx > W + 40 || sy < -50 || sy > H + 50) return;
    const sh = shipOf(id), col = colorOf(id), tier = sh.h || 0;
    const [w, len] = [[16, 22], [12, 28], [14, 34], [15, 40]][tier];
    // wake ripples
    const wr = 2 + ((t / 300) % 4);
    g.globalAlpha = 0.35; ellipse(sx, sy, w / 2 + wr, len / 2 + wr, '#d6f2fb'); ellipse(sx, sy, w / 2 + wr - 1, len / 2 + wr - 1, '#3fa6c8'); g.globalAlpha = 1;
    ellipse(sx + 2, sy + 3, w / 2 + 1, len / 2, 'rgba(0, 30, 60, .3)');
    if (tier === 0) {
      rect('#2f1a0b', sx - w / 2 - 1, sy - len / 2 - 1, w + 2, len + 2);
      for (let i = 0; i < 4; i++) rect(i % 2 ? '#7a4a24' : '#a8693a', sx - w / 2 + i * 4, sy - len / 2, 4, len);
      rect('#d8c08a', sx - w / 2, sy - len / 2 + 3, w, 1); rect('#d8c08a', sx - w / 2, sy + len / 2 - 4, w, 1);
    } else {
      const hull = ['', '#b07a45', '#7a4a24', '#6b3d1e'][tier], edge = tier === 3 ? '#d9823b' : '#2f1a0b';
      const top = sy - len / 2, bot = sy + len / 2;
      const P = (d) => [[sx - w / 2 - d, top - d], [sx + w / 2 + d, top - d], [sx + w / 2 + d, bot - 9], [sx, bot + d], [sx - w / 2 - d, bot - 9]];
      polyC(g, P(1), edge); polyC(g, P(0), hull);
      polyC(g, [[sx - w / 2 + 2, top + 2], [sx + w / 2 - 2, top + 2], [sx + w / 2 - 2, bot - 10], [sx, bot - 3], [sx - w / 2 + 2, bot - 10]], '#c79a5c');
      for (let y = top + 4; y < bot - 6; y += 3) rect('rgba(90, 54, 24, .35)', sx - w / 2 + 2, y, w - 4, 1);
    }
    const x = sh.x || [];
    if (x.includes('oars')) for (const s of [-1, 1]) { rect('#d9a96a', sx + s * (w / 2 + 1) + (s < 0 ? -5 : 0), sy - 2, 5, 1); rect('#d9a96a', sx + s * (w / 2 + 1) + (s < 0 ? -5 : 0), sy + 4, 5, 1); }
    if (x.includes('water')) { ellipse(sx - 3, sy - len / 2 + 5, 2, 2, '#5a3618'); ellipse(sx + 3, sy - len / 2 + 5, 2, 2, '#5a3618'); rect('#4cc9f0', sx - 3, sy - len / 2 + 4, 1, 1); }
    if (x.includes('food')) rect('#a0703f', sx - 2, sy + len / 2 - 12, 4, 4);
    if (x.includes('tar')) ellipse(sx + 4, sy + 2, 2, 2, '#1c1c22');
    if (x.includes('rope')) { ellipse(sx - 4, sy + 3, 2, 2, '#d8c08a'); rect('#9a7a4a', sx - 4, sy + 3, 1, 1); }
    if (x.includes('net')) for (let i = 0; i < 4; i++) rect('#d8c08a', sx - w / 2 + 2 + i * 2, sy + 6 + (i % 2), 1, 1);
    if (x.includes('anchor')) rect('#8a96a3', sx + w / 2 - 1, sy + len / 2 - 10, 2, 3);
    if (x.includes('figure')) { rect('#ffd166', sx - 1, sy + len / 2 - 1, 2, 3); rect('#c99a12', sx, sy + len / 2 + 1, 1, 1); }
    if (x.includes('pump')) rect('#a9b3bd', sx + 3, sy - 6, 2, 2);
    // sails seen from above: a mast and the yard with its sail
    const sail = (yy, ww, c) => { rect('rgba(0,0,0,.25)', sx - ww / 2 + 2, yy + 2, ww, 3); rect(c, sx - ww / 2, yy, ww, 3); rect('#ffffff', sx - ww / 2, yy, ww, 1); };
    if (sh.s === 1) { sail(sy - 4, w + 4, '#e9dcb8'); rect('#c9a46a', sx - 2, sy - 3, 2, 1); }
    if (sh.s === 2) sail(sy - 5, w + 8, '#f4f1e8');
    if (sh.s === 3) { sail(sy - 9, w + 8, '#ffffff'); sail(sy + 4, w + 6, '#ffffff'); rect(col, sx - 2, sy - 8, 4, 1); }
    if (sh.s) rect('#3d2410', sx - 1, sy - 3, 2, 2);
    if (x.includes('lantern')) { if (Math.floor(t / 400) % 2) { g.globalAlpha = 0.35; ellipse(sx, sy - len / 2 + 1, 5, 4, '#ffd166'); g.globalAlpha = 1; } rect('#ffd166', sx - 1, sy - len / 2, 2, 2); }
    // flag in the owner's color
    rect('#3d2410', sx - w / 2 + 1, sy - len / 2 + 1, 1, 4); rect(col, sx - w / 2 + 2, sy - len / 2 + 1 + (Math.floor(t / 250) % 2), 4, 2);
  }
  function drawStall(s, kind, t) {
    const sx = SXw(s.x), sy = SYw(s.y);
    if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) return;
    const trader = kind === 'trader';
    ellipse(sx, sy + 1, 28, 4, 'rgba(0,0,0,.25)');
    // keeper behind the counter
    Scene.drawCharacter(g, sx, sy - 12, trader ? { c: 3, h: 'cap', e: 'dot' } : { c: 8, h: 'helmet', e: 'wide' }, { bob: Math.floor(t / 500) % 2 });
    // counter
    rect('#2f1a0b', sx - 25, sy - 15, 50, 16);
    rect('#a8693a', sx - 24, sy - 14, 48, 4); rect('#d9a96a', sx - 24, sy - 14, 48, 1);
    rect('#7a4a24', sx - 24, sy - 10, 48, 10);
    for (let x = sx - 22; x < sx + 22; x += 8) rect('#5a3618', x, sy - 10, 1, 10);
    // goods on the counter
    if (trader) { sprite(0, sx - 18, sy - 22); sprite(5, sx - 6, sy - 22); sprite(9, sx + 7, sy - 22); }
    else { rect('#b07a45', sx - 20, sy - 18, 12, 3); rect('#d9a96a', sx - 20, sy - 18, 12, 1); ellipse(sx, sy - 17, 4, 2, '#d8c08a'); rect('#8a96a3', sx + 10, sy - 21, 2, 6); rect('#8a96a3', sx + 7, sy - 17, 8, 2); }
    // poles and striped awning
    rect('#3d2410', sx - 25, sy - 40, 2, 26); rect('#3d2410', sx + 23, sy - 40, 2, 26);
    const [a, b] = trader ? ['#ffd166', '#e9873b'] : ['#e8f4ff', '#3a8fd0'];
    rect('#2f1a0b', sx - 29, sy - 47, 58, 11);
    for (let i = 0; i < 7; i++) rect(i % 2 ? b : a, sx - 28 + i * 8, sy - 46, 8, 8);
    for (let i = 0; i < 7; i++) rect(i % 2 ? b : a, sx - 28 + i * 8 + 1, sy - 38, 6, 2);
    // sign
    rect('#2f1a0b', sx - 7, sy - 58, 14, 11); rect(trader ? '#ffd166' : '#4cc9f0', sx - 6, sy - 57, 12, 9);
    if (trader) { rect('#3a2600', sx - 1, sy - 56, 2, 7); rect('#3a2600', sx - 3, sy - 55, 6, 1); rect('#3a2600', sx - 3, sy - 53, 6, 1); rect('#3a2600', sx - 3, sy - 51, 6, 1); }
    else { rect('#0b2a3a', sx - 1, sy - 56, 2, 7); rect('#0b2a3a', sx - 3, sy - 55, 6, 1); rect('#0b2a3a', sx - 4, sy - 51, 2, 2); rect('#0b2a3a', sx + 2, sy - 51, 2, 2); rect('#0b2a3a', sx - 3, sy - 50, 6, 1); }
  }
  function drawCoins(t) {
    if (!fx || !fx.coins) return;
    const fr = Math.floor(t / 140);
    for (const c of fx.coins) {
      const e = eatenCoins.get(c.id); if (e && performance.now() - e < 2500) continue;
      const sx = SXw(c.x), sy = SYw(c.y);
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
      const w = [3, 2, 1, 2][(fr + c.id) % 4];
      ellipse(sx, sy + 3, 3, 1, 'rgba(0,0,0,.3)');
      const by = sy - 1 - (Math.floor(t / 400 + c.id) % 2);
      rect('#6b4a00', sx - w - 1, by - 3, w * 2 + 2, 7); rect('#ffd166', sx - w, by - 3, w * 2, 6); if (w > 1) rect('#fff3c4', sx - w, by - 3, 1, 3); rect('#c99a12', sx - w, by + 2, w * 2, 1);
      if ((fr + c.id * 3) % 23 === 0) { rect('#ffffff', sx + 2, by - 5, 1, 3); rect('#ffffff', sx + 1, by - 4, 3, 1); }
    }
  }
  // Buried antiques are invisible: a glint flashes when you get close, and an X shows up right next to it.
  function drawTreasures(t) {
    if (!fx || !fx.trs || S.phase !== 'play') return;
    const spect = !amPlaying();
    for (const tr of fx.trs) {
      if (pendingDig.has(tr.id)) continue;
      const sx = SXw(tr.x), sy = SYw(tr.y);
      if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
      const d = spect ? 0 : dist(me.x, me.y, tr.x, tr.y);
      if (d < SEE_R) {
        const a = spect ? 0.5 : clamp((SEE_R - d) / 20, 0.25, 1);
        g.globalAlpha = a;
        ellipse(sx, sy + 1, 9, 4, 'rgba(70, 45, 20, .45)');
        for (let i = -5; i <= 5; i++) { rect('#f4e2b0', sx + i - 1, sy + i - 1, 4, 4); rect('#f4e2b0', sx + i - 1, sy - i - 1, 4, 4); }
        for (let i = -5; i <= 5; i++) { rect('#9a2a14', sx + i, sy + i, 2, 2); rect('#9a2a14', sx + i, sy - i, 2, 2); }
        g.globalAlpha = 1;
      }
      if (d < GLINT_R) {
        const ph = ((t / 1000 + tr.id * 0.37) % 2.4);
        if (ph < 0.3) { const s = ph < 0.15 ? 2 : 1; rect('#fff8d6', sx - s, sy - 3, s * 2 + 1, 1); rect('#fff8d6', sx, sy - 3 - s, 1, s * 2 + 1); }
      }
    }
  }
  function drawPlayer(p, pos, moving, t, isMe) {
    const sx = SXw(pos.x), sy = SYw(pos.y);
    if (sx < -30 || sx > W + 30 || sy < -40 || sy > H + 30) return;
    ellipse(sx, sy, 6, 2, 'rgba(0,0,0,.3)');
    const ice = frozen(p.id), ch = isMe ? me.chan : null, digging = !!ch && ch.type === 'dig';
    const bob = ice ? 0 : moving || digging ? Math.floor(t / 110) % 2 : Math.floor((t + p.id.length * 97) / 450) % 2;
    Scene.drawCharacter(g, sx, sy, p.look, { bob });
    if (digging) { rect('#8a96a3', sx + 6, sy - 6 - bob * 2, 2, 5); rect('#6b3e1c', sx + 6, sy - 12 - bob * 2, 1, 7); }
    if (ice) {
      g.globalAlpha = 0.45; rect('#bfe9ff', sx - 9, sy - 19, 18, 19); g.globalAlpha = 0.9;
      rect('#e6f7ff', sx - 9, sy - 19, 18, 1); rect('#e6f7ff', sx - 9, sy - 19, 1, 19); rect('#7fc8e8', sx + 8, sy - 19, 1, 19); rect('#7fc8e8', sx - 9, sy - 1, 18, 1);
      g.globalAlpha = 1;
    }
    const pack = packOf(p.id);
    let ly = sy - 26;
    if (pack.length && S.phase === 'play') {
      const w = pack.length * 10 - 2;
      pack.forEach((it, i) => sprite(it, sx - w / 2 + i * 10, sy - 32 - (Math.floor(t / 300 + i) % 2)));
      ly = sy - 38;
    }
    text(p.name, sx, ly, isMe ? '#ffd166' : '#fff', 6);
    if (ice) text('FROZEN', sx, ly - 8, '#9fe3ff', 5);
    if (ch) {
      const k = clamp((performance.now() - ch.start) / ch.dur, 0, 1), bw = 20, by = ly - 9;
      rect('#0b1320', sx - bw / 2 - 1, by - 1, bw + 2, 5);
      rect(ch.type === 'dig' ? '#c79a5c' : '#ffd166', sx - bw / 2, by, Math.round(bw * k), 3);
    }
  }
  function drawIsland(t) {
    g.drawImage(world.terrain, cx0, cy0, W, H, 0, 0, W, H);
    // fill outside the map with deep sea
    if (cx0 < 0) rect('#1c5690', 0, 0, -cx0, H); if (cy0 < 0) rect('#1c5690', 0, 0, W, -cy0);
    if (cx0 + W > WW) rect('#1c5690', WW - cx0, 0, cx0 + W - WW, H); if (cy0 + H > WH) rect('#1c5690', 0, WH - cy0, W, cy0 + H - WH);
    drawWater(t);
    const n = nSections();
    for (let i = 0; i < n; i++) drawPier(i, t);
    drawTreasures(t);
    drawCoins(t);
    const list = [];
    const r0 = (cy0 >> 4) - 1, r1 = ((cy0 + H) >> 4) + 3;
    for (let r = r0; r <= r1; r++) {
      const row = world.rows[r]; if (!row) continue;
      for (const o of row) if (o.x > cx0 - 16 && o.x < cx0 + W + 16) list.push(o);
    }
    list.push({ y: TRADER.y, f: () => drawStall(TRADER, 'trader', t) }, { y: MARKET.y, f: () => drawStall(MARKET, 'market', t) });
    if (fx) for (const id in fx.sec) { const sp = shipPos(id); list.push({ y: sp.y + 20, f: () => drawShipTop(id, t) }); }
    if (S) {
      const voy = S.phase === 'voyage' || S.phase === 'over';
      for (const p of S.players) {
        if (p.gone) continue;
        if (voy) { const sp = shipPos(p.id); if (sp) list.push({ y: sp.y + 21, f: () => drawPlayer(p, { x: sp.x, y: sp.y + 2 }, false, t, p.id === ctx.me.id) }); continue; }
        if (p.id === ctx.me.id) { if (me.placed) list.push({ y: me.y + 0.01, f: () => drawPlayer(p, me, me.moving, t, true) }); continue; }
        const o = others.get(p.id);
        const pos = o ? { x: o.x, y: o.y } : fx && fx.sec[p.id] != null ? spawnPos(p.id) : null;
        if (pos) list.push({ y: pos.y, f: () => drawPlayer(p, pos, o && o.m, t, false) });
      }
    }
    const spr = buildSprites();
    list.sort((a, b) => a.y - b.y);
    for (const o of list) {
      if (o.f) { o.f(); continue; }
      const sx = o.x - cx0, sy = o.y - cy0;
      if (o.k === 'tree') { const s = spr.tree[Math.floor(o.v * 3)]; g.drawImage(s, sx - 9, sy - 20); }
      else if (o.k === 'pine') g.drawImage(spr.pine, sx - 7, sy - 22);
      else if (o.k === 'palm') g.drawImage(spr.palm, sx - 11, sy - 24);
      else if (o.k === 'bush') g.drawImage(spr.bush, sx - 6, sy - 7);
      else if (o.k === 'rock') g.drawImage(spr.rock, sx - 7, sy - 9);
    }
    // labels
    for (const [s, a, b] of [[TRADER, 'TRADER', 'Sell antiques'], [MARKET, 'SHIPWRIGHT', 'Buy ship parts']]) {
      const sx = SXw(s.x), sy = SYw(s.y);
      if (sx > -60 && sx < W + 60 && sy > -40 && sy < H + 80) { text(a, sx, sy - 66, '#ffe08a', 6.5); text(b, sx, sy - 58 + 0, '#cfe3f2', 4.5); }
    }
    if (fx) for (const id in fx.sec) {
      const p = player(id); if (!p) continue;
      const x = SXw(pierX(fx.sec[id])), y = SYw(SHORE_Y + PIER_LEN + 6);
      if (x > -40 && x < W + 40 && y > -10 && y < H + 20) text(`${p.name}'s ship`, x + 6, y, colorOf(id), 4.5);
    }
    for (const p of parts) { g.globalAlpha = clamp(1 - p.life / p.max, 0, 1); rect(p.c, SXw(p.x), SYw(p.y) - p.h, p.s, p.s); }
    g.globalAlpha = 1;
    for (const f of floaters) {
      const p = (performance.now() - f.t0) / 1300;
      text(f.str, SXw(f.x), SYw(f.y) - f.h - p * 18, f.color, f.size, 'center', p > 0.7 ? (1 - p) / 0.3 : 1);
    }
  }

  // ---------- drawing: the voyage ----------
  function shipSide(c, sh, look, color, t) {
    c.clearRect(0, 0, 160, 130);
    const cx = 80, tier = sh.h || 0, x = sh.x || [];
    const geo = [{ len: 46, deck: 84, bot: 92 }, { len: 56, deck: 82, bot: 95 }, { len: 64, deck: 80, bot: 96 }, { len: 72, deck: 78, bot: 98 }][tier];
    const x0 = cx - geo.len / 2, x1 = cx + geo.len / 2, deck = geo.deck;
    // keel fin (mostly under water)
    if (sh.k >= 2) polyC(c, [[cx - 12, geo.bot - 1], [cx + 14, geo.bot - 1], [cx + 7, geo.bot + (sh.k === 3 ? 10 : 6)], [cx - 6, geo.bot + (sh.k === 3 ? 10 : 6)]], sh.k === 3 ? '#7d8590' : '#5a3618');
    // oars
    if (x.includes('oars')) { const a = Math.sin(t / 260) * 3; for (const ox of [cx - 8, cx + 10]) for (let i = 0; i < 14; i++) R(c, i > 10 ? '#d9a96a' : '#a8693a', ox - i * 0.5 + a * (i / 14), deck + 2 + i, 2, 1); }
    // hull
    if (tier === 0) {
      R(c, '#2f1a0b', x0 - 1, deck - 1, geo.len + 2, 10);
      R(c, '#a8693a', x0, deck, geo.len, 4); R(c, '#7a4a24', x0, deck + 4, geo.len, 4); R(c, '#d9a96a', x0, deck, geo.len, 1);
      for (const lx of [x0, x1 - 3]) { R(c, '#d9a96a', lx, deck, 3, 4); R(c, '#c08a50', lx, deck + 4, 3, 4); }
      for (const lx of [x0 + 9, x1 - 12]) R(c, '#d8c08a', lx, deck, 2, 8);
    } else {
      const hull = ['', '#b07a45', '#7a4a24', '#6b3d1e'][tier], dark = ['', '#6b3e1c', '#3d2410', '#2f1a0b'][tier];
      polyC(c, [[x0 - 1, deck - 3], [x1 + 8, deck - 6], [x1 - 5, geo.bot + 1], [x0 + 5, geo.bot + 1]], dark);
      polyC(c, [[x0, deck - 2], [x1 + 6, deck - 5], [x1 - 6, geo.bot], [x0 + 6, geo.bot]], hull);
      for (let yy = deck + 1; yy < geo.bot - 1; yy += 3) R(c, 'rgba(40, 20, 8, .35)', x0 + 4, yy, geo.len - 6, 1);
      R(c, 'rgba(255, 230, 190, .35)', x0, deck - 2, geo.len + 4, 1);
      if (tier >= 2) { R(c, dark, x0, deck - 6, geo.len + 2, 1); for (let px = x0; px <= x1; px += 6) R(c, dark, px, deck - 6, 1, 4); }
      if (tier === 3) { R(c, '#d9823b', x0 + 6, geo.bot - 5, geo.len - 10, 2); R(c, '#ffb070', x0 + 6, geo.bot - 5, geo.len - 10, 1); for (let px = x0 + 10; px < x1 - 6; px += 11) { R(c, '#2f1a0b', px - 1, deck + 2, 4, 4); R(c, '#ffd166', px, deck + 3, 2, 2); } }
    }
    // deck cargo
    if (x.includes('water')) for (const bx of [x1 - 16, x1 - 10]) { R(c, '#3d2410', bx - 1, deck - 8, 6, 8); R(c, '#a8693a', bx, deck - 7, 4, 7); R(c, '#4cc9f0', bx, deck - 5, 4, 1); }
    if (x.includes('food')) { R(c, '#3d2410', x1 - 24, deck - 7, 7, 7); R(c, '#c79a5c', x1 - 23, deck - 6, 5, 5); R(c, '#7a4a24', x1 - 23, deck - 4, 5, 1); }
    if (x.includes('tar')) { R(c, '#1c1c22', x0 + 2, deck - 7, 5, 7); R(c, '#3b3f4a', x0 + 2, deck - 5, 5, 1); }
    if (x.includes('rope')) { ellC(c, x0 + 12, deck - 1, 3, 1, '#d8c08a'); R(c, '#9a7a4a', x0 + 11, deck - 1, 2, 1); }
    if (x.includes('pump')) { R(c, '#5f6974', x1 - 30, deck - 9, 2, 9); R(c, '#a9b3bd', x1 - 32, deck - 10, 6, 2); }
    if (x.includes('net')) for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) R(c, '#d8c08a', x0 + 4 + i * 2, deck + 1 + j * 2, 1, 1);
    if (x.includes('anchor')) { R(c, '#8a96a3', x1 + 3, deck - 4, 1, 8); R(c, '#8a96a3', x1 + 1, deck + 4, 5, 1); R(c, '#8a96a3', x1 + 1, deck + 2, 1, 2); R(c, '#8a96a3', x1 + 5, deck + 2, 1, 2); }
    if (x.includes('figure')) { R(c, '#c99a12', x1 + 6, deck - 9, 4, 6); R(c, '#ffd166', x1 + 7, deck - 9, 2, 3); }
    // the player on deck
    Scene.drawCharacter(c, x0 + 12, deck - (tier >= 2 ? 1 : 0), look, { bob: Math.floor(t / 320) % 2 });
    // masts and sails
    const mast = (mx, h) => { R(c, '#3d2410', mx, deck - h, 2, h); };
    const square = (mx, top, w, h, col, stripe) => {
      const billow = Math.round(Math.sin(t / 300) * 1);
      R(c, '#2f1a0b', mx - w / 2 - 1, top - 1, w + 4, 2); R(c, '#2f1a0b', mx - w / 2 - 1, top, 1, h); R(c, '#2f1a0b', mx + w / 2 + 2, top, 1, h);
      R(c, col, mx - w / 2, top + 1, w + 2, h - 1); R(c, 'rgba(0,0,0,.12)', mx - w / 2, top + h - 4, w + 2, 3 + billow);
      if (stripe) R(c, stripe, mx - w / 2, top + Math.floor(h / 2), w + 2, 2);
    };
    let flagX = x0 + 3, flagY = deck - 16;
    if (!sh.s) { R(c, '#3d2410', x0 + 3, deck - 16, 1, 16); }
    else if (sh.s === 1) { mast(cx + 6, 38); square(cx + 6, deck - 34, 22, 18, '#e9dcb8'); R(c, '#c9a46a', cx + 2, deck - 28, 4, 4); R(c, '#c9a46a', cx + 12, deck - 22, 5, 3); flagX = cx + 7; flagY = deck - 38; }
    else if (sh.s === 2) { mast(cx + 6, 50); square(cx + 6, deck - 46, 26, 14, '#f4f1e8'); square(cx + 6, deck - 30, 30, 14, '#f4f1e8'); polyC(c, [[cx + 9, deck - 46], [x1 + 6, deck - 6], [cx + 9, deck - 8]], '#e8e2d2'); flagX = cx + 7; flagY = deck - 50; }
    else { mast(cx - 4, 54); mast(cx + 20, 46); square(cx - 4, deck - 50, 26, 14, '#ffffff', color); square(cx - 4, deck - 33, 30, 14, '#ffffff'); square(cx + 20, deck - 42, 22, 12, '#ffffff', color); square(cx + 20, deck - 28, 26, 12, '#ffffff'); flagX = cx - 3; flagY = deck - 54; }
    const wv = Math.floor(t / 200) % 2;
    R(c, color, flagX + 1, flagY, 6, 2); R(c, color, flagX + 1, flagY + 2, 5 + wv, 2);
    if (x.includes('lantern')) { const lx = sh.s ? (sh.s === 3 ? cx - 2 : cx + 8) : x0 + 4, ly = deck - 18; c.globalAlpha = 0.25 + 0.15 * Math.sin(t / 200); ellC(c, lx + 1, ly + 2, 7, 6, '#ffd166'); c.globalAlpha = 1; R(c, '#3b3f4a', lx - 1, ly - 1, 4, 5); R(c, '#ffd166', lx, ly, 2, 3); }
    return { deck, x0, x1 };
  }
  function followId(seg) {
    const V = fx.voyage, n = V.route.length;
    if (amPlaying() && V.res[ctx.me.id]) { const r = V.res[ctx.me.id]; if (r.sunk < 0 || seg <= r.sunk) return ctx.me.id; }
    const alive = V.rank.filter((id) => { const r = V.res[id]; return r && (r.sunk < 0 || r.sunk >= seg); });
    return alive[0] || (amPlaying() ? ctx.me.id : V.rank[0]);
  }
  function seaY() { return Math.round(H * 0.64); }
  function heart(x, y, full) {
    const c = full ? '#ff4d6d' : '#2a3448', h = full ? '#ff9db0' : '#3a465e';
    rect('#0b1320', x, y + 1, 7, 4); rect('#0b1320', x + 1, y, 2, 6); rect('#0b1320', x + 4, y, 2, 6); rect('#0b1320', x + 2, y + 5, 3, 2);
    rect(c, x + 1, y + 1, 5, 3); rect(c, x + 2, y + 4, 3, 1); rect(c, x + 3, y + 5, 1, 1); rect(h, x + 1, y + 1, 1, 1);
  }
  function drawStorm(e, t) {
    const V = fx.voyage, route = V.route, n = route.length;
    const view = visibleArea();
    const seg = Math.floor(e / V_OBS), u = (e % V_OBS) / V_OBS;
    const kind = seg < n ? route[seg] : 'harbor';
    const fid = followId(Math.min(seg, n - 1));
    const res = V.res[fid];
    const sy0 = seaY();
    // sky
    const calm = kind === 'harbor' ? clamp(u * 2, 0, 1) : kind === 'haul' ? 0.35 : 0;
    const flash = (kind === 'squall' && Math.abs(u - 0.5) < 0.03 && res && res.steps[seg] && !res.steps[seg].p) || (kind !== 'harbor' && (t % 4300) < 70);
    const top = flash ? [200, 210, 230] : [lerp(22, 120, calm), lerp(28, 160, calm), lerp(44, 200, calm)], bot = flash ? [150, 160, 190] : [lerp(44, 255, calm), lerp(54, 190, calm), lerp(78, 140, calm)];
    for (let y = 0; y < sy0; y += 4) { const k = y / sy0; rect(`rgb(${Math.round(lerp(top[0], bot[0], k))},${Math.round(lerp(top[1], bot[1], k))},${Math.round(lerp(top[2], bot[2], k))})`, 0, y, W, 4); }
    // drifting clouds
    for (let i = 0; i < 9; i++) {
      const cw = 50 + hash32(3, i, 0) * 60, x = ((hash32(3, i, 1) * (W + 200) - t * (0.01 + hash32(3, i, 2) * 0.02)) % (W + 200) + W + 200) % (W + 200) - 100;
      const y = 8 + hash32(3, i, 3) * sy0 * 0.45;
      g.globalAlpha = 0.5 * (1 - calm); ellipse(x, y, cw / 2, 7, '#0e1522'); ellipse(x + 10, y - 4, cw / 3, 6, '#141d2e'); g.globalAlpha = 1;
    }
    // sea surface
    const amp = kind === 'choppy' ? 6 : kind === 'harbor' ? 1.5 : 3.5;
    const shipX = Math.round(view.cx - 50);
    const ox = shipX + (0.5 - u) * (W + 240);
    for (let x = 0; x < W; x += 2) { const yy = sy0 - 6 + Math.sin((x + t * 0.05) / 22) * amp * 0.7; rect(kind === 'harbor' && calm > 0.5 ? '#2a6f9a' : '#163a5c', x, yy, 2, H - yy); }
    // obstacle behind the ship
    const step = res && seg < n ? res.steps[seg] : null;
    const pass = step ? !!step.p : true, hit = step && !step.p && u >= 0.5;
    let lift = 0, tilt = Math.sin(t / 520) * 0.05, shakeX = 0;
    if (kind === 'choppy') tilt = Math.sin(t / 240) * (pass ? 0.12 : 0.24);
    if (kind === 'reef') {
      for (const [dx, h, w] of [[-34, 20, 18], [-8, 32, 24], [18, 16, 16], [40, 26, 20], [62, 14, 12]]) {
        const rx = ox + dx; polyC(g, [[rx - w / 2, sy0 + 2], [rx - 2, sy0 - h], [rx + 3, sy0 - h + 4], [rx + w / 2, sy0 + 2]], '#2b2f38'); rect('#4a505c', rx - 2, sy0 - h, 2, h - 2);
        rect('#d6f2fb', rx - w / 2, sy0 + 1, w, 1);
      }
    }
    if (kind === 'squall') {
      g.globalAlpha = 0.9; ellipse(ox, 40, 90, 22, '#0b0f18'); ellipse(ox - 40, 46, 50, 14, '#121826'); ellipse(ox + 50, 44, 46, 14, '#121826'); g.globalAlpha = 1;
      if ((t % 900) < 90) { let bx = ox - 30 + hash32(4, Math.floor(t / 900), 0) * 60, by = 56; while (by < sy0) { const nx = bx + (hash32(4, by, bx | 0) - 0.5) * 10; for (let i = 0; i < 8; i++) rect('#fff8c4', lerp(bx, nx, i / 8), by + i, 2, 1); bx = nx; by += 8; } }
    }
    if (kind === 'whirl') {
      for (let r = 6; r < 70; r += 9) for (let a = 0; a < 6.28; a += 0.2) {
        const ang = a + t / (300 + r * 4);
        if (Math.floor(a * 5 + r) % 3) continue;
        rect('#9fd8f0', ox + Math.cos(ang) * r, sy0 + 2 + Math.sin(ang) * r * 0.22, 2, 1);
      }
    }
    if (kind === 'kraken') {
      for (let k = 0; k < 4; k++) {
        const bx = ox - 50 + k * 34, hgt = 40 + (k % 2) * 16 + Math.sin(t / 300 + k) * 6;
        for (let i = 0; i < hgt; i++) { const xx = bx + Math.sin(i / 8 + t / 250 + k) * 6; const w = Math.max(2, 7 - i / 9); rect('#5b2a6e', xx - w / 2, sy0 - i, w, 1); if (i % 6 === 0) rect('#c79bf5', xx - 1, sy0 - i, 2, 1); }
      }
    }
    if (kind === 'wave') {
      const A = Math.min(H * 0.45, 130);
      for (let x = Math.floor(ox - 140); x < ox + 140; x += 2) {
        if (x < -2 || x > W) continue;
        const k = (x - ox) / 62, hgt = A * Math.exp(-k * k) * (1 + 0.25 * Math.tanh(-k * 2));
        const yy = sy0 - hgt;
        rect('#1d4f7a', x, yy, 2, sy0 - yy + 4); rect('#2f6f9f', x, yy, 2, Math.min(10, hgt)); rect('#d6f2fb', x, yy, 2, 2);
      }
      const k = (shipX - ox) / 62; lift = A * Math.exp(-k * k) * (pass ? 1 : 0.55);
      const k2 = (shipX + 6 - ox) / 62; tilt = -Math.atan2(A * Math.exp(-k2 * k2) - A * Math.exp(-k * k), 6) * (pass ? 1 : 0.6);
    }
    // ship
    const sh = (fx.ships && fx.ships[fid]) || newShip(), p = player(fid);
    if (!shipCv) shipCv = makeSprite(160, 130, () => {});
    const sc = shipCv.getContext('2d'); sc.imageSmoothingEnabled = false;
    shipSide(sc, sh, p ? p.look : { c: 0 }, colorOf(fid), t);
    let sinkY = 0;
    if (res && res.sunk === seg && u > 0.55) { const s = (u - 0.55) / 0.45; sinkY = s * 50; tilt += s * 0.5; }
    if (hit && u < 0.66) { shakeX = Math.sin(t / 25) * 3; if (kind === 'whirl') tilt += Math.sin(t / 70) * 0.35; else tilt += -0.25 * (1 - (u - 0.5) / 0.16); }
    if (kind === 'harbor' && res && res.sunk >= 0) sinkY = 120;
    const bob = Math.sin(t / 380) * 2;
    g.save(); g.translate(shipX + shakeX, sy0 - lift + bob + sinkY); g.rotate(tilt); g.drawImage(shipCv, -80, -92); g.restore();
    // front swell covers the bottom of the hull
    for (let x = 0; x < W; x += 2) {
      const yy = sy0 + 3 + Math.sin((x - t * 0.08) / 14) * amp + Math.sin((x + t * 0.03) / 37) * amp * 0.6;
      rect(kind === 'harbor' && calm > 0.5 ? '#2f86b5' : '#1f4d74', x, yy, 2, H - yy);
      if (Math.sin((x - t * 0.08) / 14) > 0.85) rect('#8fc7e6', x, yy, 2, 1);
    }
    if ((kind === 'wave' || kind === 'choppy' || kind === 'kraken') && hit && u < 0.66) {
      const s = (u - 0.5) / 0.16; g.globalAlpha = clamp(1 - s, 0, 1);
      for (let i = 0; i < 26; i++) {
        const a = hash32(12, i, 0) * Math.PI, r = 14 + s * (30 + hash32(12, i, 1) * 50), bx = shipX + Math.cos(a) * r * 1.3 - 10, by = sy0 - lift - 10 - Math.sin(a) * r;
        ellipse(bx, by, 3 + hash32(12, i, 2) * 5, 2 + hash32(12, i, 3) * 3, i % 3 ? '#e8f8ff' : '#9fd8f0');
      }
      g.globalAlpha = 1;
    }
    if (kind === 'squall' && hit && u < 0.55) { let bx = shipX + 8, by = 40; while (by < sy0 - 40) { const nx = bx + (hash32(6, by, 1) - 0.5) * 12; for (let i = 0; i < 8; i++) rect('#fff8c4', lerp(bx, nx, i / 8), by + i, 2, 1); bx = nx; by += 8; } }
    if (kind === 'fog') { const a = 0.82 * Math.exp(-(((u - 0.5) / 0.22) ** 2)); g.globalAlpha = a; rect('#9aa6b4', 0, 0, W, H); g.globalAlpha = 1; if (pass && (sh.x || []).includes('lantern')) { g.globalAlpha = 0.35 * a; ellipse(shipX + 30, sy0 - 30, 60, 24, '#ffe9a0'); g.globalAlpha = 1; } }
    // rain
    if (kind !== 'harbor') { g.globalAlpha = 0.5; for (let i = 0; i < 90; i++) { const rx = ((hash32(8, i, 0) * (W + 40) - t * 0.12) % (W + 40) + W + 40) % (W + 40) - 20, ry = (hash32(8, i, 1) * H + t * 0.45) % H; rect('#a9c4dd', rx, ry, 1, 3); rect('#a9c4dd', rx - 1, ry + 3, 1, 2); } g.globalAlpha = 1; }
    if (kind === 'harbor') {
      const lx = W - view.right - 70;
      rect('#3a3f4a', lx - 6, sy0 - 80, 12, 82); for (let y = sy0 - 76; y < sy0; y += 12) rect('#e2453c', lx - 6, y, 12, 5);
      rect('#2b2f38', lx - 8, sy0 - 88, 16, 8); rect('#ffd166', lx - 4, sy0 - 86, 8, 4);
      g.globalAlpha = 0.3 + 0.2 * Math.sin(t / 300); ellipse(lx, sy0 - 84, 14, 8, '#fff3c4'); g.globalAlpha = 1;
      rect('#5a3618', lx - 60, sy0 - 4, 50, 4); for (let x = lx - 58; x < lx - 10; x += 10) rect('#3d2410', x, sy0, 3, 8);
    }
    // overlay: route progress, hearts, obstacle card
    const L = view.cx - 150, Rr = view.cx + 150, py = 46;
    rect('#0b1320', L - 2, py - 1, Rr - L + 4, 3); rect('#3a4a62', L, py, Rr - L, 1);
    const nodeX = (i) => L + ((i + 1) / (n + 1)) * (Rr - L);
    route.forEach((k, i) => { const done = seg > i || (seg === i && u >= 0.5); rect(done ? '#ffd166' : '#5a6a82', nodeX(i) - 2, py - 2, 5, 5); text(OBST[k].icon, nodeX(i), py - 9, '#fff', 5.5); });
    rect('#7bd389', Rr - 2, py - 3, 6, 7); text('⚓', Rr + 1, py - 10, '#fff', 5.5);
    const prog = Math.min(e / V_OBS, n + 0.5);
    V.rank.slice().reverse().forEach((id) => {
      const r = V.res[id]; if (!r) return;
      const pp = r.sunk >= 0 ? Math.min(prog, r.sunk + 0.55) : prog;
      const mx = L + ((pp + 0.5) / (n + 1)) * (Rr - L), my = py + 5;
      rect('#0b1320', mx - 2, my - 1, 5, 5); rect(colorOf(id), mx - 1, my, 3, 3);
      if (r.sunk >= 0 && prog > r.sunk + 0.55) { rect('#ff4d6d', mx - 2, my - 1, 1, 1); rect('#ff4d6d', mx + 2, my + 3, 1, 1); }
      if (id === fid) rect('#ffffff', mx - 1, my + 5, 3, 1);
    });
    if (res) {
      const hpNow = seg >= n ? res.hp : (seg === 0 ? (u < 0.5 ? res.hp0 : (res.steps[0] || {}).hp) : u < 0.5 ? (res.steps[seg - 1] || { hp: res.hp }).hp : (res.steps[seg] || { hp: res.hp }).hp);
      const hx = 12, hy = 62;
      text(fid === ctx.me.id ? 'Your ship' : `${p ? p.name : 'Ship'}'s ship`, hx, hy - 8, colorOf(fid), 6, 'left');
      for (let i = 0; i < res.hp0; i++) heart(hx + (i % 10) * 8, hy + Math.floor(i / 10) * 8, i < hpNow);
      if (fid !== ctx.me.id && amPlaying()) text('Your ship sank. Watching the leader…', hx, hy + 24 + Math.floor(res.hp0 / 10) * 8, '#9fb3c8', 5, 'left');
    }
    if (kind !== 'harbor' && step) {
      const o = OBST[kind], a = clamp(u * 6, 0, 1) * clamp((1 - u) * 6, 0, 1);
      const cy = H - 62;
      g.globalAlpha = 0.75 * a; rect('#0b1320', view.cx - 130, cy - 14, 260, 48); g.globalAlpha = 1;
      text(`${o.icon} ${o.name.toUpperCase()}`, view.cx, cy - 4, '#ffffff', 10, 'center', a);
      text(`Needs ${o.stats.map((s) => STAT_NAME[s]).join(' + ')} ${step.need} · this ship has ${step.v}`, view.cx, cy + 9, step.p ? '#9be8b0' : '#ffb3a7', 5.5, 'center', a);
      if (u >= 0.5) {
        const k = clamp((u - 0.5) * 6, 0, 1);
        text(step.p ? '✓ CLEARED!' : res.sunk === seg ? `−${o.dmg} ❤ · SUNK!` : `−${o.dmg} ❤`, view.cx, cy + 22, step.p ? '#7bd389' : '#ff6b81', 8 + k * 2, 'center', a);
      }
    } else if (kind === 'harbor') {
      const a = clamp(u * 4, 0, 1);
      if (res && res.sunk < 0) text('⚓ SAFE HARBOR!', view.cx, 80, '#ffe08a', 13, 'center', a);
      else text('🌊 Lost at sea…', view.cx, 80, '#9fd8f0', 12, 'center', a);
      text('Final results coming up…', view.cx, 96, '#e6f0fa', 6, 'center', a);
    }
    if (e < 450) { g.globalAlpha = 1 - e / 450; rect('#000', 0, 0, W, H); g.globalAlpha = 1; }
  }
  let planCache = null, filmFreeze = null; // filmFreeze: tests pin the film to one moment
  function planFor(V) { if (!planCache || planCache.at !== V.at) planCache = { at: V.at, plan: voyagePlan(V, ctx.me.id) }; return planCache.plan; }
  // start (once per voyage) and size the 3D film; false while Three.js is loading or unavailable
  function film(V, plan) {
    if (!window.Voyage3D || !Voyage3D.ready()) { if (window.Voyage3D) Voyage3D.preload(); return false; }
    const box = $('#isCine'); if (!box) return false;
    const right = Math.round(visibleArea().right * SCALE);
    if (box.dataset.right !== String(right)) { box.dataset.right = right; box.style.right = right + 'px'; }
    if (Voyage3D.key() !== V.at) {
      const ids = Object.keys(V.res);
      Voyage3D.begin(box, {
        V, plan, meId: ctx.me.id, playing: amPlaying(), ships: fx.ships || {}, OBST, STAT_NAME,
        players: ids.map((id) => { const p = player(id); return { id, name: p ? p.name : 'Sailor', look: (p && p.look) || {}, color: colorOf(id) }; }),
        partName: (slot, tier) => (partFor(slot, tier) || { name: '' }).name,
        canSkip: !!ctx.me.host,
        onSkip: () => { if (ctx.me.host && fx && fx.voyage && S.phase === 'voyage') fx.voyage.endsAt = Date.now(); },
      });
    }
    return true;
  }
  // map the film's timeline onto the old 2D storm (used only without WebGL)
  function storm2D(plan, e, n) {
    const s = plan.segs.find((x) => e >= x.t0 && e < x.t0 + x.dur) || plan.segs[plan.segs.length - 1];
    const u = clamp((e - s.t0) / s.dur, 0, 1);
    if (s.kind === 'obs') return s.i * V_OBS + u * V_OBS;
    if (s.kind === 'end') return n * V_OBS + u * V_END * 0.95;
    return 500; // before the first danger: hold its opening frame (past the fade-in)
  }
  function drawTeleport(el) {
    const sp = shipPos(amPlaying() ? ctx.me.id : (fx.voyage.rank[0] || ''));
    const a = clamp(1 - el / 700, 0, 1);
    if (a > 0) { g.globalAlpha = a * 0.7; rect('#ffffff', 0, 0, W, H); g.globalAlpha = 1; }
    if (sp) { const r = (el / 600) * 30; g.globalAlpha = clamp(1 - el / 900, 0, 1); ellipse(SXw(sp.x), SYw(sp.y) - 8, r, r * 0.6, '#fff8d6'); g.globalAlpha = 1; }
    const view = visibleArea();
    text("⛈ TIME'S UP! ALL ABOARD!", view.cx, 70, '#ffe08a', 11, 'center', clamp(el / 300, 0, 1));
    text('The storm is coming. Let’s see if your ship survives…', view.cx, 86, '#e6f0fa', 6, 'center', clamp((el - 300) / 300, 0, 1));
    if (el > V_TELE - 500) { g.globalAlpha = clamp((el - (V_TELE - 500)) / 500, 0, 1); rect('#000', 0, 0, W, H); g.globalAlpha = 1; }
  }
  function draw(t) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    tg.clearRect(0, 0, tcv.width, tcv.height);
    const V = fx && fx.voyage;
    if (V && (S.phase === 'voyage' || S.phase === 'over')) {
      const el = now() - V.at, plan = planFor(V);
      if (S.phase === 'voyage' && el < V_TELE && filmFreeze == null) { drawIsland(t); drawTeleport(el); return; }
      const e = filmFreeze != null ? filmFreeze : S.phase === 'over' ? plan.total : el - V_TELE;
      if (film(V, plan)) { Voyage3D.render(e, S.phase === 'over', performance.now()); return; }
      drawStorm(storm2D(plan, e, V.route.length), t); return;
    }
    drawIsland(t);
    if (fx && fx.startAt && S.phase === 'play') {
      const view = visibleArea(), left = fx.startAt - now();
      if (left > 0) text(String(Math.ceil(left / 1000)), view.cx, H * 0.4, '#ffd166', 28);
      else if (left > -900) text('GO!', view.cx, H * 0.4, '#7bd389', 28, 'center', 1 + left / 900);
    }
  }

  // ---------- effects ----------
  function burst(x, y, h, n, colors, sp = 50) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random()); parts.push({ x, y, h, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vh: sp * (0.4 + Math.random() * 0.6), g: 140, life: 0, max: 0.5 + Math.random() * 0.5, c: colors[i % colors.length], s: 1 }); }
  }
  function floatText(x, y, h, str, color, size = 7) { floaters.push({ x, y, h, str, color, size, t0: performance.now() }); }
  function banner(html, ms = 3200) {
    const b = $('#fxBanner'); b.innerHTML = html; b.hidden = false;
    b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => (b.hidden = true), ms);
  }

  // ---------- energy ----------
  function serverEnergy(id) { return fx && fx.energy ? fx.energy[id] || 0 : 0; }
  function myEnergy() {
    if (!gameLive()) return serverEnergy(ctx.me.id);
    const el = (performance.now() - energyAt.t) / 1000;
    return Math.max(0, energyAt.v - el * (me.moving ? DRAIN_WALK : 0));
  }
  function renderEnergy() {
    const e = myEnergy(), live = gameLive(), playing = amPlaying() && S.phase === 'play';
    const out = live && serverEnergy(ctx.me.id) <= 0;
    for (const el of [$('#fxEnergy'), $('#fxqEnergy')]) {
      el.querySelector('i').style.width = Math.min(100, (e / gain()) * 100) + '%';
      el.querySelector('b').textContent = Math.ceil(e);
      el.classList.toggle('low', e < gain() * 0.25 && !out);
      el.classList.toggle('out', out);
    }
    $('#fxEnergy').hidden = !playing;
    $('#fxQBtn').hidden = !playing;
    $('#fxQBtn').classList.toggle('urgent', live && e < gain() * 0.25);
  }

  // ---------- questions (shared full-screen quiz) ----------
  const decQ = (x) => { try { return JSON.parse(decodeURIComponent(escape(atob(x)))); } catch (e) { return null; } };
  function openQuiz() {
    if (!amPlaying() || S.phase !== 'play' || quizOpen) return;
    if (shopOpen) closeShop();
    quizOpen = true; keys.left = keys.right = keys.up = keys.down = false;
    const hint = $('#fxQuiz .quiz-hint'); if (hint) hint.innerHTML = `Each correct answer gives <b>+${gain()} ⚡</b>`;
    $('#fxQuizClose').innerHTML = 'Back to the island <kbd>Space</kbd>';
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
    if (ev.ok) { fb.innerHTML = `+${gain()} <span>⚡</span> energy!`; fb.className = 'quiz-feedback good'; energyAt = { v: myEnergy() + gain(), t: performance.now() }; Store.bump('correct'); }
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


  // ---------- the Shipwright's shop ----------
  function openShop() {
    if (!amPlaying() || S.phase !== 'play') return;
    if (quizOpen) closeQuiz();
    shopOpen = true; keys.left = keys.right = keys.up = keys.down = false;
    shopSig = ''; renderShop();
    const el = $('#isShop'); el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  }
  function closeShop() { shopOpen = false; if ($('#isShop')) $('#isShop').hidden = true; }
  function renderShop() {
    if (!shopOpen || !fx) return;
    const id = ctx.me.id, sh = shipOf(id), cash = (fx.money && fx.money[id]) || 0;
    const sig = cash + JSON.stringify(sh) + fx.diff;
    if (sig === shopSig) return; shopSig = sig;
    $('#isMoney').textContent = money(cash);
    const st = shipStats(sh);
    $('#isStats').innerHTML = STATS.map((s) => `<li><span>${s.name}</span><div class="bar"><i style="width:${Math.min(100, (st[s.k] / s.max) * 100)}%;background:${s.color}"></i></div><b>${st[s.k]}</b></li>`).join('') + `<li class="hp"><span>Hull points</span><b>❤ ${hp0Of(st)}</b></li>`;
    const route = ROUTES[fx.diff], sim = simulate(sh, route, fx.diff);
    $('#isForecast').innerHTML = route.map((k, i) => {
      const o = OBST[k], s = sim.steps[i];
      const v = o.stats.reduce((a, q) => a + st[q], 0), need = o.need[fx.diff], ok = v >= need;
      const after = s ? (s.hp <= 0 ? ' · sinks here' : '') : ' · (never reached)';
      return `<li class="${ok ? 'ok' : 'bad'}${s ? '' : ' skip'}"><span class="ic">${o.icon}</span><span class="nm">${esc(o.name)}</span><span class="rq">${o.stats.map((q) => STAT_NAME[q]).join(' + ')} ${need}</span><b>${ok ? '✓' : `✗ −${o.dmg}❤`}${after}</b></li>`;
    }).join('');
    $('#isVerdict').innerHTML = sim.sunk < 0 ? `Right now your ship would reach <b>Safe Harbor</b> with <b>❤ ${sim.hp}</b> left.` : `Right now your ship would <b>sink at the ${esc(OBST[route[sim.sunk]].name)}</b>.`;
    $('#isVerdict').className = 'is-verdict ' + (sim.sunk < 0 ? 'ok' : 'bad');
    const groups = [['h', 'Hull'], ['s', 'Sails'], ['k', 'Keel'], ['x', 'Extras']];
    $('#isParts').innerHTML = groups.map(([slot, label]) => `<div class="is-group"><span class="lbl">${label}</span><div class="is-grid">${PARTS.filter((p) => p.slot === slot && p.price > 0).map((p) => {
      const have = owns(sh, p), current = p.slot !== 'x' && (sh[p.slot] || 0) === p.tier;
      const afford = cash >= p.price;
      const chips = Object.entries(p.st).map(([k, v]) => `<em>+${v} ${STAT_NAME[k]}</em>`).join('');
      const state = have ? (current || p.slot === 'x' ? 'Installed' : 'Upgraded') : money(p.price);
      return `<button class="is-part${have ? ' owned' : ''}${!have && !afford ? ' poor' : ''}" data-part="${p.id}" ${have || !afford ? 'disabled' : ''} title="${esc(p.desc)}">
        <img src="${partIcon(p)}" alt=""><span class="pn">${esc(p.name)}</span><span class="ps">${chips}</span><b class="pp">${have ? '✓ ' : ''}${state}</b></button>`;
    }).join('')}</div></div>`).join('');
    // ship preview
    const c = $('#isShipPrev').getContext('2d');
    c.imageSmoothingEnabled = false;
    if (!shipCv) shipCv = makeSprite(160, 130, () => {});
    const sc = shipCv.getContext('2d');
    shipSide(sc, sh, (player(id) || { look: { c: 0 } }).look, colorOf(id), 0);
    c.fillStyle = '#20324d'; c.fillRect(0, 0, 160, 130);
    c.fillStyle = '#2f5f8a'; c.fillRect(0, 92, 160, 38);
    c.drawImage(shipCv, 0, 4);
    c.fillStyle = '#3a78a8'; c.fillRect(0, 98, 160, 32); c.fillStyle = '#8fc7e6'; for (let x = 0; x < 160; x += 9) c.fillRect(x, 98, 4, 1);
  }
  function buy(id) { const p = PART[id]; if (!p) return; ctx.send({ t: 'is-buy', from: ctx.me.id, part: id, x: me.x, z: me.y }); const b = $(`#isParts [data-part="${id}"]`); if (b) { b.disabled = true; b.querySelector('.pp').textContent = '…'; } }

  // ---------- input & interaction ----------
  function typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
  function onKey(e, down) {
    if (!active) return;
    if (down && !e.repeat && quizOpen) {
      if (e.key !== 'Escape' && cont()) { e.preventDefault(); return; }
      if (/^[1-9]$/.test(e.key)) { answer(Number(e.key) - 1); e.preventDefault(); return; }
      if (e.key === 'Escape') { closeQuiz(); e.preventDefault(); return; }
    }
    if (down && !e.repeat && shopOpen && (e.key === 'Escape' || e.key.toLowerCase() === 'e')) { closeShop(); e.preventDefault(); return; }
    if (typing()) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (down && !e.repeat) toggleQuiz(); return; }
    if (quizOpen || shopOpen) return;
    const k = e.key.toLowerCase();
    const map = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down' };
    if (map[k]) { keys[map[k]] = down; e.preventDefault(); }
    else if (k === 'e' && down && !e.repeat) { interact(); e.preventDefault(); }
  }
  function findAction() {
    if (!amPlaying() || !fx || S.phase !== 'play' || now() < fx.startAt) return null;
    const id = ctx.me.id, x = me.x, y = me.y, pack = packOf(id);
    if (frozen(id)) return { type: 'frozen' };
    if (dist(x, y, MARKET.x, MARKET.y + 8) < STAND_R) return { type: 'shop' };
    if (dist(x, y, TRADER.x, TRADER.y + 8) < STAND_R) return pack.length ? { type: 'sell', n: pack.length, total: pack.reduce((a, i) => a + ITEMS[i].value, 0) } : { type: 'traderEmpty' };
    let best = null, bd = DIG_R;
    for (const tr of fx.trs || []) { if (pendingDig.has(tr.id)) continue; const d = dist(x, y, tr.x, tr.y); if (d < bd) { bd = d; best = tr; } }
    let coin = null, cd = COIN_R + 4;
    for (const c of fx.coins || []) { if (eatenCoins.has(c.id)) continue; const d = dist(x, y, c.x, c.y); if (d < cd) { cd = d; coin = c; } }
    if (coin && (!best || cd <= bd)) return { type: 'coin', cid: coin.id, v: coin.v };
    if (best) return pack.length >= PACK ? { type: 'full' } : { type: 'dig', tid: best.id };
    const sp = shipPos(id);
    if (sp && dist(x, y, sp.x - 9, SHORE_Y + 20) < 26) return { type: 'myShip' };
    return null;
  }
  function interact() {
    const a = findAction(); if (!a) return;
    const base = { from: ctx.me.id, x: me.x, z: me.y };
    if (a.type === 'dig' || a.type === 'coin') {
      // you have to stay put for a moment: walking away cancels
      if (!me.chan) me.chan = { type: a.type, id: a.type === 'dig' ? a.tid : a.cid, start: performance.now(), dur: a.type === 'dig' ? DIG_MS : COIN_MS, last: 0 };
    } else if (a.type === 'sell') ctx.send({ t: 'is-sell', ...base });
    else if (a.type === 'shop' || a.type === 'myShip') { if (a.type === 'shop') openShop(); }
    else if (a.type === 'frozen') openQuiz();
  }
  function finishChannel() {
    const ch = me.chan; me.chan = null;
    const base = { from: ctx.me.id, x: me.x, z: me.y };
    if (ch.type === 'dig') {
      pendingDig.set(ch.id, performance.now());
      burst(me.x + 5, me.y, 2, 14, ['#8a5a2c', '#c79a5c', '#5a3618'], 50);
      ctx.send({ t: 'is-dig', ...base, tid: ch.id });
    } else {
      eatenCoins.set(ch.id, performance.now());
      ctx.send({ t: 'is-coin', ...base, cid: ch.id });
    }
  }
  function updateChannel() {
    const ch = me.chan; if (!ch) return;
    const gone = ch.type === 'dig' ? !(fx.trs || []).some((t) => t.id === ch.id) : !(fx.coins || []).some((c) => c.id === ch.id);
    if (gone || !gameLive() || quizOpen || shopOpen || frozen(ctx.me.id) || me.dx || me.dy) { me.chan = null; return; }
    const el = performance.now() - ch.start;
    if (ch.type === 'dig' && el - ch.last > 260) { ch.last = el; burst(me.x + 5, me.y, 2, 4, ['#8a5a2c', '#c79a5c', '#5a3618'], 30); }
    if (el >= ch.dur) finishChannel();
  }
  function renderPrompt() {
    const a = quizOpen || shopOpen ? null : findAction(), el = $('#fxPrompt');
    const busy = me.chan && a && (a.type === 'dig' || a.type === 'coin');
    const key = a ? a.type + (a.tid || '') + (a.cid || '') + (a.n || '') + (busy ? 'busy' : '') : '';
    if (key === prompt) return; prompt = key;
    if (!a) { el.hidden = true; return; }
    const label = {
      dig: () => busy ? 'Digging… stay still' : 'Dig here',
      coin: () => busy ? 'Picking up… stay still' : `Pick up the coin (<b>${money(a.v)}</b>)`,
      full: () => `Your backpack is full (${PACK}). Sell at the Trader first`,
      sell: () => `Sell ${a.n} antique${a.n === 1 ? '' : 's'} for <b>${money(a.total)}</b>`,
      traderEmpty: () => 'Dig up antiques around the island, then sell them here',
      shop: () => 'Open the Shipwright’s shop',
      myShip: () => 'Your ship. Buy parts at the Shipwright to improve it',
      frozen: () => 'Out of energy! Answer questions to move again',
    }[a.type]();
    const showKey = ['dig', 'coin', 'sell', 'shop'].includes(a.type) && !busy;
    el.innerHTML = `${showKey ? '<kbd>E</kbd>' : a.type === 'frozen' ? '<kbd>Space</kbd>' : ''}<span>${label}</span>`;
    el.classList.toggle('muted', !showKey && a.type !== 'frozen' && !busy);
    el.classList.toggle('alert', a.type === 'frozen');
    el.hidden = false;
  }

  // ---------- networking: dead-reckoned positions ----------
  function sendPos() {
    if (!amPlaying()) return;
    const t = performance.now();
    const vx = Math.round(me.dx * WALK * me.norm), vy = Math.round(me.dy * WALK * me.norm);
    const v = vx + ',' + vy;
    const changed = v !== me.sentV, heartbeat = (vx || vy) && t - me.sent > 1000;
    const settle = !vx && !vy && !me.moving && me.sentX != null && (Math.abs(me.x - me.sentX) > 0.5 || Math.abs(me.y - me.sentY) > 0.5);
    if (!changed && !heartbeat && !settle) return;
    me.sent = t; me.sentV = v; me.sentX = me.x; me.sentY = me.y;
    ctx.send({ t: 'pos', id: ctx.me.id, x: Math.round(me.x * 10) / 10, z: Math.round(me.y * 10) / 10, vx, vz: vy, f: me.f });
  }
  const predict = (b, at) => {
    const dt = Math.min(1.5, (performance.now() - at) / 1000);
    let x = b.x + b.vx * dt, y = b.y + b.vy * dt;
    if (world && !walkAt(x, y)) { x = b.x; y = b.y; } // don't predict people into the sea or through trees
    return { x, y };
  };
  function onPos(m) {
    if (!ctx || m.id === ctx.me.id) return;
    const b = { x: m.x, y: m.z != null ? m.z : SHORE_Y - 20, vx: m.vx || 0, vy: m.vz || 0 };
    let o = others.get(m.id);
    if (!o) { o = { x: b.x, y: b.y }; others.set(m.id, o); }
    Object.assign(o, { b, at: performance.now(), m: !!(b.vx || b.vy) });
    if (ctx.me.host) hostPos.set(m.id, { b, at: performance.now() });
  }

  // ---------- events ----------
  function handleEvents() {
    if (!fx || !fx.evs) return;
    const evs = fx.evs;
    if (lastEvN === -1) { lastEvN = evs.length ? evs[evs.length - 1].n : 0; return; }
    for (const ev of evs) {
      if (ev.n <= lastEvN) continue;
      lastEvN = ev.n;
      const p = player(ev.id), mine = ev.id === ctx.me.id, it = ev.item != null ? ITEMS[ev.item] : null;
      if (ev.type === 'dig') {
        pendingDig.delete(ev.tid);
        floatText(ev.x, ev.y, 16, it.name, it.color, it.r >= 3 ? 8 : 6.5);
        burst(ev.x, ev.y, 2, it.r >= 3 ? 18 : 8, it.r >= 2 ? ['#c79a5c', it.color, '#ffffff'] : ['#8a5a2c', '#c79a5c'], 45);
        if (it.r >= NOTIFY_TIER) banner(`✨ ${mine ? 'You' : esc(p ? p.name : 'Someone')} dug up a <b style="color:${it.color}">${it.tier.toUpperCase()}</b> ${esc(it.name)}!`);
        else if (mine) banner(`⛏️ You found a <b style="color:${it.color}">${it.tier}</b> ${esc(it.name)} (${money(it.value)})`, 2200);
      } else if (ev.type === 'digFail') {
        pendingDig.delete(ev.tid); prompt = null;
      } else if (ev.type === 'coin') {
        floatText(ev.x, ev.y, 10, '+' + money(ev.v), '#ffd166', 6);
        burst(ev.x, ev.y, 4, 6, ['#ffd166', '#fff3c4'], 35);
      } else if (ev.type === 'sell') {
        floatText(TRADER.x, TRADER.y, 50, '+' + money(ev.total), '#7bd389', ev.total >= 200 ? 10 : 8);
        burst(TRADER.x, TRADER.y, 40, 14, ['#ffd166', '#7bd389', '#ffffff'], 50);
        if (mine) banner(`💰 Sold ${ev.n} antique${ev.n === 1 ? '' : 's'} for <b>${money(ev.total)}</b>. Spend it at the Shipwright!`, 2600);
      } else if (ev.type === 'buy') {
        const part = PART[ev.part], sp = shipPos(ev.id);
        if (sp) { burst(sp.x, sp.y, 8, 16, ['#ffd166', '#ffffff', colorOf(ev.id)], 45); floatText(sp.x, sp.y, 26, part.name, '#ffe08a', 6); }
        if (mine) { banner(`⚓ Installed <b>${esc(part.name)}</b> on your ship!`, 2200); shopSig = ''; }
      } else if (ev.type === 'buyFail') {
        if (mine) { UI.toast(ev.why || 'Could not buy that.'); shopSig = ''; }
      } else if (ev.type === 'ans') {
        if (mine) onAnswerResult(ev);
        const pp = posOf(ev.id);
        if (ev.ok && pp) { floatText(pp.x, pp.y, 34, `+${gain()}⚡`, '#ffd166', 7); burst(pp.x, pp.y, 12, 10, ['#ffd166', '#fff3c4'], 40); }
      } else if (ev.type === 'frozen') {
        const pp = posOf(ev.id);
        if (pp) { floatText(pp.x, pp.y, 34, 'FROZEN!', '#9fe3ff', 7); burst(pp.x, pp.y, 10, 12, ['#bfe9ff', '#ffffff'], 40); }
        if (mine) banner('❄️ Out of energy! Press <kbd>Space</kbd> to answer questions and move again.', 4000);
      } else if (ev.type === 'voyage') {
        closeQuiz(); closeShop(); flashAt = performance.now();
        $('#fxPrompt').hidden = true;
      } else if (ev.type === 'over') {
        if (S.players.some((q) => q.id === ctx.me.id)) { Store.bump('games'); if (ev.id === ctx.me.id) Store.bump('wins'); }
      }
    }
  }

  // ---------- HUD ----------
  function renderHud() {
    if (!fx || !S) return;
    const sc = (id) => shipScore(shipStats(shipOf(id)));
    const list = S.players.slice().sort((a, b) => (sc(b.id) - sc(a.id)) || ((fx.money[b.id] || 0) - (fx.money[a.id] || 0)));
    $('#fxBoard').innerHTML = list.slice(0, 8).map((p, i) => `<li class="${p.id === ctx.me.id ? 'me' : ''}${p.gone ? ' gone' : ''}"><span class="rank">${i + 1}</span><span class="dot" style="background:${Scene.COLORS[p.look.c]}"></span><span class="nm">${esc(p.name)}</span><b title="Ship strength">⛵${sc(p.id)}</b><b class="cash">${money(fx.money[p.id] || 0)}</b></li>`).join('');
    $('#fxGoal').innerHTML = S.phase === 'play' ? `<span>${DIFF[fx.diff].label} storm · best ship wins</span>` : '';
    // backpack
    const pk = packOf(ctx.me.id), sig = S.phase + pk.join(',');
    if (sig !== packSig) {
      packSig = sig;
      const el = $('#isPack');
      el.hidden = !(amPlaying() && S.phase === 'play');
      el.innerHTML = `<span class="lbl">Backpack</span>` + Array.from({ length: PACK }, (_, i) => pk[i] != null ? `<span class="slot full" title="${esc(ITEMS[pk[i]].name)} · ${money(ITEMS[pk[i]].value)}" style="--c:${ITEMS[pk[i]].color}"><img src="${itemIcon(pk[i])}" alt="${esc(ITEMS[pk[i]].name)}"></span>` : '<span class="slot"></span>').join('');
    }
    renderShop();
  }
  function statusText(s) {
    const f = s.fx;
    if (s.phase === 'lobby') return 'Lobby';
    if (s.phase === 'over') return 'Game over';
    if (s.phase === 'voyage') return '⛈ The storm!';
    if (!f || !f.startAt) return 'Starting';
    const T = now();
    if (T < f.startAt) return 'Starting…';
    const left = Math.max(0, f.endAt - T);
    return `⏱ ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} until the storm`;
  }
  function drawMinimap() {
    const c = $('#fxMini'); if (!c || !fx || !world) return;
    const PXS = 2, w = Math.max(40, Math.floor(c.clientWidth / PXS)), h = Math.max(16, Math.floor(c.clientHeight / PXS));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const m = c.getContext('2d'), t = performance.now();
    const k = Math.min((w - 4) / WW, (h - 4) / WH), ox = Math.floor((w - WW * k) / 2), oy = Math.floor((h - WH * k) / 2);
    const key = w + 'x' + h;
    if (world.miniKey !== key) {
      const mc = makeSprite(w, h, (x) => {
        x.fillStyle = '#16304d'; x.fillRect(0, 0, w, h);
        const col = ['#1c5690', '#2a78b0', '#4fb0cc', '#e6cf8f', '#5aa64a', '#3d7e3a', '#86917a', '#c8a26a'];
        for (let yy = 0; yy < h - 2 * oy; yy++) for (let xx = 0; xx < w - 2 * ox; xx++) {
          const z = world.zoneAt(Math.floor((xx + 0.5) / k), Math.floor((yy + 0.5) / k));
          if (z === Z.DEEP) continue; x.fillStyle = col[z]; x.fillRect(ox + xx, oy + yy, 1, 1);
        }
        x.fillStyle = '#070b12'; x.fillRect(0, 0, w, 1); x.fillRect(0, h - 1, w, 1); x.fillRect(0, 0, 1, h); x.fillRect(w - 1, 0, 1, h);
      });
      world.mini = mc; world.miniKey = key;
    }
    m.drawImage(world.mini, 0, 0);
    const P = (x, y) => [ox + Math.floor(x * k), oy + Math.floor(y * k)];
    const Rm = (x, y, ww, hh, col) => { m.fillStyle = col; m.fillRect(x, y, ww, hh); };
    // piers & ships
    for (const id in fx.sec) { const [px, py] = P(pierX(fx.sec[id]), SHORE_Y); Rm(px, py, 1, 4, '#a8693a'); Rm(px + 1, py + 2, 2, 2, colorOf(id)); }
    // stalls
    let [sx, sy] = P(TRADER.x, TRADER.y); Rm(sx - 2, sy - 2, 4, 4, '#070b12'); Rm(sx - 1, sy - 1, 2, 2, '#ffd166');
    [sx, sy] = P(MARKET.x, MARKET.y); Rm(sx - 2, sy - 2, 4, 4, '#070b12'); Rm(sx - 1, sy - 1, 2, 2, '#4cc9f0');
    // coins
    if (S.phase === 'play') for (const cn of fx.coins || []) { const [cx, cy] = P(cn.x, cn.y); if ((Math.floor(t / 400) + cn.id) % 3) Rm(cx, cy, 1, 1, '#ffd166'); }
    // view
    const [vx0, vy0] = P(cx0, cy0), [vx1, vy1] = P(cx0 + W, cy0 + H);
    m.strokeStyle = 'rgba(255,255,255,.7)'; m.lineWidth = 1; m.strokeRect(vx0 + 0.5, vy0 + 0.5, Math.max(3, vx1 - vx0), Math.max(3, vy1 - vy0));
    for (const p of S.players) {
      const pos = S.phase === 'play' ? posOf(p.id) : shipPos(p.id); if (!pos || p.gone) continue;
      const [x, y] = P(pos.x, pos.y);
      Rm(x - 2, y - 2, 4, 4, '#070b12'); Rm(x - 1, y - 1, 2, 2, Scene.COLORS[p.look.c] || '#fff');
      if (p.id === ctx.me.id) { const by = y - 5 - (Math.floor(t / 400) % 2); Rm(x - 1, by, 2, 1, '#ffffff'); }
    }
  }

  // ---------- frame loop ----------
  function update(dt) {
    const view = visibleArea();
    let tx = camx + view.cx, ty = camy + view.cy;
    if (S.phase === 'play' && amPlaying()) {
      if (!me.placed) { const sp = spawnPos(ctx.me.id); me.x = sp.x; me.y = sp.y; me.placed = true; camx = me.x - view.cx; camy = me.y - view.cy; }
      const canMove = !quizOpen && !shopOpen && !frozen(ctx.me.id);
      me.dx = canMove ? (keys.right ? 1 : 0) - (keys.left ? 1 : 0) : 0;
      me.dy = canMove ? (keys.down ? 1 : 0) - (keys.up ? 1 : 0) : 0;
      me.norm = me.dx && me.dy ? 0.71 : 1;
      const vx = me.dx * WALK * me.norm, vy = me.dy * WALK * me.norm;
      me.vx += clamp(vx - me.vx, -ACCEL * dt, ACCEL * dt);
      me.vy += clamp(vy - me.vy, -ACCEL * dt, ACCEL * dt);
      const nx = me.x + me.vx * dt, ny = me.y + me.vy * dt;
      if (canStand(nx, me.y)) me.x = nx; else me.vx = 0;
      if (canStand(me.x, ny)) me.y = ny; else me.vy = 0;
      if (me.dx) me.f = me.dx;
      me.moving = Math.abs(me.vx) > 2 || Math.abs(me.vy) > 2;
      sendPos();
      updateChannel();
      tx = me.x; ty = me.y;
    } else if (S.phase === 'voyage' || S.phase === 'over') {
      const sp = shipPos(amPlaying() ? ctx.me.id : (fx.voyage && fx.voyage.rank[0]) || '');
      if (sp) { tx = sp.x; ty = sp.y; }
      me.dx = me.dy = 0; me.moving = false;
    } else {
      // spectators (or the lobby) pan with the arrow keys; start over the village
      if (!me.placed) { camx = PLAZA.x - view.cx; camy = PLAZA.y - 60 - view.cy; tx = PLAZA.x; ty = PLAZA.y - 60; me.placed = !amPlaying(); }
      tx += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * 260 * dt;
      ty += ((keys.down ? 1 : 0) - (keys.up ? 1 : 0)) * 260 * dt;
    }
    const goalX = clamp(tx - view.cx, -20, WW - W + view.right + 20), goalY = clamp(ty - view.cy, -20, WH - H + 20);
    const k = S.phase === 'play' && amPlaying() ? 1 - Math.exp(-dt * 6) : S.phase === 'voyage' ? 1 - Math.exp(-dt * 3) : 1;
    camx = lerp(camx, goalX, k); camy = lerp(camy, goalY, k);
    cx0 = Math.round(camx); cy0 = Math.round(camy);
    for (const o of others.values()) { if (o.at) { const p = predict(o.b, o.at); o.x = lerp(o.x, p.x, 1 - Math.exp(-dt * 12)); o.y = lerp(o.y, p.y, 1 - Math.exp(-dt * 12)); } }
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.vh != null) { p.vh -= p.g * dt; p.h = Math.max(0, p.h + p.vh * dt); } if (p.life > p.max) parts.splice(i, 1); }
    for (let i = floaters.length - 1; i >= 0; i--) if (performance.now() - floaters[i].t0 > 1300) floaters.splice(i, 1);
    for (const [id, at] of pendingDig) if (performance.now() - at > 3000) pendingDig.delete(id);
  }
  function frame() {
    if (!active) return;
    const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (S && world) {
      update(dt); draw(t); renderPrompt(); drawMinimap(); renderEnergy();
      $('#gRound').textContent = statusText(S);
      fps.push(t); while (fps.length && t - fps[0] > 1000) fps.shift();
    }
    requestAnimationFrame(frame);
  }
  const fps = [];
  function resize() {
    if (!cv) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    SCALE = Math.max(2, Math.floor(Math.min(vh / 220, vw / 360)));
    W = Math.ceil(vw / SCALE); H = Math.ceil(vh / SCALE);
    cv.width = W; cv.height = H; cv.style.width = W * SCALE + 'px'; cv.style.height = H * SCALE + 'px';
    dpr = Math.min(2, window.devicePixelRatio || 1);
    tcv.width = Math.round(W * SCALE * dpr); tcv.height = Math.round(H * SCALE * dpr);
    tcv.style.width = cv.style.width; tcv.style.height = cv.style.height;
    g = cv.getContext('2d'); g.imageSmoothingEnabled = false; tg = tcv.getContext('2d');
  }

  // ---------- host (authoritative) ----------
  const hostPos = new Map();
  let evN = 0, dirtyAt = 0;
  const host = {
    qsrc: [], qstate: new Map(), lastTick: 0, lastPush: 0, nid: 0, trItems: new Map(),
    initState(opts) {
      return { diff: DIFF[opts.diff] ? opts.diff : 'medium', minutes: opts.isMinutes || 6, gain: opts.isGain || GAIN_DEFAULT, sec: {}, money: {}, energy: {}, pack: {}, ships: {}, trs: [], coins: [], evs: [], startAt: 0, endAt: 0, voyage: null };
    },
    assignSections(S) {
      const f = S.fx; if (!f) return;
      if (S.phase === 'lobby') { f.sec = {}; S.players.forEach((p, i) => (f.sec[p.id] = i)); }
      for (const p of S.players) {
        if (f.energy[p.id] == null) f.energy[p.id] = 0; if (f.money[p.id] == null) f.money[p.id] = 0;
        if (!f.pack[p.id]) f.pack[p.id] = []; if (!f.ships[p.id]) f.ships[p.id] = newShip();
      }
    },
    start(S, src) {
      buildWorld();
      const f = S.fx;
      this.qsrc = (src || []).filter((q) => q.answers && q.answers.filter((a) => String(a).trim()).length);
      this.qstate.clear();
      this.reset(S);
      const D = DIFF[f.diff];
      for (let i = 0; i < D.trs; i++) this.spawnTreasure(f);
      for (let i = 0; i < D.coins; i++) this.spawnCoin(f);
      f.startAt = Date.now() + COUNTDOWN;
      f.endAt = f.startAt + f.minutes * 60000;
      S.phase = 'play';
      this.ev(S, { type: 'start' });
    },
    reset(S) {
      const f = S.fx;
      Object.assign(f, { money: {}, energy: {}, pack: {}, ships: {}, trs: [], coins: [], evs: [], startAt: 0, endAt: 0, voyage: null });
      this.trItems.clear(); this.lastTick = 0;
      this.assignSections(S);
      S.players.forEach((p) => (p.score = 0));
    },
    ev(S, e) { const f = S.fx; f.evs.push({ n: ++evN, ...e }); if (f.evs.length > 30) f.evs.splice(0, f.evs.length - 30); dirtyAt = dirtyAt || Date.now(); },
    walking(id) { if (id === ctx.me.id) return !!(me.dx || me.dy); const h = hostPos.get(id); return !!(h && (h.b.vx || h.b.vy)); },
    // A random open spot: on land, not blocked, away from the village and the harbor, not crowded.
    spot(f, minVillage) {
      for (let tries = 0; tries < 400; tries++) {
        const x = 20 + Math.random() * (WW - 40), y = 20 + Math.random() * (WH - 40), z = zoneAt(x, y);
        if (z < Z.SAND || z === Z.PLAZA || !canStand(x, y)) continue;
        if (y > SHORE_Y - 80 && x > HARBOR.x0 - 40 && x < HARBOR.x1 + 40) continue;
        if (dist(x, y, PLAZA.x, PLAZA.y) < minVillage) continue;
        if (f.trs.some((t) => dist(t.x, t.y, x, y) < 40) || f.coins.some((c) => dist(c.x, c.y, x, y) < 30)) continue;
        return { x: Math.round(x), y: Math.round(y), z };
      }
      return null;
    },
    spawnTreasure(f) {
      const s = this.spot(f, 200); if (!s) return;
      let item = pickItem(Math.random());
      if (s.z === Z.FOREST || s.z === Z.HILL) { const b = pickItem(Math.random()); if (ITEMS[b].r > ITEMS[item].r) item = b; } // deeper in = better odds
      const id = ++this.nid; this.trItems.set(id, item); f.trs.push({ id, x: s.x, y: s.y });
    },
    spawnCoin(f) {
      const s = this.spot(f, 120); if (!s) return;
      const [a, b] = DIFF[f.diff].coin;
      f.coins.push({ id: ++this.nid, x: s.x, y: s.y, v: a + Math.floor(Math.random() * (b - a + 1)) });
    },
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
        const ok = st.cur.choices[m.choice] === st.cur.right;
        if (ok) f.energy[id] = (f.energy[id] || 0) + (f.gain || GAIN_DEFAULT);
        this.ev(S, { type: 'ans', id, ok, right: st.cur.right, pick: m.choice });
        st.cur = null;
        this.sendQuestion(S, id);
        return;
      }
      if (Date.now() < f.startAt) return;
      const hasEnergy = (f.energy[id] || 0) > 0, mx = Number(m.x) || 0, my = Number(m.z) || 0;
      const pack = (f.pack[id] = f.pack[id] || []);
      if (m.t === 'is-dig') {
        const i = f.trs.findIndex((t) => t.id === m.tid);
        if (i < 0 || !hasEnergy || pack.length >= PACK || dist(f.trs[i].x, f.trs[i].y, mx, my) > 34) { this.ev(S, { type: 'digFail', id, tid: m.tid }); return; }
        const tr = f.trs.splice(i, 1)[0], item = this.trItems.get(tr.id);
        this.trItems.delete(tr.id);
        pack.push(item);
        this.ev(S, { type: 'dig', id, item, x: tr.x, y: tr.y, tid: tr.id });
        this.spawnTreasure(f);
      } else if (m.t === 'is-coin') {
        const i = f.coins.findIndex((c) => c.id === m.cid);
        if (i < 0 || dist(f.coins[i].x, f.coins[i].y, mx, my) > 30) return;
        const c = f.coins.splice(i, 1)[0];
        f.money[id] = (f.money[id] || 0) + c.v;
        this.ev(S, { type: 'coin', id, v: c.v, x: c.x, y: c.y });
        this.spawnCoin(f);
      } else if (m.t === 'is-sell') {
        if (!pack.length || dist(mx, my, TRADER.x, TRADER.y + 8) > 70) return;
        const total = pack.reduce((a, i) => a + ITEMS[i].value, 0);
        f.money[id] = (f.money[id] || 0) + total;
        this.ev(S, { type: 'sell', id, total, n: pack.length });
        f.pack[id] = [];
      } else if (m.t === 'is-buy') {
        const part = PART[m.part], sh = (f.ships[id] = f.ships[id] || newShip());
        const fail = (why) => this.ev(S, { type: 'buyFail', id, part: m.part, why });
        if (!part || !part.price) return fail('That part does not exist.');
        if (dist(mx, my, MARKET.x, MARKET.y + 8) > 80) return fail('Walk back to the Shipwright to buy parts.');
        if (owns(sh, part)) return fail('Your ship already has that.');
        if ((f.money[id] || 0) < part.price) return fail(`You need ${money(part.price)} for the ${part.name}.`);
        f.money[id] -= part.price;
        if (part.slot === 'x') sh.x.push(part.id); else sh[part.slot] = part.tier;
        p.score = shipScore(shipStats(sh));
        this.ev(S, { type: 'buy', id, part: part.id });
      }
    },
    startVoyage(S) {
      const f = S.fx, route = ROUTES[f.diff], res = {};
      for (const id in f.sec) if (S.players.some((q) => q.id === id)) res[id] = simulate(f.ships[id], route, f.diff);
      const n = route.length;
      const rank = Object.keys(res).sort((a, b) => (reached(res[b], n) - reached(res[a], n)) || (res[b].hp - res[a].hp) || (res[b].score - res[a].score) || ((f.money[b] || 0) - (f.money[a] || 0)));
      const at = Date.now() + 300;
      f.voyage = { at, route, res, rank, endsAt: 0 };
      f.voyage.endsAt = at + V_TELE + voyagePlan(f.voyage, null).total;
      f.trs = []; f.coins = []; this.trItems.clear();
      S.phase = 'voyage';
      this.ev(S, { type: 'voyage' });
    },
    tick(S, broadcast) {
      const f = S.fx; if (!f) return;
      const T = Date.now();
      if (S.phase === 'play' && T >= f.startAt) {
        const dt = this.lastTick ? Math.min(1, (T - this.lastTick) / 1000) : 0;
        this.lastTick = T;
        for (const id in f.sec) {
          const p = S.players.find((q) => q.id === id);
          if (!p || p.gone || (f.energy[id] || 0) <= 0 || !this.walking(id)) continue;
          const e = Math.max(0, f.energy[id] - DRAIN_WALK * dt);
          f.energy[id] = Math.round(e * 10) / 10;
          if (e <= 0) this.ev(S, { type: 'frozen', id });
        }
        if (T - this.lastPush > 1000) { this.lastPush = T; dirtyAt = dirtyAt || T; }
        if (T >= f.endAt) { this.startVoyage(S); dirtyAt = 0; broadcast(); return; }
      } else if (S.phase === 'voyage' && f.voyage && T >= f.voyage.endsAt) {
        S.phase = 'over'; S.winner = f.voyage.rank[0] || null;
        this.ev(S, { type: 'over', id: S.winner });
        dirtyAt = 0; broadcast(); return;
      }
      if (dirtyAt && T - dirtyAt >= 120) { dirtyAt = 0; broadcast(); }
    },
  };

  // ---------- lifecycle ----------
  function activate() {
    if (active) return;
    active = true;
    buildWorld(); buildSprites();
    $('#fxStage').hidden = false;
    if (!cv) {
      cv = $('#isCanvas'); tcv = $('#isText');
      window.addEventListener('resize', () => active && resize());
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      window.addEventListener('blur', () => { keys.left = keys.right = keys.up = keys.down = false; });
      const hold = (sel, k) => {
        const b = $(sel);
        const on = (e) => { if (!active) return; e.preventDefault(); keys[k] = true; }, off = () => { keys[k] = false; };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
      };
      hold('#fxLeft', 'left'); hold('#fxRight', 'right'); hold('#fxUp', 'up'); hold('#fxDown', 'down');
      $('#fxUse').addEventListener('pointerdown', (e) => { if (!active) return; e.preventDefault(); shopOpen ? closeShop() : interact(); });
      $('#fxQBtn').addEventListener('click', () => { if (active) { openQuiz(); $('#fxQBtn').blur(); } });
      $('#fxQuizClose').addEventListener('click', () => active && closeQuiz());
      $('#fxQuiz').addEventListener('pointerdown', (e) => { if (active && !e.target.closest('#fxQuizClose') && cont()) e.preventDefault(); });
      $('#fxqChoices').addEventListener('click', (e) => { if (!active) return; const b = e.target.closest('.tile'); if (b) answer(Number(b.dataset.i)); });
      $('#isShopClose').addEventListener('click', closeShop);
      $('#isParts').addEventListener('click', (e) => { const b = e.target.closest('.is-part'); if (b && !b.disabled) buy(b.dataset.part); });
      $('#isShop').addEventListener('click', (e) => { if (e.target.id === 'isShop') closeShop(); });
    }
    resize();
    last = performance.now();
    requestAnimationFrame(frame);
  }
  function deactivate() {
    const was = active;
    active = false;
    if (was && $('#fxStage')) $('#fxStage').hidden = true;
    others.clear(); parts.length = 0; floaters.length = 0; hostPos.clear(); eatenCoins.clear(); pendingDig.clear();
    Object.assign(me, { x: 0, y: 0, vx: 0, vy: 0, dx: 0, dy: 0, placed: false, sentX: null, sentY: null, sentV: null, moving: false, chan: null });
    lastEvN = -1; fx = null; S = null; clockOffset = null; prompt = null; camx = camy = 0; lastPhase = null; packSig = ''; shopSig = '';
    keys.left = keys.right = keys.up = keys.down = false;
    if (was) {
      closeQuiz(); closeShop(); Object.assign(quiz, { q: null, serial: -1, locked: false, next: null, wait: false }); clearTimeout(quiz.unlockTimer); renderCont();
      if ($('#fxPrompt')) { $('#fxPrompt').hidden = true; $('#fxBanner').hidden = true; }
      if ($('#isPack')) $('#isPack').hidden = true;
      $('#fxQuizClose').innerHTML = 'Back to factory <kbd>Space</kbd>';
    }
    energyAt = { v: 0, t: 0 };
    if (window.Voyage3D) Voyage3D.stop();
  }
  function onState(s) {
    const prevPhase = lastPhase; lastPhase = s.phase;
    S = s; fx = s.fx;
    if (fx && fx.hostNow) { const off = fx.hostNow - Date.now(); if (clockOffset == null || off > clockOffset) clockOffset = off; }
    if (ctx.me.host) clockOffset = 0;
    activate();
    if (prevPhase && prevPhase !== s.phase && s.phase === 'lobby') { lastEvN = -1; me.placed = false; pendingDig.clear(); eatenCoins.clear(); }
    if (prevPhase && prevPhase !== s.phase && s.phase !== 'play') { closeQuiz(); closeShop(); Object.assign(quiz, { q: null, next: null, locked: false }); }
    if (s.phase === 'play' && prevPhase === 'lobby') {
      me.placed = false; Object.assign(quiz, { q: null, next: null, locked: false });
      if (amPlaying()) setTimeout(openQuiz, 300); // everyone starts at 0 energy
    }
    if (s.phase === 'play' && window.Voyage3D) Voyage3D.preload(); // fetch Three.js while people play
    if (s.phase !== 'voyage' && s.phase !== 'over' && window.Voyage3D && Voyage3D.active()) Voyage3D.stop();
    energyAt = { v: serverEnergy(ctx.me.id), t: performance.now() };
    handleEvents();
    // coins we walked over that the host didn't give us come back after a moment
    if (fx && fx.coins) { const ids = new Set(fx.coins.map((c) => c.id)); for (const id of eatenCoins.keys()) if (!ids.has(id)) eatenCoins.delete(id); }
    renderHud();
    prompt = null;
  }

  // Read-only snapshot for automated tests (+ a client-side warp so tests can reach places quickly).
  function debug() {
    return {
      x: me.x, y: me.y, energy: myEnergy(), serverEnergy: serverEnergy(ctx.me.id), frozen: frozen(ctx.me.id), quizOpen, shopOpen, action: findAction(),
      pack: packOf(ctx.me.id), money: fx && fx.money ? fx.money[ctx.me.id] || 0 : 0, ship: shipOf(ctx.me.id), stats: shipStats(shipOf(ctx.me.id)),
      trs: (fx && fx.trs) || [], coins: (fx && fx.coins) || [], trader: { x: TRADER.x, y: TRADER.y + 14 }, market: { x: MARKET.x, y: MARKET.y + 14 },
      phase: S && S.phase, voyage: fx && fx.voyage, started: gameLive(), W, H, cam: [cx0, cy0], fps: fps.length,
    };
  }
  const test = {
    plan() { return fx && fx.voyage ? planFor(fx.voyage) : null; },
    freeze(e) { filmFreeze = e; },
    warp(x, y) { if (!canStand(x, y)) return false; me.x = x; me.y = y; me.sentV = null; sendPos(); return true; },
    nearestOpen(x, y) { for (let r = 0; r < 60; r += 2) for (let a = 0; a < 6.28; a += 0.4) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (canStand(px, py)) return { x: px, y: py }; } return null; },
  };

  return {
    PARTS, OBST, ROUTES, simulate, shipStats, debug, test,
    attach(c) { ctx = c; },
    host,
    onState, onPos, onQuestion, deactivate, statusText,
    isActive: () => active,
  };
})();

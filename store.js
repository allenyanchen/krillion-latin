// Krillion Latin: local storage for profile, sets and stats, plus shared UI helpers.
// Everything lives in this browser for now (accounts and a database can come later).
(() => {
  'use strict';
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const listeners = {};
  const emit = (ev) => (listeners[ev] || []).forEach((fn) => fn());
  const uid = () => Math.random().toString(36).slice(2, 10);

  window.Store = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },

    // ----- profile -----
    profile() {
      return {
        name: get('kl-name', ''),
        look: Scene.normLook(get('kl-look', { c: Math.floor(Math.random() * Scene.COLORS.length), h: 'laurel', e: 'dot' })),
      };
    },
    setName(n) { put('kl-name', String(n).trim().slice(0, 14)); emit('profile'); },
    setLook(l) { put('kl-look', Scene.normLook(l)); emit('profile'); },

    // ----- sets -----
    customSets() { return get('kl-sets', []); },
    sets() { return [...window.BUILTIN_SETS, ...this.customSets()]; },
    getSet(id) { return this.sets().find((s) => s.id === id) || null; },
    saveSet(set) {
      const list = this.customSets();
      const now = Date.now();
      if (!set.id) set.id = 'set-' + uid();
      set.builtIn = false; set.updatedAt = now; set.createdAt = set.createdAt || now;
      const i = list.findIndex((s) => s.id === set.id);
      if (i >= 0) list[i] = set; else list.unshift(set);
      put('kl-sets', list); emit('sets');
      return set;
    },
    deleteSet(id) { put('kl-sets', this.customSets().filter((s) => s.id !== id)); emit('sets'); },

    // ----- stats -----
    stats() { return { games: 0, wins: 0, correct: 0, ...get('kl-stats', {}) }; },
    bump(k, n = 1) { const s = this.stats(); s[k] = (s[k] || 0) + n; put('kl-stats', s); emit('stats'); },
  };

  // ----- UI helpers -----
  const ICONS = {
    dashboard: ['xxxx.xxxx', 'xxxx.xxxx', 'xxxx.xxxx', 'xxxx.xxxx', '.........', 'xxxx.xxxx', 'xxxx.xxxx', 'xxxx.xxxx', 'xxxx.xxxx'],
    sets: ['..xxxxxxx', '..x.....x', 'xxxxxxx.x', 'x.....x.x', 'x.xxx.x.x', 'x.....x.x', 'x.xx..xxx', 'x.....x..', 'xxxxxxx..'],
    characters: ['.xxxxxxx.', 'xxxxxxxxx', 'xx.xxx.xx', 'xx.xxx.xx', 'xxxxxxxxx', 'xxx...xxx', 'xxxxxxxxx', '.xx...xx.', '.xx...xx.'],
    join: ['....xxxxx', '....x...x', '..x.x...x', '...xx...x', 'xxxxx...x', '...xx...x', '..x.x...x', '....x...x', '....xxxxx'],
    plus: ['...xxx...', '...xxx...', '...xxx...', 'xxxxxxxxx', 'xxxxxxxxx', 'xxxxxxxxx', '...xxx...', '...xxx...', '...xxx...'],
    play: ['xx.......', 'xxxx.....', 'xxxxxx...', 'xxxxxxxx.', 'xxxxxxxxx', 'xxxxxxxx.', 'xxxxxx...', 'xxxx.....', 'xx.......'],
    back: ['...x.....', '..xx.....', '.xxxxxxxx', 'xxxxxxxxx', '.xxxxxxxx', '..xx.....', '...x.....', '.........', '.........'],
    chat: ['xxxxxxxxx', 'x.......x', 'x.xx.xx.x', 'x.......x', 'x.xxxx..x', 'x.......x', 'xxxxxxxxx', '.xx......', 'x........'],
    trash: ['...xxx...', 'xxxxxxxxx', '.........', '.xxxxxxx.', '.x.x.x.x.', '.x.x.x.x.', '.x.x.x.x.', '.x.x.x.x.', '.xxxxxxx.'],
    edit: ['......xx.', '.....xxxx', '....xxxx.', '...xxxx..', '..xxxx...', '.xxxx....', 'xxxx.....', 'xx.......', 'xxxx.....'],
    copy: ['...xxxxxx', '...x....x', 'xxxxxx..x', 'x....x..x', 'x....x..x', 'x....xxxx', 'x....x...', 'x....x...', 'xxxxxx...'],
    crown: ['.........', 'x...x...x', 'xx.xxx.xx', 'xxxxxxxxx', 'xxxxxxxxx', 'xxxxxxxxx', '.........', 'xxxxxxxxx', '.........'],
    check: ['.........', '........x', '.......xx', 'x.....xx.', 'xx...xx..', '.xx.xx...', '..xxx....', '...x.....', '.........'],
    search: ['.xxxx....', 'x....x...', 'x....x...', 'x....x...', '.xxxx....', '.....xx..', '......xx.', '.......xx', '.........'],
    x: ['x.......x', '.x.....x.', '..x...x..', '...x.x...', '....x....', '...x.x...', '..x...x..', '.x.....x.', 'x.......x'],
    up: ['....x....', '...xxx...', '..xxxxx..', '.xxxxxxx.', 'xxxxxxxxx', '...xxx...', '...xxx...', '...xxx...', '...xxx...'],
    bolt: ['.....xxx.', '....xxx..', '...xxx...', '..xxxxxx.', '.xxxxxx..', '...xxx...', '..xxx....', '.xxx.....', 'xx.......'],
    book: ['.........', 'xxx...xxx', 'x.xx.xx.x', 'x..xxx..x', 'x...x...x', 'x...x...x', 'x...x...x', 'xxx.x.xxx', '...xxx...'],
    users: ['.xx...xx.', 'xxxx.xxxx', 'xxxx.xxxx', '.xx...xx.', '.........', 'xxxx.xxxx', 'xxxx.xxxx', 'xxxx.xxxx', '.........'],
    gear: ['...xxx...', '.x.xxx.x.', '.xxxxxxx.', 'xxx...xxx', 'xxx...xxx', 'xxx...xxx', '.xxxxxxx.', '.x.xxx.x.', '...xxx...'],
  };
  const FISH = {
    map: ['.....y.y.....', '..y.yyyyy.y..', '...yyyyyyyy..', 'o.yyyyyywkyy.', 'ooyyyyyywkyyy', 'ooyyyyyyyyyyr', 'o.yyyyyyyyyy.', '..yyllllllly.', '...yylllllyy.', '..y.yyyyy.y..', '.....y.y.....'],
    pal: { y: '#ffd166', l: '#fff1cf', k: '#14141f', w: '#ffffff', o: '#c9861a', r: '#e2453c' },
  };
  function svgMap(map, pal, cls) {
    const w = map[0].length, h = map.length;
    let r = '';
    map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') r += `<rect x="${x}" y="${y}" width="1.02" height="1.02"${pal ? ` fill="${pal[ch]}"` : ''}/>`; }));
    return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true"${pal ? '' : ' fill="currentColor"'}>${r}</svg>`;
  }

  let toastTimer;
  window.UI = {
    icon: (name) => svgMap(ICONS[name] || ICONS.x, null, 'ico'),
    fish: (cls = 'fish-art') => svgMap(FISH.map, FISH.pal, cls),
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    toast(msg, ms = 3200) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.hidden = false;
      t.classList.remove('in'); void t.offsetWidth; t.classList.add('in');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
    },
    // Promise-based confirm dialog in the site's style.
    confirm(title, body, okLabel = 'OK', danger = false) {
      return new Promise((resolve) => {
        const m = document.getElementById('confirmModal');
        m.querySelector('h3').textContent = title;
        m.querySelector('p').textContent = body;
        const ok = m.querySelector('[data-ok]'), cancel = m.querySelector('[data-cancel]');
        ok.textContent = okLabel; ok.classList.toggle('danger', danger);
        m.hidden = false; ok.focus();
        const done = (v) => { m.hidden = true; ok.onclick = cancel.onclick = m.onclick = document.onkeydown = null; resolve(v); };
        ok.onclick = () => done(true);
        cancel.onclick = () => done(false);
        m.onclick = (e) => { if (e.target === m) done(false); };
        document.onkeydown = (e) => { if (e.key === 'Escape') done(false); };
      });
    },
  };
})();

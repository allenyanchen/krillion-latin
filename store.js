// Krillion Latin: profile, sets and stats, plus shared UI helpers.
// Signed out: everything lives in this browser (localStorage).
// Signed in (Supabase Auth): name, character, stats and your sets sync to your account.
(() => {
  'use strict';
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));

  // One shared Supabase client for auth, database and realtime.
  const cfg = window.KRILLION_CONFIG || {};
  const SB = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
    : null;
  window.SB = SB;
  const homeUrl = () => location.origin + location.pathname;

  let user = null;          // Supabase user when signed in
  let cloudSets = [];       // your sets from the database
  let cloudStats = null;    // your stats from the database
  let cloudLoaded = false;
  let pushTimer = null;

  const rowToSet = (r) => ({ id: r.id, title: r.title, description: r.description || '', questions: r.questions || [], builtIn: false, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at), cloud: true });
  const fail = (what, error) => { if (error) { console.warn(what, error); emit('error', `Couldn’t ${what}. Check your connection and try again.`); } };

  function schedulePushProfile() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const p = Store.profile();
      const { error } = await SB.from('profiles').upsert({ id: user.id, name: p.name, look: p.look, stats: cloudStats || {}, updated_at: new Date().toISOString() });
      fail('save your profile', error);
    }, 600);
  }

  async function loadCloud() {
    const u = user;
    if (!u) return;
    cloudLoaded = false; emit('sets');
    const [prof, sets] = await Promise.all([
      SB.from('profiles').select('*').eq('id', u.id).maybeSingle(),
      SB.from('sets').select('*').eq('owner', u.id).order('updated_at', { ascending: false }),
    ]);
    if (!user || user.id !== u.id) return; // signed out (or switched accounts) meanwhile
    fail('load your profile', prof.error); fail('load your sets', sets.error);
    if (prof.data) {
      if (prof.data.name) put('kl-name', prof.data.name);
      if (prof.data.look) put('kl-look', Scene.normLook(prof.data.look));
      cloudStats = { games: 0, wins: 0, correct: 0, ...(prof.data.stats || {}) };
    } else if (!prof.error) {
      // First sign-in: start the account from this browser's profile.
      const meta = u.user_metadata || {};
      if (!get('kl-name', '')) put('kl-name', String(meta.full_name || meta.name || '').split(' ')[0].slice(0, 14));
      cloudStats = { games: 0, wins: 0, correct: 0, ...get('kl-stats', {}) };
      schedulePushProfile();
    }
    if (sets.error) return; // don't offer imports if we couldn't see what's already in the account
    cloudSets = (sets.data || []).map(rowToSet);
    cloudLoaded = true;
    emit('profile'); emit('stats'); emit('sets');
    const pending = Store.localOnlySets(true);
    if (pending.length) emit('import', pending);
  }

  // A set saved in this browser is "compatible" if it has a title and every question has text and a correct answer.
  function isCompatible(s) {
    return s && typeof s.title === 'string' && s.title.trim() && Array.isArray(s.questions) && s.questions.length &&
      s.questions.every((q) => q && typeof q.q === 'string' && Array.isArray(q.answers) && Number.isInteger(q.correct) && typeof q.answers[q.correct] === 'string' && q.answers[q.correct].trim());
  }
  // Content fingerprint, so a set already in your account isn't offered again.
  function signature(s) {
    const text = String(s.title).trim().toLowerCase() + '|' + JSON.stringify(s.questions.map((q) => [String(q.q).trim(), q.focus || '', q.answers.map((a) => String(a).trim()), q.correct]));
    let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36) + text.length;
  }

  window.Store = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },

    // ----- account -----
    online: !!SB,
    user: () => user,
    cloudLoaded: () => cloudLoaded,
    signInGoogle() {
      return SB.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: homeUrl(), queryParams: { prompt: 'select_account' } } });
    },
    signInEmail(email) {
      return SB.auth.signInWithOtp({ email, options: { emailRedirectTo: homeUrl() } });
    },
    async signOut() { await SB.auth.signOut(); },

    // ----- profile -----
    profile() {
      return {
        name: get('kl-name', ''),
        look: Scene.normLook(get('kl-look', { c: Math.floor(Math.random() * Scene.COLORS.length), h: 'laurel', e: 'dot' })),
      };
    },
    setName(n) { put('kl-name', String(n).trim().slice(0, 14)); emit('profile'); schedulePushProfile(); },
    setLook(l) { put('kl-look', Scene.normLook(l)); emit('profile'); schedulePushProfile(); },

    // ----- sets -----
    customSets() { return user ? cloudSets : get('kl-sets', []).filter((s) => s && s.id && Array.isArray(s.questions)); },
    sets() { return [...window.BUILTIN_SETS, ...this.customSets()]; },
    getSet(id) { return this.sets().find((s) => s.id === id) || null; },
    saveSet(set) {
      const now = Date.now();
      set.builtIn = false; set.updatedAt = now; set.createdAt = set.createdAt || now;
      if (user) {
        if (!set.id || !set.cloud) set.id = uuid();
        set.cloud = true;
        const i = cloudSets.findIndex((s) => s.id === set.id);
        if (i >= 0) cloudSets[i] = set; else cloudSets.unshift(set);
        SB.from('sets').upsert({ id: set.id, title: set.title, description: set.description, questions: set.questions, updated_at: new Date(now).toISOString() })
          .then(({ error }) => fail('save your set', error));
      } else {
        const list = get('kl-sets', []);
        if (!set.id) set.id = 'set-' + uid();
        const i = list.findIndex((s) => s.id === set.id);
        if (i >= 0) list[i] = set; else list.unshift(set);
        put('kl-sets', list);
      }
      emit('sets');
      return set;
    },
    deleteSet(id) {
      if (user) {
        cloudSets = cloudSets.filter((s) => s.id !== id);
        SB.from('sets').delete().eq('id', id).then(({ error }) => fail('delete your set', error));
      } else put('kl-sets', get('kl-sets', []).filter((s) => s.id !== id));
      emit('sets');
    },
    // Sets saved in this browser that are valid and not already in your account.
    // skipDeclined: leave out ones you said "not now" to (used for the automatic prompt).
    localOnlySets(skipDeclined) {
      if (!user || !cloudLoaded) return [];
      const inAccount = new Set(cloudSets.map(signature));
      const declined = new Set(skipDeclined ? get('kl-import-skip-' + user.id, []) : []);
      return get('kl-sets', []).filter((s) => isCompatible(s) && !inAccount.has(signature(s)) && !declined.has(signature(s)));
    },
    // Move the chosen browser sets into your account; remember the rest as "not now".
    async importLocal(ids, offered) {
      if (!user) return 0;
      const local = get('kl-sets', []);
      const chosen = local.filter((s) => ids.includes(s.id));
      const skipped = (offered || []).filter((s) => !ids.includes(s.id)).map(signature);
      if (skipped.length) put('kl-import-skip-' + user.id, [...new Set([...get('kl-import-skip-' + user.id, []), ...skipped])]);
      if (!chosen.length) return 0;
      const rows = chosen.map((s) => ({ id: uuid(), title: s.title.trim(), description: s.description || '', questions: s.questions }));
      const { error } = await SB.from('sets').insert(rows);
      if (error) { fail('move your sets', error); return 0; }
      put('kl-sets', local.filter((s) => !ids.includes(s.id)));
      await loadCloud();
      return rows.length;
    },

    // ----- stats -----
    stats() { return { games: 0, wins: 0, correct: 0, ...(user && cloudStats ? cloudStats : get('kl-stats', {})) }; },
    bump(k, n = 1) {
      if (user && cloudStats) { cloudStats[k] = (cloudStats[k] || 0) + n; schedulePushProfile(); }
      else { const s = { ...get('kl-stats', {}) }; s[k] = (s[k] || 0) + n; put('kl-stats', s); }
      emit('stats');
    },
  };

  if (SB) {
    SB.auth.onAuthStateChange((event, session) => {
      const next = session ? session.user : null;
      if ((next && next.id) === (user && user.id)) { user = next; return; }
      user = next;
      cloudSets = []; cloudStats = null; cloudLoaded = false;
      // Don't await Supabase calls inside this callback (supabase-js recommendation).
      setTimeout(() => { if (user) loadCloud(); emit('auth', event); emit('sets'); emit('stats'); }, 0);
    });
  }

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

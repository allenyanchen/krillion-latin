// Krillion Latin: game page (Pufferfish Party).
// The host's browser runs the game and broadcasts the state; players send "answer" / "pass".
// Messages go through Supabase Realtime (online), or BroadcastChannel (local test mode).
window.Game = (() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = UI.esc;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  const cfg = window.KRILLION_CONFIG || {};
  const ONLINE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const V = (document.querySelector('script[src*="game.js"]')?.src.split('?v=')[1]) || '1';

  // Tuning
  const FUSE_STEP = 2000, FUSE_MIN = 5000; // per-holder timer starts at the host's setting and shrinks 2s each turn
  const IDLE_CLOSE = 60 * 60 * 1000;      // close a room after 1 hour with no activity
  const WRONG_PENALTY = 4000, DROP_TIME = 750, THROW_TIME = 700;
  const POP_PAUSE = 3200, INTRO_TIME = 1600, POINTS = 100;

  function getId() {
    try {
      let id = sessionStorage.getItem('kl-id');
      if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('kl-id', id); }
      return id;
    } catch (e) { return Math.random().toString(36).slice(2, 10); }
  }

  const me = { id: getId(), name: '', host: false, look: Scene.normLook({}) };
  let transport = null, S = null, code = '', roster = [], active = false;
  let localFuseEnd = 0, lastQSerial = -1, lastEvN = -1, joinTimer = null, prevRoster = null, hostGoneTimer = null, joinedAt = 0;

  // ---------- Answers ----------
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/j/g, 'i').replace(/[^a-z0-9]/g, '');
  function isCorrect(given, q) {
    const ok = [q.answers[q.correct], ...(q.accept || [])];
    return ok.some((a) => norm(a) && norm(a) === norm(given));
  }
  const encQ = (q) => btoa(unescape(encodeURIComponent(JSON.stringify(q))));
  const decQ = (x) => { try { return JSON.parse(decodeURIComponent(escape(atob(x)))); } catch (e) { return null; } };

  // ---------- Transports ----------
  const info = () => ({ id: me.id, name: me.name, host: me.host, look: me.look });
  let sbClient = null;

  function supabaseTransport(room, h) {
    sbClient = sbClient || window.SB || window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const ch = sbClient.channel('krillion-puffer-' + room, { config: { broadcast: { self: true }, presence: { key: me.id } } });
    let ready = false;
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => h.onMessage(payload));
    ch.on('presence', { event: 'sync' }, () => h.onRoster(Object.values(ch.presenceState()).map((a) => a[0]).filter(Boolean)));
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') { ready = true; await ch.track(info()); h.onReady(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') UI.toast('Connection problem (' + status + '). Check your internet.');
    });
    return {
      send: (msg) => ch.send({ type: 'broadcast', event: 'msg', payload: msg }),
      update: () => { if (ready) ch.track(info()); },
      close: () => { try { ch.untrack(); sbClient.removeChannel(ch); } catch (e) {} },
    };
  }

  function localTransport(room, h) {
    const bc = new BroadcastChannel('krillion-puffer-' + room);
    const peers = new Map();
    let lastKey = '';
    const emit = () => {
      const t = Date.now();
      for (const [id, p] of peers) if (t - p.seen > 5000) peers.delete(id);
      const list = [info(), ...[...peers.values()].map((p) => p.info)];
      const key = JSON.stringify(list.slice().sort((a, b) => (a.id < b.id ? -1 : 1)));
      if (key !== lastKey) { lastKey = key; h.onRoster(list); }
    };
    bc.onmessage = ({ data }) => {
      if (data.kind === 'hb') { peers.set(data.info.id, { info: data.info, seen: Date.now() }); emit(); }
      else if (data.kind === 'bye') { peers.delete(data.id); emit(); }
      else if (data.kind === 'msg') h.onMessage(data.msg);
    };
    const beat = () => bc.postMessage({ kind: 'hb', info: info() });
    const bye = () => bc.postMessage({ kind: 'bye', id: me.id });
    beat();
    const iv = setInterval(() => { beat(); emit(); }, 1500);
    window.addEventListener('beforeunload', bye);
    setTimeout(() => { emit(); h.onReady(); }, 50);
    return {
      send: (msg) => { bc.postMessage({ kind: 'msg', msg }); setTimeout(() => h.onMessage(msg), 0); },
      update: () => { beat(); emit(); },
      close: () => { bye(); clearInterval(iv); window.removeEventListener('beforeunload', bye); bc.close(); },
    };
  }

  function connect(room) {
    const handlers = {
      onMessage: (m) => {
        if (!active) return;
        if (m.t === 'chat') { if (me.host) Host.touch(); return Chat.add(m); }
        if (m.t === 'pos') return Factory.onPos(m);
        if (m.t === 'fx-qa') return Factory.onQuestion(m);
        if (m.t === 'closed' && !me.host) return roomClosed();
        if (m.t === 'reject') { rejectedIds.add(m.id); if (m.id === me.id && !me.host) rejected(m.reason); return; }
        if (me.host) Host.onMessage(m);
        else if (m.t === 'state' && m.s.code === code) {
          clearTimeout(joinTimer);
          onState(m.s);
          if (joining) { joining = false; if (readyCb) readyCb(); } // only now show the game page
        }
      },
      onRoster: (list) => {
        if (!active) return;
        if (joining) {
          const mine = me.name.trim().toLowerCase();
          if (list.some((r) => r.id !== me.id && String(r.name || '').trim().toLowerCase() === mine)) return rejected('name');
        }
        rosterNotices(list);
        roster = list;
        if (me.host) Host.onRoster(); else watchHost();
      },
      onReady: () => { if (me.host && active) Host.broadcast(); },
    };
    transport = ONLINE ? supabaseTransport(room, handlers) : localTransport(room, handlers);
  }

  function rosterNotices(list) {
    const ids = new Set(list.map((r) => r.id));
    if (prevRoster && Date.now() - joinedAt > 2500) {
      // Wait a moment before announcing a join, in case the host turns them away (duplicate name).
      for (const r of list) if (!prevRoster.has(r.id) && r.id !== me.id) {
        setTimeout(() => { if (active && !rejectedIds.has(r.id) && roster.some((x) => x.id === r.id)) Chat.system(`${r.name} joined`); }, 1200);
      }
      for (const [id, name] of prevRoster) if (!ids.has(id) && !rejectedIds.has(id)) Chat.system(`${name} left`);
    }
    prevRoster = new Map(list.map((r) => [r.id, r.name]));
  }

  function watchHost() {
    if (roster.some((r) => r.host)) { clearTimeout(hostGoneTimer); hostGoneTimer = null; return; }
    if (S && !hostGoneTimer) {
      hostGoneTimer = setTimeout(() => {
        hostGoneTimer = null;
        if (active && !roster.some((r) => r.host)) {
          UI.confirm('The host left', 'This game has ended because the host left the room.', 'Back to dashboard').then((ok) => { if (ok && active) location.hash = '#/dashboard'; });
        }
      }, 5000);
    }
  }

  // ---------- Host (authoritative game logic) ----------
  const Host = {
    deck: [], src: [], cur: null, fuseEnd: 0, timer: null, evN: 0, turns: 0, iv: [],

    init(set, opts) {
      this.src = set.questions.filter((q) => q.answers && q.answers[q.correct]);
      this.evN = 0; this.turns = 0;
      S = {
        phase: 'lobby', code, hostId: me.id, hostPlays: opts.hostPlays !== false, lives: opts.lives || 3, fuseStart: opts.fuseStart || 15,
        setTitle: set.title, setCount: this.src.length,
        players: [], holder: null, awaitingPass: false, qx: null, qSerial: 0,
        fuseLeft: 0, fuseTotal: 1, round: 0, feed: [], result: null, ev: null, winner: null,
      };
      S.mode = opts.mode === 'factory' ? 'factory' : 'puffer';
      if (S.mode === 'factory') S.fx = Factory.host.initState(opts);
      this.colorMap = new Map(); this.lastActive = Date.now();
      this.firstSeen = new Map([[me.id, 0]]); this.seenN = 1; this.rejected = new Set();
      this.iv = [setInterval(() => this.tick(), 200), setInterval(() => this.broadcast(), 3000)];
    },
    stop() { this.iv.forEach(clearInterval); this.iv = []; clearTimeout(this.timer); },
    player(id) { return S.players.find((p) => p.id === id); },
    alive() { return S.players.filter((p) => !p.out && !p.gone); },
    log(t) { S.feed.unshift(t); S.feed = S.feed.slice(0, 30); },
    ev(type, extra = {}) { S.ev = { n: ++this.evN, type, ...extra }; },

    broadcast() {
      if (!S || !active) return;
      S.fuseLeft = S.phase === 'play' ? Math.max(0, this.fuseEnd - Date.now()) : 0;
      if (S.fx) S.fx.hostNow = Date.now();
      if (transport) transport.send({ t: 'state', s: S });
      onState(S);
    },

    touch() { this.lastActive = Date.now(); },

    rebuildLobby() {
      S.players = roster
        .filter((r) => !this.rejected.has(r.id) && (S.hostPlays || !r.host))
        .map((r) => ({ id: r.id, name: r.name, look: { ...r.look }, want: r.look.c, lives: S.lives, score: 0, out: false, gone: false }));
      this.assignColors();
      if (S.mode === 'factory') Factory.host.assignSections(S);
    },

    // Every player gets a different color. Players who already own a color keep it,
    // anyone asking for a free color gets it, and newcomers with a taken color get the next free one.
    assignColors() {
      const prev = this.colorMap, next = new Map(), used = new Set();
      const ps = S.players.filter((p) => !p.gone);
      const keep = ps.filter((p) => prev.has(p.id) && prev.get(p.id) === p.want);
      const change = ps.filter((p) => prev.has(p.id) && prev.get(p.id) !== p.want);
      const fresh = ps.filter((p) => !prev.has(p.id));
      const free = () => Scene.COLORS.findIndex((_, i) => !used.has(i));
      for (const p of [...keep, ...change, ...fresh]) {
        let c = p.want;
        if (used.has(c)) c = prev.has(p.id) && !used.has(prev.get(p.id)) ? prev.get(p.id) : free();
        if (c < 0) c = p.want; // more players than colors: allow a repeat
        used.add(c); next.set(p.id, c);
        p.look = { ...p.look, c };
      }
      this.colorMap = next;
    },

    // Names must be unique: whoever arrived later with a taken name is turned away.
    checkNames() {
      for (const r of roster) if (!this.firstSeen.has(r.id)) this.firstSeen.set(r.id, this.seenN++);
      const byName = new Map();
      const ordered = roster.filter((r) => !this.rejected.has(r.id)).sort((a, b) => this.firstSeen.get(a.id) - this.firstSeen.get(b.id));
      for (const r of ordered) {
        const key = String(r.name || '').trim().toLowerCase();
        if (byName.has(key)) { this.rejected.add(r.id); transport.send({ t: 'reject', id: r.id, reason: 'name' }); }
        else byName.set(key, r.id);
      }
    },

    onRoster() {
      this.checkNames();
      if (S.phase === 'lobby') this.rebuildLobby();
      else {
        for (const p of S.players) {
          const r = roster.find((x) => x.id === p.id);
          if (r) { p.gone = false; p.look = { ...r.look }; p.want = r.look.c; }
          else if (!p.gone) { p.gone = true; this.log(`🔌 ${p.name} left`); }
        }
        if (S.phase === 'play' && this.player(S.holder)?.gone) {
          const a = this.alive();
          if (a.length >= 2) { const to = pick(a).id; this.ev('drop', { to }); this.giveTo(to, DROP_TIME); }
        }
        if (['intro', 'play', 'pop'].includes(S.phase) && this.alive().length < 2) this.finish();
        this.assignColors();
      }
      this.touch();
      this.broadcast();
    },

    onMessage(m) {
      this.touch();
      if (S.mode === 'factory') return Factory.host.onMessage(S, m);
      if (m.t === 'answer') this.answer(m.from, m.text);
      else if (m.t === 'pass') this.pass(m.from, m.to);
    },

    configure(o) {
      if (S.phase !== 'lobby') return;
      this.touch();
      if (o.fx) { Object.assign(S.fx, o.fx); delete o.fx; }
      Object.assign(S, o);
      this.rebuildLobby();
      this.broadcast();
    },

    start() {
      this.rebuildLobby();
      if (S.mode === 'factory') {
        if (!S.players.length) return UI.toast('The factory needs at least 1 player.');
        S.feed = []; S.winner = null;
        Factory.host.start(S, this.src);
        this.log('🏭 The factory is open!');
        this.touch();
        this.broadcast();
        return;
      }
      if (S.players.length < 2) return UI.toast('Pufferfish Party needs at least 2 players.');
      this.deck = shuffle(this.src.slice());
      this.turns = 0;
      Object.assign(S, { phase: 'intro', round: 0, feed: [], winner: null, holder: null, result: null, qx: null });
      this.log('🎉 The party has started!');
      this.ev('start');
      this.broadcast();
      clearTimeout(this.timer);
      this.touch();
      this.timer = setTimeout(() => this.newRound(pick(this.alive()).id), INTRO_TIME);
    },

    newRound(id) {
      S.round++;
      S.phase = 'play';
      this.ev('drop', { to: id });
      this.giveTo(id, DROP_TIME);
      this.broadcast();
    },

    // New holder: fresh (but ever shorter) timer, plus time for the drop/throw animation.
    giveTo(id, animTime) {
      S.holder = id; S.awaitingPass = false; S.result = null;
      S.fuseTotal = Math.max(FUSE_MIN, S.fuseStart * 1000 - this.turns * FUSE_STEP);
      this.turns++;
      this.fuseEnd = Date.now() + S.fuseTotal + animTime;
      this.nextQuestion();
    },

    nextQuestion() {
      if (!this.deck.length) this.deck = shuffle(this.src.slice());
      this.cur = this.deck.pop();
      S.qx = encQ({ q: this.cur.q, tag: this.cur.tag || '', focus: this.cur.focus || '' });
      S.qSerial++;
    },

    answer(from, text) {
      if (S.phase !== 'play' || from !== S.holder || S.awaitingPass) return;
      const p = this.player(from);
      const right = this.cur.answers[this.cur.correct];
      if (isCorrect(text, this.cur)) {
        p.score += POINTS;
        S.awaitingPass = true;
        S.result = { id: from, ok: true, answer: right };
        this.log(`✅ ${p.name} got it right`);
        this.ev('right', { id: from });
      } else {
        this.fuseEnd -= WRONG_PENALTY;
        S.result = { id: from, ok: false, prompt: this.cur.focus || this.cur.q, answer: right };
        this.log(`❌ ${p.name} missed one (−4s)`);
        this.ev('wrong', { id: from });
        this.nextQuestion();
      }
      this.broadcast();
    },

    pass(from, to) {
      if (S.phase !== 'play' || from !== S.holder || !S.awaitingPass || from === to) return;
      const t = this.player(to);
      if (!t || t.out || t.gone) return;
      this.log(`🐡 ${this.player(from).name} threw to ${t.name}`);
      this.ev('throw', { from, to });
      this.giveTo(to, THROW_TIME);
      this.broadcast();
    },

    tick() {
      if (!S) return;
      if (S.mode === 'factory') Factory.host.tick(S, () => this.broadcast());
      else if (S.phase === 'play' && Date.now() >= this.fuseEnd) this.pop();
      if (Date.now() - this.lastActive > IDLE_CLOSE) this.closeRoom();
    },

    closeRoom() {
      if (transport) transport.send({ t: 'closed' });
      roomClosed();
    },

    pop() {
      const p = this.player(S.holder);
      S.phase = 'pop';
      S.awaitingPass = false;
      if (p) {
        p.lives = Math.max(0, p.lives - 1);
        if (p.lives === 0) p.out = true;
        this.turns = 0; // timer goes back to 30s after someone loses a heart
        this.log(`💥 POP! ${p.name} ${p.out ? 'is out!' : 'lost a heart'}`);
        this.ev('pop', { id: p.id, out: p.out });
      }
      this.broadcast();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (S.phase !== 'pop') return;
        if (this.alive().length < 2) { this.finish(); this.broadcast(); return; }
        this.newRound(pick(this.alive()).id);
      }, POP_PAUSE);
    },

    finish() {
      const a = this.alive();
      const ranked = S.players.slice().sort((x, y) => (y.lives - x.lives) || (y.score - x.score));
      S.winner = (a[0] || ranked[0] || {}).id || null;
      S.phase = 'over';
      S.holder = null;
      clearTimeout(this.timer);
      this.ev('win', { id: S.winner });
    },

    backToLobby() {
      Object.assign(S, { phase: 'lobby', feed: [], result: null, winner: null, holder: null, qx: null });
      this.rebuildLobby();
      if (S.mode === 'factory') Factory.host.reset(S);
      this.ev('lobby');
      this.broadcast();
    },
  };

  function act(msg) { if (transport) transport.send({ ...msg, from: me.id }); }

  // ---------- Background music ----------
  const Music = {
    VOL: 0.12, DUCK_VOL: 0.04,
    el: null, fade: 0, duckTimer: null,
    get() {
      if (!this.el) { this.el = new Audio(`sounds/the_mountain-retro-game-593063.mp3?v=${V}`); this.el.loop = true; this.el.preload = 'auto'; this.el.volume = this.VOL; }
      return this.el;
    },
    start() { const a = this.get(); a.volume = this.VOL; a.play().catch(() => {}); },
    stop() { if (this.el) { this.el.pause(); clearInterval(this.fade); clearTimeout(this.duckTimer); } },
    rampTo(v, ms) {
      clearInterval(this.fade);
      const a = this.get(), from = a.volume, t0 = performance.now();
      this.fade = setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / ms);
        a.volume = from + (v - from) * p;
        if (p >= 1) clearInterval(this.fade);
      }, 30);
    },
    duck(sec) {
      clearTimeout(this.duckTimer);
      this.rampTo(this.DUCK_VOL, 120);
      this.duckTimer = setTimeout(() => this.rampTo(this.VOL, 600), sec * 1000);
    },
  };

  // ---------- "fahh" + vine boom when someone loses a heart ----------
  const Fah = {
    fah: null, boom: null, raf: 0,
    // Called from a click (Host / Join) so the browser allows sound later.
    unlock() {
      if (!this.fah) {
        this.fah = new Audio(`sounds/faaah.mp3?v=${V}`);
        this.boom = new Audio(`sounds/vine-boom.mp3?v=${V}`);
      }
      for (const a of [this.fah, this.boom]) {
        a.preload = 'auto'; a.muted = true;
        a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
      }
    },
    play() {
      if (!this.fah) return;
      Music.duck(isFinite(this.fah.duration) ? this.fah.duration : 2);
      for (const a of [this.fah, this.boom]) {
        try { a.currentTime = 0; a.muted = false; a.play().catch(() => {}); } catch (e) {}
      }
      const d = this.fah.duration;
      this.show(isFinite(d) && d > 0 ? d : 2);
    },
    show(dur) {
      const el = $('#fah');
      cancelAnimationFrame(this.raf);
      el.hidden = false;
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / (dur * 1000));
        el.textContent = 'fa' + 'h'.repeat(1 + Math.floor(p * 7));
        el.style.transform = `translate(-50%, -50%) scale(${0.55 + p * 0.95}) rotate(${Math.sin(p * 18) * 2.5}deg)`;
        el.style.opacity = p < 0.06 ? p / 0.06 : p > 0.7 ? (1 - p) / 0.3 : 1;
        if (p < 1) this.raf = requestAnimationFrame(step); else el.hidden = true;
      };
      step();
    },
  };

  // ---------- Chat + updates panel ----------
  const Chat = {
    lastSent: 0, unread: 0, tab: 'chat',
    reset() { $('#chatList').innerHTML = ''; this.unread = 0; this.badge(); this.setTab('chat'); },
    send(text) {
      text = String(text).trim().slice(0, 200);
      if (!text || !transport) return false;
      const t = Date.now();
      if (t - this.lastSent < 700) { UI.toast('Slow down a little!'); return false; }
      this.lastSent = t;
      transport.send({ t: 'chat', id: me.id, name: me.name, c: me.look.c, text, ts: t });
      return true;
    },
    append(html, cls) {
      const list = $('#chatList');
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      const li = document.createElement('li');
      li.className = cls; li.innerHTML = html;
      list.appendChild(li);
      while (list.children.length > 150) list.removeChild(list.firstChild);
      if (nearBottom || cls.includes('mine')) list.scrollTop = list.scrollHeight;
      $('#chatEmpty').hidden = true;
    },
    add(m) {
      const color = Scene.COLORS[Math.max(0, Math.min(Scene.COLORS.length - 1, m.c | 0))];
      const time = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      this.append(`<span class="who" style="color:${color}">${esc(m.name)}</span><span class="when">${time}</span><p>${esc(m.text)}</p>`, m.id === me.id ? 'msg mine' : 'msg');
      if (m.id !== me.id && (this.tab !== 'chat' || !panelOpen())) { this.unread++; this.badge(); }
    },
    system(text) { this.append(`<p>${esc(text)}</p>`, 'sys'); },
    badge() {
      for (const el of document.querySelectorAll('.chat-badge')) { el.textContent = this.unread > 9 ? '9+' : this.unread; el.hidden = !this.unread; }
    },
    setTab(t) {
      this.tab = t;
      document.querySelectorAll('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
      $('#chatPane').hidden = t !== 'chat';
      $('#feedPane').hidden = t !== 'feed';
      if (t === 'chat') { this.unread = 0; this.badge(); const l = $('#chatList'); l.scrollTop = l.scrollHeight; }
    },
  };
  const panelOpen = () => !$('#gamePage').classList.contains('panel-closed');

  // ---------- State → UI ----------
  function onState(s) {
    if (!active) return;
    if (s.mode === 'factory') {
      S = s;
      Scene.setAim(false); Scene.setActive(false);
      adoptColor(s);
      Factory.onState(s);
      paintDrawer();
      renderUI();
      return;
    }
    S = s;
    Scene.setActive(true);
    localFuseEnd = me.host ? Host.fuseEnd : Date.now() + s.fuseLeft;
    Scene.setPhase(s.phase);
    adoptColor(s);
    handleEvent(s);
    Scene.setPlayers(s.players.map((p) => ({ ...p, isMe: p.id === me.id })), { maxLives: s.lives });
    if (s.phase === 'play') {
      Scene.setTimer(localFuseEnd, s.fuseTotal);
      if (!Scene.fishBusy() && Scene.fishTarget() !== s.holder) Scene.fishHold(s.holder);
    }
    paintDrawer();
    renderUI();
  }

  function handleEvent(s) {
    const ev = s.ev;
    if (lastEvN === -1 && !me.host) { lastEvN = ev ? ev.n : 0; return; } // first state: don't replay old events
    if (!ev || ev.n <= lastEvN) return;
    lastEvN = ev.n;
    const playing = s.players.some((p) => p.id === me.id);
    switch (ev.type) {
      case 'drop': Scene.fishDrop(ev.to); break;
      case 'throw': Scene.fishThrow(ev.from, ev.to); break;
      case 'wrong':
        Scene.wrong(ev.id);
        if (ev.id === me.id) { const c = $('#turnCard'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
        break;
      case 'right': Scene.right(ev.id); if (ev.id === me.id) Store.bump('correct'); break;
      case 'pop': Scene.pop(ev.id, ev.out); Fah.play(); break;
      case 'win':
        Scene.celebrate(ev.id);
        if (playing) { Store.bump('games'); if (ev.id === me.id) Store.bump('wins'); }
        break;
    }
  }

  function renderUI() {
    const s = S;
    const page = $('#gamePage');
    if (!s) { page.dataset.phase = 'connecting'; updateInsets(); return; }
    page.dataset.phase = s.phase;
    const factory = s.mode === 'factory';
    page.dataset.mode = factory ? 'factory' : 'puffer';
    $('#gMode').textContent = factory ? '🏭 Factory' : '🐡 Pufferfish Party';
    $('#gSet').textContent = factory ? 'Factory' : s.setTitle || 'Pufferfish Party';
    $('#gCode').textContent = s.code;
    $('#gPlayers').textContent = `${s.players.length} player${s.players.length === 1 ? '' : 's'}`;
    $('#gRound').textContent = factory ? Factory.statusText(s) : s.phase === 'lobby' ? 'Lobby' : s.round ? `Round ${s.round}` : 'Starting';
    $('#feed').innerHTML = s.feed.length ? s.feed.map((f) => `<li>${esc(f)}</li>`).join('') : '<li class="empty">Game updates will show up here.</li>';

    // Lobby card
    $('#lobbyCode').textContent = s.code;
    $('#hostControls').hidden = !me.host;
    $('#guestWait').hidden = me.host;
    if (me.host) {
      document.querySelectorAll('#heartsSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === s.lives));
      document.querySelectorAll('#timerSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === s.fuseStart));
      $('#playToggle').checked = s.hostPlays;
      $('#pufferOpts').hidden = factory; $('#factoryOpts').hidden = !factory;
      if (factory) {
        const f = s.fx;
        document.querySelectorAll('#fxWinSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.winMode));
        document.querySelectorAll('#fxMinSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === f.minutes));
        document.querySelectorAll('#fxGoalSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === f.goal));
        document.querySelectorAll('#fxGainSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === (f.gain || 100)));
        $('#fxMinRow').hidden = f.winMode !== 'time'; $('#fxGoalRow').hidden = f.winMode !== 'money';
      }
      const need = factory ? 1 : 2, ok = s.players.length >= need;
      $('#startBtn').disabled = !ok;
      $('#startHint').textContent = ok ? (factory ? `${s.players.length} worker${s.players.length === 1 ? '' : 's'} ready` : `${s.players.length} players ready · ${s.setCount} questions`) : `Waiting for at least ${need} players…`;
    }
    if (factory) { renderOver(s); return; }

    const holder = s.players.find((p) => p.id === s.holder);
    const mine = s.phase === 'play' && s.holder === me.id;

    // Turn card: only the holder ever sees the question.
    const answering = mine && !s.awaitingPass;
    $('#turnCard').hidden = !answering;
    if (answering) {
      const q = decQ(s.qx);
      if (q) {
        $('#qTag').textContent = q.tag || '';
        $('#qText').textContent = q.q;
        $('#qFocus').textContent = q.focus || '';
        $('#qFocus').hidden = !q.focus;
      }
      if (s.qSerial !== lastQSerial) { $('#answerIn').value = ''; setTimeout(() => $('#answerIn').focus(), 30); }
      if ($('#drawer').classList.contains('open')) toggleDrawer(false);
      const r = s.result, fb = $('#feedback');
      if (r && r.id === me.id && !r.ok) { fb.className = 'feedback bad'; fb.innerHTML = `✗ <b>${esc(r.prompt)}</b> → <b>${esc(r.answer)}</b>. Try this one!`; }
      else { fb.className = 'feedback'; fb.textContent = 'Type your answer and press Enter'; }
    }
    lastQSerial = s.qSerial;
    $('#aimHint').hidden = !(mine && s.awaitingPass);
    if (mine && s.awaitingPass) $('#aimHint').innerHTML = `✓ <b>${esc(s.result ? s.result.answer : '')}</b> is right! Click a player to throw the pufferfish`;
    Scene.setAim(mine && s.awaitingPass, (to) => { Scene.fishThrow(me.id, to); act({ t: 'pass', to }); });

    let pill = '';
    if (s.phase === 'intro') pill = '🐡 Get ready…';
    else if (s.phase === 'pop') pill = '💥 POP!';
    else if (s.phase === 'play' && !mine && holder) pill = s.awaitingPass ? `🎯 ${esc(holder.name)} is aiming…` : `✍️ ${esc(holder.name)} is answering…`;
    $('#statusPill').innerHTML = pill;
    $('#statusPill').hidden = !pill;

    renderOver(s);
    updateInsets();
  }

  function renderOver(s) {
    const factory = s.mode === 'factory';
    if (factory) { $('#turnCard').hidden = true; $('#aimHint').hidden = true; $('#statusPill').hidden = true; }
    const over = s.phase === 'over';
    $('#overModal').hidden = !over;
    if (over && factory) {
      const w = s.players.find((p) => p.id === s.winner);
      const cash = (p) => '$' + Math.round(s.fx.money[p.id] || 0).toLocaleString();
      $('#winnerName').textContent = w ? (w.id === me.id ? 'You win!' : `${w.name} wins!`) : 'Game over';
      $('#overSub').textContent = s.fx.winMode === 'money' ? `first to $${s.fx.goal.toLocaleString()}` : 'richest factory when time ran out';
      const ranked = s.players.slice().sort((a, b) => (s.fx.money[b.id] || 0) - (s.fx.money[a.id] || 0));
      $('#standings').innerHTML = ranked.map((p) => `<li><span>${esc(p.name)}${p.id === me.id ? ' (you)' : ''}</span><span>${cash(p)}</span></li>`).join('');
      $('#againBtn').hidden = !me.host; $('#againWait').hidden = me.host;
    } else if (over) {
      $('#overSub').textContent = 'survived the Pufferfish Party';
      const w = s.players.find((p) => p.id === s.winner);
      $('#winnerName').textContent = w ? (w.id === me.id ? 'You win!' : `${w.name} wins!`) : 'Game over';
      const ranked = s.players.slice().sort((a, b) => (a.id === s.winner ? -1 : b.id === s.winner ? 1 : (b.lives - a.lives) || (b.score - a.score)));
      $('#standings').innerHTML = ranked.map((p) => `<li><span>${esc(p.name)}${p.id === me.id ? ' (you)' : ''}</span><span>${p.score} pts</span></li>`).join('');
      $('#againBtn').hidden = !me.host;
      $('#againWait').hidden = me.host;
    }
    updateInsets();
  }

  function updateInsets() {
    if (!active || (S && S.mode === 'factory')) return;
    const page = $('#gamePage');
    const wide = window.innerWidth >= 900;
    const phase = page.dataset.phase;
    const top = $('#gTop').offsetHeight + 12;
    const side = $('#sidePanel');
    const r = wide && panelOpen() ? side.offsetWidth + 28 : 0;
    const lobby = phase === 'lobby' || phase === 'connecting';
    let l = 0, t = top;
    if (lobby) { if (wide) l = $('#lobbyCard').offsetWidth + 28; else t = top + $('#lobbyCard').offsetHeight + 8; }
    let b = ['play', 'pop', 'intro'].includes(phase) ? (wide ? 200 : 230) : 76;
    if ($('#drawer').classList.contains('open')) b = Math.max(b, $('#drawerBody').offsetHeight + 70);
    Scene.setInsets({ r, b, l, t });
  }
  window.addEventListener('resize', updateInsets);

  // ---------- Customize drawer (color for your current character) ----------
  function buildDrawer() {
    $('#drawerColors').innerHTML = Scene.COLORS.map((c, i) => `<button class="swatch" data-c="${i}" style="--sw:${c}" aria-label="Color ${i + 1}"></button>`).join('');
    $('#drawerColors').onclick = (e) => {
      const b = e.target.closest('.swatch'); if (!b || b.disabled) return;
      me.look.c = Number(b.dataset.c);
      lastColorPick = Date.now();
      Store.setLook(me.look);
      paintDrawer();
      if (transport) transport.update();
    };
    $('#drawerHandle').onclick = () => toggleDrawer(!$('#drawer').classList.contains('open'));
  }
  let lastColorPick = 0;
  function toggleDrawer(open) {
    $('#drawer').classList.toggle('open', open);
    $('#drawerHandle').setAttribute('aria-expanded', open);
    updateInsets();
  }
  function paintDrawer() {
    Scene.drawPreview($('#drawerPreview'), me.look);
    const takenBy = new Map();
    if (S) for (const p of S.players) if (p.id !== me.id && !p.gone) takenBy.set(p.look.c, p.name);
    document.querySelectorAll('#drawerColors .swatch').forEach((b) => {
      const c = Number(b.dataset.c), owner = takenBy.get(c);
      b.classList.toggle('on', c === me.look.c);
      b.classList.toggle('taken', !!owner);
      b.disabled = !!owner;
      b.title = owner ? `Taken by ${owner}` : '';
    });
  }

  // If the host gave us a different color (ours was taken), switch to it.
  function adoptColor(s) {
    const mine = s.players.find((p) => p.id === me.id);
    if (Date.now() - lastColorPick < 2500) return; // our own change hasn't reached the host yet
    if (mine && mine.look && mine.look.c !== me.look.c) {
      me.look = { ...me.look, c: mine.look.c };
      Store.setLook(me.look);
      if (transport) transport.update();
      UI.toast('Someone already had your color, so you got a new one.');
    }
  }

  let failCb = null, readyCb = null, joining = false;
  const rejectedIds = new Set();
  function rejected(reason) {
    if (!active) return;
    const c = code;
    joining = false;
    Game.leave();
    if (failCb) failCb(reason, c);
  }

  function roomClosed() {
    if (!active) return;
    location.hash = '#/dashboard';
    UI.confirm('Room closed', 'This room closed after 1 hour with no activity.', 'OK');
  }

  // ---------- Lifecycle ----------
  function begin() {
    const p = Store.profile();
    me.name = p.name; me.look = p.look;
    active = true; S = null; roster = []; prevRoster = null; lastEvN = -1; lastQSerial = -1; joinedAt = Date.now();
    Factory.deactivate();
    $('#gamePage').dataset.mode = 'puffer';
    Scene.reset();
    Chat.reset();
    paintDrawer();
    $('#drawer').classList.remove('open');
    $('#overModal').hidden = true;
    $('#turnCard').hidden = true; $('#aimHint').hidden = true; $('#statusPill').hidden = true;
    Fah.unlock();
    Music.start();
    renderUI();
  }

  function makeCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; return Array.from({ length: 4 }, () => pick(A)).join(''); }

  return {
    online: ONLINE,
    isActive: () => active,
    debugState: () => S, // read-only peek used by automated tests
    code: () => code,
    host(set, opts) {
      me.host = true; code = makeCode();
      begin();
      Host.init(set, opts);
      connect(code);
      onState(S);
      Chat.system(`Room ${code} created. Share the code to invite players!`);
    },
    // Connects in the background; onReady fires once the room is confirmed and your name is free.
    join(c, onFail, onReady) {
      me.host = false; code = c; failCb = onFail; readyCb = onReady; joining = true;
      begin();
      connect(code);
      Chat.system(`Joining room ${code}…`);
      joinTimer = setTimeout(() => { if (joining && active) { joining = false; this.leave(); onFail && onFail('missing', c); } }, 8000);
    },
    leave() {
      if (!active) return;
      active = false;
      clearTimeout(joinTimer); clearTimeout(hostGoneTimer);
      if (me.host) Host.stop();
      if (transport) transport.close();
      transport = null; S = null; me.host = false;
      Scene.setAim(false);
      Scene.setActive(false);
      Factory.deactivate();
      Music.stop();
      $('#fah').hidden = true;
    },
    init() {
      buildDrawer();
      Factory.attach({ me, send: (msg) => { if (transport) transport.send(msg); } });
      const fxSeg = (sel, key, num) => document.querySelectorAll(sel + ' button').forEach((b) => (b.onclick = () => Host.configure({ fx: { [key]: num ? Number(b.dataset.v) : b.dataset.v } })));
      fxSeg('#fxWinSeg', 'winMode', false); fxSeg('#fxMinSeg', 'minutes', true); fxSeg('#fxGoalSeg', 'goal', true); fxSeg('#fxGainSeg', 'gain', true);
      $('#answerForm').onsubmit = (e) => {
        e.preventDefault();
        const v = $('#answerIn').value.trim();
        if (!v) return;
        act({ t: 'answer', text: v });
        $('#answerIn').value = '';
      };
      $('#chatForm').onsubmit = (e) => {
        e.preventDefault();
        if (Chat.send($('#chatIn').value)) $('#chatIn').value = '';
      };
      $('#sideTabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) Chat.setTab(b.dataset.tab); };
      const togglePanel = (open) => {
        const page = $('#gamePage');
        page.classList.toggle('panel-closed', !open);
        if (open && Chat.tab === 'chat') { Chat.unread = 0; Chat.badge(); }
        setTimeout(updateInsets, 10);
      };
      $('#panelClose').onclick = () => togglePanel(false);
      $('#chatToggle').onclick = () => togglePanel(!panelOpen());
      if (window.innerWidth < 900) $('#gamePage').classList.add('panel-closed');
      document.querySelectorAll('#heartsSeg button').forEach((b) => (b.onclick = () => Host.configure({ lives: Number(b.dataset.v) })));
      document.querySelectorAll('#timerSeg button').forEach((b) => (b.onclick = () => Host.configure({ fuseStart: Number(b.dataset.v) })));
      $('#playToggle').onchange = () => Host.configure({ hostPlays: $('#playToggle').checked });
      $('#startBtn').onclick = () => Host.start();
      $('#againBtn').onclick = () => Host.backToLobby();
      const copy = async () => {
        const url = `${location.origin}${location.pathname}#/join/${code}`;
        try { await navigator.clipboard.writeText(url); UI.toast('Invite link copied!'); } catch (e) { UI.toast(url, 8000); }
      };
      $('#copyLink').onclick = copy; $('#copyLink2').onclick = copy;
      Scene.init($('#scene'));
    },
  };
})();

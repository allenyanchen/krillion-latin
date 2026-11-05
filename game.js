// Krillion Latin: Pufferfish Party (Subjunctive Set)
// The host's browser runs the game and broadcasts the state; players send "answer" / "pass".
// Messages go through Supabase Realtime (online), or BroadcastChannel (local test mode).
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  const QS = window.SUBJUNCTIVE_SET;
  const cfg = window.KRILLION_CONFIG || {};
  const ONLINE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  // Tuning
  // Each holder gets a fresh timer. It starts at 30s and shrinks 1.5s per turn, down to 5s.
  const FUSE_START = 30000, FUSE_STEP = 1500, FUSE_MIN = 5000;
  const THROW_TIME = 700;
  const WRONG_PENALTY = 4000;
  const DROP_TIME = 750;
  const POP_PAUSE = 3200;
  const INTRO_TIME = 1600;
  const POINTS = 100;
  const SET_NAMES = { both: 'Present + Imperfect', present: 'Present subjunctive', imperfect: 'Imperfect subjunctive' };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  function getId() {
    try {
      let id = sessionStorage.getItem('kl-id');
      if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('kl-id', id); }
      return id;
    } catch (e) { return Math.random().toString(36).slice(2, 10); }
  }

  const me = {
    id: getId(),
    name: store.get('kl-name', ''),
    host: false,
    look: Scene.normLook(store.get('kl-look', { c: Math.floor(Math.random() * Scene.COLORS.length), h: 'laurel', e: 'dot' })),
  };
  let transport = null, S = null, code = '', roster = [];
  let localFuseEnd = 0, lastQSerial = -1, lastEvN = -1, joinTimer = null;

  // ---------- Answers ----------
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/j/g, 'i').replace(/[^a-z]/g, '');
  function isCorrect(given, q) {
    const ok = [q.answer];
    if (q.voice === 'passive' && /ris$/.test(q.answer)) ok.push(q.answer.replace(/ris$/, 're'));
    return ok.some((a) => norm(a) === norm(given));
  }
  const encQ = (q) => btoa(JSON.stringify(q));
  const decQ = (x) => { try { return JSON.parse(atob(x)); } catch (e) { return null; } };

  // ---------- Transports ----------
  const info = () => ({ id: me.id, name: me.name, host: me.host, look: me.look });

  function supabaseTransport(room, h) {
    const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const ch = client.channel('krillion-puffer-' + room, { config: { broadcast: { self: true }, presence: { key: me.id } } });
    let ready = false;
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => h.onMessage(payload));
    ch.on('presence', { event: 'sync' }, () => h.onRoster(Object.values(ch.presenceState()).map((a) => a[0]).filter(Boolean)));
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') { ready = true; await ch.track(info()); h.onReady(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Connection problem (' + status + '). Check your internet.');
    });
    return {
      send: (msg) => ch.send({ type: 'broadcast', event: 'msg', payload: msg }),
      update: () => { if (ready) ch.track(info()); },
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
    beat(); setInterval(() => { beat(); emit(); }, 1500);
    window.addEventListener('beforeunload', () => bc.postMessage({ kind: 'bye', id: me.id }));
    setTimeout(() => { emit(); h.onReady(); }, 50);
    return {
      send: (msg) => { bc.postMessage({ kind: 'msg', msg }); setTimeout(() => h.onMessage(msg), 0); },
      update: () => { beat(); emit(); },
    };
  }

  function connect(room) {
    const handlers = {
      onMessage: (m) => { if (me.host) Host.onMessage(m); else if (m.t === 'state' && m.s.code === code) { clearTimeout(joinTimer); onState(m.s); } },
      onRoster: (list) => { roster = list; if (me.host) Host.onRoster(); else watchHost(); },
      onReady: () => { if (me.host) Host.broadcast(); },
    };
    transport = ONLINE ? supabaseTransport(room, handlers) : localTransport(room, handlers);
  }

  let hostGoneTimer = null;
  function watchHost() {
    if (roster.some((r) => r.host)) { clearTimeout(hostGoneTimer); hostGoneTimer = null; return; }
    if (S && !hostGoneTimer) {
      hostGoneTimer = setTimeout(() => {
        hostGoneTimer = null;
        if (!roster.some((r) => r.host)) toast('The host left the game. Refresh to start a new room.', 10000);
      }, 8000);
    }
  }

  // ---------- Host (authoritative game logic) ----------
  const Host = {
    deck: [], src: [], cur: null, fuseEnd: 0, timer: null, evN: 0, turns: 0,

    init() {
      S = {
        phase: 'lobby', code, hostId: me.id, hostPlays: true, set: 'both', lives: 3,
        players: [], holder: null, awaitingPass: false, qx: null, qSerial: 0,
        fuseLeft: 0, fuseTotal: 1, round: 0, feed: [], result: null, ev: null, winner: null,
      };
      setInterval(() => this.tick(), 200);
      setInterval(() => this.broadcast(), 3000);
    },
    player(id) { return S.players.find((p) => p.id === id); },
    alive() { return S.players.filter((p) => !p.out && !p.gone); },
    log(t) { S.feed.unshift(t); S.feed = S.feed.slice(0, 5); },
    ev(type, extra = {}) { S.ev = { n: ++this.evN, type, ...extra }; },

    broadcast() {
      if (!S) return;
      S.fuseLeft = S.phase === 'play' ? Math.max(0, this.fuseEnd - Date.now()) : 0;
      if (transport) transport.send({ t: 'state', s: S });
      onState(S);
    },

    rebuildLobby() {
      S.players = roster
        .filter((r) => S.hostPlays || !r.host)
        .map((r) => ({ id: r.id, name: r.name, look: r.look, lives: S.lives, score: 0, out: false, gone: false }));
    },

    onRoster() {
      if (S.phase === 'lobby') this.rebuildLobby();
      else {
        for (const p of S.players) {
          const r = roster.find((x) => x.id === p.id);
          if (r) { p.gone = false; p.look = r.look; }
          else if (!p.gone) { p.gone = true; this.log(`🔌 ${p.name} left`); }
        }
        if (S.phase === 'play' && this.player(S.holder)?.gone) {
          const a = this.alive();
          if (a.length >= 2) { const to = pick(a).id; this.ev('drop', { to }); this.giveTo(to, DROP_TIME); }
        }
        if (['intro', 'play', 'pop'].includes(S.phase) && this.alive().length < 2) this.finish();
      }
      this.broadcast();
    },

    onMessage(m) {
      if (m.t === 'answer') this.answer(m.from, m.text);
      else if (m.t === 'pass') this.pass(m.from, m.to);
    },

    configure(o) {
      if (S.phase !== 'lobby') return;
      Object.assign(S, o);
      this.rebuildLobby();
      this.broadcast();
    },

    start() {
      this.rebuildLobby();
      if (S.players.length < 2) return toast('Pufferfish Party needs at least 2 players.');
      this.src = S.set === 'both' ? [...QS.present, ...QS.imperfect] : QS[S.set];
      this.deck = shuffle(this.src.slice());
      this.turns = 0;
      Object.assign(S, { phase: 'intro', round: 0, feed: [], winner: null, holder: null, result: null, qx: null });
      this.log('🎉 The party has started!');
      this.ev('start');
      this.broadcast();
      clearTimeout(this.timer);
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
      S.fuseTotal = Math.max(FUSE_MIN, FUSE_START - this.turns * FUSE_STEP);
      this.turns++;
      this.fuseEnd = Date.now() + S.fuseTotal + animTime;
      this.nextQuestion();
    },

    nextQuestion() {
      if (!this.deck.length) this.deck = shuffle(this.src.slice());
      this.cur = this.deck.pop();
      S.qx = encQ({ verb: this.cur.verb, tense: this.cur.tense, voice: this.cur.voice });
      S.qSerial++;
    },

    answer(from, text) {
      if (S.phase !== 'play' || from !== S.holder || S.awaitingPass) return;
      const p = this.player(from);
      if (isCorrect(text, this.cur)) {
        p.score += POINTS;
        S.awaitingPass = true;
        S.result = { id: from, ok: true, answer: this.cur.answer };
        this.log(`✅ ${p.name} got it right`);
        this.ev('right', { id: from });
      } else {
        this.fuseEnd -= WRONG_PENALTY;
        S.result = { id: from, ok: false, verb: this.cur.verb, answer: this.cur.answer };
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

    tick() { if (S && S.phase === 'play' && Date.now() >= this.fuseEnd) this.pop(); },

    pop() {
      const p = this.player(S.holder);
      S.phase = 'pop';
      S.awaitingPass = false;
      if (p) {
        p.lives = Math.max(0, p.lives - 1);
        if (p.lives === 0) p.out = true;
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
      this.ev('lobby');
      this.broadcast();
    },
  };

  function act(msg) { transport.send({ ...msg, from: me.id }); }

  // ---------- State → UI ----------
  function onState(s) {
    S = s;
    localFuseEnd = me.host ? Host.fuseEnd : Date.now() + s.fuseLeft;
    Scene.setPhase(s.phase);
    handleEvent(s);
    Scene.setPlayers(s.players.map((p) => ({ ...p, isMe: p.id === me.id })), { maxLives: s.lives });
    if (s.phase === 'play') {
      Scene.setTimer(localFuseEnd, s.fuseTotal);
      if (!Scene.fishBusy() && Scene.fishTarget() !== s.holder) Scene.fishHold(s.holder);
    }
    renderUI();
  }

  function handleEvent(s) {
    const ev = s.ev;
    if (lastEvN === -1 && !me.host) { lastEvN = ev ? ev.n : 0; return; } // first state: don't replay old events
    if (!ev) return;
    if (ev.n <= lastEvN) return;
    lastEvN = ev.n;
    switch (ev.type) {
      case 'drop': Scene.fishDrop(ev.to); break;
      case 'throw': Scene.fishThrow(ev.from, ev.to); break;
      case 'wrong':
        Scene.wrong(ev.id);
        if (ev.id === me.id) { const c = $('#turnCard'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
        break;
      case 'right': Scene.right(ev.id); break;
      case 'pop': Scene.pop(ev.id, ev.out); break;
      case 'win': Scene.celebrate(ev.id); break;
    }
  }

  function setView(v) { if (document.body.dataset.view !== v) $('#panel').scrollTop = 0; document.body.dataset.view = v; }

  function renderUI() {
    const s = S;
    if (!s) {
      setView('home');
      Scene.setPlayers([{ id: me.id, name: me.name || 'You', look: me.look, isMe: true }]);
      return updateInsets();
    }
    if (s.phase === 'lobby') {
      setView('lobby');
      $('#lobbyCode').textContent = s.code;
      $('#pCount').textContent = s.players.length;
      $('#hostSettings').hidden = !me.host;
      $('#guestWait').hidden = me.host;
      if (me.host) {
        if (document.activeElement !== $('#setSel')) $('#setSel').value = s.set;
        if (document.activeElement !== $('#livesSel')) $('#livesSel').value = String(s.lives);
        $('#playToggle').checked = s.hostPlays;
        const ok = s.players.length >= 2;
        $('#startBtn').disabled = !ok;
        $('#startHint').textContent = ok ? `${s.players.length} players ready` : 'Need at least 2 players. Share the code!';
      }
      $('#overModal').hidden = true;
      Scene.setAim(false);
      return updateInsets();
    }

    setView('game');
    const holder = s.players.find((p) => p.id === s.holder);
    const mine = s.phase === 'play' && s.holder === me.id;
    $('#hudInfo').innerHTML = `<b>Room ${esc(s.code)}</b> · Round ${s.round} · ${SET_NAMES[s.set]}`;
    $('#feed').innerHTML = s.feed.map((f) => `<li>${esc(f)}</li>`).join('');

    // Turn card: only the holder ever sees the question.
    const answering = mine && !s.awaitingPass;
    $('#turnCard').hidden = !answering;
    $('#aimHint').hidden = !(mine && s.awaitingPass);
    if (answering) {
      const q = decQ(s.qx);
      if (q) {
        $('#qKind').textContent = `${q.tense} ${q.voice} subjunctive`;
        $('#qVerb').textContent = q.verb;
      }
      if (s.qSerial !== lastQSerial) {
        $('#answerIn').value = '';
        setTimeout(() => $('#answerIn').focus(), 30);
      }
      const r = s.result;
      const fb = $('#feedback');
      if (r && r.id === me.id && !r.ok) { fb.className = 'feedback bad'; fb.innerHTML = `✗ <b>${esc(r.verb)}</b> → <b>${esc(r.answer)}</b>. Try this one!`; }
      else { fb.className = 'feedback'; fb.textContent = 'Type the subjunctive form and press Enter'; }
    }
    lastQSerial = s.qSerial;
    if (mine && s.awaitingPass) {
      $('#aimHint').innerHTML = `✓ <b>${esc(s.result ? s.result.answer : '')}</b> is right! Aim and click a player to throw the pufferfish`;
    }
    Scene.setAim(mine && s.awaitingPass, (to) => {
      Scene.fishThrow(me.id, to);
      act({ t: 'pass', to });
    });

    // Status pill for everyone else
    let pill = '';
    if (s.phase === 'intro') pill = '🐡 Get ready…';
    else if (s.phase === 'pop') pill = '💥 POP!';
    else if (s.phase === 'play' && !mine && holder) pill = s.awaitingPass ? `🎯 ${esc(holder.name)} is aiming…` : `✍️ ${esc(holder.name)} is answering…`;
    $('#statusPill').innerHTML = pill;
    $('#statusPill').hidden = !pill;

    // Game over
    const over = s.phase === 'over';
    $('#overModal').hidden = !over;
    if (over) {
      const w = s.players.find((p) => p.id === s.winner);
      $('#winnerName').textContent = w ? (w.id === me.id ? 'You win!' : `${w.name} wins!`) : 'Game over';
      const ranked = s.players.slice().sort((a, b) => (a.id === s.winner ? -1 : b.id === s.winner ? 1 : (b.lives - a.lives) || (b.score - a.score)));
      $('#standings').innerHTML = ranked.map((p) => `<li><span>${esc(p.name)}</span><span>${p.score} pts</span></li>`).join('');
      $('#againBtn').hidden = !me.host;
      $('#againWait').hidden = me.host;
    }
    updateInsets();
  }

  function updateInsets() {
    const view = document.body.dataset.view;
    const wide = window.innerWidth >= 760;
    const panel = $('#panel');
    const panelOn = view === 'home' || view === 'lobby';
    let r = 0, b = 0;
    if (panelOn) { if (wide) r = panel.offsetWidth + 24; else b = panel.offsetHeight; }
    else b = wide ? 170 : 200;
    Scene.setInsets(r, b);
  }
  window.addEventListener('resize', updateInsets);

  // ---------- Customization ----------
  function buildCustomizer() {
    const colorRow = $('#colorRow'), hatRow = $('#hatRow'), eyeRow = $('#eyeRow');
    colorRow.innerHTML = Scene.COLORS.map((c, i) => `<button class="swatch" data-c="${i}" style="--sw:${c}" aria-label="Color ${i + 1}"></button>`).join('');
    const opt = (kind, [id, label]) => `<button class="opt" data-${kind}="${id}"><canvas width="22" height="26"></canvas><span>${label}</span></button>`;
    hatRow.innerHTML = Scene.HATS.map((h) => opt('h', h)).join('');
    eyeRow.innerHTML = Scene.EYES.map((e) => opt('e', e)).join('');
    const onPick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c != null) me.look.c = Number(b.dataset.c);
      if (b.dataset.h) me.look.h = b.dataset.h;
      if (b.dataset.e) me.look.e = b.dataset.e;
      lookChanged();
    };
    [colorRow, hatRow, eyeRow].forEach((r) => r.addEventListener('click', onPick));
    paintCustomizer();
  }
  function paintCustomizer() {
    Scene.drawPreview($('#preview'), me.look);
    document.querySelectorAll('#colorRow .swatch').forEach((b) => b.classList.toggle('on', Number(b.dataset.c) === me.look.c));
    document.querySelectorAll('#hatRow .opt').forEach((b) => {
      b.classList.toggle('on', b.dataset.h === me.look.h);
      Scene.drawPreview(b.querySelector('canvas'), { ...me.look, h: b.dataset.h });
    });
    document.querySelectorAll('#eyeRow .opt').forEach((b) => {
      b.classList.toggle('on', b.dataset.e === me.look.e);
      Scene.drawPreview(b.querySelector('canvas'), { ...me.look, e: b.dataset.e, h: 'none' });
    });
  }
  let lookTimer = null;
  function lookChanged() {
    store.set('kl-look', me.look);
    paintCustomizer();
    if (!S) renderUI();
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => transport && transport.update(), 250);
  }

  // ---------- Misc UI ----------
  let toastTimer;
  function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }
  function readName() {
    const n = $('#nameIn').value.trim().slice(0, 14);
    if (!n) { toast('Enter your name first.'); $('#nameIn').focus(); return null; }
    me.name = n; store.set('kl-name', n);
    return n;
  }
  function makeCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; return Array.from({ length: 4 }, () => pick(A)).join(''); }
  function setRoomInUrl() { try { history.replaceState(null, '', `${location.pathname}?room=${code}`); } catch (e) {} }

  $('#nameIn').value = me.name;
  $('#nameIn').addEventListener('input', () => { me.name = $('#nameIn').value.trim().slice(0, 14); if (!S) renderUI(); });

  $('#hostBtn').onclick = () => {
    if (!readName()) return;
    me.host = true; code = makeCode();
    setRoomInUrl();
    Host.init();
    connect(code);
    onState(S);
  };
  $('#joinBtn').onclick = () => {
    if (!readName()) return;
    const c = $('#codeIn').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return toast('Room codes are 4 letters.');
    me.host = false; code = c;
    setRoomInUrl();
    $('#joinBtn').disabled = true; $('#joinBtn').textContent = '…';
    connect(code);
    joinTimer = setTimeout(() => {
      toast(`No room found with code ${code}. Check the code with your host.`, 6000);
      $('#joinBtn').disabled = false; $('#joinBtn').textContent = 'Join';
    }, 8000);
  };
  $('#codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });
  $('#copyLink').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${code}`;
    try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch (e) { toast(url, 8000); }
  };
  $('#setSel').onchange = () => Host.configure({ set: $('#setSel').value });
  $('#livesSel').onchange = () => Host.configure({ lives: Number($('#livesSel').value) });
  $('#playToggle').onchange = () => Host.configure({ hostPlays: $('#playToggle').checked });
  $('#startBtn').onclick = () => Host.start();
  $('#againBtn').onclick = () => Host.backToLobby();
  $('#answerForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#answerIn').value.trim();
    if (!v) return;
    act({ t: 'answer', text: v });
    $('#answerIn').value = '';
  };

  // ---------- Init ----------
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) $('#codeIn').value = roomParam.toUpperCase().slice(0, 4);
  $('#modeNote').innerHTML = ONLINE ? '🌐 Online multiplayer ready' : '🧪 Local test mode: rooms only work between tabs in this browser.';
  Scene.init($('#scene'));
  buildCustomizer();
  renderUI();
  if (document.fonts) document.fonts.ready.then(() => updateInsets());
})();

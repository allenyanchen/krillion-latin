// Krillion Latin: app shell, router and pages.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { esc, icon } = UI;
  const main = $('#main');

  // ---------- helpers ----------
  const HUES = [205, 265, 330, 12, 168, 42, 290, 188];
  const hueOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const validQs = (set) => set.questions.filter((q) => q.answers && String(q.answers[q.correct] || '').trim());
  const promptText = (q) => [q.q, q.focus].filter(Boolean).join(' ');
  function paintIcons(root = document) { $$('[data-icon]', root).forEach((el) => { if (!el.dataset.painted) { el.innerHTML = icon(el.dataset.icon); el.dataset.painted = 1; } }); }
  function drawChar(canvas, look) { if (canvas) Scene.drawPreview(canvas, look || Store.profile().look); }

  function setCard(set) {
    const n = validQs(set).length;
    return `
      <article class="set-card" data-href="#/set/${esc(set.id)}" tabindex="0">
        <div class="set-banner" style="--h:${hueOf(set.id)}">
          <span class="set-count">${n}<small>Qs</small></span>
          <i data-icon="book"></i>
        </div>
        <div class="set-body">
          <h3>${esc(set.title)}</h3>
          <p>${esc(set.description || 'No description yet.')}</p>
          <div class="set-meta"><span class="badge ${set.builtIn ? '' : 'mine'}">${set.builtIn ? 'Built-in' : 'Your set'}</span></div>
        </div>
        <div class="set-actions">
          <a class="btn primary small" href="#/host/${esc(set.id)}"${n ? '' : ' aria-disabled="true"'}><i data-icon="play"></i>Host</a>
          <a class="btn small" href="#/set/${esc(set.id)}">View</a>
        </div>
      </article>`;
  }
  function wireCards(root) {
    $$('.set-card', root).forEach((c) => {
      c.addEventListener('click', (e) => { if (!e.target.closest('a,button')) location.hash = c.dataset.href; });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === c) location.hash = c.dataset.href; });
    });
  }

  // ---------- pages ----------
  const pages = {};

  pages.dashboard = () => {
    const p = Store.profile(), st = Store.stats();
    const mine = Store.customSets();
    const recent = [...mine.slice(0, 2), ...BUILTIN_SETS].slice(0, 3);
    const hour = new Date().getHours();
    const when = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    main.innerHTML = `
      <header class="page-head hero">
        <div>
          <span class="eyebrow">${when}</span>
          <h1>Salve, ${esc(p.name || 'discipule')}!</h1>
          <p class="sub">Ready to practice some Latin? Join a game with a code, or host one for your class.</p>
        </div>
        <canvas class="hero-char" width="22" height="26"></canvas>
      </header>

      <section class="quick">
        <form class="card join-card" id="dashJoin">
          <div class="card-icon teal"><i data-icon="join"></i></div>
          <h3>Join a game</h3>
          <p>Got a code from your host?</p>
          <div class="inline">
            <input class="code-in" maxlength="4" placeholder="CODE" aria-label="Game code" autocomplete="off">
            <button class="btn primary">Join</button>
          </div>
        </form>
        <a class="card action" href="#/sets">
          <div class="card-icon amber"><i data-icon="play"></i></div>
          <h3>Host a game</h3>
          <p>Pick a set and open a room for your class.</p>
          <span class="go">Choose a set →</span>
        </a>
        <a class="card action" href="#/sets/new">
          <div class="card-icon pink"><i data-icon="plus"></i></div>
          <h3>Create a set</h3>
          <p>Write your own questions and answer choices.</p>
          <span class="go">Start writing →</span>
        </a>
      </section>

      <section class="stats">
        <div class="stat"><i data-icon="play"></i><b>${st.games}</b><span>Games played</span></div>
        <div class="stat"><i data-icon="crown"></i><b>${st.wins}</b><span>Wins</span></div>
        <div class="stat"><i data-icon="check"></i><b>${st.correct}</b><span>Correct answers</span></div>
        <div class="stat"><i data-icon="sets"></i><b>${mine.length}</b><span>Sets created</span></div>
      </section>

      <section class="card feature">
        <div class="feature-art" data-fish-big></div>
        <div class="feature-text">
          <span class="eyebrow">Game mode</span>
          <h2>Pufferfish Party</h2>
          <p>Hot potato with a pufferfish. Answer correctly to throw it to someone else, before it pops!</p>
          <ul class="rules">
            <li><i data-icon="check"></i>Type the right answer to earn the throw</li>
            <li><i data-icon="bolt"></i>The timer shrinks 2 seconds every turn, down to 5</li>
            <li><i data-icon="crown"></i>Last player with hearts wins</li>
          </ul>
          <a class="btn primary" href="#/host/subjunctive-all"><i data-icon="play"></i>Host the Subjunctive Set</a>
        </div>
      </section>

      <section>
        <div class="section-head"><h2>Jump back in</h2><a href="#/sets">See all sets →</a></div>
        <div class="set-grid">${recent.map(setCard).join('')}</div>
      </section>`;
    drawChar($('.hero-char', main));
    $('[data-fish-big]', main).innerHTML = UI.fish('fish-art big');
    wireCards(main);
    const f = $('#dashJoin');
    f.onsubmit = (e) => {
      e.preventDefault();
      const c = $('.code-in', f).value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(c)) { UI.toast('Game codes are 4 letters.'); return; }
      location.hash = '#/join/' + c;
    };
  };

  pages.sets = () => {
    let filter = 'all', query = '';
    main.innerHTML = `
      <header class="page-head">
        <div><h1>Sets</h1><p class="sub">Question sets you can host. Make your own any time.</p></div>
        <a class="btn primary" href="#/sets/new"><i data-icon="plus"></i>Create set</a>
      </header>
      <div class="toolbar">
        <label class="search"><i data-icon="search"></i><input id="setSearch" placeholder="Search sets…" aria-label="Search sets"></label>
        <div class="seg" id="setFilter"><button data-f="all" class="on">All</button><button data-f="builtin">Built-in</button><button data-f="mine">My sets</button></div>
      </div>
      <div id="setGrid" class="set-grid"></div>`;
    const draw = () => {
      const list = Store.sets().filter((s) => (filter === 'all' || (filter === 'builtin') === !!s.builtIn) && (!query || (s.title + ' ' + (s.description || '')).toLowerCase().includes(query)));
      const grid = $('#setGrid');
      if (!list.length) {
        grid.innerHTML = `<div class="empty-state card"><div class="card-icon pink"><i data-icon="${filter === 'mine' ? 'plus' : 'search'}"></i></div>
          <h3>${filter === 'mine' && !query ? 'No sets of your own yet' : 'No sets found'}</h3>
          <p>${filter === 'mine' && !query ? 'Create a set with your own questions and answer choices.' : 'Try a different search.'}</p>
          ${filter === 'mine' && !query ? '<a class="btn primary" href="#/sets/new"><i data-icon="plus"></i>Create set</a>' : ''}</div>`;
      } else grid.innerHTML = list.map(setCard).join('');
      paintIcons(grid); wireCards(grid);
    };
    $('#setSearch').oninput = (e) => { query = e.target.value.trim().toLowerCase(); draw(); };
    $('#setFilter').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      filter = b.dataset.f; $$('#setFilter button').forEach((x) => x.classList.toggle('on', x === b)); draw();
    };
    draw();
  };

  pages.set = (id) => {
    const set = Store.getSet(id);
    if (!set) return notFound('That set doesn’t exist.');
    const qs = set.questions;
    main.innerHTML = `
      <a class="back" href="#/sets"><i data-icon="back"></i>All sets</a>
      <header class="set-hero card" style="--h:${hueOf(set.id)}">
        <div class="set-hero-banner"><i data-icon="book"></i></div>
        <div class="set-hero-body">
          <span class="badge ${set.builtIn ? '' : 'mine'}">${set.builtIn ? 'Built-in' : 'Your set'}</span>
          <h1>${esc(set.title)}</h1>
          <p class="sub">${esc(set.description || '')}</p>
          <p class="meta">${plural(qs.length, 'question')}</p>
        </div>
        <div class="set-hero-actions">
          <a class="btn primary" href="#/host/${esc(set.id)}"><i data-icon="play"></i>Host this set</a>
          ${set.builtIn
            ? `<a class="btn" href="#/sets/new/${esc(set.id)}"><i data-icon="copy"></i>Duplicate &amp; edit</a>`
            : `<a class="btn" href="#/edit/${esc(set.id)}"><i data-icon="edit"></i>Edit</a><button class="btn danger-ghost" id="delSet"><i data-icon="trash"></i>Delete</button>`}
        </div>
      </header>
      <div class="section-head"><h2>Questions</h2><span class="note">Correct answers are highlighted</span></div>
      <ol class="q-list">${qs.map((q, i) => `
        <li class="card q-item">
          <div class="q-item-head"><span class="q-num">${i + 1}</span>${q.tag ? `<span class="chip">${esc(q.tag)}</span>` : ''}</div>
          <p class="q-prompt">${esc(q.q)} ${q.focus ? `<b>${esc(q.focus)}</b>` : ''}</p>
          <ul class="ans-grid">${q.answers.map((a, j) => `<li class="${j === q.correct ? 'right' : ''}">${j === q.correct ? icon('check') : '<span class="dot"></span>'}${esc(a)}</li>`).join('')}</ul>
        </li>`).join('')}
      </ol>`;
    const del = $('#delSet');
    if (del) del.onclick = async () => {
      if (await UI.confirm('Delete this set?', `“${set.title}” will be removed from this browser. This can’t be undone.`, 'Delete', true)) {
        Store.deleteSet(set.id); UI.toast('Set deleted'); location.hash = '#/sets';
      }
    };
  };

  // ----- set editor -----
  pages.editor = (id, fromId) => {
    let set;
    if (id) set = JSON.parse(JSON.stringify(Store.getSet(id) || null));
    else if (fromId) {
      const src = Store.getSet(fromId);
      if (src) set = { title: src.title + ' (copy)', description: src.description, questions: src.questions.map((q) => ({ q: promptText(q), tag: q.tag || '', answers: q.answers.slice(), correct: q.correct, accept: (q.accept || []).slice() })) };
    }
    if (id && (!set || set.builtIn)) return notFound('You can only edit your own sets.');
    if (!set) set = { title: '', description: '', questions: [] };
    set.questions = set.questions.map((q) => ({ ...q, q: q.focus ? promptText(q) : q.q, focus: '' }));
    if (!set.questions.length) set.questions.push(blankQ());
    App.dirty = false;

    main.innerHTML = `
      <a class="back" href="${id ? '#/set/' + esc(id) : '#/sets'}"><i data-icon="back"></i>${id ? 'Back to set' : 'All sets'}</a>
      <header class="page-head"><div><h1>${id ? 'Edit set' : 'Create a set'}</h1><p class="sub">Each question can have as many answer choices as you like. Mark the correct one.</p></div></header>
      <section class="card editor-meta">
        <label class="field"><span class="lbl">Title</span><input id="eTitle" maxlength="60" placeholder="e.g. Third declension nouns" value="${esc(set.title)}"></label>
        <label class="field"><span class="lbl">Description <em>(optional)</em></span><textarea id="eDesc" maxlength="160" rows="2" placeholder="What does this set practice?">${esc(set.description || '')}</textarea></label>
      </section>
      <div id="qEdit" class="q-edit-list"></div>
      <button class="add-q" id="addQ"><i data-icon="plus"></i>Add question</button>
      <div class="save-bar card">
        <span id="qCount" class="note"></span>
        <div class="row"><a class="btn" href="${id ? '#/set/' + esc(id) : '#/sets'}">Cancel</a><button class="btn primary" id="saveSet"><i data-icon="check"></i>Save set</button></div>
      </div>`;

    const list = $('#qEdit');
    const touch = () => { App.dirty = true; $('#qCount').textContent = plural(set.questions.length, 'question'); };
    const drawQs = () => {
      list.innerHTML = set.questions.map((q, i) => `
        <div class="card q-edit" data-i="${i}">
          <div class="q-edit-head">
            <span class="q-num">${i + 1}</span>
            <input class="q-tag" data-k="tag" maxlength="40" placeholder="Label (optional), e.g. present active" value="${esc(q.tag || '')}">
            <button class="icon-btn" data-act="dup" title="Duplicate question"><i data-icon="copy"></i></button>
            <button class="icon-btn danger" data-act="del" title="Delete question"><i data-icon="trash"></i></button>
          </div>
          <textarea class="q-text" data-k="q" rows="2" maxlength="300" placeholder="Question">${esc(q.q)}</textarea>
          <div class="ans-list">${q.answers.map((a, j) => `
            <div class="ans-row ${j === q.correct ? 'right' : ''}">
              <label class="radio" title="Mark as correct"><input type="radio" name="c${i}" data-j="${j}" ${j === q.correct ? 'checked' : ''}><span></span></label>
              <input class="ans" data-j="${j}" maxlength="120" placeholder="Answer ${j + 1}" value="${esc(a)}">
              <button class="icon-btn" data-act="delAns" data-j="${j}" title="Remove answer" ${q.answers.length <= 1 ? 'disabled' : ''}><i data-icon="x"></i></button>
            </div>`).join('')}
          </div>
          <div class="q-edit-foot">
            <button class="link" data-act="addAns" ${q.answers.length >= 8 ? 'disabled' : ''}><i data-icon="plus"></i>Add answer</button>
            <span class="note">The selected answer is correct. Pufferfish Party has players type it.</span>
          </div>
        </div>`).join('');
      paintIcons(list);
      $('#qCount').textContent = plural(set.questions.length, 'question');
    };
    list.addEventListener('input', (e) => {
      const card = e.target.closest('.q-edit'); if (!card) return;
      const q = set.questions[card.dataset.i];
      if (e.target.dataset.k) q[e.target.dataset.k] = e.target.value;
      else if (e.target.classList.contains('ans')) q.answers[e.target.dataset.j] = e.target.value;
      card.classList.remove('invalid');
      touch();
    });
    list.addEventListener('change', (e) => {
      if (e.target.type !== 'radio') return;
      const card = e.target.closest('.q-edit'), q = set.questions[card.dataset.i];
      q.correct = Number(e.target.dataset.j);
      $$('.ans-row', card).forEach((r, j) => r.classList.toggle('right', j === q.correct));
      touch();
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const card = b.closest('.q-edit'), i = Number(card.dataset.i), q = set.questions[i];
      const act = b.dataset.act;
      if (act === 'addAns') { q.answers.push(''); drawQs(); $$('.q-edit')[i].querySelectorAll('.ans')[q.answers.length - 1].focus(); }
      if (act === 'delAns') { const j = Number(b.dataset.j); q.answers.splice(j, 1); if (q.correct >= j && q.correct > 0) q.correct--; drawQs(); }
      if (act === 'dup') { set.questions.splice(i + 1, 0, JSON.parse(JSON.stringify(q))); drawQs(); }
      if (act === 'del') { set.questions.splice(i, 1); if (!set.questions.length) set.questions.push(blankQ()); drawQs(); }
      touch();
    });
    $('#addQ').onclick = () => {
      set.questions.push(blankQ()); drawQs(); touch();
      const last = $$('.q-edit').pop(); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('.q-text', last).focus();
    };
    $('#eTitle').oninput = (e) => { set.title = e.target.value; e.target.classList.remove('invalid'); touch(); };
    $('#eDesc').oninput = (e) => { set.description = e.target.value; touch(); };
    $('#saveSet').onclick = () => {
      $$('.invalid').forEach((x) => x.classList.remove('invalid'));
      if (!set.title.trim()) { $('#eTitle').classList.add('invalid'); $('#eTitle').focus(); return UI.toast('Give your set a title.'); }
      const out = [];
      let bad = -1;
      set.questions.forEach((q, i) => {
        const answers = q.answers.map((a) => a.trim());
        const right = answers[q.correct];
        if (!q.q.trim() || !right) { if (bad < 0) bad = i; return; }
        const kept = answers.filter(Boolean);
        out.push({ q: q.q.trim(), tag: (q.tag || '').trim(), focus: '', answers: kept, correct: kept.indexOf(right), accept: q.accept || [] });
      });
      if (bad >= 0) {
        const card = $$('.q-edit')[bad]; card.classList.add('invalid'); card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return UI.toast(`Question ${bad + 1} needs text and a correct answer.`);
      }
      const saved = Store.saveSet({ id: set.id, createdAt: set.createdAt, title: set.title.trim(), description: (set.description || '').trim(), questions: out });
      App.dirty = false;
      UI.toast('Set saved!');
      location.hash = '#/set/' + saved.id;
    };
    drawQs();
  };
  const blankQ = () => ({ q: '', tag: '', answers: ['', '', '', ''], correct: 0, accept: [] });

  // ----- characters -----
  pages.characters = () => {
    const p = Store.profile();
    main.innerHTML = `
      <header class="page-head"><div><h1>Characters</h1><p class="sub">Pick who you play as and make them your own.</p></div></header>
      <div class="char-layout">
        <section>
          <div class="char-grid">
            <button class="card char-card selected" aria-pressed="true">
              <span class="badge mine">Selected</span>
              <canvas class="char-art" width="22" height="26"></canvas>
              <b>Bloop</b><span class="note">The original pixel blob</span>
            </button>
          </div>
          <p class="note more">More characters are on the way.</p>
        </section>
        <section class="card char-stage">
          <div class="stage-art"><canvas id="bigChar" width="22" height="26"></canvas><div class="stage-rock"></div></div>
          <label class="field"><span class="lbl">Display name</span><input id="cName" maxlength="14" placeholder="Your name" value="${esc(p.name)}"></label>
          <span class="lbl">Color</span><div id="cColors" class="swatches"></div>
          <span class="lbl">Hat</span><div id="cHats" class="opts"></div>
          <span class="lbl">Eyes</span><div id="cEyes" class="opts"></div>
        </section>
      </div>`;
    const look = p.look;
    const opt = (kind, [id, label]) => `<button class="opt" data-${kind}="${id}"><canvas width="22" height="26"></canvas><span>${label}</span></button>`;
    $('#cColors').innerHTML = Scene.COLORS.map((c, i) => `<button class="swatch" data-c="${i}" style="--sw:${c}" aria-label="Color ${i + 1}"></button>`).join('');
    $('#cHats').innerHTML = Scene.HATS.map((h) => opt('h', h)).join('');
    $('#cEyes').innerHTML = Scene.EYES.map((e) => opt('e', e)).join('');
    const paint = () => {
      drawChar($('#bigChar'), look); drawChar($('.char-art'), look);
      $$('#cColors .swatch').forEach((b) => b.classList.toggle('on', Number(b.dataset.c) === look.c));
      $$('#cHats .opt').forEach((b) => { b.classList.toggle('on', b.dataset.h === look.h); drawChar($('canvas', b), { ...look, h: b.dataset.h }); });
      $$('#cEyes .opt').forEach((b) => { b.classList.toggle('on', b.dataset.e === look.e); drawChar($('canvas', b), { ...look, e: b.dataset.e, h: 'none' }); });
    };
    main.querySelector('.char-stage').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c != null) look.c = Number(b.dataset.c);
      else if (b.dataset.h) look.h = b.dataset.h;
      else if (b.dataset.e) look.e = b.dataset.e;
      else return;
      Store.setLook(look); paint();
      const art = $('#bigChar'); art.classList.remove('bounce'); void art.offsetWidth; art.classList.add('bounce');
    });
    $('#cName').oninput = (e) => Store.setName(e.target.value);
    paint();
  };

  // ----- join -----
  pages.join = (codeParam) => {
    const p = Store.profile();
    main.innerHTML = `
      <div class="center-page">
        <form class="card join-big" id="joinForm" novalidate>
          <div class="join-fish" data-fish-big></div>
          <h1>Join a game</h1>
          <p class="sub">Enter the 4-letter code shown on the host’s screen.</p>
          <input id="jCode" class="code-big" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="CODE" aria-label="Game code" value="${esc((codeParam || '').toUpperCase().slice(0, 4))}">
          <label class="field"><span class="lbl">Your name</span><input id="jName" maxlength="14" placeholder="e.g. Marcus" value="${esc(p.name)}"></label>
          <a class="you-row" href="#/characters"><canvas width="22" height="26"></canvas><span>Playing as <b>Bloop</b></span><span class="go">Customize →</span></a>
          <p class="form-error" id="jErr" role="alert" hidden></p>
          <button class="btn primary big" id="jGo" disabled><i data-icon="join"></i>Join game</button>
          <p class="note">${Game.online ? '🌐 Online multiplayer' : '🧪 Local test mode: rooms only work between tabs in this browser.'}</p>
        </form>
      </div>`;
    $('[data-fish-big]', main).innerHTML = UI.fish('fish-art big');
    drawChar($('.you-row canvas', main));
    const code = $('#jCode'), name = $('#jName'), go = $('#jGo');
    const check = () => { go.disabled = !(/^[A-Z]{4}$/.test(code.value.trim().toUpperCase()) && name.value.trim()); };
    code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ''); check(); if (code.value.length === 4 && !name.value.trim()) name.focus(); };
    name.oninput = check;
    check();
    (code.value.length === 4 ? (name.value ? go : name) : code).focus();
    if (App.joinError) {
      const err = App.joinError; App.joinError = null;
      $('#jErr').textContent = err.msg; $('#jErr').hidden = false;
      const field = err.field === 'name' ? name : code;
      field.classList.add('invalid'); field.focus(); field.select();
      $('#joinForm').classList.add('shake');
      field.addEventListener('input', () => { field.classList.remove('invalid'); $('#jErr').hidden = true; }, { once: true });
    }
    $('#joinForm').onsubmit = (e) => {
      e.preventDefault();
      if (go.disabled) { $('#joinForm').classList.remove('shake'); void main.offsetWidth; $('#joinForm').classList.add('shake'); return; }
      const c = code.value.trim().toUpperCase();
      Store.setName(name.value);
      const nm = name.value.trim();
      Game.join(c, (reason) => {
        App.joinError = reason === 'name'
          ? { field: 'name', msg: `Someone in this room is already called “${nm}”. Pick a different name.` }
          : { field: 'code', msg: `No game found with code ${c}. Check the code and try again.` };
        location.hash = '#/join/' + c;
      });
      location.hash = '#/game';
    };
  };

  // ----- host setup -----
  pages.host = (id) => {
    const set = Store.getSet(id);
    if (!set) return notFound('That set doesn’t exist.');
    const n = validQs(set).length;
    const p = Store.profile();
    let lives = 3, fuse = 15;
    main.innerHTML = `
      <a class="back" href="#/set/${esc(set.id)}"><i data-icon="back"></i>Back to set</a>
      <header class="page-head"><div><h1>Host a game</h1><p class="sub">Choose a game mode and settings, then open a room.</p></div></header>
      <div class="host-layout">
        <section class="host-left">
          <div class="card host-set" style="--h:${hueOf(set.id)}">
            <div class="set-banner small"><i data-icon="book"></i></div>
            <div><span class="eyebrow">Set</span><h3>${esc(set.title)}</h3><p class="note">${plural(n, 'question')}</p></div>
            <a class="btn small" href="#/sets">Change</a>
          </div>
          <span class="lbl">Game mode</span>
          <div class="modes">
            <button class="card mode selected" aria-pressed="true">
              <div class="mode-art" data-fish-big></div>
              <div><h3>Pufferfish Party</h3><p>Answer to earn the throw. Don’t be holding it when it pops!</p><span class="chip">Typed answers</span></div>
            </button>
            <div class="card mode soon"><div class="mode-art ico-art"><i data-icon="bolt"></i></div><div><h3>Quiz Race</h3><p>Race through multiple-choice answers.</p><span class="chip">Coming soon</span></div></div>
            <div class="card mode soon"><div class="mode-art ico-art"><i data-icon="users"></i></div><div><h3>Team Tide</h3><p>Split into teams and battle it out.</p><span class="chip">Coming soon</span></div></div>
          </div>
        </section>
        <section class="card host-settings">
          <h3>Settings</h3>
          <label class="field"><span class="lbl">Your name</span><input id="hName" maxlength="14" placeholder="e.g. Magister" value="${esc(p.name)}"></label>
          <span class="lbl">Hearts per player</span>
          <div class="seg" id="hLives">${[1, 2, 3, 4, 5].map((v) => `<button data-v="${v}" class="${v === lives ? 'on' : ''}">${v}</button>`).join('')}</div>
          <span class="lbl">Starting timer</span>
          <div class="seg" id="hFuse">${[10, 15, 20, 25, 30].map((v) => `<button data-v="${v}" class="${v === fuse ? 'on' : ''}">${v}s</button>`).join('')}</div>
          <p class="note">Each new holder starts with this much time, minus 2 seconds per turn (never below 5s).</p>
          <label class="toggle"><input type="checkbox" id="hPlay" checked><span></span>I'm playing too</label>
          <p class="note">Turn this off to just run the game from the front of the room.</p>
          <button class="btn primary big" id="hGo" ${n ? '' : 'disabled'}><i data-icon="play"></i>Create room</button>
          ${n ? '' : '<p class="note error">This set has no questions with a correct answer yet.</p>'}
        </section>
      </div>`;
    $('[data-fish-big]', main).innerHTML = UI.fish('fish-art');
    $('#hLives').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; lives = Number(b.dataset.v); $$('#hLives button').forEach((x) => x.classList.toggle('on', x === b)); };
    $('#hFuse').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; fuse = Number(b.dataset.v); $$('#hFuse button').forEach((x) => x.classList.toggle('on', x === b)); };
    $('#hGo').onclick = () => {
      const nm = $('#hName').value.trim();
      if (!nm) { $('#hName').classList.add('invalid'); $('#hName').focus(); return UI.toast('Enter your name first.'); }
      Store.setName(nm);
      Game.host(set, { lives, fuseStart: fuse, hostPlays: $('#hPlay').checked });
      location.hash = '#/game';
    };
  };

  function notFound(msg) {
    main.innerHTML = `<div class="center-page"><div class="card empty-state"><div class="card-icon pink"><i data-icon="x"></i></div><h3>Nothing here</h3><p>${esc(msg)}</p><a class="btn primary" href="#/dashboard">Go to dashboard</a></div></div>`;
  }

  // ---------- router ----------
  const App = (window.App = { dirty: false });
  let current = location.hash;

  async function route() {
    const hash = location.hash || '#/dashboard';
    const [name, a, b] = hash.replace(/^#\/?/, '').split('/');

    // Unsaved editor changes
    if (App.dirty && hash !== current) {
      const ok = await UI.confirm('Leave without saving?', 'Your changes to this set haven’t been saved yet.', 'Leave', true);
      if (!ok) { history.replaceState(null, '', current); return; }
      App.dirty = false;
    }
    current = hash;

    if (name === 'game') {
      if (!Game.isActive()) { location.replace('#/join'); return; }
      $('#app').hidden = true; $('#gamePage').hidden = false;
      document.title = 'Pufferfish Party · Krillion Latin';
      return;
    }
    if (Game.isActive()) Game.leave();
    $('#gamePage').hidden = true; $('#app').hidden = false;

    const nav = { dashboard: 'dashboard', sets: 'sets', set: 'sets', edit: 'sets', host: 'sets', characters: 'characters', join: 'join' }[name] || 'dashboard';
    $$('.nav a').forEach((l) => l.classList.toggle('on', l.dataset.nav === nav));

    if (name === 'sets' && a === 'new') pages.editor(null, b);
    else if (name === 'edit') pages.editor(a);
    else if (name === 'set') pages.set(a);
    else if (name === 'host') pages.host(a);
    else if (pages[name] && !['editor', 'set', 'host'].includes(name)) pages[name](a);
    else pages.dashboard();

    const titles = { sets: 'Sets', set: 'Set', edit: 'Edit set', host: 'Host a game', characters: 'Characters', join: 'Join a game' };
    document.title = (titles[name] ? titles[name] + ' · ' : '') + 'Krillion Latin';
    paintIcons(main);
    main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
    window.scrollTo(0, 0); main.scrollTop = 0;
  }

  function paintMe() {
    const p = Store.profile();
    drawChar($('#meChip'), p.look);
    $('#meName').textContent = p.name || 'Set your name';
  }

  // ---------- boot ----------
  $$('[data-fish]').forEach((el) => (el.innerHTML = UI.fish()));
  paintIcons();
  Game.init();
  Store.on('profile', paintMe);
  paintMe();
  $('#leaveBtn').onclick = async () => {
    if (await UI.confirm('Leave the game?', Game.isActive() && $('#hostControls') && !$('#hostControls').hidden ? 'You’re the host, so the game ends for everyone.' : 'You can rejoin with the same code while the game is running.', 'Leave', true)) location.hash = '#/dashboard';
  };
  $('[data-leave]').onclick = () => (location.hash = '#/dashboard');
  // Old invite links (?room=CODE) still work.
  const legacy = new URLSearchParams(location.search).get('room');
  if (legacy) { history.replaceState(null, '', location.pathname + '#/join/' + legacy.toUpperCase().slice(0, 4)); }
  window.addEventListener('hashchange', route);
  route();
})();

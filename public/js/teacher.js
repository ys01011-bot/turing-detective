// 교사 화면 (T0~T7). 서버가 보내는 room-state(마피아 포함 전체 상태)를 그린다.
(function () {
  const $ = (id) => document.getElementById(id);
  const { esc, avatar } = TD;
  const socket = io({ transports: ['websocket', 'polling'] });

  let R = null; // room-state
  let stateAt = 0;
  let tab = 't1';
  let authed = false;
  let defaults = null;
  let showForm = false;
  let boardMode = 'sorted'; // sorted | all
  let boardGame = 0; // 0 = 전체
  let dragging = false;
  let addresses = [];

  const STATE_LABEL = {
    LOBBY: ['대기실', 'gray'],
    ROLE_REVEAL: ['역할 확인', 'lemon'],
    PLAYING: ['대화 중', 'mint'],
    VOTING: ['투표 중', 'lilac'],
    RESULT: ['결과', 'apricot'],
    CLOSING: ['정리', 'sky'],
  };
  const LABELS = [
    ['experience', '② 경험', '🧭'],
    ['emotion', '③ 감정', '💗'],
    ['responsibility', '④ 책임·행동', '🤝'],
    ['surface', '겉모습·기타', '🔤'],
    ['unclassified', '미분류', '❔'],
  ];
  const CLUES = [
    ['experience', '② 경험'],
    ['emotion', '③ 감정'],
    ['responsibility', '④ 책임'],
  ];

  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
  };
  const ack = (ev, data) => new Promise((res) => socket.emit(ev, data, (r) => res(r || { ok: false })));
  const act = async (ev, data = {}, okMsg) => {
    const r = await ack(ev, { code: R && R.code, ...data });
    if (!r.ok) TD.toast(r.msg || '실행하지 못했어요.', true);
    else if (okMsg) TD.toast(okMsg);
    return r;
  };

  // ── T0 로그인 ─────────────────────────────────
  $('loginMascot').innerHTML = TD.turingi('basic', 110);
  $('headMascot').innerHTML = TD.turingi('basic', 40);
  async function login(pin, silent) {
    const r = await ack('teacher-auth', { pin });
    if (!r.ok) {
      if (!silent) TD.toast(r.msg || 'PIN이 맞지 않아요.', true);
      ss.set('td-pin', null);
      return;
    }
    authed = true;
    defaults = r.defaults;
    ss.set('td-pin', pin);
    $('login').classList.add('hidden');
    $('main').classList.remove('hidden');
    const code = ss.get('td-room');
    if (code) {
      const w = await ack('watch-room', { code });
      if (!w.ok) ss.set('td-room', null);
    }
    if (!R) renderT1();
    setTab(R ? 't2' : 't1');
  }
  $('pinBtn').onclick = () => login($('pinInput').value.trim());
  $('pinInput').onkeydown = (e) => { if (e.key === 'Enter') login($('pinInput').value.trim()); };
  socket.on('connect', () => {
    const pin = ss.get('td-pin');
    if (pin) login(pin, true);
  });
  fetch('/api/addresses').then((r) => r.json()).then((a) => (addresses = a)).catch(() => {});

  // ── 탭 ───────────────────────────────────────
  function setTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('hidden', s.id !== t));
    if (t === 't1') renderT1();
    else render();
  }
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  socket.on('room-state', (st) => {
    const first = !R || R.code !== st.code;
    R = st;
    stateAt = Date.now();
    ss.set('td-room', st.code);
    $('headCode').innerHTML = `방 코드 <b>${st.code}</b>`;
    if (first && tab === 't1') renderT1();
    render();
  });
  socket.on('room-closed', () => {
    R = null;
    ss.set('td-room', null);
    $('headCode').innerHTML = '';
    showForm = false;
    TD.toast('방을 닫고 기록을 지웠어요.');
    setTab('t1');
  });

  function render() {
    if (!R) {
      document.querySelectorAll('#tabs button').forEach((b) => (b.disabled = b.dataset.tab !== 't1'));
      return;
    }
    document.querySelectorAll('#tabs button').forEach((b) => (b.disabled = false));
    renderAlerts();
    if (tab === 't2') renderT2();
    if (tab === 't3') renderT3();
    if (tab === 't4') renderT4();
    if (tab === 't5' && !dragging) renderT5();
    if (tab === 't6') renderT6();
    if (tab === 't7') renderT7();
  }

  function renderAlerts() {
    $('alertBar').innerHTML = R.alerts
      .slice(-4)
      .map((a) => `<div class="alert">⚠️ ${a.groupIdx + 1}모둠 · ${esc(a.text)} <span class="grow"></span><button class="btn soft small" data-dismiss="${a.id}">닫기</button></div>`)
      .join('');
    $('alertBar').querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => act('dismiss-alert', { id: b.dataset.dismiss })));
  }

  const remain = (g) => (g.remainingMs === null || g.remainingMs === undefined ? null : g.paused ? g.remainingMs : Math.max(0, g.remainingMs - (Date.now() - stateAt)));
  const statePill = (g) => {
    const [t, c] = STATE_LABEL[g.state] || [g.state, 'gray'];
    return `<span class="pill ${c} state-pill">${t}${g.game ? ` · ${g.game}판` : ''}${g.state === 'PLAYING' ? ` ${g.round}바퀴` : ''}${g.paused ? ' · ⏸ 멈춤' : ''}</span>`;
  };

  // ── T1 방 만들기 ──────────────────────────────
  function numField(id, label, v, min, max) {
    return `<div><label for="${id}">${label}</label><input id="${id}" type="number" min="${min}" max="${max}" value="${v}" /></div>`;
  }
  function renderT1() {
    const el = $('t1');
    if (R && !showForm) {
      const url = `${location.origin}/?code=${R.code}`;
      const lan = /localhost|127\.0\.0\.1/.test(location.hostname) && addresses.length ? addresses.map((a) => `${a}/?code=${R.code}`) : [];
      el.innerHTML = `<div class="card sky code-show">
          <div class="qr"><img alt="입장 QR 코드" src="/api/qr?text=${encodeURIComponent(lan[0] || url)}" /></div>
          <div class="stack">
            <div class="title muted">방 코드</div>
            <div class="big-code">${R.code}</div>
            <div class="url">${esc(lan[0] || url)}</div>
            ${lan.length ? `<p class="muted small">같은 와이파이의 크롬북은 위 주소로 들어와요. (이 PC에서는 ${esc(url)})</p>` : ''}
            <div class="row">
              <button class="btn soft" id="editSettings" type="button">설정 고치기</button>
              <button class="btn mint" id="goT2" type="button">접속 현황 보기 →</button>
            </div>
          </div>
        </div>`;
      $('editSettings').onclick = () => {
        showForm = true;
        renderT1();
      };
      $('goT2').onclick = () => setTab('t2');
      return;
    }
    const S = R ? R.settings : defaults || {};
    const cfg = R ? R.gameCfg : [];
    const sets = R ? R.sets : null;
    el.innerHTML = `<div class="card stack">
        <h2>${R ? '설정 고치기' : '새 방 만들기'}</h2>
        <div class="form-grid">
          ${R ? '' : `<div><label for="fGroups">모둠 수</label><select id="fGroups">${[1, 2, 3, 4].map((n) => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`}
          ${numField('fSize', '모둠 권장 인원 (3~7, 적어도 시작 가능)', S.groupSize ?? 6, 3, 7)}
          ${numField('fGames', '판 수 (1~3)', S.games ?? 2, 1, 3)}
          ${numField('fRounds', '한 판의 바퀴 수 (1~3)', S.rounds ?? 2, 1, 3)}
          ${numField('fTurn', '턴 제한 시간 (20~60초)', S.turnSec ?? 30, 20, 60)}
          ${numField('fVote', '투표 시간 (60~180초)', S.voteSec ?? 90, 60, 180)}
          ${numField('fLen', '메시지 최대 길이 (40~150자)', S.maxLen ?? 80, 40, 150)}
          <div class="full row">
            <label class="switch"><input type="checkbox" id="fSpell" ${S.spellAI !== false ? 'checked' : ''}/> 맞춤법 자동 보정 (AI 보정)</label>
            <label class="switch muted"><input type="checkbox" id="fChance" ${S.questionChance ? 'checked' : ''}/> 질문 찬스 (선택 기능 · 아직 동작 안 함)</label>
          </div>
        </div>
        <h3>판별 주제·난이도</h3>
        <div class="game-cfg" id="gameCfg"></div>
        <div class="row">
          <button class="btn mint big" id="saveRoom" type="button">${R ? '설정 저장' : '방 만들기'}</button>
          ${R ? '<button class="btn soft" id="cancelEdit" type="button">취소</button>' : ''}
        </div>
      </div>
      ${R ? '' : `<div class="card stack"><h3>만들어 둔 방 다시 열기</h3><div class="row"><input id="fOpen" class="grow" type="text" placeholder="방 코드 6자리" maxlength="6" /><button class="btn soft" id="openRoom" type="button">열기</button></div></div>`}`;
    const paint = (setsList) => {
      $('gameCfg').innerHTML = [0, 1, 2]
        .map((i) => {
          const c = cfg[i] || {};
          const lv = (S.levels || ['Lv2', 'Lv3', 'Lv3'])[i];
          const def = i === 0 ? 'care' : i === 1 ? 'empathy' : 'care';
          const setId = c.setId || def;
          return `<div class="card ${['mint', 'lilac', 'apricot'][i]} stack" data-game="${i}">
            <h3>${i + 1}판</h3>
            <label>주제 세트</label>
            <select class="cfg-set">${setsList.map((s) => `<option value="${s.id}" ${s.id === setId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select>
            <label>AI 난이도</label>
            <select class="cfg-lv">${['Lv1', 'Lv2', 'Lv3'].map((x) => `<option ${x === lv ? 'selected' : ''}>${x}</option>`).join('')}</select>
            <details ${c.custom && c.custom.some((x) => x.question) ? 'open' : ''}><summary class="title">바퀴 질문 직접 입력 (선택)</summary>
              ${[0, 1, 2]
                .map((r) => {
                  const cu = (c.custom && c.custom[r]) || {};
                  const base = (setsList.find((s) => s.id === setId) || setsList[0]).rounds;
                  const b = base[Math.min(r, base.length - 1)];
                  return `<div class="row" style="margin-top:8px"><input class="grow cfg-q" data-r="${r}" type="text" maxlength="80" placeholder="${r + 1}바퀴: ${esc(b.question)}" value="${esc(cu.question || '')}" />
                    <select class="cfg-clue" data-r="${r}" style="width:auto">${CLUES.map(([k, t]) => `<option value="${k}" ${(cu.clue || b.clue) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
                })
                .join('')}
              <p class="muted small">비워 두면 주제 세트의 질문을 써요. 직접 입력하면 고른 단서 유형의 기본 지시·백업을 써요.</p>
            </details>
          </div>`;
        })
        .join('');
      $('gameCfg').querySelectorAll('.cfg-set').forEach((s) => (s.onchange = () => {
        cfg[Number(s.closest('[data-game]').dataset.game)] = { setId: s.value };
        paint(setsList);
      }));
    };
    if (sets) paint(sets);
    else
      fetch('/content/sets')
        .then((r) => r.json())
        .then(paint)
        .catch(() => paint([{ id: 'care', title: '배려', rounds: [{ question: '', clue: 'experience' }] }, { id: 'empathy', title: '공감', rounds: [{ question: '', clue: 'emotion' }] }]));
    $('saveRoom').onclick = saveRoom;
    if ($('cancelEdit')) $('cancelEdit').onclick = () => {
      showForm = false;
      renderT1();
    };
    if ($('openRoom')) $('openRoom').onclick = async () => {
      const r = await ack('watch-room', { code: $('fOpen').value.trim() });
      if (!r.ok) return TD.toast(r.msg || '방을 찾을 수 없어요.', true);
      setTab('t2');
    };
  }
  async function saveRoom() {
    const settings = {
      groupSize: +$('fSize').value,
      games: +$('fGames').value,
      rounds: +$('fRounds').value,
      turnSec: +$('fTurn').value,
      voteSec: +$('fVote').value,
      maxLen: +$('fLen').value,
      spellAI: $('fSpell').checked,
      questionChance: $('fChance').checked,
      levels: [...document.querySelectorAll('.cfg-lv')].map((s) => s.value),
    };
    const gameCfg = [...document.querySelectorAll('#gameCfg [data-game]')].map((card) => {
      const custom = [...card.querySelectorAll('.cfg-q')].map((q) => ({ question: q.value.trim(), clue: card.querySelector(`.cfg-clue[data-r="${q.dataset.r}"]`).value }));
      return { setId: card.querySelector('.cfg-set').value, custom: custom.some((c) => c.question) ? custom : null };
    });
    if (R) {
      const r = await act('update-settings', { settings, gameCfg }, '설정을 저장했어요.');
      if (r.ok) {
        showForm = false;
        renderT1();
      }
      return;
    }
    const r = await ack('create-room', { groupCount: +$('fGroups').value, settings, gameCfg });
    if (!r.ok) return TD.toast(r.msg || '방을 만들지 못했어요.', true);
    showForm = false;
    TD.confetti(40);
  }

  // ── T2 접속 현황 ──────────────────────────────
  function renderT2() {
    const anyLobby = R.groups.some((g) => g.state === 'LOBBY');
    const anyResult = R.groups.some((g) => g.state === 'RESULT' && g.game < R.settings.games);
    $('t2').innerHTML = `<div class="row" style="margin-bottom:14px">
        <h2 class="grow">접속 현황 · ${R.groups.reduce((n, g) => n + g.members.filter((m) => m.connected).length, 0)}명 접속</h2>
        ${anyLobby ? '<button class="btn mint big" data-start="all" type="button">▶ 전체 게임 시작</button>' : ''}
        ${anyResult ? '<button class="btn lilac big" data-start="all" type="button">▶ 전체 다음 판 시작</button>' : ''}
      </div>
      <div class="groups">${R.groups
        .map((g) => {
          const on = g.members.filter((m) => m.connected).length;
          const greeted = g.members.filter((m) => m.greeting).length;
          return `<div class="card gcard ${['mint', 'sky', 'lilac', 'apricot'][g.idx]}">
            <div class="g-title"><h2>${g.idx + 1}모둠</h2>${statePill(g)}<span class="grow"></span><span class="pill gray">접속 ${on}명 (권장 ${R.settings.groupSize})</span><span class="pill gray">인사 ${greeted}/${g.members.length}</span></div>
            ${g.members.length ? '' : '<p class="muted">아직 아무도 없어요.</p>'}
            ${g.members
              .map(
                (m) => `<div class="mem ${m.connected ? '' : 'off'}"><span class="dot ${m.connected ? 'on' : 'off'}" title="${m.connected ? '접속' : '끊김'}"></span>${avatar(m.nick)}<span class="nm">${esc(m.nick)}</span>
                <span class="greet">${m.greeting ? '💬 ' + esc(m.greeting) : '…인사 쓰는 중'}</span>
                ${g.state === 'LOBBY' ? `<select data-move="${m.id}" aria-label="모둠 이동"><option value="">이동</option>${R.groups.filter((x) => x.idx !== g.idx).map((x) => `<option value="${x.idx}">${x.idx + 1}모둠</option>`).join('')}</select>` : ''}
                ${g.state === 'LOBBY' || g.state === 'RESULT' ? `<button class="btn soft small" data-kick="${m.id}" data-nick="${esc(m.nick)}" type="button" title="내보내기">✕</button>` : ''}</div>`
              )
              .join('')}
            ${g.state === 'LOBBY' ? `<button class="btn mint" data-start="${g.idx}" type="button">${g.idx + 1}모둠만 시작</button>` : ''}
            ${g.state === 'RESULT' && g.game < R.settings.games ? `<button class="btn lilac" data-start="${g.idx}" type="button">${g.idx + 1}모둠 ${g.game + 1}판 시작</button>` : ''}
          </div>`;
        })
        .join('')}</div>`;
    bindCommon($('t2'));
    $('t2').querySelectorAll('[data-move]').forEach((s) => (s.onchange = () => s.value !== '' && act('move-player', { playerId: s.dataset.move, toIdx: +s.value })));
    $('t2').querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => confirm(`${b.dataset.nick} 학생을 내보낼까요?`) && act('kick-player', { playerId: b.dataset.kick })));
  }

  function bindCommon(root) {
    root.querySelectorAll('[data-start]').forEach((b) => (b.onclick = async () => {
      const groupIdx = b.dataset.start === 'all' ? 'all' : +b.dataset.start;
      const r = await act('start-game', { groupIdx });
      if (r.ok) {
        if (r.msg) TD.toast(r.msg);
        setTab('t3');
      }
    }));
  }

  // ── T3 진행 모니터링 ───────────────────────────
  function renderT3() {
    const el = $('t3');
    const logs = {};
    el.querySelectorAll('.g-log').forEach((l) => (logs[l.dataset.g] = { top: l.scrollTop, bottom: l.scrollHeight - l.scrollTop - l.clientHeight < 40 }));
    const anyPaused = R.groups.some((g) => g.paused);
    el.innerHTML = `<div class="row" style="margin-bottom:14px">
        <h2 class="grow">진행 모니터링</h2>
        <span class="pill gray">AI 호출 ${R.aiCalls} / ${R.settings.aiCallLimit}</span>
        <button class="btn apricot" data-pause-all="${anyPaused ? 0 : 1}" type="button">${anyPaused ? '▶ 전체 다시 시작' : '⏸ 전체 일시정지'}</button>
        ${R.groups.some((g) => g.state === 'RESULT' && g.game < R.settings.games) ? '<button class="btn lilac" data-start="all" type="button">▶ 전체 다음 판</button>' : ''}
      </div>
      <div class="groups">${R.groups.map(groupMonitor).join('')}</div>`;
    el.querySelectorAll('.g-log').forEach((l) => {
      const s = logs[l.dataset.g];
      l.scrollTop = !s || s.bottom ? l.scrollHeight : s.top;
    });
    bindCommon(el);
    el.querySelector('[data-pause-all]').onclick = (e) => act('pause', { groupIdx: 'all', paused: e.target.dataset.pauseAll === '1' });
    el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
      const g = +b.dataset.g;
      const a = b.dataset.act;
      if (a === 'pause') return act('pause', { groupIdx: g, paused: b.dataset.v === '1' });
      if (a === 'end-vote' && !confirm(`${g + 1}모둠 투표를 지금 마감할까요?`)) return;
      act(a, { groupIdx: g }, { 'redo-turn': '현재 턴을 다시 시작했어요.', 'skip-turn': '턴을 건너뛰었어요.', 'force-backup': '백업 메시지로 바꿨어요.', 'end-vote': '투표를 마감했어요.' }[a]);
    }));
  }

  function groupMonitor(g) {
    const t = g.turn;
    const rem = remain(g);
    const msgs = g.messages.filter((m) => m.game === g.game);
    let turnBox = '';
    if (g.state === 'PLAYING' && t) {
      const ai = t.isMafia
        ? `<div class="small">🤖 AI 문장: ${t.aiReady ? `<b>${esc(t.aiText)}</b> <span class="muted">(${t.aiSource === 'backup' ? '백업' : 'AI'} · ${((t.aiLatency || 0) / 1000).toFixed(1)}초 · 진행 ${t.ghostPos}/${[...(t.aiText || '')].length}자)</span>` : '<span class="muted">만드는 중…</span>'}</div>`
        : '';
      turnBox = `<div class="turn-box"><b>${esc(t.nick)}</b> 차례 (${t.idx + 1}/${t.of})${t.isMafia ? ' <span class="ai-chip">마피아</span>' : ''}${t.sending ? ' · 보내는 중' : ''}${ai}</div>`;
    }
    if (g.state === 'VOTING') turnBox = `<div class="turn-box">🗳 투표 ${g.votes}/${g.members.length}명 완료</div>`;
    if (g.state === 'ROLE_REVEAL') turnBox = `<div class="turn-box">🃏 역할 확인 ${g.acks}/${g.members.length}명</div>`;
    if (g.state === 'RESULT') {
      const r = g.results[g.game - 1];
      turnBox = r ? `<div class="turn-box">${r.caught ? '<span class="verdict-ok">🎉 검거 성공</span>' : '<span class="verdict-no">🤫 검거 실패</span>'} · 득표 ${r.tally.filter((x) => x.count).map((x) => `${esc(x.nick)} ${x.count}`).join(', ')}${r.lookalike ? ` · 로봇 닮은꼴: ${esc(r.lookalike)}` : ''}</div>` : '';
    }
    const busy = ['PLAYING', 'VOTING', 'ROLE_REVEAL'].includes(g.state);
    return `<div class="card gcard ${['mint', 'sky', 'lilac', 'apricot'][g.idx]}">
      <div class="g-title"><h2>${g.idx + 1}모둠</h2>${statePill(g)}<span class="grow"></span>${rem !== null ? `<span class="big-timer">⏱ ${Math.ceil(rem / 1000)}초</span>` : ''}</div>
      ${g.mafiaNick ? `<div><span class="mafia-tag">🤖 마피아: ${esc(g.mafiaNick)}</span> <span class="muted small">(교사에게만 보여요)</span></div>` : ''}
      ${g.question ? `<div class="small muted">질문: <b>${esc(g.question)}</b></div>` : ''}
      ${turnBox}
      <div class="g-log" data-g="${g.idx}">${
        msgs.length
          ? msgs
              .map((m) => `<div class="ln ${m.isAI ? 'ai' : ''} ${m.pass ? 'pass' : ''}"><span class="nm">${esc(m.nick)}</span>${m.isAI ? `<span class="ai-chip">AI${m.source === 'backup' ? '·백업' : ''}</span>` : ''}<span>${esc(m.text)}${m.original ? ` <span class="orig">(원문: ${esc(m.original)})</span>` : ''}</span></div>`)
              .join('')
          : '<p class="muted center">아직 대화가 없어요.</p>'
      }</div>
      <div class="ctrl">
        ${busy ? `<button class="btn apricot small" data-act="pause" data-g="${g.idx}" data-v="${g.paused ? 0 : 1}" type="button">${g.paused ? '▶ 다시 시작' : '⏸ 일시정지'}</button>` : ''}
        ${g.state === 'PLAYING' ? `<button class="btn soft small" data-act="redo-turn" data-g="${g.idx}" type="button">↺ 턴 다시</button><button class="btn soft small" data-act="skip-turn" data-g="${g.idx}" type="button">⏭ 건너뛰기</button>` : ''}
        ${g.state === 'PLAYING' && t && t.isMafia ? `<button class="btn lilac small" data-act="force-backup" data-g="${g.idx}" type="button">🛟 백업 메시지</button>` : ''}
        ${g.state === 'VOTING' ? `<button class="btn soft small" data-act="end-vote" data-g="${g.idx}" type="button">🗳 투표 마감</button>` : ''}
        ${g.state === 'RESULT' && g.game < R.settings.games ? `<button class="btn lilac small" data-start="${g.idx}" type="button">▶ ${g.game + 1}판 시작</button>` : ''}
      </div>
    </div>`;
  }

  // ── T4 결과·점수판 ─────────────────────────────
  function renderT4() {
    const all = [];
    R.groups.forEach((g) => g.members.forEach((m) => all.push({ ...m, gi: g.idx })));
    const top5 = [...all].sort((a, b) => b.score - a.score).slice(0, 5);
    const games = Array.from({ length: R.settings.games }, (_, i) => i);
    $('t4').innerHTML = `<div class="two">
        <div class="card apricot stack">
          <h2>🏆 학급 전체 상위 5명</h2>
          <div class="big-table">${top5.map((m, i) => `<div class="score-line medal${i + 1}"><span class="rk">${['🥇', '🥈', '🥉', '4', '5'][i]}</span>${avatar(m.nick)}<span class="nm">${esc(m.nick)} <span class="muted small">${m.gi + 1}모둠</span></span><b>${m.score}점</b></div>`).join('') || '<p class="muted">아직 점수가 없어요.</p>'}</div>
        </div>
        <div class="card stack">
          <h2>🔍 판별 결과</h2>
          ${R.groups
            .map((g) => `<div class="score-line"><span class="nm">${g.idx + 1}모둠</span>${games.map((i) => {
              const r = g.results[i];
              return r ? `<span>${i + 1}판 ${r.caught ? '<span class="verdict-ok">검거 성공</span>' : '<span class="verdict-no">검거 실패</span>'} <span class="muted small">(${esc(r.mafiaNick)})</span></span>` : `<span class="muted">${i + 1}판 —</span>`;
            }).join(' · ')}</div>`)
            .join('')}
        </div>
      </div>
      <div class="groups" style="margin-top:16px">${R.groups
        .map((g) => `<div class="card gcard"><h2>${g.idx + 1}모둠 점수</h2><div class="big-table">${[...g.members]
          .sort((a, b) => b.score - a.score)
          .map((m, i) => `<div class="score-line"><span class="rk">${i + 1}</span>${avatar(m.nick)}<span class="nm">${esc(m.nick)}${g.results.some((r) => r && r.lookalike === m.nick) ? ' <span class="pill lemon small">🤖 닮은꼴</span>' : ''}</span><b>${m.score}점</b></div>`)
          .join('')}</div></div>`)
        .join('')}</div>`;
  }

  // ── T5 근거 보드 ──────────────────────────────
  function evHtml(e) {
    return `<div class="ev ${e.best ? 'best' : ''} ${e.targetWasMafia ? 'hit' : ''}" draggable="true" data-ev="${e.id}">${e.best ? '🏅 ' : ''}${esc(e.reason)}<div class="meta">${e.groupIdx + 1}모둠 ${e.game}판 · ${esc(e.voterNick)} → ${esc(e.targetNick)}</div></div>`;
  }
  function renderT5() {
    const evs = R.evidence.filter((e) => !boardGame || e.game === boardGame);
    const pending = evs.some((e) => e.label === 'pending');
    const games = Array.from({ length: R.settings.games }, (_, i) => i + 1);
    let body;
    if (boardMode === 'all') {
      body = `<div class="all-wrap">${evs.map(evHtml).join('') || '<p class="muted">아직 근거가 없어요. 투표가 끝나면 모여요.</p>'}</div>`;
    } else {
      body = `<div class="board">${LABELS.map(([k, t, ic]) => {
        const list = evs.filter((e) => (e.label || 'unclassified') === k || (k === 'unclassified' && e.label === 'pending'));
        return `<div class="col ${k}" data-col="${k}"><h3>${ic} ${t} <span class="pill gray small">${list.length}</span></h3>${list.map(evHtml).join('')}</div>`;
      }).join('')}</div>`;
    }
    $('t5').innerHTML = `<div class="row" style="margin-bottom:14px">
        <h2 class="grow">근거 보드 <span class="muted small">AI 분류(mock) · 끌어서 고칠 수 있어요 · 눌러서 크게 보기</span></h2>
        <button class="btn ${boardMode === 'all' ? '' : 'soft'} small" data-mode="all" type="button">분류 전 전체 보기</button>
        <button class="btn ${boardMode === 'sorted' ? '' : 'soft'} small" data-mode="sorted" type="button">분류해서 보기</button>
        <select id="boardGame" style="width:auto"><option value="0">모든 판</option>${games.map((n) => `<option value="${n}" ${boardGame === n ? 'selected' : ''}>${n}판</option>`).join('')}</select>
        <button class="btn soft small" id="reclassify" type="button">${pending ? '분류 중…' : '새 근거 분류'}</button>
      </div>${body}`;
    $('t5').querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
      boardMode = b.dataset.mode;
      renderT5();
    }));
    $('boardGame').onchange = (e) => {
      boardGame = +e.target.value;
      renderT5();
    };
    $('reclassify').onclick = () => act('classify', {}, '분류했어요.');
    $('t5').querySelectorAll('.ev').forEach((el) => {
      el.onclick = () => openEvidence(el.dataset.ev);
      el.ondragstart = (e) => {
        dragging = true;
        e.dataTransfer.setData('text/plain', el.dataset.ev);
      };
      el.ondragend = () => {
        dragging = false;
        setTimeout(render, 50);
      };
    });
    $('t5').querySelectorAll('[data-col]').forEach((col) => {
      col.ondragover = (e) => {
        e.preventDefault();
        col.classList.add('drag');
      };
      col.ondragleave = () => col.classList.remove('drag');
      col.ondrop = (e) => {
        e.preventDefault();
        col.classList.remove('drag');
        dragging = false;
        act('set-label', { id: e.dataTransfer.getData('text/plain'), label: col.dataset.col });
      };
    });
  }
  function openEvidence(id) {
    const e = R.evidence.find((x) => x.id === id);
    if (!e) return;
    const m = $('modal');
    m.innerHTML = `<div class="modal card stack center">
        <div class="ev-big">“${esc(e.reason)}”</div>
        <p class="muted">${e.groupIdx + 1}모둠 ${e.game}판 · ${esc(e.voterNick)} → ${esc(e.targetNick)} ${e.targetWasMafia ? '(정답 ✔)' : ''}</p>
        <div class="row" style="justify-content:center">
          <button class="btn ${e.best ? 'soft' : 'apricot'}" id="bestBtn" type="button">${e.best ? '🏅 근거상 취소' : '🏅 명탐정 근거상!'}</button>
          <button class="btn soft" id="closeModal" type="button">닫기</button>
        </div>
      </div>`;
    m.classList.remove('hidden');
    $('bestBtn').onclick = async () => {
      await act('toggle-best', { id });
      if (!e.best) TD.confetti(60);
      m.classList.add('hidden');
    };
    $('closeModal').onclick = () => m.classList.add('hidden');
    m.onclick = (ev) => ev.target === m && m.classList.add('hidden');
  }

  // ── T6 정리 ──────────────────────────────────
  function renderT6() {
    const P = R.poll;
    const preN = P.pre.reduce((a, b) => a + b, 0) || 1;
    const postN = P.post.reduce((a, b) => a + b, 0) || 1;
    const best = R.evidence.filter((e) => e.best);
    const aiMsgs = [];
    R.groups.forEach((g) => g.messages.filter((m) => m.isAI).forEach((m) => aiMsgs.push({ ...m, gi: g.idx })));
    $('t6').innerHTML = `<div class="row" style="margin-bottom:14px">
        <h2 class="grow">정리</h2>
        ${R.phase === 'CLOSING' ? '<span class="pill mint">학생 화면: 사후 질문·약속 쓰는 중</span>' : '<button class="btn mint big" id="startClosing" type="button">🧩 정리 단계 시작 (학생 화면 전환)</button>'}
      </div>
      <div class="two">
        <div class="card lilac stack">
          <h2>🤔 ${esc(P.question)}</h2>
          <div class="poll-chart">${P.options
            .map((o, i) => `<div class="poll-row"><div class="lbl">${esc(o)}</div><div class="bars">
              <div class="bar pre" style="width:${Math.max(6, (P.pre[i] / preN) * 100)}%">사전 ${P.pre[i]}</div>
              <div class="bar post" style="width:${Math.max(6, (P.post[i] / postN) * 100)}%">사후 ${P.post[i]}</div></div></div>`)
            .join('')}</div>
        </div>
        <div class="card stack">
          <h2>🗣 발문 순서</h2>
          <ol class="steps">${R.closingSteps.map((s, i) => `<li><b>${i + 1}. ${esc(s.q)}</b><br/><span class="muted small">띄울 화면: ${esc(s.screen)}</span></li>`).join('')}</ol>
        </div>
      </div>
      <div class="card mint stack" style="margin-top:16px">
        <h2>🤝 AI 친구 약속 게시판 <span class="pill gray small">${R.pledges.length}개</span></h2>
        <div class="pledges">${R.pledges.map((p) => `<div class="pledge">${esc(p.text)}<div class="muted small">${p.groupIdx + 1}모둠 ${esc(p.nick)}</div></div>`).join('') || '<p class="muted">정리 단계에서 학생들이 쓰면 여기에 모여요.</p>'}</div>
      </div>
      <div class="two" style="margin-top:16px">
        <div class="card apricot stack"><h2>🏅 명탐정 근거상</h2>${best.map((e) => `<div class="pledge">${esc(e.reason)}<div class="muted small">${e.groupIdx + 1}모둠 ${esc(e.voterNick)}</div></div>`).join('') || '<p class="muted">근거 보드에서 근거를 눌러 골라 주세요.</p>'}</div>
        <div class="card lilac stack"><h2>🤖 AI가 쓴 메시지 모음</h2><div class="stack">${aiMsgs.map((m) => `<div class="pledge" style="border-color:var(--lilac)">${esc(m.text)}<div class="muted small">${m.gi + 1}모둠 ${m.game}판 ${m.round}바퀴 · ${esc(m.nick)}인 척</div></div>`).join('') || '<p class="muted">아직 없어요.</p>'}</div></div>
      </div>`;
    if ($('startClosing')) $('startClosing').onclick = () => confirm('모든 모둠을 정리 단계로 넘길까요? (진행 중인 판은 멈춰요)') && act('closing', {}, '정리 단계를 시작했어요.');
  }

  // ── T7 수업 종료 ──────────────────────────────
  function renderT7() {
    if ($('t7').dataset.code === R.code) return;
    $('t7').dataset.code = R.code;
    $('t7').innerHTML = `<div class="card coral stack center" style="max-width:640px;margin:0 auto">
        <div class="mascot">${TD.turingi('party', 120)}</div>
        <h2>수업 종료 및 기록 삭제</h2>
        <p>이 방의 모든 대화, 근거, 점수, 약속을 서버에서 지워요.<br/>지운 기록은 되살릴 수 없어요. 필요한 화면은 먼저 캡처해 두세요.</p>
        <button class="btn coral big" id="closeRoom" type="button">🗑 수업 종료하고 기록 지우기</button>
      </div>`;
    $('closeRoom').onclick = () => {
      if (!confirm(`방 ${R.code}의 모든 기록을 지울까요? 되돌릴 수 없어요.`)) return;
      act('close-room');
    };
  }

  // 남은 시간 표시만 0.5초마다 새로 그린다
  setInterval(() => {
    if (!R || tab !== 't3') return;
    document.querySelectorAll('#t3 .gcard').forEach((card, i) => {
      const g = R.groups[i];
      const el = card.querySelector('.big-timer');
      const rem = remain(g);
      if (el && rem !== null) el.textContent = `⏱ ${Math.ceil(rem / 1000)}초`;
    });
  }, 500);

  render();
})();

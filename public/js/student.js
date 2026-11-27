// 학생 화면 (S1~S7). 서버가 보내 준 '내 몫의 상태'만 그린다.
(function () {
  const $ = (id) => document.getElementById(id);
  const { esc, avatar, chars } = TD;
  const socket = io({ transports: ['websocket', 'polling'] });

  let S = null; // 마지막 상태
  let stateAt = 0; // 상태를 받은 시각
  let session = null; // {code, playerId}
  let pickedGroup = null;
  let voteTarget = null;
  let lastScreen = '';
  let lastTurnKey = '';
  let ghost = { turnId: null, text: null, pos: 0 };
  let typingTimer = null;
  let lastTypingSent = 0;
  let sendingNow = false;
  let roleHideTimer = null;

  // ── 저장소 ───────────────────────────────────
  const store = {
    getSession() {
      try { return JSON.parse(sessionStorage.getItem('td') || 'null'); } catch (e) { return null; }
    },
    setSession(v) {
      try {
        sessionStorage.setItem('td', JSON.stringify(v));
        localStorage.setItem('td-last', JSON.stringify(v));
      } catch (e) {}
    },
    getLast() {
      try { return JSON.parse(localStorage.getItem('td-last') || 'null'); } catch (e) { return null; }
    },
    clear() {
      try { sessionStorage.removeItem('td'); localStorage.removeItem('td-last'); } catch (e) {}
    },
  };

  // ── 화면 전환 ─────────────────────────────────
  function show(id) {
    if (lastScreen === id) return;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
    lastScreen = id;
    window.scrollTo(0, 0);
  }

  function showMsg(text, mood = 'surprise') {
    $('msgMascot').innerHTML = TD.turingi(mood, 130);
    $('msgText').textContent = text;
    show('s-msg');
  }

  // ── S1 입장 ───────────────────────────────────
  $('joinMascot').innerHTML = TD.turingi('basic', 120);
  const params = new URLSearchParams(location.search);
  if (params.get('code')) $('codeInput').value = params.get('code').replace(/\D/g, '').slice(0, 6);

  function offerResume() {
    const last = store.getLast();
    if (last && last.nick) {
      $('resumeNick').textContent = last.nick;
      $('resumeBox').classList.remove('hidden');
    }
  }
  $('resumeBtn').onclick = () => {
    const last = store.getLast();
    if (last) resume(last, true);
  };

  async function checkCode() {
    const code = $('codeInput').value.trim();
    if (!/^\d{6}$/.test(code)) return TD.toast('방 코드 6자리를 넣어 주세요.', true);
    try {
      const r = await fetch('/api/room/' + code).then((x) => x.json());
      if (!r.ok) return TD.toast(r.msg || '방을 찾을 수 없어요.', true);
      $('groupPick').innerHTML = r.groups
        .map((g) => `<button type="button" class="btn soft" data-g="${g.idx}" ${g.open ? '' : 'disabled'}>${g.idx + 1}모둠 <span class="small">(${g.count}명)</span></button>`)
        .join('');
      pickedGroup = r.groups.length === 1 ? 0 : null;
      $('groupPick').querySelectorAll('button').forEach((b) => {
        if (Number(b.dataset.g) === pickedGroup) b.classList.add('sel');
        b.onclick = () => {
          pickedGroup = Number(b.dataset.g);
          $('groupPick').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
        };
      });
      $('step1').classList.add('hidden');
      $('step2').classList.remove('hidden');
      $('nickInput').focus();
    } catch (e) {
      TD.toast('서버에 연결할 수 없어요.', true);
    }
  }
  $('codeBtn').onclick = checkCode;
  $('codeInput').onkeydown = (e) => { if (e.key === 'Enter') checkCode(); };

  function join() {
    const nick = $('nickInput').value.trim();
    if (chars(nick) < 2) return TD.toast('별명을 2자 이상 써 주세요.', true);
    if (pickedGroup === null) return TD.toast('모둠을 골라 주세요.', true);
    const code = $('codeInput').value.trim();
    socket.emit('join', { code, nick, groupIdx: pickedGroup }, (r) => {
      if (!r || !r.ok) return TD.toast((r && r.msg) || '입장하지 못했어요.', true);
      session = { code: r.code, playerId: r.playerId, nick };
      store.setSession(session);
    });
  }
  $('joinBtn').onclick = join;
  $('nickInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) join(); };

  function resume(sess, fromButton) {
    socket.emit('resume', sess, (r) => {
      if (r && r.ok) {
        session = sess;
        store.setSession(sess);
      } else {
        session = null;
        if (fromButton) TD.toast('이전 자리가 없어졌어요. 새로 입장해 주세요.', true);
        store.clear();
        $('resumeBox').classList.add('hidden');
        show('s-join');
      }
    });
  }

  socket.on('connect', () => {
    $('connBanner').classList.add('hidden');
    const sess = session || store.getSession();
    if (sess) resume(sess);
    else {
      offerResume();
      show('s-join');
    }
  });
  socket.on('disconnect', () => $('connBanner').classList.remove('hidden'));
  socket.on('kicked', () => {
    store.clear();
    session = null;
    showMsg('선생님이 자리를 정리했어요. 다시 입장해 주세요.', 'think');
  });
  socket.on('room-closed', () => {
    store.clear();
    session = null;
    showMsg('수업이 끝났어요. 함께해 줘서 고마워요!', 'party');
  });

  // ── 소리 버튼 ─────────────────────────────────
  function paintSound() {
    $('soundBtn').textContent = TD.isMuted() ? '🔕 소리 끔' : '🔔 소리 켬';
  }
  $('soundBtn').onclick = () => {
    TD.toggleMute();
    paintSound();
  };
  paintSound();

  // ── 상태 수신 ─────────────────────────────────
  socket.on('state', (st) => {
    S = st;
    stateAt = Date.now();
    if (session) session.nick = st.me.nick;
    render();
  });

  function remaining() {
    if (!S || S.group.remainingMs === null || S.group.remainingMs === undefined) return null;
    if (S.group.paused) return S.group.remainingMs;
    return Math.max(0, S.group.remainingMs - (Date.now() - stateAt));
  }

  function render() {
    if (!S) return;
    const g = S.group;
    if (g.state === 'CLOSING' || S.room.phase === 'CLOSING') return renderClosing();
    ({ LOBBY: renderLobby, ROLE_REVEAL: renderRole, PLAYING: renderChat, VOTING: renderVote, RESULT: renderResult }[g.state] || renderLobby)();
    $('pausedBanner').classList.toggle('hidden', !g.paused);
  }

  // ── S2 대기실 ─────────────────────────────────
  $('lobbyMascot').innerHTML = TD.turingi('basic', 90);
  function memberHtml(m) {
    return `<div class="member ${m.connected ? '' : 'off'}">${avatar(m.nick)}<span class="grow">${esc(m.nick)}${m.id === S.me.id ? ' (나)' : ''}</span>
      ${m.greeted ? '<span class="pill mint small">인사 ✔</span>' : '<span class="pill gray small">인사 쓰는 중</span>'}
      ${m.connected ? '' : '<span class="pill coral small">연결 끊김</span>'}</div>`;
  }
  function bubbleHtml(nick, text, cls = '') {
    return `<div class="bubble-row">${avatar(nick)}<div><div class="who">${esc(nick)}</div><div class="bubble ${cls}">${esc(text)}</div></div></div>`;
  }
  function pollButtons(el, which, chosen) {
    el.innerHTML = S.room.poll.options
      .map((o, i) => `<button type="button" class="btn soft ${chosen === i ? 'sel' : ''}" data-i="${i}">${esc(o)}</button>`)
      .join('');
    el.querySelectorAll('button').forEach((b) => {
      b.onclick = () => socket.emit('poll', { which, choice: Number(b.dataset.i) }, () => TD.toast('골랐어요!'));
    });
  }
  function renderLobby() {
    show('s-lobby');
    const g = S.group;
    $('lobbyGroup').textContent = `${g.idx + 1}모둠`;
    $('lobbyCode').textContent = S.room.code;
    $('lobbyMe').textContent = `나: ${S.me.nick}`;
    $('greetLabel').textContent = S.room.greetingPrompt;
    $('memberList').innerHTML = g.members.map(memberHtml).join('');
    const gl = $('greetList');
    gl.innerHTML = g.greetings.length
      ? g.greetings.map((x) => bubbleHtml(x.nick, x.text, x.id === S.me.id ? 'me' : '')).join('')
      : '<p class="empty-chat">아직 인사가 없어요. 먼저 인사해 볼까요?</p>';
    gl.scrollTop = gl.scrollHeight;
    $('greetInput').maxLength = S.room.maxLen;
    $('greetBtn').textContent = S.me.greeting ? '고치기' : '올리기';
    $('pollQ').textContent = S.room.poll.question;
    pollButtons($('prePoll'), 'pre', S.me.prePoll);
  }
  function sendGreeting() {
    const text = $('greetInput').value.trim();
    if (!text) return TD.toast('한 줄 인사를 써 주세요.', true);
    $('greetBtn').disabled = true;
    socket.emit('greeting', { text }, (r) => {
      $('greetBtn').disabled = false;
      if (!r || !r.ok) return TD.toast((r && r.msg) || '다시 써 주세요.', true);
      $('greetInput').value = '';
    });
  }
  $('greetBtn').onclick = sendGreeting;
  $('greetInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) sendGreeting(); };

  // ── S3 역할 확인 ──────────────────────────────
  $('roleFrontArt').innerHTML = TD.turingi('think', 120);
  function renderRole() {
    const first = lastScreen !== 's-role';
    show('s-role');
    $('roleGame').textContent = S.group.game;
    if (first) $('roleCard').classList.remove('open');
    $('ackBtn').classList.toggle('hidden', S.me.acked);
    $('ackWait').classList.toggle('hidden', !S.me.acked);
  }
  $('roleCard').onclick = () => {
    if (!S || !S.me.role) return;
    const back = $('roleCard').querySelector('.flip-back');
    back.className = 'flip-back ' + S.me.role;
    $('roleArt').innerHTML = TD.roleArt(S.me.role, 140);
    $('roleText').textContent = S.me.roleText;
    $('roleCard').classList.add('open');
    clearTimeout(roleHideTimer);
    roleHideTimer = setTimeout(() => {
      $('roleCard').classList.remove('open');
      // 뒤집힌 뒤에는 내용을 지워 둔다 (옆에서 보지 못하게)
      setTimeout(() => {
        $('roleArt').innerHTML = '';
        $('roleText').textContent = '';
      }, 600);
    }, 3000);
  };
  $('ackBtn').onclick = () => socket.emit('ack-role');

  // ── S4 채팅 ───────────────────────────────────
  const input = $('msgInput');
  function isMyTurn() {
    return S && S.group.state === 'PLAYING' && S.group.turn && S.group.turn.playerId === S.me.id;
  }
  function amMafia() {
    return S && S.me.role === 'mafia';
  }

  function renderChat() {
    show('s-chat');
    const g = S.group;
    $('chatRound').textContent = `${g.game}판 · ${g.round}바퀴`;
    $('chatTurnNo').textContent = g.turn ? `${g.turn.idx + 1} / ${g.turn.of} 번째 차례` : '';
    $('chatQuestion').textContent = g.question || '';
    $('chatGuide').textContent = g.guide || '';
    $('chatGuide').classList.toggle('hidden', !g.guide);
    $('noticeText').textContent = S.room.notice;
    renderMessages($('chatList'), g.messages);

    const mine = isMyTurn();
    const turnKey = g.turn ? `${g.game}-${g.round}-${g.turn.idx}-${g.turn.playerId}` : '';
    if (turnKey !== lastTurnKey) {
      // 새 차례
      lastTurnKey = turnKey;
      sendingNow = false;
      input.value = '';
      if (mine) {
        TD.beep('turn');
        if (!amMafia() && S.draft) input.value = S.draft;
        setTimeout(() => input.focus(), 50);
      }
    }
    // 마피아 고스트 문장 (내 차례일 때만 서버가 보내 줌)
    if (S.ghost) {
      if (ghost.turnId !== S.ghost.turnId || ghost.text !== S.ghost.text) {
        ghost = { turnId: S.ghost.turnId, text: S.ghost.text, pos: Math.max(ghost.turnId === S.ghost.turnId && ghost.text === S.ghost.text ? ghost.pos : 0, S.ghost.pos || 0) };
        if (ghost.text) ghost.pos = Math.min(ghost.pos, chars(ghost.text));
        input.value = ghost.text ? [...ghost.text].slice(0, ghost.pos).join('') : '';
      }
    } else if (ghost.turnId) {
      ghost = { turnId: null, text: null, pos: 0 };
    }
    const sending = sendingNow || (g.turn && g.turn.sending && mine);
    $('inputBox').classList.toggle('myturn', mine && !sending);
    input.disabled = !mine || sending || g.paused;
    input.maxLength = S.room.maxLen;
    input.placeholder = mine ? '여기에 써요. 다 쓰면 전송!' : g.turn ? `${g.turn.nick}의 차례예요` : '';
    $('turnLabel').textContent = mine ? (sending ? '보내는 중…' : '✨ 내 차례예요!') : g.turn ? `${g.turn.nick}의 차례` : '';
    updateSendState();
  }

  function renderMessages(el, msgs, aiIds) {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const key = msgs.map((m) => m.id).join(',') + '|' + (aiIds || []).join(',');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    if (!msgs.length) {
      el.innerHTML = `<div class="empty-chat">${TD.turingi('think', 80)}<p>첫 번째 친구가 쓰는 중이에요</p></div>`;
      return;
    }
    let lastRound = null;
    el.innerHTML = msgs
      .map((m) => {
        let head = '';
        if (m.round !== lastRound) {
          head = `<div class="center"><span class="pill gray small">${m.round}바퀴</span></div>`;
          lastRound = m.round;
        }
        const cls = [m.pass ? 'pass' : '', S && m.playerId === S.me.id ? 'me' : '', aiIds && aiIds.includes(m.id) ? 'ai-reveal' : ''].join(' ');
        return head + bubbleHtml(m.nick, m.text, cls);
      })
      .join('');
    if (atBottom || true) el.scrollTop = el.scrollHeight;
  }

  function updateSendState() {
    const mine = isMyTurn();
    let ready = false;
    if (amMafia()) {
      ready = mine && !!ghost.text && ghost.pos >= chars(ghost.text);
      $('charCount').textContent = `${chars(input.value)} / ${S.room.maxLen}자`;
    } else {
      ready = mine && input.value.trim().length > 0;
      $('charCount').textContent = `${chars(input.value)} / ${S.room.maxLen}자`;
    }
    $('sendBtn').disabled = !ready || sendingNow || (S.group.turn && S.group.turn.sending) || S.group.paused;
    $('inputHint').textContent = mine ? 'Enter 키로도 보낼 수 있어요' : '';
  }

  function emitTyping(extra) {
    const now = Date.now();
    if (now - lastTypingSent < 350 && !extra.force) {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => emitTyping({ ...extra, force: true }), 360);
      return;
    }
    lastTypingSent = now;
    const data = amMafia() ? { pos: ghost.pos } : { draft: input.value };
    socket.emit('typing', data);
  }

  // 마피아: 아무 키나 누르면 AI 문장이 1~2글자씩 나타난다
  function ghostStep() {
    if (!ghost.text) {
      emitTyping({}); // 문장 준비 전: 아무것도 안 나오지만 '입력 중…'은 똑같이
      return;
    }
    const total = chars(ghost.text);
    if (ghost.pos < total) {
      ghost.pos = Math.min(total, ghost.pos + 1 + (Math.random() < 0.5 ? 1 : 0));
      input.value = [...ghost.text].slice(0, ghost.pos).join('');
    }
    emitTyping({});
    updateSendState();
  }

  input.addEventListener('keydown', (e) => {
    if (!isMyTurn()) return;
    if (amMafia()) {
      if (e.key === 'Tab') return;
      if (e.key === 'Enter' && ghost.text && ghost.pos >= chars(ghost.text)) {
        e.preventDefault();
        return doSend();
      }
      if (e.key === 'Unidentified' || e.keyCode === 229) return; // 모바일 가상 키보드는 beforeinput 에서
      e.preventDefault();
      if (e.repeat && Math.random() < 0.5) return;
      ghostStep();
      return;
    }
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      doSend();
    }
  });
  input.addEventListener('beforeinput', (e) => {
    if (!isMyTurn() || !amMafia()) return;
    e.preventDefault();
    ghostStep();
  });
  input.addEventListener('paste', (e) => amMafia() && e.preventDefault());
  input.addEventListener('drop', (e) => e.preventDefault());
  input.addEventListener('input', () => {
    if (amMafia()) {
      // 어떤 경로로든 바뀌면 AI 문장 상태로 되돌린다
      input.value = ghost.text ? [...ghost.text].slice(0, ghost.pos).join('') : '';
    } else if (isMyTurn()) {
      emitTyping({});
    }
    updateSendState();
  });
  $('sendBtn').onclick = doSend;

  function doSend() {
    if (!isMyTurn() || sendingNow) return;
    if (amMafia()) {
      if (!ghost.text || ghost.pos < chars(ghost.text)) return;
    } else if (!input.value.trim()) return;
    sendingNow = true;
    input.disabled = true;
    $('sendBtn').disabled = true;
    $('turnLabel').textContent = '보내는 중…';
    socket.emit('send', { text: amMafia() ? '' : input.value }, (r) => {
      if (!r || !r.ok) {
        sendingNow = false;
        if (r && r.msg) TD.toast(r.msg, true);
        if (S) renderChat();
        input.focus();
      }
    });
  }

  // '○○ 입력 중…' (키 입력 신호 기준 — 사람·마피아 똑같이)
  let typingHide = null;
  socket.on('typing', ({ playerId, nick }) => {
    if (!S || playerId === S.me.id) return;
    $('typingLine').innerHTML = `${esc(nick)} 입력 중<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>`;
    clearTimeout(typingHide);
    typingHide = setTimeout(() => ($('typingLine').innerHTML = '&nbsp;'), 2200);
  });

  // ── S5 투표 ───────────────────────────────────
  $('voteMascot').innerHTML = TD.turingi('think', 100);
  function renderVote() {
    const first = lastScreen !== 's-vote';
    show('s-vote');
    const v = S.group.vote;
    if (first) {
      voteTarget = null;
      $('reasonInput').value = '';
    }
    $('voteForm').classList.toggle('hidden', v.done);
    $('voteWait').classList.toggle('hidden', !v.done);
    $('voteProgress').textContent = `${v.count} / ${v.total}명 투표 완료`;
    const others = S.group.members.filter((m) => m.id !== S.me.id);
    const key = others.map((m) => m.id).join(',') + voteTarget;
    if ($('voteCards').dataset.key !== key) {
      $('voteCards').dataset.key = key;
      $('voteCards').innerHTML = others
        .map((m) => `<button type="button" class="vote-card ${voteTarget === m.id ? 'sel' : ''}" data-id="${m.id}">${avatar(m.nick)}<span>${esc(m.nick)}</span></button>`)
        .join('');
      $('voteCards').querySelectorAll('.vote-card').forEach((b) => {
        b.onclick = () => {
          voteTarget = b.dataset.id;
          renderVote();
        };
      });
    }
    renderMessages($('voteReview'), S.group.messages);
  }
  $('voteBtn').onclick = () => {
    if (!voteTarget) return TD.toast('AI 같은 친구를 한 명 골라 주세요.', true);
    const reason = $('reasonInput').value.trim();
    if (chars(reason.replace(/\s/g, '')) < 5) return TD.toast('근거를 5자 이상 써 주세요.', true);
    $('voteBtn').disabled = true;
    socket.emit('vote', { targetId: voteTarget, reason }, (r) => {
      $('voteBtn').disabled = false;
      if (!r || !r.ok) TD.toast((r && r.msg) || '투표하지 못했어요.', true);
    });
  };

  // ── S6 결과 ───────────────────────────────────
  function renderResult() {
    const r = S.group.result;
    if (!r) return;
    const first = lastScreen !== 's-result';
    show('s-result');
    $('revealArt').innerHTML = TD.turingi(r.caught ? 'surprise' : 'wink', 130);
    $('revealNick').textContent = r.mafiaNick + (r.mafiaId === S.me.id ? ' (나!)' : '');
    $('revealVerdict').textContent = r.caught ? '🎉 검거 성공! 모둠이 AI를 찾아냈어요' : '🤫 검거 실패! AI가 끝까지 숨었어요';
    $('revealVerdict').className = 'title verdict ' + (r.caught ? 'ok' : 'no');
    $('myDelta').textContent = (r.myDelta >= 0 ? '+' : '') + r.myDelta;
    $('myScore').textContent = S.me.score;
    $('lookalike').innerHTML = r.lookalike ? `<span class="badge">🤖 로봇 닮은꼴: ${esc(r.lookalike)}</span><p class="muted small">사람인데 표를 가장 많이 받았어요. 왜 AI처럼 보였을까?</p>` : '';
    const max = Math.max(1, ...r.tally.map((t) => t.count));
    $('tally').innerHTML = r.tally
      .map((t) => `<div class="tally-row"><span class="name">${esc(t.nick)}${t.id === r.mafiaId ? ' 🤖' : ''}</span><div class="tally-bar ${t.id === r.mafiaId ? 'mafia' : ''}" style="width:${(t.count / max) * 70}%"></div><b>${t.count}표</b></div>`)
      .join('');
    const aiMsgs = S.group.messages.filter((m) => r.aiMessageIds.includes(m.id));
    $('aiMsgs').innerHTML = aiMsgs.length ? aiMsgs.map((m) => bubbleHtml(m.nick, `${m.round}바퀴: ${m.text}`, 'ai-reveal')).join('') : '<p class="muted">이번 판에는 AI 메시지가 없었어요 (모두 패스).</p>';
    $('voteReasons').innerHTML = r.votes
      .map((v) =>
        v.abstain
          ? `<div class="reason"><b>${esc(v.voterNick)}</b> <span class="muted">기권</span></div>`
          : `<div class="reason ${v.targetId === r.mafiaId ? 'hit' : ''}"><b>${esc(v.voterNick)}</b> → <b>${esc(v.targetNick)}</b>${v.targetId === r.mafiaId ? ' ✔' : ''}<br/><span>${esc(v.reason)}</span></div>`
      )
      .join('');
    $('groupScores').innerHTML = r.scores
      .map((x, i) => `<div class="score-row"><span class="rank">${i + 1}</span>${avatar(x.nick)}<span class="grow">${esc(x.nick)}${x.id === S.me.id ? ' (나)' : ''}</span><b>${x.score}점</b></div>`)
      .join('');
    $('nextHint').textContent = r.isLast ? '모든 판이 끝났어요! 선생님 화면을 봐 주세요.' : '선생님이 다음 판을 시작할 때까지 기다려요.';
    if (first) {
      TD.beep('result');
      TD.confetti(r.caught ? 90 : 40);
      $('revealCard').classList.remove('pop');
      void $('revealCard').offsetWidth;
      $('revealCard').classList.add('pop');
    }
  }

  // ── S7 정리 ───────────────────────────────────
  $('closeMascot').innerHTML = TD.turingi('party', 110);
  function renderClosing() {
    show('s-closing');
    $('pollQ2').textContent = S.room.poll.question;
    pollButtons($('postPoll'), 'post', S.me.postPoll);
    $('pledgePrompt').textContent = S.room.pledgePrompt;
    $('pledgeExample').textContent = S.room.pledgeExample;
    $('pledgeDone').classList.toggle('hidden', !S.me.pledge);
    $('pledgeText').textContent = S.me.pledge;
    $('finalScore').textContent = S.me.score;
  }
  function sendPledge() {
    const text = $('pledgeInput').value.trim();
    if (!text) return TD.toast('원칙을 한 줄 써 주세요.', true);
    socket.emit('pledge', { text }, (r) => {
      if (!r || !r.ok) return TD.toast((r && r.msg) || '다시 써 주세요.', true);
      $('pledgeInput').value = '';
      TD.toast('원칙을 올렸어요!');
    });
  }
  $('pledgeBtn').onclick = sendPledge;
  $('pledgeInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) sendPledge(); };

  // ── 타이머 ────────────────────────────────────
  setInterval(() => {
    if (!S) return;
    const rem = remaining();
    if (lastScreen === 's-chat') paintTimer($('chatTimer'), rem, S.room.turnSec * 1000);
    if (lastScreen === 's-vote') paintTimer($('voteTimer'), rem, S.room.voteSec * 1000);
  }, 250);
  function paintTimer(el, rem, total) {
    if (rem === null) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = TD.timerRing(rem, total);
    el.classList.toggle('hurry', rem <= 5000 && rem > 0 && !S.group.paused);
  }

  // 첫 연결 전 기본 화면
  show('s-join');
})();

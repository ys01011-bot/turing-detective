// 학생·교사 화면 공통: 마스코트 '튜링이' SVG, 효과음, 색종이, 토스트, 타이머 고리
(function () {
  const C = {};

  /** 튜링이: 돋보기를 든 동글동글 꼬마 로봇 탐정. mood: basic | think | surprise | party | wink */
  C.turingi = function (mood = 'basic', size = 120) {
    const eyes = {
      basic: '<circle cx="48" cy="62" r="7" fill="#36334f"/><circle cx="72" cy="62" r="7" fill="#36334f"/><circle cx="50" cy="60" r="2.4" fill="#fff"/><circle cx="74" cy="60" r="2.4" fill="#fff"/>',
      think: '<circle cx="50" cy="59" r="6" fill="#36334f"/><circle cx="74" cy="59" r="6" fill="#36334f"/><circle cx="52" cy="57" r="2" fill="#fff"/><circle cx="76" cy="57" r="2" fill="#fff"/><path d="M40 49 q8 -5 15 0" stroke="#36334f" stroke-width="3" fill="none" stroke-linecap="round"/>',
      surprise: '<circle cx="48" cy="62" r="9" fill="#fff" stroke="#36334f" stroke-width="3"/><circle cx="72" cy="62" r="9" fill="#fff" stroke="#36334f" stroke-width="3"/><circle cx="48" cy="62" r="4" fill="#36334f"/><circle cx="72" cy="62" r="4" fill="#36334f"/>',
      party: '<path d="M40 64 q8 -10 16 0" stroke="#36334f" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M64 64 q8 -10 16 0" stroke="#36334f" stroke-width="4" fill="none" stroke-linecap="round"/>',
      wink: '<circle cx="48" cy="62" r="7" fill="#36334f"/><circle cx="50" cy="60" r="2.4" fill="#fff"/><path d="M64 63 q8 -7 16 0" stroke="#36334f" stroke-width="4" fill="none" stroke-linecap="round"/>',
    }[mood] || '';
    const mouth = {
      basic: '<path d="M52 77 q8 7 16 0" stroke="#36334f" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
      think: '<path d="M54 79 h12" stroke="#36334f" stroke-width="3.5" stroke-linecap="round"/>',
      surprise: '<ellipse cx="60" cy="80" rx="5" ry="6" fill="#36334f"/>',
      party: '<path d="M50 75 q10 12 20 0 z" fill="#d9574b" stroke="#36334f" stroke-width="3" stroke-linejoin="round"/>',
      wink: '<path d="M52 77 q8 7 16 0" stroke="#36334f" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M66 78 q3 6 7 1" fill="#ff8fa3"/>',
    }[mood] || '';
    const extra = {
      think: '<text x="94" y="30" font-family="Jua" font-size="22" fill="#7b62d9">?</text>',
      surprise: '<text x="92" y="30" font-family="Jua" font-size="24" fill="#e2843e">!</text>',
      party: '<circle cx="14" cy="26" r="4" fill="#ffc9c4"/><rect x="96" y="18" width="7" height="7" rx="2" fill="#bdf0dd" transform="rotate(20 99 21)"/><circle cx="104" cy="44" r="3" fill="#c9e7ff"/><rect x="10" y="48" width="6" height="6" rx="2" fill="#e3d9ff"/>',
    }[mood] || '';
    return `<svg viewBox="0 0 120 130" width="${size}" height="${Math.round(size * 1.083)}" role="img" aria-label="튜링이">
      <line x1="60" y1="20" x2="60" y2="30" stroke="#7b62d9" stroke-width="4" stroke-linecap="round"/>
      <circle cx="60" cy="16" r="6" fill="#ffc9c4" stroke="#36334f" stroke-width="2.5"/>
      <rect x="26" y="30" width="68" height="64" rx="30" fill="#c9e7ff" stroke="#36334f" stroke-width="3.5"/>
      <path d="M30 40 q30 -26 60 0 l3 6 h-66 z" fill="#ffe0c7" stroke="#36334f" stroke-width="3" stroke-linejoin="round"/>
      <path d="M26 46 h68" stroke="#36334f" stroke-width="3" stroke-linecap="round"/>
      <rect x="54" y="30" width="12" height="6" rx="3" fill="#e2843e"/>
      <ellipse cx="60" cy="68" rx="27" ry="20" fill="#fff" opacity="0.85"/>
      ${eyes}${mouth}
      <circle cx="38" cy="76" r="4.5" fill="#ffc9c4" opacity="0.9"/><circle cx="82" cy="76" r="4.5" fill="#ffc9c4" opacity="0.9"/>
      <rect x="40" y="96" width="40" height="24" rx="12" fill="#bdf0dd" stroke="#36334f" stroke-width="3.5"/>
      <circle cx="60" cy="108" r="4" fill="#fff4bf" stroke="#36334f" stroke-width="2"/>
      <g transform="translate(86 92) rotate(-25)">
        <rect x="-3" y="8" width="6" height="20" rx="3" fill="#e2843e" stroke="#36334f" stroke-width="2.5"/>
        <circle cx="0" cy="0" r="11" fill="#e9f6ff" stroke="#36334f" stroke-width="3.5"/>
        <path d="M-5 -4 q3 -4 8 -3" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
      </g>
      ${extra}
    </svg>`;
  };

  /** 역할 카드 그림: human = 돋보기와 탐정 모자 / mafia = 윙크하는 로봇 */
  C.roleArt = function (role, size = 150) {
    if (role === 'mafia') return C.turingi('wink', size);
    return `<svg viewBox="0 0 140 130" width="${size}" height="${Math.round(size * 0.93)}" role="img" aria-label="돋보기와 탐정 모자">
      <path d="M20 62 q50 -60 100 0 z" fill="#ffe0c7" stroke="#36334f" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M10 64 q60 18 120 0" fill="#e2843e" stroke="#36334f" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M40 46 q30 -12 60 0" stroke="#e2843e" stroke-width="5" fill="none"/>
      <circle cx="64" cy="96" r="22" fill="#e9f6ff" stroke="#36334f" stroke-width="4"/>
      <path d="M55 88 q5 -6 13 -5" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
      <rect x="82" y="108" width="34" height="10" rx="5" fill="#7b62d9" stroke="#36334f" stroke-width="3" transform="rotate(35 82 108)"/>
    </svg>`;
  };

  // 효과음 (끄기 가능)
  let muted = false;
  try { muted = localStorage.getItem('td-muted') === '1'; } catch (e) {}
  let actx = null;
  C.isMuted = () => muted;
  C.toggleMute = () => {
    muted = !muted;
    try { localStorage.setItem('td-muted', muted ? '1' : '0'); } catch (e) {}
    return muted;
  };
  C.beep = function (kind = 'turn') {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'result' ? [523, 659, 784, 1047] : [660, 880];
      notes.forEach((f, i) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        const t = actx.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + 0.2);
      });
    } catch (e) {}
  };

  C.confetti = function (n = 70) {
    const colors = ['#bdf0dd', '#c9e7ff', '#e3d9ff', '#ffe0c7', '#ffc9c4', '#fff4bf'];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'confetti';
      d.style.left = Math.random() * 100 + 'vw';
      d.style.background = colors[i % colors.length];
      d.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
      d.style.animationDelay = Math.random() * 0.5 + 's';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 4200);
    }
  };

  let toastTimer;
  C.toast = function (msg, warn = false) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = (warn ? 'warn ' : '') + 'pop';
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.style.display = 'none'), 2800);
  };

  C.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 별명으로 정하는 아바타 색 (사람·마피아 구분 없음)
  C.avClass = (nick) => {
    let h = 0;
    for (const ch of String(nick)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return 'av' + (h % 7);
  };
  C.avatar = (nick) => `<span class="avatar ${C.avClass(nick)}" aria-hidden="true">${C.esc([...String(nick)][0] || '?')}</span>`;

  /** 둥근 진행 고리 타이머 */
  C.timerRing = function (remainMs, totalMs, size = 74) {
    const r = size / 2 - 7;
    const circ = 2 * Math.PI * r;
    const frac = totalMs ? Math.max(0, Math.min(1, remainMs / totalMs)) : 0;
    const sec = Math.ceil(Math.max(0, remainMs) / 1000);
    const color = sec <= 5 ? '#d9574b' : sec <= 10 ? '#e2843e' : '#3fae8a';
    return `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#eef1f7" stroke-width="9" fill="#fff"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round"
       stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - frac)}" style="transition: stroke-dashoffset .25s linear"/></svg>
      <div class="t-num">${sec}</div>`;
  };

  C.chars = (s) => [...String(s || '')].length;

  window.TD = C;
})();

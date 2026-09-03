/* ===== VideoMaker - app.js ===== */
(function () {
  'use strict';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  /* ---------------- state ---------------- */
  const S = {
    scenes: [],
    topic: '',
    playing: false,
    videoT: 0,
    rafId: 0,
    lastTs: 0,
    t0: 0,
    activeSources: [],
    bgmNodes: {},
    exportJob: null,
    ttsEnabled: true,
    bgmMode: 'none',
    bgmBuffer: null,
    bgmFileUrl: null,
    narrReady: false,
    ttsLoading: false,
    audioCtx: null,
    speechReady: false,
    totalDur: 0,
  };

  /* ---------------- tiny helpers ---------------- */
  const byId = (id) => document.getElementById(id);
  const fmtTime = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  };
  const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function showToast(msg, kind) {
    const t = byId('toast');
    t.textContent = msg;
    t.classList.toggle('error', kind === 'error');
    t.classList.toggle('ok', kind === 'ok');
    t.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  /* ---------------- script handling ---------------- */
  const TOPICS = [
    'space exploration', 'the history of coffee', 'why we dream', 'ocean mysteries',
    'the science of sleep', 'ancient cities', 'electric cars', 'how bees communicate',
    'the future of food', 'the psychology of color'
  ];
  const HOOKS = [
    (t) => 'Have you ever wondered about ' + t + '? ',
    (t) => cap(t + '. Every day, millions of people encounter it without a second thought. '),
    (t) => 'There is a lot more going on with ' + t + ' than most people realize. ',
    (t) => 'It sounds almost too strange to believe, but ' + t + ' is full of surprises. '
  ];
  const EXPANDS = [
    (t) => 'To understand ' + t + ', we should start with the basics. ',
    (t) => 'Experts who study ' + t + ' have found some remarkable patterns. ',
    (t) => 'Let us look closer at ' + t + ' and unpack what is really happening. ',
    (t) => 'The story of ' + t + ' goes back further than you might think. '
  ];
  const FACTS = [
    (t) => 'One little-known detail is that ' + t + ' affects the world in ways we rarely notice. ',
    (t) => 'Research on ' + t + ' has changed the way scientists think about the topic. ',
    (t) => 'Many people are surprised to learn how ' + t + ' connects to everyday life. ',
    (t) => 'Behind the scenes, ' + t + ' depends on a delicate balance of forces and timing. '
  ];
  const CLOSERS = [
    (t) => 'So the next time someone brings up ' + t + ', you will know exactly what to say. ',
    (t) => 'And that is why ' + t + ' deserves a little more of your attention. ',
    (t) => 'Understanding ' + t + ' makes the world feel smaller and more interesting. ',
    (t) => 'Now you have the full picture of ' + t + ' - and it is quite a story. '
  ];

  function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function generateScript(topic) {
    const t = String(topic | '').trim().replace(/[.!?。！？]+$/,'');
    if (!t) return '';
    return [
      pick(HOOKS)(t),
      pick(EXPANDS)(t),
      pick(FACTS)(t),
      pick(CLOSERS)(t)
    ].join('\n\n');
  }

  function splitScript(text) {
    return String(text).split(/(?<=[.!?。！？])\s+/).map((s) => s.trim()).filter((s) => s.length > 1);
  }

  function applyScript(text) {
    const sentences = splitScript(text);
    if (!sentences.length) { showToast('Script is empty - nothing to animate.', 'error'); return false; }
    S.scenes = sentences.map((txt) => ({ text: txt }));
    S.scenes.forEach((sc) => { sc.buffer = null; sc.narrDur = 0; });
    computeDurations();
    if (S.ttsEnabled && S.speechReady) generateNarration(true).catch(() => {});
    S.videoT = 0;
    rebuildSceneList();
    drawFrame(0);
    showToast('Applied ' + S.scenes.length + ' scene' + (S.scenes.length > 1 ? 's' : '') + ' - press Play or export', 'ok');
    return true;
  }

  function rebuildSceneList() {
    const list = byId('sceneList');
    list.innerHTML = '';
    S.scenes.forEach((sc, i) => {
      const row = document.createElement('div');
      row.className = 'scene-row';
      const idx = document.createElement('div');
      idx.className = 'scene-idx';
      idx.textContent = String(i + 1);
      const txt = document.createElement('div');
      txt.className = 'scene-txt';
      txt.textContent = sc.text;
      txt.title = sc.text;
      const dur = document.createElement('div');
      dur.className = 'scene-dur';
      dur.textContent = '0:00';
      row.appendChild(idx);
      row.appendChild(txt);
      row.appendChild(dur);
      row.addEventListener('click', () => seekTo(sc.start | 0));
      list.appendChild(row);
    });
    byId('sceneCount').textContent = S.scenes.length
      ? String(S.scenes.length) + ' scene' + (S.scenes.length > 1 ? 's' : '') + ' - click a scene to seek'
      : '';
  }

  /* ---------------- TTS (meSpeak) ---------------- */
  function loadSpeechEngine() {
    if (S.ttsLoading || S.speechReady) return;
    S.ttsLoading = true;
    setTtsStatus('Loading speech engine (eSpeak)...');
    try {
      meSpeak.loadVoice('en/en-us', (ok, msg) => {
        S.ttsLoading = false;
        if (ok) {
          S.speechReady = true;
          setTtsStatus('eSpeak ready - narration enabled.', true);
          if (S.scenes.length && S.ttsEnabled) generateNarration(true).catch(() => {});
        } else {
          setTtsStatus('eSpeak voice failed to load (' + msg + '). Narration disabled.');
        }
      });
    } catch (e) {
      S.ttsLoading = false;
      setTtsStatus('Speech engine unavailable: ' + e.message);
    }
  }
  function setTtsStatus(msg, readyFlag) {
    const el = byId('ttsStatus');
    el.textContent = msg;
    el.classList.toggle('ready', !!readyFlag);
  }

  async function generateNarration(regenerate) {
    if (S.exportJob) return;
    const enabled = S.ttsEnabled && S.speechReady;
    S.narrReady = false;
    const pitch = Number(byId('pitchSlider').value);
    const speed = Number(byId('speedSlider').value);
    for (let i = 0;i<S.scenes.length;i++) {
      const sc = S.scenes[i];
      if (!enabled) { sc.buffer = null; sc.narrDur = 0; continue; }
      const wavDataUrl = await new Promise((resolveCb) => {
        const opts = { rawdata: 'data-url', pitch: pitch, speed: speed, amplitude: 110 };
        try {
          const id = meSpeak.speak(sc.text, opts, (ok, jobId, data) => {
            if (!ok || !data) { resolveCb(null); return; }
            resolveCb(data);
          });
          if (!id) resolveCb(null);
        } catch (e) { resolveCb(null); }
        setTimeout(() => resolveCb(null), 20000);  // safety timeout, meSpeak queues
      });
      if (!wavDataUrl) { sc.buffer = null; sc.narrDur = 0; continue; }
      try {
        const audioCtx = ensureAudio();
        const resp = await fetch(wavDataUrl);
        const ab = await resp.arrayBuffer();
        sc.buffer = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej));
        sc.narrDur = sc.buffer ? sc.buffer.duration : 0;
      } catch (e) { sc.buffer = null; sc.narrDur = 0; }
    }
    S.narrReady = true;
    computeDurations();
    if (regenerate) drawFrame(S.videoT);
  }

  function estimateNarrTime(text) {
    const words = String(text).trim().split(/\s+/).length;
    return clampNum(2 + words * 0.32, 2, 14);
  }

  function computeDurations() {
    let t = 0;
    S.scenes.forEach((sc) => {
      const narr = sc.narrDur > 0 ? sc.narrDur : estimateNarrTime(sc.text);
      sc.dur = clampNum(narr + 0.55,  1.6, 18);
      sc.start = t;
      t += sc.dur;
      sc.words = wordTimings(sc.text, narr, sc.dur);
    });
    S.totalDur = t;
    renderTicks();
    updateSceneDurations();
  }

  function wordTimings(text, narrDur, totalDur) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const total = narrDur > 0 ? narrDur : totalDur;
    const perWord = total / words.length;
    const pad = Math.max(0, (totalDur - total)) / 2;
    const out = [];
    words.forEach((word, i) => { out.push({ word: word, t: pad + i * perWord, d: perWord }); });
    return out;
  }

  function updateSceneDurations() {
    document.querySelectorAll('.scene-dur').forEach((el, i) => {
      const sc = S.scenes[i];
      el.textContent = sc ? fmtTime(sc.dur | 0) : '';
    });
  }

  function renderTicks() {
    const ticks = byId('sceneTicks');
    ticks.innerHTML = '';
    if (!S.scenes.length) return;
    S.scenes.forEach((sc) => {
      const mark = document.createElement('i');
      mark.style.left = (sc.start / S.totalDur * 100) + '%';
      ticks.appendChild(mark);
    });
  }

  /* ---------------- audio graph ---------------- */
  function ensureAudio() {
    if (S.audioCtx) {
      if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
      return S.audioCtx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    S.audioCtx = new AC();
    S.masterGain = S.audioCtx.createGain();
    S.masterGain.connect(S.audioCtx.destination);
    S.bgmGain = S.audioCtx.createGain();
    S.bgmGain.connect(S.masterGain);
    S.narrGain = S.audioCtx.createGain();
    S.narrGain.connect(S.masterGain);
    applyVolumes();
    return S.audioCtx;
  }
  function applyVolumes() {
    if (S.narrGain) S.narrGain.gain.value = Math.pow(Number(byId('ttsVol').value) / 100, 1.6);
    if (S.bgmGain) S.bgmGain.gain.value = Math.pow(Number(byId('bgmVol').value) / 100,  1.4) * 0.9;
  }

  /* procedural ambient pad - seamless 16 s loop, generated once */
  function buildProceduralBGM() {
    if (S.bgmBuffer && S.bgmBuffer.isProcedural) return;
    const ac = ensureAudio();
    if (!ac) return;
    const loopDur = 16;
    const sr = ac.sampleRate;
    const len = Math.floor(sr * loopDur);
    const buf = ac.createBuffer(2, len, sr);
    const notes = [110.00, 130.81, 164.81, 196.00, 220.00, 246.94, 293.66, 329.63];
    const chordFrq = [notes[0], notes[3], notes[5], notes[6]];
    for (let ch = 0; ch < 2; ch++) {
      const channel = buf.getChannelData(ch);
      let prev = 0;
      for (let i = 0;i<len;i++) {
        const t = i / sr;
        let v = 0;
        chordFrq.forEach((f, ci) => {
          const detune = 1 + (ch === 0 ? 1 : -1) * 0.0012;
          const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 0.17 * t + ci * 2.1);
          const attack = clampNum(t / 3, 0, 1);
          v += Math.sin(2 * Math.PI * f * detune * vib * t) * 0.16 * attack;
        });
        v += (Math.random() * 2 -  1) * 0.008;
        prev = prev * 0.88 + v * 0.12;
        channel[i] = prev;
      }
      const fade = Math.min(800, len) ;
      for (let i = 0;i<fade;i++) {
        const g = i / fade;
        channel[i] *= g;
        channel[len - 1 - i] *= g;
      }
    }
    buf.isProcedural = true;
    S.bgmBuffer = buf;
  }

  /* ---------------- BGM control ---------------- */
  function startBGM() {
    const ac = ensureAudio();
    if (!ac || S.bgmMode === 'none') return;
    if (S.bgmMode === 'proc') buildProceduralBGM();
    const source = S.bgmBuffer ? ac.createBufferSource() : null;
    if (!source) return;
    source.buffer = S.bgmBuffer;
    source.loop = true;
    source.connect(S.bgmGain);
    source.start(ac.currentTime);
    S.bgmNodes.source = source;
  }
  function stopBGM() {
    if (S.bgmNodes.source) {
      try { S.bgmNodes.source.stop(); } catch (e) {}
      try { S.bgmNodes.source.disconnect(); } catch (e) {}
      S.bgmNodes.source = null;
    }
  }

  /* schedule narration sources for current playback position */
  function scheduleNarration(fromVideoT, epochCtxTime) {
    stopNarration();
    const ac = ensureAudio();
    if (!ac) return;
    S.activeSources = [];
    S.scenes.forEach((sc) => {
      if (!sc.buffer) return;
      const offset = sc.start - fromVideoT;
      if (offset < -(sc.dur + 1)) return;
      const src = ac.createBufferSource();
      src.buffer = sc.buffer;
      src.connect(S.narrGain);
      const startAt = epochCtxTime + Math.max(0, offset);
      const skipFrom = Math.max(0, -offset);
      src.start(startAt, skipFrom);
      S.activeSources.push(src);
    });
  }
  function stopNarration() {
    S.activeSources.forEach((src) => {
      try { src.stop(); } catch (e) {}
      try { src.disconnect(); } catch (e) {}
    });
    S.activeSources = [];
  }

  function fullStop() {
    stopNarration();
    stopBGM();
    if (S.rafId) cancelAnimationFrame(S.rafId);
    S.rafId = 0;
    S.playing = false;
    byId('playBtn').textContent = '▶';
  }

  /* ---------------- scene drawing ---------------- */
  const PALETTES = [
    { g: ['#0f2027', '#203a43', '#2c5364'], accent: '#4bc0c9' },
    { g: ['#1a1333', '#392d68', '#5b3e8f'], accent: '#b57bff' },
    { g: ['#2b2024', '#55393b', '#8e4b4f'], accent: '#ff8c94' },
    { g: ['#0c2340', '#1d4e89', '#2e8bc0'], accent: '#7fd4ff' },
    { g: ['#1c2a12', '#3d5a1e', '#6b9440'], accent: '#b7e66a' },
    { g: ['#3a1f12', '#6b3a1c', '#a8612f'], accent: '#ffb36b' },
    { g: ['#1f1f2e', '#34344a', '#525272'], accent: '#a5a5ff' },
  ];

  function currentSceneIndex() {
    let idx = 0;
    for (let i = 0;i<S.scenes.length;i++) {
      const sc = S.scenes[i];
      if (S.videoT < sc.start + sc.dur) { idx = i; break; }
    }
    return idx;
  }

  function drawBackdrop(sc) {
    const t = performance.now() / 1000;
    const scDur = Math.max(sc.dur || 0, 0.1);
    const p = clampNum((S.videoT - (sc.start || 0)) / scDur,  0,  1);
    const zoom = 1.02 + 0.05 * p;
    const cx = W * 0.5;
    const cy = H * 0.45;
    const palette = pick(PALETTES);
const grd = ctx.createRadialGradient(cx, cy, 40, cx, cy, Math.max(W, H) * 0.75 * zoom);
    grd.addColorStop(0, palette.g[0]);
    grd.addColorStop(0.55, palette.g[1]);
    grd.addColorStop(1, palette.g[2]);
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,W,H);
    for (let i = 0;i<14;i++) {
      const seed = i * 137.5;
      const x = (Math.sin(t * 0.11 + seed) * 0.5 + 0.5) * (W + 180) - 90;
      const y = (Math.cos(t * 0.087 + seed * 1.3) * 0.5 +  0.5) * (H + 120) -  60;
      const r = 8 + (i % 5) * 6 + Math.sin(t * 0.5 + seed) * 3;
      ctx.globalAlpha = 0.05 + 0.05 * Math.sin(t * 0.4 + seed);
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const vg = ctx.createRadialGradient(W / 2, H / 2,H * 0.42,W / 2,H / 2,H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0,0,W,H);
  }

  function wrapText(text, maxWidth) {
    const words = String(text).split(/s+/);
    const lines = [];
    let cur = '';
    words.forEach((wd) => {
      const test = cur ? cur + ' ' + wd : wd;
      if (cur && ctx.measureText(test).width > maxWidth) {
        lines.push(cur);
        cur = wd;
      } else {
        cur = test;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function drawSubtitle(sc, idx, p) {
    const baseY = H - 96;
    const maxW = W - 260;
    const lines = wrapText(sc.text,maxW);
    const n = lines.length;
    const lh = 58;
    const blockH = n * lh + 24;
    const blockY = clampNum(baseY - (n - 1) * lh / 2, H * 0.44,H - blockH -  10);
    ctx.fillStyle = 'rgba(8,9,14,0.62)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    roundRect(0, blockY, W, blockH +  16, 18);
    ctx.fill();
    ctx.stroke();
    const num = sc.words ? sc.words.length : 0;
    let shown = num;
    if (num && sc.narrDur > 0) {
      shown = Math.round(num * clampNum(p, 0, 1));
    } else if (num) {
      shown = Math.round(num * clampNum((S.videoT - sc.start) / Math.max(sc.dur, 0.1)),0, 1);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 46px Inter, system-ui, sans-serif';
    let wi = 0;
    for (let li = 0; li < n; li++) {
      const lineWords = lines[li].split(/\s+/).filter(Boolean);
      const widths = lineWords.map((wd) => ctx.measureText(wd + ' ').width);
      const lineW = widths.reduce((a, b) => a + b, 0);
      let x = W / 2 - lineW / 2;
      const y = blockY + 18 + lh * li + lh / 2;
      lineWords.forEach((wd, wiIdx) => {
        const active = wi < shown;
        ctx.fillStyle = active ? '#ffffff' : 'rgba(255,255,255,0.62)';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillText(wd, x, y);
        ctx.shadowBlur = 0;
        x += widths[wiIdx];
        wi++;
      });
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawHeader(sc, idx) {
    const title = S.topic ? S.topic.toUpperCase() : 'VIDEOMAKER';
    roundRect(18, 20, 270, 64, 14);
    ctx.fillStyle = 'rgba(8,9,14,0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    ctx.fillText(fmtTime(S.videoT) + ' · Scene ' + (idx + 1) + '/' + S.scenes.length, 30, 58);
    ctx.font = '700 26px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,209,102,0.95)';
    ctx.fillText(title, 30, 58);
  }

  function drawWatermark() {
    if (!byId('watermarkToggle').checked) return;
    ctx.save();
    ctx.translate(W - 22,H - 20);
    ctx.fillStyle = 'rgba(255,209,102,0.9)';
    ctx.beginPath();
    ctx.moveTo(-14,-8);
    ctx.lineTo(-14, 8);
    ctx.lineTo(-2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '600 17px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('VideoMaker', -24, 4);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFrame(t) {
    S.videoT = clampNum(t, 0, S.totalDur || 0);
    const idx = currentSceneIndex();
    const sc = S.scenes[idx] || { text: "", dur: 0, start: 0 };
    drawBackdrop(sc);
    drawHeader(sc, idx);
    drawSubtitle(sc, idx, clampNum((S.videoT - sc.start) / Math.max(sc.dur, 0.1), 0, 1));
    drawWatermark();
    byId('playFill').style.width = (S.totalDur ? (S.videoT / S.totalDur * 100) : 0) + '%';
    byId("timeLabel").textContent = fmtTime(S.videoT) + " / " + fmtTime(S.totalDur);
    document.querySelectorAll('.scene-row').forEach((row, i) => {
      const sc2 = S.scenes[i];
      if (!sc2) return;
      row.classList.toggle('active', S.videoT >= sc2.start && S.videoT < sc2.start + sc2.dur);
    });
  }

  /* ---------------- playback loop ---------------- */
  function tick(ts) {
    if (!S.playing) return;
    if (!S.lastTs) S.lastTs = ts;
    const dt = (ts - S.lastTs) / 1000;
    S.lastTs = ts;
    const ac = S.audioCtx;
    if (ac && S.t0) {
      S.videoT = ac.currentTime - S.t0;
    } else {
      S.videoT += dt;
    }
    drawFrame(S.videoT);
    if (S.videoT >= S.totalDur) { finishPlayback(); return; }
    S.rafId = requestAnimationFrame(tick);
  }

  function startPlayback() {
    if (!S.scenes.length) { showToast('Add a script first.', 'error'); return; }
    if (!S.speechReady && S.ttsEnabled && !S.ttsLoading) loadSpeechEngine();
    let ac = ensureAudio();
    if (!ac) { showToast('This browser needs Web Audio for playback.', 'error'); return; }
    if (ac.state === 'suspended') ac.resume();
    if (S.videoT >= (S.totalDur || 1)) S.videoT = 0;
    S.t0 = ac.currentTime - S.videoT;
    scheduleNarration(S.videoT, ac.currentTime);
    startBGM();
    S.playing = true;
    S.lastTs = 0;
    byId('playBtn').textContent = '⏸';
    S.rafId = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (S.playing) pausePlayback(); else startPlayback();
  }

  function pausePlayback() { fullStop(); byId('playBtn').textContent = '▶'; }

  function finishPlayback() {
    fullStop();
    drawFrame(S.totalDur);
    showToast('Preview finished.', 'ok');
  }

  function seekTo(t) {
    const wasPlaying = S.playing;
    if (wasPlaying) fullStop();
    S.videoT = clampNum(t, 0, S.totalDur || 0);
    drawFrame(S.videoT);
    if (wasPlaying) startPlayback();
  }

  /* ---------------- export ---------------- */
  function pickMime() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (const m of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return 'video/webm';
  }

  async function exportVideo() {
    if (!S.scenes.length) { showToast('Add a script first.', 'error'); return; }
    if (S.exportJob) return;
    if (S.ttsEnabled && !S.narrReady) {
      showToast('Narration is still preparing - please wait...', 'error');
      return;
    }
    const ac = ensureAudio();
    if (!ac) { showToast('Web Audio is required for export.', 'error'); return; }
    if (ac.state === 'suspended') await ac.resume();

    const mime = pickMime();
    byId('formatInfo').textContent = mime;
    const stream = canvas.captureStream(30);
    let dest;
    try {
      dest = ac.createMediaStreamDestination();
    } catch (e) {
      showToast('Media stream destination failed: ' + e.message, 'error');
      return;
    }
    S.masterGain.connect(dest);
    const mixed = new MediaStream([].concat(stream.getVideoTracks(), dest.stream.getAudioTracks()));

    let recorder;
    try {
      recorder = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 });
    } catch (e) {
      S.masterGain.disconnect(dest);
      showToast('MediaRecorder unavailable: ' + e.message, 'error');
      return;
    }
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((resolveCb) => { recorder.onstop = () => resolveCb(new Blob(chunks, { type: mime.split(';')[0] })); });

    const exportDur = S.totalDur || 0.1;
    S.exportJob = { cancelled:false };
    byId('exportBtn').classList.add('hidden');
    byId('cancelExportBtn').classList.remove('hidden');
    byId('exportProgress').classList.remove('hidden');

    stopNarration();
    stopBGM();
    S.videoT = 0;
    S.t0 = ac.currentTime;
    const renderStart = performance.now();
    try {
      recorder.start(250);
    } catch (e) {
    }
    try {
      scheduleNarration(0, ac.currentTime);
    } catch (e) {
    }
    try {
      startBGM();
    } catch (e) {
    }

    function renderLoop() {
      if (S.exportJob.cancelled) {
        try { recorder.stop(); } catch (e) {}
        return;
      }
      const elapsed = (performance.now() - renderStart) / 1000;
      S.videoT = clampNum(elapsed, 0, exportDur);
      drawFrame(S.videoT);
      const pct = exportDur ? S.videoT / exportDur : 0;
      byId('exportFill').style.width = (pct * 100) + '%';
      byId("exportLabel").textContent = "Rendering " + Math.floor(pct * 100) + "% - " + fmtTime(elapsed) + " / " + fmtTime(exportDur);
      if (S.videoT >= exportDur) {
        try { recorder.stop(); } catch (e) {}
        return;
      }
      requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    const blob = await done;
    stopBGM();
    stopNarration();
    S.masterGain.disconnect(dest);
    byId('exportBtn').classList.remove('hidden');
    byId('cancelExportBtn').classList.add('hidden');
    byId('exportProgress').classList.add('hidden');
    if (S.exportJob.cancelled) {
      S.exportJob = null;
      showToast('Export cancelled.', 'ok');
      return;
    }
    S.exportJob = null;
    const url = URL.createObjectURL(blob);
    byId('resultVideo').src = url;
    byId('resultMeta').textContent = (blob.size / 1024 / 1024).toFixed(1) + ' MB - webm';
    byId('downloadLink').href = url;

    byId('resultVideo').play().catch(() => {});
    showToast('Video rendered!', 'ok');
  }

  /* ---------------- UI wiring ---------------- */
  function bindEvents() {
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
        byId(btn.dataset.tab).classList.remove('hidden');
      });
    });

    byId('genScriptBtn').addEventListener('click', () => {
      let topic = byId('topicInput').value.trim();
      if (!topic) topic = pick(TOPICS);
      byId('topicInput').value = topic;
      const script = generateScript(topic);
      byId('scriptInput').value = script;
      applyScript(script);
    });

    byId('applyScriptBtn').addEventListener('click', () => {
      S.videoT = 0;
      fullStop();
      applyScript(byId('scriptInput').value);
      if (S.ttsEnabled) {
        setTtsStatus('Regenerating narration...');
        generateNarration(true);
      }
    });

    byId('scriptInput').addEventListener('input', () => {
      const n = splitScript(byId('scriptInput').value).length;
      byId('sceneCount').textContent = n ? n + ' sentence' + (n > 1 ? 's' : '') + ' ready - press Apply' : '';
    });

    byId('narrationToggle').addEventListener('change', (e) => {
      S.ttsEnabled = e.target.checked;
      byId('pitchSlider').disabled = byId('speedSlider').disabled = byId('voiceSelect').disabled = !e.target.checked;
      if (e.target.checked && !S.speechReady && !S.ttsLoading) loadSpeechEngine();
    });

    byId('pitchSlider').addEventListener('input', (e) => {
      byId('pitchVal').textContent = e.target.value;
    });
    byId('speedSlider').addEventListener('input', (e) => {
      byId('speedVal').textContent = e.target.value;
    });
    byId('ttsVol').addEventListener('input', (e) => {
      byId('ttsVolVal').textContent = e.target.value + '%';
      applyVolumes();
    });
    byId('bgmVol').addEventListener('input', (e) => {
      byId('bgmVolVal').textContent = e.target.value + '%';
      applyVolumes();
    });

    byId('bgmSelect').addEventListener('change', (e) => {
      const v = e.target.value;
      S.bgmMode = v;
      byId('bgmFile').classList.toggle('hidden', v !== 'file');
      if (v === 'file') {
        const f = byId('bgmFile').files[0];
        byId('bgmInfo').textContent = f ? 'Loaded: ' + f.name : 'Choose an audio file...';
      } else if (v === 'proc') {
        buildProceduralBGM();
        byId('bgmInfo').textContent = 'Procedural ambient pad (16 s seamless loop) - generated in-browser';
      } else {
        stopBGM();
        S.bgmBuffer = null;
        byId('bgmInfo').textContent = 'No background music selected.';
      }
      if (S.playing && v !== 'none') startBGM();
    });

    byId('bgmFile').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const reader = new FileReader();
      reader.onload = () => {
        const ac = ensureAudio();
        ac.decodeAudioData(reader.result, (buf) => {
          S.bgmBuffer = buf;
          S.bgmMode = 'file';
          byId('bgmInfo').textContent = 'Loaded: ' + f.name + ' (' + Math.round(buf.duration) + ' s)';
          if (S.playing) startBGM();
        },() => showToast('Could not decode that audio file.', 'error'));
      };
      reader.readAsArrayBuffer(f);
    });

    byId('playBtn').addEventListener('click', togglePlay);
    byId('timeline').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const p = (e.clientX - rect.left) / rect.width;
      seekTo(p * (S.totalDur || 0));
    });

    byId('exportBtn').addEventListener('click', exportVideo);
    byId('cancelExportBtn').addEventListener('click', () => {
      if (S.exportJob) S.exportJob.cancelled = true;
    });

    ['pointerdown', 'keydown'].forEach((ev) => {
      window.addEventListener(ev, () => {
        if (S.ttsEnabled && !S.speechReady && !S.ttsLoading) loadSpeechEngine();
      });
    });
    if (S.ttsEnabled && !S.speechReady && !S.ttsLoading) setTimeout(loadSpeechEngine, 600);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    bindEvents();
    const sample = [
    'Have you ever noticed how quickly a day disappears while you work on something you love?',
    'That feeling has a name - flow - and scientists have been studying it for decades.',
    'When you are fully absorbed in a task, your sense of time literally bends.',
    'And that is why the best work often feels like the shortest afternoon.'
  ];
  
const sampleText = sample.join('\n\n');
    byId('scriptInput').value = sampleText;
    byId('topicInput').value = 'Flow state and the psychology of time';
    applyScript(sampleText);
    drawFrame(0);
  }

  boot();
})();
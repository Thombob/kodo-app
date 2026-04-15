'use strict';

/* ═══════════════════════════════════════════════════════════
   J.A.R.V.I.S. — Frontend Controller
   Handles: Speech Recognition · TTS · Streaming API · HUD UI
   ═══════════════════════════════════════════════════════════ */

// ── Constants ────────────────────────────────────────────────
const MAX_HISTORY = 20;   // Keep last 20 messages (10 turns)
const WAVEFORM_BARS = 24;
const BOOT_LINES = [
  'Initializing J.A.R.V.I.S. core systems…',
  'Loading neural inference modules…',
  'Connecting to Claude Opus 4.6…',
  'All systems nominal. Good day.',
];

// ── State ────────────────────────────────────────────────────
let state = 'standby';   // standby | listening | processing | speaking
let conversationHistory = [];
let queryCount = 0;
let startTime = Date.now();
let recognition = null;
let synth = window.speechSynthesis;
let selectedVoice = null;
let speechSupported = false;
let isSpeaking = false;
let currentUtterance = null;
let currentFullResponse = '';

// ── DOM References ───────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  statusDot:    $('statusDot'),
  statusLabel:  $('statusLabel'),
  apiBadge:     $('apiBadge'),
  reactor:      $('reactor'),
  waveform:     $('waveform'),
  waveLabel:    $('waveLabel'),
  uptime:       $('uptime'),
  queryCount:   $('queryCount'),
  tokenCount:   $('tokenCount'),
  transcript:   $('transcript'),
  liveResponse: $('liveResponse'),
  liveText:     $('liveText'),
  textInput:    $('textInput'),
  sendBtn:      $('sendBtn'),
  micBtn:       $('micBtn'),
  micLabel:     $('micLabel'),
  clearBtn:     $('clearBtn'),
  footerStatus: $('footerStatus'),
  noSpeechNotice: $('noSpeechNotice'),
};

// ── Waveform Setup ───────────────────────────────────────────
function buildWaveform() {
  els.waveform.innerHTML = '';
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    const bar = document.createElement('div');
    bar.className = 'waveform-bar';
    bar.style.animationDelay = `${(i / WAVEFORM_BARS) * 2}s`;
    bar.style.animationDuration = `${1.2 + Math.random() * 0.8}s`;
    els.waveform.appendChild(bar);
  }
  els.waveform.className = 'waveform idle';
}

// ── State Machine ────────────────────────────────────────────
function setState(newState) {
  state = newState;

  // Status chip
  els.statusDot.className = 'status-dot';
  const labels = {
    standby:    ['STANDBY',    '',           'standby'],
    listening:  ['LISTENING',  'listening',  'listening'],
    processing: ['PROCESSING', 'processing', 'processing'],
    speaking:   ['SPEAKING',   'speaking',   'speaking'],
  };
  const [label, dotClass, waveClass] = labels[newState] || labels.standby;
  els.statusLabel.textContent = label;
  if (dotClass) els.statusDot.classList.add(dotClass);

  // Reactor
  els.reactor.className = 'reactor ' + (newState === 'standby' ? '' : newState);

  // Waveform
  const waveMap = {
    standby:    'idle',
    listening:  'listen',
    processing: 'process',
    speaking:   'speak',
  };
  els.waveform.className = 'waveform ' + (waveMap[newState] || 'idle');

  // Waveform label
  const waveLabelMap = {
    standby:    '——— AUDIO INPUT ———',
    listening:  '——— LISTENING ———',
    processing: '——— PROCESSING ———',
    speaking:   '——— JARVIS OUTPUT ———',
  };
  els.waveLabel.textContent = waveLabelMap[newState] || '——— AUDIO INPUT ———';

  // Mic button appearance
  els.micBtn.className = 'mic-btn ' + (
    newState === 'listening'  ? 'active'     :
    newState === 'processing' ? 'processing' :
    newState === 'speaking'   ? 'processing' : ''
  );
  els.micLabel.textContent =
    newState === 'listening'  ? 'LISTENING…' :
    newState === 'processing' ? 'PROCESSING…' :
    newState === 'speaking'   ? 'SPEAKING…' : 'ACTIVATE VOICE';

  // Footer
  const footerMap = {
    standby:    'ALL SYSTEMS NOMINAL',
    listening:  'VOICE INPUT ACTIVE — SPEAK NOW',
    processing: 'CONSULTING CLAUDE OPUS 4.6…',
    speaking:   'RENDERING RESPONSE…',
  };
  els.footerStatus.textContent = footerMap[newState] || '';

  // Input lock
  const locked = (newState !== 'standby');
  els.sendBtn.disabled = locked;
  els.textInput.disabled = locked;
}

// ── Transcript ───────────────────────────────────────────────
function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const senderEl = document.createElement('div');
  senderEl.className = 'msg-sender';
  senderEl.textContent =
    role === 'user'   ? 'YOU' :
    role === 'jarvis' ? 'J.A.R.V.I.S.' :
    role === 'error'  ? '⚠ ERROR' : 'SYSTEM';

  const contentEl = document.createElement('div');
  contentEl.className = 'msg-content';
  contentEl.textContent = text;

  wrap.appendChild(senderEl);
  wrap.appendChild(contentEl);
  els.transcript.appendChild(wrap);
  scrollTranscript();
}

function addSystemMessage(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg system';
  const contentEl = document.createElement('div');
  contentEl.className = 'msg-content';
  contentEl.textContent = text;
  wrap.appendChild(contentEl);
  els.transcript.appendChild(wrap);
  scrollTranscript();
}

function scrollTranscript() {
  requestAnimationFrame(() => {
    els.transcript.scrollTop = els.transcript.scrollHeight;
  });
}

// ── Live Response ────────────────────────────────────────────
function showLiveResponse() {
  currentFullResponse = '';
  els.liveText.textContent = '';
  els.liveResponse.style.display = 'flex';
}

function appendLiveText(chunk) {
  currentFullResponse += chunk;
  els.liveText.textContent = currentFullResponse;
  scrollTranscript();
}

function hideLiveResponse() {
  els.liveResponse.style.display = 'none';
  els.liveText.textContent = '';
}

// ── API Call (SSE Streaming) ─────────────────────────────────
async function sendToJarvis(userText) {
  if (!userText.trim()) return;

  queryCount++;
  els.queryCount.textContent = queryCount;

  // Add to history + transcript
  conversationHistory.push({ role: 'user', content: userText });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY);
  }
  addMessage('user', userText);

  setState('processing');
  showLiveResponse();

  let fullText = '';

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(errBody.error || `HTTP ${resp.status}`);
    }

    // Read SSE stream
    setState('speaking');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'text') {
            fullText += data.text;
            appendLiveText(data.text);
          } else if (data.type === 'error') {
            throw new Error(data.message);
          } else if (data.type === 'done') {
            break;
          }
        } catch (e) {
          // Ignore parse errors on individual SSE lines
        }
      }
    }

    // Commit response
    hideLiveResponse();
    conversationHistory.push({ role: 'assistant', content: fullText });
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }
    addMessage('jarvis', fullText);

    // Speak it
    if (fullText) {
      await speakText(fullText);
    }

  } catch (err) {
    console.error('[JARVIS]', err);
    hideLiveResponse();
    addMessage('error', err.message || 'Connection error.');
  } finally {
    setState('standby');
  }
}

// ── Text-to-Speech ───────────────────────────────────────────
function loadVoices() {
  const voices = synth.getVoices();
  if (!voices.length) return;

  // Priority list for best Jarvis voice
  const preferred = [
    'Google UK English Male',
    'Microsoft George',
    'Microsoft George - English (United Kingdom)',
    'Daniel (Enhanced)',
    'Daniel',
    'Alex',
    'en-GB',
    'Google UK English Female',
    'Microsoft Zira',
  ];

  for (const name of preferred) {
    const found = voices.find(v =>
      v.name.toLowerCase().includes(name.toLowerCase()) ||
      v.lang === name
    );
    if (found) { selectedVoice = found; return; }
  }
  // Fallback: any English voice
  selectedVoice = voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
}

function speakText(text) {
  return new Promise(resolve => {
    if (!synth) return resolve();

    // Cancel any ongoing speech
    synth.cancel();

    // Clean text for speech — remove URLs, trim whitespace
    const clean = text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^\w\s.,!?;:'"()\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return resolve();

    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate  = 0.92;
    utter.pitch = 0.85;
    utter.volume = 1.0;
    if (selectedVoice) utter.voice = selectedVoice;

    utter.onend = () => {
      isSpeaking = false;
      resolve();
    };
    utter.onerror = () => {
      isSpeaking = false;
      resolve();
    };

    isSpeaking = true;
    currentUtterance = utter;
    synth.speak(utter);
  });
}

// ── Speech Recognition ───────────────────────────────────────
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    speechSupported = false;
    els.noSpeechNotice.style.display = 'block';
    els.micBtn.style.display = 'none';
    return;
  }

  speechSupported = true;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    setState('listening');
  };

  recognition.onresult = event => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      sendToJarvis(transcript);
    } else {
      setState('standby');
    }
  };

  recognition.onerror = event => {
    if (event.error === 'no-speech') {
      addSystemMessage('No speech detected. Please try again.');
    } else if (event.error === 'not-allowed') {
      addSystemMessage('Microphone access denied. Use text input below.');
      els.noSpeechNotice.style.display = 'block';
    } else {
      addSystemMessage(`Voice error: ${event.error}`);
    }
    setState('standby');
  };

  recognition.onend = () => {
    if (state === 'listening') {
      setState('standby');
    }
  };
}

function toggleVoice() {
  if (!speechSupported || !recognition) return;
  if (state === 'listening') {
    recognition.stop();
    setState('standby');
  } else if (state === 'standby') {
    // Stop any ongoing TTS before listening
    if (isSpeaking) { synth.cancel(); isSpeaking = false; }
    try {
      recognition.start();
    } catch (e) {
      // Recognition might already be started
    }
  }
}

// ── Text Input Handler ───────────────────────────────────────
function handleTextSubmit() {
  const text = els.textInput.value.trim();
  if (!text || state !== 'standby') return;
  els.textInput.value = '';
  sendToJarvis(text);
}

// ── API Health Check ─────────────────────────────────────────
async function checkApiStatus() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.apiKey) {
      els.apiBadge.textContent = 'API ONLINE';
      els.apiBadge.className = 'api-badge online';
    } else {
      els.apiBadge.textContent = 'NO API KEY';
      els.apiBadge.className = 'api-badge error';
      addMessage('error',
        'ANTHROPIC_API_KEY not set. Please create a .env file with your key and restart the server.');
    }
  } catch {
    els.apiBadge.textContent = 'API ERROR';
    els.apiBadge.className = 'api-badge error';
    addMessage('error', 'Could not connect to the J.A.R.V.I.S. server. Is it running?');
  }
}

// ── Uptime Counter ───────────────────────────────────────────
function updateUptime() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  els.uptime.textContent = `${h}:${m}:${s}`;
}

// ── Boot Sequence ────────────────────────────────────────────
async function runBootSequence() {
  for (const line of BOOT_LINES) {
    await new Promise(r => setTimeout(r, 350));
    addSystemMessage(line);
  }
}

// ── Event Listeners ──────────────────────────────────────────
function attachEvents() {
  // Mic button
  els.micBtn.addEventListener('click', toggleVoice);

  // Send button
  els.sendBtn.addEventListener('click', handleTextSubmit);

  // Enter key in text input
  els.textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  });

  // Spacebar shortcut for voice (when not typing)
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && document.activeElement !== els.textInput) {
      e.preventDefault();
      toggleVoice();
    }
  });

  // Clear button
  els.clearBtn.addEventListener('click', () => {
    els.transcript.innerHTML = '';
    conversationHistory = [];
    queryCount = 0;
    els.queryCount.textContent = '0';
    addSystemMessage('Conversation cleared.');
  });

  // Voice loading (some browsers fire this late)
  if (synth) {
    synth.onvoiceschanged = loadVoices;
    loadVoices(); // Also try immediately
  }
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  buildWaveform();
  setState('standby');
  initSpeechRecognition();
  attachEvents();

  // Uptime ticker
  setInterval(updateUptime, 1000);

  // Boot sequence
  await runBootSequence();

  // API health check (after boot messages)
  await checkApiStatus();
}

document.addEventListener('DOMContentLoaded', init);

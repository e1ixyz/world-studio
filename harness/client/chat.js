// The Claude panel: prompt live code changes to this project. Loaded only by the dev server
// (injected into play.html by harness/server/plugin.js) before the game, so it keeps working if
// the game crashes.
import '../../engine/ui/tokens.css';
import './chat.css';
import { icons } from '../../engine/build/icons.js';

const SLUG = location.pathname.match(/^\/play\/([\w-]+)/)?.[1] || new URLSearchParams(location.search).get('game') || '';
const OPEN_KEY = `devchat:open:${SLUG}`;
const CAM_KEY = 'devchat:camera-context';
const API = `/__harness/chat/${SLUG}`;

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// tiny markdown: code blocks, inline code, bold, line breaks
const md = (s) => esc(s)
  .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c) => `<pre>${c.trim()}</pre>`)
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  .replace(/\n/g, '<br>');
const secs = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

const root = el('div', 'dc-root');
root.innerHTML = `
  <button type="button" class="dc-tab" title="Show Claude (\`)"><span class="dc-tab-dot"></span>Claude <span class="ws-kbd">\`</span></button>
  <button type="button" class="dc-feed" title="Show Claude"><span class="dc-spin"></span><span class="dc-feed-text"></span></button>
  <form class="dc-quick" autocomplete="off">
    <span class="dc-quick-label">Claude</span>
    <input type="text" placeholder="Describe a change. Enter sends, Esc cancels." maxlength="4000" aria-label="Quick prompt">
  </form>
  <aside class="dc-panel" aria-label="Claude">
    <header class="dc-head">
      <div class="dc-head-top">
        <h2>Claude</h2>
        <span class="dc-offline">Dev server offline</span>
        <button type="button" class="ws-icon dc-menu-btn" aria-haspopup="menu" aria-label="More">${icons.more}</button>
        <button type="button" class="ws-icon dc-close" aria-label="Hide Claude" title="Hide (\`)">${icons.close}</button>
        <div class="dc-menu hidden" role="menu">
          <button type="button" role="menuitemcheckbox" aria-checked="false" class="dc-menu-engine">${icons.warn}<span><b>Allow engine edits</b><small>For the next prompt only. Engine changes affect every game.</small></span></button>
          <button type="button" role="menuitem" class="dc-menu-new">${icons.plus}<span><b>New conversation</b><small>Claude forgets this chat. Checkpoints stay.</small></span></button>
        </div>
      </div>
      <div class="dc-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-tab="chat">Chat</button>
        <button type="button" role="tab" aria-selected="false" data-tab="history">Checkpoints</button>
      </div>
    </header>
    <div class="dc-log ws-scroll" role="log"></div>
    <div class="dc-history ws-scroll hidden"></div>
    <div class="dc-working">
      <span class="dc-spin"></span>
      <div class="dc-working-text"><b>Claude is working</b><span class="dc-working-step"></span></div>
      <span class="dc-elapsed"></span>
      <button type="button" class="ws-btn sm dc-stop">${icons.stop}<span>Stop</span></button>
    </div>
    <form class="dc-form">
      <div class="dc-chips"></div>
      <textarea rows="3" placeholder="Describe a change…" aria-label="Prompt"></textarea>
      <div class="dc-row">
        <span class="dc-keys">Enter to send · Shift+Enter for a new line</span>
        <button type="submit" class="ws-btn primary dc-send">${icons.send}<span>Send</span></button>
      </div>
    </form>
  </aside>`;

const $ = (s) => root.querySelector(s);
const panel = $('.dc-panel'), log = $('.dc-log'), historyEl = $('.dc-history'), form = $('.dc-form'), input = $('.dc-form textarea');
const sendBtn = $('.dc-send'), elapsedEl = $('.dc-elapsed'), stepEl = $('.dc-working-step'), chipsEl = $('.dc-chips');
const quick = $('.dc-quick'), quickInput = $('.dc-quick input'), feed = $('.dc-feed'), feedText = $('.dc-feed-text');
const menu = $('.dc-menu'), engineItem = $('.dc-menu-engine');
const attachments = { shot: null };
let running = false, startedAt = 0, lastSeq = 0, isOpen = false, live = false, feedTimer = 0;
let engineArmed = false, dismissedSel = '', tab = 'chat';
let cameraContext = true;
try { cameraContext = localStorage.getItem(CAM_KEY) !== '0'; } catch { /* default on */ }
const seenErrors = new Set();

function mount() {
  document.body.appendChild(root);
  let wanted = false;
  try { wanted = sessionStorage.getItem(OPEN_KEY) === '1'; } catch { /* storage blocked */ }
  if (wanted) open(false);
  renderEmpty();
}
if (document.body) mount();
else document.addEventListener('DOMContentLoaded', mount);

// The game pauses its controls only while one of these text boxes has focus.
const typingEvent = (on) => window.dispatchEvent(new CustomEvent(on ? 'devchat:focus' : 'devchat:blur'));
for (const box of [input, quickInput]) {
  box.addEventListener('focus', () => typingEvent(true));
  box.addEventListener('blur', () => typingEvent(false));
}
const isTyping = (t) => !!t?.closest?.('input, textarea, select, [contenteditable]');
const gameState = () => window.__game?.state;

function open(focus = true) {
  isOpen = true;
  root.classList.add('open');
  document.body.classList.add('devchat-open');
  try { sessionStorage.setItem(OPEN_KEY, '1'); } catch { /* ignore */ }
  hideQuick();
  updateFeed();
  if (focus) {
    input.focus(); // focus first so the game treats the lost pointer lock as typing, not pausing
    document.exitPointerLock?.();
  }
  scrollDown();
}
function close() {
  isOpen = false;
  root.classList.remove('open');
  document.body.classList.remove('devchat-open');
  try { sessionStorage.setItem(OPEN_KEY, '0'); } catch { /* ignore */ }
  input.blur();
  closeMenu();
  updateFeed();
}
function focusComposer() {
  setTab('chat');
  dismissedSel = '';
  renderChips();
  open(true);
}
window.devchat = {
  open,
  close,
  focusComposer,
  isOpen: () => isOpen,
  // attach({ kind: 'shot', path, thumb }): added to the next prompt
  attach(a) {
    if (a.kind === 'shot') attachments.shot = a;
    renderChips();
  },
  reportError: (text) => reportError(text),
};

function showQuick() {
  root.classList.add('quick-open');
  quickInput.focus();
}
function hideQuick() {
  root.classList.remove('quick-open');
  quickInput.blur();
}

// ---------- header: tabs and menu ----------
function setTab(t) {
  tab = t;
  root.querySelectorAll('.dc-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  log.classList.toggle('hidden', t !== 'chat');
  historyEl.classList.toggle('hidden', t !== 'history');
  if (t === 'history') loadHistory();
  else scrollDown();
}
root.querySelectorAll('.dc-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
function closeMenu() {
  menu.classList.add('hidden');
}
$('.dc-menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  menu.classList.toggle('hidden');
});
document.addEventListener('click', (e) => !menu.contains(e.target) && closeMenu());
engineItem.addEventListener('click', () => {
  setEngine(!engineArmed);
  closeMenu();
});
function setEngine(on) {
  engineArmed = on;
  engineItem.setAttribute('aria-checked', String(on));
  renderChips();
}
$('.dc-menu-new').addEventListener('click', async () => {
  closeMenu();
  if (running) return;
  const r = await post('/reset');
  if (r.ok) {
    log.innerHTML = '';
    turn = null;
  }
});
$('.dc-tab').addEventListener('click', () => (isOpen ? close() : open()));
feed.addEventListener('click', () => open());
$('.dc-close').addEventListener('click', close);
$('.dc-stop').addEventListener('click', () => post('/stop'));

// ---------- keyboard ----------
// `: show / hide the panel. Enter: prompt without leaving the game (quick bar in Play mode).
window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (e.code === 'Backquote') {
    e.preventDefault();
    e.stopImmediatePropagation();
    isOpen ? close() : open();
  } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && ['play', 'build'].includes(gameState())) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isOpen) input.focus();
    else showQuick();
  }
}, true);
for (const node of [panel, quick]) {
  for (const type of ['keydown', 'keyup', 'keypress']) node.addEventListener(type, (e) => e.stopPropagation());
  node.addEventListener('mousedown', (e) => e.stopPropagation());
}
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
  if (e.key === 'Escape') document.pointerLockElement || gameState() === 'build' ? input.blur() : close();
  if (e.code === 'Backquote' && !input.value) {
    e.preventDefault();
    close();
  }
});
quickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideQuick();
  }
});
quickInput.addEventListener('blur', hideQuick);

// ---------- sending ----------
function gameContext() {
  const g = window.__game;
  if (!g?.player) return '';
  const d = g.camera.getWorldDirection(new g.camera.position.constructor());
  const heading = Math.round(((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360);
  if (g.state === 'build') {
    const p = g.build.pos;
    return `[Game context: build mode, free camera at x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, z=${p.z.toFixed(1)}, looking ${heading}° (0 = -z/north, 90 = +x/east), pitch ${Math.round((g.build.pitch * 180) / Math.PI)}°, time ${g.env.clock}]`;
  }
  const p = g.player.focus;
  const mode = g.player.driving ? 'driving a car' : g.player.flying ? `flying ${Math.round(g.player.altitude)} m up` : 'on foot';
  return `[Game context: player at x=${p.x.toFixed(1)}, z=${p.z.toFixed(1)}, ${mode}, facing ${heading}° (0 = -z/north, 90 = +x/east), time ${g.env.clock}]`;
}
function currentSelection() {
  const sel = window.__harness?.getSelection?.() || '';
  return sel && sel !== dismissedSel ? sel : '';
}

async function sendPrompt(text) {
  const blocks = [];
  if (cameraContext) blocks.push(gameContext());
  const sel = currentSelection();
  if (sel) blocks.push(sel);
  if (attachments.shot) blocks.push(`[Screenshot: ${attachments.shot.path} (the user's current view; read it with the Read tool)]`);
  const extras = [sel && 'selection', attachments.shot && 'screenshot', engineArmed && 'engine edits'].filter(Boolean);
  const prefix = blocks.filter(Boolean).join('\n');
  const r = await post('/prompt', {
    text: prefix ? `${prefix}\n\n${text}` : text,
    display: extras.length ? `${text}\n[with ${extras.join(', ')}]` : text,
    engine: engineArmed,
  });
  if (r.ok) {
    attachments.shot = null;
    setEngine(false);
    if (sel) dismissedSel = sel; // don't re-send the same selection by accident
    renderChips();
  } else {
    addItem({ kind: 'error', text: r.error || 'Request failed' });
    flashFeed(r.error || 'Request failed', true);
  }
  return r.ok;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || running) return;
  input.value = '';
  // came here with Enter while playing: hand control straight back to the game
  if (document.pointerLockElement) input.blur();
  setTab('chat');
  sendPrompt(text);
});
quick.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = quickInput.value.trim();
  quickInput.value = '';
  hideQuick();
  if (text) sendPrompt(text);
});

async function post(path, body) {
  try {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Devchat': '1' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch (err) {
    return { ok: false, error: `Dev server unreachable (${err.message})` };
  }
}

// ---------- context chips ----------
let lastChipSig = '';
function renderChips() {
  const sel = currentSelection();
  const selName = sel.match(/^\[Selected object: ([^.]*?) centered/)?.[1] || 'object';
  const sig = [cameraContext, sel, attachments.shot?.path, engineArmed, gameState()].join('|');
  if (sig === lastChipSig) return;
  lastChipSig = sig;
  chipsEl.innerHTML = '';
  const chip = (cls, html, title) => {
    const c = el('span', `dc-chip ${cls}`, html);
    if (title) c.title = title;
    chipsEl.appendChild(c);
    return c;
  };
  const cam = el('button', `dc-chip dc-chip-toggle${cameraContext ? ' on' : ''}`, `${icons.pin}<span>${gameState() === 'build' ? 'Camera view' : 'My position'}</span>`);
  cam.type = 'button';
  cam.setAttribute('aria-pressed', String(cameraContext));
  cam.title = cameraContext ? 'Claude gets where you are and which way you face. Click to leave it out.' : 'Click to tell Claude where you are and which way you face';
  cam.addEventListener('click', () => {
    cameraContext = !cameraContext;
    try { localStorage.setItem(CAM_KEY, cameraContext ? '1' : '0'); } catch { /* ignore */ }
    renderChips();
  });
  chipsEl.appendChild(cam);
  if (sel) {
    const c = chip('dc-chip-sel', `${icons.target}<span><b>Selected</b> ${esc(selName)}</span><button type="button" aria-label="Leave out the selection">${icons.close}</button>`, 'Claude gets this object, its properties and where its code lives');
    c.querySelector('button').addEventListener('click', () => {
      dismissedSel = sel;
      renderChips();
    });
  }
  if (attachments.shot) {
    const c = chip('dc-chip-shot', `<img src="${attachments.shot.thumb}" alt=""><span>Screenshot</span><button type="button" aria-label="Remove screenshot">${icons.close}</button>`);
    c.querySelector('button').addEventListener('click', () => {
      attachments.shot = null;
      renderChips();
    });
  }
  if (engineArmed) {
    const c = chip('dc-chip-engine', `${icons.warn}<span>Engine edits: all games</span><button type="button" aria-label="Turn off engine edits">${icons.close}</button>`, 'Claude may change the shared engine for this prompt');
    c.querySelector('button').addEventListener('click', () => setEngine(false));
  }
  if (!attachments.shot && window.__harness?.screenshot) {
    const add = el('button', 'dc-chip dc-chip-add', `${icons.camera}<span>Attach view</span>`);
    add.type = 'button';
    add.title = 'Attach a screenshot of what you see (K in build mode)';
    add.addEventListener('click', () => window.__harness.screenshot());
    chipsEl.appendChild(add);
  }
}
setInterval(renderChips, 400);

// ---------- log ----------
function scrollDown() {
  requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
}
let turn = null; // { user, steps, stepsEl, texts, start }

function renderEmpty() {
  if (log.querySelector('.dc-msg, .dc-steps, .dc-error')) return log.querySelector('.dc-intro')?.remove();
  if (log.querySelector('.dc-intro')) return;
  const kind = currentSelection().match(/^\[Selected object: (\w[\w ]*?)[ "]/)?.[1];
  const ideas = [
    kind ? `Make this ${kind} twice as tall and give it a glowing roof` : 'Add a small park with trees and benches where I’m looking',
    'Make it night and add more neon signs',
    'Add a collectible and a counter for how many I’ve found',
  ];
  const intro = el('div', 'dc-intro', `
    <p>Describe a change and Claude edits this game’s code. The game reloads where you are.</p>
    <p class="dc-intro-tip">Tip: in build mode, click something in the world first. Claude gets that object and where its code lives.</p>
    <div class="dc-ideas">${ideas.map((t) => `<button type="button" class="dc-idea">${esc(t)}</button>`).join('')}</div>`);
  intro.querySelectorAll('.dc-idea').forEach((b) => b.addEventListener('click', () => {
    input.value = b.textContent;
    input.focus();
  }));
  log.appendChild(intro);
}

function addItem(item) {
  if (item.seq) {
    if (item.seq <= lastSeq) return;
    lastSeq = item.seq;
  }
  log.querySelector('.dc-intro')?.remove();
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  switch (item.kind) {
    case 'user': {
      const [text, extra] = String(item.text).split(/\n(?=\[with )/);
      const n = el('div', 'dc-msg dc-user', `${md(text)}${extra ? `<span class="dc-with">${esc(extra.slice(1, -1))}</span>` : ''}`);
      log.appendChild(n);
      turn = { steps: 0, stepsEl: null, texts: [], start: item.ts || Date.now() };
      break;
    }
    case 'tool': {
      if (!turn) turn = { steps: 0, stepsEl: null, texts: [], start: item.ts || Date.now() };
      if (!turn.stepsEl) {
        turn.stepsEl = el('details', 'dc-steps', `<summary>${icons.chevron}<span class="dc-steps-count"></span><span class="dc-steps-last"></span></summary><ol></ol>`);
        log.appendChild(turn.stepsEl);
        turn.runSteps = 0;
      }
      turn.steps++;
      turn.runSteps++;
      turn.stepsEl.querySelector('ol').appendChild(el('li', '', esc(item.text)));
      turn.stepsEl.querySelector('.dc-steps-count').textContent = `${turn.runSteps} step${turn.runSteps === 1 ? '' : 's'}`;
      turn.stepsEl.querySelector('.dc-steps-last').textContent = item.text;
      stepEl.textContent = item.text;
      break;
    }
    case 'text': {
      const n = el('div', 'dc-msg dc-bot', md(item.text));
      log.appendChild(n);
      if (turn) {
        turn.texts.push(n);
        turn.stepsEl = null; // the next tool starts a new group
      }
      break;
    }
    case 'done': {
      // earlier messages in the turn were progress notes; the last one is the answer
      if (turn) turn.texts.slice(0, -1).forEach((n) => n.classList.add('dc-progress'));
      const ms = item.meta?.ms || (turn ? (item.ts || Date.now()) - turn.start : 0);
      log.appendChild(el('div', 'dc-note', `Done${ms ? ` in ${secs(ms)}` : ''}`));
      turn = null;
      break;
    }
    case 'reload': log.appendChild(el('div', 'dc-note dc-reload', `${icons.reset}<span>${esc(item.text)}</span>`)); break;
    case 'status': log.appendChild(el('div', 'dc-note', esc(item.text))); break;
    case 'error': log.appendChild(errorCard(item.text, item.fixable)); break;
    default: return;
  }
  if (near || item.kind === 'user') scrollDown();
  if (live) {
    if (item.kind === 'user') flashFeed(`Sent: ${item.text.split('\n')[0]}`);
    else if (item.kind === 'tool') flashFeed(item.text);
    else if (item.kind === 'text') flashFeed(item.text.split('\n')[0]);
    else if (item.kind === 'reload') flashFeed('Applying changes…');
    else if (item.kind === 'error') flashFeed('Something went wrong. Press ` to see it', true);
  }
}

function errorCard(text, fixable) {
  const n = el('div', 'dc-error', `<div class="dc-error-title">${icons.warn}<span>Error</span></div><pre>${esc(text)}</pre>`);
  if (fixable) {
    const b = el('button', 'ws-btn sm danger dc-fix', 'Ask Claude to fix it');
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await post('/prompt', { text: `The game shows this error after the last change. Find the cause and fix it:\n\n${text}`, display: 'Fix the error above' });
      if (!r.ok) {
        b.disabled = false;
        addItem({ kind: 'error', text: r.error });
      }
    });
    n.appendChild(b);
  }
  return n;
}

// ---------- checkpoints ----------
async function loadHistory() {
  historyEl.innerHTML = '<p class="dc-note">Loading…</p>';
  let list = [];
  try {
    list = await (await fetch(`${API}/checkpoints`)).json();
  } catch { /* offline */ }
  if (!list.length) {
    historyEl.innerHTML = '<p class="dc-hint">No checkpoints yet. One is saved before every prompt, so any change Claude makes can be undone.</p>';
    return;
  }
  historyEl.innerHTML = '';
  const last = list[0];
  const top = el('div', 'dc-undo', `
    <button type="button" class="ws-btn primary">${icons.undo}<span>Undo last prompt</span></button>
    <p>Puts the game back to how it was before “${esc(last.prompt.split('\n')[0])}”. The current version is saved first, so you can redo it from this list.</p>`);
  top.querySelector('button').addEventListener('click', (e) => restore(last, e.currentTarget));
  historyEl.appendChild(top);
  historyEl.appendChild(el('h3', 'dc-hist-title', 'All checkpoints'));
  for (const cp of list) {
    const row = el('div', 'dc-cp', `
      <div class="dc-cp-text">Before: ${esc(cp.prompt.split('\n')[0])}</div>
      <div class="dc-cp-meta">${new Date(cp.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${cp.engine ? ' · includes engine' : ''}</div>
      <button type="button" class="ws-btn sm">Restore</button>`);
    row.querySelector('button').addEventListener('click', (e) => restore(cp, e.currentTarget));
    historyEl.appendChild(row);
  }
}
async function restore(cp, btn) {
  if (!confirm(`Restore the game to before:\n\n“${cp.prompt.split('\n')[0]}”?`)) return;
  btn.disabled = true;
  const r = await post('/restore', { id: cp.id });
  if (!r.ok) {
    btn.disabled = false;
    alert(r.error || 'Restore failed');
  }
}

// ---------- status ----------
function flashFeed(text, isError = false) {
  feedText.textContent = text.length > 90 ? `${text.slice(0, 88)}…` : text;
  feed.classList.toggle('err', isError);
  feedTimer = Date.now() + (isError ? 8000 : 5000);
  updateFeed();
}
function updateFeed() {
  const show = !isOpen && (running || Date.now() < feedTimer) && feedText.textContent;
  feed.classList.toggle('show', !!show);
}
setInterval(updateFeed, 500);

function setRunning(on, since) {
  running = on;
  startedAt = since || Date.now();
  root.classList.toggle('running', on);
  sendBtn.disabled = on;
  sendBtn.title = on ? 'Wait for Claude to finish, or press Stop' : '';
  if (on && !stepEl.textContent) stepEl.textContent = 'Reading the game…';
  if (!on) stepEl.textContent = '';
  if (!on && tab === 'history') loadHistory();
}
setInterval(() => {
  if (running) elapsedEl.textContent = secs(Date.now() - startedAt);
}, 500);

// Server event stream: replays history, then live progress. EventSource reconnects on its own.
function connect() {
  const es = new EventSource(`${API}/events?since=${lastSeq}`);
  es.onmessage = (e) => {
    const item = JSON.parse(e.data);
    if (item.kind === 'state') {
      setRunning(item.running, item.startedAt);
      root.classList.remove('offline');
      live = true; // history replay is over; new items are live
      renderEmpty();
      updateFeed();
      return;
    }
    addItem(item);
  };
  es.onerror = () => root.classList.add('offline');
}
connect();

// Surface runtime and compile errors so they can be sent straight back to Claude.
function reportError(text) {
  const key = text.slice(0, 300);
  if (seenErrors.has(key)) return;
  seenErrors.add(key);
  addItem({ kind: 'error', text, fixable: true });
  if (!isOpen) open(false);
}
window.addEventListener('error', (e) => {
  if (e.target && e.target !== window && e.target.tagName === 'SCRIPT') {
    reportError(`Failed to load ${e.target.src}. A module probably has a syntax error; run npx vite build to see it.`);
  } else if (e.error || e.message) {
    reportError(`${e.error?.stack || e.message}${e.filename ? `\n  at ${e.filename}:${e.lineno}:${e.colno}` : ''}`);
  }
}, true);
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  reportError(r?.stack || String(r));
});
if (import.meta.hot) {
  import.meta.hot.on('vite:error', ({ err }) => {
    reportError(`${err.message}${err.id ? `\n  in ${err.id}` : ''}${err.frame ? `\n${err.frame}` : ''}`);
  });
}

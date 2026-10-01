// World Studio landing page: list, create, duplicate, rename and delete projects (games/<slug>/).
import './landing.css';

const DEV = import.meta.env.DEV;
const root = document.getElementById('landing');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const playUrl = (slug, build) => (DEV ? `/play/${slug}${build ? '?build=1' : ''}` : `play.html?game=${slug}${build ? '&build=1' : ''}`);
const api = async (path, body) => {
  const res = await fetch(`/__harness${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Devchat': '1' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const ago = (t) => {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

async function loadProjects() {
  if (DEV) return api('/projects');
  const { metas } = await import('./registry.prod.js');
  return Object.entries(metas).map(([p, m]) => ({ slug: p.split('/')[2], ...m }));
}

root.innerHTML = `
  <div class="wrap">
    <header class="top">
      <div>
        <div class="kicker">World Studio</div>
        <h1>Build worlds <span>live</span></h1>
        <p class="lede">Every project is its own game on the same engine. Open one, press Tab for build mode, click anything and describe what to change. The game updates where you stand.</p>
      </div>
      ${DEV ? '<button class="primary" id="new">New project</button>' : ''}
    </header>
    <div class="section-title">Projects</div>
    <div class="grid" id="grid"></div>
  </div>`;

const grid = root.querySelector('#grid');
async function render() {
  let projects = [];
  try {
    projects = await loadProjects();
  } catch (err) {
    grid.innerHTML = `<p class="empty">Couldn't load projects: ${esc(err.message)}</p>`;
    return;
  }
  grid.innerHTML = '';
  for (const p of projects) {
    const initials = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const card = document.createElement('a');
    card.className = 'card';
    card.href = playUrl(p.slug);
    card.innerHTML = `
      <div class="thumb">${p.thumb ? `<img src="${p.thumb}" alt="">` : `<div class="ph">${esc(initials)}</div>`}${p.running ? '<span class="badge">Working</span>' : ''}</div>
      <div class="meta">
        <div class="name">${esc(p.name)}</div>
        <div class="sub">${esc(p.template || 'custom')}${p.updated ? ` · edited ${ago(p.updated)}` : ''}</div>
        ${p.description ? `<div class="desc">${esc(p.description)}</div>` : ''}
      </div>
      ${DEV ? `<div class="actions">
        <button data-a="build">Build</button>
        <button data-a="duplicate">Duplicate</button>
        <button data-a="rename">Rename</button>
        <button data-a="delete" class="del">Delete</button>
      </div>` : ''}`;
    card.querySelector('.actions')?.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (!a) return;
      e.preventDefault();
      action(a, p);
    });
    grid.appendChild(card);
  }
  if (DEV) {
    const add = document.createElement('button');
    add.className = 'new-card';
    add.innerHTML = '<div><span>+</span>New project</div>';
    add.addEventListener('click', openCreate);
    grid.appendChild(add);
  } else if (!projects.length) grid.innerHTML = '<p class="empty">No projects yet.</p>';
}

function dialog(html) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="dialog">${html}</div>`;
  o.addEventListener('mousedown', (e) => e.target === o && o.remove());
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      o.remove();
      document.removeEventListener('keydown', esc);
    }
  });
  document.body.appendChild(o);
  return o;
}

async function openCreate() {
  let templates = [];
  try {
    templates = await api('/templates');
  } catch { /* shown below */ }
  let chosen = templates.find((t) => t.id === 'blank')?.id || templates[0]?.id;
  const o = dialog(`
    <h2>New project</h2>
    <p class="help">Pick a starting point. If you describe the game, a first version is built while it loads.</p>
    <label class="field"><span>Name</span><input id="n" placeholder="e.g. Sky Islands" maxlength="60"></label>
    <div class="field"><span>Template</span><div class="templates">${templates.map((t) => `
      <button type="button" class="tpl${t.id === chosen ? ' on' : ''}" data-id="${esc(t.id)}"><b>${esc(t.name)}</b><small>${esc(t.description || '')}</small></button>`).join('')}</div></div>
    <label class="field"><span>Describe your game (optional)</span><textarea id="d" placeholder="e.g. Floating islands connected by rope bridges. Collect crystals before the sun sets; falling off respawns you on the last island."></textarea></label>
    <p class="err" hidden></p>
    <div class="row"><button class="ghost" id="cancel">Cancel</button><button class="primary" id="go">Create</button></div>`);
  const $ = (s) => o.querySelector(s);
  $('#n').focus();
  o.querySelectorAll('.tpl').forEach((b) => b.addEventListener('click', () => {
    chosen = b.dataset.id;
    o.querySelectorAll('.tpl').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#cancel').addEventListener('click', () => o.remove());
  $('#go').addEventListener('click', async () => {
    const name = $('#n').value.trim();
    if (!name) return $('#n').focus();
    $('#go').disabled = true;
    $('#go').textContent = 'Creating…';
    try {
      const { slug } = await api('/projects', { name, template: chosen, description: $('#d').value });
      location.href = playUrl(slug, true);
    } catch (err) {
      $('.err').hidden = false;
      $('.err').textContent = err.message;
      $('#go').disabled = false;
      $('#go').textContent = 'Create';
    }
  });
}

async function action(a, p) {
  if (a === 'build') location.href = playUrl(p.slug, true);
  if (a === 'duplicate') {
    await api(`/projects/${p.slug}/duplicate`, { name: `${p.name} copy` });
    render();
  }
  if (a === 'rename') {
    const o = dialog(`<h2>Rename</h2><label class="field"><span>Name</span><input id="n" value="${esc(p.name)}" maxlength="60"></label>
      <div class="row"><button class="ghost" id="cancel">Cancel</button><button class="primary" id="go">Save</button></div>`);
    const inp = o.querySelector('#n');
    inp.select();
    const save = async () => {
      await api(`/projects/${p.slug}/rename`, { name: inp.value });
      o.remove();
      render();
    };
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    o.querySelector('#go').addEventListener('click', save);
    o.querySelector('#cancel').addEventListener('click', () => o.remove());
  }
  if (a === 'delete') {
    const o = dialog(`<h2>Delete “${esc(p.name)}”?</h2><p class="help">The project and its chat move to <code>.harness/trash/</code>, so you can still recover it from there.</p>
      <p class="err" hidden></p>
      <div class="row"><button class="ghost" id="cancel">Cancel</button><button class="danger" id="go">Delete</button></div>`);
    o.querySelector('#cancel').addEventListener('click', () => o.remove());
    o.querySelector('#go').addEventListener('click', async () => {
      try {
        await api(`/projects/${p.slug}/delete`, {});
        o.remove();
        render();
      } catch (err) {
        o.querySelector('.err').hidden = false;
        o.querySelector('.err').textContent = err.message;
      }
    });
  }
}

root.querySelector('#new')?.addEventListener('click', openCreate);
render();
setInterval(render, 60000);
if (import.meta.hot) import.meta.hot.on('harness:projects', () => render());

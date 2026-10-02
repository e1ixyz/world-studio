// World Studio dev server plugin (dev only). It adds:
// - a projects API (games/<slug>/, created from templates/<name>/)
// - a per-project chat that runs Claude Code headless, with edits locked to that game's folder
//   (plus engine/ for one prompt, or for every prompt with the "always allow engine edits" setting)
// - checkpoints before every prompt, with restore
// - scoped reloads: an edit to a game reloads only tabs playing that game; engine edits reload all
// - screenshot, thumbnail and tweak saving
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const CODE_FILE = /\.(m?js|json|html|glsl|frag|vert)$/;
const GAME_DATA = new Set(['tweaks.json', 'thumb.jpg', 'game.json']);
const MAX_LOG = 400;
const MAX_CHECKPOINTS = 30;
const BASE_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(npx vite build:*)'];

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';
const readJSON = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJSON = (f, data) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
};

function systemPrompt(slug, meta, engine) {
  return `You are live-editing the game "${meta.name || slug}" in World Studio, a harness where every game runs on one shared Three.js engine and the user builds by prompting while the game runs.

- This game's code is in games/${slug}/. ${engine
    ? 'Engine edits are allowed: you may also edit engine/. Engine changes affect every game in games/, so keep them backwards compatible and mention what you changed there. Put game-specific behavior in the game folder, and change the engine only for things the engine should do for every game.'
    : 'You can only edit files inside games/' + slug + '/. The shared engine (engine/) is read-only unless the user allows engine edits in the chat\'s ⋯ menu; if a request truly needs an engine change, say so instead of working around it badly.'}
- Read engine/API.md before your first change in a conversation. It documents the game contract (defineGame, setup(ctx), the returned world/update/snapshot/restore), the build-mode hooks and the engine helpers.
- Expose tunable numbers and colors with ctx.tweaks.add so the user can adjust them live in build mode.
- Register new clickable objects with ctx.select.add (or addProvider for moving things) so point-and-prompt works on them.
- Keep snapshot()/restore() in sync with any new game state, so reloads don't lose progress.
- Prompts may start with [Game context: ...], [Selected object: ...] or [Screenshot: <path>] blocks. Read a screenshot path with the Read tool to see what the user sees.
- Don't start servers or install packages. When you finish, the game reloads itself in place and restores the player; never tell the user to refresh.
- For larger changes run \`npx vite build\` to confirm it compiles.
- End with one or two plain sentences: what changed and how to see it in the game.`;
}

export default function harness() {
  let server;
  let root = process.cwd();
  const P = {};
  const chats = new Map();
  const pending = new Map(); // file -> slug or '*'
  let flushTimer = null;
  let suppressUntil = 0;
  // Files the harness itself just wrote by copying (new project, duplicate), with their mtime.
  // The watcher can report those a second or two later; they must not reload the new tab.
  const fresh = new Map();
  function markFresh(dir) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else fresh.set(p, fs.statSync(p).mtimeMs);
      }
    };
    walk(dir);
  }

  const gameDir = (slug) => path.join(P.games, slug);
  const exists = (slug) => SLUG_RE.test(slug) && fs.existsSync(path.join(gameDir(slug), 'game.js'));
  const rel = (p) => (p ? path.relative(root, p) || p : '');
  const hot = () => server.environments?.client?.hot || server.hot;
  const sendEvent = (event, data) => hot().send({ type: 'custom', event, data });
  // Studio-wide settings, shared by every project and by every server on this checkout
  // (browser dev server and desktop app), so they live in .harness/ and are read fresh each time.
  const SETTINGS_DEFAULTS = { alwaysEngine: false };
  const settingsFile = () => path.join(P.data, 'settings.json');
  const settings = () => ({ ...SETTINGS_DEFAULTS, ...readJSON(settingsFile(), {}) });

  // ---------- chat state ----------
  function chat(slug) {
    let c = chats.get(slug);
    if (!c) {
      const file = path.join(P.data, 'projects', slug, 'chat.json');
      const saved = readJSON(file, {});
      c = { slug, file, sessionId: saved.sessionId || null, seq: saved.seq || 0, log: saved.log || [], clients: new Set(), job: null, saveTimer: null };
      chats.set(slug, c);
    }
    return c;
  }
  const saveChat = (c) => {
    clearTimeout(c.saveTimer);
    c.saveTimer = setTimeout(() => writeJSON(c.file, { sessionId: c.sessionId, seq: c.seq, log: c.log }), 200);
  };
  const send = (res, item) => res.write(`id: ${item.seq ?? 0}\ndata: ${JSON.stringify(item)}\n\n`);
  const push = (c, kind, text, meta) => {
    const item = { seq: ++c.seq, kind, text, meta, ts: Date.now() };
    c.log.push(item);
    if (c.log.length > MAX_LOG) c.log.splice(0, c.log.length - MAX_LOG);
    for (const r of c.clients) send(r, item);
    saveChat(c);
    return item;
  };
  const status = (c) => {
    const s = { kind: 'state', running: !!c.job, startedAt: c.job?.startedAt, engine: !!c.job?.engine, session: !!c.sessionId, seq: c.seq };
    for (const r of c.clients) send(r, s);
  };

  function describeTool(name, input = {}) {
    switch (name) {
      case 'Edit': case 'Write': case 'Read': case 'MultiEdit': return `${name} ${rel(input.file_path)}`;
      case 'Grep': return `Search "${input.pattern}"`;
      case 'Glob': return `Find ${input.pattern}`;
      case 'Bash': return `Run ${input.command}`;
      case 'TodoWrite': return 'Plan steps';
      default: return name;
    }
  }

  // ---------- checkpoints ----------
  const cpRoot = (slug) => path.join(P.data, 'checkpoints', slug);
  function checkpoint(slug, { prompt, engine }) {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const dir = path.join(cpRoot(slug), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(gameDir(slug), path.join(dir, 'game'), { recursive: true, filter: (s) => !s.endsWith('thumb.jpg') });
    if (engine) fs.cpSync(P.engine, path.join(dir, 'engine'), { recursive: true });
    writeJSON(path.join(dir, 'meta.json'), { id, prompt, time: Date.now(), engine: !!engine });
    const all = listCheckpoints(slug);
    for (const old of all.slice(MAX_CHECKPOINTS)) fs.rmSync(path.join(cpRoot(slug), old.id), { recursive: true, force: true });
    return id;
  }
  function listCheckpoints(slug) {
    let ids = [];
    try {
      ids = fs.readdirSync(cpRoot(slug));
    } catch { /* none yet */ }
    return ids.map((id) => readJSON(path.join(cpRoot(slug), id, 'meta.json'), null)).filter(Boolean).sort((a, b) => b.time - a.time);
  }
  function restoreCheckpoint(slug, id) {
    const dir = path.join(cpRoot(slug), id);
    const meta = readJSON(path.join(dir, 'meta.json'), null);
    if (!meta) throw new Error('No such checkpoint');
    const withEngine = fs.existsSync(path.join(dir, 'engine'));
    checkpoint(slug, { prompt: `Before restoring: ${meta.prompt}`, engine: withEngine });
    suppressUntil = Date.now() + 2500;
    const thumb = path.join(gameDir(slug), 'thumb.jpg');
    const thumbData = fs.existsSync(thumb) ? fs.readFileSync(thumb) : null;
    fs.rmSync(gameDir(slug), { recursive: true, force: true });
    fs.cpSync(path.join(dir, 'game'), gameDir(slug), { recursive: true });
    if (thumbData) fs.writeFileSync(thumb, thumbData);
    if (withEngine) {
      fs.rmSync(P.engine, { recursive: true, force: true });
      fs.cpSync(path.join(dir, 'engine'), P.engine, { recursive: true });
    }
    for (const env of Object.values(server.environments)) env.moduleGraph.invalidateAll();
    push(chat(slug), 'status', `Restored the game to before "${meta.prompt}"`);
    setTimeout(() => sendEvent('harness:reload', withEngine ? { all: true } : { slugs: [slug] }), 300);
  }

  // ---------- reloads ----------
  function queue(file, scope) {
    pending.set(file, scope);
    if ([...chats.values()].some((c) => c.job)) return; // flushed when the job finishes
    // file events can land just after a job ends; credit them to that job's chat
    const recent = [...chats.values()].find((c) => c.lastJobEnd && Date.now() - c.lastJobEnd < 2500);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(recent), 180);
  }
  function flush(c) {
    if (!pending.size) return;
    const files = [...pending.keys()];
    const scopes = new Set(pending.values());
    pending.clear();
    for (const file of files) {
      for (const env of Object.values(server.environments)) {
        const mods = env.moduleGraph.getModulesByFile(file);
        if (mods) for (const m of mods) env.moduleGraph.invalidateModule(m);
      }
    }
    const all = scopes.has('*');
    if (c) push(c, 'reload', `Reloading with ${files.length} changed file${files.length === 1 ? '' : 's'}${all ? ' (engine: all games)' : ''}`, { files: files.map(rel) });
    setTimeout(() => sendEvent('harness:reload', all ? { all: true } : { slugs: [...scopes] }), 150);
    sendEvent('harness:projects', {});
  }

  // ---------- Claude runs ----------
  function run(slug, prompt, { display, engine = false } = {}) {
    const c = chat(slug);
    engine = engine || settings().alwaysEngine;
    const meta = readJSON(path.join(gameDir(slug), 'game.json'), {});
    checkpoint(slug, { prompt: display || prompt, engine });
    push(c, 'user', display || prompt, { engine });
    // Absolute paths ("//abs/**"): relative rules resolve against Claude's current directory,
    // so a `cd` in a shell command would otherwise make the game's own files unwritable.
    const allow = (dir) => [`Edit(/${dir}/**)`, `Write(/${dir}/**)`];
    const tools = [...BASE_TOOLS, ...allow(gameDir(slug))];
    if (engine) tools.push(...allow(P.engine));
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default',
      '--allowedTools', ...tools, '--append-system-prompt', systemPrompt(slug, meta, engine)];
    if (c.sessionId) args.push('--resume', c.sessionId);
    if (process.env.DEVCHAT_MODEL) args.push('--model', process.env.DEVCHAT_MODEL);
    // WORLD_STUDIO_AGENT lets user-level hooks (e.g. a handoff Stop hook) skip these short in-game runs
    const child = spawn(process.env.DEVCHAT_CLAUDE || 'claude', args, { cwd: root, env: { ...process.env, WORLD_STUDIO_AGENT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    c.job = { child, startedAt: Date.now(), engine, gotResult: false, stderr: '' };
    status(c);

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.session_id) c.sessionId = msg.session_id;
        if (msg.type === 'assistant') {
          for (const b of msg.message?.content || []) {
            if (b.type === 'text' && b.text.trim()) push(c, 'text', b.text.trim());
            if (b.type === 'tool_use') push(c, 'tool', describeTool(b.name, b.input), { name: b.name });
          }
        } else if (msg.type === 'result') {
          c.job.gotResult = true;
          const denials = msg.permission_denials || [];
          const files = [...new Set(denials.filter((d) => d.tool_input?.file_path).map((d) => rel(d.tool_input.file_path)))];
          const tools = [...new Set(denials.filter((d) => !d.tool_input?.file_path).map((d) => d.tool_name))];
          if (files.length) {
            const engineFiles = files.some((f) => f.startsWith('engine'));
            push(c, 'status', `Blocked edits outside this game: ${files.join(', ')}.${engineFiles && !engine ? ' To allow changes to the shared engine, choose "Allow engine edits" (next prompt) or "Always allow engine edits" in the ⋯ menu.' : ''}`);
          }
          if (tools.length) push(c, 'status', `Tried tools the harness doesn't allow here (${tools.join(', ')}). Only reading, searching and editing this game's files and running npx vite build are allowed.`);
          if (msg.is_error || msg.subtype !== 'success') push(c, 'error', msg.result || `Stopped (${msg.subtype})`);
          push(c, 'done', '', { ms: msg.duration_ms, cost: msg.total_cost_usd });
        }
      }
    });
    child.stderr.on('data', (d) => {
      c.job.stderr = (c.job.stderr + d).slice(-4000);
    });
    child.on('error', (err) => {
      push(c, 'error', err.code === 'ENOENT'
        ? 'Couldn’t find the `claude` command-line tool. Install it and log in, or set DEVCHAT_CLAUDE to its path.'
        : `Failed to start: ${err.message}`);
    });
    child.on('close', (code, signal) => {
      const j = c.job;
      c.job = null;
      if (signal) push(c, 'status', 'Stopped. Open Checkpoints to undo any partial edits.');
      else if (code !== 0 && !j.gotResult) push(c, 'error', j.stderr.trim().split('\n').slice(-6).join('\n') || `Exited with code ${code}`);
      const gj = path.join(gameDir(slug), 'game.json');
      if (fs.existsSync(gj)) writeJSON(gj, { ...readJSON(gj, {}), updated: Date.now() });
      saveChat(c);
      status(c);
      c.lastJobEnd = Date.now();
      // give the file watcher a moment to report the last edits, then reload once
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => ![...chats.values()].some((x) => x.job) && flush(c), 400);
    });
  }

  // ---------- projects ----------
  function newestMtime(dir) {
    let t = 0;
    const walk = (d, depth) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'thumb.jpg' || e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) depth < 4 && walk(p, depth + 1);
        else t = Math.max(t, fs.statSync(p).mtimeMs);
      }
    };
    try {
      walk(dir, 0);
    } catch { /* ignore */ }
    return t;
  }
  function listProjects() {
    let names = [];
    try {
      names = fs.readdirSync(P.games);
    } catch { /* none */ }
    return names.filter(exists).map((slug) => {
      const meta = readJSON(path.join(gameDir(slug), 'game.json'), {});
      const thumb = path.join(gameDir(slug), 'thumb.jpg');
      const hasThumb = fs.existsSync(thumb);
      return {
        slug,
        name: meta.name || slug,
        template: meta.template || '',
        description: meta.description || '',
        created: meta.created || 0,
        updated: Math.max(meta.updated || 0, newestMtime(gameDir(slug))),
        thumb: hasThumb ? `/games/${slug}/thumb.jpg?v=${Math.round(fs.statSync(thumb).mtimeMs)}` : null,
        running: !!chats.get(slug)?.job,
      };
    }).sort((a, b) => b.updated - a.updated);
  }
  function listTemplates() {
    return fs.readdirSync(P.templates)
      .filter((t) => fs.existsSync(path.join(P.templates, t, 'game.js')))
      .map((t) => ({ id: t, ...readJSON(path.join(P.templates, t, 'game.json'), { name: t }) }));
  }
  function uniqueSlug(name) {
    const base = slugify(name);
    let s = base;
    for (let i = 2; fs.existsSync(gameDir(s)); i++) s = `${base}-${i}`;
    return s;
  }
  function createProject({ name, template, description }) {
    name = String(name || '').trim() || 'Untitled game';
    if (!fs.existsSync(path.join(P.templates, template || '', 'game.js'))) throw new Error('Unknown template');
    const slug = uniqueSlug(name);
    fs.cpSync(path.join(P.templates, template), gameDir(slug), { recursive: true });
    markFresh(gameDir(slug));
    const tmeta = readJSON(path.join(P.templates, template, 'game.json'), {});
    writeJSON(path.join(gameDir(slug), 'game.json'), {
      name, template, description: String(description || '').trim() || tmeta.description || '', created: Date.now(), updated: Date.now(),
    });
    if (description?.trim()) {
      run(slug, `This is a brand-new project created from the "${tmeta.name || template}" template (files already copied into games/${slug}/). Build the first version of the game the user describes below, reusing the template where it helps and replacing what doesn't fit:\n\n${description.trim()}`, { display: description.trim() });
    }
    sendEvent('harness:projects', {});
    return slug;
  }

  // ---------- http ----------
  function readBody(req, limit = 20e6) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > limit) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }
  const json = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  const decodeImage = (data) => Buffer.from(String(data).replace(/^data:image\/\w+;base64,/, ''), 'base64');

  async function handler(req, res, next) {
    // Claude can edit files through this, so only this machine may call it, and only from this site.
    if (!LOOPBACK.has(req.socket.remoteAddress)) return json(res, 403, { error: 'World Studio is local-only' });
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (req.headers['x-devchat'] !== '1' || (origin && new URL(origin).host !== req.headers.host)) return json(res, 403, { error: 'bad origin' });
    }
    let body = {};
    if (req.method === 'POST') {
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'bad json' });
      }
    }
    try {
      // /settings
      if (parts[0] === 'settings' && parts.length === 1) {
        if (req.method === 'GET') return json(res, 200, settings());
        if (req.method === 'POST') {
          const next = settings();
          if ('alwaysEngine' in body) next.alwaysEngine = !!body.alwaysEngine;
          writeJSON(settingsFile(), next);
          sendEvent('harness:settings', next);
          return json(res, 200, next);
        }
      }
      // /projects
      if (parts[0] === 'projects') {
        if (req.method === 'GET' && parts.length === 1) return json(res, 200, listProjects());
        if (req.method === 'POST' && parts.length === 1) return json(res, 200, { slug: createProject(body) });
        const slug = parts[1];
        if (!exists(slug)) return json(res, 404, { error: 'No such project' });
        const gj = path.join(gameDir(slug), 'game.json');
        if (parts[2] === 'rename') {
          writeJSON(gj, { ...readJSON(gj, {}), name: String(body.name || '').trim() || slug });
          sendEvent('harness:projects', {});
          return json(res, 200, { ok: true });
        }
        if (parts[2] === 'duplicate') {
          const meta = readJSON(gj, {});
          const name = String(body.name || `${meta.name || slug} copy`).trim();
          const copy = uniqueSlug(name);
          fs.cpSync(gameDir(slug), gameDir(copy), { recursive: true });
          markFresh(gameDir(copy));
          writeJSON(path.join(gameDir(copy), 'game.json'), { ...meta, name, created: Date.now(), updated: Date.now() });
          sendEvent('harness:projects', {});
          return json(res, 200, { slug: copy });
        }
        if (parts[2] === 'delete') {
          if (chat(slug).job) return json(res, 409, { error: 'A change is still running on this project' });
          const dest = path.join(P.data, 'trash', `${slug}-${Date.now()}`);
          fs.mkdirSync(dest, { recursive: true });
          fs.renameSync(gameDir(slug), path.join(dest, 'game'));
          // the chat goes with it, so a new project with the same name starts clean
          const chatDir = path.join(P.data, 'projects', slug);
          if (fs.existsSync(chatDir)) fs.renameSync(chatDir, path.join(dest, 'chat'));
          for (const r of chat(slug).clients) r.end();
          chats.delete(slug);
          sendEvent('harness:projects', {});
          return json(res, 200, { ok: true });
        }
      }
      if (req.method === 'GET' && parts[0] === 'templates') return json(res, 200, listTemplates());

      // /chat/<slug>/...
      if (parts[0] === 'chat') {
        const slug = parts[1];
        if (!exists(slug)) return json(res, 404, { error: 'No such project' });
        const c = chat(slug);
        if (req.method === 'GET' && parts[2] === 'events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          const since = Number(req.headers['last-event-id'] || url.searchParams.get('since') || 0);
          for (const item of c.log) if (item.seq > since) send(res, item);
          send(res, { kind: 'state', running: !!c.job, startedAt: c.job?.startedAt, engine: !!c.job?.engine, session: !!c.sessionId, seq: c.seq });
          c.clients.add(res);
          const ping = setInterval(() => res.write(': ping\n\n'), 20000);
          req.on('close', () => {
            clearInterval(ping);
            c.clients.delete(res);
          });
          return;
        }
        if (req.method === 'GET' && parts[2] === 'checkpoints') return json(res, 200, listCheckpoints(slug));
        if (req.method === 'POST' && parts[2] === 'prompt') {
          const text = String(body.text || '').trim();
          if (!text) return json(res, 400, { error: 'empty prompt' });
          if (c.job) return json(res, 409, { error: 'Still working on the last request' });
          run(slug, text, { display: String(body.display || text), engine: !!body.engine });
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && parts[2] === 'stop') {
          c.job?.child.kill('SIGTERM');
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && parts[2] === 'reset') {
          if (c.job) return json(res, 409, { error: 'busy' });
          c.sessionId = null;
          c.log = [];
          push(c, 'status', 'New conversation');
          status(c);
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && parts[2] === 'restore') {
          if (c.job) return json(res, 409, { error: 'Wait for the current change to finish first' });
          restoreCheckpoint(slug, String(body.id || ''));
          return json(res, 200, { ok: true });
        }
      }

      if (req.method === 'POST' && ['shot', 'thumb', 'tweaks'].includes(parts[0])) {
        const slug = String(body.slug || '');
        if (!exists(slug)) return json(res, 404, { error: 'No such project' });
        if (parts[0] === 'shot') {
          const file = path.join(P.data, 'shots', slug, `${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, decodeImage(body.data));
          return json(res, 200, { path: file });
        }
        if (parts[0] === 'thumb') {
          fs.writeFileSync(path.join(gameDir(slug), 'thumb.jpg'), decodeImage(body.data));
          sendEvent('harness:projects', {});
          return json(res, 200, { ok: true });
        }
        writeJSON(path.join(gameDir(slug), 'tweaks.json'), body.values || {});
        return json(res, 200, { ok: true });
      }
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
    next();
  }

  function stopJobs() {
    for (const c of chats.values()) c.job?.child.kill('SIGTERM');
  }

  return {
    name: 'world-studio',
    apply: 'serve',
    closeBundle: stopJobs, // runs on server.close()
    configResolved(config) {
      root = config.root;
      P.games = path.join(root, 'games');
      P.templates = path.join(root, 'templates');
      P.engine = path.join(root, 'engine');
      P.data = path.join(root, '.harness');
      fs.mkdirSync(P.games, { recursive: true });
    },
    configureServer(s) {
      server = s;
      // don't leave agent runs behind when the server shuts down (e.g. the desktop app quits).
      // In middleware mode (the studio daemon) there is no httpServer; closeBundle covers that.
      s.httpServer?.once('close', stopJobs);
      // /play/<slug> serves the game runtime
      s.middlewares.use((req, res, next) => {
        const m = req.url.match(/^\/play\/([\w-]+)\/?(\?.*)?$/);
        if (m) req.url = `/play.html${m[2] || ''}`;
        next();
      });
      s.middlewares.use('/__harness', handler);
    },
    transformIndexHtml(html, ctx) {
      if (!ctx.path.startsWith('/play')) return;
      return [{ tag: 'script', attrs: { type: 'module', src: '/harness/client/chat.js' }, injectTo: 'head-prepend' }];
    },
    // Game and engine code reloads are handled here instead of Vite's default full reload:
    // batched while Claude works, and scoped to the tabs that play the changed game.
    hotUpdate({ file }) {
      const r = path.relative(root, file);
      if (r.startsWith('..')) return;
      const [top, slug, name] = r.split(path.sep);
      if (top === '.harness') return [];
      if (top === 'templates') return [];
      if (top !== 'games' && top !== 'engine') return;
      if (!CODE_FILE.test(file)) return; // css and assets: Vite's own HMR
      if (Date.now() < suppressUntil) return [];
      if (fresh.has(file)) {
        // the watcher can send both a create and a change for one copy; skip both
        if (fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs === fresh.get(file)) return [];
        fresh.delete(file);
      }
      if (top === 'games') {
        if (!slug || GAME_DATA.has(name)) {
          if (name === 'game.json') sendEvent('harness:projects', {});
          return [];
        }
        queue(file, slug);
      } else queue(file, '*');
      return [];
    },
  };
}

// Drive the World Studio Electron window over the Chrome DevTools Protocol. No dependencies.
// Start the app with: npx electron . --remote-debugging-port=9333
//
//   node cdp.mjs eval "<js expression>"        prints the JSON result
//   node cdp.mjs nav  "<url or /path>" [ms]     navigates, waits (default 8000 ms), prints the URL
//   node cdp.mjs shot <out.png>                 screenshot; the window must be visible on screen
//
// Set CDP_PORT to use another port.
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || 9333;
const [cmd, arg, extra] = process.argv.slice(2);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

let list;
try {
  list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch {
  fail(`No DevTools endpoint on port ${PORT}. Start the app with: npx electron . --remote-debugging-port=${PORT}`);
}
const page = list.find((t) => t.type === 'page');
if (!page) fail('No page target found.');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) {
    waiting.get(d.id)(d);
    waiting.delete(d.id);
  }
};
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
const send = (method, params = {}, ms = 15000) =>
  new Promise((resolve) => {
    const id = ++nextId;
    const t = setTimeout(() => fail(`${method} timed out after ${ms} ms${method === 'Page.captureScreenshot' ? ' (is the window hidden behind others or on another Space?)' : ''}`), ms);
    waiting.set(id, (d) => {
      clearTimeout(t);
      resolve(d);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) fail(r.result.exceptionDetails.exception?.description || 'evaluation threw');
  console.log(JSON.stringify(r.result?.result?.value ?? null));
} else if (cmd === 'nav') {
  const url = arg.startsWith('/') ? new URL(arg, page.url).href : arg;
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, Number(extra) || 8000));
  const r = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  console.log(r.result?.result?.value);
} else if (cmd === 'shot') {
  await send('Page.bringToFront');
  const r = await send('Page.captureScreenshot', { format: 'png' }, 10000);
  fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log(arg);
} else {
  fail('usage: node cdp.mjs eval "<expr>" | nav <url|/path> [ms] | shot <out.png>');
}
ws.close();
process.exit(0);

// Renders apps/desktop/icon.svg to icon.icns. Run with: bun run app:icon
// Electron draws the SVG offscreen (keeping transparency); sips + iconutil make the .icns.
import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

app.dock?.hide();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const png = img.resize({ width: 1024, height: 1024 }).toPNG();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-icon-'));
  const base = path.join(tmp, 'icon-1024.png');
  fs.writeFileSync(base, png);
  fs.copyFileSync(base, path.join(here, 'icon.png'));
  const set = path.join(tmp, 'icon.iconset');
  fs.mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), base, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), base, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(here, 'icon.icns')]);
  console.log('Wrote apps/desktop/icon.icns and apps/desktop/icon.png');
  app.quit();
});

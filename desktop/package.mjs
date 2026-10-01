// Builds "World Studio.app", installs it to ~/Applications and puts a link on the Desktop.
// Run with: npm run app:install
// The app is a thin shell: it runs this checkout's Vite + harness in place, so games, engine
// edits and node_modules all stay here. Rebuild only when desktop/main.js or the icon changes.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const NAME = 'World Studio';
const KEEP = new Set(['/package.json', '/desktop', '/desktop/main.js', '/desktop/root.json']);

fs.writeFileSync(path.join(here, 'root.json'), JSON.stringify({ root }, null, 2));

const [outDir] = await packager({
  dir: root,
  name: NAME,
  executableName: NAME,
  appBundleId: 'com.e1ixyz.worldstudio',
  appCategoryType: 'public.app-category.developer-tools',
  icon: path.join(here, 'icon.icns'),
  out: path.join(here, 'out'),
  overwrite: true,
  prune: false,
  asar: false,
  ignore: (p) => p !== '' && !KEEP.has(p),
});

const built = path.join(outDir, `${NAME}.app`);
// ad-hoc sign so macOS accepts the modified bundle on Apple Silicon
execFileSync('codesign', ['--force', '--deep', '--sign', '-', built], { stdio: 'inherit' });

const appsDir = path.join(os.homedir(), 'Applications');
const installed = path.join(appsDir, `${NAME}.app`);
fs.mkdirSync(appsDir, { recursive: true });
fs.rmSync(installed, { recursive: true, force: true });
execFileSync('ditto', [built, installed]);

const link = path.join(os.homedir(), 'Desktop', `${NAME}.app`);
fs.rmSync(link, { force: true });
fs.symlinkSync(installed, link);
execFileSync('touch', [installed]); // nudge Finder to pick up the new icon

console.log(`Installed ${installed}\nDesktop link: ${link}`);

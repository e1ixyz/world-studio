// `bun run dev`: start the studio daemon for this checkout in the terminal, or point at the one
// that's already running (for example, started by the desktop app).
import { parseArgs, runDaemonProcess } from './daemon.ts';

const opts = parseArgs(process.argv.slice(2));
const result = await runDaemonProcess(opts);
if (result.kind === 'attached') {
  console.log(`World Studio is already running at ${result.url}\n(It belongs to another terminal or the desktop app. Open that URL, or stop it first.)`);
  process.exit(0);
}
console.log(`\n  World Studio  ${result.url}\n`);

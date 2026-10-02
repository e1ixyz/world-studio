// Wires the studio's services together. One Studio per daemon; the Vite plugin and the HTTP API
// are thin adapters over it.
import fs from 'node:fs';
import type { AgentRunner } from './domain/agent/runner.ts';
import { CliRunner } from './domain/agent/cli-runner.ts';
import { FakeRunner } from './domain/agent/fake-runner.ts';
import { SdkRunner } from './domain/agent/sdk-runner.ts';
import { checkGame } from './domain/check-game.ts';
import { ChatService } from './domain/chat.ts';
import { JsonChatRepository } from './domain/chat-store.ts';
import { FsCheckpointStore } from './domain/checkpoints/fs.ts';
import { GitCheckpointStore, gitAvailable } from './domain/checkpoints/git.ts';
import type { CheckpointStore } from './domain/checkpoints/store.ts';
import { StudioEvents } from './domain/events.ts';
import { relPath, studioPaths } from './domain/paths.ts';
import { LiveGames } from './domain/live.ts';
import { Projects } from './domain/projects.ts';
import { LATE_EVENT_MS, type ModuleInvalidator, ReloadCoordinator } from './domain/reloads.ts';
import { SettingsStore } from './domain/settings.ts';

export interface StudioOptions {
  root: string;
  runner?: AgentRunner;
  checkpoints?: CheckpointStore;
}

export type Studio = ReturnType<typeof createStudio>;

// DEVCHAT_RUNNER=sdk|cli|fake picks the runner. Default: the Agent SDK, unless DEVCHAT_CLAUDE points
// at another binary (scripts/fake-claude.mjs only speaks the CLI's stream-json). `fake` is the
// in-process test agent (domain/agent/fake-runner.ts).
export function defaultRunner(env = process.env): AgentRunner {
  const choice = env.DEVCHAT_RUNNER || (env.DEVCHAT_CLAUDE ? 'cli' : 'sdk');
  if (choice === 'fake') return new FakeRunner();
  return choice === 'cli' ? new CliRunner() : new SdkRunner();
}

export function createStudio({ root, runner = defaultRunner(), checkpoints }: StudioOptions) {
  const paths = studioPaths(root);
  const events = new StudioEvents();
  const settings = new SettingsStore(paths, events);
  // Git history when git is installed; folder copies otherwise.
  const store: CheckpointStore = checkpoints ?? (gitAvailable() ? new GitCheckpointStore(paths) : new FsCheckpointStore(paths));
  let invalidator: ModuleInvalidator = { invalidateFiles() {}, invalidateAll() {} };
  const live = new LiveGames(events);

  // biome-ignore lint/style/useConst: assigned below, used by the closures before that
  let chats: ChatService;
  const reloads = new ReloadCoordinator(
    paths.root,
    {
      anyJobRunning: () => chats.anyRunning(),
      recentJobChat: () => chats.recentJobChat(LATE_EVENT_MS),
      logReload: (slug, files, all) =>
        chats.push(slug, 'reload', `Reloading with ${files.length} changed file${files.length === 1 ? '' : 's'}${all ? ' (engine: all games)' : ''}`, {
          files: files.map((f) => relPath(paths, f)),
        }),
      sendReload: (scope) => events.emit('reload', scope),
      projectsChanged: () => events.emit('projects'),
    },
    { invalidateFiles: (f) => invalidator.invalidateFiles(f), invalidateAll: () => invalidator.invalidateAll() },
    (file) => fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs,
  );
  const projects = new Projects(paths, events, {
    isRunning: (slug) => chats.isRunning(slug),
    copied: (files) => reloads.markFresh(files),
    trashed: (slug, dest) => store.trash?.(slug, dest),
  });
  chats = new ChatService({
    paths,
    repo: new JsonChatRepository(paths),
    runner,
    checkpoints: store,
    projects,
    settings,
    events,
    checkGame: (slug, baseline) => checkGame(paths, slug, baseline),
    live,
    reloadNow: (slug) => reloads.flushNow(slug),
    onJobEnd: (slug) => reloads.jobEnded(slug),
    onRestore: (slug, engine) => {
      reloads.suppress(2500);
      invalidator.invalidateAll();
      setTimeout(() => events.emit('reload', engine ? { all: true } : { slugs: [slug] }), 300);
    },
  });

  return {
    paths,
    events,
    settings,
    projects,
    chats,
    checkpoints: store,
    reloads,
    live,
    setInvalidator(i: ModuleInvalidator) {
      invalidator = i;
    },
    close() {
      chats.stopAll();
      reloads.dispose();
    },
  };
}

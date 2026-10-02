// Wires the studio's services together. One Studio per daemon; the Vite plugin and the HTTP API
// are thin adapters over it.
import fs from 'node:fs';
import type { AgentRunner } from './domain/agent/runner.ts';
import { CliRunner } from './domain/agent/cli-runner.ts';
import { ChatService } from './domain/chat.ts';
import { JsonChatRepository } from './domain/chat-store.ts';
import { FsCheckpointStore } from './domain/checkpoints/fs.ts';
import type { CheckpointStore } from './domain/checkpoints/store.ts';
import { StudioEvents } from './domain/events.ts';
import { relPath, studioPaths } from './domain/paths.ts';
import { Projects } from './domain/projects.ts';
import { LATE_EVENT_MS, type ModuleInvalidator, ReloadCoordinator } from './domain/reloads.ts';
import { SettingsStore } from './domain/settings.ts';

export interface StudioOptions {
  root: string;
  runner?: AgentRunner;
  checkpoints?: CheckpointStore;
}

export type Studio = ReturnType<typeof createStudio>;

export function createStudio({ root, runner = new CliRunner(), checkpoints }: StudioOptions) {
  const paths = studioPaths(root);
  const events = new StudioEvents();
  const settings = new SettingsStore(paths, events);
  const store = checkpoints ?? new FsCheckpointStore(paths);
  let invalidator: ModuleInvalidator = { invalidateFiles() {}, invalidateAll() {} };

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
  });
  chats = new ChatService({
    paths,
    repo: new JsonChatRepository(paths),
    runner,
    checkpoints: store,
    projects,
    settings,
    events,
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
    setInvalidator(i: ModuleInvalidator) {
      invalidator = i;
    },
    close() {
      chats.stopAll();
      reloads.dispose();
    },
  };
}

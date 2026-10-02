// Studio-wide settings, shared by every project and every client of the daemon. They live in
// .harness/settings.json and are read fresh each time, so a hand edit takes effect at once.
import path from 'node:path';
import { Settings } from '@ws/shared';
import type { StudioEvents } from './events.ts';
import { readJSON, type StudioPaths, writeJSON } from './paths.ts';

export class SettingsStore {
  private file: string;
  private events: StudioEvents;
  constructor(paths: StudioPaths, events: StudioEvents) {
    this.file = path.join(paths.data, 'settings.json');
    this.events = events;
  }

  get(): Settings {
    const parsed = Settings.safeParse(readJSON(this.file, {}));
    return parsed.success ? parsed.data : Settings.parse({});
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.get(), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    writeJSON(this.file, next);
    this.events.emit('settings', next);
    return next;
  }
}

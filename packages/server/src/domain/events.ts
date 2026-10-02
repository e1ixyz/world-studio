// Studio-wide events. The Vite plugin forwards them to open pages as harness:* HMR events and the
// /api/events stream sends them to anything else that listens (the coming React shell).
import { EventEmitter } from 'node:events';
import type { Settings } from '@ws/shared';

export type ReloadScope = { all: true } | { slugs: string[] };

export interface StudioEventMap {
  projects: [];
  reload: [ReloadScope];
  settings: [Settings];
  job: [{ slug: string; running: boolean }];
}

export class StudioEvents extends EventEmitter<StudioEventMap> {}

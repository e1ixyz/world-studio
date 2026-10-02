import type { CheckpointMeta } from '@ws/shared';

// Snapshots of a game (and optionally the engine) taken before every prompt.
export interface CheckpointStore {
  create(slug: string, opts: { prompt: string; engine: boolean }): string;
  list(slug: string): CheckpointMeta[];
  // Puts the files back and reports whether the engine was restored too. Callers handle reloads.
  restore(slug: string, id: string): { meta: CheckpointMeta; engine: boolean };
}

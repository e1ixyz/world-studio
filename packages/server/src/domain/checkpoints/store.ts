import type { CheckpointDiff, CheckpointMeta } from '@ws/shared';

// Snapshots of a game (and optionally the engine) taken before every prompt.
export interface CheckpointStore {
  create(slug: string, opts: { prompt: string; engine: boolean }): string;
  // Called when the run for checkpoint `id` ends, so its changes can be recorded.
  settle?(slug: string, id: string): void;
  list(slug: string): CheckpointMeta[];
  // What the prompt after checkpoint `id` changed. Null when unknown (legacy checkpoints).
  diff?(slug: string, id: string): CheckpointDiff | null;
  // Puts the files back and reports whether the engine was restored too. Callers handle reloads.
  restore(slug: string, id: string): { meta: CheckpointMeta; engine: boolean };
  // The project moved to the trash: move its history along (into `dest`).
  trash?(slug: string, dest: string): void;
}

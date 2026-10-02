// Per-project chat logs. JSON files for now (.harness/projects/<slug>/chat.json); the database
// phase swaps in another ChatRepository.
import path from 'node:path';
import { ChatFile } from '@ws/shared';
import { readJSON, type StudioPaths, writeJSON } from './paths.ts';

export interface ChatRepository {
  load(slug: string): ChatFile;
  save(slug: string, data: ChatFile): void;
}

export class JsonChatRepository implements ChatRepository {
  private p: StudioPaths;
  constructor(p: StudioPaths) {
    this.p = p;
  }
  private file(slug: string) {
    return path.join(this.p.data, 'projects', slug, 'chat.json');
  }
  load(slug: string): ChatFile {
    const parsed = ChatFile.safeParse(readJSON(this.file(slug), {}));
    return parsed.success ? parsed.data : { sessionId: null, seq: 0, log: [] };
  }
  save(slug: string, data: ChatFile) {
    writeJSON(this.file(slug), { sessionId: data.sessionId ?? null, seq: data.seq, log: data.log });
  }
}

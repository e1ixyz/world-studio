// One project's chat: the log replayed from the daemon, then live items, plus the job state.
// EventSource reconnects by itself and resumes from the last item (Last-Event-ID).
import type { ChatState } from '@ws/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogItem } from './timeline.ts';

export function useChat(slug: string, onLive: (item: LogItem) => void) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [state, setState] = useState<ChatState | null>(null);
  const [offline, setOffline] = useState(false);
  const lastSeq = useRef(0);
  const live = useRef(false);
  const localId = useRef(0);
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;

  useEffect(() => {
    setItems([]);
    lastSeq.current = 0;
    live.current = false;
    const es = new EventSource(`/api/chat/${slug}/events?since=0`);
    es.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.kind === 'state') {
        setState(m);
        setOffline(false);
        live.current = true; // the replay is over; what follows is live
        return;
      }
      if (m.seq <= lastSeq.current) return;
      lastSeq.current = m.seq;
      setItems((prev) => [...prev, m]);
      if (live.current) onLiveRef.current(m);
    };
    es.onerror = () => setOffline(true);
    return () => es.close();
  }, [slug]);

  const addError = useCallback((text: string) => {
    const item: LogItem = { kind: 'error', text, fixable: true, localId: ++localId.current, ts: Date.now() };
    setItems((prev) => [...prev, item]);
    onLiveRef.current(item);
  }, []);
  const clear = useCallback(() => setItems([]), []);

  return { items, state, offline, running: !!state?.running, addError, clear };
}

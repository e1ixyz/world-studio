// The studio's end of the bridge to the framed game (packages/bridge).
import { GameMessage, listen, type StudioMessageBody, send } from '@ws/bridge';
import { type RefObject, useCallback, useEffect, useRef } from 'react';

export function useGameBridge(frame: RefObject<HTMLIFrameElement | null>, onMessage: (m: GameMessage) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const waiting = useRef(new Map<number, (text: string) => void>());
  const probes = useRef(new Map<string, (r: { ok: boolean; data?: unknown; error?: string }) => void>());
  const nextId = useRef(0);

  useEffect(
    () =>
      listen(
        () => frame.current?.contentWindow,
        location.origin,
        GameMessage,
        (m) => {
          if (m.t === 'context') {
            waiting.current.get(m.id)?.(m.text);
            waiting.current.delete(m.id);
            return;
          }
          if (m.t === 'probeResult') {
            probes.current.get(m.id)?.(m);
            probes.current.delete(m.id);
            return;
          }
          handler.current(m);
        },
      ),
    [frame],
  );

  const post = useCallback((msg: StudioMessageBody) => send(frame.current?.contentWindow, msg, location.origin), [frame]);

  // "[Game context: …]" from the game, or '' if it doesn't answer in time (crashed, still loading).
  const requestContext = useCallback(
    () =>
      new Promise<string>((resolve) => {
        const id = ++nextId.current;
        const timer = setTimeout(() => {
          waiting.current.delete(id);
          resolve('');
        }, 600);
        waiting.current.set(id, (text) => {
          clearTimeout(timer);
          resolve(text);
        });
        post({ t: 'requestContext', id });
      }),
    [post],
  );

  // Ask the game one of the agent's questions; answers with an error if the game doesn't reply.
  const probe = useCallback(
    (id: string, what: 'screenshot' | 'state') =>
      new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
        const timer = setTimeout(() => {
          probes.current.delete(id);
          resolve({ ok: false, error: 'The game did not answer (it may still be loading, or it crashed).' });
        }, 6000);
        probes.current.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        post({ t: 'probe', id, what });
      }),
    [post],
  );

  return { post, requestContext, probe };
}

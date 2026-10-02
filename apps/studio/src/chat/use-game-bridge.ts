// The studio's end of the bridge to the framed game (packages/bridge).
import { GameMessage, listen, type StudioMessageBody, send } from '@ws/bridge';
import { type RefObject, useCallback, useEffect, useRef } from 'react';

export function useGameBridge(frame: RefObject<HTMLIFrameElement | null>, onMessage: (m: GameMessage) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const waiting = useRef(new Map<number, (text: string) => void>());
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

  return { post, requestContext };
}

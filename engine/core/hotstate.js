// Session snapshot that survives a dev-server reload, so code changes don't reset the game.
const MAX_AGE = 2 * 60 * 1000;
const keyFor = (slug) => `worldstudio:hot:${slug}`;

export function saveSnapshot(slug, data) {
  try {
    sessionStorage.setItem(keyFor(slug), JSON.stringify({ t: Date.now(), data }));
  } catch { /* storage unavailable: reload starts fresh */ }
}

export function takeSnapshot(slug) {
  try {
    const raw = sessionStorage.getItem(keyFor(slug));
    sessionStorage.removeItem(keyFor(slug));
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    return Date.now() - t < MAX_AGE ? data : null;
  } catch {
    return null;
  }
}

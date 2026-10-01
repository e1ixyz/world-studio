// Production builds only (the dev server lists projects through /__harness/projects).
export const metas = import.meta.glob('/games/*/game.json', { eager: true, import: 'default' });

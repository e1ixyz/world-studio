// Production builds only (the dev server lists projects through the studio API).
export const metas = import.meta.glob('/games/*/game.json', { eager: true, import: 'default' });

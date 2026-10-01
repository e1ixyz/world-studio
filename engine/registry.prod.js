// Production builds only: bundle every game (the dev server imports games directly by URL instead).
export const games = import.meta.glob('/games/*/game.js');
export const json = import.meta.glob(['/games/*/game.json', '/games/*/tweaks.json'], { eager: true, import: 'default' });

import { createRng } from '../../engine/core/rng.js';

// This game's own seeded RNG. Changing the order of rand() calls regenerates a different city.
export const { rand, rr, ri, pick } = createRng(20260930);

/* eslint-disable no-bitwise */ // a PRNG is bit manipulation by nature
/**
 * Deterministic replacement for `Math.random()` used by the headless simulator.
 *
 * lodash keeps its own reference to `Math.random` when it is first loaded, so
 * `installSeededRandom()` must run before any engine module is required. After
 * that, `reseed()` can be called at the start of every episode to make the whole
 * simulation (spawns, callsigns, aircraft types, pilot voices...) reproducible.
 *
 * The generator is mulberry32: fast, 32 bit state, and good enough statistically
 * for traffic generation.
 */

let state = 0;

/**
 * @function nextRandom
 * @return {number} uniformly distributed in [0, 1)
 */
function nextRandom() {
    state = (state + 0x6D2B79F5) | 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Restart the sequence from `seed`
 *
 * @function reseed
 * @param seed {number}
 */
export function reseed(seed) {
    state = Number(seed) >>> 0;
}

/**
 * Replace the global `Math.random`. Must be called before lodash is loaded.
 *
 * @function installSeededRandom
 * @param seed {number}
 */
export function installSeededRandom(seed = 0) {
    reseed(seed);
    Math.random = nextRandom;
}

/* eslint-disable no-bitwise */ // a PRNG is bit manipulation by nature
/**
 * Arrival sequencing: scheduled landing times and sequence optimization with
 * simulated annealing under Constrained Position Shifting (CPS).
 */

/**
 * Small deterministic random generator (mulberry32), so bots never consume the
 * simulation's own random numbers
 *
 * @function createRandom
 * @param seed {number}
 * @return {function} returns numbers in [0, 1)
 */
export function createRandom(seed) {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6D2B79F5) | 0;

        let t = state;

        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Scheduled times for a landing order: each aircraft lands at its earliest time
 * or the minimum interval after the previous one, whichever is later
 *
 * @function scheduleSequence
 * @param order {array<object>}      items `{ id, eta }` in landing order
 * @param intervalSeconds {function} `(leader, follower) => seconds`
 * @param [startTime] {number}       earliest time for the first one
 * @return {array<number>}           scheduled time of each item
 */
export function scheduleSequence(order, intervalSeconds, startTime = -Infinity) {
    const times = [];

    for (let i = 0; i < order.length; i++) {
        const earliest = i === 0 ? startTime : times[i - 1] + intervalSeconds(order[i - 1], order[i]);

        times.push(Math.max(order[i].eta, earliest));
    }

    return times;
}

/**
 * Weighted delay of a landing order
 *
 * @function sequenceCost
 * @param order {array<object>}   items `{ id, eta, weight }`
 * @param times {array<number>}
 * @return {number}
 */
export function sequenceCost(order, times) {
    return order.reduce((cost, item, i) => cost + (times[i] - item.eta) * (item.weight || 1), 0);
}

const respectsShift = (order, fcfsPosition, maxShift) => order.every(
    (item, index) => Math.abs(index - fcfsPosition[item.id]) <= maxShift
);

/**
 * Best landing order found by simulated annealing
 *
 * The first `frozenCount` items keep their position. The others may move at
 * most `maxShift` places from the first-come first-served order (by `eta`).
 *
 * @function optimizeSequence
 * @param items {array<object>}  `{ id, eta, weight }`
 * @param options {object}
 * @param options.intervalSeconds {function}
 * @param [options.frozenCount] {number}
 * @param [options.maxShift] {number}
 * @param [options.previousOrder] {array<string>}   ids, to favour a stable sequence
 * @param [options.stabilityCost] {number}          seconds of cost per changed position
 * @param [options.iterations] {number}
 * @param [options.random] {function}
 * @return {array<object>} items in landing order
 */
export function optimizeSequence(items, options) {
    const {
        intervalSeconds,
        frozenCount = 0,
        maxShift = 2,
        previousOrder = [],
        stabilityCost = 0,
        iterations = 300,
        random = createRandom(1)
    } = options;
    const fcfs = items.slice().sort((a, b) => a.eta - b.eta);
    const frozenIds = new Set(items.slice(0, frozenCount).map((item) => item.id));
    const frozen = items.slice(0, frozenCount);
    const free = fcfs.filter((item) => !frozenIds.has(item.id));
    const fcfsPosition = {};

    free.forEach((item, index) => {
        fcfsPosition[item.id] = index;
    });

    if (free.length < 2 || maxShift === 0) {
        return [...frozen, ...free];
    }

    const previousIndex = {};

    previousOrder.forEach((id, index) => {
        previousIndex[id] = index;
    });

    const evaluate = (candidate) => {
        const order = [...frozen, ...candidate];
        const times = scheduleSequence(order, intervalSeconds);
        let cost = sequenceCost(order, times);

        if (stabilityCost > 0 && previousOrder.length > 0) {
            const previousFree = previousOrder.filter((id) => fcfsPosition[id] !== undefined);
            const previousRank = {};

            previousFree.forEach((id, index) => {
                previousRank[id] = index;
            });

            candidate.forEach((item, index) => {
                if (previousRank[item.id] !== undefined && previousRank[item.id] !== index) {
                    cost += stabilityCost;
                }
            });
        }

        return cost;
    };

    // start from the previous order when it is still valid, otherwise first-come first-served
    let current = free.slice();
    const previousCandidate = free.slice().sort((a, b) => {
        const rankA = previousIndex[a.id] === undefined ? Infinity : previousIndex[a.id];
        const rankB = previousIndex[b.id] === undefined ? Infinity : previousIndex[b.id];

        return rankA === rankB ? a.eta - b.eta : rankA - rankB;
    });

    if (respectsShift(previousCandidate, fcfsPosition, maxShift)) {
        current = previousCandidate;
    }

    let currentCost = evaluate(current);
    let best = current;
    let bestCost = currentCost;
    let temperature = 60;

    for (let i = 0; i < iterations; i++) {
        const a = Math.floor(random() * current.length);
        const b = Math.min(current.length - 1, a + 1 + Math.floor(random() * Math.min(maxShift, 2)));

        if (a === b) {
            continue;
        }

        const candidate = current.slice();

        [candidate[a], candidate[b]] = [candidate[b], candidate[a]];

        if (!respectsShift(candidate, fcfsPosition, maxShift)) {
            continue;
        }

        const candidateCost = evaluate(candidate);

        if (candidateCost < currentCost || random() < Math.exp((currentCost - candidateCost) / temperature)) {
            current = candidate;
            currentCost = candidateCost;

            if (currentCost < bestCost) {
                best = current;
                bestCost = currentCost;
            }
        }

        temperature *= 0.98;
    }

    return [...frozen, ...best];
}

import ava from 'ava';

import {
    createRandom,
    optimizeSequence,
    scheduleSequence,
    sequenceCost
} from '../../src/assets/scripts/client/bot/botA/sequencing';

// a heavy needs 120 s behind it, any other pair 60 s
const interval = (leader) => (leader.heavy ? 120 : 60);
const ids = (order) => order.map((item) => item.id);

ava('createRandom() is deterministic', (t) => {
    const a = createRandom(7);
    const b = createRandom(7);

    t.is(a(), b());
    t.is(a(), b());
});

ava('scheduleSequence() keeps the minimum interval between landings', (t) => {
    const order = [{ id: 'A', eta: 0, heavy: true }, { id: 'B', eta: 10 }, { id: 'C', eta: 500 }];

    t.deepEqual(scheduleSequence(order, interval), [0, 120, 500]);
});

ava('optimizeSequence() reduces the total delay', (t) => {
    const items = [
        {
            id: 'HEAVY', eta: 0, heavy: true, weight: 1
        },
        { id: 'M1', eta: 5, weight: 1 },
        { id: 'M2', eta: 10, weight: 1 },
        { id: 'M3', eta: 15, weight: 1 }
    ];
    const fcfsCost = sequenceCost(items, scheduleSequence(items, interval));
    const order = optimizeSequence(items, { intervalSeconds: interval, maxShift: 3, iterations: 500 });

    t.true(sequenceCost(order, scheduleSequence(order, interval)) < fcfsCost);
    t.is(order[order.length - 1].id, 'HEAVY');
});

ava('optimizeSequence() respects the maximum position shift and frozen aircraft', (t) => {
    const items = [
        { id: 'HEAVY', eta: 0, heavy: true },
        { id: 'M1', eta: 5 },
        { id: 'M2', eta: 10 },
        { id: 'M3', eta: 15 }
    ];

    t.is(optimizeSequence(items, { intervalSeconds: interval, maxShift: 1, iterations: 500 })[1].id, 'HEAVY');
    t.is(optimizeSequence(items, { intervalSeconds: interval, maxShift: 3, frozenCount: 1 })[0].id, 'HEAVY');
    t.deepEqual(ids(optimizeSequence(items, { intervalSeconds: interval, maxShift: 0 })), ['HEAVY', 'M1', 'M2', 'M3']);
});

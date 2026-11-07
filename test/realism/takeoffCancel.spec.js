import ava from 'ava';

import {
    judgeTakeoffCancel,
    rejectedTakeoffOccupancySeconds,
    takeoffDecisionSpeed
} from '../../src/assets/scripts/client/realism/takeoffCancel';

const situation = (overrides = {}) => ({
    occupants: [],
    wakeLeader: null,
    arrivals: [],
    arrivalSeparationNm: 2,
    ...overrides
});

ava('V1 is 90 % of the rotation speed', (t) => {
    t.is(takeoffDecisionSpeed({ min: 130 }), 117);
});

ava('the faster the rejected takeoff, the longer the runway is occupied', (t) => {
    t.is(rejectedTakeoffOccupancySeconds(40), 55);
    t.is(rejectedTakeoffOccupancySeconds(100), 130);
});

ava('a cancellation with everything clear is not justified', (t) => {
    t.false(judgeTakeoffCancel(situation()).isJustified);
});

ava('another aircraft on the runway justifies a cancellation', (t) => {
    const verdict = judgeTakeoffCancel(situation({ occupants: ['OTH1'] }));

    t.true(verdict.isJustified);
    t.true(verdict.reason.includes('OTH1'));
});

ava('the wake interval justifies a cancellation', (t) => {
    t.true(judgeTakeoffCancel(situation({ wakeLeader: { callsign: 'OTH1', elapsed: 60, required: 120 } })).isJustified);
});

ava('only a close arrival justifies a cancellation', (t) => {
    const arrival = (distanceNm) => ({
        callsign: 'ARR1', distanceNm, seconds: 300, isEmergency: false
    });

    t.true(judgeTakeoffCancel(situation({ arrivals: [arrival(2.5)] })).isJustified);
    t.false(judgeTakeoffCancel(situation({ arrivals: [arrival(10)] })).isJustified);
});

ava('an emergency landing soon on the runway justifies a cancellation', (t) => {
    const emergency = (seconds) => ({
        callsign: 'EMG1', distanceNm: 15, seconds, isEmergency: true
    });

    t.true(judgeTakeoffCancel(situation({ arrivals: [emergency(200)] })).isJustified);
    t.false(judgeTakeoffCancel(situation({ arrivals: [emergency(400)] })).isJustified);
});

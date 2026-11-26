import ava from 'ava';
import {
    RA_SENSE,
    STCA_LEVEL,
    TCAS_STATE,
    coordinatedSenses,
    isContraryToRa,
    isInsidePolygon,
    predictAltitude,
    sensitivityLevel,
    stcaLevel,
    stcaTimeToLoss,
    tcasThreatLevel,
    timeBelowMinimumAltitude,
    timeToAreaEntry
} from '../../src/assets/scripts/client/safety/safetyNetLogic';

const KT = 1 / 3600; // nm/s per knot
const MINIMA = { lateralNm: 3, verticalFt: 950 };

// heading in degrees, speed in knots, vertical speed in ft/min
const aircraft = ({
    x = 0, y = 0, heading = 0, speed = 250, altitude = 10000, fpm = 0, target = null, heightAgl = null, ceiling = 41000
}) => ({
    x,
    y,
    vx: Math.sin(heading * Math.PI / 180) * speed * KT,
    vy: Math.cos(heading * Math.PI / 180) * speed * KT,
    altitude,
    verticalSpeed: fpm / 60,
    targetAltitude: target === null ? altitude : target,
    heightAgl: heightAgl === null ? altitude : heightAgl,
    ceiling
});

ava('predictAltitude levels off at the cleared altitude', (t) => {
    const climbing = aircraft({ altitude: 5000, fpm: 1800, target: 6000 });

    t.is(predictAltitude(climbing, 10), 5300);
    t.is(predictAltitude(climbing, 60), 6000);
});

// STC-001
ava('STCA: head-on at the same level 10 nm apart is an alert (loss in about 50 s)', (t) => {
    const first = aircraft({ y: 0, heading: 0 });
    const second = aircraft({ y: 10, heading: 180 });
    const time = stcaTimeToLoss(first, second, MINIMA);

    t.true(time >= 50 && time <= 55);
    t.is(stcaLevel(time), STCA_LEVEL.ALERT);
});

ava('STCA: a conflict 90 s away is only predicted', (t) => {
    const first = aircraft({ y: 0, heading: 0 });
    const second = aircraft({ y: 15.5, heading: 180 });

    t.is(stcaLevel(stcaTimeToLoss(first, second, MINIMA)), STCA_LEVEL.PREDICTED);
});

ava('STCA: 1000 ft apart and level is no conflict', (t) => {
    const first = aircraft({ y: 0, heading: 0, altitude: 10000 });
    const second = aircraft({ y: 5, heading: 180, altitude: 11000 });

    t.is(stcaTimeToLoss(first, second, MINIMA), null);
});

ava('STCA: a climb cleared to 1000 ft below the other aircraft is no conflict', (t) => {
    const first = aircraft({
        y: 0, heading: 0, altitude: 8000, fpm: 2000, target: 9000
    });
    const second = aircraft({ y: 6, heading: 180, altitude: 10000 });

    t.is(stcaTimeToLoss(first, second, MINIMA), null);
});

ava('STCA: a climb through the other aircraft\'s level is a conflict', (t) => {
    const first = aircraft({
        y: 0, heading: 0, altitude: 8000, fpm: 2000, target: 12000
    });
    const second = aircraft({ y: 6, heading: 180, altitude: 10000 });

    t.not(stcaTimeToLoss(first, second, MINIMA), null);
});

ava('STCA: diverging aircraft already 3 nm apart are not in conflict', (t) => {
    const first = aircraft({ x: 0, heading: 270 });
    const second = aircraft({ x: 3.5, heading: 90 });

    t.is(stcaTimeToLoss(first, second, MINIMA), null);
});

// TCA-001
ava('TCAS sensitivity levels follow height above the ground, then altitude', (t) => {
    t.is(sensitivityLevel(1500, 500).level, 2);
    t.is(sensitivityLevel(3000, 1500).level, 3);
    t.is(sensitivityLevel(4000, 3000).level, 4);
    t.is(sensitivityLevel(8000, 7000).level, 5);
    t.is(sensitivityLevel(15000, 14000).level, 6);
    t.is(sensitivityLevel(35000, 34000).level, 7);
});

ava('TCAS: head-on at the same level gives a TA, then an RA', (t) => {
    const own = aircraft({ y: 0, heading: 0, altitude: 8000 });

    // SL5: TA tau 40 s, RA tau 25 s; closing at 500 kt (0.139 nm/s)
    t.is(tcasThreatLevel(own, aircraft({ y: 5, heading: 180, altitude: 8000 })), TCAS_STATE.TA);
    t.is(tcasThreatLevel(own, aircraft({ y: 3, heading: 180, altitude: 8000 })), TCAS_STATE.RA);
    t.is(tcasThreatLevel(own, aircraft({ y: 12, heading: 180, altitude: 8000 })), TCAS_STATE.CLEAR);
});

ava('TCAS: 1000 ft apart, level, gives no RA', (t) => {
    const own = aircraft({ y: 0, heading: 0, altitude: 8000 });

    t.not(tcasThreatLevel(own, aircraft({ y: 3, heading: 180, altitude: 9000 })), TCAS_STATE.RA);
});

ava('TCAS: crossing at 90 degrees, converging vertically, gives an RA', (t) => {
    const own = aircraft({
        x: 0, y: 0, heading: 0, altitude: 12000, fpm: -1500, target: 9000
    });
    const intruder = aircraft({
        x: -2, y: 2, heading: 90, altitude: 11500, fpm: 0
    });

    t.is(tcasThreatLevel(own, intruder), TCAS_STATE.RA);
});

// TCA-002
ava('TCAS: no RA below 1000 ft above the ground', (t) => {
    const own = aircraft({
        y: 0, heading: 0, altitude: 1500, heightAgl: 800
    });
    const intruder = aircraft({
        y: 1, heading: 180, altitude: 1500, heightAgl: 800
    });

    t.not(tcasThreatLevel(own, intruder), TCAS_STATE.RA);
});

ava('TCAS: the aircraft above climbs and the one below descends (no crossing)', (t) => {
    const upper = aircraft({ altitude: 8200 });
    const lower = aircraft({ altitude: 8000 });

    t.deepEqual(coordinatedSenses(upper, lower, 350), [RA_SENSE.CLIMB, RA_SENSE.DESCEND]);
    t.deepEqual(coordinatedSenses(lower, upper, 350), [RA_SENSE.DESCEND, RA_SENSE.CLIMB]);
});

ava('TCAS: if levelling off keeps ALIM, both level off', (t) => {
    const climbing = aircraft({ altitude: 7400, fpm: 2000 });
    const level = aircraft({ altitude: 8000 });

    t.deepEqual(coordinatedSenses(climbing, level, 350), [RA_SENSE.LEVEL, RA_SENSE.LEVEL]);
});

ava('TCAS: no descend RA close to the ground, the senses are swapped', (t) => {
    const upper = aircraft({ altitude: 2300, heightAgl: 1700 });
    const lower = aircraft({ altitude: 2200, heightAgl: 1050 });

    t.deepEqual(coordinatedSenses(upper, lower, 300), [RA_SENSE.DESCEND, RA_SENSE.CLIMB]);
});

ava('TCAS: a clearance against the RA is detected', (t) => {
    t.true(isContraryToRa(RA_SENSE.CLIMB, 8000, 7000));
    t.false(isContraryToRa(RA_SENSE.CLIMB, 8000, 9000));
    t.true(isContraryToRa(RA_SENSE.DESCEND, 8000, 9000));
    t.true(isContraryToRa(RA_SENSE.LEVEL, 8000, 9000));
    t.false(isContraryToRa(RA_SENSE.LEVEL, 8000, 8000));
});

ava('isInsidePolygon', (t) => {
    const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];

    t.true(isInsidePolygon({ x: 1, y: 1 }, square));
    t.false(isInsidePolygon({ x: 3, y: 1 }, square));
});

ava('APW: entry into a restricted area below its ceiling within 60 s', (t) => {
    const area = { name: 'R-1', height: 5000, polygon: [{ x: -1, y: 5 }, { x: 1, y: 5 }, { x: 1, y: 7 }, { x: -1, y: 7 }] };
    const entry = timeToAreaEntry(aircraft({
        y: 0, heading: 0, speed: 360, altitude: 4000
    }), [area]);

    t.truthy(entry);
    t.is(entry.area.name, 'R-1');
    t.is(timeToAreaEntry(aircraft({
        y: 0, heading: 0, speed: 360, altitude: 6000
    }), [area]), null);
});

ava('MSAW: a descent below the minimum altitude within 30 s', (t) => {
    const descending = aircraft({ altitude: 4500, fpm: -1500, target: 3000 });

    t.not(timeBelowMinimumAltitude(descending, () => 4000, 100), null);
    t.is(timeBelowMinimumAltitude(aircraft({ altitude: 4500 }), () => 4000, 100), null);
});

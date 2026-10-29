import ava from 'ava';

import {
    RunwayIndex,
    checkTakeoff,
    finalSpacingNm,
    landingIntervalSeconds,
    minimumAssignableAltitude
} from '../../src/assets/scripts/client/bot/botRules';
import { createAircraft, createObservation } from './_observationFixture';

const createDeparture = (overrides = {}) => createAircraft({
    callsign: 'DEP1',
    category: 'departure',
    flightPhase: 'WAITING',
    isOnGround: true,
    departureRunway: '27',
    arrivalRunway: null,
    route: 'TEST27.SID1A.EXIT',
    ...overrides
});

ava('RunwayIndex groups runway ends by physical runway', (t) => {
    const index = new RunwayIndex(createObservation().airport);

    t.is(index.physicalName['27'], '27/09');
    t.true(index.areDependent('27', '09'));
});

ava('checkTakeoff() refuses an occupied runway', (t) => {
    const departure = createDeparture();
    const observation = createObservation([departure], {
        runwayOccupancy: [{ runway: '27/09', occupants: [{ callsign: 'ARR1', kind: 'arrival', remainingSeconds: 20 }] }]
    });

    t.false(checkTakeoff(departure, observation, new RunwayIndex(observation.airport)).ok);
});

ava('checkTakeoff() waits for the wake turbulence interval behind a heavy', (t) => {
    const heavy = createAircraft({
        callsign: 'HVY1', category: 'departure', recatEu: 'B', weightClass: 'H', departureRunway: '27'
    });
    const departure = createDeparture();
    const observation = (secondsAgo) => createObservation([heavy, departure], {
        lastTakeoffs: [{ runway: '27/09', callsign: 'HVY1', secondsAgo }]
    });

    t.false(checkTakeoff(departure, observation(60), new RunwayIndex(observation(60).airport)).ok);
    t.true(checkTakeoff(departure, observation(130), new RunwayIndex(observation(130).airport)).ok);
});

ava('checkTakeoff() refuses when an arrival is too close to the threshold', (t) => {
    const arrival = createAircraft({
        callsign: 'ARR1', x: 2, hasApproachClearance: true, groundSpeed: 140
    });
    const departure = createDeparture();
    const observation = createObservation([arrival, departure]);

    t.false(checkTakeoff(departure, observation, new RunwayIndex(observation.airport)).ok);

    arrival.x = 8;
    t.true(checkTakeoff(departure, observation, new RunwayIndex(observation.airport)).ok);
});

ava('finalSpacingNm() uses the wake minimum when it is larger than the radar minimum', (t) => {
    const heavy = createAircraft({ recatEu: 'B' });
    const medium = createAircraft({ recatEu: 'D' });
    const observation = createObservation();

    t.is(finalSpacingNm(heavy, medium, observation, { finalSpacingBufferNm: 0 }), 4);
    t.is(finalSpacingNm(medium, medium, observation, { finalSpacingBufferNm: 0 }), 2.5);
});

ava('landingIntervalSeconds() grows with the wake distance and the speed of the follower', (t) => {
    const leader = createAircraft({ recatEu: 'A' });
    const follower = createAircraft({ recatEu: 'F', speedLimits: { min: 50, landing: 60, max: 150 } });
    const interval = landingIntervalSeconds(leader, follower, createObservation(), {
        finalSpacingBufferNm: 0,
        landingOccupancyBufferSeconds: 0
    });

    // 8 nm at 120 kt
    t.is(interval, 240);
});

ava('minimumAssignableAltitude() uses the minimum vectoring altitude when known', (t) => {
    t.is(minimumAssignableAltitude(createAircraft({ minimumVectoringAltitude: 6000 }), createObservation()), 6000);
    t.is(minimumAssignableAltitude(createAircraft(), createObservation()), 2000);
});

ava('minimumAssignableAltitude() stays above the floor of the airspace here and ahead', (t) => {
    t.is(minimumAssignableAltitude(createAircraft({ airspaceFloor: 3500 }), createObservation()), 4000);
    t.is(minimumAssignableAltitude(createAircraft({ airspaceFloor: 0, airspaceFloorAhead: 9500 }), createObservation()), 10000);
    t.is(minimumAssignableAltitude(createAircraft({ airspaceFloor: 0, airspaceFloorAhead: null }), createObservation()), 2000);
});

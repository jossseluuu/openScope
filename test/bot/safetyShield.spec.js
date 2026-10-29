import ava from 'ava';

import SafetyShield from '../../src/assets/scripts/client/bot/safetyShield';
import { ACTIONS, ACTION_INDEX, ACTION_TYPE } from '../../src/assets/scripts/client/bot/actionSpace';
import { createAircraft, createObservation } from './_observationFixture';

ava('the shield forbids a takeoff on an occupied runway', (t) => {
    const departure = createAircraft({
        callsign: 'DEP1', category: 'departure', flightPhase: 'WAITING', isOnGround: true, departureRunway: '27'
    });
    const observation = createObservation([departure], {
        runwayOccupancy: [{ runway: '27/09', occupants: [{ callsign: 'X', kind: 'arrival', remainingSeconds: 30 }] }]
    });

    t.false(new SafetyShield().getActionMask(departure, observation)[ACTION_INDEX.TAKEOFF]);
});

ava('the shield forbids altitudes below the minimum vectoring altitude', (t) => {
    const aircraft = createAircraft({ minimumVectoringAltitude: 6000 });
    const mask = new SafetyShield().getActionMask(aircraft, createObservation([aircraft]));

    ACTIONS.filter((action) => action.type === ACTION_TYPE.ALTITUDE).forEach((action) => {
        t.is(mask[action.index], action.value >= 6000);
    });
});

ava('the shield sends around a follower too close on short final', (t) => {
    const onFinal = {
        flightPhase: 'LANDING', hasApproachClearance: true, heading: 270, y: 0
    };
    const leader = createAircraft({ callsign: 'LEAD', x: 2, ...onFinal });
    const follower = createAircraft({ callsign: 'FOLL', x: 3.5, ...onFinal });
    const required = new SafetyShield().getRequiredActions(createObservation([leader, follower]));

    t.deepEqual(required, { FOLL: ACTION_INDEX.GO_AROUND });
});

ava('the shield breaks off a follower too close far out on final', (t) => {
    const onFinal = {
        flightPhase: 'APPROACH', hasApproachClearance: true, heading: 270, y: 0.1
    };
    const leader = createAircraft({ callsign: 'LEAD', x: 10, ...onFinal });
    const follower = createAircraft({ callsign: 'FOLL', x: 11.5, ...onFinal });
    const required = new SafetyShield().getRequiredActions(createObservation([leader, follower]));

    t.is(ACTIONS[required.FOLL].type, ACTION_TYPE.HEADING);
});

ava('the shield climbs an arrival heading for a sector with a higher floor', (t) => {
    const clearance = {
        altitudeMode: 'HOLD', altitude: 4000, headingMode: 'HOLD', heading: 40, speedMode: 'HOLD', speed: 180
    };
    const low = createAircraft({
        callsign: 'LOW', altitude: 4000, airspaceFloor: 3500, airspaceFloorAhead: 4500, clearance
    });
    const high = createAircraft({
        callsign: 'HIGH', altitude: 6000, airspaceFloorAhead: 4500, clearance: { ...clearance, altitude: 6000 }
    });
    const required = new SafetyShield().getRequiredActions(createObservation([low, high]));

    t.is(ACTIONS[required.LOW].value, 5000);
    t.is(required.HIGH, undefined);
});

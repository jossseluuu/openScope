import ava from 'ava';
import sinon from 'sinon';
import AircraftConflict from '../../src/assets/scripts/client/aircraft/AircraftConflict';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import GameController from '../../src/assets/scripts/client/game/GameController';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import { SEPARATION } from '../../src/assets/scripts/client/constants/aircraftConstants';
import { degreesToRadians } from '../../src/assets/scripts/client/utilities/unitConverters';

// SEP-001/002: 3 nm (5.556 km) or 1000 ft; conflict = violation or within 1 nm more; passing and diverging
// exceptions (FAA JO 7110.65 5-5-7); collision below 0.05 km and 160 ft inside the airspace.

const NM = 1.852;
let sandbox;
let runwayRelationship;

function aircraft(callsign, x, y, altitude, headingDeg, overrides = {}) {
    const heading = degreesToRadians(headingDeg);

    return {
        callsign,
        relativePosition: [x, y],
        altitude,
        heading,
        groundTrack: heading,
        takeoffTime: -1000,
        hit: false,
        isOnGround: () => false,
        isInsideAirspace: () => true,
        isEstablishedOnCourse: () => false,
        fms: { currentLeg: { isSidLeg: false }, arrivalRunwayModel: { name: '32L' } },
        ...overrides
    };
}

/**
 * Build a conflict without the constructor, which looks the pair up in `window.aircraftController`
 */
function conflictBetween(first, second, previousDistance) {
    const conflict = Object.create(AircraftConflict.prototype);

    conflict.aircraft = [first, second];
    conflict.conflicts = {};
    conflict.violations = {};
    conflict.collided = false;
    conflict.distance = 0;
    conflict._recalculateLateralAndVerticalDistances();

    if (typeof previousDistance === 'number') {
        conflict.distance_delta = conflict.distance - previousDistance;
    }

    return conflict;
}

ava.beforeEach(() => {
    sandbox = sinon.createSandbox();
    runwayRelationship = { parallel: false, separationMinimum: SEPARATION.STANDARD_LATERAL_KM };
    sandbox.stub(AirportController, 'airport_get').returns({
        elevation: 0,
        getRunwayRelationshipForRunwayNames: () => runwayRelationship
    });
    sandbox.stub(GameController, 'events_recordNew');
    sandbox.stub(UiController, 'ui_log');
});

ava.afterEach.always(() => {
    sandbox.restore();
});

ava.serial('distances are recalculated from the positions and altitudes', (t) => {
    const conflict = conflictBetween(aircraft('A', 0, 0, 5000, 0), aircraft('B', 3, 4, 5600, 0));

    t.is(conflict.distance, 5);
    t.is(conflict.altitude, 600);
});

ava.serial('1000 ft of vertical separation clears conflict and violation', (t) => {
    const conflict = conflictBetween(aircraft('A', 0, 0, 5000, 0), aircraft('B', 0.5, 0, 6000, 180));

    conflict.checkProximity();

    t.false(conflict.hasAlerts());
});

ava.serial('closer than 3 nm and less than 1000 ft is a violation and a conflict', (t) => {
    // same heading, one behind the other: no diverging exception
    const conflict = conflictBetween(aircraft('A', 0, 0, 5000, 0), aircraft('B', 0, 2 * NM, 5500, 0));

    conflict.checkProximity();

    t.true(conflict.violations.proximityViolation);
    t.true(conflict.conflicts.proximityConflict);
});

ava.serial('between 3 and 4 nm is a conflict but not a violation', (t) => {
    const conflict = conflictBetween(aircraft('A', 0, 0, 5000, 0), aircraft('B', 0, 3.5 * NM, 5000, 0));

    conflict.checkProximity();

    t.false(conflict.violations.proximityViolation);
    t.true(conflict.conflicts.proximityConflict);
});

ava.serial('more than 4 nm apart there is nothing to report', (t) => {
    const conflict = conflictBetween(aircraft('A', 0, 0, 5000, 0), aircraft('B', 0, 4.5 * NM, 5000, 0));

    conflict.checkProximity();

    t.false(conflict.hasAlerts());
});

ava.serial('opposite courses that have passed each other are not in conflict', (t) => {
    const first = aircraft('A', 0, 0, 5000, 0);
    const second = aircraft('B', 0.2, -NM, 5000, 180);
    const conflict = conflictBetween(first, second, 0.5);

    conflict.checkProximity();

    t.true(conflict.distance_delta > 0);
    t.false(conflict.hasAlerts());
});

ava.serial('opposite courses still closing are a violation', (t) => {
    const first = aircraft('A', 0, 0, 5000, 0);
    const second = aircraft('B', 0.2, NM, 5000, 180);
    const conflict = conflictBetween(first, second, 3);

    conflict.checkProximity();

    t.true(conflict.violations.proximityViolation);
});

ava.serial('crossing courses where one has passed the point of convergence are diverging', (t) => {
    // A heads north from the origin, B heads east from a point north-west of A, already past A's track
    const first = aircraft('A', 0, 0, 5000, 0);
    const second = aircraft('B', 0.5, NM, 5000, 90);
    const conflict = conflictBetween(first, second, 1);

    conflict.checkProximity();

    t.false(conflict.hasAlerts());
});

ava.serial('crossing courses converging ahead of both aircraft are a violation', (t) => {
    const first = aircraft('A', 0, 0, 5000, 0);
    const second = aircraft('B', -NM, NM, 5000, 90);
    const conflict = conflictBetween(first, second, 2);

    conflict.checkProximity();

    t.true(conflict.violations.proximityViolation);
});

ava.serial('aircraft on adjacent parallel finals use the runway minimum and raise no notice', (t) => {
    runwayRelationship = { parallel: true, separationMinimum: 0.5 * NM };
    const established = { isEstablishedOnCourse: () => true };
    const first = aircraft('A', 0, 0, 3000, 0, {
        ...established,
        fms: { currentLeg: { isSidLeg: false }, arrivalRunwayModel: { name: '32L' } }
    });
    const second = aircraft('B', NM, 0, 3000, 0, {
        ...established,
        fms: { currentLeg: { isSidLeg: false }, arrivalRunwayModel: { name: '32R' } }
    });
    const conflict = conflictBetween(first, second);

    conflict.checkProximity();

    t.false(conflict.hasAlerts());
});

ava.serial('a collision needs less than 0.05 km and 160 ft, both airborne and inside the airspace', (t) => {
    const first = aircraft('A', 0, 0, 5000, 0);
    const second = aircraft('B', 0.01, 0.01, 5100, 90);
    const conflict = conflictBetween(first, second);

    conflict.checkCollision();

    t.true(conflict.collided);
    t.true(first.hit && second.hit);
    t.true(GameController.events_recordNew.calledOnce);
});

ava.serial('no collision is recorded with an aircraft on the ground', (t) => {
    const first = aircraft('A', 0, 0, 0, 0, { isOnGround: () => true });
    const second = aircraft('B', 0.01, 0, 50, 90);
    const conflict = conflictBetween(first, second);

    conflict.checkCollision();

    t.false(conflict.collided);
    t.false(GameController.events_recordNew.called);
});

ava.serial('update() ignores aircraft below about 1000 ft above the airport', (t) => {
    const first = aircraft('A', 0, 0, 900, 0);
    const second = aircraft('B', 0, NM, 900, 0);
    const conflict = conflictBetween(first, second);

    sandbox.stub(conflict, 'shouldBeRemoved').returns(false);
    conflict.update();

    t.false(conflict.hasAlerts());
});

ava.serial('update() removes a conflict outside the 8 nm box', (t) => {
    const first = aircraft('A', 0, 0, 5000, 0);
    const second = aircraft('B', 0, 9 * NM, 5000, 0);
    const conflict = conflictBetween(first, second);
    const destroy = sandbox.stub(conflict, 'destroy');

    sandbox.stub(conflict, 'isDuplicate').returns(false);
    conflict.update();

    t.true(destroy.calledOnce);
});

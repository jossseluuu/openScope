import ava from 'ava';

import {
    applyAction,
    chooseResolution,
    detectConflicts,
    earliestPredictedConflict
} from '../../src/assets/scripts/client/bot/botA/conflictResolution';
import { ACTIONS, ACTION_TYPE } from '../../src/assets/scripts/client/bot/actionSpace';
import { getDefaultBotAParameters } from '../../src/assets/scripts/client/bot/botA/botAParameters';
import { createAircraft, createObservation } from './_observationFixture';

const level = (callsign, x, heading, altitude) => createAircraft({
    callsign,
    x,
    y: 0,
    heading,
    groundTrack: heading,
    altitude,
    clearance: {
        altitudeMode: 'HOLD', altitude, headingMode: 'HOLD', heading, speedMode: 'HOLD', speed: 220
    }
});

ava('earliestPredictedConflict() is null when nobody is in the way', (t) => {
    const aircraft = level('AAA1', 20, 270, 7000);
    const observation = createObservation([aircraft, level('BBB2', -40, 270, 7000)]);

    t.is(earliestPredictedConflict(aircraft, observation, getDefaultBotAParameters()), null);
});

ava('earliestPredictedConflict() returns the first conflict of any pair', (t) => {
    const aircraft = level('AAA1', 20, 270, 7000);
    const observation = createObservation([aircraft, level('BBB2', 8, 90, 7000), level('CCC3', 30, 270, 7000)]);
    const parameters = getDefaultBotAParameters();
    const time = earliestPredictedConflict(aircraft, observation, parameters);

    t.true(Number.isFinite(time));
    t.true(time < parameters.conflictHorizonSeconds);
});

ava('chooseResolution() does not solve a conflict by flying into a third aircraft', (t) => {
    const parameters = getDefaultBotAParameters();
    const above = level('CCC3', 14, 90, 8000);
    const a = level('AAA1', 20, 270, 7000);
    const b = level('BBB2', 8, 90, 7000);
    const observation = createObservation([a, b, above]);
    const conflict = detectConflicts(observation, parameters).find(({ a: first, b: second }) => first.altitude === second.altitude);
    const resolution = chooseResolution(conflict, () => 2000, parameters, observation);

    t.truthy(resolution);

    const mover = observation.aircraft.find(({ callsign }) => callsign === resolution.callsign);

    t.is(earliestPredictedConflict(applyAction(mover, resolution.action), observation, parameters, () => false, true), null);
});

ava('chooseResolution() always gives an order, even when nothing delays a loss that is already happening', (t) => {
    const parameters = getDefaultBotAParameters();
    const a = level('AAA1', 1, 270, 7000);
    const b = level('BBB2', -1, 90, 7000);
    const observation = createObservation([a, b]);
    const conflict = { a, b, time: parameters.conflictHorizonSeconds };

    t.truthy(chooseResolution(conflict, () => 2000, parameters, observation));
});

ava('chooseResolution() has one aircraft climb and the other descend when moving one is not enough', (t) => {
    const parameters = getDefaultBotAParameters();
    const a = level('AAA1', 3.5, 270, 7000);
    const b = level('BBB2', -3.5, 90, 7000);
    const observation = createObservation([a, b]);
    const [conflict] = detectConflicts(observation, parameters);
    const isVertical = (aircraft, action) => ACTIONS[action].type === ACTION_TYPE.ALTITUDE;
    const resolution = chooseResolution(conflict, () => 2000, parameters, observation, isVertical);

    t.truthy(resolution.partner);
    t.deepEqual(
        [ACTIONS[resolution.action].value, ACTIONS[resolution.partner.action].value].sort(),
        [6000, 8000]
    );
});

ava('chooseResolution() has one aircraft speed up and the other slow down when only that is possible', (t) => {
    const parameters = getDefaultBotAParameters();
    const leader = level('AAA1', 10, 270, 7000);
    const follower = { ...level('BBB2', 15, 270, 7000), groundSpeed: 240, speed: 240 };
    const observation = createObservation([leader, follower]);
    const conflict = { a: leader, b: follower, time: 60 };
    const isSpeed = (aircraft, action) => ACTIONS[action].type === ACTION_TYPE.SPEED;
    const resolution = chooseResolution(conflict, () => 2000, parameters, observation, isSpeed);

    t.is(resolution.kind, 'speed');
    t.is(ACTIONS[resolution.action].value, 240);
    t.is(ACTIONS[resolution.partner.action].value, 220);
});

ava('chooseResolution() turns both aircraft away from each other when only that is possible', (t) => {
    const parameters = getDefaultBotAParameters();
    const a = level('AAA1', 8, 270, 7000);
    const b = level('BBB2', -8, 90, 7000);
    const observation = createObservation([a, b]);
    const conflict = { a, b, time: 60 };
    const canTurn = (aircraft, action) => ACTIONS[action].type === ACTION_TYPE.HEADING &&
        Math.abs(ACTIONS[action].value) <= 20;
    const narrow = { ...parameters, resolutionTurnDegrees: 20 };
    const resolution = chooseResolution(conflict, () => 2000, narrow, observation, canTurn);

    t.truthy(resolution.partner);
    t.is(resolution.kind, 'lateral');
});

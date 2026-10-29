import ava from 'ava';

import {
    ACTIONS,
    ACTION_COUNT,
    ACTION_INDEX,
    actionToCommand,
    altitudeAction,
    getApplicableActions,
    headingAction,
    speedAction
} from '../../src/assets/scripts/client/bot/actionSpace';
import { createAircraft, createObservation } from './_observationFixture';

ava('every action has a unique index', (t) => {
    t.is(ACTION_COUNT, ACTIONS.length);
    ACTIONS.forEach((action, index) => t.is(action.index, index));
    t.is(ACTION_INDEX.NOOP, 0);
});

ava('headingAction() turns relative to the assigned heading', (t) => {
    const aircraft = createAircraft({ heading: 250, clearance: { headingMode: 'HOLD', heading: 270 } });
    const action = headingAction(aircraft, 300);

    t.is(ACTIONS[action].value, 30);
    t.is(actionToCommand(action, aircraft, createObservation([aircraft])), 'fh r 300');
    t.is(headingAction(aircraft, 271), ACTION_INDEX.NOOP);
});

ava('altitude and speed actions pick the closest value', (t) => {
    t.is(ACTIONS[altitudeAction(4900)].value, 5000);
    t.is(ACTIONS[speedAction(184)].value, 180);
    t.is(actionToCommand(altitudeAction(5000), createAircraft(), createObservation()), 'a 50');
});

ava('getApplicableActions() only allows NOOP for aircraft not under control', (t) => {
    const mask = getApplicableActions(createAircraft({ isControllable: false }), createObservation());
    const allowed = mask.map((isAllowed, index) => (isAllowed ? index : -1)).filter((index) => index >= 0);

    t.deepEqual(allowed, [ACTION_INDEX.NOOP]);
});

ava('getApplicableActions() offers taxi at the gate and takeoff at the holding point', (t) => {
    const atGate = createAircraft({ category: 'departure', isOnGround: true, flightPhase: 'APRON' });
    const holding = createAircraft({ category: 'departure', isOnGround: true, flightPhase: 'WAITING' });

    t.true(getApplicableActions(atGate, createObservation())[ACTION_INDEX.TAXI]);
    t.false(getApplicableActions(atGate, createObservation())[ACTION_INDEX.TAKEOFF]);
    t.true(getApplicableActions(holding, createObservation())[ACTION_INDEX.TAKEOFF]);
});

ava('getApplicableActions() limits speeds to the aircraft envelope and 250 kt below FL100', (t) => {
    const aircraft = createAircraft({ altitude: 5000, speedLimits: { min: 135, landing: 145, max: 350 } });
    const mask = getApplicableActions(aircraft, createObservation());

    t.false(mask[speedAction(300)]);
    t.true(mask[speedAction(250)]);
    // at least 10 kt above the minimum speed
    t.false(mask[speedAction(140)]);
    t.true(mask[speedAction(150)]);
});

ava('getApplicableActions() offers a go-around only to aircraft on approach', (t) => {
    t.false(getApplicableActions(createAircraft(), createObservation())[ACTION_INDEX.GO_AROUND]);
    t.true(getApplicableActions(createAircraft({ hasApproachClearance: true }), createObservation())[ACTION_INDEX.GO_AROUND]);
});

ava('actionToCommand() builds departure and approach commands', (t) => {
    const departure = createAircraft({ category: 'departure', departureRunway: '27' });

    t.is(actionToCommand(ACTION_INDEX.TAXI, departure, createObservation()), 'caf taxi 27 cvs');
    t.is(actionToCommand(ACTION_INDEX.ILS, createAircraft(), createObservation()), 'i 27');
    t.is(actionToCommand(ACTION_INDEX.NOOP, createAircraft(), createObservation()), null);
});

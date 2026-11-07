import ava from 'ava';

import BotA from '../../src/assets/scripts/client/bot/botA/BotA';
import {
    ACTION_INDEX,
    actionToCommand,
    altitudeAction,
    getApplicableActions
} from '../../src/assets/scripts/client/bot/actionSpace';
import { RunwayIndex, checkTakeoff } from '../../src/assets/scripts/client/bot/botRules';
import { chooseResolution, detectConflicts } from '../../src/assets/scripts/client/bot/botA/conflictResolution';
import { ARRIVAL_MODE } from '../../src/assets/scripts/client/bot/botA/arrivalPlanner';
import { getDefaultBotAParameters } from '../../src/assets/scripts/client/bot/botA/botAParameters';
import {
    FEATURE_COUNT, FEATURE_NAMES, encodeAircraft, orderAircraft
} from '../../src/assets/scripts/client/bot/rl/featureEncoder';
import { computeReward } from '../../src/assets/scripts/client/bot/rl/rewardFunction';
import { airspaceFloorAt, highestFloorAlongPath } from '../../src/assets/scripts/client/bot/botGeometry';
import { createAircraft, createObservation } from './_observationFixture';

const emergency = (overrides = {}) => ({
    type: 'MEDICAL',
    description: 'medical emergency on board',
    declaredAt: 0,
    deadline: 1500,
    remainingSeconds: 500,
    ...overrides
});

const createWaypoint = (name, x, y) => ({
    name, x, y, vectorHeading: null, altitudeMinimum: null, altitudeMaximum: null, speedMaximum: null
});

ava('aircraft in emergency may not be told to hold', (t) => {
    const waypoints = [createWaypoint('FIX', 30, 0)];
    const normal = createAircraft({ waypoints });
    const inEmergency = createAircraft({ waypoints, emergency: emergency() });

    t.true(getApplicableActions(normal, createObservation())[ACTION_INDEX.HOLD]);
    t.false(getApplicableActions(inEmergency, createObservation())[ACTION_INDEX.HOLD]);
});

ava('aircraft in emergency descend expeditiously', (t) => {
    const observation = createObservation();

    t.is(actionToCommand(altitudeAction(3000), createAircraft({ altitude: 8000 }), observation), 'a 30');
    t.is(actionToCommand(altitudeAction(3000), createAircraft({ altitude: 8000, emergency: emergency() }), observation), 'a 30 ex');
    // not when climbing
    t.is(actionToCommand(altitudeAction(9000), createAircraft({ altitude: 8000, emergency: emergency() }), observation), 'a 90');
});

ava('a conflict is solved by moving the aircraft that is not in emergency', (t) => {
    const parameters = getDefaultBotAParameters();
    const inEmergency = createAircraft({
        callsign: 'EMG1',
        x: 20,
        y: 0,
        heading: 270,
        groundTrack: 270,
        altitude: 7000,
        emergency: emergency(),
        clearance: {
            altitudeMode: 'HOLD', altitude: 7000, headingMode: 'HOLD', heading: 270, speedMode: 'HOLD', speed: 220
        }
    });
    const other = createAircraft({
        callsign: 'OTH1',
        x: 8,
        y: 0,
        heading: 90,
        groundTrack: 90,
        altitude: 7000,
        clearance: {
            altitudeMode: 'HOLD', altitude: 7000, headingMode: 'HOLD', heading: 90, speedMode: 'HOLD', speed: 220
        }
    });
    const observation = createObservation([inEmergency, other]);
    const [conflict] = detectConflicts(observation, parameters);

    t.truthy(conflict);
    t.is(chooseResolution(conflict, () => 2000, parameters, observation).callsign, 'OTH1');
});

ava('Bot A sequences an aircraft in emergency ahead of everyone not yet committed to the localizer', (t) => {
    const bot = new BotA();
    const plan = (callsign, etaMinimum, mode, isEmergency = false) => ({
        id: callsign,
        mode,
        etaMinimum,
        aircraft: createAircraft({ callsign, emergency: isEmergency ? emergency() : null })
    });
    const onFinal = plan('FIN1', 100, ARRIVAL_MODE.FINAL);
    const vectored = plan('VEC1', 200, ARRIVAL_MODE.VECTOR);
    const onRoute = plan('RTE1', 300, ARRIVAL_MODE.ROUTE);
    const inEmergency = plan('EMG1', 400, ARRIVAL_MODE.ROUTE, true);
    const order = bot._prioritizeEmergencies([onFinal, vectored, onRoute, inEmergency]);

    t.deepEqual(order.map((item) => item.id), ['FIN1', 'EMG1', 'VEC1', 'RTE1']);
});

ava('Bot A keeps the runway free of departures before an emergency landing', (t) => {
    const bot = new BotA();
    const observation = createObservation();
    const context = { runwayIndex: new RunwayIndex(observation.airport), time: 1000 };

    bot._sequences = { 27: [{ callsign: 'EMG1', sta: 1200, isEmergency: true }] };
    t.true(bot._arrivalNeedsRunwaySoon('27/09', context));

    bot._sequences = { 27: [{ callsign: 'ARR1', sta: 1200, isEmergency: false }] };
    t.false(bot._arrivalNeedsRunwaySoon('27/09', context));
});

ava('departures from the same runway need 45 degrees of divergence for the one-minute interval', (t) => {
    const departure = (callsign, fix) => createAircraft({
        callsign,
        category: 'departure',
        flightPhase: 'WAITING',
        isOnGround: true,
        departureRunway: '27',
        arrivalRunway: null,
        route: `TEST27.SID.${fix.name}`,
        waypoints: [fix]
    });
    // runway 27 points west: 20 degrees and 60 degrees right of the runway heading
    const slightTurn = createWaypoint('SLIGHT', -20 * Math.cos(20 * Math.PI / 180), 20 * Math.sin(20 * Math.PI / 180));
    const wideTurn = createWaypoint('WIDE', -20 * Math.cos(60 * Math.PI / 180), 20 * Math.sin(60 * Math.PI / 180));
    const straight = createWaypoint('STRAIGHT', -20, 0);
    const leader = departure('LEAD1', straight);
    const check = (follower) => {
        const observation = createObservation([leader, follower], {
            lastTakeoffs: [{ runway: '27/09', callsign: 'LEAD1', secondsAgo: 70 }]
        });

        return checkTakeoff(follower, observation, new RunwayIndex(observation.airport)).ok;
    };

    t.false(check(departure('DEP1', slightTurn)));
    t.true(check(departure('DEP2', wideTurn)));
});

ava('Bot B sees the emergency features, and aircraft in emergency come first', (t) => {
    const observation = createObservation([
        createAircraft({ callsign: 'NEAR1', distance: 5 }),
        createAircraft({ callsign: 'EMG1', distance: 40, emergency: emergency({ remainingSeconds: 900 }) })
    ]);
    const runwayIndex = new RunwayIndex(observation.airport);
    const features = encodeAircraft(observation.aircraft[1], observation, runwayIndex);

    t.is(FEATURE_COUNT, FEATURE_NAMES.length);
    t.is(features.length, FEATURE_COUNT);
    t.is(features[FEATURE_NAMES.indexOf('emergency')], 1);
    t.is(features[FEATURE_NAMES.indexOf('emergency_remaining')], 0.5);
    t.is(orderAircraft(observation)[0].callsign, 'EMG1');
});

ava('Bot B is rewarded for landing an emergency and penalized for missing the deadline', (t) => {
    const base = { controllableCount: 0, elapsedSeconds: 10, commandCount: 0 };
    const landed = computeReward({ ...base, violations: [], scoreEvents: [{ event: 'EMERGENCY_LANDING' }] });
    const missed = computeReward({
        ...base, violations: [{ rule: 'EMERGENCY_DEADLINE', tier: 1 }], scoreEvents: []
    });
    const waiting = computeReward({
        ...base, emergencyCount: 1, violations: [], scoreEvents: []
    });

    t.true(landed.components.emergencyLanding > 0);
    t.true(missed.components.emergencyMissed < 0);
    // counted once, not also as a separation violation
    t.is(missed.components.tier1, 0);
    t.true(waiting.reward < 0);
});

ava('the airspace floor is followed along a planned path', (t) => {
    const airspace = [
        { floor: 0, ceiling: 24000, polygon: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] },
        { floor: 5500, ceiling: 24000, polygon: [{ x: 10, y: -10 }, { x: 40, y: -10 }, { x: 40, y: 10 }, { x: 10, y: 10 }] }
    ];

    t.is(airspaceFloorAt({ x: 0, y: 0 }, airspace), 0);
    t.is(airspaceFloorAt({ x: 20, y: 0 }, airspace), 5500);
    t.is(airspaceFloorAt({ x: 60, y: 0 }, airspace), null);
    // from the low sector out into the high one and back
    t.is(highestFloorAlongPath([{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 0, y: 5 }], airspace), 5500);
    t.is(highestFloorAlongPath([{ x: 0, y: 0 }, { x: 5, y: 0 }], airspace), 0);
});

import ava from 'ava';

import BotC from '../../src/assets/scripts/client/bot/botC/BotC';
import SupervisionSystem, { INCIDENT_CATEGORY } from '../../src/assets/scripts/client/bot/botC/supervision/SupervisionSystem';
import { VERDICT, auditInstruction } from '../../src/assets/scripts/client/bot/botC/supervision/supervisors';
import { predictPairLoss } from '../../src/assets/scripts/client/bot/botC/supervision/independentPrediction';
import {
    AGENT, TOWER_CEILING_AGL_FT, hasAuthority, ownerOf
} from '../../src/assets/scripts/client/bot/botC/agents';
import { ACTION_INDEX, altitudeAction, getApplicableActions } from '../../src/assets/scripts/client/bot/actionSpace';
import { createAircraft, createObservation } from './_observationFixture';

const clearance = (altitude, heading = 270) => ({
    altitudeMode: 'HOLD', altitude, headingMode: 'HOLD', heading, speedMode: 'HOLD', speed: 220
});
const level = (callsign, x, heading, altitude) => createAircraft({
    callsign, x, y: 0, heading, groundTrack: heading, altitude, clearance: clearance(altitude, heading)
});

ava('every aircraft has one responsible agent, and Tower reaches 3000 ft above the airport', (t) => {
    const observation = createObservation();
    const departure = (altitude, isOnGround = false) => createAircraft({ category: 'departure', altitude, isOnGround });
    const final = (altitude) => createAircraft({
        flightPhase: 'APPROACH', hasApproachClearance: true, altitude
    });

    t.is(ownerOf(departure(0, true), observation), AGENT.TOWER);
    t.is(ownerOf(departure(TOWER_CEILING_AGL_FT - 1), observation), AGENT.TOWER);
    t.is(ownerOf(departure(TOWER_CEILING_AGL_FT + 1), observation), AGENT.DEPARTURES);
    t.is(ownerOf(final(TOWER_CEILING_AGL_FT - 1), observation), AGENT.TOWER);
    t.is(ownerOf(final(TOWER_CEILING_AGL_FT + 1), observation), AGENT.ILS);
    t.is(ownerOf(createAircraft({ category: 'overflight' }), observation), AGENT.DEPARTURES);
});

ava('an agent only has authority over its own kind of action', (t) => {
    t.true(hasAuthority(AGENT.TOWER, ACTION_INDEX.CANCEL_TAKEOFF));
    t.false(hasAuthority(AGENT.ARRIVALS, ACTION_INDEX.TAKEOFF));
    t.false(hasAuthority(AGENT.SEPARATION, ACTION_INDEX.GO_AROUND));
    t.true(hasAuthority(AGENT.COORDINATOR, ACTION_INDEX.PARALLEL_RUNWAY));
    t.false(hasAuthority(AGENT.COORDINATOR, ACTION_INDEX.HEADING));
});

ava('a takeoff can be cancelled at the holding point and on the roll, but not past V1', (t) => {
    const observation = createObservation();
    const roll = (speed) => createAircraft({
        category: 'departure', flightPhase: 'TAKEOFF', isOnGround: true, speed, takeoffDecisionSpeed: 110
    });
    const waiting = createAircraft({ category: 'departure', flightPhase: 'WAITING', isOnGround: true });

    t.true(getApplicableActions(waiting, observation)[ACTION_INDEX.CANCEL_TAKEOFF]);
    t.true(getApplicableActions(roll(100), observation)[ACTION_INDEX.CANCEL_TAKEOFF]);
    t.false(getApplicableActions(roll(120), observation)[ACTION_INDEX.CANCEL_TAKEOFF]);
});

ava('a departure may not be cleared again before it is ready after a cancelled takeoff', (t) => {
    const observation = { ...createObservation(), time: 100 };
    const waiting = createAircraft({
        category: 'departure', flightPhase: 'WAITING', isOnGround: true, takeoffNotBefore: 150
    });

    t.false(getApplicableActions(waiting, observation)[ACTION_INDEX.TAKEOFF]);
    t.true(getApplicableActions({ ...waiting, takeoffNotBefore: 50 }, observation)[ACTION_INDEX.TAKEOFF]);
});

ava('only the next departure may line up, and it may then take off', (t) => {
    const observation = createObservation();
    const waiting = (isNextForTakeoff) => createAircraft({
        category: 'departure', flightPhase: 'WAITING', isOnGround: true, isNextForTakeoff
    });
    const linedUp = createAircraft({ category: 'departure', flightPhase: 'LINE_UP', isOnGround: true });

    t.true(getApplicableActions(waiting(true), observation)[ACTION_INDEX.LINE_UP]);
    t.false(getApplicableActions(waiting(false), observation)[ACTION_INDEX.LINE_UP]);
    t.true(getApplicableActions(linedUp, observation)[ACTION_INDEX.TAKEOFF]);
    t.true(getApplicableActions(linedUp, observation)[ACTION_INDEX.CANCEL_TAKEOFF]);
    t.false(getApplicableActions(linedUp, observation)[ACTION_INDEX.LINE_UP]);
});

ava('the shield does not let a departure enter an occupied runway', (t) => {
    const departure = createAircraft({
        callsign: 'DEP1', category: 'departure', flightPhase: 'WAITING', isOnGround: true, isNextForTakeoff: true, departureRunway: '27'
    });
    const observation = createObservation([departure]);
    const bot = new BotC();

    t.true(bot.shield.getActionMask(departure, observation)[ACTION_INDEX.LINE_UP]);

    observation.realism.runwayOccupancy = [{
        runway: '27/09', occupants: [{ callsign: 'OTH1', kind: 'arrival', remainingSeconds: 20 }]
    }];

    t.false(bot.shield.getActionMask(departure, observation)[ACTION_INDEX.LINE_UP]);
});

ava('Tower takes a lined up departure off the runway when an arrival comes close', (t) => {
    const departure = createAircraft({
        callsign: 'DEP1', category: 'departure', flightPhase: 'LINE_UP', isOnGround: true, departureRunway: '27'
    });
    const arrival = createAircraft({
        callsign: 'ARR1', flightPhase: 'APPROACH', hasApproachClearance: true, x: 2.5, y: 0, altitude: 800, groundSpeed: 140
    });
    const decision = new BotC().decide(createObservation([departure, arrival])).find(({ callsign }) => callsign === 'DEP1');

    t.is(decision.command, 'abort');
});

ava('Tower rejects a takeoff when the runway is occupied', (t) => {
    const roll = createAircraft({
        callsign: 'DEP1', category: 'departure', flightPhase: 'TAKEOFF', isOnGround: true, isControllable: true, speed: 60, takeoffDecisionSpeed: 110, departureRunway: '27'
    });
    const observation = createObservation([roll]);

    observation.realism.runwayOccupancy = [{
        runway: '27/09',
        occupants: [{ callsign: 'DEP1', kind: 'departure', remainingSeconds: null }, { callsign: 'OTH1', kind: 'arrival', remainingSeconds: 20 }]
    }];

    const decision = new BotC().decide(observation).find(({ callsign }) => callsign === 'DEP1');

    t.is(decision.agent, AGENT.TOWER);
    t.is(decision.command, 'abort');
});

ava('the supervisor calls bad an instruction that flies into other traffic, and says why', (t) => {
    const mover = level('AAA1', 20, 270, 7000);
    const other = level('BBB2', 12, 90, 8000);
    const observation = createObservation([mover, other]);
    const { verdict, findings } = auditInstruction(
        { callsign: 'AAA1', action: altitudeAction(8000), agent: AGENT.SEPARATION }, mover, observation
    );

    t.is(verdict, VERDICT.BAD);
    t.true(findings[0].text.includes('BBB2'));
});

ava('the supervisor calls good an instruction that solves a conflict', (t) => {
    const mover = level('AAA1', 20, 270, 7000);
    const other = level('BBB2', 12, 90, 7000);
    const observation = createObservation([mover, other]);
    const { verdict, findings } = auditInstruction(
        { callsign: 'AAA1', action: altitudeAction(8000), agent: AGENT.SEPARATION }, mover, observation
    );

    t.is(verdict, VERDICT.GOOD);
    t.true(findings[0].text.includes('resuelve'));
});

ava('the supervisor marks instructions going back and forth as a loop', (t) => {
    const supervision = new SupervisionSystem();
    const aircraft = level('AAA1', 20, 270, 7000);
    const observation = createObservation([aircraft]);
    const give = (altitude, time) => supervision.audit([{
        callsign: 'AAA1', action: altitudeAction(altitude), command: 'a', reason: '', agent: AGENT.SEPARATION
    }], { ...observation, time });

    [15000, 14000, 15000, 14000].forEach((altitude, i) => give(altitude, i * 20));

    t.is(supervision.entries[3].verdict, VERDICT.BAD);
    t.true(supervision.entries[3].findings.some(({ text }) => text.includes('bucle')));
});

ava('a judged cancellation completes the audit of the order', (t) => {
    const supervision = new SupervisionSystem();
    const departure = createAircraft({ callsign: 'DEP1', category: 'departure', flightPhase: 'WAITING', isOnGround: true });
    const observation = createObservation([departure]);

    supervision.audit([{
        callsign: 'DEP1', action: ACTION_INDEX.CANCEL_TAKEOFF, command: 'abort', reason: '', agent: AGENT.TOWER
    }], observation);
    t.is(supervision.entries[0].verdict, VERDICT.PENDING);

    observation.realism.takeoffCancellations = [{
        callsign: 'DEP1', isJustified: false, reason: 'runway free', occupiedSeconds: 0
    }];
    supervision.audit([], observation);

    t.is(supervision.entries[0].verdict, VERDICT.BAD);
    t.true(supervision.entries[0].findings[0].text.includes('penalizada'));
});

const conflictingPair = () => [level('AAA1', 20, 270, 7000), level('BBB2', 12, 90, 7000)];
const lossOf = (time, callsigns = ['AAA1', 'BBB2']) => ({
    time, rule: 'RADAR_SEPARATION', tier: 1, callsigns, details: '2 nm', reference: 'x'
});

ava('an alert nobody reacted to is negligence', (t) => {
    const supervision = new SupervisionSystem();
    const observation = createObservation(conflictingPair());

    supervision.audit([], { ...observation, time: 0 });
    supervision.audit([], { ...observation, time: 40, violations: [lossOf(40)] });

    t.is(supervision.incidents[0].category, INCIDENT_CATEGORY.NEGLIGENCE);
});

ava('an alert with orders that did not help is an insufficient response', (t) => {
    const supervision = new SupervisionSystem();
    const observation = createObservation(conflictingPair());

    supervision.audit([], { ...observation, time: 0 });
    supervision.audit([{
        callsign: 'AAA1', action: ACTION_INDEX.SPEED, command: 'sp 200', reason: '', agent: AGENT.SEPARATION
    }], { ...observation, time: 10 });
    supervision.audit([], { ...observation, time: 40, violations: [lossOf(40)] });

    t.is(supervision.incidents[0].category, INCIDENT_CATEGORY.INSUFFICIENT);
    t.truthy(supervision.entries[0].consequence);
});

ava('a loss the risk monitor did not see is a failure of the supervision', (t) => {
    const supervision = new SupervisionSystem();
    const observation = createObservation([level('AAA1', 40, 270, 7000), level('BBB2', -40, 270, 7000)]);

    supervision.audit([], { ...observation, time: 10, violations: [lossOf(10)] });

    t.is(supervision.incidents[0].category, INCIDENT_CATEGORY.SUPERVISION);
});

ava('the supervisors change nothing of what the agents decide', (t) => {
    const observation = createObservation([level('AAA1', 20, 270, 7000), level('BBB2', 12, 90, 7000)]);
    const bot = new BotC();
    const decisions = bot.decide(observation);
    const before = JSON.stringify(decisions);

    t.true(decisions.length > 0);
    bot.supervision.audit(bot.lastPlan.decisions.map((decision) => ({ ...decision })), observation);
    t.is(JSON.stringify(decisions), before);
    t.false(bot.supervision.entries[0] === decisions[0]);
});

ava('the independent prediction sees a head-on loss and not a level difference', (t) => {
    const minima = { radarNm: 3, verticalFt: 1000 };

    t.truthy(predictPairLoss(level('A', 8, 270, 7000), level('B', -8, 90, 7000), minima, 120));
    t.is(predictPairLoss(level('A', 8, 270, 7000), level('B', -8, 90, 8000), minima, 120), null);
});

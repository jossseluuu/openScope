import ava from 'ava';
import sinon from 'sinon';

import GameController, { GAME_EVENTS } from '../../src/assets/scripts/client/game/GameController';
import Rulebook, { RULE, RULE_TIER } from '../../src/assets/scripts/client/realism/Rulebook';
import UiController from '../../src/assets/scripts/client/ui/UiController';

let sandbox;

ava.serial.beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(GameController, 'events_recordNew');
    sandbox.stub(UiController, 'ui_log');
});

ava.serial.afterEach.always(() => {
    sandbox.restore();
});

ava.serial('rules are ordered by tier, safety first', (t) => {
    t.is(RULE.RUNWAY_INCURSION.tier, RULE_TIER.SAFETY);
    t.is(RULE.RADAR_SEPARATION.tier, RULE_TIER.SEPARATION);
    t.is(RULE.GO_AROUND.tier, RULE_TIER.EFFICIENCY);
    t.true(RULE_TIER.SAFETY < RULE_TIER.SEPARATION && RULE_TIER.SEPARATION < RULE_TIER.PROCEDURE);
});

ava.serial('.record() counts the violation, scores it and keeps it until drained', (t) => {
    const rulebook = new Rulebook();

    rulebook.record(RULE.RADAR_SEPARATION, ['AAL1', 'UAL2'], 'too close');

    t.is(rulebook.counts.RADAR_SEPARATION, 1);
    t.true(GameController.events_recordNew.calledWithExactly(
        GAME_EVENTS.SEPARATION_LOSS,
        { callsigns: ['AAL1', 'UAL2'], details: 'too close' }
    ));

    const violations = rulebook.drainViolations();

    t.is(violations.length, 1);
    t.is(violations[0].rule, 'RADAR_SEPARATION');
    t.deepEqual(violations[0].callsigns, ['AAL1', 'UAL2']);
    t.is(rulebook.drainViolations().length, 0);
});

ava.serial('.record() uses the scored event passed instead of the rule one, or none', (t) => {
    const rulebook = new Rulebook();

    rulebook.record(RULE.RUNWAY_WIND_LIMIT, ['AAL1'], 'crosswind', GAME_EVENTS.HIGH_CROSSWIND_OPERATION);
    rulebook.record(RULE.RUNWAY_WIND_LIMIT, ['AAL1'], 'crosswind', null);

    t.true(GameController.events_recordNew.calledOnceWithExactly(
        GAME_EVENTS.HIGH_CROSSWIND_OPERATION,
        { callsigns: ['AAL1'], details: 'crosswind' }
    ));
    t.is(rulebook.counts.RUNWAY_WIND_LIMIT, 2);
});

ava.serial('.record() only logs violations up to the procedure tier', (t) => {
    const rulebook = new Rulebook();

    rulebook.record(RULE.GO_AROUND, ['AAL1'], 'missed approach');
    t.false(UiController.ui_log.called);

    rulebook.record(RULE.RUNWAY_INCURSION, ['AAL1', 'UAL2'], 'occupied');
    t.true(UiController.ui_log.calledOnce);
});

ava.serial('.reset() clears counts and pending violations', (t) => {
    const rulebook = new Rulebook();

    rulebook.record(RULE.GO_AROUND, ['AAL1'], 'missed approach');
    rulebook.reset();

    t.is(rulebook.counts.GO_AROUND, 0);
    t.is(rulebook.drainViolations().length, 0);
});

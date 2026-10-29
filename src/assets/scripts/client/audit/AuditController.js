import BotA from '../bot/botA/BotA';
import BotApi from '../bot/BotApi';
import EventBus from '../lib/EventBus';
import SafetyShield from '../bot/safetyShield';
import TimeKeeper from '../engine/TimeKeeper';
import { ACTIONS, ACTION_COUNT, ACTION_INDEX } from '../bot/actionSpace';
import { FEATURE_COUNT, encodeObservation, getEncodingSpec } from '../bot/rl/featureEncoder';
import { RULE_TIER } from '../realism/Rulebook';
import { AUDIT_EVENT, EVENT } from '../constants/eventNames';
import { OUTCOME } from './auditConstants';

export { OUTCOME };

/**
 * Seconds of game time between two samples when no bot is deciding
 *
 * @property SAMPLE_SECONDS
 * @type {number}
 * @final
 */
const SAMPLE_SECONDS = 5;

/**
 * The consequences of a clearance are what happens to the aircraft in this time after it
 *
 * @property OUTCOME_HORIZON_SECONDS
 * @type {number}
 * @final
 */
const OUTCOME_HORIZON_SECONDS = 180;

/**
 * Most recent entries kept in memory (older ones are dropped)
 *
 * @property LIMITS
 * @type {object}
 * @final
 */
const LIMITS = {
    DECISIONS: 3000,
    STEPS: 2000,
    LEDGER: 3000,
    SPAWNS: 1000
};

/**
 * Most recent entries of each list sent to the bot audit page
 *
 * @property SNAPSHOT_ROWS
 * @type {number}
 * @final
 */
const SNAPSHOT_ROWS = 300;


const round = (value, digits = 0) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

/**
 * State of an aircraft worth keeping before and after a clearance
 *
 * @function snapshot
 * @param aircraft {object} an aircraft of the `BotApi` observation
 * @return {object}
 */
function snapshot(aircraft) {
    return {
        altitude: round(aircraft.altitude),
        clearedAltitude: aircraft.clearance.altitude,
        speed: round(aircraft.speed),
        heading: round(aircraft.heading),
        distance: round(aircraft.distance, 1),
        nextFix: aircraft.nextWaypoint,
        phase: aircraft.flightPhase
    };
}

/**
 * Audit of everything that happens in a game, for the audit panel and to train Bot B.
 *
 * It records:
 * - every clearance (player or bot) and, `OUTCOME_HORIZON_SECONDS` later, its consequences:
 *   rules broken by that aircraft, whether it was lost, landed or departed;
 * - every change of the score, with the aircraft and the reason;
 * - every spawn, and every spawn postponed by the safety check;
 * - training steps: the observation encoded as Bot B sees it, with Bot A's action for each
 *   aircraft as label. When Bot A is in control its real decisions are used; otherwise a
 *   shadow Bot A decides on the same situation without acting, so every game (played by
 *   the player, Bot A or Bot B) produces training data for Bot B.
 *
 * The audit can be exported as JSON lines (`exportJsonLines()`) and imported by
 * `openscope_bots.audit_data` in Python.
 *
 * @class AuditController
 */
export default class AuditController {
    /**
     * @constructor
     * @param aircraftController {AircraftController}
     * @param botController {BotController}
     */
    constructor(aircraftController, botController) {
        this._botApi = new BotApi(aircraftController);
        this._botController = botController;
        this._shield = new SafetyShield();
        this._shadowBot = new BotA();
        this._handlers = {
            [AUDIT_EVENT.COMMAND_ISSUED]: (event) => this._onCommand(event),
            [AUDIT_EVENT.RULE_VIOLATION]: (violation) => this._onViolation(violation),
            [AUDIT_EVENT.SCORE_EVENT]: (event) => this._onScore(event),
            [AUDIT_EVENT.SPAWNED]: (event) => this._onSpawn(event, true),
            [AUDIT_EVENT.SPAWN_DELAYED]: (event) => this._onSpawn(event, false),
            [AUDIT_EVENT.BOT_STEP]: (event) => this._onBotStep(event),
            [EVENT.AIRPORT_CHANGE]: () => this.reset()
        };

        Object.keys(this._handlers).forEach((name) => EventBus.on(name, this._handlers[name]));
        this.reset();
    }

    /**
     * Forget everything, e.g. when the airport changes
     *
     * @for AuditController
     * @method reset
     */
    reset() {
        this.decisions = [];
        this.ledger = [];
        this.spawns = [];
        this.steps = [];
        this.violations = [];
        this.aircraft = [];
        this.lifecycle = {};
        this.observation = null;
        this._nextSampleTime = 0;
        this._nextId = 0;
        this._shadowBot = new BotA();
    }

    /**
     * Part of the game loop
     *
     * @for AuditController
     * @method update
     */
    update() {
        const time = TimeKeeper.accumulatedDeltaTime;

        if (time < this._nextSampleTime) {
            return;
        }

        this._nextSampleTime = time + SAMPLE_SECONDS;

        const observation = this._botApi.getObservation();

        this._observe(observation);

        // a bot in control records its own steps (see `_onBotStep`)
        if (!this._botController || !this._botController.activeBot) {
            this._recordStep(observation, 'player', null);
        }
    }

    /**
     * Totals for the summary of the panel
     *
     * @for AuditController
     * @method getSummary
     * @return {object}
     */
    getSummary() {
        const outcomes = {};
        const pointsByEvent = {};

        this.decisions.forEach((decision) => {
            outcomes[decision.outcome.status] = (outcomes[decision.outcome.status] || 0) + 1;
        });
        this.ledger.forEach((entry) => {
            pointsByEvent[entry.event] = (pointsByEvent[entry.event] || 0) + entry.points;
        });

        return {
            time: this.observation ? this.observation.time : 0,
            score: this.observation ? this.observation.score : 0,
            pointsByEvent,
            outcomes,
            decisions: this.decisions.length,
            trainingSteps: this.steps.length,
            spawns: this.spawns.filter((spawn) => spawn.created).length,
            delayedSpawns: this.spawns.filter((spawn) => !spawn.created).length,
            metrics: this.observation ? this.observation.realism.metrics : null,
            violationCounts: this.observation ? this.observation.realism.violationCounts : {}
        };
    }

    /**
     * What the bot audit page shows: the last observation, the most recent entries of every
     * list and the summary. Plain data, so it can be posted to another tab.
     *
     * @for AuditController
     * @method getSnapshot
     * @return {object}
     */
    getSnapshot() {
        return {
            observation: this.observation,
            decisions: this.decisions.slice(-SNAPSHOT_ROWS),
            ledger: this.ledger.slice(-SNAPSHOT_ROWS),
            spawns: this.spawns.slice(-SNAPSHOT_ROWS),
            violations: this.violations.slice(-SNAPSHOT_ROWS),
            summary: this.getSummary(),
            activeBot: this._botController ? this._botController.activeBot : null
        };
    }

    /**
     * Everything recorded, as JSON lines: a header, then one line per clearance, score change,
     * spawn and training step. Training steps carry, for each aircraft, its features, allowed
     * actions, Bot A's action and what happened to it in the following `OUTCOME_HORIZON_SECONDS`.
     *
     * @for AuditController
     * @method exportJsonLines
     * @return {string}
     */
    exportJsonLines() {
        const spec = getEncodingSpec();
        const lines = [{
            type: 'header',
            airport: this.observation ? this.observation.airport.icao : null,
            gameTime: this.observation ? this.observation.time : 0,
            outcomeHorizonSeconds: OUTCOME_HORIZON_SECONDS,
            ...spec,
            // same names as the simulator's `rlSpec`
            actionNames: ACTIONS.map((action) => (action.value === undefined ? action.type : `${action.type}_${action.value}`))
        }];

        this.decisions.forEach((decision) => lines.push({ type: 'decision', ...decision }));
        this.ledger.forEach((entry) => lines.push({ type: 'score', ...entry }));
        this.spawns.forEach((spawn) => lines.push({ type: 'spawn', ...spawn }));
        this.steps.forEach((step) => {
            lines.push({
                type: 'step',
                time: step.time,
                source: step.source,
                global: step.global,
                aircraft: step.callsigns.map((callsign, slot) => ({
                    callsign,
                    features: Array.from(step.features.subarray(slot * FEATURE_COUNT, (slot + 1) * FEATURE_COUNT))
                        .map((value) => round(value, 4)),
                    allowed: Array.from(step.actionMask.subarray(slot * ACTION_COUNT, (slot + 1) * ACTION_COUNT)).join(''),
                    label: step.labels[slot],
                    outcome: this._outcomeFor(callsign, step.time).status
                }))
            });
        });

        return lines.map((line) => JSON.stringify(line)).join('\n');
    }

    /**
     * @for AuditController
     * @method _observe
     * @param observation {object}
     * @private
     */
    _observe(observation) {
        const seen = {};

        this.observation = observation;
        this.aircraft = observation.aircraft;

        observation.aircraft.forEach((aircraft) => {
            seen[aircraft.callsign] = true;

            if (!this.lifecycle[aircraft.callsign]) {
                this.lifecycle[aircraft.callsign] = {
                    category: aircraft.category,
                    firstSeen: observation.time,
                    status: 'active',
                    endTime: null
                };
            }

            this.lifecycle[aircraft.callsign].last = aircraft;
        });

        // aircraft gone since the last sample: landed, departed or lost (unless the score said it already)
        Object.keys(this.lifecycle).forEach((callsign) => {
            const entry = this.lifecycle[callsign];

            if (seen[callsign] || entry.status !== 'active') {
                return;
            }

            const last = entry.last || {};
            let status = 'gone';

            if (entry.category === 'arrival') {
                status = last.isOnGround || last.flightPhase === 'LANDING' ? OUTCOME.LANDED : OUTCOME.LOST;
            } else if (entry.category === 'departure') {
                status = OUTCOME.DEPARTED;
            }

            this._endLifecycle(callsign, status, observation.time);
        });

        this._settleDecisions(observation);
    }

    _endLifecycle(callsign, status, time) {
        const entry = this.lifecycle[callsign];

        if (entry && entry.status === 'active') {
            entry.status = status;
            entry.endTime = time;
        }
    }

    /**
     * Fill in the consequences of the clearances whose horizon has passed (or whose aircraft is gone)
     *
     * @for AuditController
     * @method _settleDecisions
     * @param observation {object}
     * @private
     */
    _settleDecisions(observation) {
        const byCallsign = {};

        observation.aircraft.forEach((aircraft) => {
            byCallsign[aircraft.callsign] = aircraft;
        });

        this.decisions.forEach((decision) => {
            if (decision.outcome.status !== OUTCOME.PENDING) {
                return;
            }

            const lifecycle = this.lifecycle[decision.callsign];
            const isGone = lifecycle && lifecycle.status !== 'active';

            if (!isGone && observation.time < decision.time + OUTCOME_HORIZON_SECONDS) {
                return;
            }

            const outcome = this._outcomeFor(decision.callsign, decision.time);
            const aircraft = byCallsign[decision.callsign];

            decision.outcome = { ...outcome, after: aircraft ? snapshot(aircraft) : null };
        });
    }

    /**
     * What happened to an aircraft in the `OUTCOME_HORIZON_SECONDS` after `time`
     *
     * @for AuditController
     * @method _outcomeFor
     * @param callsign {string}
     * @param time {number}
     * @return {object} `{ status, violations }`
     * @private
     */
    _outcomeFor(callsign, time) {
        const end = time + OUTCOME_HORIZON_SECONDS;
        const violations = this.violations.filter((violation) => violation.time >= time && violation.time <= end &&
            violation.callsigns.indexOf(callsign) !== -1);
        const lifecycle = this.lifecycle[callsign];
        const ended = lifecycle && lifecycle.endTime !== null && lifecycle.endTime <= end ? lifecycle.status : null;
        const worstTier = violations.reduce((worst, violation) => Math.min(worst, violation.tier), Infinity);
        let status = OUTCOME.OK;

        if (ended === OUTCOME.LOST) {
            status = OUTCOME.LOST;
        } else if (worstTier === RULE_TIER.SAFETY) {
            status = OUTCOME.SAFETY;
        } else if (worstTier === RULE_TIER.SEPARATION) {
            status = OUTCOME.SEPARATION;
        } else if (worstTier === RULE_TIER.PROCEDURE) {
            status = OUTCOME.PROCEDURE;
        } else if (ended === OUTCOME.LANDED || ended === OUTCOME.DEPARTED) {
            status = ended;
        }

        return {
            status,
            violations: violations.map((violation) => `${violation.rule}: ${violation.details}`)
        };
    }

    /**
     * Encode the situation as Bot B sees it, with Bot A's action for every aircraft as label
     *
     * @for AuditController
     * @method _recordStep
     * @param observation {object}
     * @param source {string} who is in control: `player`, `bot A` or `bot B`
     * @param botADecisions {array<object>|null} the real decisions, when Bot A is in control
     * @private
     */
    _recordStep(observation, source, botADecisions) {
        const encoded = encodeObservation(observation, this._shield);
        const count = encoded.tokenMask.reduce((sum, value) => sum + value, 0);

        if (count === 0) {
            return;
        }

        const decisions = botADecisions || this._shadowBot.decide(observation);
        const actionByCallsign = {};

        decisions.forEach((decision) => {
            actionByCallsign[decision.callsign] = decision.action;
        });

        const callsigns = encoded.callsigns.slice(0, count);

        this.steps.push({
            time: observation.time,
            source,
            callsigns,
            global: encoded.global.map((value) => round(value, 4)),
            features: Float32Array.from(encoded.tokens.slice(0, count * FEATURE_COUNT)),
            actionMask: Uint8Array.from(encoded.actionMask.slice(0, count * ACTION_COUNT)),
            labels: Int16Array.from(callsigns.map((callsign) => {
                const action = actionByCallsign[callsign];

                return Number.isInteger(action) ? action : ACTION_INDEX.NOOP;
            }))
        });
        this._trim(this.steps, LIMITS.STEPS);
    }

    _onBotStep({ name, observation, decisions }) {
        this._observe(observation);
        this._recordStep(observation, `bot ${name}`, name === 'A' ? decisions : null);
    }

    _onCommand(event) {
        const aircraft = (this.observation ? this.observation.aircraft : []).find((item) => item.callsign === event.callsign);

        this._nextId += 1;
        this.decisions.push({
            id: this._nextId,
            time: TimeKeeper.accumulatedDeltaTime,
            source: event.source,
            callsign: event.callsign,
            command: event.command,
            reason: event.reason,
            accepted: event.accepted,
            message: event.message,
            before: aircraft ? snapshot(aircraft) : null,
            outcome: { status: OUTCOME.PENDING, violations: [] }
        });
        this._trim(this.decisions, LIMITS.DECISIONS);
    }

    _onViolation(violation) {
        this.violations.push(violation);
        this._trim(this.violations, LIMITS.LEDGER);
    }

    _onScore(event) {
        this.ledger.push(event);
        this._trim(this.ledger, LIMITS.LEDGER);

        if (event.event === 'ARRIVAL') {
            event.callsigns.forEach((callsign) => this._endLifecycle(callsign, OUTCOME.LANDED, event.time));
        } else if (event.event === 'AIRSPACE_BUST') {
            event.callsigns.forEach((callsign) => this._endLifecycle(callsign, OUTCOME.LOST, event.time));
        }
    }

    _onSpawn(event, created) {
        this.spawns.push({ time: TimeKeeper.accumulatedDeltaTime, created, ...event });
        this._trim(this.spawns, LIMITS.SPAWNS);
    }

    _trim(list, limit) {
        if (list.length > limit) {
            list.splice(0, list.length - limit);
        }
    }
}

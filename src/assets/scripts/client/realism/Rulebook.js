import EventBus from '../lib/EventBus';
import GameController, { GAME_EVENTS } from '../game/GameController';
import { AUDIT_EVENT } from '../constants/eventNames';
import TimeKeeper from '../engine/TimeKeeper';
import UiController from '../ui/UiController';

/**
 * Priority tiers of the rules. A lower tier always takes precedence: no gain in a
 * higher tier can compensate for a violation in a lower one.
 *
 * @property RULE_TIER
 * @type {object}
 * @final
 */
export const RULE_TIER = {
    SAFETY: 0,
    SEPARATION: 1,
    PROCEDURE: 2,
    EFFICIENCY: 3,
    ENVIRONMENT: 4
};

/**
 * Rules checked by the `RealismController`
 *
 * `gameEvent` is the scored event recorded when the rule is broken.
 *
 * @property RULE
 * @type {object}
 * @final
 */
export const RULE = {
    RUNWAY_INCURSION: {
        id: 'RUNWAY_INCURSION',
        tier: RULE_TIER.SAFETY,
        gameEvent: GAME_EVENTS.RUNWAY_INCURSION,
        description: 'landing or takeoff on an occupied runway',
        reference: 'ICAO Doc 4444 7.10.1, 7.11.1; FAA JO 7110.65 3-9-6, 3-10-3'
    },
    TERRAIN_COLLISION: {
        id: 'TERRAIN_COLLISION',
        tier: RULE_TIER.SAFETY,
        gameEvent: GAME_EVENTS.COLLISION,
        description: 'controlled flight into terrain',
        reference: 'ICAO Doc 4444 8.6.5.2'
    },
    MINIMUM_ALTITUDE: {
        id: 'MINIMUM_ALTITUDE',
        tier: RULE_TIER.SAFETY,
        gameEvent: GAME_EVENTS.MINIMUM_ALTITUDE_VIOLATION,
        description: 'vectored below the minimum vectoring altitude',
        reference: 'ICAO Doc 4444 8.6.5.2; FAA JO 7110.65 5-6-1'
    },
    RADAR_SEPARATION: {
        id: 'RADAR_SEPARATION',
        tier: RULE_TIER.SEPARATION,
        gameEvent: GAME_EVENTS.SEPARATION_LOSS,
        description: 'loss of radar separation',
        reference: 'ICAO Doc 4444 8.7.3; FAA JO 7110.65 5-5-4'
    },
    FINAL_APPROACH_SEPARATION: {
        id: 'FINAL_APPROACH_SEPARATION',
        tier: RULE_TIER.SEPARATION,
        gameEvent: GAME_EVENTS.SEPARATION_LOSS,
        description: 'loss of minimum radar separation on final approach',
        reference: 'ICAO Doc 4444 8.7.3.2; RECAT-EU reduced MRS; FAA JO 7110.65 5-5-4'
    },
    WAKE_ARRIVAL: {
        id: 'WAKE_ARRIVAL',
        tier: RULE_TIER.SEPARATION,
        gameEvent: GAME_EVENTS.WAKE_SEPARATION_LOSS,
        description: 'wake turbulence separation on approach',
        reference: 'ICAO Doc 4444 8.7.3.4; RECAT-EU; FAA JO 7110.65 5-5-4'
    },
    WAKE_DEPARTURE: {
        id: 'WAKE_DEPARTURE',
        tier: RULE_TIER.SEPARATION,
        gameEvent: GAME_EVENTS.WAKE_SEPARATION_LOSS,
        description: 'wake turbulence separation between departures',
        reference: 'ICAO Doc 4444 5.8.3; RECAT-EU; FAA JO 7110.65 3-9-6'
    },
    ARRIVAL_DEPARTURE: {
        id: 'ARRIVAL_DEPARTURE',
        tier: RULE_TIER.SEPARATION,
        gameEvent: GAME_EVENTS.NO_TAKEOFF_SEPARATION,
        description: 'takeoff with an arrival too close to the threshold',
        reference: 'ICAO Doc 4444 7.11.3; FAA JO 7110.65 3-9-6'
    },
    RUNWAY_WIND_LIMIT: {
        id: 'RUNWAY_WIND_LIMIT',
        tier: RULE_TIER.PROCEDURE,
        gameEvent: GAME_EVENTS.HIGH_TAILWIND_OPERATION,
        description: 'runway used beyond its tailwind or crosswind limit',
        reference: 'ICAO Doc 4444 7.2.3'
    },
    GO_AROUND: {
        id: 'GO_AROUND',
        tier: RULE_TIER.EFFICIENCY,
        gameEvent: GAME_EVENTS.GO_AROUND,
        description: 'missed approach',
        reference: 'ICAO Doc 8168 Vol I; stabilized approach criteria'
    }
};

/**
 * Maximum number of unread violations kept; in the browser nobody reads them
 *
 * @property MAX_PENDING_VIOLATIONS
 * @type {number}
 * @final
 */
const MAX_PENDING_VIOLATIONS = 500;

/**
 * Records broken rules, scores them and keeps a log that bots can read
 *
 * @class Rulebook
 */
export default class Rulebook {
    /**
     * @constructor
     */
    constructor() {
        /**
         * Violations not yet read with `drainViolations()`
         *
         * @property _pendingViolations
         * @type {array<object>}
         * @private
         */
        this._pendingViolations = [];

        /**
         * Number of violations of each rule since the start of the session
         *
         * @property counts
         * @type {object}
         */
        this.counts = {};

        this.reset();
    }

    /**
     * @for Rulebook
     * @method reset
     */
    reset() {
        this._pendingViolations = [];
        this.counts = {};

        Object.keys(RULE).forEach((ruleId) => {
            this.counts[ruleId] = 0;
        });
    }

    /**
     * Record a broken rule
     *
     * @for Rulebook
     * @method record
     * @param rule {object}               one of `RULE`
     * @param callsigns {array<string>}   aircraft involved
     * @param details {string}            human readable explanation
     * @param [gameEvent] {string}        overrides the rule's scored event
     */
    record(rule, callsigns, details, gameEvent = rule.gameEvent) {
        const violation = {
            time: TimeKeeper.accumulatedDeltaTime,
            rule: rule.id,
            tier: rule.tier,
            callsigns,
            details,
            reference: rule.reference
        };

        this.counts[rule.id] += 1;
        this._pendingViolations.push(violation);
        EventBus.trigger(AUDIT_EVENT.RULE_VIOLATION, violation);

        if (this._pendingViolations.length > MAX_PENDING_VIOLATIONS) {
            this._pendingViolations.shift();
        }

        if (rule.tier <= RULE_TIER.PROCEDURE) {
            UiController.ui_log(`${callsigns.join(' / ')}: ${details}`, true);
        }

        if (gameEvent) {
            GameController.events_recordNew(gameEvent, { callsigns, details });
        }
    }

    /**
     * Violations recorded since the last call
     *
     * @for Rulebook
     * @method drainViolations
     * @return {array<object>}
     */
    drainViolations() {
        const violations = this._pendingViolations;

        this._pendingViolations = [];

        return violations;
    }
}

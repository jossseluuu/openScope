import GameController, { GAME_EVENTS } from '../game/GameController';
import UiController from '../ui/UiController';
import { RULE } from './Rulebook';
import { vlen, vsub } from '../math/vector';
import { nm } from '../utilities/unitConverters';
import { AIRPORT_CONTROL_POSITION_NAME } from '../constants/airportConstants';
import { FLIGHT_PHASE } from '../constants/aircraftConstants';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';

/**
 * Transponder code of an aircraft in emergency
 *
 * @property EMERGENCY_SQUAWK
 * @type {string}
 * @final
 */
export const EMERGENCY_SQUAWK = '7700';

/**
 * Codes the controller may not assign: unlawful interference, radio failure and emergency
 *
 * @property RESERVED_EMERGENCY_SQUAWKS
 * @type {array<string>}
 * @final
 */
export const RESERVED_EMERGENCY_SQUAWKS = ['7500', '7600', EMERGENCY_SQUAWK];

/**
 * Probability that a flight declares an emergency, by value of the game option
 *
 * @property EMERGENCY_RATE_BY_OPTION
 * @type {object}
 * @final
 */
export const EMERGENCY_RATE_BY_OPTION = {
    off: 0,
    rare: 0.01,
    occasional: 0.03,
    frequent: 0.1
};

/**
 * Kinds of emergency. `weight` is the relative frequency; `deadlineMinutes` the shortest time
 * given to land after declaring it (more when the aircraft is far away, see `_deadlineSeconds`)
 *
 * @property EMERGENCY_TYPES
 * @type {array<object>}
 * @final
 */
export const EMERGENCY_TYPES = [
    {
        id: 'MEDICAL',
        description: 'medical emergency on board',
        deadlineMinutes: 25,
        weight: 4
    },
    {
        id: 'ENGINE_FAILURE',
        description: 'engine failure',
        deadlineMinutes: 20,
        weight: 3
    },
    {
        id: 'HYDRAULIC_FAILURE',
        description: 'hydraulic failure',
        deadlineMinutes: 25,
        weight: 2
    },
    {
        id: 'PRESSURIZATION',
        description: 'loss of cabin pressure',
        deadlineMinutes: 20,
        weight: 2
    },
    {
        id: 'SMOKE',
        description: 'smoke in the cabin',
        deadlineMinutes: 15,
        weight: 1
    },
    {
        id: 'FUEL',
        description: 'MAYDAY fuel',
        deadlineMinutes: 18,
        weight: 2
    }
];

/**
 * When an emergency is declared, counted from the moment the arrival is under our control
 *
 * @property DECLARATION_WINDOW_SECONDS
 * @type {array<number>}
 * @final
 */
const DECLARATION_WINDOW_SECONDS = [60, 720];

/**
 * Speed and extra time used to estimate how long a direct approach takes, for the deadline:
 * the deadline is never shorter than this estimate plus `DEADLINE_MARGIN_SECONDS`
 *
 * @property DEADLINE_ESTIMATE
 * @type {object}
 * @final
 */
const DEADLINE_ESTIMATE = {
    SPEED_KT: 200,
    PATTERN_SECONDS: 240
};
const DEADLINE_MARGIN_SECONDS = 600;

/**
 * Arrivals this close to the threshold with an approach clearance are about to land and do not
 * declare an emergency any more
 *
 * @property SHORT_FINAL_NM
 * @type {number}
 * @final
 */
const SHORT_FINAL_NM = 12;

const distanceNm = (positionA, positionB) => nm(vlen(vsub(positionA, positionB)));

/**
 * Small deterministic random generator (mulberry32). Emergencies have their own, so that turning
 * them on or off does not change the rest of the simulation (traffic, winds) for the same seed.
 *
 * @function createRandom
 * @param seed {number}
 * @return {function} numbers in [0, 1)
 */
/* eslint-disable no-bitwise */
function createRandom(seed) {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6D2B79F5) | 0;

        let t = state;

        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/* eslint-enable no-bitwise */

/**
 * Emergencies: now and then an arrival declares one (squawk 7700, MAYDAY call), shows in red
 * on the scope and must be landed before a generous deadline, with priority over the rest of
 * the traffic. Departures and overflights never declare one.
 *
 * - landing before the deadline: `EMERGENCY_LANDING` (+ the normal arrival points)
 * - deadline passed while airborne, or the aircraft left the airspace: `EMERGENCY_DEADLINE_MISSED`
 *   through the `Rulebook` rule `EMERGENCY_DEADLINE`
 *
 * The aircraft in emergency refuse holding patterns and keep squawking 7700. Everything else
 * (vectors, approach clearances, separation from it) is the controller's job, human or bot.
 *
 * Owned and updated by the `RealismController`, so it runs in the browser and headless alike.
 *
 * @class EmergencyController
 */
export default class EmergencyController {
    /**
     * @constructor
     * @param rulebook {Rulebook}
     */
    constructor(rulebook) {
        this._rulebook = rulebook;

        /**
         * Seed of the random generator; the headless simulator sets the episode's seed
         *
         * @property _seed
         * @type {number}
         * @private
         */
        this._seed = Date.now() % 2147483647;

        /**
         * Probability per flight that overrides the game option (headless runs), null to use the option
         *
         * @property _rateOverride
         * @type {number|null}
         * @private
         */
        this._rateOverride = null;

        this.reset();
    }

    /**
     * @for EmergencyController
     * @method configure
     * @param options {object}
     * @param [options.seed] {number}
     * @param [options.rate] {number|null}  probability per flight, null: use the game option
     */
    configure({ seed = this._seed, rate = this._rateOverride } = {}) {
        this._seed = seed;
        this._rateOverride = rate;
        this.reset();
    }

    /**
     * Forget every emergency, e.g. on a new episode or airport
     *
     * @for EmergencyController
     * @method reset
     */
    reset() {
        this._random = createRandom(this._seed);
        // by aircraft id: `{ declareAt }`, or null when the flight has no emergency
        this._plans = {};
        // by aircraft id: `{ aircraftModel, emergency, isMissed }`
        this._active = {};
    }

    /**
     * Probability that a flight declares an emergency
     *
     * @for EmergencyController
     * @property rate
     * @type {number}
     */
    get rate() {
        if (this._rateOverride !== null) {
            return this._rateOverride;
        }

        const option = GameController.game.option ?
            GameController.game.option.getOptionByName(GAME_OPTION_NAMES.EMERGENCIES) :
            null;

        return EMERGENCY_RATE_BY_OPTION[option] !== undefined ? EMERGENCY_RATE_BY_OPTION[option] : EMERGENCY_RATE_BY_OPTION.rare;
    }

    /**
     * Schedule, declare and follow emergencies; called by the `RealismController` every check
     *
     * @for EmergencyController
     * @method update
     * @param aircraftList {array<AircraftModel>}
     * @param time {number}
     */
    update(aircraftList, time) {
        aircraftList.forEach((aircraftModel) => {
            if (this._active[aircraftModel.id]) {
                return;
            }

            if (!this._isEligible(aircraftModel)) {
                return;
            }

            if (!(aircraftModel.id in this._plans)) {
                this._plans[aircraftModel.id] = this._plan(time);
            }

            const plan = this._plans[aircraftModel.id];

            if (plan && time >= plan.declareAt) {
                this.declare(aircraftModel, null, time);
            }
        });

        Object.keys(this._active).forEach((id) => {
            const entry = this._active[id];
            const { aircraftModel, emergency } = entry;
            const isGone = aircraftList.indexOf(aircraftModel) === -1;
            const hasLeft = !aircraftModel.isControllable && !aircraftModel.isOnGround();

            if (entry.isLanded || entry.isMissed) {
                if (isGone) {
                    delete this._active[id];
                }

                return;
            }

            if (hasLeft || isGone || time > emergency.deadline) {
                entry.isMissed = true;
                this._rulebook.record(
                    RULE.EMERGENCY_DEADLINE,
                    [aircraftModel.callsign],
                    hasLeft || isGone ?
                        `left the airspace in emergency (${emergency.description})` :
                        `still airborne ${Math.round((emergency.deadline - emergency.declaredAt) / 60)} min after declaring ` +
                        `an emergency (${emergency.description})`
                );
            }
        });
    }

    /**
     * Make an aircraft declare an emergency now (also used by the `emergency` command)
     *
     * @for EmergencyController
     * @method declare
     * @param aircraftModel {AircraftModel}
     * @param [typeId] {string|null}  one of `EMERGENCY_TYPES`, random when null
     * @param time {number}
     * @return {object|null} the emergency, null when this aircraft cannot have one
     */
    declare(aircraftModel, typeId, time) {
        if (!this._isEligible(aircraftModel) || this._active[aircraftModel.id]) {
            return null;
        }

        const type = EMERGENCY_TYPES.find((candidate) => candidate.id === typeId) || this._pickType();
        const emergency = {
            type: type.id,
            description: type.description,
            declaredAt: time,
            deadline: time + this._deadlineSeconds(aircraftModel, type)
        };

        aircraftModel.emergency = emergency;
        aircraftModel.transponderCode = EMERGENCY_SQUAWK;
        this._active[aircraftModel.id] = {
            aircraftModel, emergency, isMissed: false, isLanded: false
        };
        this._plans[aircraftModel.id] = null;

        const minutes = Math.round((emergency.deadline - time) / 60);

        aircraftModel.radioCall(
            `MAYDAY MAYDAY MAYDAY, ${emergency.description}, squawking 7700, request priority landing`,
            AIRPORT_CONTROL_POSITION_NAME.APPROACH,
            true
        );
        UiController.ui_log(`${aircraftModel.callsign} is in EMERGENCY: land it within ${minutes} min`, true);
        GameController.events_recordNew(GAME_EVENTS.EMERGENCY_DECLARED, {
            callsigns: [aircraftModel.callsign],
            details: `${emergency.description}, must land within ${minutes} min`
        });

        return emergency;
    }

    /**
     * An arrival touched down: an aircraft in emergency that lands in time is scored
     *
     * @for EmergencyController
     * @method onTouchdown
     * @param aircraftModel {AircraftModel}
     * @param time {number}
     */
    onTouchdown(aircraftModel, time) {
        const entry = this._active[aircraftModel.id];

        if (!entry || entry.isLanded || entry.isMissed) {
            return;
        }

        const { emergency } = entry;
        const minutes = ((time - emergency.declaredAt) / 60).toFixed(1);

        entry.isLanded = true;
        UiController.ui_log(`${aircraftModel.callsign} landed safely, ${minutes} min after declaring the emergency`);
        GameController.events_recordNew(GAME_EVENTS.EMERGENCY_LANDING, {
            callsigns: [aircraftModel.callsign],
            details: `emergency landing ${minutes} min after declaring (${emergency.description})`
        });
    }

    /**
     * Emergencies in progress, for bots
     *
     * @for EmergencyController
     * @method getObservation
     * @param time {number}
     * @return {array<object>}
     */
    getObservation(time) {
        return Object.keys(this._active)
            .map((id) => this._active[id])
            .filter((entry) => !entry.isLanded)
            .map(({ aircraftModel, emergency, isMissed }) => ({
                callsign: aircraftModel.callsign,
                type: emergency.type,
                remainingSeconds: Math.max(0, emergency.deadline - time),
                isMissed
            }));
    }

    /**
     * Whether an aircraft may declare an emergency now: only arrivals, before short final
     *
     * @for EmergencyController
     * @method _isEligible
     * @param aircraftModel {AircraftModel}
     * @return {boolean}
     * @private
     */
    _isEligible(aircraftModel) {
        if (!aircraftModel.isControllable || aircraftModel.isOnGround() || aircraftModel.hit || aircraftModel.projected ||
            !aircraftModel.isArrival()) {
            return false;
        }

        const runwayModel = aircraftModel.fms.arrivalRunwayModel;
        const isAboutToLand = aircraftModel.flightPhase === FLIGHT_PHASE.LANDING || (runwayModel &&
            aircraftModel.pilot.hasApproachClearance &&
            distanceNm(aircraftModel.relativePosition, runwayModel.relativePosition) < SHORT_FINAL_NM);

        return Boolean(runwayModel) && !isAboutToLand;
    }

    /**
     * Whether a flight will have an emergency, and when
     *
     * @for EmergencyController
     * @method _plan
     * @param time {number}
     * @return {object|null} `{ declareAt }`
     * @private
     */
    _plan(time) {
        // always draw both numbers, so the sequence does not depend on the outcome
        const draw = this._random();
        const [earliest, latest] = DECLARATION_WINDOW_SECONDS;
        const delay = earliest + this._random() * (latest - earliest);

        return draw < this.rate ? { declareAt: time + delay } : null;
    }

    /**
     * @for EmergencyController
     * @method _pickType
     * @return {object} one of `EMERGENCY_TYPES`
     * @private
     */
    _pickType() {
        const total = EMERGENCY_TYPES.reduce((sum, type) => sum + type.weight, 0);
        let draw = this._random() * total;

        for (let i = 0; i < EMERGENCY_TYPES.length; i++) {
            draw -= EMERGENCY_TYPES[i].weight;

            if (draw < 0) {
                return EMERGENCY_TYPES[i];
            }
        }

        return EMERGENCY_TYPES[EMERGENCY_TYPES.length - 1];
    }

    /**
     * Time given to land: the type's minimum, or a direct approach from where the aircraft is
     * plus `DEADLINE_MARGIN_SECONDS` when that is longer
     *
     * @for EmergencyController
     * @method _deadlineSeconds
     * @param aircraftModel {AircraftModel}
     * @param type {object}
     * @return {number}
     * @private
     */
    _deadlineSeconds(aircraftModel, type) {
        const runwayModel = aircraftModel.fms.arrivalRunwayModel;
        const distance = runwayModel ?
            distanceNm(aircraftModel.relativePosition, runwayModel.relativePosition) :
            nm(aircraftModel.distance);
        const estimate = distance / DEADLINE_ESTIMATE.SPEED_KT * 3600 + DEADLINE_ESTIMATE.PATTERN_SECONDS;

        return Math.max(type.deadlineMinutes * 60, estimate + DEADLINE_MARGIN_SECONDS);
    }
}

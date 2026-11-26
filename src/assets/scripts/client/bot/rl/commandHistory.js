import { ACTIONS, ACTION_TYPE } from '../actionSpace';

/**
 * Kinds of order whose timing is remembered per aircraft. A controller knows what they said
 * and when; without this the network can't tell "just turned it, wait" from "nothing given yet",
 * which is most of what decides whether to speak at a given moment.
 *
 * @property COMMAND_GROUPS
 * @type {array<string>}
 * @final
 */
export const COMMAND_GROUPS = ['heading', 'altitude', 'speed', 'route', 'approach', 'ground'];

const GROUP_OF_TYPE = {
    [ACTION_TYPE.HEADING]: 'heading',
    [ACTION_TYPE.ALTITUDE]: 'altitude',
    [ACTION_TYPE.SPEED]: 'speed',
    [ACTION_TYPE.DIRECT_NEXT]: 'route',
    [ACTION_TYPE.PROCEDURE]: 'route',
    [ACTION_TYPE.HOLD]: 'route',
    [ACTION_TYPE.EXIT_HOLD]: 'route',
    [ACTION_TYPE.ILS]: 'approach',
    [ACTION_TYPE.PARALLEL_RUNWAY]: 'approach',
    [ACTION_TYPE.GO_AROUND]: 'approach',
    [ACTION_TYPE.TAXI]: 'ground',
    [ACTION_TYPE.TAKEOFF]: 'ground',
    [ACTION_TYPE.CANCEL_TAKEOFF]: 'ground',
    [ACTION_TYPE.LINE_UP]: 'ground'
};

/**
 * Group of each aircraft command typed by the player (canonical names from `aircraftCommandMap`),
 * so the audit can remember the player's orders the same way as the bots' actions
 *
 * @property GROUP_OF_COMMAND_NAME
 * @type {object}
 * @final
 */
export const GROUP_OF_COMMAND_NAME = {
    heading: 'heading',
    flyPresentHeading: 'heading',
    altitude: 'altitude',
    speed: 'speed',
    direct: 'route',
    route: 'route',
    reroute: 'route',
    sid: 'route',
    star: 'route',
    climbViaSid: 'route',
    descendViaStar: 'route',
    hold: 'route',
    cancelHold: 'route',
    ils: 'approach',
    land: 'approach',
    goAround: 'approach',
    taxi: 'ground',
    takeoff: 'ground',
    abort: 'ground',
    lineUp: 'ground'
};

/**
 * Seconds after which an order no longer counts as recent
 *
 * @property RECENT_SECONDS
 * @type {number}
 * @final
 */
export const RECENT_SECONDS = 180;

/**
 * When each kind of order was last given to each aircraft.
 *
 * Whoever issues the orders (the training environment, Bot B in the browser) records them here,
 * and the feature encoder reads how recent they are.
 *
 * @class CommandHistory
 */
export default class CommandHistory {
    constructor() {
        this._times = {};
    }

    /**
     * @for CommandHistory
     * @method reset
     */
    reset() {
        this._times = {};
    }

    /**
     * @for CommandHistory
     * @method record
     * @param callsign {string}
     * @param action {number}  index in `ACTIONS`
     * @param time {number}    simulation time in seconds
     */
    record(callsign, action, time) {
        this._recordGroup(callsign, GROUP_OF_TYPE[ACTIONS[action] && ACTIONS[action].type], time);
    }

    /**
     * Record a typed command, e.g. from the player
     *
     * @for CommandHistory
     * @method recordCommandNames
     * @param callsign {string}
     * @param names {array<string>}  canonical command names, e.g. `['heading', 'altitude']`
     * @param time {number}          simulation time in seconds
     */
    recordCommandNames(callsign, names, time) {
        names.forEach((name) => this._recordGroup(callsign, GROUP_OF_COMMAND_NAME[name], time));
    }

    _recordGroup(callsign, group, time) {
        if (!group) {
            return;
        }

        if (!this._times[callsign]) {
            this._times[callsign] = {};
        }

        this._times[callsign][group] = time;
    }

    /**
     * 1 just given, falling to 0 after `RECENT_SECONDS`; 0 if never given
     *
     * @for CommandHistory
     * @method recency
     * @param callsign {string}
     * @param time {number}
     * @return {array<number>} one value per `COMMAND_GROUPS`
     */
    recency(callsign, time) {
        const times = this._times[callsign] || {};

        return COMMAND_GROUPS.map((group) => {
            if (times[group] === undefined) {
                return 0;
            }

            return Math.max(0, 1 - (time - times[group]) / RECENT_SECONDS);
        });
    }

    /**
     * Drop aircraft that are no longer in the observation
     *
     * @for CommandHistory
     * @method forgetGone
     * @param observation {object}
     */
    forgetGone(observation) {
        const present = new Set(observation.aircraft.map((aircraft) => aircraft.callsign));

        Object.keys(this._times).forEach((callsign) => {
            if (!present.has(callsign)) {
                delete this._times[callsign];
            }
        });
    }
}

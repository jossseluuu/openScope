/**
 * Discrete actions shared by every bot.
 *
 * A bot gives at most one action per aircraft per decision. Each action maps to
 * a command in the syntax of the command bar, so bots have exactly the abilities
 * of a human controller. Bot A emits these actions and Bot B learns to choose
 * among them, which makes Bot A's decisions usable as training labels.
 */

import { headingDifference, normalizeHeading } from './botGeometry';

/**
 * Heading changes relative to the current heading, in degrees
 *
 * @property HEADING_CHANGES
 * @type {array<number>}
 * @final
 */
export const HEADING_CHANGES = [-90, -60, -45, -30, -20, -10, -5, 5, 10, 20, 30, 45, 60, 90];

/**
 * Altitudes that can be assigned, in feet
 *
 * @property ALTITUDES
 * @type {array<number>}
 * @final
 */
export const ALTITUDES = Array.from({ length: 23 }, (value, index) => 2000 + index * 1000);

/**
 * Speeds that can be assigned, in knots
 *
 * @property SPEEDS
 * @type {array<number>}
 * @final
 */
export const SPEEDS = [140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300];

/**
 * Kinds of action
 *
 * @property ACTION_TYPE
 * @type {object}
 * @final
 */
export const ACTION_TYPE = {
    NOOP: 'NOOP',
    HEADING: 'HEADING',
    ALTITUDE: 'ALTITUDE',
    SPEED: 'SPEED',
    DIRECT_NEXT: 'DIRECT_NEXT',
    PROCEDURE: 'PROCEDURE',
    ILS: 'ILS',
    PARALLEL_RUNWAY: 'PARALLEL_RUNWAY',
    HOLD: 'HOLD',
    EXIT_HOLD: 'EXIT_HOLD',
    GO_AROUND: 'GO_AROUND',
    TAXI: 'TAXI',
    TAKEOFF: 'TAKEOFF'
};

const buildActions = () => [
    { type: ACTION_TYPE.NOOP },
    ...HEADING_CHANGES.map((value) => ({ type: ACTION_TYPE.HEADING, value })),
    ...ALTITUDES.map((value) => ({ type: ACTION_TYPE.ALTITUDE, value })),
    ...SPEEDS.map((value) => ({ type: ACTION_TYPE.SPEED, value })),
    { type: ACTION_TYPE.DIRECT_NEXT },
    { type: ACTION_TYPE.PROCEDURE },
    { type: ACTION_TYPE.ILS },
    { type: ACTION_TYPE.PARALLEL_RUNWAY },
    { type: ACTION_TYPE.HOLD },
    { type: ACTION_TYPE.EXIT_HOLD },
    { type: ACTION_TYPE.GO_AROUND },
    { type: ACTION_TYPE.TAXI },
    { type: ACTION_TYPE.TAKEOFF }
];

/**
 * Every action, indexed by its position
 *
 * @property ACTIONS
 * @type {array<object>}
 * @final
 */
export const ACTIONS = buildActions().map((action, index) => ({ ...action, index }));

/**
 * Number of actions
 *
 * @property ACTION_COUNT
 * @type {number}
 * @final
 */
export const ACTION_COUNT = ACTIONS.length;

const indexOfType = (type) => ACTIONS.findIndex((action) => action.type === type);

/**
 * Index of the action of a given type (for types with a single action)
 *
 * @property ACTION_INDEX
 * @type {object}
 * @final
 */
export const ACTION_INDEX = Object.keys(ACTION_TYPE).reduce((indexes, type) => {
    indexes[type] = indexOfType(type);

    return indexes;
}, {});

const nearestIndex = (values, value) => values.reduce(
    (best, candidate, index) => (Math.abs(candidate - value) < Math.abs(values[best] - value) ? index : best),
    0
);

/**
 * Heading that relative heading actions start from: the assigned heading when the
 * aircraft is flying one, otherwise its present heading
 *
 * @function headingReference
 * @param aircraft {object}
 * @return {number}
 */
export const headingReference = (aircraft) => (
    aircraft.clearance && aircraft.clearance.headingMode === 'HOLD' && Number.isFinite(aircraft.clearance.heading) ?
        aircraft.clearance.heading :
        aircraft.heading
);

/**
 * Action that turns an aircraft as close as possible to `targetHeading`
 *
 * @function headingAction
 * @param aircraft {object}
 * @param targetHeading {number}
 * @return {number} action index, NOOP when the change is below 3 degrees
 */
export function headingAction(aircraft, targetHeading) {
    const change = headingDifference(headingReference(aircraft), targetHeading);

    if (Math.abs(change) < 3) {
        return ACTION_INDEX.NOOP;
    }

    return ACTION_INDEX.HEADING + nearestIndex(HEADING_CHANGES, change);
}

/**
 * Action assigning the altitude closest to `altitude`
 *
 * @function altitudeAction
 * @param altitude {number}
 * @return {number}
 */
export function altitudeAction(altitude) {
    return ACTION_INDEX.ALTITUDE + nearestIndex(ALTITUDES, altitude);
}

/**
 * Action assigning the speed closest to `speed`
 *
 * @function speedAction
 * @param speed {number}
 * @return {number}
 */
export function speedAction(speed) {
    return ACTION_INDEX.SPEED + nearestIndex(SPEEDS, speed);
}

/**
 * First waypoint ahead with a position
 *
 * @function nextPositionedWaypoint
 * @param aircraft {object}
 * @return {object|undefined}
 */
export const nextPositionedWaypoint = (aircraft) => (aircraft.waypoints || []).find((waypoint) => waypoint.x !== null);

const isOnApproach = (aircraft) => aircraft.hasApproachClearance ||
    aircraft.flightPhase === 'APPROACH' ||
    aircraft.flightPhase === 'LANDING';

/**
 * @function arrivalRunwayName
 * @param aircraft {object}
 * @param observation {object}
 * @return {string|null}
 */
export const arrivalRunwayName = (aircraft, observation) => aircraft.arrivalRunway || observation.airport.arrivalRunway;

/**
 * @function departureRunwayName
 * @param aircraft {object}
 * @param observation {object}
 * @return {string|null}
 */
export const departureRunwayName = (aircraft, observation) => aircraft.departureRunway || observation.airport.departureRunway;

/**
 * The other runway with an ILS parallel to the arrival's runway, landing in the same direction
 *
 * @function parallelRunwayName
 * @param aircraft {object}
 * @param observation {object}
 * @return {string|null}
 */
export function parallelRunwayName(aircraft, observation) {
    const name = arrivalRunwayName(aircraft, observation);
    const runways = observation.airport.runways.flat();
    const current = runways.find((runway) => runway.name === name);

    if (!current) {
        return null;
    }

    const parallel = runways.find((runway) => runway.name !== name && runway.ils &&
        Math.abs(headingDifference(runway.heading, current.heading)) < 10);

    return parallel ? parallel.name : null;
}

function hasIlsRunway(aircraft, observation) {
    const name = arrivalRunwayName(aircraft, observation);

    return observation.airport.runways.some((pair) => pair.some((runway) => runway.name === name && runway.ils));
}

/**
 * Actions that make sense for an aircraft (the safety shield removes unsafe ones)
 *
 * @function getApplicableActions
 * @param aircraft {object}     aircraft observation
 * @param observation {object}
 * @return {array<boolean>}     one entry per action
 */
export function getApplicableActions(aircraft, observation) {
    const mask = new Array(ACTION_COUNT).fill(false);

    mask[ACTION_INDEX.NOOP] = true;

    if (!aircraft.isControllable) {
        return mask;
    }

    if (aircraft.isOnGround) {
        if (aircraft.category === 'departure') {
            mask[ACTION_INDEX.TAXI] = aircraft.flightPhase === 'APRON';
            mask[ACTION_INDEX.TAKEOFF] = aircraft.flightPhase === 'WAITING';
        }

        return mask;
    }

    const isArrival = aircraft.category === 'arrival';
    const hasNextFix = Boolean(nextPositionedWaypoint(aircraft));
    const limits = aircraft.speedLimits || { min: 0, max: 999 };
    const maximumSpeed = aircraft.altitude < 10000 ? Math.min(limits.max, 250) : limits.max;

    ACTIONS.forEach((action) => {
        switch (action.type) {
            case ACTION_TYPE.HEADING:
                mask[action.index] = true;
                break;
            case ACTION_TYPE.ALTITUDE:
                mask[action.index] = action.value <= (aircraft.ceiling || Infinity);
                break;
            case ACTION_TYPE.SPEED:
                mask[action.index] = action.value >= limits.min + 10 && action.value <= maximumSpeed;
                break;
            default:
                break;
        }
    });

    mask[ACTION_INDEX.DIRECT_NEXT] = hasNextFix;
    mask[ACTION_INDEX.PROCEDURE] = hasNextFix && aircraft.category !== 'overflight';
    mask[ACTION_INDEX.ILS] = isArrival && hasIlsRunway(aircraft, observation);
    mask[ACTION_INDEX.PARALLEL_RUNWAY] = isArrival && !isOnApproach(aircraft) &&
        Boolean(parallelRunwayName(aircraft, observation));
    mask[ACTION_INDEX.HOLD] = hasNextFix && !aircraft.isHoldAssigned;
    mask[ACTION_INDEX.EXIT_HOLD] = Boolean(aircraft.isHoldAssigned);
    mask[ACTION_INDEX.GO_AROUND] = isArrival && isOnApproach(aircraft);

    return mask;
}

const formatHeading = (heading) => {
    const rounded = Math.round(normalizeHeading(heading));

    return String(rounded === 0 ? 360 : rounded).padStart(3, '0');
};

/**
 * Command text for an action, or null for NOOP
 *
 * @function actionToCommand
 * @param actionIndex {number}
 * @param aircraft {object}
 * @param observation {object}
 * @return {string|null}
 */
export function actionToCommand(actionIndex, aircraft, observation) {
    const action = ACTIONS[actionIndex];
    const nextFix = nextPositionedWaypoint(aircraft);

    switch (action.type) {
        case ACTION_TYPE.HEADING: {
            const direction = action.value < 0 ? 'l' : 'r';

            return `fh ${direction} ${formatHeading(headingReference(aircraft) + action.value)}`;
        }
        case ACTION_TYPE.ALTITUDE:
            return `a ${action.value / 100}`;
        case ACTION_TYPE.SPEED:
            return `sp ${action.value}`;
        case ACTION_TYPE.DIRECT_NEXT:
            return nextFix ? `pd ${nextFix.name}` : null;
        case ACTION_TYPE.PROCEDURE:
            return aircraft.category === 'arrival' ? 'dvs' : 'cvs';
        case ACTION_TYPE.ILS:
            return `i ${arrivalRunwayName(aircraft, observation)}`;
        case ACTION_TYPE.PARALLEL_RUNWAY:
            return `e ${parallelRunwayName(aircraft, observation)}`;
        case ACTION_TYPE.HOLD:
            return nextFix ? `hold ${nextFix.name}` : null;
        case ACTION_TYPE.EXIT_HOLD:
            return 'xh';
        case ACTION_TYPE.GO_AROUND:
            return 'ga';
        case ACTION_TYPE.TAXI:
            return `caf taxi ${departureRunwayName(aircraft, observation)} cvs`;
        case ACTION_TYPE.TAKEOFF:
            return 'cto';
        default:
            return null;
    }
}

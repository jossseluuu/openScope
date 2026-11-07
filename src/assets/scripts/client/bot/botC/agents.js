import { ACTIONS, ACTION_TYPE } from '../actionSpace';
import { ARRIVAL_MODE, classifyArrival } from '../botA/arrivalPlanner';

/**
 * The agents of Bot C. `SHIELD` is not an agent: it marks the actions imposed by the safety shield.
 *
 * @property AGENT
 * @type {object}
 * @final
 */
export const AGENT = {
    COORDINATOR: 'COORDINATOR',
    ARRIVALS: 'ARRIVALS',
    ILS: 'ILS',
    TOWER: 'TOWER',
    DEPARTURES: 'DEPARTURES',
    SEPARATION: 'SEPARATION',
    SHIELD: 'SHIELD'
};

/**
 * Names shown in the bot audit page
 *
 * @property AGENT_LABEL
 * @type {object}
 * @final
 */
export const AGENT_LABEL = {
    [AGENT.COORDINATOR]: 'Coordinador',
    [AGENT.ARRIVALS]: 'Entradas',
    [AGENT.ILS]: 'ILS',
    [AGENT.TOWER]: 'Torre',
    [AGENT.DEPARTURES]: 'Salidas',
    [AGENT.SEPARATION]: 'Separación',
    [AGENT.SHIELD]: 'Escudo'
};

/**
 * Tower looks after arrivals established on final and departures below this height above the airport
 *
 * @property TOWER_CEILING_AGL_FT
 * @type {number}
 * @final
 */
export const TOWER_CEILING_AGL_FT = 3000;

const {
    ALTITUDE, CANCEL_TAKEOFF, DIRECT_NEXT, EXIT_HOLD, GO_AROUND, HEADING, HOLD, ILS, PARALLEL_RUNWAY, PROCEDURE, SPEED, TAKEOFF, TAXI
} = ACTION_TYPE;

/**
 * Kinds of action each agent may give. The shield is not limited.
 *
 * @property AGENT_AUTHORITY
 * @type {object}
 * @final
 */
export const AGENT_AUTHORITY = {
    [AGENT.COORDINATOR]: [PARALLEL_RUNWAY],
    [AGENT.ARRIVALS]: [HEADING, ALTITUDE, SPEED, DIRECT_NEXT, PROCEDURE, ILS, HOLD, EXIT_HOLD],
    [AGENT.ILS]: [HEADING, ALTITUDE, SPEED, DIRECT_NEXT, PROCEDURE, ILS, HOLD, EXIT_HOLD],
    [AGENT.TOWER]: [ALTITUDE, SPEED, PROCEDURE, ILS, GO_AROUND, TAXI, ACTION_TYPE.LINE_UP, TAKEOFF, CANCEL_TAKEOFF],
    [AGENT.DEPARTURES]: [HEADING, ALTITUDE, SPEED, DIRECT_NEXT, PROCEDURE],
    [AGENT.SEPARATION]: [HEADING, ALTITUDE, SPEED, DIRECT_NEXT, PROCEDURE]
};

/**
 * Whether an agent may give an action
 *
 * @function hasAuthority
 * @param agent {string}   one of `AGENT`
 * @param action {number}  index in `ACTIONS`
 * @return {boolean}
 */
export function hasAuthority(agent, action) {
    return agent === AGENT.SHIELD || AGENT_AUTHORITY[agent].indexOf(ACTIONS[action].type) !== -1;
}

/**
 * The agent responsible for an aircraft: there is exactly one at any time
 *
 * @function ownerOf
 * @param aircraft {object}
 * @param observation {object}
 * @return {string} one of `AGENT`
 */
export function ownerOf(aircraft, observation) {
    const height = aircraft.altitude - observation.airport.elevation;

    if (aircraft.category === 'overflight') {
        return AGENT.DEPARTURES;
    }

    if (aircraft.category === 'departure') {
        return aircraft.isOnGround || height < TOWER_CEILING_AGL_FT ? AGENT.TOWER : AGENT.DEPARTURES;
    }

    if (aircraft.isOnGround) {
        return AGENT.TOWER;
    }

    const mode = classifyArrival(aircraft);

    if (mode === ARRIVAL_MODE.FINAL) {
        return height < TOWER_CEILING_AGL_FT ? AGENT.TOWER : AGENT.ILS;
    }

    return mode === ARRIVAL_MODE.ROUTE ? AGENT.ARRIVALS : AGENT.ILS;
}

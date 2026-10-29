import { GLIDEPATH_FT_PER_NM, trueAirspeedFactor } from '../botGeometry';

/**
 * Motion of arrivals established on the final approach, to predict the spacing between
 * them down to the threshold, including the compression when the leader slows down.
 */

/**
 * The engine keeps the cleared speed down to this distance from the threshold...
 *
 * @property SPEED_REDUCTION_START_NM
 * @type {number}
 * @final
 */
const SPEED_REDUCTION_START_NM = 5;

/**
 * ...and reaches the landing speed at the stabilized approach gate (1000 ft above the
 * threshold) plus 0.5 nm, see `AircraftModel#_calculateTargetedSpeedDuringLanding`
 *
 * @property STABILIZED_GATE_NM
 * @type {number}
 * @final
 */
const STABILIZED_GATE_NM = 1000 / GLIDEPATH_FT_PER_NM + 0.5;

const STEP_SECONDS = 2;
const MAX_STEPS = 900;

/**
 * Indicated airspeed on final at `along` nm from the threshold
 *
 * @function finalSpeedAt
 * @param along {number}
 * @param clearedSpeed {number}
 * @param landingSpeed {number}
 * @return {number}
 */
export function finalSpeedAt(along, clearedSpeed, landingSpeed) {
    if (along >= SPEED_REDUCTION_START_NM) {
        return clearedSpeed;
    }

    if (along <= STABILIZED_GATE_NM) {
        return landingSpeed;
    }

    const fraction = (along - STABILIZED_GATE_NM) / (SPEED_REDUCTION_START_NM - STABILIZED_GATE_NM);

    return landingSpeed + (Math.max(clearedSpeed, landingSpeed) - landingSpeed) * fraction;
}

/**
 * Ground speed on final, without wind
 *
 * @function groundSpeed
 * @param state {object}
 * @param along {number}
 * @return {number}
 */
function groundSpeed(state, along) {
    const altitude = state.elevation + Math.max(0, along) * GLIDEPATH_FT_PER_NM;

    return Math.max(60, finalSpeedAt(along, state.clearedSpeed, state.landingSpeed) * trueAirspeedFactor(altitude));
}

/**
 * State of an aircraft on final: `{ along, clearedSpeed, landingSpeed, elevation }`
 *
 * @function finalState
 * @param aircraft {object}
 * @param along {number}
 * @param elevation {number}
 * @param [clearedSpeed] {number}  defaults to the aircraft's current clearance
 * @return {object}
 */
export function finalState(aircraft, along, elevation, clearedSpeed = null) {
    const currentSpeed = aircraft.clearance.speedMode === 'HOLD' ? aircraft.clearance.speed : aircraft.speed;
    const cleared = clearedSpeed !== null ? clearedSpeed : currentSpeed;
    const landingSpeed = aircraft.speedLimits ? aircraft.speedLimits.landing : 130;

    return {
        along, clearedSpeed: cleared, landingSpeed, elevation
    };
}

/**
 * Distance flown on final in `seconds`
 *
 * @function advanceOnFinal
 * @param state {object}  from `finalState`
 * @param seconds {number}
 * @return {object} the new state
 */
export function advanceOnFinal(state, seconds) {
    let { along } = state;

    for (let t = 0; t < seconds && along > 0; t += STEP_SECONDS) {
        along -= groundSpeed(state, along) * Math.min(STEP_SECONDS, seconds - t) / 3600;
    }

    return { ...state, along };
}

/**
 * Time to the threshold from a state on final, in seconds
 *
 * @function timeToThreshold
 * @param state {object}
 * @return {number}
 */
export function timeToThreshold(state) {
    let { along } = state;
    let time = 0;

    for (let i = 0; i < MAX_STEPS && along > 0; i++) {
        const speed = groundSpeed(state, along);
        const step = Math.min(STEP_SECONDS, along / speed * 3600);

        along -= speed * step / 3600;
        time += step;
    }

    return time;
}

/**
 * Smallest distance between two aircraft on the same final from now until the leader
 * lands. The follower closes on the leader whenever the leader is the slower one, mostly
 * while the leader slows down to its landing speed in the last 5 nm.
 *
 * @function minimumGapOnFinal
 * @param leader {object}    from `finalState`
 * @param follower {object}  from `finalState`, further out than the leader
 * @return {number} nm
 */
export function minimumGapOnFinal(leader, follower) {
    let leaderAlong = leader.along;
    let followerAlong = follower.along;
    let gap = followerAlong - leaderAlong;

    for (let i = 0; i < MAX_STEPS && leaderAlong > 0; i++) {
        leaderAlong -= groundSpeed(leader, leaderAlong) * STEP_SECONDS / 3600;
        followerAlong -= groundSpeed(follower, followerAlong) * STEP_SECONDS / 3600;
        gap = Math.min(gap, followerAlong - Math.max(0, leaderAlong));
    }

    return gap;
}

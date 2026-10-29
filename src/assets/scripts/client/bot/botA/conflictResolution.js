import {
    ACTIONS, ACTION_INDEX, ACTION_TYPE, ALTITUDES, HEADING_CHANGES, headingReference
} from '../actionSpace';
import {
    bearing, distanceInsideAirspace, headingDifference, headingVector, normalizeHeading
} from '../botGeometry';

/**
 * Short-term conflict detection and resolution (CD&R) of Bot A
 */

const PREDICTION_STEP_SECONDS = 10;
const CLIMB_FEET_PER_SECOND = 2000 / 60;
const DESCENT_FEET_PER_SECOND = 1800 / 60;
const FINAL_DESCENT_FEET_PER_SECOND = 750 / 60;
const VERTICAL_TOLERANCE_FT = 50;

const isOnFinal = (aircraft) => (aircraft.flightPhase === 'APPROACH' || aircraft.flightPhase === 'LANDING') &&
    aircraft.hasApproachClearance;

/**
 * Descent rate the pilots plan their top of descent with: a typical jet's rate
 * times `PERFORMANCE.TYPICAL_DESCENT_FACTOR`
 *
 * @property VNAV_DESCENT_FEET_PER_SECOND
 * @type {number}
 * @final
 */
const VNAV_DESCENT_FEET_PER_SECOND = 2200 / 60;

/**
 * Seconds until the aircraft starts down to meet `altitude` at `waypoint`
 */
function topOfDescentSeconds(aircraft, waypoint, altitude) {
    if (waypoint.x === null) {
        return 0;
    }

    const secondsToWaypoint = Math.hypot(waypoint.x - aircraft.x, waypoint.y - aircraft.y) /
        Math.max(aircraft.groundSpeed, 60) * 3600;
    const descentSeconds = (aircraft.altitude - altitude) / VNAV_DESCENT_FEET_PER_SECOND;

    return Math.max(0, secondsToWaypoint - descentSeconds);
}

/**
 * Altitude the aircraft is heading for, and in how many seconds it starts moving.
 *
 * Climbing or descending via the procedure, it follows the next "at or above" and
 * "at or below" restrictions on its route as the aircraft model does
 * (`AircraftModel#_calculateTargetedAltitudeVnav`): it stays level above a minimum
 * it has not passed and starts down to a maximum at its top of descent.
 *
 * @function verticalPlan
 * @param aircraft {object}
 * @return {object} `{ target, start }`
 */
export function verticalPlan(aircraft) {
    const target = aircraft.clearance.altitude;
    const now = (altitude) => ({ target: altitude, start: 0 });

    if (aircraft.clearance.altitudeMode !== 'VNAV' || !Number.isFinite(target)) {
        return now(target);
    }

    const waypoints = aircraft.waypoints || [];
    const minimumIndex = waypoints.findIndex((waypoint) => Number.isFinite(waypoint.altitudeMinimum));
    const maximumIndex = waypoints.findIndex((waypoint) => Number.isFinite(waypoint.altitudeMaximum));
    const minimumWaypoint = waypoints[minimumIndex];
    const maximumWaypoint = waypoints[maximumIndex];

    if (target < aircraft.altitude) {
        if (!minimumWaypoint || minimumWaypoint.altitudeMinimum < target) {
            return now(target);
        }

        const { altitudeMinimum } = minimumWaypoint;

        if (aircraft.altitude < altitudeMinimum) {
            return now(altitudeMinimum);
        }

        if (maximumWaypoint) {
            const { altitudeMaximum } = maximumWaypoint;

            if (target > altitudeMaximum) {
                return now(target);
            }

            if (aircraft.altitude > altitudeMaximum) {
                if (altitudeMinimum > altitudeMaximum && minimumIndex < maximumIndex) {
                    return { target: altitudeMinimum, start: topOfDescentSeconds(aircraft, minimumWaypoint, altitudeMinimum) };
                }

                return { target: altitudeMaximum, start: topOfDescentSeconds(aircraft, maximumWaypoint, altitudeMaximum) };
            }
        }

        // level until the "at or above" restriction is passed
        return now(aircraft.altitude);
    }

    if (!maximumWaypoint || target < maximumWaypoint.altitudeMaximum) {
        return now(target);
    }

    const { altitudeMaximum } = maximumWaypoint;

    if (aircraft.altitude > altitudeMaximum) {
        return { target: altitudeMaximum, start: topOfDescentSeconds(aircraft, maximumWaypoint, altitudeMaximum) };
    }

    if (minimumWaypoint) {
        const { altitudeMinimum } = minimumWaypoint;

        if (target < altitudeMinimum) {
            return now(target);
        }

        if (aircraft.altitude < altitudeMinimum) {
            return now(altitudeMaximum < altitudeMinimum && maximumIndex < minimumIndex ? altitudeMaximum : altitudeMinimum);
        }
    }

    return now(altitudeMaximum);
}

/**
 * Predicted position and altitude after `seconds`
 *
 * @function predictState
 * @param aircraft {object}
 * @param seconds {number}
 * @return {object} `{ x, y, altitude }`
 */
export function predictState(aircraft, seconds) {
    const velocity = headingVector(aircraft.groundTrack);
    const distanceNm = aircraft.groundSpeed * seconds / 3600;
    const { target, start } = verticalPlan(aircraft);
    const verticalSeconds = Math.max(0, seconds - start);
    let { altitude } = aircraft;

    if (isOnFinal(aircraft)) {
        altitude -= FINAL_DESCENT_FEET_PER_SECOND * seconds;
    } else if (Number.isFinite(target) && target > altitude) {
        altitude = Math.min(target, altitude + CLIMB_FEET_PER_SECOND * verticalSeconds);
    } else if (Number.isFinite(target) && target < altitude) {
        altitude = Math.max(target, altitude - DESCENT_FEET_PER_SECOND * verticalSeconds);
    }

    return {
        x: aircraft.x + velocity.x * distanceNm,
        y: aircraft.y + velocity.y * distanceNm,
        altitude
    };
}

/**
 * Arrivals vectored around a conflict are kept at least this far inside the airspace:
 * an arrival that leaves it is lost
 *
 * @property AIRSPACE_BOUNDARY_MARGIN_NM
 * @type {number}
 * @final
 */
const AIRSPACE_BOUNDARY_MARGIN_NM = 3;

/**
 * Whether an arrival keeping its present track comes closer than `AIRSPACE_BOUNDARY_MARGIN_NM`
 * to the edge of the airspace within `seconds` (departures leave it on purpose)
 *
 * @function isTrackLeavingAirspace
 * @param aircraft {object}
 * @param observation {object}
 * @param seconds {number}
 * @return {boolean}
 */
export function isTrackLeavingAirspace(aircraft, observation, seconds) {
    if (aircraft.category !== 'arrival') {
        return false;
    }

    const { airspace } = observation.airport;
    const now = distanceInsideAirspace(aircraft, airspace);

    for (let time = PREDICTION_STEP_SECONDS; time <= seconds; time += PREDICTION_STEP_SECONDS) {
        const inside = distanceInsideAirspace(predictState(aircraft, time), airspace);

        if (inside < AIRSPACE_BOUNDARY_MARGIN_NM && inside < now) {
            return true;
        }
    }

    return false;
}

/**
 * Whether turning the aircraft could take it below the minimum vectoring altitude: an aircraft
 * on a procedure may be lower than the terrain around its route allows for vectors
 *
 * @function isBelowTerrainAround
 * @param aircraft {object}
 * @return {boolean}
 */
const isBelowTerrainAround = (aircraft) => Number.isFinite(aircraft.minimumVectoringAltitudeAround) &&
    aircraft.altitude < aircraft.minimumVectoringAltitudeAround - VERTICAL_TOLERANCE_FT;

/**
 * What-if copy of an aircraft that has just received an action, as far as the
 * short-term prediction can tell: a new cleared altitude, or a new track
 *
 * @function applyAction
 * @param aircraft {object}
 * @param action {number}
 * @return {object}
 */
export function applyAction(aircraft, action) {
    const definition = ACTIONS[action];

    if (definition.type === ACTION_TYPE.ALTITUDE) {
        return { ...aircraft, clearance: { ...aircraft.clearance, altitude: definition.value } };
    }

    if (definition.type === ACTION_TYPE.HEADING) {
        return { ...aircraft, groundTrack: normalizeHeading(headingReference(aircraft) + definition.value) };
    }

    return aircraft;
}

/**
 * Pairs that are separated by procedure and are not checked here
 *
 * @function isExemptPair
 * @param a {object}
 * @param b {object}
 * @return {boolean}
 */
function isExemptPair(a, b) {
    // spacing on the same final is handled by the arrival sequence
    if (isOnFinal(a) && isOnFinal(b) && a.arrivalRunway === b.arrivalRunway) {
        return true;
    }

    // departures from different runways climbing out on diverging routes
    return a.category === 'departure' && b.category === 'departure' &&
        a.departureRunway !== b.departureRunway && a.distance < 10 && b.distance < 10;
}

/**
 * Margin added to the dependent parallel approach minimum
 *
 * @property PARALLEL_FINAL_BUFFER_NM
 * @type {number}
 * @final
 */
const PARALLEL_FINAL_BUFFER_NM = 0.5;

/**
 * Horizontal minimum between aircraft established on approaches to two parallel
 * runways, by the distance between the centerlines, as the realism layer checks it
 * (dependent approaches, FAA JO 7110.65 5-9-6)
 *
 * @function dependentApproachMinimumNm
 * @param firstName {string}
 * @param secondName {string}
 * @param observation {object}
 * @return {number}
 */
export function dependentApproachMinimumNm(firstName, secondName, observation) {
    const { radarNm } = observation.realism.separationMinima;
    const runways = [].concat(...observation.airport.runways);
    const first = runways.find((runway) => runway.name === firstName);
    const second = runways.find((runway) => runway.name === secondName);

    if (!first || !second || Math.abs(headingDifference(first.heading, second.heading)) > 5) {
        return radarNm;
    }

    const unit = headingVector(first.heading);
    const dx = second.threshold.x - first.threshold.x;
    const dy = second.threshold.y - first.threshold.y;
    const centerlinesFt = Math.abs(dx * unit.y - dy * unit.x) * 6076;

    if (centerlinesFt >= 2500 && centerlinesFt <= 3600) {
        return 1;
    }

    if (centerlinesFt > 3600 && centerlinesFt <= 8300) {
        return 1.5;
    }

    if (centerlinesFt > 8300 && centerlinesFt <= 9000) {
        return 2;
    }

    return radarNm;
}

/**
 * Horizontal distance checked between two aircraft, with margin
 *
 * @function pairThresholdNm
 * @param a {object}
 * @param b {object}
 * @param observation {object}
 * @param bufferNm {number}
 * @return {number}
 */
function pairThresholdNm(a, b, observation, bufferNm) {
    if (isOnFinal(a) && isOnFinal(b)) {
        return dependentApproachMinimumNm(a.arrivalRunway, b.arrivalRunway, observation) + PARALLEL_FINAL_BUFFER_NM;
    }

    return observation.realism.separationMinima.radarNm + bufferNm;
}

/**
 * Time of the first predicted loss of separation between two aircraft, or null
 *
 * @function predictLoss
 * @param a {object}
 * @param b {object}
 * @param threshold {number}   horizontal minimum with buffer, nm
 * @param verticalFt {number}
 * @param horizonSeconds {number}
 * @return {number|null}
 */
export function predictLoss(a, b, threshold, verticalFt, horizonSeconds) {
    for (let t = 0; t <= horizonSeconds; t += PREDICTION_STEP_SECONDS) {
        const stateA = predictState(a, t);
        const stateB = predictState(b, t);
        const horizontal = Math.hypot(stateA.x - stateB.x, stateA.y - stateB.y);
        const vertical = Math.abs(stateA.altitude - stateB.altitude);

        if (horizontal < threshold && vertical < verticalFt - VERTICAL_TOLERANCE_FT) {
            return t;
        }
    }

    return null;
}

/**
 * Whether `aircraft` (possibly a what-if copy) would conflict with any other aircraft
 *
 * @function hasPredictedConflict
 * @param aircraft {object}
 * @param observation {object}
 * @param parameters {object}
 * @param [isIgnoredPair] {function}  `(a, b) => boolean`, pairs separated by other means
 * @param [othersMayLevelOff] {boolean} also check the others staying at their present altitude:
 *                                      a level is only taken once it has been vacated
 * @return {boolean}
 */
export function hasPredictedConflict(aircraft, observation, parameters, isIgnoredPair = () => false,
    othersMayLevelOff = false) {
    const { elevation } = observation.airport;
    const { verticalFt } = observation.realism.separationMinima;
    const lossWith = (other) => predictLoss(
        aircraft,
        other,
        pairThresholdNm(aircraft, other, observation, parameters.conflictBufferNm),
        verticalFt,
        parameters.conflictHorizonSeconds
    ) !== null;
    const levelledOff = (other) => ({
        ...other,
        clearance: { ...other.clearance, altitudeMode: 'HOLD', altitude: other.altitude }
    });

    return observation.aircraft.some((other) => other.callsign !== aircraft.callsign && !other.isOnGround &&
        other.altitude - elevation > 800 && !isExemptPair(aircraft, other) && !isIgnoredPair(aircraft, other) &&
        (lossWith(other) || (othersMayLevelOff && !isOnFinal(other) && lossWith(levelledOff(other)))));
}

/**
 * The cleared level closest to `target` that keeps the aircraft separated from
 * everyone while it climbs or descends to it.
 *
 * A level 1000 ft from another aircraft is only safe once the transition is
 * over, so the whole climb or descent is predicted, not just the final level,
 * and a level another aircraft is leaving is only taken once it is vacated.
 *
 * @function safeLevelToward
 * @param aircraft {object}
 * @param target {number}       wanted altitude, ft
 * @param observation {object}
 * @param parameters {object}   uses `conflictBufferNm` and `conflictHorizonSeconds`
 * @return {number|null} an assignable altitude, or null when even stopping now is unsafe
 */
export function safeLevelToward(aircraft, target, observation, parameters) {
    const isDescent = target < aircraft.altitude;
    // the level the aircraft could stop at with the least change, then each level toward the target
    const stop = isDescent ?
        Math.ceil((aircraft.altitude - 300) / 1000) * 1000 :
        Math.floor((aircraft.altitude + 300) / 1000) * 1000;
    const candidates = ALTITUDES
        .filter((level) => (isDescent ? level >= target && level <= stop : level <= target && level >= stop))
        .sort((first, second) => Math.abs(first - target) - Math.abs(second - target));

    for (const level of candidates) {
        const whatIf = { ...aircraft, clearance: { ...aircraft.clearance, altitude: level } };

        if (!hasPredictedConflict(whatIf, observation, parameters, () => false, true)) {
            return level;
        }
    }

    return null;
}

/**
 * Predicted losses of separation within the horizon
 *
 * @function detectConflicts
 * @param observation {object}
 * @param parameters {object}
 * @return {array<object>} `{ a, b, time }`, earliest first
 */
export function detectConflicts(observation, parameters) {
    const { elevation } = observation.airport;
    const { verticalFt } = observation.realism.separationMinima;
    const candidates = observation.aircraft.filter((aircraft) => !aircraft.isOnGround &&
        aircraft.altitude - elevation > 800);
    const conflicts = [];

    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const a = candidates[i];
            const b = candidates[j];

            if ((!a.isControllable && !b.isControllable) || isExemptPair(a, b)) {
                continue;
            }

            const time = predictLoss(
                a,
                b,
                pairThresholdNm(a, b, observation, parameters.conflictBufferNm),
                verticalFt,
                parameters.conflictHorizonSeconds
            );

            if (time !== null) {
                conflicts.push({ a, b, time });
            }
        }
    }

    return conflicts.sort((first, second) => first.time - second.time);
}

const altitudeIndexBelow = (altitude) => {
    for (let i = ALTITUDES.length - 1; i >= 0; i--) {
        if (ALTITUDES[i] <= altitude) {
            return i;
        }
    }

    return -1;
};

const altitudeIndexAbove = (altitude) => ALTITUDES.findIndex((value) => value >= altitude);

/**
 * Stop a climb or descent that leads into the other aircraft's level
 */
function stopVerticalMovement(mover, other, minimumAltitude) {
    const target = mover.clearance.altitude;

    if (!Number.isFinite(target)) {
        return null;
    }

    if (target - mover.altitude > 300 && other.altitude > mover.altitude - 300 && target > other.altitude - 1000) {
        const index = altitudeIndexBelow(other.altitude - 1000);

        if (index >= 0 && ALTITUDES[index] >= minimumAltitude && ALTITUDES[index] >= mover.altitude - 300) {
            return ACTION_INDEX.ALTITUDE + index;
        }
    }

    if (mover.altitude - target > 300 && other.altitude < mover.altitude + 300 && target < other.altitude + 1000) {
        const index = altitudeIndexAbove(other.altitude + 1000);

        if (index >= 0 && ALTITUDES[index] <= mover.altitude + 300) {
            return ACTION_INDEX.ALTITUDE + index;
        }
    }

    return null;
}

/**
 * Move a level aircraft 1000 ft away from the other one
 */
function changeLevel(mover, other, minimumAltitude) {
    if (mover.altitude >= other.altitude) {
        const index = altitudeIndexAbove(other.altitude + 1000);

        if (index >= 0 && ALTITUDES[index] <= (mover.ceiling || Infinity)) {
            return ACTION_INDEX.ALTITUDE + index;
        }

        return null;
    }

    const index = altitudeIndexBelow(other.altitude - 1000);

    return index >= 0 && ALTITUDES[index] >= minimumAltitude ? ACTION_INDEX.ALTITUDE + index : null;
}

const headingChangeAction = (change) => ACTION_INDEX.HEADING + HEADING_CHANGES.reduce(
    (best, value, i) => (Math.abs(value - change) < Math.abs(HEADING_CHANGES[best] - change) ? i : best),
    0
);

/**
 * Turn away from the other aircraft
 */
function turnAway(mover, other, turnDegrees) {
    const relativeBearing = headingDifference(mover.heading, bearing(mover, other));

    return headingChangeAction(relativeBearing > 0 ? -turnDegrees : turnDegrees);
}

const canManeuver = (aircraft) => aircraft.isControllable && !isOnFinal(aircraft) && aircraft.flightPhase !== 'TAKEOFF';

/**
 * Candidate resolutions, least disruptive first
 */
function resolutionCandidates(a, b, minimumAltitude, parameters) {
    // the aircraft changing altitude is usually the one to stop; departures before arrivals
    const order = [a, b].sort((first, second) => {
        const movement = (aircraft) => Math.abs(aircraft.clearance.altitude - aircraft.altitude);

        return movement(second) - movement(first);
    }).filter(canManeuver);
    const candidates = [];
    const push = (mover, action, kind) => {
        if (action !== null) {
            candidates.push({
                mover, other: mover === a ? b : a, action, kind
            });
        }
    };

    order.forEach((mover) => push(mover, stopVerticalMovement(mover, mover === a ? b : a, minimumAltitude(mover)), 'vertical'));
    order.filter((mover) => mover.category !== 'departure')
        .forEach((mover) => push(mover, changeLevel(mover, mover === a ? b : a, minimumAltitude(mover)), 'vertical'));
    order.forEach((mover) => {
        const other = mover === a ? b : a;
        const away = turnAway(mover, other, parameters.resolutionTurnDegrees);
        const awayChange = ACTIONS[away].value;

        push(mover, away, 'lateral');
        push(mover, headingChangeAction(Math.sign(awayChange) * Math.max(Math.abs(awayChange), 60)), 'lateral');
        push(mover, headingChangeAction(-awayChange), 'lateral');
    });

    return candidates;
}

/**
 * Least disruptive resolution of a conflict that is predicted to work.
 *
 * Each candidate is checked with the short-term prediction: it must keep the pair
 * separated and, when the observation is given, not create a conflict with anyone
 * else. If none does, the one that delays the loss the most is chosen. Turns that
 * would take an arrival out of the airspace, or an aircraft over higher terrain, are
 * never chosen.
 *
 * @function chooseResolution
 * @param conflict {object}
 * @param minimumAltitude {function}  `(aircraft) => ft`
 * @param parameters {object}
 * @param [observation] {object}
 * @return {object|null} `{ callsign, action, kind }`, kind is `vertical` or `lateral`
 */
export function chooseResolution(conflict, minimumAltitude, parameters, observation = null) {
    const { a, b } = conflict;
    const verticalFt = observation ? observation.realism.separationMinima.verticalFt : 1000;
    const threshold = observation ? pairThresholdNm(a, b, observation, parameters.conflictBufferNm) :
        3 + parameters.conflictBufferNm;
    const candidates = resolutionCandidates(a, b, minimumAltitude, parameters);
    let fallback = null;
    let fallbackTime = -Infinity;

    for (const candidate of candidates) {
        const whatIf = applyAction(candidate.mover, candidate.action);

        if (candidate.kind === 'lateral' && (isBelowTerrainAround(candidate.mover) ||
            (observation && isTrackLeavingAirspace(whatIf, observation, parameters.conflictHorizonSeconds)))) {
            continue;
        }

        const lossTime = predictLoss(whatIf, candidate.other, threshold, verticalFt, parameters.conflictHorizonSeconds);
        const resolution = { callsign: candidate.mover.callsign, action: candidate.action, kind: candidate.kind };

        if (lossTime === null && (!observation || !hasPredictedConflict(
            whatIf,
            observation,
            parameters,
            (first, second) => second.callsign === candidate.other.callsign,
            true
        ))) {
            return resolution;
        }

        const time = lossTime === null ? parameters.conflictHorizonSeconds : lossTime;

        if (time > fallbackTime) {
            fallback = resolution;
            fallbackTime = time;
        }
    }

    return fallback;
}

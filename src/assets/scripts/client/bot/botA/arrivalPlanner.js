import { distance, headingVector, trueAirspeedFactor } from '../botGeometry';

/**
 * Arrival trajectory model of Bot A: flight modes, path to the threshold and
 * time estimates under different speed plans.
 */

/**
 * @property ARRIVAL_MODE
 * @type {object}
 * @final
 */
export const ARRIVAL_MODE = {
    // following its STAR or transition (LNAV)
    ROUTE: 'ROUTE',
    // on headings: radar vectors, or the vector leg at the end of a transition
    VECTOR: 'VECTOR',
    // established on the approach
    FINAL: 'FINAL'
};

const DEG = Math.PI / 180;
const PATH_STEP_NM = 1;

/**
 * Distance flown on the localizer before capturing the glidepath
 *
 * @property GLIDEPATH_CAPTURE_MARGIN_NM
 * @type {number}
 * @final
 */
const GLIDEPATH_CAPTURE_MARGIN_NM = 2;

/**
 * @function classifyArrival
 * @param aircraft {object}
 * @return {string} one of `ARRIVAL_MODE`
 */
export function classifyArrival(aircraft) {
    // the engine keeps the APPROACH phase after the clearance is cancelled, so check both
    if ((aircraft.flightPhase === 'APPROACH' || aircraft.flightPhase === 'LANDING') && aircraft.hasApproachClearance) {
        return ARRIVAL_MODE.FINAL;
    }

    const hasFixAhead = (aircraft.waypoints || []).some((waypoint) => waypoint.x !== null);

    if (aircraft.clearance.headingMode === 'LNAV' && hasFixAhead) {
        return ARRIVAL_MODE.ROUTE;
    }

    return ARRIVAL_MODE.VECTOR;
}

/**
 * Geometry of the standard pattern to join the final approach
 *
 * @function patternGeometry
 * @param frame {FinalApproachFrame}
 * @param parameters {object}
 * @param minimumAltitude {number}
 * @return {object} `{ interceptAlong, interceptLateral, baseTurnAlong, interceptAltitude, downwindAltitude,
 *                   minimumJoinAlong }`
 */
export function patternGeometry(frame, parameters, minimumAltitude) {
    const cotangent = 1 / Math.tan(parameters.interceptAngle * DEG);
    // join the localizer at least 600 ft below the glidepath, and never below the minimum altitude
    const interceptAltitude = Math.max(
        Math.ceil(minimumAltitude / 1000) * 1000,
        Math.floor((frame.glidepathAltitude(parameters.interceptDistanceNm) - 600) / 1000) * 1000
    );
    // ... with 2 nm on the localizer before the glidepath is captured
    const interceptAlong = Math.max(
        parameters.interceptDistanceNm,
        (interceptAltitude - frame.elevation) / 318 + GLIDEPATH_CAPTURE_MARGIN_NM
    );

    // the closest join: level at the minimum altitude, still 2 nm before the glidepath
    const minimumJoinAlong = Math.min(interceptAlong, Math.max(
        parameters.minimumJoinDistanceNm,
        (Math.ceil(minimumAltitude / 1000) * 1000 - frame.elevation) / 318 + GLIDEPATH_CAPTURE_MARGIN_NM
    ));

    return {
        interceptAlong,
        interceptLateral: parameters.interceptLateralNm,
        baseTurnAlong: interceptAlong + parameters.interceptLateralNm * cotangent,
        interceptAltitude,
        downwindAltitude: interceptAltitude + 1000,
        minimumJoinAlong
    };
}

/**
 * The pattern of `pattern` moved so the aircraft joins the localizer `joinAlong` nm from the
 * threshold. Further out it joins at the same altitude, level for longer below the glidepath;
 * closer in it joins lower, so the glidepath is still captured from below.
 *
 * @function joinPattern
 * @param pattern {object}  from `patternGeometry()`
 * @param frame {FinalApproachFrame}
 * @param joinAlong {number}
 * @return {object} same shape as `patternGeometry()`
 */
export function joinPattern(pattern, frame, joinAlong) {
    const interceptAltitude = Math.min(
        pattern.interceptAltitude,
        Math.floor(frame.glidepathAltitude(joinAlong - GLIDEPATH_CAPTURE_MARGIN_NM) / 1000) * 1000
    );

    return {
        ...pattern,
        interceptAlong: joinAlong,
        baseTurnAlong: joinAlong + (pattern.baseTurnAlong - pattern.interceptAlong),
        interceptAltitude,
        downwindAltitude: Math.min(pattern.downwindAltitude, interceptAltitude + 1000)
    };
}

/**
 * Points from `start`, flying `heading`, to the threshold through the pattern
 *
 * @function completePattern
 * @param start {object}
 * @param heading {number}
 * @param frame {FinalApproachFrame}
 * @param pattern {object}
 * @param extraDownwindNm {number}
 * @param [isJoinFixed] {boolean}  join exactly at `pattern.interceptAlong`, even when the
 *                                 aircraft is further out: it then flies inbound to the base turn
 * @return {array<object>}
 */
export function completePattern(start, heading, frame, pattern, extraDownwindNm, isJoinFixed = false) {
    const along = frame.along(start);
    const lateral = frame.lateral(start);
    const side = lateral >= 0 ? 1 : -1;
    const unit = headingVector(heading);
    const outward = frame.point(1, 0);
    const alongRate = unit.x * (outward.x - frame.threshold.x) + unit.y * (outward.y - frame.threshold.y);
    const right = frame.point(0, 1);
    const lateralRate = unit.x * (right.x - frame.threshold.x) + unit.y * (right.y - frame.threshold.y);
    const isClosing = lateralRate * lateral < 0 && Math.abs(lateral) > 0.3;
    const points = [];
    let baseAlong;

    if (isJoinFixed && along > pattern.baseTurnAlong + 1 && Math.abs(lateral) > pattern.interceptLateral + 0.5) {
        // further out than the base turn: inbound to it, cutting the corner
        baseAlong = pattern.baseTurnAlong;
        points.push(frame.point(baseAlong, side * (pattern.interceptLateral + 1)));
    } else if (isClosing && along >= pattern.baseTurnAlong - 1 && extraDownwindNm <= 0) {
        // already on base: join the centerline from here
        baseAlong = along;
    } else {
        baseAlong = Math.max(along, pattern.baseTurnAlong) + Math.max(0, extraDownwindNm);

        if (alongRate < 0 && along < pattern.baseTurnAlong) {
            // flying toward the runway too close in: a turn to downwind is needed first
            points.push(frame.point(along, side * Math.max(Math.abs(lateral), pattern.interceptLateral + 2)));
        }

        points.push(frame.point(baseAlong, side * Math.max(Math.abs(lateral), pattern.interceptLateral + 1)));
    }

    // the intercept leg always covers the same distance along the final
    const interceptAlong = baseAlong - (pattern.baseTurnAlong - pattern.interceptAlong);

    points.push(frame.point(baseAlong, side * pattern.interceptLateral));
    points.push(frame.point(interceptAlong, 0));
    points.push(frame.threshold);

    return points;
}

/**
 * Remaining path of an arrival, as a list of points ending at the threshold
 *
 * @function buildArrivalPath
 * @param aircraft {object}
 * @param frame {FinalApproachFrame}
 * @param pattern {object}       from `patternGeometry()`
 * @param [extraDownwindNm] {number}
 * @param [isJoinFixed] {boolean}   see `completePattern()`
 * @return {array<object>}
 */
export function buildArrivalPath(aircraft, frame, pattern, extraDownwindNm = 0, isJoinFixed = false) {
    const mode = classifyArrival(aircraft);
    const points = [{ x: aircraft.x, y: aircraft.y }];

    if (mode === ARRIVAL_MODE.FINAL) {
        points.push(frame.threshold);

        return points;
    }

    let { heading } = aircraft;

    if (mode === ARRIVAL_MODE.ROUTE) {
        for (let i = 0; i < aircraft.waypoints.length; i++) {
            const waypoint = aircraft.waypoints[i];

            if (waypoint.x === null) {
                heading = waypoint.vectorHeading === null ? heading : waypoint.vectorHeading;

                break;
            }

            const previous = points[points.length - 1];

            if (distance(previous, waypoint) > 0.01) {
                heading = Math.atan2(waypoint.x - previous.x, waypoint.y - previous.y) / DEG;
                points.push({ x: waypoint.x, y: waypoint.y });
            }
        }
    }

    return points.concat(completePattern(points[points.length - 1], heading, frame, pattern, extraDownwindNm, isJoinFixed));
}

/**
 * Indicated airspeed planned at `remainingNm` from the threshold
 *
 * @function plannedSpeed
 * @param remainingNm {number}
 * @param altitude {number}
 * @param parameters {object}
 * @param slowFraction {number}  0 nominal, 1 slowest
 * @param [speedLimits] {object}
 * @return {number}
 */
export function plannedSpeed(remainingNm, altitude, parameters, slowFraction, speedLimits = null) {
    let nominal = parameters.finalSpeed;

    if (remainingNm > 30) {
        nominal = altitude > 10000 ? parameters.cruiseSpeed : parameters.arrivalSpeed;
    } else if (remainingNm > 15) {
        nominal = parameters.intermediateSpeed;
    } else if (remainingNm > 6) {
        nominal = parameters.baseSpeed;
    }

    if (remainingNm <= 6) {
        return nominal;
    }

    const reduced = nominal * (1 - slowFraction * (1 - parameters.minimumSpeedReduction));
    const minimum = Math.max(parameters.finalSpeed, speedLimits ? speedLimits.min + 25 : 0);

    return Math.max(reduced, minimum);
}

/**
 * Altitude of a continuous descent at `descentGradientFtPerNm` that reaches the intercept altitude
 * where the aircraft joins the final approach, `remainingNm` before the runway along the planned
 * path, rounded up to the next thousand feet. Clearing an arrival down to it every time it drops
 * by 1000 ft gives a progressive descent that ends at the intercept altitude, below the glidepath,
 * instead of one long step down.
 *
 * @function profileAltitude
 * @param remainingNm {number}
 * @param pattern {object} see `patternGeometry`
 * @param parameters {object}
 * @return {number} ft
 */
export function profileAltitude(remainingNm, pattern, parameters) {
    const beforeIntercept = Math.max(0, remainingNm - pattern.interceptAlong);

    return Math.ceil((pattern.interceptAltitude + beforeIntercept * parameters.descentGradientFtPerNm) / 1000) * 1000;
}

/**
 * Length of a path
 *
 * @function pathLength
 * @param points {array<object>}
 * @return {number}
 */
export const pathLength = (points) => points.reduce(
    (total, point, i) => (i === 0 ? 0 : total + distance(points[i - 1], point)),
    0
);

/**
 * Time to fly a path under a speed plan, in seconds
 *
 * @function timeAlongPath
 * @param points {array<object>}
 * @param aircraft {object}
 * @param frame {FinalApproachFrame}
 * @param parameters {object}
 * @param slowFraction {number}
 * @param [remainingAfterNm] {number}  distance left to the threshold after the end of `points`
 * @return {number}
 */
export function timeAlongPath(points, aircraft, frame, parameters, slowFraction, remainingAfterNm = 0) {
    const total = pathLength(points);
    let time = 0;

    for (let flown = 0; flown < total; flown += PATH_STEP_NM) {
        const step = Math.min(PATH_STEP_NM, total - flown);
        const remaining = total - flown - step / 2 + remainingAfterNm;
        const altitude = Math.min(aircraft.altitude, frame.elevation + remaining * parameters.descentGradientFtPerNm);
        const speed = plannedSpeed(remaining, altitude, parameters, slowFraction, aircraft.speedLimits);

        time += step / (speed * trueAirspeedFactor(altitude)) * 3600;
    }

    return time;
}

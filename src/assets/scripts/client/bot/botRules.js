import {
    FinalApproachFrame, bearing, distance, headingDifference, headingVector
} from './botGeometry';
import {
    LANDING_RUNWAY_OCCUPANCY_SECONDS,
    getArrivalWakeSeparationNm,
    getDepartureWakeSeparationSeconds
} from '../realism/wakeTurbulence';

/**
 * Operational rules evaluated on observations. Bot A plans with them and the
 * safety shield uses them to forbid unsafe actions to any bot.
 */

/**
 * Tunable margins of the rules
 *
 * @property DEFAULT_RULE_MARGINS
 * @type {object}
 * @final
 */
export const DEFAULT_RULE_MARGINS = {
    // time a departure needs from brake release until it is airborne past the runway end
    departureRunwayOccupancySeconds: 60,
    // extra time before an arrival reaches the threshold
    arrivalDepartureMarginSeconds: 20,
    // minimum time between departures following the same route, and diverging routes
    sameRouteDepartureSeconds: 120,
    divergingDepartureSeconds: 60,
    // added to the larger of the wake and radar minima on final
    finalSpacingBufferNm: 0.7,
    // added to the runway occupancy time of the preceding landing
    landingOccupancyBufferSeconds: 15,
    // clearance kept above the minimum vectoring altitude
    minimumAltitudeBufferFt: 0,
    // departures from parallel runways on the same initial track
    parallelDepartureSeconds: 60,
    // added to the same-route interval when the follower is faster and would catch up
    fasterFollowerSeconds: 60
};

/**
 * Divergence of the initial tracks that makes one minute enough between two departures from
 * the same runway (ICAO Doc 4444 5.8.2 b): 45 degrees "immediately after take-off"; less than
 * that, they are on the same route as far as the interval is concerned
 *
 * @property SAME_RUNWAY_DIVERGENCE_DEGREES
 * @type {number}
 * @final
 */
export const SAME_RUNWAY_DIVERGENCE_DEGREES = 45;

/**
 * A follower whose maximum speed is this much higher than the leader's catches it up
 * on the same initial track (ICAO Doc 4444 5.6.2.1 uses 40 kt for 3 minutes)
 *
 * @property FASTER_FOLLOWER_KT
 * @type {number}
 * @final
 */
const FASTER_FOLLOWER_KT = 30;

/**
 * Parallel runways closer than this share wake turbulence (2500 ft)
 *
 * @property DEPENDENT_RUNWAY_NM
 * @type {number}
 * @final
 */
const DEPENDENT_RUNWAY_NM = 0.41;

/**
 * Kept above the floor of the controlled airspace, so altimetry noise or a slight
 * overshoot during level-off does not take the aircraft out of it
 *
 * @property AIRSPACE_FLOOR_MARGIN_FT
 * @type {number}
 * @final
 */
const AIRSPACE_FLOOR_MARGIN_FT = 500;

/**
 * Aircraft-type-like object for the wake turbulence tables
 *
 * @function wakeType
 * @param aircraft {object}
 * @return {object}
 */
export const wakeType = (aircraft) => ({
    weightClass: aircraft.weightClass,
    category: { recatEu: aircraft.recatEu, wakeFaa: aircraft.wakeFaa }
});

/**
 * Runway ends of the airport by name, with the physical runway each belongs to
 *
 * @class RunwayIndex
 */
export class RunwayIndex {
    /**
     * @constructor
     * @param airport {object}  `observation.airport`
     */
    constructor(airport) {
        this.runways = {};
        this.physicalName = {};
        this.frames = {};

        airport.runways.forEach(([first, second]) => {
            const physicalName = `${first.name}/${second.name}`;

            [first, second].forEach((runway) => {
                this.runways[runway.name] = runway;
                this.physicalName[runway.name] = physicalName;
                this.frames[runway.name] = new FinalApproachFrame(runway);
            });
        });
    }

    /**
     * Runway ends facing the same direction within 10 degrees
     *
     * @for RunwayIndex
     * @method areParallel
     * @param nameA {string}
     * @param nameB {string}
     * @return {boolean}
     */
    areParallel(nameA, nameB) {
        const a = this.runways[nameA];
        const b = this.runways[nameB];

        return Boolean(a && b) && Math.abs(headingDifference(a.heading, b.heading)) < 10;
    }

    /**
     * Same runway, or parallel runways less than 2500 ft apart
     *
     * @for RunwayIndex
     * @method areDependent
     * @param nameA {string}
     * @param nameB {string}
     * @return {boolean}
     */
    areDependent(nameA, nameB) {
        if (!nameA || !nameB || !this.runways[nameA] || !this.runways[nameB]) {
            return false;
        }

        if (this.physicalName[nameA] === this.physicalName[nameB]) {
            return true;
        }

        const a = this.runways[nameA];
        const b = this.runways[nameB];

        return Math.abs(headingDifference(a.heading, b.heading)) < 10 &&
            Math.abs(this.frames[nameA].lateral(b.threshold)) < DEPENDENT_RUNWAY_NM;
    }
}

/**
 * Seconds a landing aircraft of this type occupies the runway (upper estimate)
 *
 * @function landingOccupancySeconds
 * @param aircraft {object}
 * @return {number}
 */
export const landingOccupancySeconds = (aircraft) => (LANDING_RUNWAY_OCCUPANCY_SECONDS[aircraft.recatEu] || 55) * 1.2;

/**
 * Required distance between a leader and a follower on the same final
 *
 * @function finalSpacingNm
 * @param leader {object}
 * @param follower {object}
 * @param observation {object}
 * @param margins {object}
 * @return {number}
 */
export function finalSpacingNm(leader, follower, observation, margins = DEFAULT_RULE_MARGINS) {
    const { wakeScheme, separationMinima } = observation.realism;
    const wake = getArrivalWakeSeparationNm(wakeType(leader), wakeType(follower), wakeScheme);

    return Math.max(wake, separationMinima.finalApproachNm) + margins.finalSpacingBufferNm;
}

/**
 * Minimum time between two landings on the same runway, in seconds
 *
 * @function landingIntervalSeconds
 * @param leader {object}
 * @param follower {object}
 * @param observation {object}
 * @param margins {object}
 * @return {number}
 */
export function landingIntervalSeconds(leader, follower, observation, margins = DEFAULT_RULE_MARGINS) {
    const approachSpeed = Math.max(120, (follower.speedLimits ? follower.speedLimits.landing : 140) + 10);
    const spacingTime = finalSpacingNm(leader, follower, observation, margins) / approachSpeed * 3600;
    const occupancyTime = landingOccupancySeconds(leader) + margins.landingOccupancyBufferSeconds;

    return Math.max(spacingTime, occupancyTime);
}

/**
 * Lowest altitude that keeps an aircraft inside the controlled airspace, here and on the
 * track ahead: below the floor of the sector it leaves the airspace (and the game)
 *
 * @function airspaceMinimumAltitude
 * @param aircraft {object}
 * @return {number} ft, 0 where the airspace reaches the ground
 */
export function airspaceMinimumAltitude(aircraft) {
    const floor = Math.max(aircraft.airspaceFloor || 0, aircraft.airspaceFloorAhead || 0);

    return floor > 0 ? Math.ceil((floor + AIRSPACE_FLOOR_MARGIN_FT) / 1000) * 1000 : 0;
}

/**
 * Highest altitude that keeps an arrival inside the controlled airspace, here and on the track
 * ahead: above the ceiling it leaves the airspace (and the game). Departures may climb out of it.
 *
 * @function airspaceMaximumAltitude
 * @param aircraft {object}
 * @return {number} ft, Infinity when unknown or for departures
 */
export function airspaceMaximumAltitude(aircraft) {
    const ceilings = [aircraft.airspaceCeiling, aircraft.airspaceCeilingAhead].filter((value) => Number.isFinite(value));

    if (aircraft.category === 'departure' || ceilings.length === 0) {
        return Infinity;
    }

    return Math.floor((Math.min(...ceilings) - AIRSPACE_FLOOR_MARGIN_FT) / 1000) * 1000;
}

/**
 * Lowest altitude that may be assigned to an airborne aircraft
 *
 * @function minimumAssignableAltitude
 * @param aircraft {object}
 * @param observation {object}
 * @param margins {object}
 * @return {number} ft
 */
export function minimumAssignableAltitude(aircraft, observation, margins = DEFAULT_RULE_MARGINS) {
    // where the aircraft is and where it will be in the next two minutes
    const terrainMinimum = Math.max(aircraft.minimumVectoringAltitude || 0, aircraft.minimumVectoringAltitudeAhead || 0);
    const airportMinimum = Math.ceil((observation.airport.elevation + 1500) / 1000) * 1000;

    return Math.max(terrainMinimum, airportMinimum, airspaceMinimumAltitude(aircraft)) + margins.minimumAltitudeBufferFt;
}

const firstRouteFix = (aircraft) => {
    const parts = (aircraft.route || '').split('.');

    return parts.length > 2 ? parts[2] : parts[parts.length - 1];
};

/**
 * Closest airborne arrival on approach to a physical runway
 *
 * @function findNextArrival
 * @param physicalName {string}
 * @param observation {object}
 * @param runwayIndex {RunwayIndex}
 * @return {object|null} `{ aircraft, distanceToThreshold, groundSpeed }`
 */
export function findNextArrival(physicalName, observation, runwayIndex) {
    let next = null;

    observation.aircraft.forEach((aircraft) => {
        const runway = runwayIndex.runways[aircraft.arrivalRunway];

        if (aircraft.category !== 'arrival' || aircraft.isOnGround || !runway ||
            runwayIndex.physicalName[runway.name] !== physicalName) {
            return;
        }

        const frame = runwayIndex.frames[runway.name];
        const isLinedUp = frame.along(aircraft) > 0 && Math.abs(frame.lateral(aircraft)) < 1.5 &&
            Math.abs(headingDifference(aircraft.heading, runway.heading)) < 45;

        if (!(aircraft.hasApproachClearance || aircraft.flightPhase === 'LANDING' || isLinedUp)) {
            return;
        }

        const distanceToThreshold = distance(aircraft, runway.threshold);

        if (!next || distanceToThreshold < next.distanceToThreshold) {
            next = { aircraft, distanceToThreshold, groundSpeed: Math.max(aircraft.groundSpeed, 120) };
        }
    });

    return next;
}

/**
 * Whether a departure may enter the runway: nobody else on it and no arrival too close to land.
 * `extraSeconds` asks for more room, for an aircraft that will wait on the runway.
 *
 * @function checkRunwayEntry
 * @param departure {object}
 * @param observation {object}
 * @param runwayIndex {RunwayIndex}
 * @param [margins] {object}
 * @param [extraSeconds] {number}
 * @return {object} `{ ok, reason }`
 */
export function checkRunwayEntry(departure, observation, runwayIndex, margins = DEFAULT_RULE_MARGINS, extraSeconds = 0) {
    const runwayName = departure.departureRunway || observation.airport.departureRunway;
    const physicalName = runwayIndex.physicalName[runwayName];
    const { realism } = observation;
    const occupied = realism.runwayOccupancy.find((runway) => runway.runway === physicalName);

    if (occupied && occupied.occupants.some((occupant) => occupant.callsign !== departure.callsign)) {
        return { ok: false, reason: 'runway occupied' };
    }

    const arrival = findNextArrival(physicalName, observation, runwayIndex);

    if (arrival) {
        const seconds = margins.departureRunwayOccupancySeconds + margins.arrivalDepartureMarginSeconds + extraSeconds;
        const minimumNm = Math.max(realism.separationMinima.arrivalDepartureNm, arrival.groundSpeed * seconds / 3600);

        if (arrival.distanceToThreshold < minimumNm) {
            return { ok: false, reason: `arrival ${arrival.aircraft.callsign} too close` };
        }
    }

    return { ok: true, reason: '' };
}

/**
 * Whether the first fixes of two departures' routes diverge by at least `minimumDegrees` (15 degrees
 * for simultaneous departures from parallel runways, ICAO Doc 4444 6.7.3.2.3). From parallel
 * runways they must also move apart: the departure from the left runway has to turn left of the
 * other one, otherwise their tracks cross.
 *
 * @function areDivergingDepartures
 * @param first {object}
 * @param second {object}
 * @param runwayIndex {RunwayIndex}
 * @param observation {object}
 * @param [minimumDegrees] {number}
 * @return {boolean}
 */
export function areDivergingDepartures(first, second, runwayIndex, observation, minimumDegrees = 15) {
    const initialTrack = (aircraft) => {
        const runway = runwayIndex.runways[aircraft.departureRunway || observation.airport.departureRunway];
        const fix = (aircraft.waypoints || []).find((waypoint) => waypoint.x !== null);

        return runway && fix ? bearing(runway.threshold, fix) : null;
    };
    const firstTrack = initialTrack(first);
    const secondTrack = initialTrack(second);

    if (firstTrack === null || secondTrack === null) {
        return false;
    }

    // signed: positive when the second turns right of the first
    const divergence = headingDifference(firstTrack, secondTrack);

    if (Math.abs(divergence) < minimumDegrees) {
        return false;
    }

    const firstRunway = runwayIndex.runways[first.departureRunway || observation.airport.departureRunway];
    const secondRunway = runwayIndex.runways[second.departureRunway || observation.airport.departureRunway];

    if (!firstRunway || !secondRunway || firstRunway === secondRunway) {
        return true;
    }

    // which side of the first runway the second one is on, looking along the departure direction
    const along = headingVector(firstRunway.heading);
    const offset = {
        x: secondRunway.threshold.x - firstRunway.threshold.x,
        y: secondRunway.threshold.y - firstRunway.threshold.y
    };
    const secondIsRight = along.y * offset.x - along.x * offset.y > 0;

    return secondIsRight ? divergence > 0 : divergence < 0;
}

/**
 * Whether `departure`, holding short of its runway, can start its takeoff roll now
 *
 * @function checkTakeoff
 * @param departure {object}
 * @param observation {object}
 * @param runwayIndex {RunwayIndex}
 * @param margins {object}
 * @return {object} `{ ok, reason }`
 */
export function checkTakeoff(departure, observation, runwayIndex, margins = DEFAULT_RULE_MARGINS) {
    const runwayCheck = checkRunwayEntry(departure, observation, runwayIndex, margins);

    if (!runwayCheck.ok) {
        return runwayCheck;
    }

    const runwayName = departure.departureRunway || observation.airport.departureRunway;
    const physicalName = runwayIndex.physicalName[runwayName];
    const { realism } = observation;

    for (let i = 0; i < realism.lastTakeoffs.length; i++) {
        const { runway, callsign, secondsAgo } = realism.lastTakeoffs[i];
        const leader = observation.aircraft.find((aircraft) => aircraft.callsign === callsign);
        const leaderRunway = leader ? leader.departureRunway : null;

        if (!leader || !runwayIndex.runways[leaderRunway]) {
            continue;
        }

        // simultaneous departures from independent parallel runways need diverging initial tracks
        if (!runwayIndex.areDependent(runwayName, leaderRunway)) {
            if (runwayIndex.areParallel(runwayName, leaderRunway) && secondsAgo < margins.parallelDepartureSeconds &&
                !areDivergingDepartures(leader, departure, runwayIndex, observation)) {
                return { ok: false, reason: `same initial track as ${callsign} from ${leaderRunway}` };
            }

            continue;
        }

        const wakeSeconds = getDepartureWakeSeparationSeconds(wakeType(leader), wakeType(departure), realism.wakeScheme);
        // one minute only when the tracks diverge by 45 degrees right after takeoff, two otherwise
        const isDiverging = firstRouteFix(leader) !== firstRouteFix(departure) &&
            areDivergingDepartures(leader, departure, runwayIndex, observation, SAME_RUNWAY_DIVERGENCE_DEGREES);
        const isFaster = (departure.speedLimits ? departure.speedLimits.max : 0) >=
            (leader.speedLimits ? leader.speedLimits.max : 0) + FASTER_FOLLOWER_KT;
        let routeSeconds = 0;

        if (runway === physicalName) {
            routeSeconds = isDiverging ?
                margins.divergingDepartureSeconds :
                margins.sameRouteDepartureSeconds + (isFaster ? margins.fasterFollowerSeconds : 0);
        }

        if (secondsAgo < Math.max(wakeSeconds, routeSeconds)) {
            return { ok: false, reason: `spacing behind ${callsign}` };
        }
    }

    return { ok: true, reason: '' };
}

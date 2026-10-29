import { ACTION_COUNT } from '../actionSpace';
import { minimumAssignableAltitude } from '../botRules';
import { distanceInsideAirspace, headingDifference } from '../botGeometry';

/**
 * Fixed-size numeric encoding of an observation, used as the input of Bot B's
 * neural network. It runs in JavaScript so that training (through the headless
 * simulator) and the browser use exactly the same features.
 *
 * Each aircraft is a token of `FEATURE_COUNT` numbers. Up to `MAX_AIRCRAFT`
 * tokens are kept: aircraft under control first, nearest first.
 */

/**
 * Version of the encoding; a model only works with the version it was trained on
 *
 * @property FEATURE_VERSION
 * @type {number}
 * @final
 */
export const FEATURE_VERSION = 2;

/**
 * @property MAX_AIRCRAFT
 * @type {number}
 * @final
 */
export const MAX_AIRCRAFT = 48;

const CATEGORIES = ['arrival', 'departure', 'overflight'];
const PHASES = ['APRON', 'TAXI', 'WAITING', 'TAKEOFF', 'CLIMB', 'CRUISE', 'DESCENT', 'APPROACH', 'LANDING'];
const WAKE_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Names of the features of an aircraft token, in order
 *
 * @property FEATURE_NAMES
 * @type {array<string>}
 * @final
 */
export const FEATURE_NAMES = [
    ...CATEGORIES.map((category) => `category_${category}`),
    ...PHASES.map((phase) => `phase_${phase}`),
    'controllable', 'on_ground',
    'x', 'y', 'altitude', 'heading_sin', 'heading_cos', 'speed', 'ground_speed',
    'cleared_altitude', 'heading_mode_hold', 'heading_mode_lnav', 'cleared_speed',
    'approach_clearance', 'departure_clearance', 'hold_assigned',
    ...WAKE_CATEGORIES.map((category) => `wake_${category}`),
    'minimum_vectoring_altitude', 'minimum_assignable_altitude',
    'runway_along', 'runway_lateral', 'runway_relative_heading_sin', 'runway_relative_heading_cos',
    'runway_distance', 'taxi_remaining', 'vertical_trend',
    'has_next_fix', 'next_fix_dx', 'next_fix_dy',
    'conflict', 'runway_occupied', 'runway_last_takeoff', 'inside_airspace'
];

/**
 * @property FEATURE_COUNT
 * @type {number}
 * @final
 */
export const FEATURE_COUNT = FEATURE_NAMES.length;

/**
 * Names of the global features
 *
 * @property GLOBAL_FEATURE_NAMES
 * @type {array<string>}
 * @final
 */
export const GLOBAL_FEATURE_NAMES = ['wind_x', 'wind_y', 'aircraft_count', 'controllable_count', 'time'];

/**
 * @property GLOBAL_FEATURE_COUNT
 * @type {number}
 * @final
 */
export const GLOBAL_FEATURE_COUNT = GLOBAL_FEATURE_NAMES.length;

const clip = (value, limit = 5) => (Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0);
const oneHot = (values, value) => values.map((candidate) => (candidate === value ? 1 : 0));
const DEG = Math.PI / 180;

/**
 * Order in which aircraft are encoded
 *
 * @function orderAircraft
 * @param observation {object}
 * @return {array<object>} at most `MAX_AIRCRAFT` aircraft
 */
export function orderAircraft(observation) {
    return observation.aircraft
        .slice()
        .sort((a, b) => {
            if (a.isControllable !== b.isControllable) {
                return a.isControllable ? -1 : 1;
            }

            return a.distance - b.distance;
        })
        .slice(0, MAX_AIRCRAFT);
}

/**
 * Features of one aircraft
 *
 * @function encodeAircraft
 * @param aircraft {object}
 * @param observation {object}
 * @param runwayIndex {RunwayIndex}
 * @return {array<number>} `FEATURE_COUNT` numbers
 */
export function encodeAircraft(aircraft, observation, runwayIndex) {
    const { realism } = observation;
    const runwayName = aircraft.category === 'departure' ?
        aircraft.departureRunway || observation.airport.departureRunway :
        aircraft.arrivalRunway || observation.airport.arrivalRunway;
    const frame = runwayIndex.frames[runwayName];
    const physicalName = runwayIndex.physicalName[runwayName];
    const nextFix = (aircraft.waypoints || []).find((waypoint) => waypoint.x !== null);
    const relativeHeading = frame ? headingDifference(frame.course, aircraft.heading) * DEG : 0;
    const occupancy = realism.runwayOccupancy.find((runway) => runway.runway === physicalName);
    const lastTakeoff = realism.lastTakeoffs.find((takeoff) => takeoff.runway === physicalName);
    const { clearance } = aircraft;

    return [
        ...oneHot(CATEGORIES, aircraft.category),
        ...oneHot(PHASES, aircraft.flightPhase),
        aircraft.isControllable ? 1 : 0,
        aircraft.isOnGround ? 1 : 0,
        clip(aircraft.x / 50),
        clip(aircraft.y / 50),
        clip(aircraft.altitude / 20000),
        Math.sin(aircraft.heading * DEG),
        Math.cos(aircraft.heading * DEG),
        clip(aircraft.speed / 300),
        clip(aircraft.groundSpeed / 300),
        clip((clearance.altitude || 0) / 20000),
        clearance.headingMode === 'HOLD' ? 1 : 0,
        clearance.headingMode === 'LNAV' ? 1 : 0,
        clip((clearance.speed || 0) / 300),
        aircraft.hasApproachClearance ? 1 : 0,
        aircraft.hasDepartureClearance ? 1 : 0,
        aircraft.isHoldAssigned ? 1 : 0,
        ...oneHot(WAKE_CATEGORIES, aircraft.recatEu),
        clip((aircraft.minimumVectoringAltitude || 0) / 20000),
        clip(minimumAssignableAltitude(aircraft, observation) / 20000),
        frame ? clip(frame.along(aircraft) / 30) : 0,
        frame ? clip(frame.lateral(aircraft) / 10) : 0,
        Math.sin(relativeHeading),
        Math.cos(relativeHeading),
        frame ? clip(Math.hypot(aircraft.x - frame.threshold.x, aircraft.y - frame.threshold.y) / 50) : 0,
        clip((aircraft.taxiRemainingSeconds || 0) / 600),
        clip(aircraft.trend || 0),
        nextFix ? 1 : 0,
        nextFix ? clip((nextFix.x - aircraft.x) / 50) : 0,
        nextFix ? clip((nextFix.y - aircraft.y) / 50) : 0,
        (aircraft.conflicts || []).length > 0 ? 1 : 0,
        occupancy && occupancy.occupants.length > 0 ? 1 : 0,
        lastTakeoff ? clip(lastTakeoff.secondsAgo / 180, 1) : 1,
        clip(distanceInsideAirspace(aircraft, observation.airport.airspace) / 30)
    ];
}

/**
 * Encode an observation for the network
 *
 * @function encodeObservation
 * @param observation {object}
 * @param shield {SafetyShield}  provides the runway index and the action masks
 * @return {object} `{ tokens, tokenMask, actionMask, global, callsigns }` with flat arrays
 */
export function encodeObservation(observation, shield) {
    const runwayIndex = shield.getRunwayIndex(observation);
    const aircraftList = orderAircraft(observation);
    const tokens = new Array(MAX_AIRCRAFT * FEATURE_COUNT).fill(0);
    const tokenMask = new Array(MAX_AIRCRAFT).fill(0);
    const actionMask = new Array(MAX_AIRCRAFT * ACTION_COUNT).fill(0);
    const callsigns = new Array(MAX_AIRCRAFT).fill(null);

    aircraftList.forEach((aircraft, slot) => {
        const features = encodeAircraft(aircraft, observation, runwayIndex);
        const mask = shield.getActionMask(aircraft, observation);

        for (let i = 0; i < FEATURE_COUNT; i++) {
            tokens[slot * FEATURE_COUNT + i] = features[i];
        }

        for (let i = 0; i < ACTION_COUNT; i++) {
            actionMask[slot * ACTION_COUNT + i] = mask[i] ? 1 : 0;
        }

        tokenMask[slot] = 1;
        callsigns[slot] = aircraft.callsign;
    });

    // empty slots can only do nothing
    for (let slot = aircraftList.length; slot < MAX_AIRCRAFT; slot++) {
        actionMask[slot * ACTION_COUNT] = 1;
    }

    const { wind } = observation.airport;
    const global = [
        clip(Math.sin(wind.angle * DEG) * wind.speed / 30),
        clip(Math.cos(wind.angle * DEG) * wind.speed / 30),
        observation.aircraft.length / MAX_AIRCRAFT,
        observation.aircraft.filter((aircraft) => aircraft.isControllable).length / MAX_AIRCRAFT,
        clip(observation.time / 3600)
    ];

    return {
        tokens, tokenMask, actionMask, global, callsigns
    };
}

/**
 * Sizes of the encoding, for the network and for ONNX export
 *
 * @function getEncodingSpec
 * @return {object}
 */
export function getEncodingSpec() {
    return {
        featureVersion: FEATURE_VERSION,
        maxAircraft: MAX_AIRCRAFT,
        featureCount: FEATURE_COUNT,
        globalFeatureCount: GLOBAL_FEATURE_COUNT,
        actionCount: ACTION_COUNT,
        featureNames: FEATURE_NAMES,
        globalFeatureNames: GLOBAL_FEATURE_NAMES
    };
}

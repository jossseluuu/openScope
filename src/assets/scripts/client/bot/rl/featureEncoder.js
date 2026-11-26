import { ACTION_COUNT } from '../actionSpace';
import { minimumAssignableAltitude } from '../botRules';
import { distanceInsideAirspace, headingDifference, secondsToRestrictedArea } from '../botGeometry';
import { COMMAND_GROUPS } from './commandHistory';

/**
 * Fixed-size numeric encoding of an observation, used as the input of Bot B's
 * neural network. It runs in JavaScript so that training (through the headless
 * simulator) and the browser use exactly the same features.
 *
 * Each aircraft is a token of `FEATURE_COUNT` numbers. Up to `MAX_AIRCRAFT`
 * tokens are kept: aircraft in emergency first, then those under control, nearest first.
 *
 * Version 3 added the emergency features (squawk 7700, time left), version 4 how soon the track
 * enters a restricted area, version 5 dropped the feature of departures returning in
 * emergency, because only arrivals declare emergencies, and version 6 added the phases of an
 * aircraft lined up on the runway and of a rejected takeoff.
 *
 * Version 7 added what a controller knows besides the radar picture, which imitation of Bot A
 * showed the network couldn't do without (it matched about 20 % of Bot A's actions, even on its
 * own training data): how long ago each kind of order was given (`CommandHistory`), the assigned
 * heading and the altitude/speed modes, and each arrival's place in the landing sequence of its
 * runway with the distance to the aircraft ahead and behind.
 *
 * Version 8 adds what the engine changes of tasks #3 and #6 put in the observation: per aircraft, the
 * safety nets (STCA predicted/alert, TCAS TA/RA and the RA sense, MSAW, APW) and the nearest thunderstorm
 * cell (distance to its edge and whether the aircraft is below its top); globally, the dynamic weather
 * (gust, visibility, ceiling, low visibility procedures, dynamic mode and number of cells).
 */

/**
 * Version of the encoding; a model only works with the version it was trained on
 *
 * @property FEATURE_VERSION
 * @type {number}
 * @final
 */
export const FEATURE_VERSION = 8;

/**
 * @property MAX_AIRCRAFT
 * @type {number}
 * @final
 */
export const MAX_AIRCRAFT = 48;

const CATEGORIES = ['arrival', 'departure', 'overflight'];
const PHASES = ['APRON', 'TAXI', 'WAITING', 'LINE_UP', 'TAKEOFF', 'REJECTED_TAKEOFF', 'CLIMB', 'CRUISE', 'DESCENT', 'APPROACH', 'LANDING'];
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
    'conflict', 'runway_occupied', 'runway_last_takeoff', 'inside_airspace',
    'emergency', 'emergency_remaining',
    'restricted_area_ahead',
    'cleared_heading_sin', 'cleared_heading_cos', 'cleared_heading_turn',
    'altitude_mode_vnav', 'speed_mode_vnav',
    ...COMMAND_GROUPS.map((group) => `recent_${group}_order`),
    'landing_order', 'landing_gap_ahead', 'landing_gap_behind',
    // v8: safety nets (#3) and thunderstorm cells (#6)
    'stca_predicted', 'stca_alert', 'tcas_ta', 'tcas_ra', 'ra_sense', 'msaw', 'apw',
    'cell_distance', 'cell_below_top'
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
export const GLOBAL_FEATURE_NAMES = [
    'wind_x', 'wind_y', 'aircraft_count', 'controllable_count', 'time', 'emergency_count',
    // v8: dynamic weather (#6)
    'gust', 'visibility', 'ceiling', 'low_visibility', 'weather_dynamic', 'cell_count'
];

/**
 * @property GLOBAL_FEATURE_COUNT
 * @type {number}
 * @final
 */
export const GLOBAL_FEATURE_COUNT = GLOBAL_FEATURE_NAMES.length;

const RESTRICTED_AREA_HORIZON_SECONDS = 120;
// landing order: positions past this one look the same; gaps in nm, beyond this they look the same
const LANDING_ORDER_SCALE = 10;
const LANDING_GAP_SCALE_NM = 10;
const NO_RECENCY = COMMAND_GROUPS.map(() => 0);
// thunderstorm cells: distance to the edge in nm (beyond this they look the same); visibility in metres
// and ceiling in ft (above these they look the same: no restriction)
const CELL_DISTANCE_SCALE_NM = 30;
const VISIBILITY_SCALE_M = 10000;
const CEILING_SCALE_FT = 5000;
const NO_SAFETY_NET = {
    stca: 'NONE', tcas: 'CLEAR', raSense: null, msaw: false, apw: null
};

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
            if (Boolean(a.emergency) !== Boolean(b.emergency)) {
                return a.emergency ? -1 : 1;
            }

            if (a.isControllable !== b.isControllable) {
                return a.isControllable ? -1 : 1;
            }

            return a.distance - b.distance;
        })
        .slice(0, MAX_AIRCRAFT);
}

const arrivalRunwayOf = (aircraft, observation) => aircraft.arrivalRunway || observation.airport.arrivalRunway;

/**
 * Place of every airborne arrival in the landing sequence of its runway, by distance to the
 * threshold, with the distance to the arrival ahead and behind
 *
 * @function landingSequence
 * @param observation {object}
 * @param runwayIndex {RunwayIndex}
 * @return {object} callsign -> `{ order, gapAhead, gapBehind }` (gaps in nm, null when none)
 */
export function landingSequence(observation, runwayIndex) {
    const streams = {};

    observation.aircraft.forEach((aircraft) => {
        if (aircraft.category !== 'arrival' || aircraft.isOnGround) {
            return;
        }

        const runwayName = arrivalRunwayOf(aircraft, observation);
        const frame = runwayIndex.frames[runwayName];

        if (!frame) {
            return;
        }

        if (!streams[runwayName]) {
            streams[runwayName] = [];
        }

        streams[runwayName].push({
            callsign: aircraft.callsign,
            distance: Math.hypot(aircraft.x - frame.threshold.x, aircraft.y - frame.threshold.y)
        });
    });

    const sequence = {};

    Object.values(streams).forEach((stream) => {
        stream.sort((a, b) => a.distance - b.distance);
        stream.forEach((entry, index) => {
            sequence[entry.callsign] = {
                order: index,
                gapAhead: index > 0 ? entry.distance - stream[index - 1].distance : null,
                gapBehind: index < stream.length - 1 ? stream[index + 1].distance - entry.distance : null
            };
        });
    });

    return sequence;
}

/**
 * Nearest thunderstorm cell of the dynamic weather: distance from the aircraft to its edge (0 inside) and
 * whether the aircraft is below its top
 *
 * @function nearestCell
 * @param aircraft {object}
 * @param observation {object}
 * @return {object|null} `{ distance, isBelowTop }`, null without cells
 */
export function nearestCell(aircraft, observation) {
    const { weather } = observation.airport;
    const cells = weather && Array.isArray(weather.cells) ? weather.cells : [];
    let best = null;

    cells.forEach((cell) => {
        const distance = Math.max(0, Math.hypot(aircraft.x - cell.x, aircraft.y - cell.y) - cell.radius);

        if (!best || distance < best.distance) {
            best = { distance, isBelowTop: aircraft.altitude < cell.top };
        }
    });

    return best;
}

/**
 * Global weather features (v8): gust, visibility, ceiling, low visibility procedures, dynamic mode, cells
 *
 * @function encodeWeather
 * @param weather {object|undefined} `observation.airport.weather` (missing: clear static weather)
 * @return {array<number>}
 */
export function encodeWeather(weather) {
    if (!weather) {
        return [0, 1, 1, 0, 0, 0];
    }

    const visibility = Number.isFinite(weather.visibility) ? weather.visibility : VISIBILITY_SCALE_M;

    return [
        clip((weather.gust || 0) / 30, 1),
        clip(visibility / VISIBILITY_SCALE_M, 1),
        weather.ceiling === null || weather.ceiling === undefined ? 1 : clip(weather.ceiling / CEILING_SCALE_FT, 1),
        weather.isLowVisibility ? 1 : 0,
        weather.mode === 'dynamic' ? 1 : 0,
        clip((weather.cells || []).length / 5, 1)
    ];
}

/**
 * Features of one aircraft
 *
 * @function encodeAircraft
 * @param aircraft {object}
 * @param observation {object}
 * @param runwayIndex {RunwayIndex}
 * @param [history] {CommandHistory}  orders given so far (no history: as if none were given)
 * @param [sequence] {object}         `landingSequence()` of the observation (computed when missing)
 * @return {array<number>} `FEATURE_COUNT` numbers
 */
export function encodeAircraft(aircraft, observation, runwayIndex, history = null, sequence = null) {
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
    const restrictedAhead = aircraft.isOnGround ? null :
        secondsToRestrictedArea(aircraft, observation.airport.restrictedAreas, RESTRICTED_AREA_HORIZON_SECONDS);
    const clearedHeading = Number.isFinite(clearance.heading) ? clearance.heading : null;
    const recency = history ? history.recency(aircraft.callsign, observation.time) : NO_RECENCY;
    const place = (sequence || landingSequence(observation, runwayIndex))[aircraft.callsign];
    const gap = (value) => (value === null ? 1 : clip(value / LANDING_GAP_SCALE_NM, 1));
    const safetyNet = aircraft.safetyNet || NO_SAFETY_NET;
    const isRa = safetyNet.tcas === 'RA';
    const cell = aircraft.isOnGround ? null : nearestCell(aircraft, observation);

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
        clip(distanceInsideAirspace(aircraft, observation.airport.airspace) / 30),
        aircraft.emergency ? 1 : 0,
        aircraft.emergency ? clip(aircraft.emergency.remainingSeconds / 1800, 1) : 0,
        restrictedAhead ? 1 - restrictedAhead.seconds / RESTRICTED_AREA_HORIZON_SECONDS : 0,
        clearedHeading === null ? 0 : Math.sin(clearedHeading * DEG),
        clearedHeading === null ? 0 : Math.cos(clearedHeading * DEG),
        clearedHeading === null ? 0 : headingDifference(clearedHeading, aircraft.heading) / 180,
        clearance.altitudeMode === 'VNAV' ? 1 : 0,
        clearance.speedMode === 'VNAV' ? 1 : 0,
        ...recency,
        place ? clip((place.order + 1) / LANDING_ORDER_SCALE, 1) : 0,
        place ? gap(place.gapAhead) : 0,
        place ? gap(place.gapBehind) : 0,
        safetyNet.stca === 'PREDICTED' ? 1 : 0,
        safetyNet.stca === 'ALERT' ? 1 : 0,
        safetyNet.tcas === 'TA' ? 1 : 0,
        isRa ? 1 : 0,
        isRa && Number.isFinite(safetyNet.raSense) ? safetyNet.raSense : 0,
        safetyNet.msaw ? 1 : 0,
        safetyNet.apw ? 1 : 0,
        cell ? clip(cell.distance / CELL_DISTANCE_SCALE_NM, 1) : 1,
        cell && cell.isBelowTop ? 1 : 0
    ];
}

/**
 * Encode an observation for the network
 *
 * @function encodeObservation
 * @param observation {object}
 * @param shield {SafetyShield}  provides the runway index and the action masks
 * @param [history] {CommandHistory}  orders given so far
 * @return {object} `{ tokens, tokenMask, actionMask, global, callsigns }` with flat arrays
 */
export function encodeObservation(observation, shield, history = null) {
    const runwayIndex = shield.getRunwayIndex(observation);
    const aircraftList = orderAircraft(observation);
    const sequence = landingSequence(observation, runwayIndex);
    const tokens = new Array(MAX_AIRCRAFT * FEATURE_COUNT).fill(0);
    const tokenMask = new Array(MAX_AIRCRAFT).fill(0);
    const actionMask = new Array(MAX_AIRCRAFT * ACTION_COUNT).fill(0);
    const callsigns = new Array(MAX_AIRCRAFT).fill(null);

    aircraftList.forEach((aircraft, slot) => {
        const features = encodeAircraft(aircraft, observation, runwayIndex, history, sequence);
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
        clip(observation.time / 3600),
        clip(observation.aircraft.filter((aircraft) => aircraft.emergency && !aircraft.isOnGround).length / 3, 1),
        ...encodeWeather(observation.airport.weather)
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

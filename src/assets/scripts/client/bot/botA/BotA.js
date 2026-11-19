import SafetyShield from '../safetyShield';
import {
    ACTIONS,
    ACTION_INDEX,
    ACTION_TYPE,
    ALTITUDES,
    actionToCommand,
    altitudeAction,
    headingAction,
    headingReference,
    nextPositionedWaypoint,
    parallelRunwayName,
    speedAction
} from '../actionSpace';
import {
    bearing,
    distance,
    distanceInsideAirspace,
    hasAltitudeGaps,
    highestAlongPath,
    headingDifference,
    headingVector,
    highestFloorAlongPath,
    levelsInsideAirspace,
    restrictedAreaAt,
    samplePath,
    secondsToRestrictedArea,
    trueAirspeedFactor
} from '../botGeometry';
import {
    airspaceMaximumAltitude,
    areDivergingDepartures,
    checkTakeoff,
    finalSpacingNm,
    landingIntervalSeconds,
    minimumAssignableAltitude
} from '../botRules';
import { getDefaultBotAParameters } from './botAParameters';
import { createRandom, optimizeSequence, scheduleSequence } from './sequencing';
import {
    chooseResolution,
    dependentApproachMinimumNm,
    detectConflicts,
    hasPredictedConflict,
    isTrackLeavingAirspace,
    predictLoss,
    safeLevelToward
} from './conflictResolution';
import {
    ARRIVAL_MODE,
    buildArrivalPath,
    classifyArrival,
    completePattern,
    joinPattern,
    pathLength,
    patternGeometry,
    plannedSpeed,
    profileAltitude,
    timeAlongPath
} from './arrivalPlanner';
import {
    advanceOnFinal, finalState, minimumGapOnFinal, timeToThreshold
} from './finalApproach';

/**
 * Relative fuel burn by RECAT-EU category, used to weight arrival delays
 *
 * @property DELAY_WEIGHT
 * @type {object}
 * @final
 */
const DELAY_WEIGHT = {
    A: 3, B: 2, C: 1.5, D: 1, E: 0.6, F: 0.2
};

/**
 * A conflict resolution is not changed for this long after it is issued
 *
 * @property RESOLUTION_REVISION_SECONDS
 * @type {number}
 * @final
 */
const RESOLUTION_REVISION_SECONDS = 20;

/**
 * When resuming would recreate a conflict, the resolution is kept this much longer
 *
 * @property RESOLUTION_EXTENSION_SECONDS
 * @type {number}
 * @final
 */
const RESOLUTION_EXTENSION_SECONDS = 15;

/**
 * A resolution is dropped after this long even if the conflict seems to persist
 *
 * @property MAX_RESOLUTION_SECONDS
 * @type {number}
 * @final
 */
const MAX_RESOLUTION_SECONDS = 240;

/**
 * A lateral resolution ends early when the vectored arrival would come near the edge
 * of the airspace within this time
 *
 * @property BOUNDARY_RESUME_SECONDS
 * @type {number}
 * @final
 */
const BOUNDARY_RESUME_SECONDS = 60;

/**
 * An aircraft whose approach the shield broke off keeps its heading this long
 * before it is vectored again
 *
 * @property BREAK_OFF_SECONDS
 * @type {number}
 * @final
 */
const BREAK_OFF_SECONDS = 45;

/**
 * An arrival on base this much short of its spacing on final goes back to the downwind
 *
 * @property BASE_SPACING_TOLERANCE_NM
 * @type {number}
 * @final
 */
const BASE_SPACING_TOLERANCE_NM = 1;

/**
 * Holding fixes must be at least this far inside the airspace so the pattern stays inside it
 *
 * @property HOLD_BOUNDARY_MARGIN_NM
 * @type {number}
 * @final
 */
const HOLD_BOUNDARY_MARGIN_NM = 10;

/**
 * Conflicts closer than this are always resolved, whatever spaces the aircraft otherwise
 *
 * @property IMMINENT_CONFLICT_SECONDS
 * @type {number}
 * @final
 */
const IMMINENT_CONFLICT_SECONDS = 60;

/**
 * Runway changes are only considered for arrivals at least this far from landing,
 * every so often, and when they bring a clear gain
 */
const RUNWAY_CHOICE_MINIMUM_DISTANCE_NM = 35;
const RUNWAY_CHOICE_INTERVAL_SECONDS = 120;
const RUNWAY_CHANGE_MINIMUM_GAIN_SECONDS = 60;
const RUNWAY_SIDE_PENALTY_SECONDS = 90;

/**
 * Minimum time between two speed changes of the same aircraft
 *
 * @property SPEED_CHANGE_INTERVAL_SECONDS
 * @type {number}
 * @final
 */
const SPEED_CHANGE_INTERVAL_SECONDS = 30;

/**
 * A delay shorter than this is not absorbed with speed: the sequence moves by a few seconds
 * from one cycle to the next, and chasing that only makes the speeds go up and down
 *
 * @property SPEED_DELAY_TOLERANCE_SECONDS
 * @type {number}
 * @final
 */
const SPEED_DELAY_TOLERANCE_SECONDS = 30;

/**
 * A departure whose climb via the SID was stopped short for traffic is cleared again after this
 *
 * @property DEPARTURE_CLIMB_RETRY_SECONDS
 * @type {number}
 * @final
 */
const DEPARTURE_CLIMB_RETRY_SECONDS = 60;

/**
 * Heading errors smaller than this are not corrected
 *
 * @property HEADING_TOLERANCE_DEGREES
 * @type {number}
 * @final
 */
const HEADING_TOLERANCE_DEGREES = 8;

/**
 * Heading correction per nautical mile off the centerline on the intercept leg
 *
 * @property LOCALIZER_GAIN_DEGREES_PER_NM
 * @type {number}
 * @final
 */
const LOCALIZER_GAIN_DEGREES_PER_NM = 15;

/**
 * Legs of the radar pattern to the localizer
 *
 * @property PATTERN_LEG
 * @type {object}
 * @final
 */
const PATTERN_LEG = {
    DOWNWIND: 'downwind',
    // from further out than the base turn, straight to it
    INBOUND: 'inbound',
    BASE: 'base',
    INTERCEPT: 'intercept'
};

/**
 * Step between the join points considered along the localizer
 *
 * @property JOIN_STEP_NM
 * @type {number}
 * @final
 */
const JOIN_STEP_NM = 0.5;

/**
 * The downwind, the base and the final are kept at least this far inside the airspace: at airports
 * whose airspace is small on one side of the final (e.g. EGNM) a long downwind leaves it
 *
 * @property PATTERN_BOUNDARY_MARGIN_NM
 * @type {number}
 * @final
 */
const PATTERN_BOUNDARY_MARGIN_NM = 2;

/**
 * A downwind on the other side of the final is used when it can be this much longer
 *
 * @property PATTERN_SIDE_ADVANTAGE_NM
 * @type {number}
 * @final
 */
const PATTERN_SIDE_ADVANTAGE_NM = 3;

/**
 * Landing before the slot is fine, landing after it is not: a second early costs this
 * fraction of a second late when the join is chosen
 *
 * @property JOIN_EARLY_WEIGHT
 * @type {number}
 * @final
 */
const JOIN_EARLY_WEIGHT = 0.25;

/**
 * Distance flown on the localizer before the glidepath is captured: the terrain allows a join
 * only where the aircraft can be level this far before the glidepath comes down to it
 *
 * @property JOIN_GLIDEPATH_MARGIN_NM
 * @type {number}
 * @final
 */
const JOIN_GLIDEPATH_MARGIN_NM = 2;

/**
 * Margin over the radar minimum under which a conflict between two arrivals spaced by the
 * pattern is still resolved
 *
 * @property PATTERN_CONFLICT_BUFFER_NM
 * @type {number}
 * @final
 */
const PATTERN_CONFLICT_BUFFER_NM = 0.5;

/**
 * The terrain under the path an aircraft is cleared down along is sampled every `TERRAIN_PATH_STEP_NM`,
 * `TERRAIN_PATH_MARGIN_NM` to each side
 *
 * @property TERRAIN_PATH_STEP_NM
 * @type {number}
 * @final
 */
const TERRAIN_PATH_STEP_NM = 0.5;
const TERRAIN_PATH_MARGIN_NM = 0.4;

/**
 * An aircraft joins the localizer at least this much below the glidepath
 *
 * @property JOIN_BELOW_GLIDEPATH_FT
 * @type {number}
 * @final
 */
const JOIN_BELOW_GLIDEPATH_FT = 200;

/**
 * On the base and the intercept leg the aircraft comes down in steps as the terrain under the
 * next miles of its path allows
 *
 * @property TERRAIN_LOOKAHEAD_ON_BASE_NM
 * @type {number}
 * @final
 */
const TERRAIN_LOOKAHEAD_ON_BASE_NM = 2;

/**
 * An aircraft flying within this many degrees of the final course is flying toward the runway
 *
 * @property TOWARD_RUNWAY_DEGREES
 * @type {number}
 * @final
 */
const TOWARD_RUNWAY_DEGREES = 45;

/**
 * Arrivals can descend this much steeper than the planned descent profile when vectored
 *
 * @property DESCENT_CAPABILITY_FACTOR
 * @type {number}
 * @final
 */
const DESCENT_CAPABILITY_FACTOR = 1.5;

/**
 * Cost of moving the chosen join, so it does not jump along the localizer from one cycle to the next
 *
 * @property JOIN_CHANGE_SECONDS_PER_NM
 * @type {number}
 * @final
 */
const JOIN_CHANGE_SECONDS_PER_NM = 4;

/**
 * Speeds tried on final to keep the spacing behind the aircraft ahead, in steps of
 *
 * @property FINAL_SPEED_STEP_KNOTS
 * @type {number}
 * @final
 */
const FINAL_SPEED_STEP_KNOTS = 5;

/**
 * Kept above the floor of the controlled airspace along the planned path, rounded up to the
 * next thousand feet (the same margin the safety shield uses)
 *
 * @property PATH_FLOOR_MARGIN_FT
 * @type {number}
 * @final
 */
const PATH_FLOOR_MARGIN_FT = 500;

/**
 * Length of the planned path over which the airspace floor is checked: about two minutes of flight,
 * what is flown before the level is cleared again (and what the safety shield looks ahead)
 *
 * @property PATH_FLOOR_LOOKAHEAD_NM
 * @type {number}
 * @final
 */
const PATH_FLOOR_LOOKAHEAD_NM = 8;

/**
 * Lowest level that keeps an aircraft inside the controlled airspace over the next part of `path`
 * (at most up to the join on the localizer): the airspace floors step up away from the airport,
 * and a downwind or an inbound leg can lead under a higher floor than the one the aircraft is
 * under now. Only the next `PATH_FLOOR_LOOKAHEAD_NM` count: further on the level is cleared again,
 * and holding the highest floor of the whole path kept aircraft too high to join
 *
 * @function pathFloorLevel
 * @param path {array<object>}  ends at the threshold
 * @param airspace {array<object>}
 * @return {number} ft, 0 when the airspace reaches the ground all along
 */
const pathFloorLevel = (path, airspace) => {
    const floor = highestFloorAlongPath(path.slice(0, -1), airspace, PATH_FLOOR_LOOKAHEAD_NM);

    return floor > 0 ? Math.ceil((floor + PATH_FLOOR_MARGIN_FT) / 1000) * 1000 : 0;
};

/**
 * Restricted areas: an aircraft whose track enters one within `LOOKAHEAD_SECONDS` is turned, by the
 * smallest of `TURNS_DEGREES` that keeps it clear for `CLEAR_SECONDS`. The pattern to the localizer
 * is laid out of the areas that reach `PATTERN_ALTITUDE_FT` above the airport.
 *
 * @property RESTRICTED_AREA
 * @type {object}
 * @final
 */
const RESTRICTED_AREA = {
    LOOKAHEAD_SECONDS: 90,
    CLEAR_SECONDS: 135,
    TURNS_DEGREES: [20, 30, 45, 60, 90],
    PATTERN_ALTITUDE_FT: 6000
};

/**
 * Aircraft in emergency (squawk 7700). They land first (ICAO Doc 4444 15.1.3):
 * - departures do not take off from their runway for this long before their landing slot
 * - they leave their STAR for radar vectors when that shortens the track by this much
 * - they may change to the parallel runway closer in, more often and for a smaller gain
 *
 * @property EMERGENCY
 * @type {object}
 * @final
 */
const EMERGENCY = {
    RUNWAY_PROTECTION_SECONDS: 240,
    SHORTCUT_MINIMUM_NM: 3,
    RUNWAY_CHOICE_MINIMUM_DISTANCE_NM: 12,
    RUNWAY_CHOICE_INTERVAL_SECONDS: 30,
    RUNWAY_CHANGE_MINIMUM_GAIN_SECONDS: 20
};

/**
 * Bot A: an expert controller with metaheuristic planning.
 *
 * Every decision cycle it:
 * 1. applies the actions imposed by the safety shield
 * 2. detects and resolves short-term conflicts
 * 3. sequences departures at each runway (DMAN)
 * 4. sequences arrivals at each runway (AMAN, simulated annealing under CPS)
 *    and absorbs the delays with speed control, downwind extension and holds,
 *    then vectors the aircraft to the localizer. Aircraft in emergency go first:
 *    shortest vectors and join, the others make room behind them
 *
 * It gives at most one action per aircraft per cycle, chosen from the shared
 * action space and checked by the safety shield.
 *
 * @class BotA
 */
export default class BotA {
    /**
     * @constructor
     * @param [parameters] {object}  overrides of `BOT_A_PARAMETER_SPACE`
     */
    constructor(parameters = {}) {
        this.parameters = { ...getDefaultBotAParameters(), ...parameters };
        this.shield = new SafetyShield(this._ruleMargins());
        this.reset();
    }

    /**
     * Forget everything about the current episode
     *
     * @for BotA
     * @method reset
     */
    reset() {
        this._memory = {};
        this._sequences = {};
        // join points on the localizer committed by the arrivals being vectored, by callsign
        this._joins = {};
        // furthest base turn inside the airspace, by airport, runway and side (see `_downwindLimitNm`)
        this._downwindLimits = {};
        this._random = createRandom(1);
        this.lastPlan = { sequences: {}, decisions: [] };
    }

    /**
     * Decide the actions for this cycle
     *
     * @for BotA
     * @method decide
     * @param observation {object}
     * @return {array<object>} `{ callsign, action, command, reason }`
     */
    decide(observation) {
        const context = this._buildContext(observation);
        const decisions = {};
        // returns the action given, or null
        const add = (callsign, action, reason) => {
            if (decisions[callsign] || action === ACTION_INDEX.NOOP) {
                return null;
            }

            const aircraft = context.byCallsign[callsign];

            if (!aircraft || !this.shield.getActionMask(aircraft, observation)[action]) {
                return null;
            }

            decisions[callsign] = {
                callsign, action, command: actionToCommand(action, aircraft, observation), reason
            };
            this._remember(callsign, action, observation.time);

            return action;
        };
        // climbs and descents asked by the plans are first checked against the traffic
        const addChecked = (callsign, action, reason) => {
            const checked = this._checkLevel(callsign, action, context);

            return add(callsign, checked, checked === action ? reason : `${reason}, stopped short for traffic`);
        };

        this._forgetGoneAircraft(context);

        const required = this.shield.getRequiredActions(observation);

        Object.keys(required).forEach((callsign) => {
            // the climb into a sector with a higher floor is checked against the traffic like any other:
            // climbing into an aircraft above costs as much as leaving the airspace
            const isFloorClimb = ACTIONS[required[callsign]].type === ACTION_TYPE.ALTITUDE;
            let given = isFloorClimb ?
                addChecked(callsign, required[callsign], 'safety: higher airspace floor ahead') :
                add(callsign, required[callsign], 'safety: spacing on final');

            const aircraft = context.byCallsign[callsign];

            // traffic above leaves no room to climb at all, and the terrain ahead also rises above the
            // aircraft (e.g. the Sierra de Guadarrama north of Madrid): turn back toward the airport, under
            // the lower floors and over lower terrain. Under a higher floor alone the aircraft keeps its
            // track: turning it into the traffic around the airport costs more (KLAX, EDDM)
            if (isFloorClimb && given === null && !decisions[callsign] && aircraft &&
                (aircraft.minimumVectoringAltitudeAhead || 0) > aircraft.altitude) {
                given = add(callsign, headingAction(aircraft, bearing(aircraft, { x: 0, y: 0 })),
                    'safety: higher airspace floor and terrain ahead, traffic above: turn back');
            }

            if (given !== null && ACTIONS[given].type === ACTION_TYPE.HEADING) {
                this._breakOff(callsign, given, context);
            }
        });

        this._resolveConflicts(context, add);
        this._avoidRestrictedAreas(context, add);
        this._sequenceDepartures(context, add);
        this._controlDepartureClimbs(context, addChecked);
        this._controlArrivals(context, addChecked);

        this.lastPlan = { sequences: this._sequences, decisions: Object.values(decisions) };

        return this.lastPlan.decisions;
    }

    /**
     * Command texts of this cycle's decisions, as `[callsign, command]`
     *
     * @for BotA
     * @method decideCommands
     * @param observation {object}
     * @return {array<array<string>>}
     */
    decideCommands(observation) {
        return this.decide(observation)
            .filter((decision) => decision.command)
            .map((decision) => [decision.callsign, decision.command]);
    }

    // ------------------------------------------------------------------ context

    _ruleMargins() {
        const p = this.parameters;

        return {
            departureRunwayOccupancySeconds: p.departureRunwayOccupancySeconds,
            arrivalDepartureMarginSeconds: p.arrivalDepartureMarginSeconds,
            sameRouteDepartureSeconds: p.sameRouteDepartureSeconds,
            divergingDepartureSeconds: p.divergingDepartureSeconds,
            finalSpacingBufferNm: p.finalSpacingBufferNm,
            landingOccupancyBufferSeconds: p.landingOccupancyBufferSeconds,
            minimumAltitudeBufferFt: 0
        };
    }

    _buildContext(observation) {
        const runwayIndex = this.shield.getRunwayIndex(observation);
        const byCallsign = {};

        observation.aircraft.forEach((aircraft) => {
            byCallsign[aircraft.callsign] = aircraft;
        });

        return {
            observation, runwayIndex, byCallsign, time: observation.time
        };
    }

    _memoryOf(callsign) {
        if (!this._memory[callsign]) {
            // resolutions by kind: lateral, vertical, speed, breakout
            this._memory[callsign] = { lastActions: {}, resolutions: {}, waitingSince: null };
        }

        return this._memory[callsign];
    }

    _remember(callsign, action, time) {
        this._memoryOf(callsign).lastActions[action] = time;
    }

    _forgetGoneAircraft(context) {
        Object.keys(this._memory).forEach((callsign) => {
            if (!context.byCallsign[callsign]) {
                delete this._memory[callsign];
            }
        });
    }

    _recentlyIssued(callsign, action, time, seconds = 30) {
        const issuedAt = this._memoryOf(callsign).lastActions[action];

        return issuedAt !== undefined && time - issuedAt < seconds;
    }

    _minimumAltitude(aircraft, observation) {
        return minimumAssignableAltitude(aircraft, observation);
    }

    /**
     * The action to give instead of a climb or descent so the aircraft stays separated
     * from everyone during the transition: the safe level closest to the one asked,
     * or nothing. A descent via the STAR is kept when its lowest level is safe.
     */
    _checkLevel(callsign, action, context) {
        const { observation } = context;
        const aircraft = context.byCallsign[callsign];
        const { type, value } = ACTIONS[action];

        if (!aircraft || aircraft.isOnGround) {
            return action;
        }

        let target = null;

        if (type === ACTION_TYPE.ALTITUDE) {
            target = value;
        } else if (type === ACTION_TYPE.PROCEDURE && aircraft.category === 'departure') {
            // climb via the SID, up to the top of the airspace unless traffic stops it shorter
            target = ALTITUDES[ALTITUDES.length - 1];

            if (!hasPredictedConflict(
                {
                    ...aircraft,
                    clearance: { ...aircraft.clearance, altitudeMode: 'VNAV', altitude: target }
                },
                observation,
                this.parameters,
                () => false,
                true
            )) {
                return action;
            }
        } else if (type === ACTION_TYPE.PROCEDURE && aircraft.category === 'arrival') {
            target = this._lowestRouteAltitude(aircraft);

            if (target === null || !hasPredictedConflict(
                {
                    ...aircraft,
                    clearance: { ...aircraft.clearance, altitudeMode: 'VNAV', altitude: target }
                },
                observation,
                this.parameters,
                () => false,
                true
            )) {
                return action;
            }
        } else {
            return action;
        }

        const level = safeLevelToward(
            aircraft, target, observation, this.parameters, (a, b) => this._isKeptApartByPattern(a, b, observation)
        );

        if (level === null || (type === ACTION_TYPE.ALTITUDE && level === target)) {
            return level === null ? ACTION_INDEX.NOOP : action;
        }

        return level === aircraft.clearance.altitude ? ACTION_INDEX.NOOP : altitudeAction(level);
    }

    /**
     * Lowest altitude restriction left on the route, where a descent via the STAR ends
     */
    _lowestRouteAltitude(aircraft) {
        const levels = (aircraft.waypoints || [])
            .map((waypoint) => (waypoint.altitudeMaximum !== null ? waypoint.altitudeMaximum : waypoint.altitudeMinimum))
            .filter((level) => level !== null && level !== undefined);

        return levels.length > 0 ? Math.min(...levels) : null;
    }

    /**
     * After the shield breaks off an approach, the aircraft keeps the break-off
     * heading for a while and is then vectored on a new pattern
     */
    _breakOff(callsign, action, context) {
        const { time } = context;
        const aircraft = context.byCallsign[callsign];
        const memory = this._memoryOf(callsign);

        memory.pattern = null;
        memory.resolutions.breakout = {
            action,
            issuedAt: time,
            createdAt: time,
            until: time + BREAK_OFF_SECONDS,
            intentAltitude: aircraft.clearance.altitude
        };
    }

    // ---------------------------------------------------------------- conflicts

    _resolveConflicts(context, add) {
        const { observation, time } = context;
        // the pattern spaces arrivals to the same runway with the spacing required on final, which is
        // less than the margin kept between any two other aircraft: between them, only a loss that
        // is really coming is resolved
        const conflicts = detectConflicts(observation, this.parameters)
            .filter((conflict) => !this._isKeptApartByPattern(conflict.a, conflict.b, observation));

        conflicts.forEach((conflict) => {
            // only what the shield allows: e.g. no climb above the ceiling of the airspace
            const resolution = chooseResolution(
                conflict,
                (aircraft) => this._minimumAltitude(aircraft, observation),
                this.parameters,
                observation,
                (aircraft, action) => this.shield.getActionMask(aircraft, observation)[action]
            );

            if (!resolution) {
                return;
            }

            this._applyResolution(resolution, conflict, context, add);

            // complementary order for the other aircraft of the conflict
            if (resolution.partner) {
                this._applyResolution(resolution.partner, conflict, context, add);
            }
        });

        Object.keys(this._memory).forEach((callsign) => {
            const memory = this._memory[callsign];
            const aircraft = context.byCallsign[callsign];

            if (!aircraft) {
                return;
            }

            Object.keys(memory.resolutions).forEach((kind) => {
                // a heading kept for long can also lead over higher terrain: resume before getting there
                // (ending a vertical resolution early for the terrain or a higher floor ahead was measured
                // too: better at LEMD south, worse at EDDM, worse overall; see phacer.md)
                const isLeavingAirspace = kind === 'lateral' &&
                    (isTrackLeavingAirspace(aircraft, context.observation, BOUNDARY_RESUME_SECONDS) ||
                        (aircraft.minimumVectoringAltitudeAhead || 0) > aircraft.altitude);

                if (memory.resolutions[kind].until <= time || isLeavingAirspace) {
                    this._resumeAfterResolution(aircraft, kind, memory, context, add, isLeavingAirspace);
                }
            });
        });
    }

    /**
     * Give a resolution to one aircraft and remember it, to resume what it was doing later
     */
    _applyResolution(resolution, conflict, context, add) {
        const { time } = context;
        const mover = context.byCallsign[resolution.callsign];
        const { resolutions } = this._memoryOf(resolution.callsign);
        const active = Object.values(resolutions);
        const lastIssuedAt = Math.max(-Infinity, ...active.map((slot) => slot.issuedAt));
        const other = conflict.a.callsign === resolution.callsign ? conflict.b : conflict.a;

        // give the previous resolution time to work before changing it
        if (time - lastIssuedAt >= RESOLUTION_REVISION_SECONDS &&
            add(resolution.callsign, resolution.action, `conflict with ${other.callsign} in ${conflict.time} s`) !== null) {
            const previous = resolutions[resolution.kind];

            resolutions[resolution.kind] = {
                action: resolution.action,
                issuedAt: time,
                createdAt: previous ? previous.createdAt : time,
                until: time + this.parameters.resolutionHoldSeconds,
                // what the aircraft was doing before the first resolution, to resume it later
                intentAltitude: previous ? previous.intentAltitude : mover.clearance.altitude,
                // an arrival already on radar vectors goes back to them, not to its old route
                resumesPattern: previous ? previous.resumesPattern :
                    mover.category === 'arrival' && classifyArrival(mover) === ARRIVAL_MODE.VECTOR
            };

            return;
        }

        // the conflict lasts: keep what was already done
        active.forEach((slot) => {
            slot.until = Math.max(slot.until, time + this.parameters.resolutionHoldSeconds);
        });
    }

    /**
     * Resume the route or procedure after a resolution, unless that would recreate a conflict
     * (or the vector is taking the aircraft out of the airspace: then it resumes anyway, and a
     * new conflict gets a new resolution)
     */
    _resumeAfterResolution(aircraft, kind, memory, context, add, isLeavingAirspace = false) {
        const { observation, time } = context;
        const slot = memory.resolutions[kind];
        const { intentAltitude } = slot;
        const nextFix = nextPositionedWaypoint(aircraft);

        if (kind === 'speed') {
            // the plan of the aircraft sets its speed again
            delete memory.resolutions[kind];

            return;
        }

        if (kind === 'breakout') {
            // the radar pattern starts over from where the aircraft is now
            delete memory.resolutions[kind];

            return;
        }

        // a holding aircraft moved to another level keeps it in the stack when it is free there,
        // instead of going back through the traffic it was moved away from
        if (kind === 'vertical' && aircraft.isHoldAssigned && memory.hold) {
            const level = Math.round(aircraft.altitude / 1000) * 1000;

            if (this._holdingStack(memory.hold.fix, aircraft.callsign, context).indexOf(level) === -1 &&
                level >= this._holdingBaseLevel(nextFix, aircraft, context)) {
                memory.hold.level = level;
            }

            delete memory.resolutions[kind];

            return;
        }

        // a vertical resolution of an aircraft on its procedure is resumed with a climb or descent via it
        const resumesProcedure = kind === 'vertical' &&
            (aircraft.category === 'departure' || classifyArrival(aircraft) === ARRIVAL_MODE.ROUTE);
        const resumed = {
            ...aircraft,
            clearance: {
                ...aircraft.clearance,
                altitude: kind === 'vertical' ? intentAltitude : aircraft.clearance.altitude,
                altitudeMode: resumesProcedure ? 'VNAV' : aircraft.clearance.altitudeMode
            },
            groundTrack: kind === 'lateral' && nextFix ? bearing(aircraft, nextFix) : aircraft.groundTrack
        };

        const isTooOld = time - slot.createdAt > MAX_RESOLUTION_SECONDS;

        if (kind === 'lateral' && slot.resumesPattern) {
            delete memory.resolutions[kind];

            return;
        }

        // the way back to the route leads through a restricted area: keep the heading a while longer
        if (kind === 'lateral' && nextFix && !isLeavingAirspace && aircraft.isControllable && secondsToRestrictedArea(
            aircraft, observation.airport.restrictedAreas, RESTRICTED_AREA.CLEAR_SECONDS, bearing(aircraft, nextFix)
        )) {
            slot.until = time + RESOLUTION_EXTENSION_SECONDS;

            return;
        }

        if (!isTooOld && !isLeavingAirspace && aircraft.isControllable && !aircraft.isOnGround &&
            hasPredictedConflict(resumed, observation, this.parameters, (a, b) => this._isSpacedByPattern(a, b))) {
            slot.until = time + RESOLUTION_EXTENSION_SECONDS;

            return;
        }

        delete memory.resolutions[kind];

        if (!aircraft.isControllable || aircraft.isOnGround) {
            return;
        }

        if (kind === 'lateral' && nextFix) {
            add(aircraft.callsign, ACTION_INDEX.DIRECT_NEXT, 'resume route after conflict');
        } else if (kind === 'vertical' && nextFix && aircraft.category === 'departure') {
            add(aircraft.callsign, ACTION_INDEX.PROCEDURE, 'resume climb after conflict');
        } else if (kind === 'vertical' && nextFix && classifyArrival(aircraft) === ARRIVAL_MODE.ROUTE) {
            add(aircraft.callsign, ACTION_INDEX.PROCEDURE, 'resume descent after conflict');
        }
    }

    _hasActiveResolution(callsign, kind, time) {
        const slot = this._memoryOf(callsign).resolutions[kind];

        return Boolean(slot) && slot.until > time;
    }

    /**
     * Turn aircraft away from the restricted areas ahead, like a lateral conflict resolution: the
     * heading is kept for a while and the route or the pattern is resumed afterwards
     */
    _avoidRestrictedAreas(context, add) {
        const { observation, time } = context;
        const areas = observation.airport.restrictedAreas;

        if (!areas || areas.length === 0) {
            return;
        }

        observation.aircraft.forEach((aircraft) => {
            const isOnFinal = aircraft.category === 'arrival' && classifyArrival(aircraft) === ARRIVAL_MODE.FINAL;

            if (!aircraft.isControllable || aircraft.isOnGround || aircraft.flightPhase === 'TAKEOFF' || isOnFinal ||
                this._hasActiveResolution(aircraft.callsign, 'lateral', time)) {
                return;
            }

            const ahead = secondsToRestrictedArea(aircraft, areas, RESTRICTED_AREA.LOOKAHEAD_SECONDS);

            if (!ahead) {
                return;
            }

            const reference = headingReference(aircraft);
            const goal = bearing(aircraft, { x: 0, y: 0 });
            const turns = [];

            RESTRICTED_AREA.TURNS_DEGREES.forEach((degrees) => turns.push(degrees, -degrees));

            const clear = turns
                .filter((turn) => !secondsToRestrictedArea(aircraft, areas, RESTRICTED_AREA.CLEAR_SECONDS, reference + turn) &&
                    !isTrackLeavingAirspace({ ...aircraft, groundTrack: reference + turn }, observation, BOUNDARY_RESUME_SECONDS))
                .sort((a, b) => Math.abs(a) - Math.abs(b) ||
                    Math.abs(headingDifference(reference + a, goal)) - Math.abs(headingDifference(reference + b, goal)));

            if (clear.length === 0) {
                return;
            }

            const action = headingAction(aircraft, reference + clear[0]);

            if (add(aircraft.callsign, action, `restricted area ${ahead.area.name} in ${ahead.seconds} s`) !== null) {
                const { resolutions } = this._memoryOf(aircraft.callsign);

                resolutions.lateral = {
                    action,
                    issuedAt: time,
                    createdAt: time,
                    until: time + this.parameters.resolutionHoldSeconds,
                    intentAltitude: aircraft.clearance.altitude,
                    // an arrival continues on radar vectors: its route is what led it here
                    resumesPattern: aircraft.category === 'arrival'
                };
            }
        });
    }

    // --------------------------------------------------------------- departures

    _sequenceDepartures(context, add) {
        const { observation, runwayIndex, time } = context;
        const queues = {};

        observation.aircraft.forEach((aircraft) => {
            if (aircraft.category !== 'departure' || !aircraft.isControllable) {
                return;
            }

            const runwayName = aircraft.departureRunway || observation.airport.departureRunway;

            if (!queues[runwayName]) {
                queues[runwayName] = { apron: [], active: [], waiting: [] };
            }

            if (aircraft.flightPhase === 'APRON') {
                queues[runwayName].apron.push(aircraft);
            } else if (aircraft.flightPhase === 'TAXI' || aircraft.flightPhase === 'WAITING' || aircraft.flightPhase === 'LINE_UP') {
                queues[runwayName].active.push(aircraft);
            }

            if (aircraft.flightPhase === 'WAITING' || aircraft.flightPhase === 'LINE_UP') {
                const memory = this._memoryOf(aircraft.callsign);

                memory.waitingSince = memory.waitingSince === null ? time : memory.waitingSince;
                queues[runwayName].waiting.push(aircraft);
            }
        });

        const physicalUsed = new Set();
        // takeoffs released this cycle, not yet in the observation's last takeoffs
        const released = [];

        Object.keys(queues).forEach((runwayName) => {
            const queue = queues[runwayName];
            let active = queue.active.length;

            // release departures from the gate while the holding point is not saturated
            queue.apron.forEach((aircraft) => {
                const isQueueFull = active >= this.parameters.maxDepartureQueue;

                if (!isQueueFull && !this._recentlyIssued(aircraft.callsign, ACTION_INDEX.TAXI, time)) {
                    add(aircraft.callsign, ACTION_INDEX.TAXI, `taxi to ${runwayName}`);
                    active += 1;
                }
            });

            // one takeoff per physical runway per cycle: the longest waiting departure that can go now
            const physicalName = runwayIndex.physicalName[runwayName];

            if (physicalUsed.has(physicalName)) {
                return;
            }

            const ready = queue.waiting
                .filter((aircraft) => checkTakeoff(aircraft, observation, runwayIndex, this.shield.margins).ok)
                // a simultaneous takeoff from a parallel runway only on a diverging track
                .filter((aircraft) => released.every((other) => !runwayIndex.areParallel(runwayName, other.departureRunway) ||
                    (!runwayIndex.areDependent(runwayName, other.departureRunway) &&
                        areDivergingDepartures(other, aircraft, runwayIndex, observation))))
                .sort((a, b) => this._memoryOf(a.callsign).waitingSince - this._memoryOf(b.callsign).waitingSince);

            if (ready.length > 0 && !this._arrivalNeedsRunwaySoon(physicalName, context) &&
                add(ready[0].callsign, ACTION_INDEX.TAKEOFF, `takeoff ${runwayName}`) !== null) {
                physicalUsed.add(physicalName);
                released.push(ready[0]);
            }
        });
    }

    /**
     * Airborne departures are cleared to climb via their SID (`cvs`) as soon as they are ours,
     * instead of staying at the initial altitude; when traffic is in the way the climb stops short
     * (see `_checkLevel`) and is cleared again later
     */
    _controlDepartureClimbs(context, add) {
        const { observation, time } = context;

        observation.aircraft.forEach((aircraft) => {
            if (aircraft.category !== 'departure' || aircraft.isOnGround || !aircraft.isControllable ||
                aircraft.flightPhase === 'TAKEOFF' || aircraft.clearance.altitudeMode === 'VNAV' ||
                this._hasActiveResolution(aircraft.callsign, 'vertical', time) ||
                this._recentlyIssued(aircraft.callsign, ACTION_INDEX.PROCEDURE, time, DEPARTURE_CLIMB_RETRY_SECONDS)) {
                return;
            }

            add(aircraft.callsign, ACTION_INDEX.PROCEDURE, 'climb via SID');
        });
    }

    /**
     * Whether a scheduled landing on this physical runway is too close for a departure
     */
    _arrivalNeedsRunwaySoon(physicalName, context) {
        const { runwayIndex, time } = context;
        const window = this.parameters.departureRunwayOccupancySeconds + this.parameters.arrivalDepartureMarginSeconds;

        return Object.keys(this._sequences).some((runwayName) => {
            if (runwayIndex.physicalName[runwayName] !== physicalName) {
                return false;
            }

            return this._sequences[runwayName].some((entry) => entry.sta >= time &&
                entry.sta - time < (entry.isEmergency ? Math.max(window, EMERGENCY.RUNWAY_PROTECTION_SECONDS) : window));
        });
    }

    // ----------------------------------------------------------------- arrivals

    _controlArrivals(context, add) {
        const { observation, runwayIndex, time } = context;
        const byRunway = {};

        observation.aircraft.forEach((aircraft) => {
            const runway = runwayIndex.runways[aircraft.arrivalRunway];

            if (aircraft.category !== 'arrival' || aircraft.isOnGround || !runway) {
                return;
            }

            if (!byRunway[runway.name]) {
                byRunway[runway.name] = [];
            }

            byRunway[runway.name].push(this._planArrival(aircraft, runway, context));
        });

        const departuresPending = this._departuresPendingByPhysicalRunway(context);

        this._balanceParallelRunways(byRunway, context, add);
        this._currentPlans = byRunway;
        // a join is kept while the aircraft is vectored to it; on final its real position counts
        Object.keys(this._joins).forEach((callsign) => {
            const aircraft = context.byCallsign[callsign];

            if (!aircraft || aircraft.isOnGround || classifyArrival(aircraft) !== ARRIVAL_MODE.VECTOR) {
                delete this._joins[callsign];
            }
        });
        this._sequences = {};

        Object.keys(byRunway).forEach((runwayName) => {
            const plans = byRunway[runwayName];
            const isMixedMode = departuresPending.has(runwayIndex.physicalName[runwayName]);
            const mixedGap = isMixedMode ? this.parameters.mixedModeGapSeconds : 0;
            const interval = (leader, follower) => Math.max(
                landingIntervalSeconds(leader.aircraft, follower.aircraft, observation, this.shield.margins),
                mixedGap
            );
            const frozen = plans
                .filter((plan) => plan.mode === ARRIVAL_MODE.FINAL || plan.etaMinimum - time < this.parameters.freezeSeconds)
                .sort((a, b) => a.etaMinimum - b.etaMinimum);
            const free = plans.filter((plan) => frozen.indexOf(plan) === -1);
            const optimized = optimizeSequence([...frozen, ...free].map((plan) => ({ ...plan, eta: plan.etaMinimum })), {
                intervalSeconds: interval,
                frozenCount: frozen.length,
                maxShift: this.parameters.maxPositionShift,
                previousOrder: (this.lastPlan.sequences[runwayName] || []).map((entry) => entry.id),
                stabilityCost: this.parameters.sequenceStabilitySeconds,
                iterations: 200,
                random: this._random
            });
            const order = this._prioritizeEmergencies(optimized);
            const times = scheduleSequence(order, interval, time);

            this._sequences[runwayName] = order.map((plan, i) => ({
                id: plan.id,
                callsign: plan.aircraft.callsign,
                eta: plan.etaMinimum,
                sta: times[i],
                isEmergency: Boolean(plan.aircraft.emergency)
            }));

            order.forEach((plan, i) => {
                if (plan.aircraft.isControllable) {
                    this._controlArrival(plan, times[i], context, add);
                }
            });
        });
    }

    /**
     * Aircraft in emergency land first: only the arrivals already on the localizer, or turning
     * onto it, that land before the emergency could stay ahead of it (ICAO Doc 4444 15.1.3).
     * Everyone else gets a later slot and makes room (speed, longer downwind, holding).
     */
    _prioritizeEmergencies(order) {
        const emergencies = order.filter((plan) => plan.aircraft.emergency).sort((a, b) => a.etaMinimum - b.etaMinimum);

        if (emergencies.length === 0) {
            return order;
        }

        const first = emergencies[0].etaMinimum;
        const isCommitted = (plan) => plan.mode === ARRIVAL_MODE.FINAL ||
            Boolean(this._joins[plan.aircraft.callsign] && this._joins[plan.aircraft.callsign].leg === PATTERN_LEG.INTERCEPT);
        const others = order.filter((plan) => !plan.aircraft.emergency);
        const ahead = others.filter((plan) => isCommitted(plan) && plan.etaMinimum <= first);

        return [...ahead, ...emergencies, ...others.filter((plan) => ahead.indexOf(plan) === -1)];
    }

    /**
     * Move arrivals far out to the parallel runway when it offers a clearly earlier slot,
     * preferring the runway on the aircraft's side so finals are not crossed. Aircraft in
     * emergency may move closer in, as soon as it saves a little time.
     */
    _balanceParallelRunways(byRunway, context, add) {
        const { observation, runwayIndex, time } = context;

        Object.keys(byRunway).forEach((runwayName) => {
            byRunway[runwayName].forEach((plan) => {
                const { aircraft } = plan;
                const memory = this._memoryOf(aircraft.callsign);
                const candidateName = parallelRunwayName(aircraft, observation);
                // a parallel too close for simultaneous approaches (e.g. 24R/24L at KLAX) needs the full radar
                // minimum between both finals: it adds no capacity and its arrivals meet those of this runway
                const parallelName = candidateName && dependentApproachMinimumNm(runwayName, candidateName, observation) <
                    observation.realism.separationMinima.radarNm ? candidateName : null;
                const isEmergency = Boolean(aircraft.emergency);
                const minimumDistance = isEmergency ? EMERGENCY.RUNWAY_CHOICE_MINIMUM_DISTANCE_NM : RUNWAY_CHOICE_MINIMUM_DISTANCE_NM;
                const checkInterval = isEmergency ? EMERGENCY.RUNWAY_CHOICE_INTERVAL_SECONDS : RUNWAY_CHOICE_INTERVAL_SECONDS;
                const join = this._joins[aircraft.callsign];
                const isOnPattern = plan.mode === ARRIVAL_MODE.ROUTE ||
                    (isEmergency && plan.mode === ARRIVAL_MODE.VECTOR && !(join && join.isLocked));

                // an aircraft in emergency changes runway once: going back and forth restarts its pattern
                if (!aircraft.isControllable || !parallelName || !isOnPattern || (isEmergency && memory.hasChangedRunway) ||
                    pathLength(plan.path) < minimumDistance ||
                    (memory.runwayCheckedAt !== undefined && time - memory.runwayCheckedAt < checkInterval)) {
                    return;
                }

                memory.runwayCheckedAt = time;

                const slot = (name) => {
                    const sequence = this._sequences[name] || [];
                    const others = sequence.filter((entry) => entry.callsign !== aircraft.callsign);
                    const last = others.length > 0 ? Math.max(...others.map((entry) => entry.sta)) : -Infinity;
                    const frame = runwayIndex.frames[name];
                    const sidePenalty = Math.abs(frame.lateral(aircraft)) >
                        Math.abs(runwayIndex.frames[name === runwayName ? parallelName : runwayName].lateral(aircraft)) ?
                        RUNWAY_SIDE_PENALTY_SECONDS : 0;

                    return Math.max(plan.etaMinimum, last + this.parameters.mixedModeGapSeconds / 2) + sidePenalty;
                };

                const minimumGain = isEmergency ? EMERGENCY.RUNWAY_CHANGE_MINIMUM_GAIN_SECONDS : RUNWAY_CHANGE_MINIMUM_GAIN_SECONDS;

                if (slot(parallelName) + minimumGain < slot(runwayName) &&
                    add(aircraft.callsign, ACTION_INDEX.PARALLEL_RUNWAY, `earlier slot on ${parallelName}`) !== null) {
                    memory.hasChangedRunway = true;
                }
            });
        });
    }

    _departuresPendingByPhysicalRunway(context) {
        const { observation, runwayIndex } = context;
        const pending = new Set();

        observation.aircraft.forEach((aircraft) => {
            if (aircraft.category === 'departure' &&
                (aircraft.flightPhase === 'WAITING' || aircraft.flightPhase === 'TAXI' || aircraft.flightPhase === 'LINE_UP')) {
                pending.add(runwayIndex.physicalName[aircraft.departureRunway || observation.airport.departureRunway]);
            }
        });

        return pending;
    }

    _planArrival(aircraft, runway, context) {
        const { observation, runwayIndex, time } = context;
        const frame = runwayIndex.frames[runway.name];
        const airportMinimum = minimumAssignableAltitude(
            { minimumVectoringAltitude: runway.minimumAltitudeOnFinal },
            observation
        );
        const pattern = patternGeometry(frame, this.parameters, airportMinimum);
        const mode = classifyArrival(aircraft);
        const naturalPath = buildArrivalPath(aircraft, frame, pattern);
        // from further out than the base turn, the arrival can also be vectored straight to the nominal join
        const directPath = mode === ARRIVAL_MODE.FINAL ? naturalPath : buildArrivalPath(aircraft, frame, pattern, 0, true);
        let path = pathLength(directPath) < pathLength(naturalPath) ? directPath : naturalPath;
        let isShortcut = false;

        // an aircraft in emergency leaves its STAR for radar vectors when that is clearly shorter
        if (aircraft.emergency && mode === ARRIVAL_MODE.ROUTE) {
            const vectorPath = [{ x: aircraft.x, y: aircraft.y }]
                .concat(completePattern(aircraft, aircraft.heading, frame, pattern, 0, true));

            if (pathLength(vectorPath) + EMERGENCY.SHORTCUT_MINIMUM_NM < pathLength(path)) {
                path = vectorPath;
                isShortcut = true;
            }
        }

        const etaMinimum = time + timeAlongPath(path, aircraft, frame, this.parameters, 0);
        const etaSlowest = mode === ARRIVAL_MODE.ROUTE ?
            time + timeAlongPath(path, aircraft, frame, this.parameters, 1) :
            etaMinimum;

        return {
            id: aircraft.callsign,
            aircraft,
            frame,
            pattern,
            mode,
            path,
            isShortcut,
            etaMinimum,
            etaSlowest,
            weight: DELAY_WEIGHT[aircraft.recatEu] || 1
        };
    }

    /**
     * `level` if it keeps the aircraft inside the airspace over the next part of `path`, otherwise
     * the closest level (not below `minimum`) that does, or `level` when none does. Sectors may
     * leave gaps between them in altitude (class B shelves), see `isInsideAirspaceAt`.
     */
    _levelInsideAirspace(path, level, minimum, context) {
        if (!hasAltitudeGaps(context.observation.airport.airspace)) {
            return level;
        }

        const points = samplePath(path.slice(0, -1), PATH_FLOOR_LOOKAHEAD_NM);
        const valid = levelsInsideAirspace(points, context.observation.airport.airspace,
            ALTITUDES.filter((candidate) => candidate >= minimum));

        if (valid.length === 0 || valid.indexOf(level) !== -1) {
            return level;
        }

        // the closest one, the higher one on a tie
        return valid.reduce((best, candidate) => (Math.abs(candidate - level) <= Math.abs(best - level) ? candidate : best));
    }

    _controlArrival(plan, scheduledTime, context, add) {
        const { aircraft } = plan;
        const { time } = context;
        const hasLateral = this._hasActiveResolution(aircraft.callsign, 'lateral', time) ||
            this._hasActiveResolution(aircraft.callsign, 'breakout', time);
        const hasVertical = this._hasActiveResolution(aircraft.callsign, 'vertical', time);

        if (plan.mode !== ARRIVAL_MODE.VECTOR) {
            this._memoryOf(aircraft.callsign).pattern = null;
        }

        if (aircraft.emergency && aircraft.isHoldAssigned) {
            add(aircraft.callsign, ACTION_INDEX.EXIT_HOLD, `emergency (${aircraft.emergency.description}): leave the hold`);

            return;
        }

        if (plan.isShortcut && !hasLateral) {
            this._leaveRouteForEmergency(plan, context, add);

            return;
        }

        if (plan.mode === ARRIVAL_MODE.FINAL) {
            this._controlFinal(plan, context, add);

            return;
        }

        if (plan.mode === ARRIVAL_MODE.ROUTE && !hasLateral) {
            this._controlOnRoute(plan, scheduledTime, context, add, hasVertical);

            return;
        }

        if (!hasLateral) {
            this._controlVectors(plan, scheduledTime, context, add, hasVertical);
        }
    }

    /**
     * An aircraft in emergency on its STAR is turned toward the shortest pattern to the localizer:
     * inbound to the base turn when it is further out, otherwise onto the downwind. From the next
     * cycle on it is vectored like any other.
     */
    _leaveRouteForEmergency(plan, context, add) {
        const { aircraft, frame, pattern } = plan;
        const lateral = frame.lateral(aircraft);
        const side = Math.abs(lateral) < 0.5 ? 1 : Math.sign(lateral);
        const heading = frame.along(aircraft) > pattern.baseTurnAlong + 1.5 ?
            bearing(aircraft, this._baseTurnPoint(frame, pattern, side)) :
            frame.downwindHeading;
        let action = headingAction(aircraft, heading);

        // already on the right heading: any heading takes it off the STAR
        if (action === ACTION_INDEX.NOOP) {
            action = headingAction(aircraft, headingReference(aircraft) + 5);
        }

        this._memoryOf(aircraft.callsign).pattern = null;
        add(aircraft.callsign, action, `emergency (${aircraft.emergency.description}): vectors for the shortest approach`);
    }

    /**
     * On final the spacing behind the aircraft ahead is kept with speed
     */
    _controlFinal(plan, context, add) {
        const { aircraft, frame } = plan;
        const clearedSpeed = aircraft.clearance.speedMode === 'HOLD' ? aircraft.clearance.speed : aircraft.speed;
        const { speed, reason } = this._spacingSpeed(
            plan, frame.along(aircraft), context.time, this.parameters.finalSpeed, context
        );

        if (Math.abs(clearedSpeed - speed) >= 10 && this._canChangeSpeed(aircraft.callsign, context.time)) {
            this._changeSpeed(aircraft, speed, context.time, reason || 'final approach speed', add);
        }
    }

    /**
     * The fastest speed, from `fastest` down to the landing speed, that keeps the required spacing
     * behind the aircraft ahead on the localizer down to the threshold, for an arrival on it
     * `along` nm out at `time`: the one ahead slows down to land in the last 5 nm and the gap shrinks
     *
     * @return {object} `{ speed, reason }`, `reason` null when the spacing does not limit the speed
     */
    _spacingSpeed(plan, along, time, fastest, context) {
        const { aircraft, frame } = plan;
        const ahead = this._finalStream(frame.name, aircraft.callsign, context)
            .filter((other) => other.joinTime <= context.time)
            .map((other) => ({ ...other, state: advanceOnFinal(other.state, time - context.time) }))
            .filter((other) => other.state.along > 0 && other.state.along < along)
            .sort((a, b) => b.state.along - a.state.along)[0];

        if (!ahead) {
            return { speed: fastest, reason: null };
        }

        const slowest = Math.max(aircraft.speedLimits.landing + 10, aircraft.speedLimits.min + 20);
        const required = finalSpacingNm(ahead.aircraft, aircraft, context.observation, this.shield.margins);
        const keepsSpacing = (speed) => minimumGapOnFinal(ahead.state, finalState(aircraft, along, frame.elevation, speed)) >=
            required;
        let speed = fastest;

        while (speed > slowest && !keepsSpacing(speed)) {
            speed = Math.max(slowest, speed - FINAL_SPEED_STEP_KNOTS);
        }

        return {
            speed,
            reason: speed < fastest ?
                `spacing behind ${ahead.aircraft.callsign}: ${required.toFixed(1)} nm down to the threshold` :
                null
        };
    }

    _controlOnRoute(plan, scheduledTime, context, add, hasVertical) {
        const { aircraft, path } = plan;
        const { time } = context;
        const p = this.parameters;
        const needed = scheduledTime - time;
        const remaining = pathLength(path);
        const memory = this._memoryOf(aircraft.callsign);

        // holding: each aircraft has its own level in the stack, and leaves from the bottom
        if (aircraft.isHoldAssigned) {
            this._controlHolding(plan, scheduledTime, context, add, hasVertical);

            return;
        }

        if (memory.hold) {
            // just left the hold: continue the descent on the STAR when it is clear
            memory.hold = null;
            memory.descentClearance = add(aircraft.callsign, ACTION_INDEX.PROCEDURE, 'leave the stack, descend via STAR') ===
                ACTION_INDEX.PROCEDURE;

            return;
        }

        const excessDelay = scheduledTime - plan.etaSlowest;
        const nextFix = nextPositionedWaypoint(aircraft);
        const canHoldThere = nextFix && nextFix.name !== memory.unusableHoldFix &&
            remaining - distance(aircraft, nextFix) >= p.holdMinimumDistanceNm &&
            distanceInsideAirspace(nextFix, context.observation.airport.airspace) >= HOLD_BOUNDARY_MARGIN_NM;

        if (excessDelay > p.holdThresholdSeconds && canHoldThere &&
            !this._recentlyIssued(aircraft.callsign, ACTION_INDEX.HOLD, time, 120)) {
            const level = this._holdingLevel(nextFix, aircraft, context);

            // a full stack takes nobody else: the delay is absorbed with speed and the downwind
            if (level !== null) {
                memory.hold = { fix: nextFix.name, level };
                add(aircraft.callsign, ACTION_INDEX.HOLD, `hold at ${nextFix.name} at ${level} ft, ` +
                    `${Math.round(excessDelay)} s of delay left`);

                return;
            }
        }

        // descend via the STAR once under our control
        if (!hasVertical && aircraft.clearance.altitudeMode !== 'VNAV' && !memory.descentClearance) {
            const given = add(aircraft.callsign, ACTION_INDEX.PROCEDURE, 'descend via STAR');

            // while traffic is in the way the aircraft descends in steps and is cleared via the STAR later
            memory.descentClearance = given === ACTION_INDEX.PROCEDURE;

            if (given !== null) {
                return;
            }
        }

        // after the last altitude restriction, descend progressively along the descent profile,
        // 1000 ft at a time, down to the downwind altitude
        const restrictionsAhead = (aircraft.waypoints || []).some((waypoint) => waypoint.altitudeMinimum !== null ||
            waypoint.altitudeMaximum !== null);
        const targetAltitude = this._levelInsideAirspace(path, Math.max(
            plan.pattern.downwindAltitude,
            profileAltitude(remaining, plan.pattern, p),
            pathFloorLevel(path, context.observation.airport.airspace)
        ), 0, context);

        if (!hasVertical && !restrictionsAhead && aircraft.clearance.altitude - targetAltitude >= 1000 &&
            add(aircraft.callsign, altitudeAction(targetAltitude), 'descend on the descent profile') !== null) {
            return;
        }

        // only routes that end on the centerline lead to the localizer; others are vectored first
        const positioned = (aircraft.waypoints || []).filter((waypoint) => waypoint.x !== null);
        const lastFix = positioned[positioned.length - 1];
        const endsOnCenterline = Boolean(lastFix) && Math.abs(plan.frame.lateral(lastFix)) < 1.5 &&
            plan.frame.along(lastFix) > 0;

        if (endsOnCenterline && !aircraft.hasApproachClearance && remaining <= p.ilsClearanceDistanceNm &&
            !this._recentlyIssued(aircraft.callsign, ACTION_INDEX.ILS, time)) {
            add(aircraft.callsign, ACTION_INDEX.ILS, 'cleared for the ILS');

            return;
        }

        this._controlSpeed(plan, needed, remaining, time, add);
    }

    _canChangeSpeed(callsign, time) {
        const memory = this._memoryOf(callsign);

        return !this._hasActiveResolution(callsign, 'speed', time) &&
            (memory.lastSpeedChange === undefined || time - memory.lastSpeedChange >= SPEED_CHANGE_INTERVAL_SECONDS);
    }

    _changeSpeed(aircraft, speed, time, reason, add) {
        if (!this._canChangeSpeed(aircraft.callsign, time)) {
            return;
        }

        this._memoryOf(aircraft.callsign).lastSpeedChange = time;
        add(aircraft.callsign, speedAction(speed), reason);
    }

    _controlSpeed(plan, needed, remaining, time, add) {
        const { aircraft } = plan;
        const p = this.parameters;
        const slowFraction = aircraft.emergency ? 0 : this._slowFractionFor(plan, needed);
        const target = plannedSpeed(remaining, aircraft.altitude, p, slowFraction, aircraft.speedLimits);
        const cleared = aircraft.clearance.speedMode === 'HOLD' ? aircraft.clearance.speed : null;
        const isAtNominal = slowFraction < 0.05 && remaining > 30;

        if (isAtNominal && cleared === null) {
            // let the procedure speeds apply
            return;
        }

        const reference = cleared === null ? aircraft.speed : cleared;

        if (Math.abs(reference - target) >= 10 || (cleared === null && aircraft.speed > target + 5)) {
            this._changeSpeed(aircraft, target, time, slowFraction > 0.05 ? 'absorb delay with speed' : 'approach speed', add);
        }
    }

    /**
     * Holding aircraft keep their level in the stack, move down as lower levels free up,
     * and leave from the bottom when their landing slot comes
     */
    _controlHolding(plan, scheduledTime, context, add, hasVertical) {
        const { aircraft } = plan;
        const memory = this._memoryOf(aircraft.callsign);
        const nextFix = nextPositionedWaypoint(aircraft);

        if (!memory.hold) {
            memory.hold = { fix: nextFix ? nextFix.name : '', level: Math.round(aircraft.altitude / 1000) * 1000 };
        }

        // the hold entry can take an aircraft far from the fix, even out of the airspace: back to the fix
        if (nextFix && isTrackLeavingAirspace(aircraft, context.observation, BOUNDARY_RESUME_SECONDS) &&
            !this._recentlyIssued(aircraft.callsign, ACTION_INDEX.DIRECT_NEXT, context.time, 60)) {
            // that fix cannot contain this hold: the rest of the delay is absorbed some other way
            memory.unusableHoldFix = nextFix.name;
            add(aircraft.callsign, ACTION_INDEX.DIRECT_NEXT, `back to ${nextFix.name}, the hold is leaving the airspace`);

            return;
        }

        const stack = this._holdingStack(memory.hold.fix, aircraft.callsign, context);
        const isLowest = stack.every((level) => level > memory.hold.level);

        if (isLowest && plan.etaMinimum >= scheduledTime - this.parameters.holdExitMarginSeconds) {
            add(aircraft.callsign, ACTION_INDEX.EXIT_HOLD, 'leave the hold for the landing slot');

            return;
        }

        const lowerLevel = memory.hold.level - 1000;
        const base = this._holdingBaseLevel(nextFix, aircraft, context);

        // move down only once the aircraft below has really left the level
        if (lowerLevel >= base && stack.indexOf(lowerLevel) === -1 &&
            Math.abs(aircraft.altitude - memory.hold.level) < 200 &&
            safeLevelToward(aircraft, lowerLevel, context.observation, this.parameters) === lowerLevel) {
            memory.hold.level = lowerLevel;
        }

        if (!hasVertical && aircraft.clearance.altitude !== memory.hold.level) {
            add(aircraft.callsign, altitudeAction(memory.hold.level), `holding level ${memory.hold.level} at ${memory.hold.fix}`);
        }
    }

    /**
     * Levels taken in the stack of a fix: only by aircraft really holding there, a level is
     * not kept for an aircraft that was vectored out of the hold
     */
    _holdingStack(fixName, exceptCallsign, context) {
        return Object.keys(this._memory)
            .filter((callsign) => callsign !== exceptCallsign && this._memory[callsign].hold &&
                this._memory[callsign].hold.fix === fixName && context.byCallsign[callsign] &&
                context.byCallsign[callsign].isHoldAssigned)
            .map((callsign) => this._memory[callsign].hold.level);
    }

    _holdingBaseLevel(fix, aircraft, context) {
        const restriction = fix ? Math.max(fix.altitudeMinimum || 0, fix.altitudeMaximum || 0) : 0;

        // above the terrain all around, so the aircraft can be turned out of the hold if needed
        return Math.max(
            Math.ceil(this._minimumAltitude(aircraft, context.observation) / 1000) * 1000,
            Math.ceil((aircraft.minimumVectoringAltitudeAround || 0) / 1000) * 1000,
            // the pattern may cross into a sector with a higher floor
            aircraft.airspaceFloorAround ? Math.ceil((aircraft.airspaceFloorAround + 500) / 1000) * 1000 : 0,
            Math.ceil(restriction / 1000) * 1000
        );
    }

    /**
     * Level for a new aircraft in the stack: the lowest free level that does not make it descend
     * through the levels already occupied, up to the top of the airspace and of the assignable
     * levels. If the stack is full, the lowest free level, or null when there is none.
     */
    _holdingLevel(fix, aircraft, context) {
        const stack = this._holdingStack(fix.name, aircraft.callsign, context);
        const base = this._holdingBaseLevel(fix, aircraft, context);
        const top = stack.length > 0 ? Math.max(...stack) + 1000 : base;
        const highest = Math.min(ALTITUDES[ALTITUDES.length - 1], airspaceMaximumAltitude(aircraft));
        const level = Math.max(base, top);

        if (level <= highest) {
            return level;
        }

        const free = ALTITUDES.find((candidate) => candidate >= base && candidate <= highest && stack.indexOf(candidate) === -1);

        return free === undefined ? null : free;
    }

    /**
     * Speed reduction (0 nominal, 1 slowest) that makes the arrival land `needed` seconds from now
     */
    _slowFractionFor(plan, needed) {
        const { aircraft, frame, path } = plan;

        if (needed <= timeAlongPath(path, aircraft, frame, this.parameters, 0) + SPEED_DELAY_TOLERANCE_SECONDS) {
            return 0;
        }

        let low = 0;
        let high = 1;

        for (let i = 0; i < 8; i++) {
            const middle = (low + high) / 2;

            if (timeAlongPath(path, aircraft, frame, this.parameters, middle) < needed) {
                low = middle;
            } else {
                high = middle;
            }
        }

        return high;
    }

    /**
     * Minimum vectoring altitude under the first `lengthNm` of a path, rounded up to the next
     * thousand feet. The terrain is judged along the path the aircraft is going to fly, as the
     * engine does (it checks the minimum where the aircraft is), not all around it. The aircraft
     * does not fly the path exactly, so the highest value close to each side of it counts.
     *
     * @return {number|null} ft, null without terrain data (or without the query, in an old observation)
     */
    _terrainLevelAlong(path, context, lengthNm = Infinity) {
        const query = context.observation.airport.minimumVectoringAltitudeAt;

        if (typeof query !== 'function' || path.length === 0) {
            return null;
        }

        const m = TERRAIN_PATH_MARGIN_NM;
        const nearby = (x, y) => [[0, 0], [-m, -m], [-m, m], [m, -m], [m, m]].reduce((highest, [dx, dy]) => {
            const value = query(x + dx, y + dy);

            return value !== null && (highest === null || value > highest) ? value : highest;
        }, null);
        const highest = highestAlongPath(path, nearby, lengthNm, TERRAIN_PATH_STEP_NM);

        return highest === null ? null : Math.ceil(highest / 1000) * 1000;
    }

    /**
     * `pattern` with its intercept altitude raised to the terrain at the join, and whether the
     * terrain lets the aircraft get there: flying `legs` (the base and the intercept leg, ending
     * at the join) it comes down progressively. It must cross the localizer below the glidepath,
     * and each mile before the join it may still be one step of the descent higher. The terrain
     * at the join itself must leave it level before the glidepath comes down to it.
     */
    _patternOverTerrain(pattern, frame, joinAlong, legs, context) {
        const query = context.observation.airport.minimumVectoringAltitudeAt;

        if (typeof query !== 'function' || legs.length === 0) {
            return { pattern, isJoinable: true };
        }

        const levelAt = (point) => Math.ceil((query(point.x, point.y) || 0) / 1000) * 1000;
        const joinAltitude = Math.max(pattern.interceptAltitude, levelAt(legs[legs.length - 1]));
        const descent = this.parameters.descentGradientFtPerNm * DESCENT_CAPABILITY_FACTOR;
        const highestAtJoin = Math.max(joinAltitude, frame.glidepathAltitude(joinAlong) - JOIN_BELOW_GLIDEPATH_FT);
        let isJoinable = joinAltitude <= frame.glidepathAltitude(joinAlong - JOIN_GLIDEPATH_MARGIN_NM);
        let beforeJoin = 0;

        for (let k = legs.length - 1; k > 0 && isJoinable; k--) {
            const from = legs[k];
            const to = legs[k - 1];
            const length = distance(from, to);

            for (let flown = 1; flown <= length; flown += 1) {
                const point = { x: from.x + (to.x - from.x) * flown / length, y: from.y + (to.y - from.y) * flown / length };

                if (levelAt(point) > highestAtJoin + (beforeJoin + flown) * descent) {
                    isJoinable = false;

                    break;
                }
            }

            beforeJoin += length;
        }

        return {
            pattern: joinAltitude === pattern.interceptAltitude ? pattern : {
                ...pattern,
                interceptAltitude: joinAltitude,
                downwindAltitude: Math.max(pattern.downwindAltitude, joinAltitude)
            },
            isJoinable
        };
    }

    /**
     * Radar vectors to the localizer as a forward-only sequence of legs: downwind (or inbound
     * from further out), base, intercept, then the approach clearance. The point where the
     * aircraft joins the localizer is chosen anywhere along it, in the gap of the final stream
     * that matches its landing slot.
     */
    _controlVectors(plan, scheduledTime, context, add, hasVertical) {
        const { aircraft, frame } = plan;
        const { time } = context;
        const p = this.parameters;
        const memory = this._memoryOf(aircraft.callsign);
        const along = frame.along(aircraft);
        const lateral = frame.lateral(aircraft);
        const absoluteLateral = Math.abs(lateral);
        const isClosing = this._isClosingCenterline(aircraft, frame);

        if (!memory.pattern || memory.pattern.runway !== frame.name) {
            const side = absoluteLateral < 0.5 ? 1 : Math.sign(lateral);

            memory.pattern = {
                runway: frame.name,
                // the side of the final the aircraft is on, unless the airspace leaves much more room on the other
                side: this._downwindLimitNm(frame, -side, context) - this._downwindLimitNm(frame, side, context) >
                    PATTERN_SIDE_ADVANTAGE_NM ? -side : side,
                leg: null
            };
        }

        // the join is chosen while the aircraft can still go anywhere; from the base on it is where the turn leads
        const isChoosing = memory.pattern.leg === null || memory.pattern.leg === PATTERN_LEG.DOWNWIND ||
            memory.pattern.leg === PATTERN_LEG.INBOUND;
        const chosen = isChoosing ?
            this._chooseJoin(plan, scheduledTime, context, memory.pattern.joinAlong, memory.pattern.side) :
            null;

        if (memory.pattern.leg === null) {
            memory.pattern.leg = this._initialPatternLeg(aircraft, frame, chosen.pattern, isClosing);
        }

        const leg = this._nextPatternLeg(memory.pattern, plan, chosen, scheduledTime, context, {
            along, lateral, absoluteLateral
        });

        memory.pattern.leg = leg;

        const join = chosen && (leg === PATTERN_LEG.DOWNWIND || leg === PATTERN_LEG.INBOUND) ?
            chosen :
            this._naturalJoin(plan, leg, context);
        const { pattern } = join;

        memory.pattern.joinAlong = join.along;

        // others plan around this join; an aircraft waiting for a gap has none yet
        if (join.isWaiting) {
            delete this._joins[aircraft.callsign];
        } else {
            this._joins[aircraft.callsign] = {
                runway: frame.name,
                along: join.along,
                time: join.joinTime,
                scheduledTime,
                leg,
                // from the base on the aircraft no longer moves its join
                isLocked: leg === PATTERN_LEG.BASE || leg === PATTERN_LEG.INTERCEPT
            };
        }

        // cleared for the approach and converging on the localizer: a heading would cancel the clearance
        if (leg === PATTERN_LEG.INTERCEPT && aircraft.hasApproachClearance && isClosing) {
            this._vectoringSpeed(plan, leg, join, context, add);

            return;
        }

        // on the intercept leg, converge smoothly: 30 degrees far out, aligned on the centerline
        const correction = Math.max(-p.interceptAngle, Math.min(p.interceptAngle, -lateral * LOCALIZER_GAIN_DEGREES_PER_NM));
        let desiredHeading = frame.course + correction;

        if (leg === PATTERN_LEG.DOWNWIND) {
            // reciprocal of the final course, corrected toward the downwind's lateral offset
            const lateralError = memory.pattern.side * p.downwindLateralNm - lateral;
            const downwindCorrection = Math.max(-45, Math.min(45, lateralError * LOCALIZER_GAIN_DEGREES_PER_NM));

            desiredHeading = frame.downwindHeading - downwindCorrection;
        } else if (leg === PATTERN_LEG.INBOUND) {
            desiredHeading = bearing(aircraft, this._baseTurnPoint(frame, pattern, memory.pattern.side));
        } else if (leg === PATTERN_LEG.BASE) {
            desiredHeading = frame.baseHeading(aircraft);
        }

        const legName = leg === PATTERN_LEG.INTERCEPT ? leg : `${leg}, joining at ${join.along.toFixed(1)} nm`;

        if (Math.abs(headingDifference(headingReference(aircraft), desiredHeading)) >= HEADING_TOLERANCE_DEGREES) {
            add(aircraft.callsign, headingAction(aircraft, desiredHeading), `vectors: ${legName}`);

            return;
        }

        // on the downwind and the base the aircraft descends progressively along the descent profile,
        // which ends at the intercept altitude at the intercept point; on the intercept leg it must be
        // at the intercept altitude to join the glidepath from below
        const isOnIntercept = leg === PATTERN_LEG.INTERCEPT;
        const legFloor = leg === PATTERN_LEG.BASE || isOnIntercept ? pattern.interceptAltitude : pattern.downwindAltitude;
        const patternAltitude = isOnIntercept ?
            pattern.interceptAltitude :
            Math.max(legFloor, profileAltitude(pathLength(join.path), pattern, p));
        // the terrain under the downwind may be higher than on final: the aircraft stays above the
        // terrain under the next miles of the path it is going to fly, which steps down toward the
        // join (all around it when the path cannot be looked up)
        const isFarOut = leg === PATTERN_LEG.DOWNWIND || leg === PATTERN_LEG.INBOUND;
        const terrainOnPath = this._terrainLevelAlong(
            join.path.slice(0, -1), context, isFarOut ? PATH_FLOOR_LOOKAHEAD_NM : TERRAIN_LOOKAHEAD_ON_BASE_NM
        );
        const terrainAround = isFarOut ? Math.ceil((aircraft.minimumVectoringAltitudeAround || 0) / 1000) * 1000 : 0;
        const terrainAhead = terrainOnPath === null ? terrainAround : terrainOnPath;
        // terrain and airspace floor: these always win, even if the aircraft has to climb for them
        const safetyMinimum = Math.max(
            terrainAhead,
            Math.ceil(this._minimumAltitude(aircraft, context.observation) / 1000) * 1000,
            pathFloorLevel(join.path, context.observation.airport.airspace)
        );
        const targetAltitude = this._levelInsideAirspace(join.path, Math.max(patternAltitude, safetyMinimum), safetyMinimum, context);
        // a vectored aircraft still descending via its STAR (VNAV) keeps obeying the STAR's restrictions,
        // whatever its cleared altitude says: it needs an explicit level, never above where it is
        const isVnav = aircraft.clearance.altitudeMode === 'VNAV';
        const level = isVnav && !isOnIntercept && targetAltitude > aircraft.altitude ?
            Math.max(Math.ceil((aircraft.altitude - 100) / 1000) * 1000, safetyMinimum) :
            targetAltitude;
        // never climb back on the downwind or the base: the profile only goes down. Unless the aircraft
        // is below the terrain or the airspace floor there (e.g. back on the downwind after a low intercept)
        const isClimbBack = !isVnav && !isOnIntercept && level > aircraft.clearance.altitude &&
            aircraft.clearance.altitude >= legFloor && aircraft.clearance.altitude >= safetyMinimum &&
            this._levelInsideAirspace(join.path, aircraft.clearance.altitude, 0, context) === aircraft.clearance.altitude;
        // (giving the level before the heading was tried and was worse: 24 episodes, -12755 against -9635)
        if (!hasVertical && !isClimbBack && (isVnav || aircraft.clearance.altitude !== level) &&
            !this._recentlyIssued(aircraft.callsign, altitudeAction(level), time, 20) &&
            add(aircraft.callsign, altitudeAction(level), `altitude for ${leg}`) !== null) {
            return;
        }

        // heading first, then the approach clearance (a later heading would cancel it), and only
        // when the aircraft will join the localizer below the glidepath
        const interceptAlong = along - Math.max(0, absoluteLateral) / Math.tan(p.interceptAngle * Math.PI / 180);
        // where it will be when it gets there, if it is still coming down to its cleared level
        const altitudeAtJoin = Math.max(
            Math.min(aircraft.altitude, aircraft.clearance.altitude),
            aircraft.altitude - absoluteLateral / Math.sin(p.interceptAngle * Math.PI / 180) * p.descentGradientFtPerNm
        );
        const isBelowGlidepath = altitudeAtJoin <= frame.glidepathAltitude(interceptAlong) - 100;

        if (!aircraft.hasApproachClearance && isOnIntercept && isBelowGlidepath &&
            !this._recentlyIssued(aircraft.callsign, ACTION_INDEX.ILS, time)) {
            add(aircraft.callsign, ACTION_INDEX.ILS, 'cleared for the ILS');

            return;
        }

        this._vectoringSpeed(plan, leg, join, context, add);
    }

    _isClosingCenterline(aircraft, frame) {
        const unit = headingVector(aircraft.heading);
        const right = frame.point(0, 1);
        const lateralRate = unit.x * (right.x - frame.threshold.x) + unit.y * (right.y - frame.threshold.y);

        return lateralRate * frame.lateral(aircraft) < 0;
    }

    _baseTurnPoint(frame, pattern, side) {
        return frame.point(pattern.baseTurnAlong, side * (pattern.interceptLateral + 1));
    }

    _initialPatternLeg(aircraft, frame, pattern, isClosing) {
        const along = frame.along(aircraft);
        const absoluteLateral = Math.abs(frame.lateral(aircraft));

        if (isClosing && absoluteLateral <= pattern.interceptLateral + 0.5 && along >= pattern.minimumJoinAlong - 1) {
            return PATTERN_LEG.INTERCEPT;
        }

        // close to the centerline and flying toward the runway from beyond the join: it continues
        // onto the localizer, a downwind would turn it around
        if (absoluteLateral <= pattern.interceptLateral + 1 && along >= pattern.minimumJoinAlong - 1 &&
            Math.abs(headingDifference(aircraft.heading, frame.course)) <= TOWARD_RUNWAY_DEGREES) {
            return PATTERN_LEG.INTERCEPT;
        }

        if (along > pattern.baseTurnAlong + 1.5 && absoluteLateral > pattern.interceptLateral + 1) {
            return PATTERN_LEG.INBOUND;
        }

        if (isClosing && along >= pattern.baseTurnAlong - 2) {
            return PATTERN_LEG.BASE;
        }

        return PATTERN_LEG.DOWNWIND;
    }

    _nextPatternLeg(state, plan, chosen, scheduledTime, context, geometry) {
        const { aircraft, frame } = plan;
        const p = this.parameters;
        const { along, lateral, absoluteLateral } = geometry;
        const backToDownwind = () => {
            const side = Math.sign(lateral) || state.side;

            // back on the side it is on, unless the airspace leaves much more room on the other one
            state.side = this._downwindLimitNm(frame, -side, context) - this._downwindLimitNm(frame, side, context) >
                PATTERN_SIDE_ADVANTAGE_NM ? -side : side;

            return PATTERN_LEG.DOWNWIND;
        };

        switch (state.leg) {
            case PATTERN_LEG.DOWNWIND: {
                const { pattern } = chosen;
                // high aircraft need more track miles to descend: it turns when what is left to the
                // join is enough to come down to the intercept altitude
                const isLowEnough = aircraft.altitude - pattern.interceptAltitude <=
                    (pathLength(chosen.path) - chosen.along) * p.descentGradientFtPerNm * DESCENT_CAPABILITY_FACTOR;
                const isFarEnough = along >= pattern.baseTurnAlong - 0.5 && absoluteLateral > pattern.interceptLateral + 0.5;

                const isLeavingAirspace = isTrackLeavingAirspace(aircraft, context.observation, BOUNDARY_RESUME_SECONDS);

                // too close in for a base turn, and this side of the final leads out of the airspace: the
                // downwind moves to the other side, once (if that one leads out too, it turns base)
                if (isLeavingAirspace && along < pattern.baseTurnAlong - 0.5 && !state.hasChangedSide) {
                    state.side = -state.side;
                    state.hasChangedSide = true;

                    return PATTERN_LEG.DOWNWIND;
                }

                // the downwind is never extended beyond its maximum or out of the airspace, whatever the altitude
                if (isLeavingAirspace ||
                    along >= Math.min(p.maximumBaseTurnDistanceNm, this._downwindLimitNm(frame, state.side, context))) {
                    // at the edge of the airspace: the base is not extended back onto this downwind
                    state.isAtBoundary = state.isAtBoundary || isLeavingAirspace;

                    return PATTERN_LEG.BASE;
                }

                // an aircraft in emergency turns back as soon as it is past its base turn, even close to the
                // centerline: a longer downwind leads it away, under higher airspace floors
                if (aircraft.emergency && !chosen.isWaiting && along >= pattern.baseTurnAlong - 0.5) {
                    return absoluteLateral <= pattern.interceptLateral + 0.5 ? PATTERN_LEG.INTERCEPT : PATTERN_LEG.BASE;
                }

                return isFarEnough && isLowEnough && !chosen.isWaiting ? PATTERN_LEG.BASE : PATTERN_LEG.DOWNWIND;
            }
            case PATTERN_LEG.INBOUND: {
                const { pattern } = chosen;

                if (absoluteLateral <= pattern.interceptLateral + 0.5) {
                    return PATTERN_LEG.INTERCEPT;
                }

                if (along <= pattern.baseTurnAlong + 0.5 ||
                    distance(aircraft, this._baseTurnPoint(frame, pattern, state.side)) < 1) {
                    return PATTERN_LEG.BASE;
                }

                return PATTERN_LEG.INBOUND;
            }
            case PATTERN_LEG.BASE: {
                if (absoluteLateral <= plan.pattern.interceptLateral + 0.3) {
                    return PATTERN_LEG.INTERCEPT;
                }

                const join = this._naturalJoin(plan, PATTERN_LEG.BASE, context);
                // room to extend: not beyond the longest downwind, nor out of the airspace on this side
                const canExtend = !state.isAtBoundary &&
                    along < Math.min(p.maximumBaseTurnDistanceNm, this._downwindLimitNm(frame, state.side, context)) - 2;
                const isEmergency = Boolean(aircraft.emergency);

                // the traffic on the localizer leaves no gap where this base leads: extend rather than join too close
                // (an aircraft in emergency only gives way to those already on the localizer or turning onto it)
                if (canExtend && this._joinSpacingMargin(plan, join.along, join.joinTime, scheduledTime, context, 0, isEmergency) <
                    -BASE_SPACING_TOLERANCE_NM) {
                    return backToDownwind();
                }

                // too high to come down to the glidepath by the join: break off and descend on a new downwind
                if (canExtend && aircraft.altitude - frame.glidepathAltitude(join.along) >
                    distance(aircraft, join.path[1]) * p.descentGradientFtPerNm * DESCENT_CAPABILITY_FACTOR) {
                    return backToDownwind();
                }

                return PATTERN_LEG.BASE;
            }
            default:
                // not cleared before getting close, or drifting away: start over from the downwind
                if ((!aircraft.hasApproachClearance && along < plan.pattern.minimumJoinAlong - 2) ||
                    absoluteLateral > plan.pattern.interceptLateral + 3) {
                    return backToDownwind();
                }

                return PATTERN_LEG.INTERCEPT;
        }
    }

    /**
     * Speed on the pattern; from the base on, also slower if needed to keep the spacing on the localizer
     */
    _vectoringSpeed(plan, phase, join, context, add) {
        const { aircraft } = plan;
        const p = this.parameters;
        const isFarOut = phase === PATTERN_LEG.DOWNWIND || phase === PATTERN_LEG.INBOUND;
        // an aircraft in emergency is kept faster until the base
        const farOutSpeed = aircraft.emergency ? p.intermediateSpeed : Math.min(p.intermediateSpeed, 210);
        const spacing = isFarOut ?
            { speed: farOutSpeed, reason: null } :
            this._spacingSpeed(plan, join.along, join.joinTime, p.baseSpeed, context);
        const cleared = aircraft.clearance.speedMode === 'HOLD' ? aircraft.clearance.speed : aircraft.speed;

        if (Math.abs(cleared - spacing.speed) >= 10) {
            this._changeSpeed(aircraft, spacing.speed, context.time, spacing.reason || `speed for ${phase}`, add);
        }
    }

    // --------------------------------------------------------- joining the final

    /**
     * Arrivals to the same runway that are on final or committed to their join (on the base or
     * the intercept leg) are spaced by the join planning, not by conflict resolution. On the
     * downwind or inbound they can still meet anyone, so they are not.
     */
    _isSpacedByPattern(a, b) {
        const isCommitted = (aircraft) => classifyArrival(aircraft) === ARRIVAL_MODE.FINAL ||
            Boolean(this._joins[aircraft.callsign] && this._joins[aircraft.callsign].isLocked);

        return a.category === 'arrival' && b.category === 'arrival' && a.arrivalRunway === b.arrivalRunway &&
            isCommitted(a) && isCommitted(b);
    }

    /**
     * Two arrivals spaced by the pattern (see `_isSpacedByPattern`) with no loss of separation
     * really coming. The pattern spaces them with the spacing required on final, which is less
     * than the margin kept between any two other aircraft.
     */
    _isKeptApartByPattern(a, b, observation) {
        const { radarNm, verticalFt } = observation.realism.separationMinima;

        return this._isSpacedByPattern(a, b) &&
            predictLoss(a, b, radarNm + PATTERN_CONFLICT_BUFFER_NM, verticalFt, IMMINENT_CONFLICT_SECONDS) === null;
    }

    /**
     * Where and when an arrival joins the localizer `joinAlong` nm from the threshold,
     * vectored there from where it is, and when it lands
     *
     * @return {object} `{ along, pattern, path, joinTime, landingTime }`
     */
    _evaluateJoin(plan, joinAlong, context) {
        const { aircraft, frame } = plan;
        const p = this.parameters;
        const nominal = joinPattern(plan.pattern, frame, joinAlong);
        const path = buildArrivalPath(aircraft, frame, nominal, 0, true);
        // the base and the intercept leg are flown at the intercept altitude: the last three points before the threshold
        const { pattern, isJoinable } = this._patternOverTerrain(nominal, frame, joinAlong, path.slice(-4, -1), context);
        const joinTime = context.time + timeAlongPath(path.slice(0, -1), aircraft, frame, p, 0, joinAlong);
        const landingTime = joinTime + timeToThreshold(finalState(aircraft, joinAlong, frame.elevation, p.finalSpeed));

        return {
            along: joinAlong, pattern, path, joinTime, landingTime, isJoinable
        };
    }

    /**
     * Furthest base turn on one side of the final for which the downwind, the base and the final
     * stay `PATTERN_BOUNDARY_MARGIN_NM` inside the airspace, scanning out from the threshold
     * (fixed for an airport, so it is cached)
     *
     * @return {number} nm from the threshold
     */
    _downwindLimitNm(frame, side, context) {
        const p = this.parameters;
        const key = `${context.observation.airport.icao}|${frame.name}|${side}`;

        if (!(key in this._downwindLimits)) {
            const { airspace, elevation, restrictedAreas } = context.observation.airport;
            const altitude = elevation + RESTRICTED_AREA.PATTERN_ALTITUDE_FT;
            let limit = 0;

            for (let along = JOIN_STEP_NM; along <= p.maximumBaseTurnDistanceNm + 0.01; along += JOIN_STEP_NM) {
                const points = [
                    frame.point(along, 0),
                    frame.point(along, side * (p.interceptLateralNm + 1)),
                    frame.point(along, side * p.downwindLateralNm)
                ];

                if (points.some((point) => restrictedAreaAt(point, altitude, restrictedAreas)) ||
                    points.some((point) => distanceInsideAirspace(point, airspace) < PATTERN_BOUNDARY_MARGIN_NM)) {
                    break;
                }

                limit = along;
            }

            this._downwindLimits[key] = limit;
        }

        return this._downwindLimits[key];
    }

    /**
     * Join point the aircraft is heading for on the base or the intercept leg
     */
    _naturalJoin(plan, leg, context) {
        const { aircraft, frame } = plan;
        const p = this.parameters;
        const cotangent = 1 / Math.tan(p.interceptAngle * Math.PI / 180);
        const absoluteLateral = Math.abs(frame.lateral(aircraft));
        const lateralOnIntercept = Math.min(absoluteLateral, plan.pattern.interceptLateral);
        const along = Math.max(0.5, frame.along(aircraft) - lateralOnIntercept * cotangent);
        const flown = Math.max(0, absoluteLateral - lateralOnIntercept) +
            lateralOnIntercept / Math.sin(p.interceptAngle * Math.PI / 180);
        const speed = leg === PATTERN_LEG.INTERCEPT ? aircraft.speed : p.baseSpeed;
        const joinTime = context.time + flown / (Math.max(120, speed) * trueAirspeedFactor(aircraft.altitude)) * 3600;
        const path = [{ x: aircraft.x, y: aircraft.y }, frame.point(along, 0), frame.threshold];
        const { pattern } = this._patternOverTerrain(
            joinPattern(plan.pattern, frame, Math.max(along, plan.pattern.minimumJoinAlong)), frame, along, path.slice(1, 2), context
        );

        return {
            along,
            pattern,
            path,
            joinTime,
            landingTime: joinTime + timeToThreshold(finalState(aircraft, along, frame.elevation, p.finalSpeed))
        };
    }

    /**
     * The join that lands the arrival closest to its slot, with the required spacing (wake and
     * radar, including the compression in the last miles) from everyone on the localizer or
     * already committed to join it. Landing before the slot is fine (it costs little), landing
     * after it is what must be avoided. Joins the terrain does not allow (the aircraft could not
     * be level below the glidepath) or the aircraft cannot descend for are left out. Joins closer
     * than the nominal one shorten the approach: they need a larger margin and are only taken
     * when the arrival is late, or when every longer join would get in the way of the others,
     * ahead or behind. Without a join the aircraft waits on the longest pattern.
     *
     * @return {object} see `_evaluateJoin`, plus `isWaiting`
     */
    _chooseJoin(plan, scheduledTime, context, previousJoinAlong = null, side = 1) {
        const { aircraft, pattern } = plan;
        const p = this.parameters;
        const legToJoin = pattern.baseTurnAlong - pattern.interceptAlong;
        const longestBase = Math.min(p.maximumBaseTurnDistanceNm, this._downwindLimitNm(plan.frame, side, context));
        const maximum = Math.max(pattern.minimumJoinAlong, Math.min(
            Math.max(pattern.interceptAlong, p.maximumBaseTurnDistanceNm - legToJoin),
            longestBase - legToJoin
        ));
        // an aircraft in emergency takes the earliest landing: shortened approaches are not penalized,
        // and only the arrivals already on the localizer or turning onto it are in its way
        const isEmergency = Boolean(aircraft.emergency);
        const costOf = (join) => {
            const change = previousJoinAlong === null ? 0 : Math.abs(join.along - previousJoinAlong);
            const delay = join.landingTime - scheduledTime;
            const timeCost = delay >= 0 ? delay : -delay * JOIN_EARLY_WEIGHT;

            return (isEmergency ? join.landingTime : timeCost) + change * JOIN_CHANGE_SECONDS_PER_NM;
        };
        const isFlyable = (join) => join.isJoinable &&
            aircraft.altitude - join.pattern.interceptAltitude <=
                (pathLength(join.path) - join.along) * p.descentGradientFtPerNm * DESCENT_CAPABILITY_FACTOR;
        let best = null;
        // whether some join at or beyond the nominal one fits everyone, also those landing later
        let hasLongJoinForAll = false;
        const consider = (along, isShort) => {
            const join = this._evaluateJoin(plan, along, context);
            const cost = costOf(join);
            const buffer = isShort && !isEmergency ? p.shortJoinBufferNm : 0;

            if (!isFlyable(join)) {
                return;
            }

            if (!isShort && !hasLongJoinForAll &&
                this._joinSpacingMargin(plan, along, join.joinTime, Infinity, context, 0, isEmergency) >= 0) {
                hasLongJoinForAll = true;
            }

            if ((best && cost >= best.cost) ||
                this._joinSpacingMargin(plan, along, join.joinTime, scheduledTime, context, buffer, isEmergency) < 0) {
                return;
            }

            best = { ...join, cost, isWaiting: false };
        };

        for (let along = pattern.interceptAlong; along <= maximum + 0.01; along += JOIN_STEP_NM) {
            consider(along, false);
        }

        // late: even the best of the longer joins lands well after the slot
        const isLate = !best || best.landingTime - scheduledTime > p.shortJoinPenaltySeconds;

        if (isEmergency || isLate || !hasLongJoinForAll) {
            for (let along = pattern.minimumJoinAlong; along < pattern.interceptAlong - 0.01; along += JOIN_STEP_NM) {
                consider(along, true);
            }
        }

        return best || { ...this._evaluateJoin(plan, maximum, context), isWaiting: true };
    }

    /**
     * Arrivals on the localizer of a runway, or committed to join it, as states on final
     * at the time they are (or will be) on it. With `scheduledTime`, the joins of arrivals
     * that land later and can still move theirs are left out: they make room. With `hardOnly`,
     * only the arrivals on the localizer or on the intercept leg count (the others can still
     * extend their downwind for an aircraft in emergency).
     *
     * @return {array<object>} `{ aircraft, joinTime, state }`
     */
    _finalStream(runwayName, exceptCallsign, context, scheduledTime = Infinity, hardOnly = false) {
        const plans = (this._currentPlans && this._currentPlans[runwayName]) || [];
        const stream = [];

        plans.forEach((other) => {
            const { aircraft, frame } = other;
            const join = this._joins[aircraft.callsign];

            if (aircraft.callsign === exceptCallsign) {
                return;
            }

            if (other.mode === ARRIVAL_MODE.FINAL) {
                stream.push({
                    aircraft,
                    joinTime: context.time,
                    state: finalState(aircraft, Math.max(0, frame.along(aircraft)), frame.elevation)
                });
            } else if (join && join.runway === runwayName && (hardOnly ? join.leg === PATTERN_LEG.INTERCEPT :
                join.isLocked || join.scheduledTime < scheduledTime)) {
                stream.push({
                    aircraft,
                    joinTime: join.time,
                    state: finalState(aircraft, join.along, frame.elevation, this.parameters.finalSpeed)
                });
            }
        });

        return stream;
    }

    /**
     * Smallest margin over the required spacing, from the moment the arrival joins the localizer
     * `joinAlong` nm out at `joinTime` until the threshold, with everyone on the same localizer
     * (negative: too close). `hardOnly`: see `_finalStream`.
     */
    _joinSpacingMargin(plan, joinAlong, joinTime, scheduledTime, context, extraBufferNm = 0, hardOnly = false) {
        const { aircraft, frame } = plan;
        const own = finalState(aircraft, joinAlong, frame.elevation, this.parameters.finalSpeed);

        return this._finalStream(frame.name, aircraft.callsign, context, scheduledTime, hardOnly).reduce((margin, other) => {
            // compare both once both are on the localizer
            const start = Math.max(joinTime, other.joinTime);
            const mine = advanceOnFinal(own, start - joinTime);
            const theirs = advanceOnFinal(other.state, start - other.joinTime);

            if (mine.along <= 0 || theirs.along <= 0) {
                // one lands before the other joins: the landing interval is the sequence's business
                return margin;
            }

            const isAhead = theirs.along <= mine.along;
            const gap = isAhead ? minimumGapOnFinal(theirs, mine) : minimumGapOnFinal(mine, theirs);
            const required = isAhead ?
                finalSpacingNm(other.aircraft, aircraft, context.observation, this.shield.margins) :
                finalSpacingNm(aircraft, other.aircraft, context.observation, this.shield.margins);

            return Math.min(margin, gap - required - extraBufferNm);
        }, Infinity);
    }
}

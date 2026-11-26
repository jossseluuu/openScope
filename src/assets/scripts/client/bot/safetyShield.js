import {
    ACTIONS,
    ACTION_COUNT,
    ACTION_INDEX,
    ACTION_TYPE,
    ALTITUDES,
    altitudeAction,
    getApplicableActions,
    headingAction,
    headingReference
} from './actionSpace';
import {
    DEFAULT_RULE_MARGINS,
    RunwayIndex,
    airspaceMaximumAltitude,
    airspaceMinimumAltitude,
    checkRunwayEntry,
    checkTakeoff,
    finalSpacingNm,
    minimumAssignableAltitude
} from './botRules';
import {
    distance, hasAltitudeGaps, headingVector, levelsInsideAirspace, secondsToRestrictedArea
} from './botGeometry';

/**
 * Turn away from the final approach course when breaking off an approach far out, in degrees
 *
 * @property BREAK_OFF_DEGREES
 * @type {number}
 * @final
 */
const BREAK_OFF_DEGREES = 45;

/**
 * A heading that enters a restricted area within this time is forbidden
 *
 * @property RESTRICTED_AREA_HORIZON_SECONDS
 * @type {number}
 * @final
 */
const RESTRICTED_AREA_HORIZON_SECONDS = 75;

/**
 * Safety shield shared by every bot.
 *
 * It removes the actions that would certainly break a safety or separation rule
 * (tiers 0 and 1 of the Rulebook) and imposes the actions needed to avoid an
 * imminent violation. Bot B can only choose among the actions it allows; Bot A
 * checks its own decisions with it.
 *
 * @class SafetyShield
 */
export default class SafetyShield {
    /**
     * @constructor
     * @param [margins] {object}  see `DEFAULT_RULE_MARGINS`
     */
    constructor(margins = DEFAULT_RULE_MARGINS) {
        this.margins = { ...DEFAULT_RULE_MARGINS, ...margins };
        this._runwayIndex = null;
        this._airportIcao = null;
    }

    /**
     * @for SafetyShield
     * @method getRunwayIndex
     * @param observation {object}
     * @return {RunwayIndex}
     */
    getRunwayIndex(observation) {
        if (observation.airport.icao !== this._airportIcao) {
            this._airportIcao = observation.airport.icao;
            this._runwayIndex = new RunwayIndex(observation.airport);
        }

        return this._runwayIndex;
    }

    /**
     * Allowed actions for an aircraft
     *
     * @for SafetyShield
     * @method getActionMask
     * @param aircraft {object}
     * @param observation {object}
     * @return {array<boolean>}
     */
    getActionMask(aircraft, observation) {
        const mask = getApplicableActions(aircraft, observation);

        if (mask[ACTION_INDEX.TAKEOFF]) {
            mask[ACTION_INDEX.TAKEOFF] = checkTakeoff(aircraft, observation, this.getRunwayIndex(observation), this.margins).ok;
        }

        if (mask[ACTION_INDEX.LINE_UP]) {
            mask[ACTION_INDEX.LINE_UP] = checkRunwayEntry(aircraft, observation, this.getRunwayIndex(observation), this.margins).ok;
        }

        if (!aircraft.isOnGround && aircraft.isControllable) {
            const minimumAltitude = minimumAssignableAltitude(aircraft, observation, this.margins);
            // never above the ceiling of the airspace (when floor and ceiling leave no level, the floor wins)
            const maximumAltitude = Math.max(airspaceMaximumAltitude(aircraft), minimumAltitude);

            const insideLevels = this._levelsInsideAhead(aircraft, observation);

            this._forbiddenHeadingActions(aircraft, observation).forEach((index) => {
                mask[index] = false;
            });

            for (let i = 0; i < ACTION_COUNT; i++) {
                if (ACTIONS[i].type === ACTION_TYPE.ALTITUDE &&
                    (ACTIONS[i].value < minimumAltitude || ACTIONS[i].value > maximumAltitude ||
                        (insideLevels && insideLevels.indexOf(ACTIONS[i].value) === -1))) {
                    mask[i] = false;
                }
            }

            // during a TCAS RA the crew follows the RA: no vertical clearance (ICAO Doc 4444 15.7.3, TCA-006)
            if (aircraft.safetyNet && aircraft.safetyNet.tcas === 'RA') {
                for (let i = 0; i < ACTION_COUNT; i++) {
                    if (ACTIONS[i].type === ACTION_TYPE.ALTITUDE || ACTIONS[i].type === ACTION_TYPE.PROCEDURE) {
                        mask[i] = false;
                    }
                }
            }
        }

        return mask;
    }

    /**
     * Actions the shield imposes to avoid an imminent violation, by callsign
     *
     * A follower on final closer than the minimum to its leader goes around within
     * 6 nm of the threshold, and breaks off the approach with a turn further out.
     *
     * @for SafetyShield
     * @method getRequiredActions
     * @param observation {object}
     * @return {object}
     */
    getRequiredActions(observation) {
        const runwayIndex = this.getRunwayIndex(observation);
        const streams = {};
        const required = {};

        observation.aircraft.forEach((aircraft) => {
            const runway = runwayIndex.runways[aircraft.arrivalRunway];

            if (!runway || aircraft.isOnGround || aircraft.category !== 'arrival' || !aircraft.hasApproachClearance) {
                return;
            }

            const frame = runwayIndex.frames[runway.name];
            const isOnFinal = aircraft.flightPhase === 'APPROACH' || aircraft.flightPhase === 'LANDING';
            // cleared and about to join: within 2 nm of the centerline on the approach side
            const isJoining = frame.along(aircraft) > 0 && Math.abs(frame.lateral(aircraft)) < 2;

            if (!isOnFinal && !isJoining) {
                return;
            }

            if (!streams[runway.name]) {
                streams[runway.name] = [];
            }

            streams[runway.name].push({ aircraft, distance: distance(aircraft, runway.threshold) });
        });

        Object.keys(streams).forEach((name) => {
            const stream = streams[name].sort((a, b) => a.distance - b.distance);

            for (let i = 1; i < stream.length; i++) {
                const leader = stream[i - 1].aircraft;
                const follower = stream[i].aircraft;
                const spacing = distance(leader, follower);
                const minimum = finalSpacingNm(leader, follower, observation, { ...this.margins, finalSpacingBufferNm: 0 });

                if (!follower.isControllable || spacing >= observation.realism.separationMinima.finalApproachNm ||
                    spacing >= minimum) {
                    continue;
                }

                if (stream[i].distance < 6) {
                    required[follower.callsign] = ACTION_INDEX.GO_AROUND;
                } else {
                    // far out: break off the approach, turning away from the centerline on the side it came from
                    const frame = runwayIndex.frames[name];
                    const side = frame.lateral(follower) >= 0 ? 1 : -1;

                    required[follower.callsign] = headingAction(follower, frame.course + side * BREAK_OFF_DEGREES);
                }
            }
        });

        // an arrival flying towards a sector with a higher floor climbs into it before leaving the airspace
        observation.aircraft.forEach((aircraft) => {
            const minimum = airspaceMinimumAltitude(aircraft);

            if (required[aircraft.callsign] !== undefined || !aircraft.isControllable || aircraft.isOnGround ||
                aircraft.category !== 'arrival' || aircraft.isEstablishedOnCourse ||
                aircraft.clearance.altitudeMode === 'VNAV' || aircraft.clearance.altitude >= minimum) {
                return;
            }

            required[aircraft.callsign] = altitudeAction(minimum);
        });

        // ...and one whose cleared level leaves the airspace ahead (a lower ceiling, or a gap between
        // sectors) changes to the closest level that stays inside
        observation.aircraft.forEach((aircraft) => {
            if (required[aircraft.callsign] !== undefined || !aircraft.isControllable || aircraft.isOnGround ||
                aircraft.category !== 'arrival' || aircraft.isEstablishedOnCourse || aircraft.hasApproachClearance) {
                return;
            }

            const minimum = minimumAssignableAltitude(aircraft, observation, this.margins);
            const levels = (this._levelsInsideAhead(aircraft, observation) || []).filter((level) => level >= minimum);
            const cleared = aircraft.clearance.altitude;
            const maximum = airspaceMaximumAltitude(aircraft);

            // without gaps in altitude only the ceiling can be in the way
            if (!hasAltitudeGaps(observation.airport.airspace)) {
                if (Number.isFinite(maximum) && maximum >= minimum && (cleared > maximum || aircraft.altitude > maximum + 500)) {
                    required[aircraft.callsign] = altitudeAction(maximum);
                }

                return;
            }

            if (levels.length === 0 || levels.indexOf(cleared) !== -1 ||
                (aircraft.clearance.altitudeMode === 'VNAV' && levels.indexOf(Math.round(aircraft.altitude / 1000) * 1000) !== -1)) {
                return;
            }

            const closest = levels.reduce((best, level) => (Math.abs(level - cleared) < Math.abs(best - cleared) ? level : best));

            required[aircraft.callsign] = altitudeAction(closest);
        });

        return required;
    }

    /**
     * Heading actions that lead an aircraft into a restricted area, computed once per aircraft and
     * decision. When all of them do, none is forbidden: the aircraft has to go somewhere.
     *
     * @for SafetyShield
     * @method _forbiddenHeadingActions
     * @param aircraft {object}
     * @param observation {object}
     * @return {array<number>} action indexes
     * @private
     */
    _forbiddenHeadingActions(aircraft, observation) {
        const areas = observation.airport.restrictedAreas;

        if (!areas || areas.length === 0) {
            return [];
        }

        if (this._headingsTime !== observation.time) {
            this._headingsTime = observation.time;
            this._headingsByCallsign = {};
        }

        if (!(aircraft.callsign in this._headingsByCallsign)) {
            const headings = ACTIONS.filter((action) => action.type === ACTION_TYPE.HEADING);
            const forbidden = headings.filter((action) => secondsToRestrictedArea(
                aircraft, areas, RESTRICTED_AREA_HORIZON_SECONDS, headingReference(aircraft) + action.value
            )).map((action) => action.index);

            this._headingsByCallsign[aircraft.callsign] = forbidden.length === headings.length ? [] : forbidden;
        }

        return this._headingsByCallsign[aircraft.callsign];
    }

    /**
     * Assignable levels that keep an arrival inside the airspace where it is and on its track over the
     * next 2 minutes, computed once per aircraft and decision; null when no level does (then nothing
     * is restricted) or for departures, which may climb out of it. (Looking only ahead, where the
     * arrival is going, was tried at KLAX and left more aircraft out of the airspace.)
     *
     * @for SafetyShield
     * @method _levelsInsideAhead
     * @param aircraft {object}
     * @param observation {object}
     * @return {array<number>|null}
     * @private
     */
    _levelsInsideAhead(aircraft, observation) {
        // only where sectors leave gaps in altitude: elsewhere floor and ceiling are enough, and checking
        // every level made Bot A measurably worse at LEMD and EDDM
        if (aircraft.category !== 'arrival' || !hasAltitudeGaps(observation.airport.airspace)) {
            return null;
        }

        if (this._levelsTime !== observation.time) {
            this._levelsTime = observation.time;
            this._levelsByCallsign = {};
        }

        if (!(aircraft.callsign in this._levelsByCallsign)) {
            const unit = headingVector(aircraft.groundTrack);
            const points = [0, 60, 120].map((seconds) => ({
                x: aircraft.x + unit.x * aircraft.groundSpeed * seconds / 3600,
                y: aircraft.y + unit.y * aircraft.groundSpeed * seconds / 3600
            }));
            const levels = levelsInsideAirspace(points, observation.airport.airspace, ALTITUDES);

            this._levelsByCallsign[aircraft.callsign] = levels.length > 0 ? levels : null;
        }

        return this._levelsByCallsign[aircraft.callsign];
    }
}

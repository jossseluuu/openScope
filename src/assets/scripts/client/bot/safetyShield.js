import {
    ACTIONS, ACTION_COUNT, ACTION_INDEX, ACTION_TYPE, altitudeAction, getApplicableActions, headingAction
} from './actionSpace';
import {
    DEFAULT_RULE_MARGINS,
    RunwayIndex,
    airspaceMinimumAltitude,
    checkTakeoff,
    finalSpacingNm,
    minimumAssignableAltitude
} from './botRules';
import { distance } from './botGeometry';

/**
 * Turn away from the final approach course when breaking off an approach far out, in degrees
 *
 * @property BREAK_OFF_DEGREES
 * @type {number}
 * @final
 */
const BREAK_OFF_DEGREES = 45;

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

        if (!aircraft.isOnGround && aircraft.isControllable) {
            const minimumAltitude = minimumAssignableAltitude(aircraft, observation, this.margins);

            for (let i = 0; i < ACTION_COUNT; i++) {
                if (ACTIONS[i].type === ACTION_TYPE.ALTITUDE && ACTIONS[i].value < minimumAltitude) {
                    mask[i] = false;
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

        return required;
    }
}

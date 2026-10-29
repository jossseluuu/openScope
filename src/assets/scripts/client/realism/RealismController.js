import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import MetricsCollector from './MetricsCollector';
import Rulebook, { RULE } from './Rulebook';
import TerrainClearance from './TerrainClearance';
import TimeKeeper from '../engine/TimeKeeper';
import { GAME_EVENTS } from '../game/GameController';
import { abs } from '../math/core';
import { angle_offset } from '../math/circle';
import { vlen, vsub } from '../math/vector';
import { degreesToRadians, km_ft, nm } from '../utilities/unitConverters';
import { AIRCRAFT_EVENT } from '../constants/eventNames';
import { FLIGHT_PHASE, PERFORMANCE } from '../constants/aircraftConstants';
import { MCP_MODE } from '../aircraft/ModeControl/modeControlConstants';
import { getWindComponentsForRunway } from './runwayConfiguration';
import {
    LANDING_RUNWAY_OCCUPANCY_SECONDS,
    getArrivalWakeSeparationNm,
    getDepartureWakeSeparationSeconds,
    getRecatEuCategory,
    getWakeCategory
} from './wakeTurbulence';

/**
 * Interval between the separation checks, in seconds of game time
 *
 * @property CHECK_INTERVAL_SECONDS
 * @type {number}
 * @final
 */
const CHECK_INTERVAL_SECONDS = 1;

/**
 * Height above the threshold at which a pilot goes around if the runway is not
 * clear (a typical decision height)
 *
 * @property RUNWAY_CLEAR_DECISION_HEIGHT_FT
 * @type {number}
 * @final
 */
const RUNWAY_CLEAR_DECISION_HEIGHT_FT = 200;

/**
 * Maximum speed above the landing speed accepted by the stabilized approach criteria
 *
 * @property STABILIZED_APPROACH_SPEED_MARGIN_KT
 * @type {number}
 * @final
 */
const STABILIZED_APPROACH_SPEED_MARGIN_KT = 20;

/**
 * Below this height radar separation is the responsibility of the aerodrome
 * controller (runway separation, wake and departure rules apply instead)
 *
 * @property RADAR_SEPARATION_MIN_HEIGHT_FT
 * @type {number}
 * @final
 */
const RADAR_SEPARATION_MIN_HEIGHT_FT = 1000;

/**
 * Parallel runways closer than this are treated as a single runway for wake
 * turbulence (ICAO Doc 4444 5.8.2; FAA JO 7110.65 5-8-4: 2,500 ft)
 *
 * @property DEPENDENT_PARALLEL_RUNWAY_FT
 * @type {number}
 * @final
 */
const DEPENDENT_PARALLEL_RUNWAY_FT = 2500;

/**
 * Distance from the airport within which simultaneous departures from parallel
 * runways on diverging headings are considered separated
 *
 * @property DEPARTURE_DIVERGENCE_RADIUS_NM
 * @type {number}
 * @final
 */
const DEPARTURE_DIVERGENCE_RADIUS_NM = 10;

/**
 * The automatic tower releases a departure at least this long after any other takeoff
 *
 * @property AUTO_TOWER_DEPARTURE_INTERVAL_SECONDS
 * @type {number}
 * @final
 */
const AUTO_TOWER_DEPARTURE_INTERVAL_SECONDS = 90;

/**
 * ...and at least this long after a departure on the same SID, which flies the same track and
 * would otherwise be caught up by a faster follower
 *
 * @property AUTO_TOWER_SAME_SID_INTERVAL_SECONDS
 * @type {number}
 * @final
 */
const AUTO_TOWER_SAME_SID_INTERVAL_SECONDS = 120;

const sidOf = (aircraftModel) => (aircraftModel.fms.getRouteString() || '').split('.')[1] || null;

/**
 * Added to the arrival-departure minimum when the automatic tower looks for arrivals about to land
 *
 * @property AUTO_TOWER_ARRIVAL_MARGIN_NM
 * @type {number}
 * @final
 */
const AUTO_TOWER_ARRIVAL_MARGIN_NM = 2;

/**
 * Margins added to the radar and vertical minima before a new aircraft may appear near another
 * one: nobody has given it a clearance yet, so it must start well clear of everyone
 *
 * @property SPAWN_SEPARATION_MARGIN
 * @type {object}
 * @final
 */
const SPAWN_SEPARATION_MARGIN = { NM: 5, FT: 1000 };

/**
 * Mode C altitude is reported in 100 ft increments, so aircraft at levels 1000 ft
 * apart may show a slightly smaller difference while they settle
 *
 * @property VERTICAL_SEPARATION_TOLERANCE_FT
 * @type {number}
 * @final
 */
const VERTICAL_SEPARATION_TOLERANCE_FT = 50;

/**
 * A pair that enters our airspace already unseparated is the previous sector's
 * loss; it is only counted if it is still unseparated after this time
 *
 * @property HANDOVER_GRACE_SECONDS
 * @type {number}
 * @final
 */
const HANDOVER_GRACE_SECONDS = 60;

/**
 * Mode C altitude resolution: aircraft are considered below the minimum vectoring
 * altitude once they are more than this below it
 *
 * @property MINIMUM_ALTITUDE_TOLERANCE_FT
 * @type {number}
 * @final
 */
const MINIMUM_ALTITUDE_TOLERANCE_FT = 100;

/**
 * Landing runway occupancy times vary with the exit taken and braking
 *
 * @property RUNWAY_OCCUPANCY_VARIATION
 * @type {object}
 * @final
 */
const RUNWAY_OCCUPANCY_VARIATION = {
    MIN: 0.9,
    MAX: 1.2
};

/**
 * State of a pair of aircraft that are not separated
 *
 * @property LOSS_STATE
 * @type {object}
 * @final
 */
const LOSS_STATE = {
    // received unseparated from the previous sector, within the handover grace time
    INHERITED: 'INHERITED',
    // counted as a loss of separation
    RECORDED: 'RECORDED'
};

const distanceNm = (positionA, positionB) => nm(vlen(vsub(positionA, positionB)));

/**
 * Operational realism layered over the aircraft physics:
 *
 * - runways are a shared resource: a landing aircraft occupies the runway for its
 *   runway occupancy time, a departure until it passes the runway end
 * - pilots go around when the runway is not clear at decision height or the
 *   approach is not stable at 1000 ft
 * - radar, final approach, wake turbulence and runway separation are monitored
 *   with the minima of the airport's regulatory profile and recorded in the `Rulebook`
 * - efficiency and environmental metrics are collected
 *
 * Created and updated by the `AircraftController`, so it runs in the browser and
 * in the headless simulator alike.
 *
 * @class RealismController
 */
export default class RealismController {
    /**
     * @constructor
     * @param aircraftController {AircraftController}
     */
    constructor(aircraftController) {
        this._aircraftController = aircraftController;
        this.rulebook = new Rulebook();
        this.metrics = new MetricsCollector();

        this._onTakeoffHandler = this._onTakeoff.bind(this);
        this._onGoAroundHandler = this._onGoAround.bind(this);

        this.reset();
        this.enable();
    }

    /**
     * @for RealismController
     * @method enable
     */
    enable() {
        EventBus.on(AIRCRAFT_EVENT.TAKEOFF, this._onTakeoffHandler);
        EventBus.on(AIRCRAFT_EVENT.GO_AROUND, this._onGoAroundHandler);
    }

    /**
     * @for RealismController
     * @method disable
     */
    disable() {
        EventBus.off(AIRCRAFT_EVENT.TAKEOFF, this._onTakeoffHandler);
        EventBus.off(AIRCRAFT_EVENT.GO_AROUND, this._onGoAroundHandler);
    }

    /**
     * Forget all state, e.g. when the airport changes
     *
     * @for RealismController
     * @method reset
     */
    reset() {
        const time = TimeKeeper.accumulatedDeltaTime;

        this._airportIcao = null;
        this._physicalRunwayByName = {};
        this._occupancy = {};
        this._lastTakeoffByRunway = {};
        this._touchdownIds = {};
        this._stabilityCheckedIds = {};
        this._radarLosses = {};
        this._controllableSince = {};
        this._belowMinimumAltitudeIds = {};
        this._terrainClearance = null;
        this._finalApproachLosses = {};
        this._lastCheckTime = time;
        this._lastUpdateTime = time;
        this.rulebook.reset();
        this.metrics.reset(time);
    }

    /**
     * Part of the game loop, called after the aircraft physics have been updated
     *
     * @for RealismController
     * @method update
     */
    update() {
        const airportModel = AirportController.airport_get();

        if (!airportModel || !airportModel.runways) {
            return;
        }

        if (airportModel.icao !== this._airportIcao) {
            this.reset();
            this._buildRunwayMap(airportModel);
        }

        const time = TimeKeeper.accumulatedDeltaTime;
        const aircraftList = this._aircraftController.aircraft.list;

        this._updateLandings(aircraftList, time, airportModel);
        this._releaseRunways(time);

        if (time - this._lastCheckTime >= CHECK_INTERVAL_SECONDS) {
            const elapsed = time - this._lastCheckTime;

            this._lastCheckTime = time;
            this._pruneRemovedAircraft(aircraftList);
            this._updateControllableSince(aircraftList, time);
            this._checkRadarSeparation(aircraftList, airportModel, elapsed, time);
            this._checkFinalApproachSeparation(aircraftList, airportModel);
            this._checkTerrain(aircraftList, airportModel);
            this.metrics.update(time, aircraftList);
        }

        this._lastUpdateTime = time;
    }

    /**
     * Name of the physical runway (e.g. `14L/32R`) a runway end belongs to
     *
     * @for RealismController
     * @method getPhysicalRunwayName
     * @param runwayModel {RunwayModel}
     * @return {string}
     */
    getPhysicalRunwayName(runwayModel) {
        return this._physicalRunwayByName[runwayModel.name] || runwayModel.name;
    }

    /**
     * Aircraft occupying the physical runway of `runwayModel`, other than `exceptAircraftModel`
     *
     * @for RealismController
     * @method getRunwayOccupants
     * @param runwayModel {RunwayModel}
     * @param [exceptAircraftModel] {AircraftModel}
     * @return {array<object>} `{ aircraftModel, kind, since, until }`
     */
    getRunwayOccupants(runwayModel, exceptAircraftModel = null) {
        const occupants = this._occupancy[this.getPhysicalRunwayName(runwayModel)] || [];

        return occupants.filter((occupant) => occupant.aircraftModel !== exceptAircraftModel);
    }

    /**
     * @for RealismController
     * @method isRunwayOccupied
     * @param runwayModel {RunwayModel}
     * @param [exceptAircraftModel] {AircraftModel}
     * @return {boolean}
     */
    isRunwayOccupied(runwayModel, exceptAircraftModel = null) {
        return this.getRunwayOccupants(runwayModel, exceptAircraftModel).length > 0;
    }

    /**
     * Safety check before a new airborne aircraft appears: it must be clear of every other airborne
     * aircraft by the radar or vertical minimum plus `SPAWN_SEPARATION_MARGIN`, and not below the
     * floor of the controlled airspace or the minimum vectoring altitude where it appears (it is then
     * raised to a legal level instead of being refused)
     *
     * @for RealismController
     * @method checkSpawn
     * @param relativePosition {array<number>} km
     * @param altitude {number} ft
     * @return {object} `{ ok, altitude, reason }`
     */
    checkSpawn(relativePosition, altitude) {
        const airportModel = AirportController.airport_get();
        const profile = airportModel ? airportModel.regulatoryProfile : null;
        const radarNm = (profile ? profile.radarSeparationNm : 3) + SPAWN_SEPARATION_MARGIN.NM;
        const verticalFt = (profile ? profile.verticalSeparationFt : 1000) + SPAWN_SEPARATION_MARGIN.FT;
        const sectors = (airportModel ? airportModel.airspace : []).filter((airspaceModel) => airspaceModel.isPointInside2D(relativePosition));
        // inside the airspace, the lowest floor of the sectors there
        const floor = sectors.length > 0 ? Math.min(...sectors.map((airspaceModel) => airspaceModel.floor)) : 0;
        const minimum = Math.max(floor, this.getMinimumVectoringAltitude(relativePosition) || 0);
        const legalAltitude = altitude >= minimum ? altitude : Math.ceil((minimum + 500) / 1000) * 1000;
        const conflict = this._aircraftController.aircraft.list.find((other) => !other.isOnGround() &&
            distanceNm(relativePosition, other.relativePosition) < radarNm &&
            Math.abs(other.altitude - legalAltitude) < verticalFt);

        if (conflict) {
            const distance = distanceNm(relativePosition, conflict.relativePosition);

            return {
                ok: false,
                altitude: legalAltitude,
                reason: `${conflict.callsign} ${distance.toFixed(1)} nm and ${Math.round(Math.abs(conflict.altitude - legalAltitude))} ft away ` +
                    `(spawn minimum ${radarNm} nm or ${verticalFt} ft)`
            };
        }

        return {
            ok: true,
            altitude: legalAltitude,
            reason: legalAltitude !== altitude ? `raised from ${Math.round(altitude)} ft to the minimum altitude there` : ''
        };
    }

    /**
     * Whether the automatic tower (game option "Tower Control: System Controlled") may release a
     * departure now without breaking the rules this controller scores: the runway is free, no arrival
     * is about to land on it, the wake interval behind earlier departures has passed, and
     * `AUTO_TOWER_DEPARTURE_INTERVAL_SECONDS` have passed since any other takeoff, so departures from
     * parallel runways do not climb out side by side
     *
     * @for RealismController
     * @method canReleaseAutomaticTakeoff
     * @param aircraftModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @return {boolean}
     */
    canReleaseAutomaticTakeoff(aircraftModel, runwayModel) {
        const airportModel = AirportController.airport_get();

        if (!airportModel || !airportModel.regulatoryProfile) {
            return true;
        }

        if (airportModel.icao !== this._airportIcao) {
            this.reset();
            this._buildRunwayMap(airportModel);
        }

        if (this.isRunwayOccupied(runwayModel, aircraftModel)) {
            return false;
        }

        const time = TimeKeeper.accumulatedDeltaTime;
        const { wakeScheme, arrivalDepartureSeparationNm } = airportModel.regulatoryProfile;
        const physicalName = this.getPhysicalRunwayName(runwayModel);

        const isArrivalClose = this._aircraftController.aircraft.list.some((arrivalModel) => {
            const { arrivalRunwayModel } = arrivalModel.fms;

            return arrivalModel.isArrival() && arrivalRunwayModel && !arrivalModel.isOnGround() &&
                (arrivalModel.flightPhase === FLIGHT_PHASE.LANDING || arrivalModel.flightPhase === FLIGHT_PHASE.APPROACH) &&
                this.getPhysicalRunwayName(arrivalRunwayModel) === physicalName &&
                distanceNm(arrivalModel.relativePosition, arrivalRunwayModel.relativePosition) <
                    arrivalDepartureSeparationNm + AUTO_TOWER_ARRIVAL_MARGIN_NM;
        });

        if (isArrivalClose) {
            return false;
        }

        return Object.keys(this._lastTakeoffByRunway).every((name) => {
            const { aircraftModel: leaderModel, time: leaderTime } = this._lastTakeoffByRunway[name];
            const elapsed = time - leaderTime;

            if (elapsed < AUTO_TOWER_DEPARTURE_INTERVAL_SECONDS) {
                return false;
            }

            if (elapsed < AUTO_TOWER_SAME_SID_INTERVAL_SECONDS && sidOf(leaderModel) === sidOf(aircraftModel)) {
                return false;
            }

            return !this._isSameOrDependentRunway(airportModel, runwayModel, leaderModel.fms.departureRunwayModel) ||
                elapsed >= getDepartureWakeSeparationSeconds(leaderModel.model, aircraftModel.model, wakeScheme);
        });
    }

    /**
     * Minimum vectoring altitude at a position, or null when the airport has no terrain data
     *
     * @for RealismController
     * @method getMinimumVectoringAltitude
     * @param position {array<number>}  relative position, in km
     * @return {number|null}  ft
     */
    getMinimumVectoringAltitude(position) {
        const terrainClearance = this._getTerrainClearance(AirportController.airport_get());

        return terrainClearance ? terrainClearance.getMinimumVectoringAltitude(position) : null;
    }

    /**
     * State exposed to bots
     *
     * @for RealismController
     * @method getObservation
     * @return {object}
     */
    getObservation() {
        const airportModel = AirportController.airport_get();
        const profile = airportModel ? airportModel.regulatoryProfile : null;
        const configuration = airportModel ? airportModel.runwayConfiguration : null;
        const time = TimeKeeper.accumulatedDeltaTime;

        return {
            regulatoryProfile: profile ? profile.id : null,
            wakeScheme: profile ? profile.wakeScheme : null,
            separationMinima: profile ? {
                radarNm: profile.radarSeparationNm,
                verticalFt: profile.verticalSeparationFt,
                finalApproachNm: profile.finalApproachSeparationNm,
                arrivalDepartureNm: profile.arrivalDepartureSeparationNm,
                maxTailwindKt: profile.maxTailwindKt,
                maxCrosswindKt: profile.maxCrosswindKt
            } : null,
            runwayConfiguration: configuration ? configuration.name : null,
            runwayOccupancy: Object.keys(this._occupancy).map((runwayName) => ({
                runway: runwayName,
                occupants: this._occupancy[runwayName].map((occupant) => ({
                    callsign: occupant.aircraftModel.callsign,
                    kind: occupant.kind,
                    remainingSeconds: occupant.until === null ? null : Math.max(0, occupant.until - time)
                }))
            })).filter((runway) => runway.occupants.length > 0),
            lastTakeoffs: Object.keys(this._lastTakeoffByRunway).map((runwayName) => {
                const { aircraftModel, time: takeoffTime } = this._lastTakeoffByRunway[runwayName];

                return {
                    runway: runwayName,
                    callsign: aircraftModel.callsign,
                    secondsAgo: time - takeoffTime
                };
            }),
            violationCounts: { ...this.rulebook.counts },
            metrics: this.metrics.getSummary()
        };
    }

    /**
     * Group the runway ends by physical runway
     *
     * @for RealismController
     * @method _buildRunwayMap
     * @param airportModel {AirportModel}
     * @private
     */
    _buildRunwayMap(airportModel) {
        this._airportIcao = airportModel.icao;
        this._physicalRunwayByName = {};

        airportModel.runways.forEach(([runwayModel, oppositeRunwayModel]) => {
            const physicalName = `${runwayModel.name}/${oppositeRunwayModel.name}`;

            this._physicalRunwayByName[runwayModel.name] = physicalName;
            this._physicalRunwayByName[oppositeRunwayModel.name] = physicalName;
        });
    }

    /**
     * @for RealismController
     * @method _occupyRunway
     * @param runwayModel {RunwayModel}
     * @param aircraftModel {AircraftModel}
     * @param kind {string}   `arrival` or `departure`
     * @param time {number}
     * @param until {number|null}  null: until the departure passes the runway end
     * @private
     */
    _occupyRunway(runwayModel, aircraftModel, kind, time, until) {
        const physicalName = this.getPhysicalRunwayName(runwayModel);

        if (!this._occupancy[physicalName]) {
            this._occupancy[physicalName] = [];
        }

        this._occupancy[physicalName].push({
            aircraftModel, runwayModel, kind, since: time, until
        });
    }

    /**
     * Free the runways whose occupants have vacated them
     *
     * @for RealismController
     * @method _releaseRunways
     * @param time {number}
     * @private
     */
    _releaseRunways(time) {
        const aircraftList = this._aircraftController.aircraft.list;

        Object.keys(this._occupancy).forEach((physicalName) => {
            this._occupancy[physicalName] = this._occupancy[physicalName].filter((occupant) => {
                if (occupant.until !== null) {
                    return time < occupant.until;
                }

                const { aircraftModel, runwayModel } = occupant;

                if (aircraftList.indexOf(aircraftModel) === -1) {
                    return false;
                }

                const distanceFromThreshold = vlen(vsub(aircraftModel.relativePosition, runwayModel.relativePosition));

                return !(aircraftModel.isAirborne() && distanceFromThreshold >= runwayModel.length);
            });
        });
    }

    /**
     * Touchdowns, the decision height check and the stabilized approach check
     *
     * @for RealismController
     * @method _updateLandings
     * @param aircraftList {array<AircraftModel>}
     * @param time {number}
     * @param airportModel {AirportModel}
     * @private
     */
    _updateLandings(aircraftList, time, airportModel) {
        for (let i = 0; i < aircraftList.length; i++) {
            const aircraftModel = aircraftList[i];
            const runwayModel = aircraftModel.fms.arrivalRunwayModel;
            const isOnApproach = aircraftModel.flightPhase === FLIGHT_PHASE.APPROACH ||
                aircraftModel.flightPhase === FLIGHT_PHASE.LANDING;

            if (!aircraftModel.isArrival() || !runwayModel || !isOnApproach) {
                continue;
            }

            if (aircraftModel.isOnGround()) {
                if (aircraftModel.flightPhase === FLIGHT_PHASE.LANDING && !this._touchdownIds[aircraftModel.id]) {
                    this._onTouchdown(aircraftModel, runwayModel, time, airportModel);
                }

                continue;
            }

            const height = aircraftModel.altitude - runwayModel.elevation;

            if (height <= PERFORMANCE.STABILIZED_APPROACH_HEIGHT_FT && !this._stabilityCheckedIds[aircraftModel.id]) {
                this._stabilityCheckedIds[aircraftModel.id] = true;

                const reason = this._findUnstableApproachReason(aircraftModel);

                if (reason) {
                    this._goAround(aircraftModel, reason);

                    continue;
                }
            }

            if (height <= RUNWAY_CLEAR_DECISION_HEIGHT_FT && this.isRunwayOccupied(runwayModel, aircraftModel)) {
                const occupant = this.getRunwayOccupants(runwayModel, aircraftModel)[0];

                this._goAround(aircraftModel, `runway occupied by ${occupant.aircraftModel.callsign}`);
            }
        }
    }

    /**
     * @for RealismController
     * @method _findUnstableApproachReason
     * @param aircraftModel {AircraftModel}
     * @return {string|null}
     * @private
     */
    _findUnstableApproachReason(aircraftModel) {
        if (!aircraftModel.isEstablishedOnCourse()) {
            return 'unstable approach, not established on the localizer';
        }

        if (!aircraftModel.isEstablishedOnGlidepath()) {
            return 'unstable approach, not on the glidepath';
        }

        if (aircraftModel.speed > aircraftModel.model.speed.landing + STABILIZED_APPROACH_SPEED_MARGIN_KT) {
            return 'unstable approach, too fast';
        }

        return null;
    }

    /**
     * @for RealismController
     * @method _goAround
     * @param aircraftModel {AircraftModel}
     * @param reason {string}
     * @private
     */
    _goAround(aircraftModel, reason) {
        aircraftModel.cancelLanding(reason);
    }

    /**
     * Forget per-aircraft state of aircraft that left the simulation
     *
     * @for RealismController
     * @method _pruneRemovedAircraft
     * @param aircraftList {array<AircraftModel>}
     * @private
     */
    _pruneRemovedAircraft(aircraftList) {
        const activeIds = {};

        aircraftList.forEach((aircraftModel) => {
            activeIds[aircraftModel.id] = true;
        });

        [
            this._touchdownIds,
            this._stabilityCheckedIds,
            this._controllableSince,
            this._belowMinimumAltitudeIds
        ].forEach((ids) => {
            Object.keys(ids).forEach((id) => {
                if (!activeIds[id]) {
                    delete ids[id];
                }
            });
        });
    }

    /**
     * @for RealismController
     * @method _onTouchdown
     * @param aircraftModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @param time {number}
     * @param airportModel {AirportModel}
     * @private
     */
    _onTouchdown(aircraftModel, runwayModel, time, airportModel) {
        this._touchdownIds[aircraftModel.id] = true;

        const occupants = this.getRunwayOccupants(runwayModel, aircraftModel);

        if (occupants.length > 0) {
            this.rulebook.record(
                RULE.RUNWAY_INCURSION,
                [aircraftModel.callsign, occupants[0].aircraftModel.callsign],
                `landed on Runway ${runwayModel.name} while it was occupied`
            );
        }

        const category = getRecatEuCategory(aircraftModel.model);
        const variation = RUNWAY_OCCUPANCY_VARIATION.MIN +
            Math.random() * (RUNWAY_OCCUPANCY_VARIATION.MAX - RUNWAY_OCCUPANCY_VARIATION.MIN);
        const occupancyTime = LANDING_RUNWAY_OCCUPANCY_SECONDS[category] * variation;

        this._occupyRunway(runwayModel, aircraftModel, 'arrival', time, time + occupancyTime);
        this._checkRunwayWind(aircraftModel, runwayModel, airportModel, 'landed', false);
        this.metrics.recordLanding(aircraftModel, time);
    }

    /**
     * A departure started its takeoff roll
     *
     * @for RealismController
     * @method _onTakeoff
     * @param aircraftModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @private
     */
    _onTakeoff(aircraftModel, runwayModel) {
        const airportModel = AirportController.airport_get();

        if (aircraftModel.projected || !airportModel) {
            return;
        }

        if (airportModel.icao !== this._airportIcao) {
            this.reset();
            this._buildRunwayMap(airportModel);
        }

        const time = TimeKeeper.accumulatedDeltaTime;
        const profile = airportModel.regulatoryProfile;
        const occupants = this.getRunwayOccupants(runwayModel, aircraftModel);

        if (occupants.length > 0) {
            this.rulebook.record(
                RULE.RUNWAY_INCURSION,
                [aircraftModel.callsign, occupants[0].aircraftModel.callsign],
                `took off from Runway ${runwayModel.name} while it was occupied`
            );
        }

        this._checkArrivalDepartureSeparation(aircraftModel, runwayModel, profile);
        this._checkDepartureWake(aircraftModel, runwayModel, airportModel, time);
        this._checkRunwayWind(aircraftModel, runwayModel, airportModel, 'took off', true);

        this._occupyRunway(runwayModel, aircraftModel, 'departure', time, null);
        this._lastTakeoffByRunway[this.getPhysicalRunwayName(runwayModel)] = { aircraftModel, time };
        this.metrics.recordTakeoff(aircraftModel, time);
    }

    /**
     * @for RealismController
     * @method _onGoAround
     * @param aircraftModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @private
     */
    _onGoAround(aircraftModel, runwayModel) {
        if (aircraftModel.projected) {
            return;
        }

        delete this._stabilityCheckedIds[aircraftModel.id];

        const runwayName = runwayModel ? runwayModel.name : 'unknown';

        this.rulebook.record(RULE.GO_AROUND, [aircraftModel.callsign], `missed approach, Runway ${runwayName}`);
        this.metrics.recordGoAround();
    }

    /**
     * @for RealismController
     * @method _checkArrivalDepartureSeparation
     * @param departureModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @param profile {object}
     * @private
     */
    _checkArrivalDepartureSeparation(departureModel, runwayModel, profile) {
        const physicalName = this.getPhysicalRunwayName(runwayModel);
        const aircraftList = this._aircraftController.aircraft.list;

        for (let i = 0; i < aircraftList.length; i++) {
            const arrivalModel = aircraftList[i];
            const { arrivalRunwayModel } = arrivalModel.fms;

            if (!arrivalModel.isArrival() || !arrivalRunwayModel || arrivalModel.isOnGround() ||
                arrivalModel.flightPhase !== FLIGHT_PHASE.LANDING ||
                this.getPhysicalRunwayName(arrivalRunwayModel) !== physicalName) {
                continue;
            }

            const distance = distanceNm(arrivalModel.relativePosition, arrivalRunwayModel.relativePosition);

            if (distance < profile.arrivalDepartureSeparationNm) {
                this.rulebook.record(
                    RULE.ARRIVAL_DEPARTURE,
                    [departureModel.callsign, arrivalModel.callsign],
                    `cleared for takeoff with ${arrivalModel.callsign} ${distance.toFixed(1)} nm from the threshold ` +
                    `(minimum ${profile.arrivalDepartureSeparationNm} nm)`
                );

                return;
            }
        }
    }

    /**
     * @for RealismController
     * @method _checkDepartureWake
     * @param aircraftModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @param airportModel {AirportModel}
     * @param time {number}
     * @private
     */
    _checkDepartureWake(aircraftModel, runwayModel, airportModel, time) {
        const { wakeScheme } = airportModel.regulatoryProfile;

        Object.keys(this._lastTakeoffByRunway).forEach((physicalName) => {
            const { aircraftModel: leaderModel, time: leaderTime } = this._lastTakeoffByRunway[physicalName];

            if (!this._isSameOrDependentRunway(airportModel, runwayModel, leaderModel.fms.departureRunwayModel)) {
                return;
            }

            const required = getDepartureWakeSeparationSeconds(leaderModel.model, aircraftModel.model, wakeScheme);
            const elapsed = time - leaderTime;

            if (elapsed < required) {
                this.rulebook.record(
                    RULE.WAKE_DEPARTURE,
                    [aircraftModel.callsign, leaderModel.callsign],
                    `departed ${Math.round(elapsed)} s behind ${leaderModel.callsign} ` +
                    `(${getWakeCategory(leaderModel.model, wakeScheme)}), wake minimum ${required} s`
                );
            }
        });
    }

    /**
     * Whether two runway ends are the same runway or parallel runways close enough
     * to share wake turbulence
     *
     * @for RealismController
     * @method _isSameOrDependentRunway
     * @param airportModel {AirportModel}
     * @param runwayModel {RunwayModel}
     * @param otherRunwayModel {RunwayModel}
     * @return {boolean}
     * @private
     */
    _isSameOrDependentRunway(airportModel, runwayModel, otherRunwayModel) {
        if (!otherRunwayModel) {
            return false;
        }

        if (this.getPhysicalRunwayName(runwayModel) === this.getPhysicalRunwayName(otherRunwayModel)) {
            return true;
        }

        const relationship = airportModel.getRunwayRelationshipForRunwayNames(runwayModel.name, otherRunwayModel.name);

        return Boolean(relationship) && relationship.parallel &&
            abs(angle_offset(runwayModel.angle, otherRunwayModel.angle)) < degreesToRadians(90) &&
            km_ft(relationship.lateral_dist) < DEPENDENT_PARALLEL_RUNWAY_FT;
    }

    /**
     * @for RealismController
     * @method _checkRunwayWind
     * @param aircraftModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @param airportModel {AirportModel}
     * @param action {string}
     * @param shouldScore {boolean}  landings are already scored by the `ScoreController`
     * @private
     */
    _checkRunwayWind(aircraftModel, runwayModel, airportModel, action, shouldScore) {
        const profile = airportModel.regulatoryProfile;
        const { head, cross } = getWindComponentsForRunway(runwayModel, airportModel.wind);
        const tailwind = -head;

        if (tailwind <= profile.maxTailwindKt && cross <= profile.maxCrosswindKt) {
            return;
        }

        let gameEvent = null;

        if (shouldScore) {
            gameEvent = tailwind > profile.maxTailwindKt ?
                GAME_EVENTS.HIGH_TAILWIND_OPERATION :
                GAME_EVENTS.HIGH_CROSSWIND_OPERATION;
        }

        this.rulebook.record(
            RULE.RUNWAY_WIND_LIMIT,
            [aircraftModel.callsign],
            `${action} on Runway ${runwayModel.name} with ${Math.round(Math.max(tailwind, 0))} kt tailwind ` +
            `and ${Math.round(cross)} kt crosswind`,
            gameEvent
        );
    }

    /**
     * Loss of radar separation between airborne aircraft
     *
     * @for RealismController
     * @method _checkRadarSeparation
     * @param aircraftList {array<AircraftModel>}
     * @param airportModel {AirportModel}
     * @param elapsed {number}
     * @private
     */
    _checkRadarSeparation(aircraftList, airportModel, elapsed, time) {
        const profile = airportModel.regulatoryProfile;
        const candidates = aircraftList.filter((aircraftModel) => !aircraftModel.isOnGround() &&
            !aircraftModel.hit &&
            aircraftModel.altitude - airportModel.elevation >= RADAR_SEPARATION_MIN_HEIGHT_FT);
        const activeLosses = {};

        for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
                const first = candidates[i];
                const second = candidates[j];

                if (!first.isControllable || !second.isControllable) {
                    continue;
                }

                if (abs(first.altitude - second.altitude) >= profile.verticalSeparationFt - VERTICAL_SEPARATION_TOLERANCE_FT) {
                    continue;
                }

                const distance = distanceNm(first.relativePosition, second.relativePosition);

                if (distance >= profile.radarSeparationNm ||
                    this._isExemptFromRadarSeparation(first, second, distance, airportModel, profile)) {
                    continue;
                }

                const key = [first.id, second.id].sort().join('|');
                const previousState = this._radarLosses[key];
                let state = previousState;

                if (state !== LOSS_STATE.RECORDED) {
                    state = this._isWithinHandoverGrace(first, second, time) ? LOSS_STATE.INHERITED : LOSS_STATE.RECORDED;
                }

                activeLosses[key] = state;

                if (state === LOSS_STATE.INHERITED) {
                    continue;
                }

                this.metrics.addSeparationLossTime(elapsed);

                if (previousState !== LOSS_STATE.RECORDED) {
                    this.rulebook.record(
                        RULE.RADAR_SEPARATION,
                        [first.callsign, second.callsign],
                        `${distance.toFixed(1)} nm and ${Math.round(abs(first.altitude - second.altitude))} ft ` +
                        `apart (minimum ${profile.radarSeparationNm} nm or ${profile.verticalSeparationFt} ft)`
                    );
                }
            }
        }

        this._radarLosses = activeLosses;
    }

    /**
     * Remember when each aircraft came under our control
     *
     * @for RealismController
     * @method _updateControllableSince
     * @param aircraftList {array<AircraftModel>}
     * @param time {number}
     * @private
     */
    _updateControllableSince(aircraftList, time) {
        aircraftList.forEach((aircraftModel) => {
            if (aircraftModel.isControllable && !(aircraftModel.id in this._controllableSince)) {
                this._controllableSince[aircraftModel.id] = time;
            }
        });
    }

    /**
     * @for RealismController
     * @method _isWithinHandoverGrace
     * @param first {AircraftModel}
     * @param second {AircraftModel}
     * @param time {number}
     * @return {boolean}
     * @private
     */
    _isWithinHandoverGrace(first, second, time) {
        const handedOverAt = Math.max(this._controllableSince[first.id], this._controllableSince[second.id]);

        return time - handedOverAt < HANDOVER_GRACE_SECONDS;
    }

    /**
     * Terrain is loaded asynchronously in the browser, so the queries are built on first use
     *
     * @for RealismController
     * @method _getTerrainClearance
     * @param airportModel {AirportModel}
     * @return {TerrainClearance|null}
     * @private
     */
    _getTerrainClearance(airportModel) {
        if (!this._terrainClearance && airportModel && airportModel.terrain &&
            Object.keys(airportModel.terrain).length > 0) {
            this._terrainClearance = new TerrainClearance(airportModel.terrain);
        }

        return this._terrainClearance && this._terrainClearance.hasTerrain ? this._terrainClearance : null;
    }

    /**
     * Controlled flight into terrain, and radar vectors below the minimum vectoring altitude
     *
     * @for RealismController
     * @method _checkTerrain
     * @param aircraftList {array<AircraftModel>}
     * @param airportModel {AirportModel}
     * @private
     */
    _checkTerrain(aircraftList, airportModel) {
        const terrainClearance = this._getTerrainClearance(airportModel);

        if (!terrainClearance) {
            return;
        }

        aircraftList.forEach((aircraftModel) => {
            const isNearRunway = aircraftModel.flightPhase === FLIGHT_PHASE.TAKEOFF ||
                aircraftModel.flightPhase === FLIGHT_PHASE.LANDING;

            if (aircraftModel.hit || aircraftModel.isOnGround() || isNearRunway) {
                return;
            }

            if (terrainClearance.isBelowTerrain(aircraftModel.relativePosition, aircraftModel.altitude)) {
                this.rulebook.record(
                    RULE.TERRAIN_COLLISION,
                    [aircraftModel.callsign],
                    `collided with terrain at ${Math.round(aircraftModel.altitude)} ft`
                );

                // same outcome as a collision in the engine: the aircraft is removed as `hit`
                aircraftModel.hit = true;
                aircraftModel.altitude = 0;

                return;
            }

            this._checkMinimumVectoringAltitude(aircraftModel, terrainClearance);
        });
    }

    /**
     * @for RealismController
     * @method _checkMinimumVectoringAltitude
     * @param aircraftModel {AircraftModel}
     * @param terrainClearance {TerrainClearance}
     * @private
     */
    _checkMinimumVectoringAltitude(aircraftModel, terrainClearance) {
        const isVectored = aircraftModel.mcp && aircraftModel.mcp.headingMode === MCP_MODE.HEADING.HOLD;
        // departures may be vectored below the MVA while climbing out (diverse vector area)
        const isClimbingOut = aircraftModel.isDeparture() && nm(aircraftModel.distance) < DEPARTURE_DIVERGENCE_RADIUS_NM;
        // e.g. after a missed approach: the aircraft is already doing what the rule requires
        const isClimbing = aircraftModel.trend > 0;

        if (!aircraftModel.isControllable || !isVectored || isClimbingOut || isClimbing ||
            this._isOnFinalApproach(aircraftModel)) {
            delete this._belowMinimumAltitudeIds[aircraftModel.id];

            return;
        }

        const minimumAltitude = terrainClearance.getMinimumVectoringAltitude(aircraftModel.relativePosition);

        if (aircraftModel.altitude >= minimumAltitude - MINIMUM_ALTITUDE_TOLERANCE_FT) {
            delete this._belowMinimumAltitudeIds[aircraftModel.id];

            return;
        }

        if (!this._belowMinimumAltitudeIds[aircraftModel.id]) {
            this._belowMinimumAltitudeIds[aircraftModel.id] = true;
            this.rulebook.record(
                RULE.MINIMUM_ALTITUDE,
                [aircraftModel.callsign],
                `vectored at ${Math.round(aircraftModel.altitude)} ft, minimum vectoring altitude ${minimumAltitude} ft`
            );
        }
    }

    /**
     * Pairs separated by other means than the radar minimum
     *
     * @for RealismController
     * @method _isExemptFromRadarSeparation
     * @param first {AircraftModel}
     * @param second {AircraftModel}
     * @param distance {number}  nm
     * @param airportModel {AirportModel}
     * @param profile {object}
     * @return {boolean}
     * @private
     */
    _isExemptFromRadarSeparation(first, second, distance, airportModel, profile) {
        const firstOnFinal = this._isOnFinalApproach(first);
        const secondOnFinal = this._isOnFinalApproach(second);

        if (firstOnFinal && secondOnFinal) {
            const firstRunway = first.fms.arrivalRunwayModel;
            const secondRunway = second.fms.arrivalRunwayModel;

            // same final: checked against the final approach minima instead
            if (firstRunway.name === secondRunway.name) {
                return true;
            }

            // simultaneous approaches to parallel runways (ICAO Doc 4444 6.7.3; FAA JO 7110.65 5-9-6, 5-9-7)
            const relationship = airportModel.getRunwayRelationshipForRunwayNames(firstRunway.name, secondRunway.name);

            if (relationship && relationship.parallel) {
                return distance >= nm(relationship.separationMinimum);
            }
        }

        // simultaneous departures from parallel runways on diverging headings (ICAO Doc 4444 6.7.3.2.3)
        if (first.isDeparture() && second.isDeparture() &&
            first.fms.departureRunwayModel && second.fms.departureRunwayModel &&
            first.fms.departureRunwayModel.name !== second.fms.departureRunwayModel.name) {
            const isNearAirport = nm(first.distance) < DEPARTURE_DIVERGENCE_RADIUS_NM &&
                nm(second.distance) < DEPARTURE_DIVERGENCE_RADIUS_NM;
            const divergence = abs(angle_offset(first.groundTrack, second.groundTrack));

            if (isNearAirport && divergence >= degreesToRadians(profile.parallelDepartureDivergenceDeg)) {
                return this._areDiverging(first, second);
            }
        }

        return false;
    }

    /**
     * @for RealismController
     * @method _areDiverging
     * @param first {AircraftModel}
     * @param second {AircraftModel}
     * @return {boolean}
     * @private
     */
    _areDiverging(first, second) {
        const step = 0.01; // hours, about 36 seconds
        const project = (aircraftModel) => [
            aircraftModel.relativePosition[0] + Math.sin(aircraftModel.groundTrack) * aircraftModel.groundSpeed * step * 1.852,
            aircraftModel.relativePosition[1] + Math.cos(aircraftModel.groundTrack) * aircraftModel.groundSpeed * step * 1.852
        ];
        const now = vlen(vsub(first.relativePosition, second.relativePosition));
        const later = vlen(vsub(project(first), project(second)));

        return later > now;
    }

    /**
     * @for RealismController
     * @method _isOnFinalApproach
     * @param aircraftModel {AircraftModel}
     * @return {boolean}
     * @private
     */
    _isOnFinalApproach(aircraftModel) {
        return aircraftModel.isArrival() &&
            Boolean(aircraftModel.fms.arrivalRunwayModel) &&
            aircraftModel.pilot.hasApproachClearance &&
            (aircraftModel.flightPhase === FLIGHT_PHASE.APPROACH || aircraftModel.flightPhase === FLIGHT_PHASE.LANDING);
    }

    /**
     * Minimum radar separation and wake turbulence separation between consecutive
     * aircraft on the same final approach
     *
     * @for RealismController
     * @method _checkFinalApproachSeparation
     * @param aircraftList {array<AircraftModel>}
     * @param airportModel {AirportModel}
     * @private
     */
    _checkFinalApproachSeparation(aircraftList, airportModel) {
        const profile = airportModel.regulatoryProfile;
        const streams = {};
        const activeLosses = {};

        aircraftList.forEach((aircraftModel) => {
            if (!this._isOnFinalApproach(aircraftModel) || aircraftModel.isOnGround()) {
                return;
            }

            const runwayModel = aircraftModel.fms.arrivalRunwayModel;

            if (!streams[runwayModel.name]) {
                streams[runwayModel.name] = [];
            }

            streams[runwayModel.name].push({
                aircraftModel,
                distance: distanceNm(aircraftModel.relativePosition, runwayModel.relativePosition)
            });
        });

        Object.keys(streams).forEach((runwayName) => {
            const stream = streams[runwayName].sort((a, b) => a.distance - b.distance);

            for (let i = 1; i < stream.length; i++) {
                const leaderModel = stream[i - 1].aircraftModel;
                const followerModel = stream[i].aircraftModel;
                const spacing = distanceNm(leaderModel.relativePosition, followerModel.relativePosition);
                const wakeMinimum = getArrivalWakeSeparationNm(leaderModel.model, followerModel.model, profile.wakeScheme);
                const isVerticallySeparated = abs(leaderModel.altitude - followerModel.altitude) >= profile.verticalSeparationFt;
                const pair = `${leaderModel.id}|${followerModel.id}`;

                if (spacing < profile.finalApproachSeparationNm && !isVerticallySeparated) {
                    activeLosses[`final:${pair}`] = true;

                    if (!this._finalApproachLosses[`final:${pair}`]) {
                        this.rulebook.record(
                            RULE.FINAL_APPROACH_SEPARATION,
                            [followerModel.callsign, leaderModel.callsign],
                            `${spacing.toFixed(1)} nm behind ${leaderModel.callsign} on final ${runwayName} ` +
                            `(minimum ${profile.finalApproachSeparationNm} nm)`
                        );
                    }
                } else if (spacing < wakeMinimum) {
                    activeLosses[`wake:${pair}`] = true;

                    if (!this._finalApproachLosses[`wake:${pair}`]) {
                        this.rulebook.record(
                            RULE.WAKE_ARRIVAL,
                            [followerModel.callsign, leaderModel.callsign],
                            `${spacing.toFixed(1)} nm behind ${leaderModel.callsign} ` +
                            `(${getWakeCategory(leaderModel.model, profile.wakeScheme)}) on final ${runwayName}, ` +
                            `wake minimum ${wakeMinimum} nm`
                        );
                    }
                }
            }
        });

        this._finalApproachLosses = activeLosses;
    }
}

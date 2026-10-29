import _map from 'lodash/map';
import AirportController from '../airport/AirportController';
import GameController from '../game/GameController';
import TimeKeeper from '../engine/TimeKeeper';
import CommandParser from '../commands/parsers/CommandParser';
import { MCP_HEADING_MODE } from '../aircraft/ModeControl/modeControlConstants';
import { FLIGHT_PHASE } from '../constants/aircraftConstants';
import { WAKE_SCHEME } from '../realism/regulatoryProfiles';
import { getWakeCategory } from '../realism/wakeTurbulence';
import { km, nm, radiansToDegrees } from '../utilities/unitConverters';

/**
 * Number of decimals kept for floating point values in observations
 *
 * @property PRECISION
 * @type {number}
 * @final
 */
const PRECISION = 3;

/**
 * Maximum number of flight plan waypoints reported per aircraft
 *
 * @property MAX_WAYPOINTS
 * @type {number}
 * @final
 */
const MAX_WAYPOINTS = 25;

/**
 * Distance from the threshold at which the minimum altitude on final is reported
 *
 * @property FINAL_REFERENCE_DISTANCE_NM
 * @type {number}
 * @final
 */
const FINAL_REFERENCE_DISTANCE_NM = 10;

/**
 * How far ahead on the present track the minimum vectoring altitude is reported, in seconds
 *
 * @property MVA_LOOKAHEAD_SECONDS
 * @type {number}
 * @final
 */
const MVA_LOOKAHEAD_SECONDS = 120;

/**
 * Radius around the aircraft over which the highest minimum vectoring altitude is reported:
 * a turn in any direction stays above terrain when the aircraft is above it
 *
 * @property MVA_AROUND_NM
 * @type {number}
 * @final
 */
const MVA_AROUND_NM = 6;

/**
 * Size of the grid the sampled minimum vectoring altitudes are cached on, in km
 * (the terrain lookup is expensive and never changes during a game)
 *
 * @property MVA_CACHE_CELL_KM
 * @type {number}
 * @final
 */
const MVA_CACHE_CELL_KM = 2;

/**
 * Sampled minimum vectoring altitudes by airport ICAO, then by grid cell; kept across
 * episodes, since a training process flies the same airports again and again
 *
 * @property MVA_CACHE
 * @type {Map<string, Map<string, number|null>>}
 */
const MVA_CACHE = new Map();

/**
 * Above this altitude the minimum vectoring altitude around the aircraft is not looked up
 * (no terrain margin in the TMAs reaches it, and the lookup is expensive)
 *
 * @property MVA_AROUND_CEILING_FT
 * @type {number}
 * @final
 */
const MVA_AROUND_CEILING_FT = 12000;

const round = (value) => (Number.isFinite(value) ? Number(value.toFixed(PRECISION)) : null);
const toDegrees = (radians) => (Number.isFinite(radians) ? round((radiansToDegrees(radians) + 360) % 360) : null);

/**
 * Single interface through which automated controllers (bots) read the state of
 * the simulation and issue clearances.
 *
 * Bots must go through this class instead of touching engine models directly, so
 * that they see exactly what a human controller can see and are bound by exactly
 * the same command set. It works the same in the browser and in the headless
 * simulator.
 *
 * Observations use controller units: nautical miles, feet, knots and degrees.
 * Positions are relative to the airport reference point (x east, y north).
 *
 * @class BotApi
 */
export default class BotApi {
    /**
     * @constructor
     * @param aircraftController {AircraftController}
     */
    constructor(aircraftController) {
        this._aircraftController = aircraftController;
    }

    /**
     * Complete snapshot of the simulation
     *
     * @for BotApi
     * @method getObservation
     * @return {object}
     */
    getObservation() {
        return {
            time: round(TimeKeeper.accumulatedDeltaTime),
            score: GameController.game.score,
            events: { ...GameController.game.events },
            airport: this._buildAirportObservation(),
            realism: this._aircraftController.realismController.getObservation(),
            aircraft: _map(
                this._aircraftController.aircraft.list,
                (aircraftModel) => this._buildAircraftObservation(aircraftModel)
            )
        };
    }

    /**
     * Issue a clearance using the same syntax a human types in the command bar,
     * e.g. `issueCommand('IBE3141', 'fh 270 d 70 sp 210')`
     *
     * @for BotApi
     * @method issueCommand
     * @param callsign {string}
     * @param commandString {string}
     * @return {object} `{ success, message }`
     */
    issueCommand(callsign, commandString) {
        const aircraftModel = this._aircraftController.findAircraftByCallsign(callsign);

        if (!aircraftModel) {
            return { success: false, message: `no such aircraft: ${callsign}` };
        }

        if (!aircraftModel.isControllable) {
            return { success: false, message: `${callsign} is not under our control` };
        }

        let parsedCommand;

        try {
            parsedCommand = new CommandParser(`${aircraftModel.callsign} ${commandString}`).parse();
        } catch (error) {
            // the parser throws plain strings
            return { success: false, message: typeof error === 'string' ? error : error.message };
        }

        // same ordering rule as `AircraftCommander.runCommands()`: takeoff is always executed last
        const commands = [
            ...parsedCommand.args.filter(([command]) => command !== FLIGHT_PHASE.TAKEOFF),
            ...parsedCommand.args.filter(([command]) => command === FLIGHT_PHASE.TAKEOFF)
        ];
        const responses = _map(commands, ([command, ...args]) => {
            const result = this._aircraftController.aircraftCommander.run(aircraftModel, command, args);

            if (!result) {
                return { success: true, message: '' };
            }

            const readback = result[1] && result[1].log ? result[1].log : result[1];

            return { success: Boolean(result[0]), message: readback };
        });

        return {
            success: responses.every((response) => response.success),
            message: _map(responses, 'message').join(', ')
        };
    }

    /**
     * @for BotApi
     * @method _buildAirportObservation
     * @return {object}
     * @private
     */
    _buildAirportObservation() {
        const airportModel = AirportController.airport_get();
        const wind = airportModel.getWindAtAltitude();

        return {
            icao: airportModel.icao.toUpperCase(),
            elevation: round(airportModel.elevation),
            magneticNorth: toDegrees(airportModel.magneticNorth),
            wind: { angle: toDegrees(wind.angle), speed: round(wind.speed) },
            // null when the airport data names a runway that does not exist
            regulatoryProfile: airportModel.regulatoryProfile ? airportModel.regulatoryProfile.id : null,
            runwayConfiguration: airportModel.runwayConfiguration ? airportModel.runwayConfiguration.name : null,
            arrivalRunway: airportModel.arrivalRunwayModel?.name ?? null,
            departureRunway: airportModel.departureRunwayModel?.name ?? null,
            airspace: this._getAirspaceObservation(airportModel),
            runways: _map(airportModel.runways, ([runwayModel, oppositeRunwayModel]) => [
                this._buildRunwayObservation(runwayModel),
                this._buildRunwayObservation(oppositeRunwayModel)
            ])
        };
    }

    /**
     * Lateral and vertical limits of the controlled airspace, one entry per sector
     *
     * Built once per airport: it never changes, and reusing the same array lets the bots
     * cache the geometry derived from it (see `distanceInsideAirspace()`).
     *
     * @for BotApi
     * @method _getAirspaceObservation
     * @param airportModel {AirportModel}
     * @return {array<object>}
     * @private
     */
    _getAirspaceObservation(airportModel) {
        if (!this._airspaceObservation || this._airspaceObservation.airportModel !== airportModel) {
            this._airspaceObservation = {
                airportModel,
                airspace: _map(airportModel.airspace, (airspaceModel) => ({
                    floor: airspaceModel.floor,
                    ceiling: airspaceModel.ceiling,
                    polygon: _map(airspaceModel.relativePoly, ([x, y]) => ({ x: round(nm(x)), y: round(nm(y)) }))
                }))
            };
        }

        return this._airspaceObservation.airspace;
    }

    /**
     * @for BotApi
     * @method _buildRunwayObservation
     * @param runwayModel {RunwayModel}
     * @return {object}
     * @private
     */
    _buildRunwayObservation(runwayModel) {
        const [x, y] = runwayModel.relativePosition;

        return {
            name: runwayModel.name,
            heading: toDegrees(runwayModel.angle),
            threshold: { x: round(nm(x)), y: round(nm(y)) },
            elevation: round(runwayModel.elevation),
            length: round(nm(runwayModel.length)),
            ils: Boolean(runwayModel.ils.enabled),
            // minimum vectoring altitude 10 nm out on the extended centerline (null without terrain data)
            minimumAltitudeOnFinal: this._aircraftController.realismController.getMinimumVectoringAltitude([
                x - Math.sin(runwayModel.angle) * km(FINAL_REFERENCE_DISTANCE_NM),
                y - Math.cos(runwayModel.angle) * km(FINAL_REFERENCE_DISTANCE_NM)
            ]),
            queue: _map(runwayModel.queue, (aircraftId) => {
                const aircraftModel = this._aircraftController.findAircraftById(aircraftId);

                return aircraftModel ? aircraftModel.callsign : aircraftId;
            })
        };
    }

    /**
     * Remaining waypoints of the flight plan. Vector legs (e.g. `#261`) have no
     * position, only the heading to fly.
     *
     * @for BotApi
     * @method _buildWaypointsObservation
     * @param waypointModels {array<WaypointModel>}
     * @return {array<object>}
     * @private
     */
    _buildWaypointsObservation(waypointModels) {
        return _map(waypointModels.slice(0, MAX_WAYPOINTS), (waypointModel) => {
            const hasPosition = !waypointModel.isVectorWaypoint && Boolean(waypointModel.positionModel);
            const [x, y] = hasPosition ? waypointModel.relativePosition : [NaN, NaN];

            return {
                name: waypointModel.name,
                x: hasPosition ? round(nm(x)) : null,
                y: hasPosition ? round(nm(y)) : null,
                vectorHeading: waypointModel.isVectorWaypoint ? toDegrees(waypointModel.getVector()) : null,
                altitudeMinimum: waypointModel.hasAltiudeMinimumRestriction ? waypointModel.altitudeMinimum : null,
                altitudeMaximum: waypointModel.hasAltiudeMaximumRestriction ? waypointModel.altitudeMaximum : null,
                speedMaximum: waypointModel.hasSpeedMaximumRestriction ? waypointModel.speedMaximum : null
            };
        });
    }

    /**
     * Seconds until a taxiing departure reaches the holding point
     *
     * @for BotApi
     * @method _getTaxiRemainingSeconds
     * @param aircraftModel {AircraftModel}
     * @return {number|null}  null when the aircraft is not taxiing
     * @private
     */
    _getTaxiRemainingSeconds(aircraftModel) {
        if (aircraftModel.flightPhase !== FLIGHT_PHASE.TAXI) {
            return null;
        }

        const taxiEnd = aircraftModel.taxi_start + aircraftModel.taxi_time;

        return round(Math.max(0, taxiEnd - TimeKeeper.accumulatedDeltaTime));
    }

    /**
     * Highest minimum vectoring altitude on the present track over the next
     * `MVA_LOOKAHEAD_SECONDS` (null without terrain data)
     *
     * @for BotApi
     * @method _getMinimumVectoringAltitudeAhead
     * @param aircraftModel {AircraftModel}
     * @return {number|null}
     * @private
     */
    _getMinimumVectoringAltitudeAhead(aircraftModel) {
        return this._getHighestAhead(aircraftModel, (position) => this._getSampledMinimumVectoringAltitude(position));
    }

    /**
     * Minimum vectoring altitude near a position, from a cache on a `MVA_CACHE_CELL_KM` grid
     *
     * @for BotApi
     * @method _getSampledMinimumVectoringAltitude
     * @param position {array<number>} relative position, km
     * @return {number|null}
     * @private
     */
    _getSampledMinimumVectoringAltitude([x, y]) {
        const { icao } = AirportController.airport_get();

        if (!MVA_CACHE.has(icao)) {
            MVA_CACHE.set(icao, new Map());
        }

        const values = MVA_CACHE.get(icao);
        const column = Math.round(x / MVA_CACHE_CELL_KM);
        const row = Math.round(y / MVA_CACHE_CELL_KM);
        const key = `${column},${row}`;

        if (!values.has(key)) {
            values.set(key, this._aircraftController.realismController
                .getMinimumVectoringAltitude([column * MVA_CACHE_CELL_KM, row * MVA_CACHE_CELL_KM]));
        }

        return values.get(key);
    }

    /**
     * Highest value of `getValue` within `MVA_AROUND_NM` in any direction
     *
     * @for BotApi
     * @method _getHighestAround
     * @param aircraftModel {AircraftModel}
     * @param getValue {function} relative position (km) -> number|null
     * @return {number|null}
     * @private
     */
    _getHighestAround(aircraftModel, getValue) {
        const [x, y] = aircraftModel.relativePosition;
        let highest = getValue([x, y]);

        [MVA_AROUND_NM / 2, MVA_AROUND_NM].forEach((distanceNm) => {
            for (let degrees = 0; degrees < 360; degrees += 45) {
                const radians = degrees * Math.PI / 180;
                const value = getValue([
                    x + Math.sin(radians) * km(distanceNm),
                    y + Math.cos(radians) * km(distanceNm)
                ]);

                if (value !== null && (highest === null || value > highest)) {
                    highest = value;
                }
            }
        });

        return highest;
    }

    /**
     * Lowest floor of the controlled airspace at a position (null outside it)
     *
     * @for BotApi
     * @method _getAirspaceFloor
     * @param position {array<number>} relative position, km
     * @return {number|null} ft
     * @private
     */
    _getAirspaceFloor(position) {
        let lowest = null;

        AirportController.airport_get().airspace.forEach((airspaceModel) => {
            if ((lowest === null || airspaceModel.floor < lowest) && airspaceModel.isPointInside2D(position)) {
                lowest = airspaceModel.floor;
            }
        });

        return lowest;
    }

    /**
     * Highest value of `getValue` on the present track over the next `MVA_LOOKAHEAD_SECONDS`
     *
     * @for BotApi
     * @method _getHighestAhead
     * @param aircraftModel {AircraftModel}
     * @param getValue {function} relative position (km) -> number|null
     * @return {number|null}
     * @private
     */
    _getHighestAhead(aircraftModel, getValue) {
        const [x, y] = aircraftModel.relativePosition;
        const track = aircraftModel.groundTrack;
        let highest = null;

        for (let seconds = 0; seconds <= MVA_LOOKAHEAD_SECONDS; seconds += MVA_LOOKAHEAD_SECONDS / 2) {
            const distance = km(aircraftModel.groundSpeed * seconds / 3600);
            const value = getValue([
                x + Math.sin(track) * distance,
                y + Math.cos(track) * distance
            ]);

            if (value !== null && (highest === null || value > highest)) {
                highest = value;
            }
        }

        return highest;
    }

    /**
     * @for BotApi
     * @method _buildAircraftObservation
     * @param aircraftModel {AircraftModel}
     * @return {object}
     * @private
     */
    _buildAircraftObservation(aircraftModel) {
        const [x, y] = aircraftModel.relativePosition;
        const [latitude, longitude] = aircraftModel.positionModel.gps;
        const { fms, mcp, model } = aircraftModel;
        const nextWaypoint = fms.currentWaypoint;
        const { regulatoryProfile } = AirportController.airport_get();
        const wakeScheme = regulatoryProfile ? regulatoryProfile.wakeScheme : null;
        const isManeuverable = aircraftModel.isControllable && !aircraftModel.isOnGround() &&
            aircraftModel.altitude < MVA_AROUND_CEILING_FT;

        return {
            callsign: aircraftModel.callsign,
            id: aircraftModel.id,
            category: aircraftModel.category,
            flightPhase: aircraftModel.flightPhase,
            type: model.icao,
            weightClass: model.weightClass,
            recat: model.category ? model.category.recat : null,
            wakeCategory: wakeScheme ? getWakeCategory(model, wakeScheme) : null,
            recatEu: getWakeCategory(model, WAKE_SCHEME.RECAT_EU),
            wakeFaa: getWakeCategory(model, WAKE_SCHEME.FAA),
            origin: aircraftModel.origin,
            destination: aircraftModel.destination,
            x: round(nm(x)),
            y: round(nm(y)),
            latitude: round(latitude),
            longitude: round(longitude),
            distance: round(nm(aircraftModel.distance)),
            altitude: round(aircraftModel.altitude),
            heading: toDegrees(aircraftModel.heading),
            groundTrack: toDegrees(aircraftModel.groundTrack),
            speed: round(aircraftModel.speed),
            groundSpeed: round(aircraftModel.groundSpeed),
            trend: aircraftModel.trend,
            isControllable: aircraftModel.isControllable,
            isOnGround: aircraftModel.isOnGround(),
            isTaxiing: aircraftModel.isTaxiing(),
            taxiRemainingSeconds: this._getTaxiRemainingSeconds(aircraftModel),
            hasApproachClearance: Boolean(aircraftModel.pilot.hasApproachClearance),
            hasDepartureClearance: Boolean(aircraftModel.pilot.hasDepartureClearance),
            isEstablishedOnCourse: aircraftModel.isEstablishedOnCourse(),
            minimumVectoringAltitude: this._aircraftController.realismController
                .getMinimumVectoringAltitude(aircraftModel.relativePosition),
            minimumVectoringAltitudeAhead: this._getMinimumVectoringAltitudeAhead(aircraftModel),
            // only where a bot may turn the aircraft
            minimumVectoringAltitudeAround: isManeuverable ?
                this._getHighestAround(aircraftModel, (position) => this._getSampledMinimumVectoringAltitude(position)) : null,
            // floor of the controlled airspace here, on the track ahead and all around (null outside it)
            airspaceFloor: this._getAirspaceFloor(aircraftModel.relativePosition),
            airspaceFloorAhead: this._getHighestAhead(aircraftModel, (position) => this._getAirspaceFloor(position)),
            airspaceFloorAround: isManeuverable ?
                this._getHighestAround(aircraftModel, (position) => this._getAirspaceFloor(position)) : null,
            warning: Boolean(aircraftModel.warning),
            conflicts: Object.keys(aircraftModel.conflicts),
            speedLimits: { min: model.speed.min, landing: model.speed.landing, max: model.speed.max },
            ceiling: model.ceiling,
            route: fms.getRouteString(),
            waypoints: this._buildWaypointsObservation(fms.waypoints),
            isHoldAssigned: Boolean(nextWaypoint && nextWaypoint.isHoldWaypoint),
            nextWaypoint: nextWaypoint ? nextWaypoint.name : null,
            arrivalRunway: fms.arrivalRunwayModel ? fms.arrivalRunwayModel.name : null,
            departureRunway: fms.departureRunwayModel ? fms.departureRunwayModel.name : null,
            clearance: {
                altitudeMode: mcp.altitudeMode,
                altitude: mcp.altitude,
                headingMode: mcp.headingMode,
                heading: mcp.headingMode === MCP_HEADING_MODE.HOLD ? toDegrees(mcp.heading) : null,
                speedMode: mcp.speedMode,
                speed: mcp.speed
            }
        };
    }
}

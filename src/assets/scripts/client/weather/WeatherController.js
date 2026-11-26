import _get from 'lodash/get';
import GameController from '../game/GameController';
import SpawnScheduler from '../trafficGenerator/SpawnScheduler';
import UiController from '../ui/UiController';
import { RULE } from '../realism/Rulebook';
import { selectRunwayConfiguration, getWindComponentsForRunway } from '../realism/runwayConfiguration';
import { degreesToRadians, radiansToDegrees } from '../utilities/unitConverters';
import { AIRPORT_CONTROL_POSITION_NAME } from '../constants/airportConstants';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import { timeToAreaEntry } from '../safety/safetyNetLogic';
import {
    APPROACH_CATEGORIES,
    EPISODES,
    LVP,
    buildMetar,
    ceilingForVisibility,
    cellAt,
    cellPolygon,
    createCell,
    createWeatherRandom,
    evolveWind,
    fogVisibility,
    isInsideCell,
    isLowVisibility,
    requiredCategory,
    windAtAltitude
} from './weatherLogic';

/**
 * Weather modes. Static is the original behaviour (fixed wind growing 2 % per 1000 ft); dynamic adds the
 * layered wind, its evolution, fog and thunderstorms.
 *
 * @property WEATHER_MODE
 * @type {object}
 * @final
 */
export const WEATHER_MODE = {
    STATIC: 'static',
    DYNAMIC: 'dynamic'
};

const KM_PER_NM = 1.852;
const CLEAR_VISIBILITY_M = 10000;
const MAX_CELLS = 4;
// hysteresis over the runway wind limits before the runway configuration is changed (MET-009)
const RUNWAY_CHANGE_MARGIN_KT = 2;
// approaches flown below minimums before the aircraft diverts (MET-010)
const MISSED_APPROACHES_BEFORE_DIVERSION = 2;
// seconds ahead in which a pilot asks to deviate around a thunderstorm (MET-007)
const DEVIATION_LOOKAHEAD_SECONDS = 60;

/**
 * Best approach category an aircraft can fly: CAT IIIA for airliners, CAT I for light aircraft (MET-001)
 *
 * @function aircraftCategories
 */
function aircraftCategories(aircraftModel) {
    const isLight = aircraftModel.model && aircraftModel.model.weightClass === 'L';

    return isLight ? ['I'] : ['I', 'II', 'IIIA'];
}

/**
 * Dynamic weather: layered wind that evolves, gusts, fog with low visibility procedures, thunderstorm cells.
 *
 * Owned by the `RealismController`, which calls `update()` every second of game time. It has its own random
 * generator (seed + 8800) so the traffic does not change when it is turned on or off. Headless episodes are
 * static unless asked otherwise, which keeps the bot evaluation protocol comparable; the browser follows the
 * game option (dynamic by default).
 *
 * @class WeatherController
 */
export default class WeatherController {
    /**
     * @constructor
     * @param realismController {RealismController}
     */
    constructor(realismController) {
        this._realism = realismController;
        this._modeOverride = null;
        this._seed = Date.now() % 2147483647;
        this.reset();
    }

    /**
     * @for WeatherController
     * @property mode
     * @type {string}
     */
    get mode() {
        if (this._modeOverride !== null) {
            return this._modeOverride;
        }

        const option = GameController.game && GameController.game.option ?
            GameController.game.option.getOptionByName(GAME_OPTION_NAMES.WEATHER) :
            null;

        return option === WEATHER_MODE.STATIC ? WEATHER_MODE.STATIC : WEATHER_MODE.DYNAMIC;
    }

    get isDynamic() {
        return this.mode === WEATHER_MODE.DYNAMIC;
    }

    /**
     * @for WeatherController
     * @method configure
     * @param options {object} `{ mode, seed }`; mode null follows the game option
     */
    configure({ mode = this._modeOverride, seed = this._seed } = {}) {
        this._modeOverride = mode;
        this._seed = seed;
        this.reset();
    }

    /**
     * @for WeatherController
     * @method reset
     */
    reset() {
        this._random = createWeatherRandom(this._seed + 8800);
        this._airportIcao = null;
        this._initialWind = null;
        this._nextMinute = 0;
        this._fog = null;
        this._cells = [];
        this._penetrations = {};
        this._deviationCalls = {};
        this._minimaChecked = {};
        this._missedForWeather = {};
        this.state = this._clearState();
    }

    _clearState() {
        return {
            mode: this.mode,
            wind: null,
            visibility: CLEAR_VISIBILITY_M,
            ceiling: null,
            isLowVisibility: false,
            cells: []
        };
    }

    /**
     * @for WeatherController
     * @method update
     * @param aircraftList {array<AircraftModel>}
     * @param airportModel {AirportModel}
     * @param time {number} game seconds
     */
    update(aircraftList, airportModel, time) {
        if (!this.isDynamic) {
            if (airportModel.windProfile) {
                airportModel.windProfile = null;
            }

            this.state = this._clearState();

            return;
        }

        if (airportModel.icao !== this._airportIcao) {
            this._startAirport(airportModel, time);
        }

        if (time >= this._nextMinute) {
            this._nextMinute = time + 60;
            this._everyMinute(airportModel, time);
        }

        const visibility = fogVisibility(this._fog, time, CLEAR_VISIBILITY_M);
        const ceiling = ceilingForVisibility(visibility);
        const cells = this._cells.map((cell) => ({ id: cell.id, ...cellAt(cell, time) })).filter((cell) => cell.x !== undefined);

        this._cells = this._cells.filter((cell) => cellAt(cell, time) !== null);
        this.state = {
            mode: this.mode,
            wind: this._surfaceWind(airportModel),
            visibility,
            ceiling,
            isLowVisibility: isLowVisibility(visibility, ceiling),
            cells
        };

        this._checkThunderstorms(aircraftList, cells);
    }

    /**
     * Final approach spacing: 4 nm in low visibility procedures (MET-004), the profile minimum otherwise
     *
     * @for WeatherController
     * @method finalApproachMinimumNm
     * @param profile {object}
     * @return {number}
     */
    finalApproachMinimumNm(profile) {
        return this.state.isLowVisibility ? Math.max(profile.finalApproachSeparationNm, LVP.FINAL_SPACING_NM) :
            profile.finalApproachSeparationNm;
    }

    /**
     * At the decision height, the runway must be in sight: RVR above the minimum of a category both the runway
     * and the aircraft can fly. Below minimums the aircraft goes around; after two, it diverts (MET-010)
     *
     * @for WeatherController
     * @method checkLandingMinima
     * @param aircraftModel {AircraftModel}
     * @param runwayModel {RunwayModel}
     * @param height {number} ft above the threshold
     * @return {string|null} reason for a go-around, or null
     */
    checkLandingMinima(aircraftModel, runwayModel, height) {
        if (!this.isDynamic || this.state.visibility >= CLEAR_VISIBILITY_M / 2) {
            return null;
        }

        const runwayCategories = runwayModel.ilsCategories || (runwayModel.ils && runwayModel.ils.enabled ? ['I'] : []);
        const available = runwayCategories.filter((category) => aircraftCategories(aircraftModel).includes(category));
        const category = requiredCategory(this.state.visibility, available.length > 0 ? available : ['I']);
        const decisionHeight = category ? APPROACH_CATEGORIES[category].decisionHeightFt : APPROACH_CATEGORIES.I.decisionHeightFt;

        if (height > decisionHeight || this._minimaChecked[aircraftModel.id]) {
            return null;
        }

        this._minimaChecked[aircraftModel.id] = true;

        if (category) {
            return null;
        }

        this._missedForWeather[aircraftModel.id] = (this._missedForWeather[aircraftModel.id] || 0) + 1;

        return `below minimums, RVR ${this.state.visibility} m`;
    }

    /**
     * Called by the realism controller every check for aircraft no longer on approach: a new approach gets a
     * new minima check; an aircraft that already missed twice for the weather diverts
     *
     * @for WeatherController
     * @method afterApproach
     * @param aircraftModel {AircraftModel}
     * @return {boolean} true if the aircraft diverts (and must be removed)
     */
    afterApproach(aircraftModel) {
        delete this._minimaChecked[aircraftModel.id];

        if ((this._missedForWeather[aircraftModel.id] || 0) < MISSED_APPROACHES_BEFORE_DIVERSION) {
            return false;
        }

        delete this._missedForWeather[aircraftModel.id];
        aircraftModel.radioCall('unable to land, weather below minimums, diverting to alternate',
            AIRPORT_CONTROL_POSITION_NAME.APPROACH, true);
        this._realism.rulebook.record(RULE.DIVERSION, [aircraftModel.callsign],
            `diverted after ${MISSED_APPROACHES_BEFORE_DIVERSION} approaches below minimums (RVR ${this.state.visibility} m)`);

        return true;
    }

    /**
     * Thunderstorm cells as restricted areas for the bots: no entry below the top (MET-007)
     *
     * @for WeatherController
     * @method getCellAreas
     * @return {array<object>} `{ name, height, polygon: [{ x, y }] }` in nm
     */
    getCellAreas() {
        return this.state.cells
            .filter((cell) => cell.intensity >= EPISODES.AVOID_INTENSITY)
            .map((cell) => ({ name: cell.id, height: cell.top, polygon: cellPolygon(cell, 1) }));
    }

    /**
     * @for WeatherController
     * @method getObservation
     * @return {object}
     */
    getObservation() {
        return {
            mode: this.state.mode,
            visibility: this.state.visibility,
            ceiling: this.state.ceiling,
            isLowVisibility: this.state.isLowVisibility,
            gust: this.state.wind ? this.state.wind.gust : null,
            cells: this.state.cells.map((cell) => ({
                x: Math.round(cell.x * 100) / 100,
                y: Math.round(cell.y * 100) / 100,
                radius: Math.round(cell.radius * 100) / 100,
                top: cell.top,
                intensity: cell.intensity
            }))
        };
    }

    /**
     * @for WeatherController
     * @method getMetar
     * @param airportModel {AirportModel}
     * @param date {Date}
     * @return {string}
     */
    getMetar(airportModel, date = new Date()) {
        const wind = this.state.wind || this._surfaceWind(airportModel);
        const climatology = _get(airportModel, 'data.weather.climatology', {});

        return buildMetar(airportModel.icao, {
            wind,
            visibility: this.state.visibility,
            ceiling: this.state.ceiling,
            temperature: _get(climatology, 'temperature', 15),
            dewPoint: this.state.visibility < 1000 ? _get(climatology, 'temperature', 15) : _get(climatology, 'temperature', 15) - 6,
            qnh: 1013,
            thunderstorm: this.state.cells.some((cell) => Math.hypot(cell.x, cell.y) < 30)
        }, date);
    }

    // ------------------------------------------------------------------ evolution

    _startAirport(airportModel, time) {
        this._airportIcao = airportModel.icao;
        this._initialWind = this._surfaceWind(airportModel);
        this._nextMinute = time + 60;
        this._fog = null;
        this._cells = [];

        // the layered profile replaces the 2 % per 1000 ft of the static weather (MET-002)
        airportModel.windProfile = (altitude) => {
            const surface = this._surfaceWind(airportModel);
            const wind = windAtAltitude(surface, altitude - airportModel.elevation);

            return { angle: degreesToRadians(wind.angle), speed: wind.speed };
        };
    }

    _surfaceWind(airportModel) {
        return {
            angle: (radiansToDegrees(airportModel.wind.angle) + 360) % 360,
            speed: airportModel.wind.speed,
            gust: airportModel.windGust || null
        };
    }

    _everyMinute(airportModel, time) {
        const climatology = _get(airportModel, 'data.weather.climatology', {});
        const next = evolveWind(this._surfaceWind(airportModel), this._initialWind, this._random);

        airportModel.wind.angle = degreesToRadians(next.angle);
        airportModel.wind.speed = next.speed;
        airportModel.windGust = next.gust;

        const fogPerHour = _get(climatology, 'fogPerHour', EPISODES.DEFAULT_FOG_PER_HOUR);
        const stormsPerHour = _get(climatology, 'thunderstormsPerHour', EPISODES.DEFAULT_THUNDERSTORMS_PER_HOUR);

        if (!this._fog || time > this._fog.start + this._fog.duration) {
            this._fog = null;

            if (this._random() < fogPerHour / 60) {
                this._fog = {
                    start: time,
                    duration: EPISODES.FOG_MIN_DURATION_SECONDS +
                        this._random() * (EPISODES.FOG_MAX_DURATION_SECONDS - EPISODES.FOG_MIN_DURATION_SECONDS),
                    minimumVisibility: Math.round(EPISODES.FOG_MIN_VISIBILITY_M +
                        this._random() * (EPISODES.FOG_MAX_VISIBILITY_M - EPISODES.FOG_MIN_VISIBILITY_M))
                };
                UiController.ui_log(`${airportModel.icao.toUpperCase()}: fog forming, low visibility expected`);
            }
        }

        if (this._cells.length < MAX_CELLS && this._random() < stormsPerHour / 60) {
            const steering = windAtAltitude(this._surfaceWind(airportModel), 10000);

            this._cells.push(createCell(this._random, time, steering));
        }

        this._checkRunwayConfiguration(airportModel);
    }

    /**
     * When the wind takes the runways in use beyond the tailwind or crosswind limits (with a margin), change
     * to the preferred configuration that fits, and the spawn patterns with it (MET-009)
     *
     * @for WeatherController
     * @method _checkRunwayConfiguration
     * @private
     */
    _checkRunwayConfiguration(airportModel) {
        const configurations = _get(airportModel, 'data.runwayConfigurations', null);
        const current = airportModel.runwayConfiguration;

        if (!Array.isArray(configurations) || configurations.length < 2 || !current) {
            return;
        }

        const profile = airportModel.regulatoryProfile;
        const wind = { angle: airportModel.wind.angle, speed: airportModel.wind.speed };
        const names = current.runways || [current.arrivalRunway, current.departureRunway];
        const isBeyondLimits = names.map((name) => airportModel.getRunway(name)).filter(Boolean).some((runwayModel) => {
            const { head, cross } = getWindComponentsForRunway(runwayModel, wind);

            return -head > profile.maxTailwindKt + RUNWAY_CHANGE_MARGIN_KT ||
                cross > profile.maxCrosswindKt + RUNWAY_CHANGE_MARGIN_KT;
        });

        if (!isBeyondLimits) {
            return;
        }

        const next = selectRunwayConfiguration(airportModel, configurations, airportModel.data.regulatoryProfile);

        if (!next || next.name === current.name) {
            return;
        }

        airportModel.runwayConfiguration = next;
        airportModel.setActiveRunwaysFromNames(next.arrivalRunway, next.departureRunway);
        SpawnScheduler.switchSpawnPatterns(airportModel.data);
        UiController.ui_log(`${airportModel.icao.toUpperCase()}: runway change to ${next.name} configuration ` +
            `(arrivals ${next.arrivalRunway}, departures ${next.departureRunway}) due to wind`, true);
    }

    // ------------------------------------------------------------------ thunderstorms

    _checkThunderstorms(aircraftList, cells) {
        const avoid = cells.filter((cell) => cell.intensity >= EPISODES.AVOID_INTENSITY);
        const areas = avoid.map((cell) => ({ name: cell.id, height: cell.top, polygon: cellPolygon(cell) }));

        aircraftList.forEach((aircraftModel) => {
            if (aircraftModel.isOnGround() || !aircraftModel.isControllable) {
                aircraftModel.weatherWarning = null;

                return;
            }

            const position = {
                x: aircraftModel.relativePosition[0] / KM_PER_NM,
                y: aircraftModel.relativePosition[1] / KM_PER_NM
            };
            const inside = avoid.find((cell) => isInsideCell(position, aircraftModel.altitude, cell));

            if (inside) {
                const key = `${aircraftModel.id}|${inside.id}`;

                aircraftModel.weatherWarning = inside.id;

                if (!this._penetrations[key]) {
                    this._penetrations[key] = true;
                    aircraftModel.radioCall('encountering severe turbulence and heavy precipitation',
                        AIRPORT_CONTROL_POSITION_NAME.APPROACH, true);
                    this._realism.rulebook.record(RULE.WEATHER_PENETRATION, [aircraftModel.callsign],
                        `inside thunderstorm ${inside.id} (intensity ${inside.intensity}) at ${Math.round(aircraftModel.altitude)} ft`);
                }

                return;
            }

            const speedNmPerSecond = (aircraftModel.groundSpeed || 0) / 3600;
            const state = {
                ...position,
                vx: Math.sin(aircraftModel.groundTrack || 0) * speedNmPerSecond,
                vy: Math.cos(aircraftModel.groundTrack || 0) * speedNmPerSecond,
                altitude: aircraftModel.altitude,
                verticalSpeed: 0,
                targetAltitude: aircraftModel.altitude
            };
            const entry = areas.length > 0 ? timeToAreaEntry(state, areas) : null;

            aircraftModel.weatherWarning = entry && entry.seconds <= DEVIATION_LOOKAHEAD_SECONDS ? entry.area.name : null;

            if (aircraftModel.weatherWarning && !this._deviationCalls[`${aircraftModel.id}|${entry.area.name}`]) {
                this._deviationCalls[`${aircraftModel.id}|${entry.area.name}`] = true;
                aircraftModel.radioCall('weather ahead, request deviation', AIRPORT_CONTROL_POSITION_NAME.APPROACH);
            }
        });
    }
}

import fs from 'fs';
import path from 'path';
import AircraftController from '../client/aircraft/AircraftController';
import AirlineController from '../client/airline/AirlineController';
import AirportController from '../client/airport/AirportController';
import BotApi from '../client/bot/BotApi';
import EventBus from '../client/lib/EventBus';
import GameController, { GAME_EVENTS_POINT_VALUES } from '../client/game/GameController';
import NavigationLibrary from '../client/navigationLibrary/NavigationLibrary';
import ScopeModel from '../client/scope/ScopeModel';
import ScoreController from '../client/game/ScoreController';
import SpawnPatternCollection from '../client/trafficGenerator/SpawnPatternCollection';
import SpawnScheduler from '../client/trafficGenerator/SpawnScheduler';
import TimeKeeper from '../client/engine/TimeKeeper';
import UiController from '../client/ui/UiController';
import { GAME_OPTION_NAMES } from '../client/constants/gameOptionConstants';
import { reseed } from './seededRandom';

/**
 * Default duration of one simulation step, in seconds
 *
 * Equivalent to a browser frame at 4x timewarp. Must stay below 1 second so the
 * aircraft physics (turns, localizer capture) behave as they do in the browser.
 *
 * @property DEFAULT_STEP_SECONDS
 * @type {number}
 * @final
 */
const DEFAULT_STEP_SECONDS = 0.25;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readJsonDirectory = (directory, skip) => fs.readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.json') && fileName !== skip)
    .sort()
    .map((fileName) => readJson(path.join(directory, fileName)));

/**
 * Runs the openScope engine without a browser, faster than real time and
 * deterministically for a given seed.
 *
 * It wires the same singletons as `AppController.setupChildren()` minus every view
 * (canvas, strips, input, speech). Radio messages that the game would print in the
 * log are collected instead, so bots can read them.
 *
 * Must be loaded through `tools/sim/bootstrap.js`, which provides the DOM shim and
 * the seeded `Math.random`.
 *
 * @class HeadlessSimulator
 */
export default class HeadlessSimulator {
    /**
     * @constructor
     * @param options {object}
     * @param options.assetsPath {string}    path to the repository `assets` directory
     * @param [options.stepSeconds] {number}  duration of one physics step
     * @param [options.towerController] {string}  `USER` (default): the controller handles taxi and takeoff
     *                                             clearances; `SYSTEM`: the game does it automatically
     */
    constructor({ assetsPath, stepSeconds = DEFAULT_STEP_SECONDS, towerController = 'USER' }) {
        this.stepSeconds = stepSeconds;
        this.towerController = towerController;
        this._assetsPath = assetsPath;
        this._airportLoadList = readJson(path.join(assetsPath, 'airports', 'airportLoadList.json'));
        this._aircraftDefinitions = readJsonDirectory(path.join(assetsPath, 'aircraft'), 'aircraft.json');
        this._airlineDefinitions = readJsonDirectory(path.join(assetsPath, 'airlines'), 'airlines.json');
        this._airportCache = {};
        this._radioLog = [];
        this._scoreLog = [];
        this.airportIcao = null;
        this.seed = null;
        this.aircraftController = null;
        this.botApi = null;

        UiController.ui_log = (message, isWarning = false) => {
            this._radioLog.push({ time: TimeKeeper.accumulatedDeltaTime, message, isWarning });
        };
        // the game prints every scored event in a DOM list; collect them instead
        GameController.updateScoreHistory = (gameEvent) => {
            this._scoreLog.push({
                time: TimeKeeper.accumulatedDeltaTime,
                event: gameEvent,
                points: GAME_EVENTS_POINT_VALUES[gameEvent]
            });
        };
    }

    /**
     * Start a new episode: load `airportIcao`, clear all traffic, score and timers,
     * and spawn the initial traffic using `seed`
     *
     * @for HeadlessSimulator
     * @method reset
     * @param airportIcao {string}
     * @param seed {number}
     * @param [options] {object}
     * @param [options.wind] {object}  `{ angle, speed }` surface wind (degrees, knots) replacing the
     *                                  airport's default; the runway configuration is chosen from it
     * @param [options.trafficScale] {number}  multiplies the rate of every spawn pattern
     * @return {object} observation
     */
    reset(airportIcao, seed = 0, { wind = null, trafficScale = 1 } = {}) {
        const icao = airportIcao.toLowerCase();
        const airportJson = this._loadAirportJson(icao);

        if (wind) {
            airportJson.wind = { angle: Number(wind.angle), speed: Number(wind.speed) };
        }

        if (trafficScale !== 1) {
            airportJson.spawnPatterns.forEach((spawnPattern) => {
                spawnPattern.rate *= trafficScale;
            });
        }

        reseed(seed);
        EventBus.destroy();
        TimeKeeper.reset();
        TimeKeeper.enableFixedStepMode();
        TimeKeeper.setPause(false);
        GameController.destroyTimers();
        GameController.initializeEventCount();
        GameController.game_reset_score_and_events();
        GameController.game.option.setOptionByName(GAME_OPTION_NAMES.TOWER_CONTROLLER, this.towerController);

        AirportController.reset();
        AirportController.init(icao, airportJson, this._airportLoadList);
        NavigationLibrary.reset();
        NavigationLibrary.init(airportJson);
        SpawnPatternCollection.reset();
        SpawnPatternCollection.init(airportJson);

        // definitions are mutated by the models (e.g. lowercased aircraft types), so give each episode a fresh copy
        const airlineController = new AirlineController(JSON.parse(JSON.stringify(this._airlineDefinitions)));
        const scopeModel = new ScopeModel();

        this.aircraftController = new AircraftController(
            JSON.parse(JSON.stringify(this._aircraftDefinitions)),
            airlineController,
            scopeModel
        );
        this._scoreController = new ScoreController(this.aircraftController);
        window.aircraftController = this.aircraftController;
        SpawnScheduler.init(this.aircraftController);

        this.botApi = new BotApi(this.aircraftController);
        this.airportIcao = icao;
        this.seed = seed;
        this._radioLog = [];
        this._scoreLog = [];

        return this.observe();
    }

    /**
     * Advance the simulation by `seconds` of simulated time
     *
     * @for HeadlessSimulator
     * @method step
     * @param seconds {number}
     * @return {object} observation
     */
    step(seconds = this.stepSeconds) {
        const steps = Math.max(1, Math.round(seconds / this.stepSeconds));

        for (let i = 0; i < steps; i++) {
            TimeKeeper.advanceFixedStep(this.stepSeconds);
            GameController.updateTimers();
            this.aircraftController.update();
        }

        return this.observe();
    }

    /**
     * @for HeadlessSimulator
     * @method command
     * @param callsign {string}
     * @param commandString {string}
     * @return {object} `{ success, message }`
     */
    command(callsign, commandString) {
        return this.botApi.issueCommand(callsign, commandString);
    }

    /**
     * Current observation, plus the radio messages and scored events produced since the last call
     *
     * @for HeadlessSimulator
     * @method observe
     * @return {object}
     */
    observe() {
        const observation = this.botApi.getObservation();

        observation.radio = this._radioLog;
        observation.scoreEvents = this._scoreLog;
        observation.violations = this.aircraftController.realismController.rulebook.drainViolations();
        this._radioLog = [];
        this._scoreLog = [];

        return observation;
    }

    /**
     * @for HeadlessSimulator
     * @method _loadAirportJson
     * @param icao {string}
     * @return {object}
     * @private
     */
    _loadAirportJson(icao) {
        if (!this._airportCache[icao]) {
            this._airportCache[icao] = readJson(path.join(this._assetsPath, 'airports', `${icao}.json`));
        }

        // the engine mutates airport data while building models, so hand out a fresh copy
        return JSON.parse(JSON.stringify(this._airportCache[icao]));
    }
}

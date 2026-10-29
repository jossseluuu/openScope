import _forEach from 'lodash/forEach';
import _random from 'lodash/random';
import SpawnPatternCollection from './SpawnPatternCollection';
import { distanceFromRouteEndToRunway } from './buildPreSpawnAircraft';
import AirportController from '../airport/AirportController';
import TimeKeeper from '../engine/TimeKeeper';
import GameController from '../game/GameController';
import { INVALID_NUMBER } from '../constants/globalConstants';

/**
 * An arrival that would wait longer than this for its turn is not spawned at all,
 * so the queue cannot grow without limit when the routes ask for more traffic
 * than the minimum interval allows
 *
 * @property MAX_ARRIVAL_QUEUE_SECONDS
 * @type {number}
 * @final
 */
const MAX_ARRIVAL_QUEUE_SECONDS = 600;

/**
 * At an airport that spaces its arrivals, the game starts with the arrivals of about this many
 * minutes of traffic already inside the airspace (at least one), so the scope is not empty
 *
 * @property INITIAL_TRAFFIC_MINUTES
 * @type {number}
 * @final
 */
const INITIAL_TRAFFIC_MINUTES = 10;

/**
 * Distance to its runway (along the rest of its route, then straight to the threshold) of the
 * first initial arrival, and between the following ones, in nm. Staggering it staggers their
 * landing times, so none of them starts with a delay to absorb.
 *
 * @property INITIAL_ARRIVAL_TO_RUNWAY_NM
 * @type {object}
 * @final
 */
const INITIAL_ARRIVAL_TO_RUNWAY_NM = { FIRST: 25, STEP: 15, MINIMUM_ROUTE_LEFT: 15 };

const ONE_HOUR_IN_SECONDS = 3600;

/**
 * At an airport that spaces its arrivals, a new arrival appears on its route this far
 * before the airspace boundary (about two minutes of flight)
 *
 * @property ARRIVAL_SPAWN_LEAD_NM
 * @type {number}
 * @final
 */
const ARRIVAL_SPAWN_LEAD_NM = 10;

/**
 * A spawn refused by the safety check is tried again this often, up to this many times
 *
 * @property SPAWN_RETRY
 * @type {object}
 * @final
 */
const SPAWN_RETRY = { SECONDS: 30, ATTEMPTS: 10 };

/**
 * Used to create a game_timer for a `SpawnPatternModel` and provide
 * methods for re-creating a new timer on timer expiration.
 *
 * This is designed to be a stateless class.
 *
 * @class SpawnScheduler
 */
class SpawnScheduler {
    /**
     * @constructor
     * @for SpawnScheduler
     * @param aircraftController {AircraftController}
     */
    constructor() {
        /**
         * @property _aircraftController
         * @type {AircraftController}
         * @default null
         * @private
         */
        this._aircraftController = null;

        /**
         * Earliest game time the next arrival may be spawned, when the airport spaces them
         * (see `AirportModel#arrivalSpawn`)
         *
         * @property _nextArrivalTime
         * @type {number}
         * @default 0
         * @private
         */
        this._nextArrivalTime = 0;
    }

    /**
     * @for SpawnScheduler
     * @method init
     * @param aircraftController {AircraftController}
     * @chainable
     */
    init(aircraftController) {
        if (typeof aircraftController === 'undefined') {
            throw new TypeError('Invalid parameter. SpawnScheduler requires aircraftController to be defined.');
        }

        this._aircraftController = aircraftController;

        this.startScheduler();

        return this;
    }

    /**
     * Starts the scheduler and prespawns departures
     *
     * @for SpawnScheduler
     * @method startScheduler
     */
    startScheduler() {
        this._nextArrivalTime = 0;
        // TODO: rename to createSchedulesWithTimer
        this.createSchedulesFromList();
        // TODO: create getter on collection to get all preSpawn including departures
        // TODO: create method `createPreSpawnDeparturesAndArrivals`
        this.createPreSpawnDepartures();
    }

    /**
     * Loop through each `SpawnPatternModel` and create a `game_timeout` for each
     *
     * @for SpawnScheduler
     * @method createSchedulesFromList
     */
    createSchedulesFromList() {
        const isSpaced = this._getArrivalIntervalSeconds() > 0;

        _forEach(SpawnPatternCollection.spawnPatternModels, (spawnPatternModel) => {
            // set the #cycleStartTime for this `spawnPatternModel` with current game time
            spawnPatternModel.cycleStart(TimeKeeper.accumulatedDeltaTime);
            spawnPatternModel.scheduleId = isSpaced && this._isRandomArrival(spawnPatternModel) ?
                // spaced arrivals start flowing at once instead of after up to twice their mean interval
                this._createTimeout(spawnPatternModel, _random(0, ONE_HOUR_IN_SECONDS / spawnPatternModel.rate, true)) :
                this.createNextSchedule(spawnPatternModel);
            spawnPatternModel.createPreSpawnAircraft(this._aircraftController);
        });

        if (isSpaced) {
            this._createInitialArrivals();
        }
    }

    /**
     * Instead of filling every route (pre-spawn), start with the arrivals of the first
     * `INITIAL_TRAFFIC_MINUTES` already on their way: one per route, routes picked in proportion to
     * their traffic, each one `INITIAL_ARRIVAL_FROM_ROUTE_END_NM.STEP` further from the end of its route
     *
     * @for SpawnScheduler
     * @method _createInitialArrivals
     * @private
     */
    _createInitialArrivals() {
        const airport = AirportController.airport_get();
        let candidates = SpawnPatternCollection.spawnPatternModels.filter((model) => this._isRandomArrival(model));
        const totalRate = candidates.reduce((sum, model) => sum + model.rate, 0);
        const count = Math.min(candidates.length, Math.max(1, Math.round(totalRate * INITIAL_TRAFFIC_MINUTES / 60)));
        const chosen = [];

        for (let i = 0; i < count; i++) {
            const total = candidates.reduce((sum, model) => sum + model.rate, 0);
            let pick = _random(0, total, true);
            const model = candidates.find((candidate) => {
                pick -= candidate.rate;

                return pick <= 0;
            }) || candidates[candidates.length - 1];

            candidates = candidates.filter((candidate) => candidate !== model);
            chosen.push({ model, endToRunway: distanceFromRouteEndToRunway(model, airport) });
        }

        // the route that ends closest to its runway gets the first landing
        chosen.sort((a, b) => a.endToRunway - b.endToRunway).forEach(({ model, endToRunway }, i) => {
            const toRunway = INITIAL_ARRIVAL_TO_RUNWAY_NM.FIRST + i * INITIAL_ARRIVAL_TO_RUNWAY_NM.STEP;
            const fromRouteEndNm = Math.max(INITIAL_ARRIVAL_TO_RUNWAY_NM.MINIMUM_ROUTE_LEFT, toRunway - endToRunway);

            // an initial arrival that would not be safe is simply left out
            this._aircraftController.tryCreateAirborneAircraft(model, 0, fromRouteEndNm);
        });

        // the regular flow continues one interval later
        this._nextArrivalTime = TimeKeeper.accumulatedDeltaTime + this._getArrivalIntervalSeconds();
    }

    /**
     * @for SpawnScheduler
     * @method _isRandomArrival
     * @param spawnPatternModel {SpawnPatternModel}
     * @return {boolean}
     * @private
     */
    _isRandomArrival(spawnPatternModel) {
        return spawnPatternModel.isAirborneAtSpawn() && spawnPatternModel.method === 'random' && spawnPatternModel.rate > 0;
    }

    /**
     * Minimum interval between arrivals at the current airport, 0 when they are not spaced
     *
     * @for SpawnScheduler
     * @method _getArrivalIntervalSeconds
     * @return {number}
     * @private
     */
    _getArrivalIntervalSeconds() {
        const airport = AirportController.airport_get();

        return airport && airport.arrivalSpawn ? airport.arrivalSpawn.minimumIntervalSeconds : 0;
    }

    /**
     * Loop through each airborne `SpawnPatternModel` and reset the spawned and preSpawned traffic.
     *
     * Used when resetting the traffic in the traffic settings panel.
     *
     * @for SpawnScheduler
     * @method resetAirborneTraffic
     */
    resetAirborneTraffic() {
        SpawnPatternCollection.spawnPatternModels.filter((s) => s.isAirborneAtSpawn()).forEach((spawnPatternModel) => {
            spawnPatternModel.preSpawnAircraftList = [];
            spawnPatternModel.createPreSpawnAircraft(this._aircraftController);
            this.resetTimer(spawnPatternModel);
        });
    }

    /**
     * Send `SpawnPatternModel` objects off the the `AircraftController` to create
     * new aircraft onLoad or onAirportChange.
     *
     * When starting a session there should always be at least one departure waiting
     * to taxi. The logic for determining _which_ patterns to use, and how many,
     * is handled within the `SpawnPatternCollection`. Here we simply get the
     * result and loop through each `SpawnPatternModel`.
     *
     * @for SpawnScheduler
     * @method createPreSpawnDepartures
     */
    createPreSpawnDepartures() {
        const departureModelsToPreSpawn = SpawnPatternCollection.getDepartureModelsForPreSpawn();

        for (let i = 0; i < departureModelsToPreSpawn.length; i++) {
            const spawnPatternModel = departureModelsToPreSpawn[i];

            this._aircraftController.createAircraftWithSpawnPatternModel(spawnPatternModel);
        }
    }

    /**
     * Registers a new timeout, its callback and callback arguments with the `GameController`
     *
     * @for SpawnScheduler
     * @method createNextSchedule
     * @param spawnPatternModel {SpawnPatternModel}
     * @return {array}
     */
    createNextSchedule(spawnPatternModel) {
        const delay = spawnPatternModel.getNextDelayValue(TimeKeeper.accumulatedDeltaTime);

        return this._createTimeout(spawnPatternModel, delay);
    }

    /**
     * Resets the timer for a specific spawn pattern
     *
     * @for SpawnScheduler
     * @method resetTimer
     * @param spawnPatternModel {SpawnPatternModel}
     */
    resetTimer(spawnPatternModel) {
        let timePassed = 0;
        const { scheduleId } = spawnPatternModel;

        if (scheduleId && scheduleId !== INVALID_NUMBER) {
            GameController.destroyTimer(spawnPatternModel.scheduleId);

            const timerStart = spawnPatternModel.scheduleId[1] - spawnPatternModel.scheduleId[3];
            timePassed = TimeKeeper.accumulatedDeltaTime - timerStart;
            spawnPatternModel.scheduleId = null;
        }

        if (spawnPatternModel.rate <= 0) {
            return;
        }

        let nextDelay = spawnPatternModel.getNextDelayValue(TimeKeeper.accumulatedDeltaTime);

        if (timePassed < nextDelay) {
            nextDelay -= timePassed;
        } else {
            this._spawn(spawnPatternModel, this._aircraftController);
        }

        spawnPatternModel.scheduleId = this._createTimeout(spawnPatternModel, nextDelay);
    }

    /**
     * Registers a new timeout, its callback and callback arguments with the `GameController`
     *
     * @for SpawnScheduler
     * @method _createTimeout
     * @param spawnPatternModel {SpawnPatternModel}
     * @param delay {number} time in seconds
     * @return {array}
     */
    _createTimeout(spawnPatternModel, delay) {
        return GameController.game_timeout(
            this.createAircraftAndRegisterNextTimeout,
            // lifespan of timeout
            delay,
            // passing null only to match existing api
            null,
            // arguments sent to callback as it's first parameter. using array so multiple arg can be sent
            [spawnPatternModel, this._aircraftController]
        );
    }

    /**
     * Method sent to `game_timeout` as the callback
     *
     * When fired, this method will call `createAircraftWithSpawnPatternModel` and then
     * create a new time by calling `createNextSchedule`. Doing so will also result
     * in calculating a new delay period.
     *
     * Accepts two arguments; `spawnPattern` and `aircraftController`.
     *
     * @for SpawnScheduler
     * @method createAircraftAndRegisterNextTimeout
     * @param args {*[]}
     */
    createAircraftAndRegisterNextTimeout = (...args) => {
        const spawnPatternModel = args[0][0];
        const aircraftController = args[0][1];

        this._spawn(spawnPatternModel, aircraftController);

        spawnPatternModel.scheduleId = this.createNextSchedule(spawnPatternModel);
    };

    /**
     * Create the aircraft of a spawn pattern, now or, for an arrival at an airport that
     * spaces its arrivals, at the next free slot
     *
     * @for SpawnScheduler
     * @method _spawn
     * @param spawnPatternModel {SpawnPatternModel}
     * @param aircraftController {AircraftController}
     * @private
     */
    _spawn(spawnPatternModel, aircraftController) {
        if (!spawnPatternModel.isAirborneAtSpawn()) {
            aircraftController.createAircraftWithSpawnPatternModel(spawnPatternModel);

            return;
        }

        const interval = this._getArrivalIntervalSeconds();

        if (!(interval > 0)) {
            this._trySpawnAirborne(spawnPatternModel, aircraftController, null, 0);

            return;
        }

        const now = TimeKeeper.accumulatedDeltaTime;
        const slot = Math.max(now, this._nextArrivalTime);

        if (slot - now > MAX_ARRIVAL_QUEUE_SECONDS) {
            return;
        }

        this._nextArrivalTime = slot + interval;

        if (slot === now) {
            this._trySpawnAirborne(spawnPatternModel, aircraftController, ARRIVAL_SPAWN_LEAD_NM, 0);

            return;
        }

        GameController.game_timeout(
            ([model, controller]) => this._trySpawnAirborne(model, controller, ARRIVAL_SPAWN_LEAD_NM, 0),
            slot - now,
            null,
            [spawnPatternModel, aircraftController]
        );
    }

    /**
     * Create an airborne aircraft if the spawn safety check allows it, otherwise try again
     * `SPAWN_RETRY.SECONDS` later, up to `SPAWN_RETRY.ATTEMPTS` times
     *
     * @for SpawnScheduler
     * @method _trySpawnAirborne
     * @param spawnPatternModel {SpawnPatternModel}
     * @param aircraftController {AircraftController}
     * @param leadDistanceNm {number|null}
     * @param attempt {number}
     * @private
     */
    _trySpawnAirborne(spawnPatternModel, aircraftController, leadDistanceNm, attempt) {
        const { created } = aircraftController.tryCreateAirborneAircraft(spawnPatternModel, leadDistanceNm);

        if (created || attempt + 1 >= SPAWN_RETRY.ATTEMPTS) {
            return;
        }

        GameController.game_timeout(
            ([model, controller]) => this._trySpawnAirborne(model, controller, leadDistanceNm, attempt + 1),
            SPAWN_RETRY.SECONDS,
            null,
            [spawnPatternModel, aircraftController]
        );
    }
}


export default new SpawnScheduler();

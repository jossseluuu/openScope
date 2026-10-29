import { getRecatEuCategory } from './wakeTurbulence';
import { FLIGHT_PHASE } from '../constants/aircraftConstants';

/**
 * Approximate fuel flow, in kg per second, by RECAT-EU category
 *
 * Terminal area values (approach and initial climb averaged) and taxi values with
 * all engines running. They are coarse estimates meant to compare strategies,
 * not to predict the fuel burn of a specific flight.
 *
 * @property FUEL_FLOW_KG_PER_SECOND
 * @type {object}
 * @final
 */
const FUEL_FLOW_KG_PER_SECOND = {
    AIRBORNE: {
        A: 3.0, B: 2.0, C: 1.5, D: 0.7, E: 0.4, F: 0.06
    },
    GROUND: {
        A: 0.5, B: 0.35, C: 0.3, D: 0.12, E: 0.08, F: 0.01
    }
};

/**
 * kg of CO2 emitted per kg of jet fuel burned (ICAO Carbon Emissions Calculator)
 *
 * @property CO2_PER_KG_FUEL
 * @type {number}
 * @final
 */
const CO2_PER_KG_FUEL = 3.16;

const SECONDS_PER_HOUR = 3600;

const average = (values) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

/**
 * Efficiency and environmental metrics of the traffic handled since the last reset
 *
 * @class MetricsCollector
 */
export default class MetricsCollector {
    /**
     * @constructor
     */
    constructor() {
        this.reset(0);
    }

    /**
     * @for MetricsCollector
     * @method reset
     * @param time {number} current game time, in seconds
     */
    reset(time) {
        this._startTime = time;
        this._lastTime = time;
        this._flights = {};
        this.landings = 0;
        this.takeoffs = 0;
        this.goArounds = 0;
        this.separationLossSeconds = 0;
        this.fuelKg = 0;
        this._arrivalTimesInAirspace = [];
        this._arrivalTrackMiles = [];
        this._departureGroundTimes = [];
        this._holdingPointWaits = [];
    }

    /**
     * Integrate per-aircraft quantities over the elapsed time
     *
     * @for MetricsCollector
     * @method update
     * @param time {number}
     * @param aircraftList {array<AircraftModel>}
     */
    update(time, aircraftList) {
        const elapsed = Math.max(0, time - this._lastTime);

        this._lastTime = time;

        for (let i = 0; i < aircraftList.length; i++) {
            const aircraftModel = aircraftList[i];
            const flight = this._getFlight(aircraftModel, time);
            const category = getRecatEuCategory(aircraftModel.model);
            const isOnGround = aircraftModel.isOnGround();

            if (!isOnGround || aircraftModel.isTaxiing() || aircraftModel.isTakeoff()) {
                const flow = isOnGround ? FUEL_FLOW_KG_PER_SECOND.GROUND : FUEL_FLOW_KG_PER_SECOND.AIRBORNE;

                this.fuelKg += flow[category] * elapsed;
            }

            if (aircraftModel.isControllable && !isOnGround) {
                flight.trackMiles += aircraftModel.groundSpeed * elapsed / SECONDS_PER_HOUR;

                if (flight.enteredAirspaceAt === null) {
                    flight.enteredAirspaceAt = time;
                }
            }

            if (flight.readyAt === null && aircraftModel.flightPhase === FLIGHT_PHASE.WAITING) {
                flight.readyAt = time;
            }
        }
    }

    /**
     * @for MetricsCollector
     * @method recordLanding
     * @param aircraftModel {AircraftModel}
     * @param time {number}
     */
    recordLanding(aircraftModel, time) {
        const flight = this._getFlight(aircraftModel, time);

        this.landings += 1;

        if (flight.enteredAirspaceAt !== null) {
            this._arrivalTimesInAirspace.push(time - flight.enteredAirspaceAt);
            this._arrivalTrackMiles.push(flight.trackMiles);
        }
    }

    /**
     * @for MetricsCollector
     * @method recordTakeoff
     * @param aircraftModel {AircraftModel}
     * @param time {number}
     */
    recordTakeoff(aircraftModel, time) {
        const flight = this._getFlight(aircraftModel, time);

        this.takeoffs += 1;
        this._departureGroundTimes.push(time - flight.firstSeenAt);

        if (flight.readyAt !== null) {
            this._holdingPointWaits.push(time - flight.readyAt);
        }
    }

    /**
     * @for MetricsCollector
     * @method recordGoAround
     */
    recordGoAround() {
        this.goArounds += 1;
    }

    /**
     * @for MetricsCollector
     * @method addSeparationLossTime
     * @param seconds {number}
     */
    addSeparationLossTime(seconds) {
        this.separationLossSeconds += seconds;
    }

    /**
     * Forget aircraft that left the simulation
     *
     * @for MetricsCollector
     * @method removeAircraft
     * @param aircraftId {string}
     */
    removeAircraft(aircraftId) {
        delete this._flights[aircraftId];
    }

    /**
     * @for MetricsCollector
     * @method getSummary
     * @return {object}
     */
    getSummary() {
        const hours = Math.max(this._lastTime - this._startTime, 1) / SECONDS_PER_HOUR;

        return {
            elapsedSeconds: this._lastTime - this._startTime,
            landings: this.landings,
            takeoffs: this.takeoffs,
            movementsPerHour: (this.landings + this.takeoffs) / hours,
            goArounds: this.goArounds,
            separationLossSeconds: this.separationLossSeconds,
            averageArrivalTimeInAirspaceSeconds: average(this._arrivalTimesInAirspace),
            averageArrivalTrackMiles: average(this._arrivalTrackMiles),
            averageDepartureGroundTimeSeconds: average(this._departureGroundTimes),
            averageHoldingPointWaitSeconds: average(this._holdingPointWaits),
            fuelKg: this.fuelKg,
            co2Kg: this.fuelKg * CO2_PER_KG_FUEL
        };
    }

    /**
     * @for MetricsCollector
     * @method _getFlight
     * @param aircraftModel {AircraftModel}
     * @param time {number}
     * @return {object}
     * @private
     */
    _getFlight(aircraftModel, time) {
        if (!this._flights[aircraftModel.id]) {
            this._flights[aircraftModel.id] = {
                firstSeenAt: time,
                enteredAirspaceAt: null,
                readyAt: null,
                trackMiles: 0
            };
        }

        return this._flights[aircraftModel.id];
    }
}

/**
 * Unimpeded taxi time from the apron to a runway holding point when the airport
 * file gives none, in seconds
 *
 * EUROCONTROL reports average unimpeded taxi-out times of 5 to 10 minutes at
 * large European airports.
 *
 * @property DEFAULT_TAXI_TIME_SECONDS
 * @type {number}
 * @final
 */
export const DEFAULT_TAXI_TIME_SECONDS = 300;

/**
 * Taxi times vary with the stand, the route and other ground traffic: the actual
 * time is drawn between 85% and 125% of the unimpeded time
 *
 * @property TAXI_TIME_VARIATION
 * @type {object}
 * @final
 */
const TAXI_TIME_VARIATION = {
    MIN: 0.85,
    MAX: 1.25
};

/**
 * Time it takes a departure to taxi to `runwayModel`, in seconds
 *
 * Airports may define `"taxiTimes": { "<runway>": seconds }` in their file.
 *
 * @function calculateTaxiTimeSeconds
 * @param airportModel {AirportModel}
 * @param runwayModel {RunwayModel}
 * @return {number}
 */
export function calculateTaxiTimeSeconds(airportModel, runwayModel) {
    const taxiTimes = (airportModel && airportModel.taxiTimes) || {};
    const unimpededTime = taxiTimes[runwayModel.name] || DEFAULT_TAXI_TIME_SECONDS;
    const variation = TAXI_TIME_VARIATION.MIN + Math.random() * (TAXI_TIME_VARIATION.MAX - TAXI_TIME_VARIATION.MIN);

    return Math.round(unimpededTime * variation);
}

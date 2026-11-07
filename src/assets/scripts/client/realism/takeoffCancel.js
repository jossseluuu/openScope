/**
 * Fraction of the rotation speed (the aircraft's minimum speed, where it lifts off in this
 * simulation) used as V1: from there on a takeoff can no longer be stopped on the runway
 *
 * @property V1_FACTOR
 * @type {number}
 * @final
 */
export const V1_FACTOR = 0.9;

/**
 * How a cancelled takeoff uses the runway.
 *
 * - `HOLDING_POINT_DELAY_SECONDS`: an aircraft stopped at the holding point never entered the
 *   runway; it only goes back to the end of the queue and needs this long to be ready again
 * - `DECELERATION_KT_PER_SECOND`, `VACATE_SECONDS`: a rejected takeoff stops and leaves the runway
 * - above `HIGH_ENERGY_KT` the brakes need an inspection on the runway: `HIGH_ENERGY_SECONDS` more
 * - `READY_AGAIN_SECONDS`: after vacating, it taxis back to the holding point
 *
 * @property TAKEOFF_CANCEL
 * @type {object}
 * @final
 */
export const TAKEOFF_CANCEL = {
    HOLDING_POINT_DELAY_SECONDS: 60,
    DECELERATION_KT_PER_SECOND: 4,
    VACATE_SECONDS: 45,
    HIGH_ENERGY_KT: 80,
    HIGH_ENERGY_SECONDS: 60,
    READY_AGAIN_SECONDS: 120
};

/**
 * A cancellation is justified by an arrival to the same runway closer than the separation
 * minimum plus this margin (the same one the automatic tower keeps)
 *
 * @property ARRIVAL_MARGIN_NM
 * @type {number}
 * @final
 */
const ARRIVAL_MARGIN_NM = 1;

/**
 * A cancellation is justified by an aircraft in emergency landing on that runway within this time
 *
 * @property EMERGENCY_PROTECTION_SECONDS
 * @type {number}
 * @final
 */
const EMERGENCY_PROTECTION_SECONDS = 240;

/**
 * Speed from which a takeoff can no longer be stopped
 *
 * @function takeoffDecisionSpeed
 * @param aircraftModelSpeeds {object}  `model.speed` of the aircraft type
 * @return {number} kt
 */
export const takeoffDecisionSpeed = ({ min }) => min * V1_FACTOR;

/**
 * Seconds a rejected takeoff keeps the runway occupied from the moment it is cancelled
 *
 * @function rejectedTakeoffOccupancySeconds
 * @param speed {number}  speed when it was cancelled, kt
 * @return {number}
 */
export function rejectedTakeoffOccupancySeconds(speed) {
    const stopping = speed / TAKEOFF_CANCEL.DECELERATION_KT_PER_SECOND;
    const inspection = speed > TAKEOFF_CANCEL.HIGH_ENERGY_KT ? TAKEOFF_CANCEL.HIGH_ENERGY_SECONDS : 0;

    return stopping + TAKEOFF_CANCEL.VACATE_SECONDS + inspection;
}

/**
 * Whether cancelling a takeoff was justified: it must protect the runway or the wake interval.
 * The first reason found is given, most serious first.
 *
 * @function judgeTakeoffCancel
 * @param situation {object}
 * @param situation.occupants {array<string>}    callsigns of the others on the physical runway
 * @param situation.wakeLeader {object|null}     `{ callsign, elapsed, required }`, wake interval not met
 * @param situation.arrivals {array<object>}     to that runway: `{ callsign, distanceNm, seconds, isEmergency }`
 * @param situation.arrivalSeparationNm {number} arrival-departure separation of the regulatory profile
 * @return {object} `{ isJustified, reason }`
 */
export function judgeTakeoffCancel({
    occupants, wakeLeader, arrivals, arrivalSeparationNm
}) {
    if (occupants.length > 0) {
        return { isJustified: true, reason: `runway occupied by ${occupants[0]}` };
    }

    if (wakeLeader) {
        return {
            isJustified: true,
            reason: `only ${Math.round(wakeLeader.elapsed)} s behind ${wakeLeader.callsign}, wake minimum ${wakeLeader.required} s`
        };
    }

    const close = arrivals.find((arrival) => arrival.distanceNm < arrivalSeparationNm + ARRIVAL_MARGIN_NM);

    if (close) {
        return { isJustified: true, reason: `${close.callsign} landing ${close.distanceNm.toFixed(1)} nm from the threshold` };
    }

    const emergency = arrivals.find((arrival) => arrival.isEmergency && arrival.seconds < EMERGENCY_PROTECTION_SECONDS);

    if (emergency) {
        return { isJustified: true, reason: `${emergency.callsign} in emergency lands in ${Math.round(emergency.seconds)} s` };
    }

    return {
        isJustified: false,
        reason: `runway free, wake interval met, no arrival within ${arrivalSeparationNm + ARRIVAL_MARGIN_NM} nm`
    };
}

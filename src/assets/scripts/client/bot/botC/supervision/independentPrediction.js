/**
 * Prediction used by the supervisors. It is deliberately separate from the one the agents use
 * (`botA/conflictResolution`): a shared prediction would make the same mistakes as the agents and
 * see nothing wrong. It is simple: straight tracks, and a constant rate to the cleared altitude.
 */

/**
 * Time between the points of a prediction, in seconds
 *
 * @property STEP_SECONDS
 * @type {number}
 * @final
 */
const STEP_SECONDS = 10;

/**
 * Climb or descent rate of the prediction, in feet per second
 *
 * @property VERTICAL_RATE_FT_PER_SECOND
 * @type {number}
 * @final
 */
const VERTICAL_RATE_FT_PER_SECOND = 30;

/**
 * Aircraft below this height are in the hands of Tower and are not checked
 *
 * @property MINIMUM_HEIGHT_FT
 * @type {number}
 * @final
 */
const MINIMUM_HEIGHT_FT = 800;

const toRadians = (degrees) => degrees * Math.PI / 180;

/**
 * Where an aircraft will be
 *
 * @function positionAfter
 * @param aircraft {object}  `{ x, y, altitude, groundTrack, groundSpeed, clearance }`
 * @param seconds {number}
 * @return {object} `{ x, y, altitude }`
 */
export function positionAfter(aircraft, seconds) {
    const travelled = aircraft.groundSpeed * seconds / 3600;
    const track = toRadians(aircraft.groundTrack);
    const target = Number.isFinite(aircraft.clearance.altitude) ? aircraft.clearance.altitude : aircraft.altitude;
    const change = Math.min(Math.abs(target - aircraft.altitude), VERTICAL_RATE_FT_PER_SECOND * seconds);

    return {
        x: aircraft.x + travelled * Math.sin(track),
        y: aircraft.y + travelled * Math.cos(track),
        altitude: aircraft.altitude + Math.sign(target - aircraft.altitude) * change
    };
}

/**
 * Closest approach of two aircraft under the separation minima, within the horizon
 *
 * @function predictPairLoss
 * @param first {object}
 * @param second {object}
 * @param minima {object}   `{ radarNm, verticalFt }`
 * @param horizonSeconds {number}
 * @return {object|null} `{ seconds, lateralNm, verticalFt }` of the first loss
 */
export function predictPairLoss(first, second, { radarNm, verticalFt }, horizonSeconds) {
    for (let seconds = 0; seconds <= horizonSeconds; seconds += STEP_SECONDS) {
        const a = positionAfter(first, seconds);
        const b = positionAfter(second, seconds);
        const lateralNm = Math.hypot(a.x - b.x, a.y - b.y);
        const vertical = Math.abs(a.altitude - b.altitude);

        if (lateralNm < radarNm && vertical < verticalFt) {
            return { seconds, lateralNm, verticalFt: vertical };
        }
    }

    return null;
}

/**
 * Whether the supervisors check this pair: separation on final is judged by the Rulebook, which
 * knows the wake and parallel approach minima
 *
 * @function isSupervisedPair
 * @param first {object}
 * @param second {object}
 * @param elevation {number}
 * @return {boolean}
 */
export function isSupervisedPair(first, second, elevation) {
    const isFlying = (aircraft) => !aircraft.isOnGround && aircraft.altitude - elevation > MINIMUM_HEIGHT_FT;

    return first.callsign !== second.callsign && isFlying(first) && isFlying(second) &&
        !(first.hasApproachClearance && second.hasApproachClearance);
}

/**
 * First predicted loss of an aircraft with anyone, and the closest traffic if there is none
 *
 * @function predictTraffic
 * @param aircraft {object}
 * @param observation {object}
 * @param horizonSeconds {number}
 * @return {object} `{ loss, with, nearest }`, `nearest` is `{ callsign, nm }` or null
 */
export function predictTraffic(aircraft, observation, horizonSeconds) {
    const { elevation } = observation.airport;
    const minima = observation.realism.separationMinima;
    let result = { loss: null, with: null, nearest: null };

    observation.aircraft.forEach((other) => {
        if (!isSupervisedPair(aircraft, other, elevation)) {
            return;
        }

        const nm = Math.hypot(aircraft.x - other.x, aircraft.y - other.y);

        if (!result.nearest || nm < result.nearest.nm) {
            result = { ...result, nearest: { callsign: other.callsign, nm } };
        }

        const loss = predictPairLoss(aircraft, other, minima, horizonSeconds);

        if (loss && (!result.loss || loss.seconds < result.loss.seconds)) {
            result = { ...result, loss, with: other.callsign };
        }
    });

    return result;
}

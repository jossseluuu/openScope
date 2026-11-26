/**
 * Pure logic of the safety nets: STCA (ground based short term conflict alert), TCAS II / ACAS II
 * (airborne collision avoidance), MSAW (minimum safe altitude warning) and APW (area proximity warning).
 *
 * Everything here works on plain "states" so it can be tested without the engine:
 * `{ x, y }` position in nm (x east, y north), `vx, vy` ground velocity in nm/s, `altitude` ft,
 * `verticalSpeed` ft/s, `targetAltitude` ft (the aircraft levels off there).
 *
 * Rule ids refer to docs/especificacion/reglas.yaml (STC-*, TCA-*).
 */

/**
 * STCA parameters (STC-001)
 *
 * @property STCA
 * @type {object}
 * @final
 */
export const STCA = {
    HORIZON_SECONDS: 120,
    STEP_SECONDS: 5,
    // a conflict predicted within this time is an alert; further out, a predicted conflict (caution)
    ALERT_SECONDS: 60
};

/**
 * STCA alert levels
 *
 * @property STCA_LEVEL
 * @type {object}
 * @final
 */
export const STCA_LEVEL = {
    NONE: 'NONE',
    PREDICTED: 'PREDICTED',
    ALERT: 'ALERT'
};

/**
 * TCAS II v7.1 thresholds by sensitivity level (TCA-001). `maxHeightAgl` bounds SL2 and SL3 (height above
 * the ground), `maxAltitude` the others (altitude). RA thresholds are null where no RA is issued.
 *
 * @property TCAS_SENSITIVITY_LEVELS
 * @type {array<object>}
 * @final
 */
export const TCAS_SENSITIVITY_LEVELS = [
    {
        level: 2, maxHeightAgl: 1000, tauTa: 20, tauRa: null, dmodTa: 0.30, dmodRa: null, zthrTa: 850, zthrRa: null, alim: null
    },
    {
        level: 3, maxHeightAgl: 2350, tauTa: 25, tauRa: 15, dmodTa: 0.33, dmodRa: 0.20, zthrTa: 850, zthrRa: 600, alim: 300
    },
    {
        level: 4, maxAltitude: 5000, tauTa: 30, tauRa: 20, dmodTa: 0.48, dmodRa: 0.35, zthrTa: 850, zthrRa: 600, alim: 300
    },
    {
        level: 5, maxAltitude: 10000, tauTa: 40, tauRa: 25, dmodTa: 0.75, dmodRa: 0.55, zthrTa: 850, zthrRa: 600, alim: 350
    },
    {
        level: 6, maxAltitude: 20000, tauTa: 45, tauRa: 30, dmodTa: 1.00, dmodRa: 0.80, zthrTa: 850, zthrRa: 600, alim: 400
    },
    {
        level: 7, maxAltitude: Infinity, tauTa: 48, tauRa: 35, dmodTa: 1.30, dmodRa: 1.10, zthrTa: 850, zthrRa: 700, alim: 600
    }
];

/**
 * Other TCAS constants (TCA-002 .. TCA-004)
 *
 * @property TCAS
 * @type {object}
 * @final
 */
export const TCAS = {
    // no RA below this height (SL2 gives traffic advisories only)
    RA_MINIMUM_HEIGHT_AGL: 1000,
    // no descend RA below this height
    DESCEND_RA_MINIMUM_HEIGHT_AGL: 1100,
    // vertical speed flown to comply with a climb or descend RA
    RA_VERTICAL_SPEED_FPM: 1500,
    // time for the crew to react to an RA
    PILOT_REACTION_SECONDS: 5,
    // the RA ends after the encounter has been clear for this long
    CLEAR_OF_CONFLICT_SECONDS: 3,
    // longest time to closest approach considered when choosing the RA sense
    MAX_PREDICTION_SECONDS: 60
};

/**
 * TCAS states and RA senses
 *
 * @property TCAS_STATE
 * @type {object}
 * @final
 */
export const TCAS_STATE = {
    CLEAR: 'CLEAR',
    TA: 'TA',
    RA: 'RA'
};

export const RA_SENSE = {
    CLIMB: 1,
    DESCEND: -1,
    // "level off" / "monitor vertical speed": keep the present altitude
    LEVEL: 0
};

/**
 * MSAW and APW look-ahead (MSW-*, APW-*)
 *
 * @property AREA_WARNINGS
 * @type {object}
 * @final
 */
export const AREA_WARNINGS = {
    MSAW_LOOKAHEAD_SECONDS: 30,
    APW_LOOKAHEAD_SECONDS: 60,
    STEP_SECONDS: 5
};

/**
 * Altitude after `seconds`, levelling off at the target altitude
 *
 * @function predictAltitude
 * @param state {object}
 * @param seconds {number}
 * @return {number}
 */
export function predictAltitude(state, seconds) {
    const altitude = state.altitude + state.verticalSpeed * seconds;
    const target = state.targetAltitude;

    if (typeof target !== 'number') {
        return altitude;
    }

    if (state.verticalSpeed > 0 && target >= state.altitude) {
        return Math.min(altitude, target);
    }

    if (state.verticalSpeed < 0 && target <= state.altitude) {
        return Math.max(altitude, target);
    }

    return altitude;
}

/**
 * Position after `seconds` on the present ground track and speed
 *
 * @function predictPosition
 */
export function predictPosition(state, seconds) {
    return { x: state.x + state.vx * seconds, y: state.y + state.vy * seconds };
}

const horizontalDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * STCA: time until the pair loses separation, linear prediction with level-off at the cleared altitude
 *
 * @function stcaTimeToLoss
 * @param first {object} state
 * @param second {object} state
 * @param minima {object} `{ lateralNm, verticalFt }`
 * @return {number|null} seconds (0 = already lost), or null if no loss within the horizon
 */
export function stcaTimeToLoss(first, second, minima) {
    for (let time = 0; time <= STCA.HORIZON_SECONDS; time += STCA.STEP_SECONDS) {
        const lateral = horizontalDistance(predictPosition(first, time), predictPosition(second, time));
        const vertical = Math.abs(predictAltitude(first, time) - predictAltitude(second, time));

        if (lateral < minima.lateralNm && vertical < minima.verticalFt) {
            return time;
        }
    }

    return null;
}

/**
 * @function stcaLevel
 * @param timeToLoss {number|null}
 * @return {string} one of `STCA_LEVEL`
 */
export function stcaLevel(timeToLoss) {
    if (timeToLoss === null) {
        return STCA_LEVEL.NONE;
    }

    return timeToLoss <= STCA.ALERT_SECONDS ? STCA_LEVEL.ALERT : STCA_LEVEL.PREDICTED;
}

/**
 * TCAS sensitivity level for an own aircraft
 *
 * @function sensitivityLevel
 * @param altitude {number} ft
 * @param heightAgl {number} ft above the ground (the airport elevation)
 * @return {object} a row of `TCAS_SENSITIVITY_LEVELS`
 */
export function sensitivityLevel(altitude, heightAgl) {
    if (heightAgl < TCAS_SENSITIVITY_LEVELS[0].maxHeightAgl) {
        return TCAS_SENSITIVITY_LEVELS[0];
    }

    if (heightAgl < TCAS_SENSITIVITY_LEVELS[1].maxHeightAgl) {
        return TCAS_SENSITIVITY_LEVELS[1];
    }

    return TCAS_SENSITIVITY_LEVELS.slice(2).find((row) => altitude < row.maxAltitude);
}

/**
 * Range, range rate and vertical geometry of an encounter, seen from `own`
 *
 * @function encounterGeometry
 * @return {object} `{ range, rangeRate, verticalSeparation, verticalRate, isConverging }`
 *   range in nm, rangeRate in nm/s (negative when closing), verticalSeparation own minus intruder (ft),
 *   verticalRate its derivative (ft/s)
 */
export function encounterGeometry(own, intruder) {
    const dx = intruder.x - own.x;
    const dy = intruder.y - own.y;
    const dvx = intruder.vx - own.vx;
    const dvy = intruder.vy - own.vy;
    const range = Math.hypot(dx, dy);
    const rangeRate = range > 0 ? (dx * dvx + dy * dvy) / range : 0;
    const verticalSeparation = own.altitude - intruder.altitude;
    const verticalRate = own.verticalSpeed - intruder.verticalSpeed;

    return {
        range,
        rangeRate,
        verticalSeparation,
        verticalRate,
        isConverging: verticalSeparation * verticalRate < 0
    };
}

/**
 * Whether the encounter meets the TA or RA criteria for the given thresholds: horizontally, inside DMOD or
 * a modified tau below the threshold; vertically, inside ZTHR or converging with a vertical tau below it
 *
 * @function isThreat
 * @param geometry {object} from `encounterGeometry`
 * @param tau {number} s
 * @param dmod {number} nm
 * @param zthr {number} ft
 * @return {boolean}
 */
export function isThreat(geometry, tau, dmod, zthr) {
    const {
        range, rangeRate, verticalSeparation, verticalRate, isConverging
    } = geometry;
    let isHorizontalThreat = range < dmod;

    if (!isHorizontalThreat && rangeRate < 0) {
        const modifiedTau = -(range * range - dmod * dmod) / (range * rangeRate);

        isHorizontalThreat = modifiedTau < tau;
    }

    if (!isHorizontalThreat) {
        return false;
    }

    const separation = Math.abs(verticalSeparation);

    if (separation < zthr) {
        return true;
    }

    return isConverging && separation / Math.abs(verticalRate) < tau;
}

/**
 * TCAS state of `own` against `intruder` (without the RA sense)
 *
 * @function tcasThreatLevel
 * @param own {object} state, plus `heightAgl`
 * @param intruder {object} state
 * @return {string} one of `TCAS_STATE`
 */
export function tcasThreatLevel(own, intruder) {
    const row = sensitivityLevel(own.altitude, own.heightAgl);
    const geometry = encounterGeometry(own, intruder);

    if (row.tauRa !== null && own.heightAgl >= TCAS.RA_MINIMUM_HEIGHT_AGL &&
        isThreat(geometry, row.tauRa, row.dmodRa, row.zthrRa)) {
        return TCAS_STATE.RA;
    }

    return isThreat(geometry, row.tauTa, row.dmodTa, row.zthrTa) ? TCAS_STATE.TA : TCAS_STATE.CLEAR;
}

/**
 * Time to the closest point of approach, bounded
 *
 * @function timeToClosestApproach
 */
export function timeToClosestApproach(own, intruder) {
    const dvx = intruder.vx - own.vx;
    const dvy = intruder.vy - own.vy;
    const relativeSpeedSquared = dvx * dvx + dvy * dvy;

    if (relativeSpeedSquared === 0) {
        return 0;
    }

    const time = -((intruder.x - own.x) * dvx + (intruder.y - own.y) * dvy) / relativeSpeedSquared;

    return Math.min(TCAS.MAX_PREDICTION_SECONDS, Math.max(0, time));
}

/**
 * Coordinated RA senses for both aircraft of an encounter.
 *
 * If both aircraft levelling off at their present altitudes already keeps ALIM (the threat comes from their
 * vertical rates), both get "level off". Otherwise the aircraft above climbs and the one below descends (no
 * crossing, complementary senses), unless a descend RA is inhibited near the ground or a climb is impossible
 * at the ceiling, in which case the senses are swapped.
 *
 * @function coordinatedSenses
 * @param first {object} state, plus `heightAgl` and `ceiling`
 * @param second {object} state, plus `heightAgl` and `ceiling`
 * @param alim {number} ft
 * @return {array<number>} `[firstSense, secondSense]`, each one of `RA_SENSE`
 */
export function coordinatedSenses(first, second, alim) {
    const separationNow = first.altitude - second.altitude;

    if (Math.abs(separationNow) >= alim) {
        return [RA_SENSE.LEVEL, RA_SENSE.LEVEL];
    }

    let isFirstAbove = separationNow > 0 || (separationNow === 0 && first.verticalSpeed >= second.verticalSpeed);
    const canDescend = (state) => state.heightAgl >= TCAS.DESCEND_RA_MINIMUM_HEIGHT_AGL;
    const canClimb = (state) => !(state.altitude >= (state.ceiling || Infinity) - 500);
    const lower = isFirstAbove ? second : first;
    const upper = isFirstAbove ? first : second;

    if (!canDescend(lower) || !canClimb(upper)) {
        isFirstAbove = !isFirstAbove;
    }

    return isFirstAbove ? [RA_SENSE.CLIMB, RA_SENSE.DESCEND] : [RA_SENSE.DESCEND, RA_SENSE.CLIMB];
}

/**
 * Whether a vertical clearance goes against an active RA: a lower altitude during a climb RA, a higher one
 * during a descend RA, or any change during a level-off RA
 *
 * @function isContraryToRa
 * @param sense {number} one of `RA_SENSE`
 * @param currentAltitude {number}
 * @param clearedAltitude {number}
 * @return {boolean}
 */
export function isContraryToRa(sense, currentAltitude, clearedAltitude) {
    if (sense === RA_SENSE.CLIMB) {
        return clearedAltitude < currentAltitude;
    }

    if (sense === RA_SENSE.DESCEND) {
        return clearedAltitude > currentAltitude;
    }

    return Math.abs(clearedAltitude - currentAltitude) >= 100;
}

/**
 * Whether a point is inside a polygon (ray casting)
 *
 * @function isInsidePolygon
 * @param point {object} `{ x, y }`
 * @param polygon {array<object>} `[{ x, y }, ...]`
 */
export function isInsidePolygon(point, polygon) {
    let isInside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const a = polygon[i];
        const b = polygon[j];

        if ((a.y > point.y) !== (b.y > point.y) &&
            point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
            isInside = !isInside;
        }
    }

    return isInside;
}

/**
 * APW: seconds until the aircraft enters one of the areas below its ceiling, or null
 *
 * @function timeToAreaEntry
 * @param state {object}
 * @param areas {array<object>} `{ name, height, polygon: [{x, y}] }`
 * @return {object|null} `{ seconds, area }`
 */
export function timeToAreaEntry(state, areas) {
    for (let time = 0; time <= AREA_WARNINGS.APW_LOOKAHEAD_SECONDS; time += AREA_WARNINGS.STEP_SECONDS) {
        const position = predictPosition(state, time);
        const altitude = predictAltitude(state, time);
        const area = areas.find((candidate) => altitude < candidate.height && isInsidePolygon(position, candidate.polygon));

        if (area) {
            return { seconds: time, area };
        }
    }

    return null;
}

/**
 * MSAW: seconds until the aircraft is below the minimum altitude, or null
 *
 * @function timeBelowMinimumAltitude
 * @param state {object}
 * @param minimumAltitudeAt {function} `({ x, y }) => ft`
 * @param tolerance {number} ft
 * @return {number|null}
 */
export function timeBelowMinimumAltitude(state, minimumAltitudeAt, tolerance) {
    for (let time = 0; time <= AREA_WARNINGS.MSAW_LOOKAHEAD_SECONDS; time += AREA_WARNINGS.STEP_SECONDS) {
        const position = predictPosition(state, time);

        if (predictAltitude(state, time) < minimumAltitudeAt(position) - tolerance) {
            return time;
        }
    }

    return null;
}

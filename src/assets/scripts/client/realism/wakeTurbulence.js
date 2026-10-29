import { WAKE_SCHEME } from './regulatoryProfiles';

/**
 * Wake turbulence separation minima between a leading and a following aircraft.
 *
 * Tables are indexed `[leader][follower]`; a missing entry means that no wake
 * separation applies and only the radar separation minimum is required.
 */

/**
 * RECAT-EU distance-based minima on approach, in nautical miles
 * (EUROCONTROL RECAT-EU Edition 1.1, table 1)
 *
 * @property RECAT_EU_ARRIVAL_NM
 * @type {object}
 * @final
 */
const RECAT_EU_ARRIVAL_NM = {
    A: {
        A: 3, B: 4, C: 5, D: 5, E: 6, F: 8
    },
    B: {
        B: 3, C: 4, D: 4, E: 5, F: 7
    },
    C: {
        C: 3, D: 3, E: 4, F: 6
    },
    D: { F: 5 },
    E: { F: 4 },
    F: { F: 3 }
};

/**
 * RECAT-EU time-based minima for departures, in seconds
 * (EUROCONTROL RECAT-EU Edition 1.1, table 2)
 *
 * @property RECAT_EU_DEPARTURE_SECONDS
 * @type {object}
 * @final
 */
const RECAT_EU_DEPARTURE_SECONDS = {
    A: {
        B: 100, C: 120, D: 140, E: 160, F: 180
    },
    B: { D: 100, E: 120, F: 140 },
    C: { D: 80, E: 100, F: 120 },
    D: { F: 120 },
    E: { F: 100 },
    F: { F: 80 }
};

/**
 * ICAO Doc 4444 8.7.3.4 distance-based minima, in nautical miles
 *
 * @property ICAO_ARRIVAL_NM
 * @type {object}
 * @final
 */
const ICAO_ARRIVAL_NM = {
    J: { H: 6, M: 7, L: 8 },
    H: { H: 4, M: 5, L: 6 },
    M: { L: 5 }
};

/**
 * ICAO Doc 4444 5.8.3 time-based minima for departures, in seconds
 *
 * @property ICAO_DEPARTURE_SECONDS
 * @type {object}
 * @final
 */
const ICAO_DEPARTURE_SECONDS = {
    J: { H: 120, M: 180, L: 180 },
    H: { M: 120, L: 120 },
    M: { L: 120 }
};

/**
 * FAA JO 7110.65 5-5-4 minima, in nautical miles
 *
 * @property FAA_ARRIVAL_NM
 * @type {object}
 * @final
 */
const FAA_ARRIVAL_NM = {
    SUPER: {
        HEAVY: 6, B757: 7, LARGE: 7, SMALL: 8
    },
    HEAVY: {
        HEAVY: 4, B757: 5, LARGE: 5, SMALL: 6
    },
    B757: { SMALL: 4 },
    LARGE: { SMALL: 4 }
};

/**
 * FAA JO 7110.65 3-9-6 minima for departures, in seconds
 *
 * @property FAA_DEPARTURE_SECONDS
 * @type {object}
 * @final
 */
const FAA_DEPARTURE_SECONDS = {
    SUPER: {
        HEAVY: 180, B757: 180, LARGE: 180, SMALL: 180
    },
    HEAVY: { B757: 120, LARGE: 120, SMALL: 120 },
    B757: { SMALL: 120 }
};

const TABLES = {
    [WAKE_SCHEME.RECAT_EU]: { arrival: RECAT_EU_ARRIVAL_NM, departure: RECAT_EU_DEPARTURE_SECONDS },
    [WAKE_SCHEME.ICAO]: { arrival: ICAO_ARRIVAL_NM, departure: ICAO_DEPARTURE_SECONDS },
    [WAKE_SCHEME.FAA]: { arrival: FAA_ARRIVAL_NM, departure: FAA_DEPARTURE_SECONDS }
};

// used when an aircraft file has no RECAT-EU or FAA category
const RECAT_EU_FROM_ICAO = {
    J: 'A', H: 'B', M: 'D', L: 'F'
};
const FAA_FROM_ICAO = {
    J: 'SUPER', H: 'HEAVY', M: 'LARGE', L: 'SMALL'
};

/**
 * Runway occupancy time of a landing aircraft, in seconds, by RECAT-EU category
 *
 * Typical values for runways with rapid exit taxiways (EUROCONTROL RECAT-EU and
 * ROT studies); light aircraft vacate early, the largest types need the longest roll.
 *
 * @property LANDING_RUNWAY_OCCUPANCY_SECONDS
 * @type {object}
 * @final
 */
export const LANDING_RUNWAY_OCCUPANCY_SECONDS = {
    A: 70,
    B: 62,
    C: 58,
    D: 52,
    E: 50,
    F: 45
};

/**
 * Wake category of an aircraft type in the given scheme
 *
 * @function getWakeCategory
 * @param typeModel {AircraftTypeDefinitionModel}
 * @param scheme {string}  one of `WAKE_SCHEME`
 * @return {string}
 */
export function getWakeCategory(typeModel, scheme) {
    const category = typeModel.category || {};

    switch (scheme) {
        case WAKE_SCHEME.RECAT_EU:
            return category.recatEu || RECAT_EU_FROM_ICAO[typeModel.weightClass] || 'D';
        case WAKE_SCHEME.FAA:
            return category.wakeFaa || FAA_FROM_ICAO[typeModel.weightClass] || 'LARGE';
        default:
            return typeModel.weightClass || 'M';
    }
}

/**
 * RECAT-EU category, used for runway occupancy and fuel estimates regardless of the scheme in use
 *
 * @function getRecatEuCategory
 * @param typeModel {AircraftTypeDefinitionModel}
 * @return {string}
 */
export function getRecatEuCategory(typeModel) {
    return getWakeCategory(typeModel, WAKE_SCHEME.RECAT_EU);
}

/**
 * Wake separation required behind `leaderType` on approach, in nautical miles
 *
 * @function getArrivalWakeSeparationNm
 * @param leaderType {AircraftTypeDefinitionModel}
 * @param followerType {AircraftTypeDefinitionModel}
 * @param scheme {string}
 * @return {number} 0 when no wake separation applies
 */
export function getArrivalWakeSeparationNm(leaderType, followerType, scheme) {
    const table = TABLES[scheme].arrival;
    const row = table[getWakeCategory(leaderType, scheme)] || {};

    return row[getWakeCategory(followerType, scheme)] || 0;
}

/**
 * Wake separation required between two departures from the same runway, in seconds
 *
 * @function getDepartureWakeSeparationSeconds
 * @param leaderType {AircraftTypeDefinitionModel}
 * @param followerType {AircraftTypeDefinitionModel}
 * @param scheme {string}
 * @return {number} 0 when no wake separation applies
 */
export function getDepartureWakeSeparationSeconds(leaderType, followerType, scheme) {
    const table = TABLES[scheme].departure;
    const row = table[getWakeCategory(leaderType, scheme)] || {};

    return row[getWakeCategory(followerType, scheme)] || 0;
}

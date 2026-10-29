/**
 * Air traffic control rules that differ between regulators.
 *
 * Every airport uses one profile. It is chosen from the ICAO location indicator
 * (`getRegulatoryProfileForAirport()`) and can be overridden from the airport file
 * with `"regulatoryProfile": "EASA" | "FAA" | "ICAO"`.
 *
 * References:
 * - ICAO Doc 4444 PANS-ATM, chapters 5, 6, 7 and 8
 * - EASA SERA and the EUROCONTROL RECAT-EU wake scheme (Edition 1.1)
 * - FAA JO 7110.65, chapters 3 and 5
 */

/**
 * Wake turbulence schemes
 *
 * @property WAKE_SCHEME
 * @type {object}
 * @final
 */
export const WAKE_SCHEME = {
    /**
     * ICAO Doc 4444 8.7.3.4 and 5.8: categories J, H, M, L
     */
    ICAO: 'ICAO',
    /**
     * EUROCONTROL RECAT-EU: categories A to F
     */
    RECAT_EU: 'RECAT_EU',
    /**
     * FAA JO 7110.65 5-5-4 and 3-9-6: Super, Heavy, B757, Large, Small
     */
    FAA: 'FAA'
};

/**
 * @property REGULATORY_PROFILE
 * @type {object}
 * @final
 */
export const REGULATORY_PROFILE = {
    EASA: {
        id: 'EASA',
        name: 'ICAO Doc 4444 / EASA SERA with RECAT-EU',
        wakeScheme: WAKE_SCHEME.RECAT_EU,
        // radar separation within a terminal area (Doc 4444 8.7.3.2 b)
        radarSeparationNm: 3,
        verticalSeparationFt: 1000,
        // minimum radar separation on final approach, RECAT-EU reduced MRS
        finalApproachSeparationNm: 2.5,
        // a departure may not start its takeoff roll while an arrival is closer than this to the threshold
        arrivalDepartureSeparationNm: 2,
        // tailwind and crosswind limits for runway selection (Doc 4444 7.2.3, noise preferential runways)
        maxTailwindKt: 5,
        maxCrosswindKt: 20,
        // heading divergence that separates simultaneous departures from parallel runways (Doc 4444 6.7.3.2.3)
        parallelDepartureDivergenceDeg: 15
    },
    ICAO: {
        id: 'ICAO',
        name: 'ICAO Doc 4444 PANS-ATM',
        wakeScheme: WAKE_SCHEME.ICAO,
        radarSeparationNm: 3,
        verticalSeparationFt: 1000,
        finalApproachSeparationNm: 3,
        arrivalDepartureSeparationNm: 2,
        maxTailwindKt: 5,
        maxCrosswindKt: 20,
        parallelDepartureDivergenceDeg: 15
    },
    FAA: {
        id: 'FAA',
        name: 'FAA JO 7110.65',
        wakeScheme: WAKE_SCHEME.FAA,
        // terminal radar separation (5-5-4 a)
        radarSeparationNm: 3,
        verticalSeparationFt: 1000,
        // reduced separation on final is only authorized at some airports (5-5-4 i), so use the standard minimum
        finalApproachSeparationNm: 3,
        // 3-9-6 / 3-10-3: the departure must be airborne before the arrival is 2 miles from the threshold
        arrivalDepartureSeparationNm: 2,
        maxTailwindKt: 5,
        maxCrosswindKt: 20,
        // 5-8-3: courses diverging by 15 degrees or more
        parallelDepartureDivergenceDeg: 15
    }
};

// ICAO nationality letters of states that apply FAA rules
const FAA_LOCATION_PREFIXES = ['K', 'PA', 'PF', 'PH', 'PG', 'PJ', 'PM', 'PO', 'PP', 'PW', 'TJ', 'TI'];
// European states that apply EASA rules (E and L regions) and Iceland
const EASA_LOCATION_PREFIXES = ['E', 'L', 'BI'];

/**
 * Regulatory profile that applies at an airport
 *
 * @function getRegulatoryProfileForAirport
 * @param icao {string}             ICAO location indicator
 * @param [override] {string}       profile id from the airport file
 * @return {object}                 one of `REGULATORY_PROFILE`
 */
export function getRegulatoryProfileForAirport(icao, override) {
    if (override && REGULATORY_PROFILE[override.toUpperCase()]) {
        return REGULATORY_PROFILE[override.toUpperCase()];
    }

    const location = (icao || '').toUpperCase();

    if (FAA_LOCATION_PREFIXES.some((prefix) => location.startsWith(prefix))) {
        return REGULATORY_PROFILE.FAA;
    }

    if (EASA_LOCATION_PREFIXES.some((prefix) => location.startsWith(prefix))) {
        return REGULATORY_PROFILE.EASA;
    }

    return REGULATORY_PROFILE.ICAO;
}

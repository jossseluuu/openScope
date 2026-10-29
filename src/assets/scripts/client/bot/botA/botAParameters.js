/**
 * Parameters of Bot A, with the range explored when tuning them (Phase 4).
 *
 * Distances in nautical miles, speeds in knots, times in seconds, altitudes in feet.
 */
export const BOT_A_PARAMETER_SPACE = {
    // --- decisions
    decisionIntervalSeconds: {
        value: 5, min: 5, max: 5, description: 'time between decisions'
    },

    // --- arrival sequencing (AMAN)
    freezeSeconds: {
        value: 240, min: 60, max: 600, description: 'arrivals closer than this keep their place in the sequence'
    },
    maxPositionShift: {
        value: 2, min: 0, max: 3, integer: true, description: 'how many places an arrival may move from first-come first-served'
    },
    sequenceStabilitySeconds: {
        value: 20, min: 0, max: 120, description: 'cost of changing the previous sequence, per changed position'
    },
    finalSpacingBufferNm: {
        value: 0.7, min: 0.2, max: 2, description: 'margin over the wake or radar minimum on final'
    },
    landingOccupancyBufferSeconds: {
        value: 15, min: 0, max: 40, description: 'margin over the runway occupancy time of the previous landing'
    },
    mixedModeGapSeconds: {
        value: 150, min: 90, max: 300, description: 'gap between landings left for departures on mixed-mode runways'
    },

    // --- arrival speeds (indicated airspeed)
    cruiseSpeed: { value: 280, min: 250, max: 300 },
    arrivalSpeed: {
        value: 250, min: 220, max: 250, description: 'below FL100, more than 30 nm from the threshold'
    },
    intermediateSpeed: {
        value: 220, min: 200, max: 240, description: '15 to 30 nm from the threshold'
    },
    baseSpeed: {
        value: 180, min: 170, max: 200, description: '6 to 15 nm from the threshold'
    },
    finalSpeed: {
        value: 160, min: 150, max: 170, description: 'established on final'
    },
    minimumSpeedReduction: {
        value: 0.75, min: 0.6, max: 0.95, description: 'slowest planned speed as a fraction of the nominal one'
    },

    // --- delay absorption
    holdThresholdSeconds: {
        value: 180, min: 60, max: 600, description: 'delay left after speed control that triggers a hold'
    },
    holdExitMarginSeconds: { value: 30, min: 0, max: 120 },
    holdMinimumDistanceNm: {
        value: 25, min: 15, max: 60, description: 'hold only at fixes at least this far from the threshold'
    },
    maximumBaseTurnDistanceNm: {
        value: 28, min: 18, max: 40, description: 'longest downwind'
    },

    // --- approach vectoring
    interceptDistanceNm: {
        value: 10, min: 8, max: 14, description: 'nominal join on the localizer; further out when the stream is busy'
    },
    minimumJoinDistanceNm: {
        value: 8, min: 6, max: 10, description: 'closest join on the localizer, for shortened approaches'
    },
    shortJoinBufferNm: {
        value: 1, min: 0.5, max: 2, description: 'extra spacing margin required to join closer than the nominal join'
    },
    shortJoinPenaltySeconds: {
        value: 60, min: 0, max: 180, description: 'time a shortened approach must recover to be used'
    },
    interceptLateralNm: { value: 2.5, min: 1.5, max: 4 },
    interceptAngle: { value: 30, min: 20, max: 30 },
    downwindLateralNm: { value: 5, min: 3, max: 8 },
    ilsClearanceDistanceNm: {
        value: 22, min: 10, max: 35, description: 'route distance at which aircraft on a STAR are cleared for the ILS'
    },
    descentGradientFtPerNm: { value: 300, min: 250, max: 350 },

    // --- departures (DMAN)
    maxDepartureQueue: {
        value: 4, min: 1, max: 8, integer: true, description: 'aircraft taxiing or holding per runway'
    },
    sameRouteDepartureSeconds: { value: 120, min: 60, max: 180 },
    divergingDepartureSeconds: { value: 60, min: 45, max: 120 },
    departureRunwayOccupancySeconds: { value: 60, min: 40, max: 90 },
    arrivalDepartureMarginSeconds: { value: 20, min: 0, max: 60 },

    // --- conflict detection and resolution
    conflictHorizonSeconds: { value: 120, min: 60, max: 240 },
    conflictBufferNm: {
        value: 2, min: 0.5, max: 4, description: 'margin over the radar minimum'
    },
    resolutionHoldSeconds: {
        value: 60, min: 30, max: 180, description: 'how long a resolution is kept before resuming'
    },
    resolutionTurnDegrees: { value: 30, min: 20, max: 45 }
};

/**
 * Default parameters of Bot A
 *
 * @function getDefaultBotAParameters
 * @return {object} name -> value
 */
export function getDefaultBotAParameters() {
    return Object.keys(BOT_A_PARAMETER_SPACE).reduce((parameters, name) => {
        parameters[name] = BOT_A_PARAMETER_SPACE[name].value;
        return parameters;
    }, {});
}

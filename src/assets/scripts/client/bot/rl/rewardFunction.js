/**
 * Reward of Bot B, built from the Rulebook so that it follows the same
 * priorities as the rest of the system: one safety violation weighs more than
 * many separation losses, which weigh more than any efficiency gain.
 */

/**
 * Default weights; can be overridden from the training configuration
 *
 * @property DEFAULT_REWARD_WEIGHTS
 * @type {object}
 * @final
 */
export const DEFAULT_REWARD_WEIGHTS = {
    // by Rulebook tier (0 safety, 1 separation, 2 procedure)
    tier0: -10,
    tier1: -3,
    tier2: -0.5,
    goAround: -1,
    // scored game events
    arrival: 1,
    departure: 1,
    aircraftCollision: -10,
    airspaceBust: -5,
    restrictedArea: -5,
    notClearedOnRoute: -1,
    localizerAboveGlideslope: -0.3,
    // aircraft in emergency: landed before the deadline, deadline missed (instead of tier 1),
    // and per second each one is still airborne, so landing it sooner is always better
    emergencyLanding: 3,
    emergencyMissed: -6,
    emergencyTime: -0.002,
    // shaping, per second and aircraft under control, and per command given
    timePenalty: -0.0005,
    commandPenalty: -0.002
};

/**
 * Reward obtained between two decisions
 *
 * @function computeReward
 * @param transition {object}
 * @param transition.violations {array}     Rulebook violations since the last decision
 * @param transition.scoreEvents {array}    scored game events since the last decision
 * @param transition.controllableCount {number}
 * @param [transition.emergencyCount] {number}  airborne aircraft in emergency
 * @param transition.elapsedSeconds {number}
 * @param transition.commandCount {number}
 * @param [weights] {object}
 * @return {object} `{ reward, components }`
 */
export function computeReward(transition, weights = DEFAULT_REWARD_WEIGHTS) {
    const w = { ...DEFAULT_REWARD_WEIGHTS, ...weights };
    const components = {
        tier0: 0,
        tier1: 0,
        tier2: 0,
        goAround: 0,
        arrival: 0,
        departure: 0,
        aircraftCollision: 0,
        airspaceBust: 0,
        restrictedArea: 0,
        notClearedOnRoute: 0,
        localizerAboveGlideslope: 0,
        emergencyLanding: 0,
        emergencyMissed: 0,
        emergencyTime: 0,
        time: 0,
        commands: 0
    };
    let terrainCollisions = 0;

    transition.violations.forEach((violation) => {
        if (violation.rule === 'GO_AROUND') {
            components.goAround += w.goAround;
        } else if (violation.rule === 'EMERGENCY_DEADLINE') {
            components.emergencyMissed += w.emergencyMissed;
        } else if (violation.tier <= 2) {
            components[`tier${violation.tier}`] += w[`tier${violation.tier}`];
        }

        if (violation.rule === 'TERRAIN_COLLISION') {
            terrainCollisions += 1;
        }
    });

    transition.scoreEvents.forEach(({ event }) => {
        switch (event) {
            case 'ARRIVAL':
                components.arrival += w.arrival;
                break;
            case 'DEPARTURE':
                components.departure += w.departure;
                break;
            case 'COLLISION':
                // terrain collisions are already counted through the Rulebook
                if (terrainCollisions > 0) {
                    terrainCollisions -= 1;
                } else {
                    components.aircraftCollision += w.aircraftCollision;
                }

                break;
            case 'AIRSPACE_BUST':
                components.airspaceBust += w.airspaceBust;
                break;
            case 'RESTRICTED_AREA_ENTRY':
                components.restrictedArea += w.restrictedArea;
                break;
            case 'NOT_CLEARED_ON_ROUTE':
                components.notClearedOnRoute += w.notClearedOnRoute;
                break;
            case 'LOCALIZER_INTERCEPT_ABOVE_GLIDESLOPE':
                components.localizerAboveGlideslope += w.localizerAboveGlideslope;
                break;
            case 'EMERGENCY_LANDING':
                components.emergencyLanding += w.emergencyLanding;
                break;
            default:
                break;
        }
    });

    components.time = w.timePenalty * transition.controllableCount * transition.elapsedSeconds;
    components.emergencyTime = w.emergencyTime * (transition.emergencyCount || 0) * transition.elapsedSeconds;
    components.commands = w.commandPenalty * transition.commandCount;

    const reward = Object.keys(components).reduce((total, key) => total + components[key], 0);

    return { reward, components };
}

import { getRegulatoryProfileForAirport } from './regulatoryProfiles';

/**
 * Runway configuration selection by surface wind.
 *
 * An airport file may list its runway configurations in order of preference
 * (the first one is the noise preferential configuration):
 *
 * ```json
 * "runwayConfigurations": [
 *     { "name": "north", "arrivalRunway": "32L", "departureRunway": "36L", "runways": ["32L", "32R", "36L", "36R"] },
 *     { "name": "south", "arrivalRunway": "18R", "departureRunway": "14L", "runways": ["18L", "18R", "14L", "14R"] }
 * ]
 * ```
 *
 * The first configuration in which every runway is within the tailwind and
 * crosswind limits of the regulatory profile is used (ICAO Doc 4444 7.2.3).
 * When none is, the one with the least tailwind is used. Spawn patterns may be
 * restricted to a configuration with `"runwayConfiguration": "<name>"`.
 */

/**
 * Tailwind and crosswind components of the wind on a runway, in knots
 *
 * @function getWindComponentsForRunway
 * @param runwayModel {RunwayModel}
 * @param wind {object}  `{ angle, speed }`, angle in radians (direction the wind blows from)
 * @return {object} `{ head, cross }`, head is negative for a tailwind
 */
export function getWindComponentsForRunway(runwayModel, wind) {
    const angle = runwayModel.calculateCrosswindAngleForRunway(wind.angle);

    return {
        head: Math.cos(angle) * wind.speed,
        cross: Math.abs(Math.sin(angle) * wind.speed)
    };
}

/**
 * @function _isWithinWindLimits
 * @param runwayModels {array<RunwayModel>}
 * @param wind {object}
 * @param profile {object}
 * @return {boolean}
 * @private
 */
function _isWithinWindLimits(runwayModels, wind, profile) {
    return runwayModels.every((runwayModel) => {
        const { head, cross } = getWindComponentsForRunway(runwayModel, wind);

        return -head <= profile.maxTailwindKt && cross <= profile.maxCrosswindKt;
    });
}

/**
 * @function _worstHeadwind
 * @param runwayModels {array<RunwayModel>}
 * @param wind {object}
 * @return {number}
 * @private
 */
function _worstHeadwind(runwayModels, wind) {
    return Math.min(...runwayModels.map((runwayModel) => getWindComponentsForRunway(runwayModel, wind).head));
}

/**
 * Choose the runway configuration for the current wind
 *
 * @function selectRunwayConfiguration
 * @param airportModel {AirportModel}   with runways and wind already initialized
 * @param configurations {array}        `runwayConfigurations` from the airport file
 * @param [regulatoryProfileId] {string}
 * @return {object|null} the selected configuration, or null when the airport defines none
 */
export function selectRunwayConfiguration(airportModel, configurations, regulatoryProfileId) {
    if (!Array.isArray(configurations) || configurations.length === 0) {
        return null;
    }

    const profile = getRegulatoryProfileForAirport(airportModel.icao, regulatoryProfileId);
    const { wind } = airportModel;
    const candidates = configurations.map((configuration) => {
        const names = configuration.runways || [configuration.arrivalRunway, configuration.departureRunway];
        const runwayModels = names.map((name) => airportModel.getRunway(name)).filter(Boolean);

        return { configuration, runwayModels };
    });
    const preferred = candidates.find(({ runwayModels }) => _isWithinWindLimits(runwayModels, wind, profile));

    if (preferred) {
        return preferred.configuration;
    }

    return candidates.reduce((best, candidate) => {
        if (_worstHeadwind(candidate.runwayModels, wind) > _worstHeadwind(best.runwayModels, wind)) {
            return candidate;
        }

        return best;
    }).configuration;
}

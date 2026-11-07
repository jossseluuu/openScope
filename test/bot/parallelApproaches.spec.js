import ava from 'ava';

import { dependentApproachMinimumNm } from '../../src/assets/scripts/client/bot/botA/conflictResolution';
import { REGULATORY_PROFILE } from '../../src/assets/scripts/client/realism/regulatoryProfiles';
import { createObservation, createRunway } from './_observationFixture';

/**
 * Two parallel runways 27L/27R, their centerlines `spacingFt` apart (27R is the northern one)
 */
const observationWithParallels = (spacingFt) => {
    const observation = createObservation([], {
        separationMinima: {
            radarNm: 3,
            verticalFt: 1000,
            finalApproachNm: 2.5,
            arrivalDepartureNm: 2,
            independentParallelApproachFt: REGULATORY_PROFILE.EASA.independentParallelApproachFt
        }
    });

    observation.airport.runways = [
        [createRunway('27L', 270, 0, 0), createRunway('09R', 90, -2, 0)],
        [createRunway('27R', 270, 0, spacingFt / 6076), createRunway('09L', 90, -2, spacingFt / 6076)]
    ];

    return observation;
};

ava('independent parallel approaches need no minimum once both are established', (t) => {
    // LEMD 32L/32R and EDDM 26L/26R are well beyond 1035 m
    t.is(dependentApproachMinimumNm('27L', '27R', observationWithParallels(7000)), 0);
    t.is(dependentApproachMinimumNm('27L', '27R', observationWithParallels(13000)), 0);
});

ava('dependent parallel approaches keep the diagonal minimum of their spacing', (t) => {
    t.is(dependentApproachMinimumNm('27L', '27R', observationWithParallels(3000)), 1);
});

ava('the FAA needs wider runway spacing than ICAO for independent approaches', (t) => {
    t.is(REGULATORY_PROFILE.EASA.independentParallelApproachFt, 3400);
    t.is(REGULATORY_PROFILE.ICAO.independentParallelApproachFt, 3400);
    t.is(REGULATORY_PROFILE.FAA.independentParallelApproachFt, 4300);
});

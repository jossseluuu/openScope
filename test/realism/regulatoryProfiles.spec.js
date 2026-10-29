import ava from 'ava';

import {
    REGULATORY_PROFILE,
    WAKE_SCHEME,
    getRegulatoryProfileForAirport
} from '../../src/assets/scripts/client/realism/regulatoryProfiles';

ava('getRegulatoryProfileForAirport() returns the FAA profile for US airports', (t) => {
    t.is(getRegulatoryProfileForAirport('KJFK'), REGULATORY_PROFILE.FAA);
    t.is(getRegulatoryProfileForAirport('phnl'), REGULATORY_PROFILE.FAA);
    t.is(getRegulatoryProfileForAirport('PANC'), REGULATORY_PROFILE.FAA);
});

ava('getRegulatoryProfileForAirport() returns the EASA profile for European airports', (t) => {
    t.is(getRegulatoryProfileForAirport('LEMD'), REGULATORY_PROFILE.EASA);
    t.is(getRegulatoryProfileForAirport('LEMG'), REGULATORY_PROFILE.EASA);
    t.is(getRegulatoryProfileForAirport('eddf'), REGULATORY_PROFILE.EASA);
    t.is(getRegulatoryProfileForAirport('BIKF'), REGULATORY_PROFILE.EASA);
});

ava('getRegulatoryProfileForAirport() returns the ICAO profile elsewhere', (t) => {
    t.is(getRegulatoryProfileForAirport('RJTT'), REGULATORY_PROFILE.ICAO);
    t.is(getRegulatoryProfileForAirport('SBGR'), REGULATORY_PROFILE.ICAO);
    t.is(getRegulatoryProfileForAirport(undefined), REGULATORY_PROFILE.ICAO);
});

ava('getRegulatoryProfileForAirport() uses the override from the airport file', (t) => {
    t.is(getRegulatoryProfileForAirport('RJTT', 'faa'), REGULATORY_PROFILE.FAA);
    t.is(getRegulatoryProfileForAirport('KJFK', 'NOT_A_PROFILE'), REGULATORY_PROFILE.FAA);
});

ava('each profile uses its own wake turbulence scheme', (t) => {
    t.is(REGULATORY_PROFILE.EASA.wakeScheme, WAKE_SCHEME.RECAT_EU);
    t.is(REGULATORY_PROFILE.ICAO.wakeScheme, WAKE_SCHEME.ICAO);
    t.is(REGULATORY_PROFILE.FAA.wakeScheme, WAKE_SCHEME.FAA);
});

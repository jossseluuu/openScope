import ava from 'ava';

import { WAKE_SCHEME } from '../../src/assets/scripts/client/realism/regulatoryProfiles';
import {
    getArrivalWakeSeparationNm,
    getDepartureWakeSeparationSeconds,
    getRecatEuCategory,
    getWakeCategory
} from '../../src/assets/scripts/client/realism/wakeTurbulence';

const A388 = { weightClass: 'J', category: { recatEu: 'A', wakeFaa: 'SUPER' } };
const B77W = { weightClass: 'H', category: { recatEu: 'B', wakeFaa: 'HEAVY' } };
const B752 = { weightClass: 'M', category: { recatEu: 'C', wakeFaa: 'B757' } };
const A320 = { weightClass: 'M', category: { recatEu: 'D', wakeFaa: 'LARGE' } };
const E190 = { weightClass: 'M', category: { recatEu: 'E', wakeFaa: 'LARGE' } };
const C172 = { weightClass: 'L', category: { recatEu: 'F', wakeFaa: 'SMALL' } };
const UNCLASSIFIED_HEAVY = { weightClass: 'H', category: {} };

ava('getWakeCategory() returns the category of each scheme', (t) => {
    t.is(getWakeCategory(B77W, WAKE_SCHEME.RECAT_EU), 'B');
    t.is(getWakeCategory(B77W, WAKE_SCHEME.FAA), 'HEAVY');
    t.is(getWakeCategory(B77W, WAKE_SCHEME.ICAO), 'H');
});

ava('getWakeCategory() falls back to the ICAO category when the aircraft file has no RECAT-EU or FAA category', (t) => {
    t.is(getWakeCategory(UNCLASSIFIED_HEAVY, WAKE_SCHEME.RECAT_EU), 'B');
    t.is(getWakeCategory(UNCLASSIFIED_HEAVY, WAKE_SCHEME.FAA), 'HEAVY');
    t.is(getRecatEuCategory(UNCLASSIFIED_HEAVY), 'B');
});

ava('getArrivalWakeSeparationNm() returns the RECAT-EU distance minima', (t) => {
    t.is(getArrivalWakeSeparationNm(A388, A320, WAKE_SCHEME.RECAT_EU), 5);
    t.is(getArrivalWakeSeparationNm(A388, C172, WAKE_SCHEME.RECAT_EU), 8);
    t.is(getArrivalWakeSeparationNm(B77W, E190, WAKE_SCHEME.RECAT_EU), 5);
    t.is(getArrivalWakeSeparationNm(A320, C172, WAKE_SCHEME.RECAT_EU), 5);
});

ava('getArrivalWakeSeparationNm() returns 0 when only radar separation applies', (t) => {
    t.is(getArrivalWakeSeparationNm(A320, A320, WAKE_SCHEME.RECAT_EU), 0);
    t.is(getArrivalWakeSeparationNm(C172, A388, WAKE_SCHEME.RECAT_EU), 0);
    t.is(getArrivalWakeSeparationNm(A320, B77W, WAKE_SCHEME.FAA), 0);
});

ava('getArrivalWakeSeparationNm() returns the ICAO and FAA distance minima', (t) => {
    t.is(getArrivalWakeSeparationNm(B77W, A320, WAKE_SCHEME.ICAO), 5);
    t.is(getArrivalWakeSeparationNm(A388, A320, WAKE_SCHEME.ICAO), 7);
    t.is(getArrivalWakeSeparationNm(B77W, B752, WAKE_SCHEME.FAA), 5);
    t.is(getArrivalWakeSeparationNm(B752, C172, WAKE_SCHEME.FAA), 4);
});

ava('getDepartureWakeSeparationSeconds() returns the time minima of each scheme', (t) => {
    t.is(getDepartureWakeSeparationSeconds(B77W, A320, WAKE_SCHEME.RECAT_EU), 100);
    t.is(getDepartureWakeSeparationSeconds(A388, C172, WAKE_SCHEME.RECAT_EU), 180);
    t.is(getDepartureWakeSeparationSeconds(B77W, A320, WAKE_SCHEME.ICAO), 120);
    t.is(getDepartureWakeSeparationSeconds(A388, A320, WAKE_SCHEME.ICAO), 180);
    t.is(getDepartureWakeSeparationSeconds(A388, B77W, WAKE_SCHEME.FAA), 180);
    t.is(getDepartureWakeSeparationSeconds(A320, A320, WAKE_SCHEME.FAA), 0);
});

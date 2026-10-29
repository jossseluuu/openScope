import ava from 'ava';
import sinon from 'sinon';

import { DEFAULT_TAXI_TIME_SECONDS, calculateTaxiTimeSeconds } from '../../src/assets/scripts/client/realism/taxiTimes';

ava.serial('calculateTaxiTimeSeconds() uses the taxi time from the airport file', (t) => {
    const randomStub = sinon.stub(Math, 'random').returns(0);

    t.is(calculateTaxiTimeSeconds({ taxiTimes: { '36L': 600 } }, { name: '36L' }), 510);

    randomStub.restore();
});

ava.serial('calculateTaxiTimeSeconds() uses the default taxi time when the airport gives none', (t) => {
    const randomStub = sinon.stub(Math, 'random').returns(0.5);
    const expected = Math.round(DEFAULT_TAXI_TIME_SECONDS * 1.05);

    t.is(calculateTaxiTimeSeconds({ taxiTimes: {} }, { name: '25R' }), expected);
    t.is(calculateTaxiTimeSeconds(null, { name: '25R' }), expected);

    randomStub.restore();
});

import ava from 'ava';

import {
    FinalApproachFrame,
    bearing,
    distanceInsideAirspace,
    headingDifference
} from '../../src/assets/scripts/client/bot/botGeometry';
import { createRunway } from './_observationFixture';

const frame = new FinalApproachFrame(createRunway('27', 270, 0, 0));
const close = (a, b) => Math.abs(a - b) < 1e-6;

ava('headingDifference() returns the signed smallest difference', (t) => {
    t.is(headingDifference(350, 10), 20);
    t.is(headingDifference(10, 350), -20);
    t.is(headingDifference(90, 270), 180);
});

ava('bearing() is measured clockwise from north', (t) => {
    t.true(close(bearing({ x: 0, y: 0 }, { x: 1, y: 0 }), 90));
    t.true(close(bearing({ x: 0, y: 0 }, { x: 0, y: -1 }), 180));
});

ava('FinalApproachFrame measures distance on final and from the centerline', (t) => {
    // a runway 27 is approached from the east
    t.true(close(frame.along({ x: 10, y: 0 }), 10));
    t.true(close(Math.abs(frame.lateral({ x: 10, y: 2 })), 2));
    t.is(Math.sign(frame.lateral({ x: 10, y: 2 })), -Math.sign(frame.lateral({ x: 10, y: -2 })));
});

ava('FinalApproachFrame gives headings that close the centerline', (t) => {
    const north = { x: 12, y: 3 };
    const south = { x: 12, y: -3 };

    t.true(close(frame.interceptHeading(north, 30), 240));
    t.true(close(frame.interceptHeading(south, 30), 300));
    t.true(close(frame.baseHeading(north), 180));
    t.true(close(frame.downwindHeading, 90));
    t.is(frame.glidepathAltitude(10), 3180);
});

ava('distanceInsideAirspace() is positive inside and negative outside', (t) => {
    const airspace = [{ polygon: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] }];

    t.true(close(distanceInsideAirspace({ x: 0, y: 7 }, airspace), 3));
    t.true(close(distanceInsideAirspace({ x: 0, y: 12 }, airspace), -2));
    t.is(distanceInsideAirspace({ x: 0, y: 0 }, []), Infinity);
});

ava('distanceInsideAirspace() ignores the boundaries between sectors', (t) => {
    const airspace = [
        { polygon: [{ x: -10, y: -10 }, { x: 0, y: -10 }, { x: 0, y: 10 }, { x: -10, y: 10 }] },
        { polygon: [{ x: 0, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }
    ];

    t.true(close(distanceInsideAirspace({ x: 1, y: 0 }, airspace), 9));
    t.true(close(distanceInsideAirspace({ x: 0, y: 12 }, airspace), -2));
});

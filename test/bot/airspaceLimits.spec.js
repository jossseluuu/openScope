import ava from 'ava';

import BotA from '../../src/assets/scripts/client/bot/botA/BotA';
import SafetyShield from '../../src/assets/scripts/client/bot/safetyShield';
import { altitudeAction } from '../../src/assets/scripts/client/bot/actionSpace';
import { airspaceMaximumAltitude } from '../../src/assets/scripts/client/bot/botRules';
import { FinalApproachFrame } from '../../src/assets/scripts/client/bot/botGeometry';
import { createAircraft, createObservation, createRunway } from './_observationFixture';

ava('arrivals stay 500 ft below the lowest airspace ceiling here and ahead', (t) => {
    t.is(airspaceMaximumAltitude(createAircraft({ airspaceCeiling: 8500, airspaceCeilingAhead: 8500 })), 8000);
    t.is(airspaceMaximumAltitude(createAircraft({ airspaceCeiling: 24500, airspaceCeilingAhead: 10000 })), 9000);
    t.is(airspaceMaximumAltitude(createAircraft({ airspaceCeiling: null, airspaceCeilingAhead: null })), Infinity);
    // departures may leave the airspace by climbing
    t.is(airspaceMaximumAltitude(createAircraft({ category: 'departure', airspaceCeiling: 8500 })), Infinity);
});

ava('the shield forbids climbing an arrival above the airspace ceiling', (t) => {
    const aircraft = createAircraft({ altitude: 7000, airspaceCeiling: 8500, airspaceCeilingAhead: 8500 });
    const mask = new SafetyShield().getActionMask(aircraft, createObservation([aircraft]));

    t.true(mask[altitudeAction(8000)]);
    t.false(mask[altitudeAction(9000)]);
});

ava('the shield brings an arrival down when it flies toward a lower ceiling', (t) => {
    const aircraft = createAircraft({ altitude: 11000, airspaceCeiling: 15000, airspaceCeilingAhead: 10000 });
    const required = new SafetyShield().getRequiredActions(createObservation([aircraft]));

    t.is(required[aircraft.callsign], altitudeAction(9000));
});

ava('the downwind is only extended as far as the airspace leaves room for it', (t) => {
    const bot = new BotA();
    const observation = createObservation();
    const frame = new FinalApproachFrame(createRunway('27', 270, 0, 0));
    const context = { observation };

    // the fixture's airspace is a 120 nm square centered on the threshold: room for the longest downwind
    t.is(bot._downwindLimitNm(frame, 1, context), bot.parameters.maximumBaseTurnDistanceNm);

    // a narrow airspace, 12 nm out along the final and 8 nm to the north (the right of runway 27)
    observation.airport.icao = 'NARROW';
    observation.airport.airspace = [{
        floor: 0,
        ceiling: 8500,
        polygon: [{ x: -5, y: -3 }, { x: 12, y: -3 }, { x: 12, y: 8 }, { x: -5, y: 8 }]
    }];

    const right = bot._downwindLimitNm(frame, 1, context);
    const left = bot._downwindLimitNm(frame, -1, context);

    t.true(right > 0 && right < 12);
    t.is(left, 0);
});

import ava from 'ava';

import { RunwayIndex } from '../../src/assets/scripts/client/bot/botRules';
import {
    FEATURE_NAMES, FEATURE_VERSION, GLOBAL_FEATURE_COUNT, GLOBAL_FEATURE_NAMES,
    encodeAircraft, encodeWeather, nearestCell
} from '../../src/assets/scripts/client/bot/rl/featureEncoder';
import { createAircraft, createObservation } from './_observationFixture';

// Features added in version 8 (safety nets of #3, dynamic weather of #6), for the Bot B retrain.

const featureOf = (features, name) => features[FEATURE_NAMES.indexOf(name)];

function encode(aircraftOverrides = {}, weather = undefined) {
    const observation = createObservation([createAircraft(aircraftOverrides)]);

    if (weather !== undefined) {
        observation.airport.weather = weather;
    }

    return encodeAircraft(observation.aircraft[0], observation, new RunwayIndex(observation.airport));
}

ava('the encoding is version 8 with the global weather features', (t) => {
    t.is(FEATURE_VERSION, 8);
    t.is(GLOBAL_FEATURE_COUNT, GLOBAL_FEATURE_NAMES.length);
    t.true(GLOBAL_FEATURE_NAMES.includes('low_visibility'));
});

ava('an aircraft without safety net data encodes no alert', (t) => {
    const features = encode();

    ['stca_predicted', 'stca_alert', 'tcas_ta', 'tcas_ra', 'ra_sense', 'msaw', 'apw', 'cell_below_top']
        .forEach((name) => t.is(featureOf(features, name), 0, name));
    t.is(featureOf(features, 'cell_distance'), 1);
});

ava('STCA, TCAS RA with its sense, MSAW and APW are encoded', (t) => {
    const features = encode({
        safetyNet: {
            stca: 'ALERT', tcas: 'RA', raSense: -1, msaw: true, apw: 'LER145'
        }
    });

    t.is(featureOf(features, 'stca_predicted'), 0);
    t.is(featureOf(features, 'stca_alert'), 1);
    t.is(featureOf(features, 'tcas_ta'), 0);
    t.is(featureOf(features, 'tcas_ra'), 1);
    t.is(featureOf(features, 'ra_sense'), -1);
    t.is(featureOf(features, 'msaw'), 1);
    t.is(featureOf(features, 'apw'), 1);
});

ava('a TA does not carry an RA sense', (t) => {
    const features = encode({
        safetyNet: {
            stca: 'PREDICTED', tcas: 'TA', raSense: 1, msaw: false, apw: null
        }
    });

    t.is(featureOf(features, 'stca_predicted'), 1);
    t.is(featureOf(features, 'tcas_ta'), 1);
    t.is(featureOf(features, 'ra_sense'), 0);
});

ava('the nearest thunderstorm cell gives the distance to its edge and whether the aircraft is below its top', (t) => {
    const aircraft = createAircraft({ x: 0, y: 0, altitude: 8000 });
    const observation = createObservation([aircraft]);

    observation.airport.weather = {
        mode: 'dynamic',
        cells: [
            {
                x: 20, y: 0, radius: 5, top: 30000, intensity: 1
            },
            {
                x: 0, y: 40, radius: 5, top: 30000, intensity: 1
            }
        ]
    };

    t.deepEqual(nearestCell(observation.aircraft[0], observation), { distance: 15, isBelowTop: true });

    const features = encodeAircraft(observation.aircraft[0], observation, new RunwayIndex(observation.airport));

    t.is(featureOf(features, 'cell_distance'), 0.5);
    t.is(featureOf(features, 'cell_below_top'), 1);
});

ava('global weather: clear static weather by default, low visibility and cells when dynamic', (t) => {
    t.deepEqual(encodeWeather(undefined), [0, 1, 1, 0, 0, 0]);
    const foggy = {
        mode: 'dynamic', visibility: 400, ceiling: 100, isLowVisibility: true, gust: 15, cells: [{}, {}]
    };
    const clear = {
        mode: 'static', visibility: 10000, ceiling: null, isLowVisibility: false, gust: null, cells: []
    };

    t.deepEqual(encodeWeather(foggy), [0.5, 0.04, 0.02, 1, 1, 0.4]);
    t.deepEqual(encodeWeather(clear), [0, 1, 1, 0, 0, 0]);
});

import ava from 'ava';

const { convertMaps, stringifyAirport } = require('../../tools/validate/convert-old-maps');

ava('converts maps{} into maps[] with a default map', (t) => {
    const airport = { maps: { base: [['N1', 'E1', 'N2', 'E2']] } };

    t.truthy(convertMaps(airport));
    t.deepEqual(airport.maps, [{ name: 'Base Map', lines: [['N1', 'E1', 'N2', 'E2']] }]);
    t.deepEqual(airport.defaultMaps, ['Base Map']);
});

ava('adds an empty Base Map to an airport without maps', (t) => {
    const airport = {};

    convertMaps(airport);

    t.deepEqual(airport.maps, [{ name: 'Base Map', lines: [] }]);
    t.deepEqual(airport.defaultMaps, ['Base Map']);
});

ava('leaves an airport in the current format untouched', (t) => {
    const airport = { maps: [{ name: 'Base Map', lines: [] }], defaultMaps: ['Base Map'] };

    t.is(convertMaps(airport), null);
});

ava('writes arrays of plain values on one line', (t) => {
    t.is(stringifyAirport({ a: [1, 'x'], b: [{ c: true }] }), '{\n    "a": [1, "x"],\n    "b": [\n        {\n            "c": true\n        }\n    ]\n}');
});

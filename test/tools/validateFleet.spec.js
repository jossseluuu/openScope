import ava from 'ava';

const { validateFleet, checkAircraft, checkAirline } = require('../../tools/validate/validate-fleet');

const A320 = require('../../assets/aircraft/a320.json');
const RYR = require('../../assets/airlines/ryr.json');

const a320 = () => JSON.parse(JSON.stringify(A320));
const ryr = () => JSON.parse(JSON.stringify(RYR));
const TYPES = new Set(['b738', 'b38m', 'a320']);

ava('every aircraft and airline file passes without errors', (t) => {
    const withErrors = validateFleet().filter((entry) => entry.problems.some((problem) => problem.severity === 'error'));

    t.deepEqual(withErrors, []);
});

ava('the aircraft schema rejects a property the engine does not read', (t) => {
    const aircraft = a320();

    aircraft.speed.vmo = 350;

    t.true(checkAircraft('a320.json', aircraft).some((problem) => problem.rule === 'SCHEMA' && problem.path === '/speed'));
});

ava('AC-001 flags a file name that does not match the type', (t) => {
    t.true(checkAircraft('a321.json', a320()).some((problem) => problem.rule === 'AC-001'));
});

ava('AC-002 flags a landing speed above the cruise speed', (t) => {
    const aircraft = a320();

    aircraft.speed.landing = 500;

    t.true(checkAircraft('a320.json', aircraft).some((problem) => problem.rule === 'AC-002'));
});

ava('the airline schema rejects callsign formats given as text instead of a list', (t) => {
    const airline = ryr();

    airline.callsign.callsignFormats = '###';

    t.true(checkAirline('ryr.json', airline, TYPES).some((problem) => problem.rule === 'SCHEMA'));
});

ava('the airline schema requires a default fleet', (t) => {
    const airline = ryr();

    delete airline.fleets.default;

    t.true(checkAirline('ryr.json', airline, TYPES).some((problem) => problem.rule === 'SCHEMA'));
});

ava('AL-002 flags a fleet with an aircraft type that does not exist', (t) => {
    const airline = ryr();

    airline.fleets.default.push(['B739X', 10]);

    t.true(checkAirline('ryr.json', airline, TYPES).some((problem) => problem.rule === 'AL-002' && problem.message.includes('B739X')));
});

ava('AL-003 warns about a callsign format that starts with 0', (t) => {
    const airline = ryr();

    airline.callsign.callsignFormats = ['0###'];

    t.true(checkAirline('ryr.json', airline, TYPES).some((problem) => problem.rule === 'AL-003'));
});

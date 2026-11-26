import ava from 'ava';
import fs from 'fs';
import path from 'path';
import { findAirportJsonProblems } from '../../src/assets/scripts/client/airport/airportJsonCheck';

const AIRPORTS = path.join(__dirname, '..', '..', 'assets', 'airports');
const loadList = JSON.parse(fs.readFileSync(path.join(AIRPORTS, 'airportLoadList.json'), 'utf8'));
const read = (icao) => JSON.parse(fs.readFileSync(path.join(AIRPORTS, `${icao}.json`), 'utf8'));

ava('every enabled airport passes the load-time check', (t) => {
    const failing = loadList
        .filter((entry) => !entry.disabled)
        .map((entry) => ({ icao: entry.icao, problems: findAirportJsonProblems(read(entry.icao)) }))
        .filter((entry) => entry.problems.length > 0);

    t.deepEqual(failing, []);
});

ava('the old map format is reported with the converter to use', (t) => {
    const airport = read('lemd');

    airport.maps = { base: [] };

    t.true(findAirportJsonProblems(airport).some((problem) => problem.includes('convert-old-maps')));
});

ava('a default map that does not exist is reported', (t) => {
    const airport = read('lemd');

    airport.defaultMaps = ['No existe'];

    t.true(findAirportJsonProblems(airport).some((problem) => problem.includes('No existe')));
});

ava('an airline without weight is reported', (t) => {
    const airport = read('lemd');

    airport.spawnPatterns[0].airlines = [['ibe']];

    t.true(findAirportJsonProblems(airport).some((problem) => problem.includes('spawn pattern 0')));
});

ava('a sector with the floor above the ceiling is reported', (t) => {
    const airport = read('lemd');

    airport.airspace[0].floor = airport.airspace[0].ceiling + 10;

    t.true(findAirportJsonProblems(airport).some((problem) => problem.includes('sector 0')));
});

ava('something that is not an object is reported', (t) => {
    t.deepEqual(findAirportJsonProblems(null), ['el archivo no es un objeto JSON']);
});

import ava from 'ava';
import path from 'path';
import Ajv2019 from 'ajv/dist/2019';
import { parseCoordinate } from '../../src/assets/scripts/client/utilities/unitConverters';

const {
    RULES, buildContext, fixNameOfLeg, isInsidePolygon, lowestRestrictionAltitudeFt, restrictedCeilingFt
} = require('../../tools/validate/rules');

const ROOT = path.join(__dirname, '..', '..');
const loadList = require('../../assets/airports/airportLoadList.json');
const schema = require('../../assets/airports/schema/airport.schema.json');

const validateSchema = new Ajv2019({
    allErrors: true, strict: true, strictTuples: false, allowUnionTypes: true
}).compile(schema);

const lemd = require('../../assets/airports/lemd.json');

const freshLemd = () => JSON.parse(JSON.stringify(lemd));

const problemsOf = (airport, fileIcao = 'lemd') => {
    const context = buildContext(ROOT, fileIcao, loadList);

    return RULES.flatMap((rule) => rule.check(airport, context).map((problem) => ({
        rule: rule.id, severity: rule.severity, ...problem
    })));
};

const errorsOf = (airport, fileIcao) => problemsOf(airport, fileIcao).filter((problem) => problem.severity === 'error');

ava('LEMD passes the schema and has no rule errors', (t) => {
    const airport = freshLemd();

    t.true(validateSchema(airport), JSON.stringify(validateSchema.errors));
    t.deepEqual(errorsOf(airport), []);
});

ava('the schema rejects a property the engine does not read, with its path', (t) => {
    const airport = freshLemd();

    airport.runways[0].lenght = 4000;

    t.false(validateSchema(airport));
    t.true(validateSchema.errors.some((error) => error.instancePath === '/runways/0' &&
        error.params.additionalProperty === 'lenght'));
});

ava('the schema rejects a spawn pattern airline without weight (it would never spawn)', (t) => {
    const airport = freshLemd();

    airport.spawnPatterns[0].airlines[0] = [airport.spawnPatterns[0].airlines[0][0]];

    t.false(validateSchema(airport));
});

ava('the schema rejects a map line with two coordinates instead of four', (t) => {
    const airport = freshLemd();

    airport.maps[0].lines[0] = airport.maps[0].lines[0].slice(0, 2);

    t.false(validateSchema(airport));
});

ava('AP-001 flags a file whose ICAO does not match', (t) => {
    t.true(errorsOf(freshLemd(), 'lemg').some((problem) => problem.rule === 'AP-001'));
});

ava('AP-002 flags runway names that are not reciprocal', (t) => {
    const airport = freshLemd();

    airport.runways[0].name = [airport.runways[0].name[0], '01'];

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-002' && problem.path === '/runways/0/name'));
});

ava('AP-003 flags a procedure that uses an undefined fix', (t) => {
    const airport = freshLemd();
    const [name, sid] = Object.entries(airport.sids)[0];

    sid.body = ['NOEXISTE'];

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-003' &&
        problem.message.includes('NOEXISTE') && problem.path === `/sids/${name}/body`));
});

ava('AP-004 flags a default runway that does not exist', (t) => {
    const airport = freshLemd();

    airport.arrivalRunway = '09';

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-004' && problem.path === '/arrivalRunway'));
});

ava('AP-005 flags an unknown name in a spawn route', (t) => {
    const airport = freshLemd();

    airport.spawnPatterns[0].route = `${airport.spawnPatterns[0].route}..XXXXX`;

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-005' && problem.message.includes('XXXXX')));
});

ava('AP-006 flags a fleet whose capitalisation does not match', (t) => {
    const airport = freshLemd();
    const pattern = airport.spawnPatterns.find((candidate) => candidate.airlines.some(([reference]) => reference.includes('/')));
    const index = airport.spawnPatterns.indexOf(pattern);
    const [airlineId, fleet] = pattern.airlines.find(([reference]) => reference.includes('/'))[0].split('/');

    pattern.airlines[0] = [`${airlineId}/${fleet.toUpperCase()}x`, 1];

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-006' && problem.path === `/spawnPatterns/${index}/airlines`));
});

ava('AP-006 flags an airline that does not exist', (t) => {
    const airport = freshLemd();

    airport.spawnPatterns[0].airlines[0] = ['zzzz', 1];

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-006' && problem.message.includes('zzzz')));
});

ava('AP-007 flags a floor above the ceiling as an error and a zero-thickness sector as a warning', (t) => {
    const airport = freshLemd();

    airport.airspace[0].floor = airport.airspace[0].ceiling + 10;
    airport.airspace[1].floor = airport.airspace[1].ceiling;

    const problems = problemsOf(airport).filter((problem) => problem.rule === 'AP-007');

    t.true(problems.some((problem) => problem.path === '/airspace/0' && problem.severity === 'error'));
    t.true(problems.some((problem) => problem.path === '/airspace/1' && problem.severity === 'warning'));
});

ava('AP-008 flags a self-intersecting polygon', (t) => {
    const airport = freshLemd();

    airport.airspace[0].poly = [[40, -4], [41, -3], [40, -3], [41, -4]];

    t.true(problemsOf(airport).some((problem) => problem.rule === 'AP-008' && problem.path === '/airspace/0/poly'));
});

ava('AP-009 flags a default map that does not exist', (t) => {
    const airport = freshLemd();

    airport.defaultMaps = ['No existe'];

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-009'));
});

ava('AP-011 warns when a Spanish airport spawns all arrivals at once', (t) => {
    const airport = freshLemd();

    delete airport.arrivalSpawn;

    t.true(problemsOf(airport).some((problem) => problem.rule === 'AP-011'));
});

ava('fixNameOfLeg strips fly-over and hold symbols and ignores headings', (t) => {
    t.is(fixNameOfLeg('^SUNED'), 'SUNED');
    t.is(fixNameOfLeg('@SUNED'), 'SUNED');
    t.is(fixNameOfLeg(['SUNED', 'A70+']), 'SUNED');
    t.is(fixNameOfLeg('#270'), null);
});

ava('LEMD has no warnings from the geometry rules AP-015 to AP-017', (t) => {
    const warnings = problemsOf(freshLemd()).filter((problem) => ['AP-015', 'AP-016', 'AP-017'].includes(problem.rule));

    t.deepEqual(warnings, []);
});

/**
 * A square sector of +-0.2 degrees around a fix
 */
const sectorAround = (airport, fix, floor, ceiling) => {
    const lat = parseCoordinate(airport.fixes[fix][0]);
    const lon = parseCoordinate(airport.fixes[fix][1]);

    return {
        floor,
        ceiling,
        airspace_class: 'C',
        poly: [[lat - 0.2, lon - 0.2], [lat + 0.2, lon - 0.2], [lat + 0.2, lon + 0.2], [lat - 0.2, lon + 0.2]]
    };
};

ava('AP-015 flags an arrival that appears inside the airspace above every sector there', (t) => {
    const airport = freshLemd();
    const index = airport.spawnPatterns.findIndex((pattern) => pattern.category === 'arrival');
    const firstFix = airport.spawnPatterns[index].route.split('.')[0];

    airport.airspace = [sectorAround(airport, firstFix, 50, 100)];
    airport.spawnPatterns[index].altitude = 20000;

    t.true(problemsOf(airport).some((problem) => problem.rule === 'AP-015' &&
        problem.path === `/spawnPatterns/${index}/altitude`));

    airport.spawnPatterns[index].altitude = 8000;

    t.false(problemsOf(airport).some((problem) => problem.rule === 'AP-015' &&
        problem.path === `/spawnPatterns/${index}/altitude`));
});

ava('AP-016 flags a STAR restriction below the floor of the airspace at that fix', (t) => {
    const airport = freshLemd();
    const [key, star] = Object.entries(airport.stars).find(([, procedure]) => Array.isArray(procedure.body));
    const fix = 'TESTX';

    airport.fixes[fix] = airport.fixes[Object.keys(airport.fixes)[0]];
    star.body = [...star.body, [fix, 'A40+']];
    airport.airspace = [sectorAround(airport, fix, 60, 245)];

    t.true(problemsOf(airport).some((problem) => problem.rule === 'AP-016' && problem.path === `/stars/${key}` &&
        problem.message.includes(fix)));
});

ava('AP-017 flags a STAR leg through a restricted area, unless it is above it', (t) => {
    const airport = freshLemd();
    const [key, star] = Object.entries(airport.stars).find(([, procedure]) => Array.isArray(procedure.body) &&
        procedure.body.length >= 2);
    const [first, second] = star.body.slice(0, 2).map(fixNameOfLeg);
    const area = sectorAround(airport, first, 0, 0);

    airport.restricted = [{ name: 'TEST-R', height: '5000ft', poly: area.poly }];
    star.body[0] = [first, 'A40+'];
    star.body[1] = [second, 'A40+'];

    t.true(problemsOf(airport).some((problem) => problem.rule === 'AP-017' && problem.message.includes('TEST-R') &&
        problem.message.includes(key)));

    star.body[0] = [first, 'A80+'];
    star.body[1] = [second, 'A80+'];

    t.false(problemsOf(airport).some((problem) => problem.rule === 'AP-017' && problem.message.includes(key)));
});

ava('isInsidePolygon works on a simple square', (t) => {
    const square = [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 1, lon: 1 }, { lat: 0, lon: 1 }];

    t.true(isInsidePolygon({ lat: 0.5, lon: 0.5 }, square));
    t.false(isInsidePolygon({ lat: 1.5, lon: 0.5 }, square));
});

ava('lowestRestrictionAltitudeFt reads at-or-above, at, at-or-below and windows', (t) => {
    t.is(lowestRestrictionAltitudeFt(['FIX', 'A70+']), 7000);
    t.is(lowestRestrictionAltitudeFt(['FIX', 'A110+|A150-|S300-']), 11000);
    t.is(lowestRestrictionAltitudeFt(['FIX', 'A130-|S250-']), 13000);
    t.is(lowestRestrictionAltitudeFt(['FIX', 'S250-']), null);
    t.is(lowestRestrictionAltitudeFt('FIX'), null);
});

ava('restrictedCeilingFt reads feet, flight levels and Infinity', (t) => {
    t.is(restrictedCeilingFt('5000ft'), 5000);
    t.is(restrictedCeilingFt('FL180'), 18000);
    t.is(restrictedCeilingFt('Infinity'), Infinity);
});

ava('AP-018 flags a spawn route that leaves a SID by an exit it does not have', (t) => {
    const airport = freshLemd();
    const index = airport.spawnPatterns.findIndex((pattern) => pattern.category === 'departure');
    const tokens = airport.spawnPatterns[index].route.split('..')[0].split('.');

    tokens[2] = 'NOEXIT';
    airport.spawnPatterns[index].route = tokens.join('.');
    airport.fixes.NOEXIT = airport.fixes[Object.keys(airport.fixes)[0]];

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-018' && problem.message.includes('NOEXIT')));
});

ava('AP-018 flags a spawn route that enters a STAR by an entry it does not have', (t) => {
    const airport = freshLemd();
    const index = airport.spawnPatterns.findIndex((pattern) => pattern.category === 'arrival');
    const tokens = airport.spawnPatterns[index].route.split('.');

    tokens[0] = 'NOENTRY';
    airport.spawnPatterns[index].route = tokens.join('.');
    airport.fixes.NOENTRY = airport.fixes[Object.keys(airport.fixes)[0]];

    t.true(errorsOf(airport).some((problem) => problem.rule === 'AP-018' && problem.message.includes('NOENTRY')));
});

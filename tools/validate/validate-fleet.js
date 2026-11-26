/* eslint-disable no-console, import/no-extraneous-dependencies */ // development tool
/**
 * Aircraft and airline validator: JSON schema of each file in assets/aircraft and assets/airlines
 * (`tools/validate/schema/`) plus coherence rules:
 *
 *   AC-001 error   the file name matches `icao`
 *   AC-002 error   speeds in order: min <= landing <= cruise <= max
 *   AL-001 error   the file name matches `icao`
 *   AL-002 error   every aircraft type of every fleet exists in assets/aircraft
 *   AL-003 warning callsign formats do not start with a 0 (the engine discards them)
 *
 * Usage: node tools/validate/validate-fleet.js [--json] [--quiet]. Exit code 1 on errors.
 */
const fs = require('fs');
const path = require('path');
const Ajv2019 = require('ajv/dist/2019').default;

const ROOT = path.join(__dirname, '..', '..');
const AIRCRAFT_DIR = path.join(ROOT, 'assets', 'aircraft');
const AIRLINES_DIR = path.join(ROOT, 'assets', 'airlines');
// built by `gulp` from the individual files (tools/tasks/jsonAssembler.js), not a type of its own
const BUNDLES = new Set(['aircraft.json', 'airlines.json']);

const ajv = new Ajv2019({
    allErrors: true, strict: true, strictTuples: false, allowUnionTypes: true
});
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const validateAircraft = ajv.compile(readJson(path.join(__dirname, 'schema', 'aircraft.schema.json')));
const validateAirline = ajv.compile(readJson(path.join(__dirname, 'schema', 'airline.schema.json')));

function schemaProblems(errors) {
    return errors.map((error) => ({
        rule: 'SCHEMA',
        severity: 'error',
        path: error.instancePath,
        message: error.keyword === 'additionalProperties' ?
            `propiedad no admitida "${error.params.additionalProperty}"` :
            error.message
    }));
}

function listJson(dir) {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !BUNDLES.has(name)).sort();
}

function checkAircraft(fileName, aircraft) {
    if (!validateAircraft(aircraft)) {
        return schemaProblems(validateAircraft.errors);
    }

    const problems = [];
    const { speed } = aircraft;

    if (aircraft.icao.toLowerCase() !== fileName.replace(/\.json$/, '')) {
        problems.push({
            rule: 'AC-001', severity: 'error', path: '/icao', message: `icao "${aircraft.icao}" no coincide con el nombre del archivo`
        });
    }

    if (!(speed.min <= speed.landing && speed.landing <= speed.cruise && speed.cruise <= speed.max)) {
        problems.push({
            rule: 'AC-002',
            severity: 'error',
            path: '/speed',
            message: `velocidades desordenadas: min ${speed.min}, landing ${speed.landing}, cruise ${speed.cruise}, max ${speed.max}`
        });
    }

    return problems;
}

function checkAirline(fileName, airline, aircraftTypes) {
    if (!validateAirline(airline)) {
        return schemaProblems(validateAirline.errors);
    }

    const problems = [];

    if (airline.icao !== fileName.replace(/\.json$/, '')) {
        problems.push({
            rule: 'AL-001', severity: 'error', path: '/icao', message: `icao "${airline.icao}" no coincide con el nombre del archivo`
        });
    }

    Object.entries(airline.fleets).forEach(([fleet, entries]) => {
        entries.forEach(([type], index) => {
            if (!aircraftTypes.has(type.toLowerCase())) {
                problems.push({
                    rule: 'AL-002',
                    severity: 'error',
                    path: `/fleets/${fleet}/${index}`,
                    message: `el tipo ${type} no existe en assets/aircraft`
                });
            }
        });
    });

    (airline.callsign.callsignFormats || []).forEach((format, index) => {
        if (format.startsWith('0')) {
            problems.push({
                rule: 'AL-003',
                severity: 'warning',
                path: `/callsign/callsignFormats/${index}`,
                message: `el formato "${format}" empieza por 0 y el motor lo descarta`
            });
        }
    });

    return problems;
}

/**
 * Validate every aircraft and airline file
 *
 * @function validateFleet
 * @return {array<object>} [{ file, problems }]
 */
function validateFleet() {
    const report = [];
    const aircraftFiles = listJson(AIRCRAFT_DIR);
    const aircraftTypes = new Set(aircraftFiles.map((name) => name.replace(/\.json$/, '')));

    aircraftFiles.forEach((name) => {
        report.push({ file: `aircraft/${name}`, problems: checkAircraft(name, readJson(path.join(AIRCRAFT_DIR, name))) });
    });
    listJson(AIRLINES_DIR).forEach((name) => {
        report.push({ file: `airlines/${name}`, problems: checkAirline(name, readJson(path.join(AIRLINES_DIR, name)), aircraftTypes) });
    });

    return report;
}

function main() {
    const args = process.argv.slice(2);
    const report = validateFleet();
    const withProblems = report.filter((entry) => entry.problems.some((problem) => !args.includes('--quiet') || problem.severity === 'error'));
    const errorFiles = report.filter((entry) => entry.problems.some((problem) => problem.severity === 'error'));

    if (args.includes('--json')) {
        console.log(JSON.stringify({ files: withProblems, filesWithErrors: errorFiles.map((entry) => entry.file) }, null, 2));
    } else {
        withProblems.forEach((entry) => {
            console.log(entry.file);
            entry.problems.forEach((problem) => console.log(`      ${problem.rule} ${problem.message} ${problem.path}`));
        });
        console.log(`\n${report.length} archivos (aeronaves y aerolíneas), ${errorFiles.length} con errores`);
    }

    if (errorFiles.length > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = { validateFleet, checkAircraft, checkAirline };

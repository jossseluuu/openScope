/* eslint-disable no-console, global-require, import/no-extraneous-dependencies */ // development tool
/**
 * Airport validator: JSON schema (structure) + coherence rules (`tools/validate/rules.js`).
 *
 * Usage:
 *   node tools/validate/validate-airports.js [icao ...] [--all] [--json] [--quiet]
 *
 * Without ICAO codes it checks every airport enabled in airportLoadList.json; `--all` also checks
 * the disabled ones (many use an old format and are expected to fail). `--json` prints a machine
 * readable report, `--quiet` hides warnings. Exit code 1 when any checked airport has errors.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

require('@babel/register')({
    cwd: ROOT,
    only: [path.join(ROOT, 'src')]
});

const Ajv2019 = require('ajv/dist/2019').default;
const { RULES, buildContext } = require('./rules');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const isQuiet = args.includes('--quiet');
const includeDisabled = args.includes('--all');
const requested = args.filter((arg) => !arg.startsWith('--')).map((icao) => icao.toLowerCase());

const COLOR = process.stdout.isTTY && !asJson ? {
    red: (text) => `\u001b[31m${text}\u001b[39m`,
    yellow: (text) => `\u001b[33m${text}\u001b[39m`,
    green: (text) => `\u001b[32m${text}\u001b[39m`,
    dim: (text) => `\u001b[2m${text}\u001b[22m`
} : {
    red: (text) => text, yellow: (text) => text, green: (text) => text, dim: (text) => text
};

const airportsDir = path.join(ROOT, 'assets', 'airports');
const loadList = JSON.parse(fs.readFileSync(path.join(airportsDir, 'airportLoadList.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(airportsDir, 'schema', 'airport.schema.json'), 'utf8'));
const ajv = new Ajv2019({
    allErrors: true, strict: true, strictTuples: false, allowUnionTypes: true
});
const validateSchema = ajv.compile(schema);
const knownIssues = JSON.parse(fs.readFileSync(path.join(__dirname, 'known-issues.json'), 'utf8')).issues;

/**
 * Problems listed in `known-issues.json` are reported with severity `known` and do not fail
 *
 * @function markKnownIssues
 */
function markKnownIssues(fileIcao, problems) {
    const known = knownIssues[fileIcao] || [];

    return problems.map((problem) => {
        const match = known.find((issue) => issue.rule === problem.rule && problem.message.includes(issue.contains));

        return match ? { ...problem, severity: 'known', reason: match.reason } : problem;
    });
}

/**
 * Schema errors worth showing: for `oneOf` failures ajv reports every branch, which is noise, so
 * only the `oneOf` summary is kept for a path that has one
 *
 * @function readableSchemaErrors
 */
function readableSchemaErrors(errors) {
    const oneOfPaths = new Set(errors.filter((error) => error.keyword === 'oneOf').map((error) => error.instancePath));

    return errors
        .filter((error) => error.keyword === 'oneOf' || !oneOfPaths.has(error.instancePath))
        .map((error) => {
            let { message } = error;

            if (error.keyword === 'additionalProperties') {
                message = `propiedad no admitida "${error.params.additionalProperty}"`;
            } else if (error.keyword === 'required') {
                message = `falta la propiedad obligatoria "${error.params.missingProperty}"`;
            } else if (error.keyword === 'oneOf') {
                message = 'valor con un formato no admitido';
            }

            return {
                rule: 'SCHEMA', severity: 'error', path: error.instancePath, message
            };
        });
}

function validateAirport(fileIcao) {
    const file = path.join(airportsDir, `${fileIcao}.json`);
    let airport;

    try {
        airport = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return [{
            rule: 'JSON', severity: 'error', path: '', message: `no se puede leer: ${error.message}`
        }];
    }

    if (!validateSchema(airport)) {
        // the rules assume a valid structure
        return readableSchemaErrors(validateSchema.errors);
    }

    const context = buildContext(ROOT, fileIcao, loadList);
    const problems = [];

    RULES.forEach((rule) => {
        try {
            rule.check(airport, context).forEach((problem) => problems.push({ rule: rule.id, severity: rule.severity, ...problem }));
        } catch (error) {
            problems.push({
                rule: rule.id, severity: 'error', path: '', message: `la regla falló: ${error.message}`
            });
        }
    });

    return problems;
}

function main() {
    const targets = requested.length > 0 ?
        requested :
        loadList.filter((entry) => includeDisabled || !entry.disabled).map((entry) => entry.icao);
    const report = targets.map((icao) => ({ icao, problems: markKnownIssues(icao, validateAirport(icao)) }));
    const errorCount = (entry) => entry.problems.filter((problem) => problem.severity === 'error').length;
    const warningCount = (entry) => entry.problems.filter((problem) => problem.severity !== 'error').length;
    const withErrors = report.filter((entry) => errorCount(entry) > 0);

    if (asJson) {
        console.log(JSON.stringify({ airports: report, airportsWithErrors: withErrors.map((entry) => entry.icao) }, null, 2));
    } else {
        report.forEach((entry) => {
            const errors = errorCount(entry);
            const warnings = warningCount(entry);
            if (errors === 0 && (warnings === 0 || isQuiet)) {
                console.log(`${COLOR.green('ok   ')} ${entry.icao}`);

                return;
            }

            const status = errors > 0 ? COLOR.red('ERROR') : COLOR.yellow('aviso');

            console.log(`${status} ${entry.icao}  ${errors} errores, ${warnings} avisos`);
            entry.problems
                .filter((problem) => !isQuiet || problem.severity === 'error')
                .forEach((problem) => {
                    let label = COLOR.yellow(problem.rule);

                    if (problem.severity === 'error') {
                        label = COLOR.red(problem.rule);
                    } else if (problem.severity === 'known') {
                        label = COLOR.dim(`${problem.rule} (conocido)`);
                    }

                    console.log(`      ${label} ${problem.message} ${COLOR.dim(problem.path)}`);
                });
        });
        console.log(`\n${report.length} aeropuertos, ${withErrors.length} con errores, ` +
            `${report.filter((entry) => warningCount(entry) > 0).length} con avisos`);
    }

    if (withErrors.length > 0) {
        process.exitCode = 1;
    }
}

main();

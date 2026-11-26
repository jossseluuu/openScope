/**
 * Flies Bot A at every airport of the load list (or the ones given) and reports, for each one,
 * whether the headless simulator can run it and how the bot does. Airports that work are
 * written to `bots/configs/airports.json`, the list Bot B trains on when its configuration
 * says `"airports": "all"`.
 *
 * Every airport runs in its own process, several at a time.
 *
 * Usage:
 *   node tools/sim/check-airports.js [--minutes 20] [--seed 1] [--emergencies 0.05]
 *       [--jobs 7] [--airports lemd,eddm] [--include-disabled] [--write] [--strict]
 *
 * `--strict` exits with code 1 when any airport fails to run (used by CI).
 */
/* eslint-disable no-console */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT = path.join(ROOT, 'bots', 'configs', 'airports.json');

const argValue = (name, fallback) => {
    const index = process.argv.indexOf(name);

    return index === -1 ? fallback : process.argv[index + 1];
};

/**
 * Below this many movements per hour an airport adds little to training (almost no traffic)
 *
 * @property MINIMUM_MOVEMENTS_PER_HOUR
 * @type {number}
 * @final
 */
const MINIMUM_MOVEMENTS_PER_HOUR = 4;

const minutes = Number(argValue('--minutes', 20));
const seed = Number(argValue('--seed', 1));
const emergencies = argValue('--emergencies', '0.05');
const jobs = Number(argValue('--jobs', Math.max(1, os.cpus().length - 1)));
const includeDisabled = process.argv.includes('--include-disabled');
const shouldWrite = process.argv.includes('--write');
const isStrict = process.argv.includes('--strict');
const loadList = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'airports', 'airportLoadList.json'), 'utf8'));
const requested = argValue('--airports', null);
const airports = requested ?
    requested.split(',').map((icao) => icao.trim().toLowerCase()) :
    loadList.filter((entry) => includeDisabled || !entry.disabled).map((entry) => entry.icao);

function runAirport(icao) {
    return new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(process.execPath, [
            path.join(__dirname, 'run-bot.js'),
            '--bot', 'A',
            '--airport', icao,
            '--minutes', String(minutes),
            '--seed', String(seed),
            '--emergencies', emergencies
        ], { cwd: ROOT });
        let output = '';
        let errors = '';

        child.stdout.on('data', (data) => { output += data; });
        child.stderr.on('data', (data) => { errors += data; });
        child.on('close', (code) => {
            const start = output.indexOf('{');
            const end = output.indexOf('\n}\n');
            let summary = null;

            try {
                summary = JSON.parse(output.slice(start, end + 2));
            } catch (error) {
                summary = null;
            }

            const seconds = (Date.now() - started) / 1000;
            const lastError = errors.split('\n').filter((line) => /Error|error|at /.test(line)).slice(0, 4).join(' | ');

            resolve({
                icao, ok: code === 0 && summary !== null, seconds, summary, error: code === 0 ? null : lastError || `exit ${code}`
            });
        });
    });
}

async function main() {
    const queue = airports.slice();
    const results = [];
    const worker = async() => {
        while (queue.length > 0) {
            const icao = queue.shift();
            // one airport at a time per worker: the workers run in parallel
            const result = await runAirport(icao); // eslint-disable-line no-await-in-loop

            results.push(result);

            const status = result.ok ? 'ok ' : 'ERR';
            const detail = result.ok ?
                `score ${result.summary.score} landings ${result.summary.events.ARRIVAL} departures ` +
                `${result.summary.events.DEPARTURE} losses ${result.summary.events.SEPARATION_LOSS} ` +
                `wake ${result.summary.events.WAKE_SEPARATION_LOSS} busts ${result.summary.events.AIRSPACE_BUST} ` +
                `emergencies ${result.summary.emergencies.landedInTime}/${result.summary.emergencies.declared}` :
                result.error;

            console.log(`${status} ${icao} (${result.seconds.toFixed(0)} s) ${detail}`);
        }
    };

    await Promise.all(Array.from({ length: jobs }, worker));

    results.sort((a, b) => a.icao.localeCompare(b.icao));

    const usable = results.filter((result) => result.ok &&
        result.summary.metrics.movementsPerHour >= MINIMUM_MOVEMENTS_PER_HOUR);
    const failed = results.filter((result) => !result.ok);

    console.log(`\n${usable.length} usable, ${failed.length} failed, ` +
        `${results.length - usable.length - failed.length} with too little traffic`);

    if (shouldWrite) {
        fs.writeFileSync(OUTPUT, `${JSON.stringify({
            description: 'Airports where Bot A runs in the headless simulator (tools/sim/check-airports.js); ' +
                'Bot B trains on them when its configuration says "airports": "all"',
            minutes,
            seed,
            airports: usable.map((result) => result.icao),
            failed: failed.map((result) => ({ icao: result.icao, error: result.error }))
        }, null, 4)}\n`);
        console.log(`written ${path.relative(ROOT, OUTPUT)}`);
    }

    if (isStrict && failed.length > 0) {
        process.exitCode = 1;
    }
}

main();

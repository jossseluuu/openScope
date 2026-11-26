/**
 * Bot regression check: flies a bot through the evaluation protocol and compares the totals with a
 * saved baseline (`bots/baselines/bot<A|C>.json`).
 *
 * Protocol (the one used to accept or reject bot changes): seeds 4-9 x LEMD north, LEMD south
 * (wind 180/15), EDDM, LEMG and KLAX, 60 minutes, emergencies off. 30 episodes, judged by the
 * total score.
 *
 * The headless simulator is deterministic for a given seed, so on unchanged code the totals repeat
 * exactly; the tolerance only absorbs tiny floating point differences between machines.
 *
 * Usage:
 *   node tools/sim/regression.js [--bot A] [--jobs 7] [--write-baseline] [--quick]
 *       [--tolerance 0.02] [--summary-file summary.md] [--safety-nets on|off] [--weather static|dynamic]
 *
 * `--write-baseline` saves the result as the new baseline instead of comparing.
 * `--quick` runs seeds 4-5 only (10 episodes) for a fast local check; it has its own baseline.
 * `--summary-file` appends a Markdown table (for the GitHub job summary).
 * Exit code 1 when the bot is worse than the baseline.
 */
/* eslint-disable no-console */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const argValue = (name, fallback) => {
    const index = process.argv.indexOf(name);

    return index === -1 ? fallback : process.argv[index + 1];
};

const botName = argValue('--bot', 'A').toUpperCase();
const jobs = Number(argValue('--jobs', Math.max(1, os.cpus().length - 1)));
const tolerance = Number(argValue('--tolerance', 0.02));
const summaryFile = argValue('--summary-file', null);
const shouldWriteBaseline = process.argv.includes('--write-baseline');
const isQuick = process.argv.includes('--quick');
// passed through to run-bot (e.g. to measure a change with the safety nets off)
const safetyNets = argValue('--safety-nets', null);
const weather = argValue('--weather', null);

/**
 * Scenarios of the protocol
 *
 * @property SCENARIOS
 * @type {array<object>}
 * @final
 */
const SCENARIOS = [
    { name: 'lemd-n', airport: 'lemd', wind: null },
    { name: 'lemd-s', airport: 'lemd', wind: '180/15' },
    { name: 'eddm', airport: 'eddm', wind: null },
    { name: 'lemg', airport: 'lemg', wind: null },
    { name: 'klax', airport: 'klax', wind: null }
];

const SEEDS = isQuick ? [4, 5] : [4, 5, 6, 7, 8, 9];
const MINUTES = 60;

/**
 * Totals compared with the baseline. `worseIf` says which direction is a regression.
 *
 * @property METRICS
 * @type {array<object>}
 * @final
 */
const METRICS = [
    { key: 'score', label: 'Puntuación', worseIf: 'lower' },
    { key: 'landings', label: 'Aterrizajes', worseIf: 'lower' },
    { key: 'departures', label: 'Despegues', worseIf: 'lower' },
    { key: 'separationLosses', label: 'Pérdidas de separación', worseIf: 'higher' },
    { key: 'wakeLosses', label: 'Pérdidas de estela', worseIf: 'higher' },
    { key: 'airspaceBusts', label: 'Violaciones de espacio aéreo', worseIf: 'higher' },
    { key: 'tier0', label: 'Tier 0 (seguridad)', worseIf: 'higher' },
    { key: 'tier1', label: 'Tier 1 (separación)', worseIf: 'higher' },
    { key: 'tcasRa', label: 'RA de TCAS', worseIf: 'higher' }
];

const baselineFile = path.join(ROOT, 'bots', 'baselines', `bot${botName}${isQuick ? '-quick' : ''}.json`);

function episodes() {
    return SCENARIOS.flatMap((scenario) => SEEDS.map((seed) => ({ ...scenario, seed })));
}

function runEpisode(episode) {
    const args = [
        path.join(__dirname, 'run-bot.js'),
        '--bot', botName,
        '--airport', episode.airport,
        '--minutes', String(MINUTES),
        '--seed', String(episode.seed),
        '--emergencies', '0'
    ];

    if (episode.wind) {
        args.push('--wind', episode.wind);
    }

    if (safetyNets) {
        args.push('--safety-nets', safetyNets);
    }

    if (weather) {
        args.push('--weather', weather);
    }

    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, { cwd: ROOT });
        let output = '';
        let errors = '';

        child.stdout.on('data', (data) => { output += data; });
        child.stderr.on('data', (data) => { errors += data; });
        child.on('close', (code) => {
            let summary = null;

            try {
                summary = JSON.parse(output.slice(output.indexOf('{'), output.indexOf('\n}\n') + 2));
            } catch (error) {
                summary = null;
            }

            if (code !== 0 || !summary) {
                const lastLines = errors.split('\n').filter((line) => line && !line.includes('gtag')).slice(-5);

                resolve({ ...episode, error: `exit ${code}${lastLines.length ? `: ${lastLines.join(' | ')}` : ''}` });

                return;
            }

            resolve({
                ...episode,
                score: summary.score,
                landings: summary.events.ARRIVAL,
                departures: summary.events.DEPARTURE,
                separationLosses: summary.events.SEPARATION_LOSS,
                wakeLosses: summary.events.WAKE_SEPARATION_LOSS,
                airspaceBusts: summary.events.AIRSPACE_BUST,
                tier0: summary.violationsByTier['0'],
                tier1: summary.violationsByTier['1'],
                tcasRa: summary.events.TCAS_RA || 0
            });
        });
    });
}

async function runAll() {
    const queue = episodes();
    const results = [];
    const worker = async() => {
        while (queue.length > 0) {
            const episode = queue.shift();
            let result = await runEpisode(episode); // eslint-disable-line no-await-in-loop

            if (result.error) {
                // the simulator is deterministic, so a retry gives the same result; the failures seen so
                // far were processes that died under load (7 parallel episodes of 60 minutes)
                console.log(`retry ${result.name} seed ${result.seed}: ${result.error}`);
                result = await runEpisode(episode); // eslint-disable-line no-await-in-loop
            }

            results.push(result);
            console.log(result.error ?
                `ERR ${result.name} seed ${result.seed}: ${result.error}` :
                `ok  ${result.name} seed ${result.seed}: score ${result.score}, landings ${result.landings}, ` +
                `losses ${result.separationLosses}`);
        }
    };

    await Promise.all(Array.from({ length: jobs }, worker));

    return results.sort((a, b) => a.name.localeCompare(b.name) || a.seed - b.seed);
}

function totalsOf(results) {
    return METRICS.reduce((totals, metric) => {
        totals[metric.key] = results.reduce((sum, result) => sum + (result[metric.key] || 0), 0);

        return totals;
    }, {});
}

function currentCommit() {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    } catch (error) {
        return 'unknown';
    }
}

/**
 * Regressions of the totals against the baseline
 *
 * The score may drop by `tolerance` x |baseline score| (at least 1 point); safety events (tier 0)
 * may never increase.
 *
 * @function findRegressions
 * @param totals {object}
 * @param baseline {object}
 * @return {array<string>}
 */
function findRegressions(totals, baseline) {
    const regressions = [];
    const scoreMargin = Math.max(1, Math.abs(baseline.score) * tolerance);

    if (totals.score < baseline.score - scoreMargin) {
        regressions.push(`puntuación ${totals.score} < ${baseline.score} (margen ${scoreMargin.toFixed(0)})`);
    }

    if (totals.tier0 > baseline.tier0) {
        regressions.push(`tier 0 ${totals.tier0} > ${baseline.tier0}`);
    }

    return regressions;
}

function markdownTable(totals, baseline) {
    const lines = [
        `### Regresión del Bot ${botName}${isQuick ? ' (rápida)' : ''}`,
        '',
        '| Métrica | Línea base | Ahora | Diferencia |',
        '|---|---:|---:|---:|'
    ];

    METRICS.forEach((metric) => {
        const before = baseline ? baseline[metric.key] : null;
        const now = totals[metric.key];
        const delta = before === null ? '' : now - before;
        const worse = before !== null && (metric.worseIf === 'lower' ? now < before : now > before);

        lines.push(`| ${metric.label} | ${before === null ? '—' : before} | ${now} | ` +
            `${delta === '' ? '' : `${delta > 0 ? '+' : ''}${delta}${worse ? ' ⚠️' : ''}`} |`);
    });

    return `${lines.join('\n')}\n`;
}

async function main() {
    const started = Date.now();
    const results = await runAll();
    const failed = results.filter((result) => result.error);

    if (failed.length > 0) {
        console.error(`\n${failed.length} episodes failed to run`);
        process.exitCode = 1;

        return;
    }

    const totals = totalsOf(results);

    console.log(`\n${results.length} episodes in ${((Date.now() - started) / 1000).toFixed(0)} s`);

    if (shouldWriteBaseline) {
        fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
        fs.writeFileSync(baselineFile, `${JSON.stringify({
            description: `Bot ${botName} on the evaluation protocol (tools/sim/regression.js)`,
            commit: currentCommit(),
            created: new Date().toISOString().slice(0, 10),
            protocol: {
                scenarios: SCENARIOS, seeds: SEEDS, minutes: MINUTES, emergencies: 0
            },
            totals,
            episodes: results
        }, null, 4)}\n`);
        console.log(`baseline written to ${path.relative(ROOT, baselineFile)}`);
        console.log(markdownTable(totals, null));

        return;
    }

    if (!fs.existsSync(baselineFile)) {
        console.error(`no baseline at ${path.relative(ROOT, baselineFile)}: run with --write-baseline first`);
        process.exitCode = 1;

        return;
    }

    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    const table = markdownTable(totals, baseline.totals);
    const regressions = findRegressions(totals, baseline.totals);

    console.log(table);

    if (summaryFile) {
        fs.appendFileSync(summaryFile, `${table}\n${regressions.length > 0 ?
            `**Regresión:** ${regressions.join('; ')}` : 'Sin regresión.'}\n\n`);
    }

    if (regressions.length > 0) {
        console.error(`REGRESSION against baseline ${baseline.commit}: ${regressions.join('; ')}`);
        process.exitCode = 1;
    } else {
        console.log(`no regression against baseline ${baseline.commit}`);
    }
}

main();

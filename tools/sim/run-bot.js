/**
 * Runs a bot on an airport and prints a report.
 *
 * Usage:
 *   node tools/sim/run-bot.js --bot A --airport lemd --minutes 60 --seed 1
 *       [--wind 180/15] [--traffic 1.5] [--params params.json] [--verbose]
 */
const fs = require('fs');
const { BOTS, runEpisode } = require('./botRunner');

const argValue = (name, fallback) => {
    const index = process.argv.indexOf(name);

    return index === -1 ? fallback : process.argv[index + 1];
};

const botName = argValue('--bot', 'A').toUpperCase();
const airport = argValue('--airport', 'lemd');
const minutes = Number(argValue('--minutes', 60));
const seed = Number(argValue('--seed', 1));
const windText = argValue('--wind', null);
const trafficScale = Number(argValue('--traffic', 1));
const parametersFile = argValue('--params', null);
const verbose = process.argv.includes('--verbose');

if (!BOTS[botName]) {
    console.error(`Unknown bot "${botName}". Bot B runs from Python: python -m openscope_bots.run --bot B`);
    process.exit(1);
}

const parameters = parametersFile ? JSON.parse(fs.readFileSync(parametersFile, 'utf8')).parameters || {} : {};
const wind = windText ? { angle: Number(windText.split('/')[0]), speed: Number(windText.split('/')[1]) } : null;
const bot = BOTS[botName](parameters);
const started = Date.now();

const { summary, violations } = runEpisode({
    bot,
    airport,
    seed,
    minutes,
    wind,
    trafficScale,
    onDecision: verbose ? (decisions, observation) => {
        decisions.forEach((decision) => {
            console.log(`${Math.round(observation.time)}s ${decision.callsign} ${decision.command}  (${decision.reason})`);
        });
    } : null
});

console.log(`Bot ${botName} at ${summary.airport}, seed ${seed}, ${minutes} min ` +
    `(${((Date.now() - started) / 1000).toFixed(1)} s of computing)`);
console.log(JSON.stringify(summary, null, 2));

if (violations.length > 0) {
    console.log('\nViolations:');
    violations.forEach((violation) => {
        console.log(`  ${Math.round(violation.time)}s [tier ${violation.tier}] ${violation.rule}: ` +
            `${violation.callsigns.join('/')} ${violation.details}`);
    });
}

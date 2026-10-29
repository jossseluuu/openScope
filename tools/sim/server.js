/**
 * JSON-lines bridge to the headless simulator, used by the Python bots.
 *
 * Each line on stdin is a request `{ "id": 1, "method": "step", "params": {...} }` and
 * each line on stdout is the response `{ "id": 1, "result": ... }` or
 * `{ "id": 1, "error": "message" }`. Anything else the engine prints goes to stderr,
 * so stdout only ever carries protocol messages.
 *
 * Methods:
 * - `reset({ airport, seed, wind })`               -> observation (wind: `{ angle, speed }`, optional)
 * - `step({ seconds, commands: [[callsign, text]] })` -> `{ observation, commandResults }`
 *   (commands are issued before the time advances)
 * - `command({ callsign, text })`                  -> `{ success, message }`
 * - `observe()`                                    -> observation
 * - `airports()`                                   -> list of airports that can be loaded
 * - `runBotEpisode({ bot, parameters, airport, seed, minutes, wind, trafficScale, trace })` -> episode summary
 * - `botParameterSpace()`                          -> Bot A parameters with their tuning ranges
 * - `rlSpec()`                                     -> sizes of the encoded observation and action names
 * - `rlReset({ airport, seed, wind, trafficScale, decisionSeconds, episodeSeconds, withExpert, rewardWeights })`
 * - `rlStep({ actions })`                          -> encoded observation, reward, done, info
 *   (`actions`: one action index per aircraft slot, or `'expert'` to let Bot A act)
 * - `close()`
 *
 * Usage: node tools/sim/server.js [--step-seconds 0.25] [--tower USER|SYSTEM]
 */
const readline = require('readline');

// keep stdout clean for the protocol before anything else can print
const protocolOut = process.stdout.write.bind(process.stdout);

console.log = (...args) => process.stderr.write(`${args.join(' ')}\n`);
console.info = console.log;
console.warn = console.log;

const { HeadlessSimulator, ASSETS_PATH } = require('./bootstrap');
const { BOTS, runEpisode } = require('./botRunner');
const RlEnvironment = require('../../src/assets/scripts/headless/RlEnvironment').default;
const { ACTIONS } = require('../../src/assets/scripts/client/bot/actionSpace');
const { BOT_A_PARAMETER_SPACE } = require('../../src/assets/scripts/client/bot/botA/botAParameters');

const argValue = (name, fallback) => {
    const index = process.argv.indexOf(name);

    return index === -1 ? fallback : process.argv[index + 1];
};

const simulator = new HeadlessSimulator({
    assetsPath: ASSETS_PATH,
    stepSeconds: Number(argValue('--step-seconds', 0.25)),
    towerController: argValue('--tower', 'USER')
});

const rlEnvironment = new RlEnvironment(simulator);

const methods = {
    reset: ({
        airport = 'lemd', seed = 0, wind = null, trafficScale = 1
    } = {}) => simulator.reset(airport, seed, {
        wind,
        trafficScale
    }),
    step: ({ seconds = simulator.stepSeconds, commands = [] } = {}) => {
        const commandResults = commands.map(([callsign, text]) => simulator.command(callsign, text));
        const observation = simulator.step(seconds);

        return { observation, commandResults };
    },
    command: ({ callsign, text }) => simulator.command(callsign, text),
    observe: () => simulator.observe(),
    airports: () => require('../../assets/airports/airportLoadList.json'), // eslint-disable-line global-require
    runBotEpisode: ({
        bot = 'A', parameters = {}, airport = 'lemd', seed = 0, minutes = 60, wind = null, trafficScale = 1, trace = false
    } = {}) => {
        const tracks = {};
        const { summary, violations } = runEpisode({
            bot: BOTS[bot.toUpperCase()](parameters),
            airport,
            seed,
            minutes,
            wind,
            trafficScale,
            simulator,
            onDecision: trace ? (decisions, observation) => {
                observation.aircraft.forEach((aircraft) => {
                    if (aircraft.isControllable && !aircraft.isOnGround) {
                        if (!tracks[aircraft.callsign]) {
                            tracks[aircraft.callsign] = { category: aircraft.category, points: [] };
                        }

                        tracks[aircraft.callsign].points.push([aircraft.x, aircraft.y, aircraft.altitude, observation.time]);
                    }
                });
            } : null
        });

        return trace ? {
            summary, violations, tracks, airport: simulator.observe().airport
        } : { summary, violations };
    },
    botParameterSpace: () => BOT_A_PARAMETER_SPACE,
    rlSpec: () => ({
        ...rlEnvironment.getSpec(),
        actionNames: ACTIONS.map((action) => (action.value === undefined ? action.type : `${action.type}_${action.value}`))
    }),
    rlReset: (options = {}) => rlEnvironment.reset(options),
    rlStep: ({ actions }) => rlEnvironment.step(actions),
    close: () => {
        setImmediate(() => process.exit(0));

        return true;
    }
};

const reply = (message) => protocolOut(`${JSON.stringify(message)}\n`);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) {
        return;
    }

    let request;

    try {
        request = JSON.parse(line);
    } catch (error) {
        reply({ id: null, error: `invalid JSON: ${error.message}` });

        return;
    }

    const { id = null, method, params } = request;

    if (!methods[method]) {
        reply({ id, error: `unknown method: ${method}` });

        return;
    }

    try {
        reply({ id, result: methods[method](params) });
    } catch (error) {
        reply({ id, error: error && error.stack ? error.stack : String(error) });
    }
});

reply({ id: null, result: 'ready' });

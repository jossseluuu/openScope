/* eslint-disable global-require */ // development tool, modules are loaded after the bootstrap
/**
 * Runs a bot against the headless simulator.
 */
const { HeadlessSimulator, ASSETS_PATH } = require('./bootstrap');

const BotA = require('../../src/assets/scripts/client/bot/botA/BotA').default;

/**
 * Bots that run inside Node, by name
 */
const BOTS = {
    A: (parameters) => new BotA(parameters)
};

/**
 * Totals of an episode, used for reports and for tuning
 *
 * @function summarize
 * @param observation {object}  last observation
 * @param violations {array}    every violation of the episode
 * @param commandCount {number}
 * @return {object}
 */
function summarize(observation, violations, commandCount) {
    const byRule = {};
    const byTier = {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0
    };

    violations.forEach((violation) => {
        byRule[violation.rule] = (byRule[violation.rule] || 0) + 1;
        byTier[violation.tier] += 1;
    });

    return {
        airport: observation.airport.icao,
        simulatedSeconds: observation.time,
        score: observation.score,
        events: observation.events,
        violationsByRule: byRule,
        violationsByTier: byTier,
        commands: commandCount,
        metrics: observation.realism.metrics
    };
}

/**
 * Run one episode
 *
 * @function runEpisode
 * @param options {object}
 * @param options.bot {object}            object with `decide(observation)` and `reset()`
 * @param options.airport {string}
 * @param options.seed {number}
 * @param options.minutes {number}
 * @param [options.wind] {object}
 * @param [options.trafficScale] {number}
 * @param [options.simulator] {HeadlessSimulator}
 * @param [options.onDecision] {function}  called with `(decisions, observation)`
 * @return {object} summary
 */
function runEpisode({
    bot, airport, seed, minutes, wind = null, trafficScale = 1, simulator = null, onDecision = null
}) {
    const sim = simulator || new HeadlessSimulator({ assetsPath: ASSETS_PATH });
    const interval = (bot.parameters && bot.parameters.decisionIntervalSeconds) || 5;
    const violations = [];
    let commandCount = 0;
    let observation = sim.reset(airport, seed, { wind, trafficScale });

    bot.reset();

    for (let elapsed = 0; elapsed < minutes * 60; elapsed += interval) {
        const decisions = bot.decide(observation);

        for (const decision of decisions) {
            if (decision.command) {
                sim.command(decision.callsign, decision.command);
                commandCount += 1;
            }
        }

        if (onDecision) {
            onDecision(decisions, observation);
        }

        observation = sim.step(interval);
        violations.push(...observation.violations);
    }

    return { summary: summarize(observation, violations, commandCount), violations, observation };
}

module.exports = {
    BOTS, runEpisode, summarize, HeadlessSimulator, ASSETS_PATH
};

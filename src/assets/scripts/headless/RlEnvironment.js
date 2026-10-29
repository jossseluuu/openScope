import BotA from '../client/bot/botA/BotA';
import SafetyShield from '../client/bot/safetyShield';
import { ACTION_COUNT, ACTION_INDEX, actionToCommand } from '../client/bot/actionSpace';
import { MAX_AIRCRAFT, encodeObservation, getEncodingSpec } from '../client/bot/rl/featureEncoder';
import { computeReward } from '../client/bot/rl/rewardFunction';

/**
 * Reinforcement learning environment over the headless simulator.
 *
 * Every decision, the agent chooses one action (from the shared action space)
 * for each aircraft slot of the encoded observation. Unsafe actions are replaced
 * by NOOP and the actions imposed by the safety shield take precedence, so the
 * agent can never break a rule the shield knows about.
 *
 * Bot A can run alongside as an expert: its decisions are returned as labels
 * (imitation learning) or executed instead of the agent's (data collection).
 *
 * @class RlEnvironment
 */
export default class RlEnvironment {
    /**
     * @constructor
     * @param simulator {HeadlessSimulator}
     */
    constructor(simulator) {
        this.simulator = simulator;
        this.shield = new SafetyShield();
        this.expert = null;
        this.options = {};
        this._observation = null;
        this._encoded = null;
        this._episodeReturn = 0;
    }

    /**
     * @for RlEnvironment
     * @method getSpec
     * @return {object}
     */
    getSpec() {
        return getEncodingSpec();
    }

    /**
     * Start an episode
     *
     * @for RlEnvironment
     * @method reset
     * @param options {object}
     * @param options.airport {string}
     * @param options.seed {number}
     * @param [options.wind] {object}
     * @param [options.trafficScale] {number}
     * @param [options.decisionSeconds] {number}   simulated time between decisions
     * @param [options.episodeSeconds] {number}
     * @param [options.withExpert] {boolean}       compute Bot A's labels
     * @param [options.expertParameters] {object}
     * @param [options.rewardWeights] {object}
     * @return {object} step result without reward
     */
    reset(options) {
        this.options = {
            decisionSeconds: 10,
            episodeSeconds: 3600,
            withExpert: false,
            expertParameters: {},
            rewardWeights: {},
            trafficScale: 1,
            wind: null,
            ...options
        };
        this._observation = this.simulator.reset(this.options.airport, this.options.seed, {
            wind: this.options.wind,
            trafficScale: this.options.trafficScale
        });
        this.expert = this.options.withExpert ? new BotA(this.options.expertParameters) : null;
        this._episodeReturn = 0;

        return this._buildResult({ reward: 0, components: {} }, false);
    }

    /**
     * Apply one action per slot and advance to the next decision
     *
     * @for RlEnvironment
     * @method step
     * @param actions {array<number>|string}  one action per slot, or `'expert'` to let Bot A act
     * @return {object} `{ tokens, tokenMask, actionMask, global, expertActions, reward, done, info }`
     */
    step(actions) {
        const observation = this._observation;
        const encoded = this._encoded;
        const executed = actions === 'expert' ? this._lastExpertActions || this._expertActions(observation, encoded) : actions;
        const required = this.shield.getRequiredActions(observation);
        let commandCount = 0;
        let interventions = 0;

        for (let slot = 0; slot < MAX_AIRCRAFT; slot++) {
            const callsign = encoded.callsigns[slot];

            if (!callsign) {
                continue;
            }

            const aircraft = observation.aircraft.find((candidate) => candidate.callsign === callsign);
            let action = executed[slot] || ACTION_INDEX.NOOP;

            if (required[callsign] !== undefined) {
                interventions += action === required[callsign] ? 0 : 1;
                action = required[callsign];
            } else if (!encoded.actionMask[slot * ACTION_COUNT + action]) {
                interventions += 1;
                action = ACTION_INDEX.NOOP;
            }

            const command = actionToCommand(action, aircraft, observation);

            if (command) {
                this.simulator.command(callsign, command);
                commandCount += 1;
            }
        }

        const previousTime = observation.time;
        const next = this.simulator.step(this.options.decisionSeconds);
        const rewardResult = computeReward({
            violations: next.violations,
            scoreEvents: next.scoreEvents,
            controllableCount: next.aircraft.filter((aircraft) => aircraft.isControllable).length,
            elapsedSeconds: next.time - previousTime,
            commandCount
        }, this.options.rewardWeights);

        this._observation = next;
        this._episodeReturn += rewardResult.reward;

        const done = next.time >= this.options.episodeSeconds;
        const result = this._buildResult(rewardResult, done);

        result.info.commands = commandCount;
        result.info.shieldInterventions = interventions;
        result.info.violations = next.violations.map((violation) => ({ rule: violation.rule, tier: violation.tier }));

        return result;
    }

    /**
     * @for RlEnvironment
     * @method getObservation
     * @return {object} the raw observation of the last decision
     */
    getObservation() {
        return this._observation;
    }

    _buildResult(rewardResult, done) {
        const observation = this._observation;

        this._encoded = encodeObservation(observation, this.shield);
        this._lastExpertActions = this.expert ? this._expertActions(observation, this._encoded) : null;

        return {
            ...this._encoded,
            expertActions: this._lastExpertActions,
            reward: rewardResult.reward,
            done,
            info: {
                time: observation.time,
                rewardComponents: rewardResult.components,
                episodeReturn: this._episodeReturn,
                score: observation.score,
                events: observation.events,
                metrics: observation.realism.metrics,
                violationCounts: observation.realism.violationCounts
            }
        };
    }

    _expertActions(observation, encoded) {
        const actions = new Array(MAX_AIRCRAFT).fill(ACTION_INDEX.NOOP);

        if (!this.expert) {
            this.expert = new BotA(this.options.expertParameters);
        }

        const decisions = this.expert.decide(observation);

        decisions.forEach((decision) => {
            const slot = encoded.callsigns.indexOf(decision.callsign);

            if (slot !== -1) {
                actions[slot] = decision.action;
            }
        });

        return actions;
    }
}

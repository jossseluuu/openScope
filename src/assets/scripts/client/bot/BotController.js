import BotA from './botA/BotA';
import BotC from './botC/BotC';
import BotApi from './BotApi';
import BotBRuntime from './rl/BotBRuntime';
import EventBus from '../lib/EventBus';
import TimeKeeper from '../engine/TimeKeeper';
import UiController from '../ui/UiController';
import { AUDIT_EVENT, EVENT } from '../constants/eventNames';

/**
 * Seconds of game time between two decisions of a bot
 *
 * @property DECISION_INTERVAL_SECONDS
 * @type {number}
 * @final
 */
const DECISION_INTERVAL_SECONDS = 5;

/**
 * Lets a bot control the traffic in the browser game.
 *
 * Commands typed in the command bar:
 * - `bot a`: Bot A (expert rules and metaheuristics) takes control
 * - `bot b`: Bot B (trained network, loaded from assets/bots/) takes control
 * - `bot c`: Bot C (specialist agents, audited by their supervisors) takes control
 * - `bot off`: the player has control again
 *
 * The bot's clearances appear in the log like any other transmission.
 *
 * @class BotController
 */
export default class BotController {
    /**
     * @constructor
     * @param aircraftController {AircraftController}
     */
    constructor(aircraftController) {
        this._botApi = new BotApi(aircraftController);
        this._bot = null;
        this._name = null;
        this._nextDecisionTime = 0;
        this._isDeciding = false;
        // broken rules since the last decision, for the supervisors of Bot C
        this._pendingViolations = [];
        this._onBotCommandHandler = this._onBotCommand.bind(this);

        EventBus.on(EVENT.BOT_COMMAND, this._onBotCommandHandler);
        EventBus.on(AUDIT_EVENT.RULE_VIOLATION, (violation) => this._pendingViolations.push(violation));
    }

    /**
     * @for BotController
     * @property activeBot
     * @type {string|null}
     */
    get activeBot() {
        return this._name;
    }

    /**
     * The audit log of the active bot, if it has one
     *
     * @for BotController
     * @property supervision
     * @type {SupervisionSystem|null}
     */
    get supervision() {
        return this._bot && this._bot.supervision ? this._bot.supervision : null;
    }

    /**
     * Part of the game loop
     *
     * @for BotController
     * @method update
     */
    update() {
        const time = TimeKeeper.accumulatedDeltaTime;

        if (!this._bot || this._isDeciding || time < this._nextDecisionTime) {
            return;
        }

        this._nextDecisionTime = time + DECISION_INTERVAL_SECONDS;

        const observation = { ...this._botApi.getObservation(), violations: this._pendingViolations };

        this._pendingViolations = [];

        const decisions = this._bot.decide(observation);
        const name = this._name;

        if (decisions && typeof decisions.then === 'function') {
            // Bot B's network runs asynchronously
            this._isDeciding = true;
            decisions
                .then((result) => {
                    EventBus.trigger(AUDIT_EVENT.BOT_STEP, { name, observation, decisions: result });
                    this._issue(result);
                })
                .catch((error) => this._fail(error))
                .finally(() => {
                    this._isDeciding = false;
                });

            return;
        }

        EventBus.trigger(AUDIT_EVENT.BOT_STEP, { name, observation, decisions });
        this._issue(decisions);
    }

    /**
     * @for BotController
     * @method activate
     * @param name {string} `a`, `b`, `c` or `off`
     */
    activate(name) {
        const botName = (name || '').toLowerCase();

        if (botName === 'off') {
            this._bot = null;
            this._name = null;
            UiController.ui_log('bot off: you have control');

            return;
        }

        if (botName === 'a') {
            this._bot = new BotA();
            this._name = 'A';
            this._nextDecisionTime = 0;
            UiController.ui_log('Bot A has control (type "bot off" to take it back)');

            return;
        }

        if (botName === 'c') {
            this._bot = new BotC();
            this._name = 'C';
            this._nextDecisionTime = 0;
            this._pendingViolations = [];
            UiController.ui_log('Bot C has control (type "bot off" to take it back)');

            return;
        }

        if (botName === 'b') {
            UiController.ui_log('loading Bot B...');
            BotBRuntime.load()
                .then((runtime) => {
                    this._bot = runtime;
                    this._name = 'B';
                    this._nextDecisionTime = 0;
                    UiController.ui_log('Bot B has control (type "bot off" to take it back)');
                })
                .catch((error) => this._fail(error));

            return;
        }

        UiController.ui_log('usage: bot a | bot b | bot c | bot off', true);
    }

    _onBotCommand(name) {
        this.activate(name);
    }

    _issue(decisions) {
        decisions.forEach((decision) => {
            const {
                callsign, command, reason, action
            } = decision;

            if (!command) {
                return;
            }

            const { success, message } = this._botApi.issueCommand(callsign, command);

            UiController.ui_log(`[bot ${this._name}] ${callsign} ${command} - ${message}`);
            EventBus.trigger(AUDIT_EVENT.COMMAND_ISSUED, {
                source: `bot ${this._name}`,
                callsign,
                command,
                reason: reason || '',
                action,
                accepted: Boolean(success),
                message
            });
        });
    }

    _fail(error) {
        UiController.ui_log(`bot error: ${error.message || error}`, true);
        this._bot = null;
        this._name = null;
    }
}

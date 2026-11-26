import BotApi from '../bot/BotApi';
import BotC from '../bot/botC/BotC';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import TimeKeeper from '../engine/TimeKeeper';
import UiController from '../ui/UiController';
import { AUDIT_EVENT, EVENT } from '../constants/eventNames';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import {
    COPILOT_LEVEL,
    SUGGESTIONS,
    explain,
    parseTarget,
    partitionDecisions
} from './copilotLogic';

const DECISION_INTERVAL_SECONDS = 5;

/**
 * Keys: accept the first suggestion, dismiss it
 *
 * @property COPILOT_KEYS
 * @type {object}
 * @final
 */
export const COPILOT_KEYS = {
    ACCEPT: 'F4',
    DISMISS: 'F6'
};

/**
 * The copilot: Bot C's planner working for the controller instead of replacing them.
 *
 * - **Alerts** (level 1): new STCA alerts, TCAS RAs, MSAW, APW, thunderstorms ahead and emergencies.
 * - **Suggestions** (level 2): Bot C's orders for the aircraft the controller keeps, explained (agent, urgency,
 *   reason); the controller types them.
 * - **Acceptable suggestions** (level 3): the same, accepted with F4 (F6 dismisses).
 * - **Delegation** (levels 4 and 5): `delegate IBE1234` or `delegate tower|departures|arrivals|final|approach|all`;
 *   the copilot gives the orders for what is delegated, with the authority of the Bot C agent that owns it.
 *   An order of the controller to a delegated aircraft takes it back.
 *
 * It stays quiet while a bot runs the airport.
 *
 * @class CopilotController
 */
export default class CopilotController {
    /**
     * @constructor
     * @param aircraftController {AircraftController}
     * @param botController {BotController}
     */
    constructor(aircraftController, botController) {
        this._botApi = new BotApi(aircraftController);
        this._botController = botController;
        this._planner = new BotC();
        this._nextDecisionTime = 0;
        this.delegation = { callsigns: new Set(), agents: new Set() };
        this.suggestions = [];
        this._announcedAlerts = new Set();
        this._levelOverride = null;

        EventBus.on(EVENT.COPILOT_COMMAND, ({ action, argument }) => this.command(action, argument));
        EventBus.on(AUDIT_EVENT.COMMAND_ISSUED, (event) => this._onCommandIssued(event));
        EventBus.on(EVENT.AIRPORT_CHANGE, () => this.reset());

        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', (event) => this._onKeyDown(event));
        }
    }

    /**
     * @for CopilotController
     * @property level
     * @type {string}
     */
    get level() {
        if (this._levelOverride) {
            return this._levelOverride;
        }

        const option = GameController.game && GameController.game.option ?
            GameController.game.option.getOptionByName(GAME_OPTION_NAMES.COPILOT) :
            null;

        return Object.values(COPILOT_LEVEL).includes(option) ? option : COPILOT_LEVEL.OFF;
    }

    get hasDelegation() {
        return this.delegation.callsigns.size > 0 || this.delegation.agents.size > 0;
    }

    /**
     * @for CopilotController
     * @method reset
     */
    reset() {
        this._planner = new BotC();
        this.delegation = { callsigns: new Set(), agents: new Set() };
        this.suggestions = [];
        this._announcedAlerts = new Set();
        this._nextDecisionTime = 0;
    }

    /**
     * `copilot <level>`, `delegate <target>`, `recover <target>`
     *
     * @for CopilotController
     * @method command
     * @param action {string} 'level' | 'delegate' | 'recover'
     * @param argument {string}
     */
    command(action, argument) {
        if (action === 'level') {
            if (!Object.values(COPILOT_LEVEL).includes(argument)) {
                UiController.ui_log(`copilot: unknown level "${argument}" (off, alerts, suggest, accept)`, true);

                return;
            }

            this._levelOverride = argument;
            this.suggestions = [];
            UiController.ui_log(`copilot: ${argument}`);

            return;
        }

        const target = parseTarget(argument);
        const isDelegate = action === 'delegate';

        if (target.kind === 'sector') {
            target.agents.forEach((agent) => (isDelegate ? this.delegation.agents.add(agent) : this.delegation.agents.delete(agent)));
        } else if (isDelegate) {
            this.delegation.callsigns.add(target.callsign);
        } else {
            this.delegation.callsigns.delete(target.callsign);
        }

        if (!isDelegate && String(argument).toLowerCase() === 'all') {
            this.delegation = { callsigns: new Set(), agents: new Set() };
        }

        UiController.ui_log(`copilot: ${isDelegate ? 'delegated' : 'recovered'} ${argument}`);
    }

    /**
     * Part of the game loop
     *
     * @for CopilotController
     * @method update
     */
    update() {
        const time = TimeKeeper.accumulatedDeltaTime;

        if (time < this._nextDecisionTime || (this._botController && this._botController.activeBot)) {
            return;
        }

        this._nextDecisionTime = time + DECISION_INTERVAL_SECONDS;

        if (this.level === COPILOT_LEVEL.OFF && !this.hasDelegation) {
            return;
        }

        const observation = this._botApi.getObservation();

        if (this.level !== COPILOT_LEVEL.OFF) {
            this._announceAlerts(observation);
        }

        if (this.level === COPILOT_LEVEL.ALERTS && !this.hasDelegation) {
            return;
        }

        const { execute, suggest } = partitionDecisions(this._planner.decide(observation) || [], this.delegation);

        execute.forEach((decision) => this._issue(decision));
        this._updateSuggestions(suggest, time);
    }

    /**
     * Accept the first suggestion (level 3)
     *
     * @for CopilotController
     * @method acceptFirst
     */
    acceptFirst() {
        const suggestion = this.suggestions.shift();

        if (suggestion) {
            this._issue(suggestion, 'accepted');
        }
    }

    // ------------------------------------------------------------------ private

    _updateSuggestions(suggest, time) {
        if (this.level !== COPILOT_LEVEL.SUGGEST && this.level !== COPILOT_LEVEL.ACCEPT) {
            this.suggestions = [];

            return;
        }

        const known = new Set(this.suggestions.map((item) => `${item.callsign}|${item.command}`));

        this.suggestions = [
            ...suggest.map((decision) => ({ ...decision, createdAt: time })),
            ...this.suggestions.filter((item) => time - item.createdAt < SUGGESTIONS.LIFETIME_SECONDS)
        ].filter((item, index, list) => list.findIndex((other) => other.callsign === item.callsign) === index)
            .slice(0, SUGGESTIONS.MAX);

        this.suggestions
            .filter((item) => !known.has(`${item.callsign}|${item.command}`))
            .forEach((item) => {
                const hint = this.level === COPILOT_LEVEL.ACCEPT ? ` (${COPILOT_KEYS.ACCEPT} to accept)` : '';

                UiController.ui_log(`copilot: ${explain(item)}${hint}`);
            });
    }

    _issue(decision, how = 'delegated') {
        const { success, message } = this._botApi.issueCommand(decision.callsign, decision.command);

        UiController.ui_log(`[copilot ${how}] ${decision.callsign} ${decision.command} - ${message}`);
        EventBus.trigger(AUDIT_EVENT.COMMAND_ISSUED, {
            source: 'copilot',
            callsign: decision.callsign,
            command: decision.command,
            reason: decision.reason || '',
            action: decision.action,
            accepted: Boolean(success),
            message
        });
    }

    /**
     * Safety alerts and emergencies, announced once each
     *
     * @for CopilotController
     * @method _announceAlerts
     * @private
     */
    _announceAlerts(observation) {
        const active = new Set();

        observation.aircraft.forEach((aircraft) => {
            const net = aircraft.safetyNet || {};
            const alerts = [];

            if (net.stca === 'ALERT') {
                alerts.push('STCA: conflict within 1 minute');
            }

            if (net.tcas === 'RA') {
                alerts.push('TCAS RA: do not give altitude instructions');
            }

            if (net.msaw) {
                alerts.push('MSAW: below the minimum altitude ahead');
            }

            if (net.apw) {
                alerts.push(`APW: about to enter ${net.apw}`);
            }

            if (aircraft.emergency) {
                alerts.push(`EMERGENCY: land within ${Math.round(aircraft.emergency.remainingSeconds / 60)} min`);
            }

            alerts.forEach((text) => {
                const key = `${aircraft.callsign}|${text.split(':')[0]}`;

                active.add(key);

                if (!this._announcedAlerts.has(key)) {
                    UiController.ui_log(`copilot: ${aircraft.callsign} ${text}`, true);
                }
            });
        });

        this._announcedAlerts = active;
    }

    _onCommandIssued(event) {
        // the controller takes a delegated aircraft back by giving it an order
        if (event.source === 'player' && this.delegation.callsigns.has(event.callsign)) {
            this.delegation.callsigns.delete(event.callsign);
            UiController.ui_log(`copilot: ${event.callsign} back under your control`);
        }

        if (event.source === 'player') {
            this.suggestions = this.suggestions.filter((item) => item.callsign !== event.callsign);
        }
    }

    _onKeyDown(event) {
        if (this.level !== COPILOT_LEVEL.ACCEPT) {
            return;
        }

        if (event.key === COPILOT_KEYS.ACCEPT) {
            event.preventDefault();
            this.acceptFirst();
        } else if (event.key === COPILOT_KEYS.DISMISS) {
            event.preventDefault();
            this.suggestions.shift();
        }
    }
}

import { AGENT, AGENT_LABEL } from '../bot/botC/agents';

/**
 * Copilot levels (docs/bots/automatizacion.md). Delegation (levels 4 and 5 of the scale) is given with the
 * `delegate` command and works with any of these levels.
 *
 * @property COPILOT_LEVEL
 * @type {object}
 * @final
 */
export const COPILOT_LEVEL = {
    OFF: 'off',
    // level 1: alerts only
    ALERTS: 'alerts',
    // level 2: explained suggestions, the controller types them
    SUGGEST: 'suggest',
    // level 3: suggestions accepted with a key
    ACCEPT: 'accept'
};

/**
 * Sectors or phases that can be delegated, and the Bot C agents that own them
 *
 * @property SECTORS
 * @type {object}
 * @final
 */
export const SECTORS = {
    tower: [AGENT.TOWER],
    torre: [AGENT.TOWER],
    departures: [AGENT.DEPARTURES],
    salidas: [AGENT.DEPARTURES],
    arrivals: [AGENT.ARRIVALS],
    llegadas: [AGENT.ARRIVALS],
    entradas: [AGENT.ARRIVALS],
    final: [AGENT.ILS],
    ils: [AGENT.ILS],
    approach: [AGENT.ARRIVALS, AGENT.ILS, AGENT.COORDINATOR, AGENT.SEPARATION],
    aproximacion: [AGENT.ARRIVALS, AGENT.ILS, AGENT.COORDINATOR, AGENT.SEPARATION],
    all: Object.values(AGENT),
    todo: Object.values(AGENT)
};

/**
 * Maximum suggestions kept, and how long one stays valid
 *
 * @property SUGGESTIONS
 * @type {object}
 * @final
 */
export const SUGGESTIONS = {
    MAX: 5,
    LIFETIME_SECONDS: 30
};

/**
 * Whether a decision belongs to what the controller delegated: the aircraft itself, or the sector of the agent
 * that owns it
 *
 * @function isDelegated
 * @param decision {object} `{ callsign, agent }`
 * @param delegation {object} `{ callsigns: Set, agents: Set }`
 * @return {boolean}
 */
export function isDelegated(decision, delegation) {
    return delegation.callsigns.has(decision.callsign) || delegation.agents.has(decision.agent);
}

/**
 * Urgency of a suggestion: safety first (shield, conflicts, terrain), then separation and sequencing, then the rest
 *
 * @function urgencyOf
 * @param decision {object}
 * @return {number} 0 most urgent
 */
export function urgencyOf(decision) {
    const reason = (decision.reason || '').toLowerCase();

    if (reason.startsWith('safety') || decision.agent === AGENT.SHIELD) {
        return 0;
    }

    if (/conflict|separation|traffic|resolution|terrain|restricted|weather/.test(reason) || decision.agent === AGENT.SEPARATION) {
        return 1;
    }

    if (/sequence|spacing|final|go around/.test(reason)) {
        return 2;
    }

    return 3;
}

/**
 * Splits Bot C's decisions into the ones the copilot executes (delegated) and the ones it suggests
 *
 * @function partitionDecisions
 * @param decisions {array<object>}
 * @param delegation {object}
 * @return {object} `{ execute, suggest }`, suggestions sorted by urgency
 */
export function partitionDecisions(decisions, delegation) {
    const execute = [];
    const suggest = [];

    decisions.filter((decision) => decision.command).forEach((decision) => {
        (isDelegated(decision, delegation) ? execute : suggest).push(decision);
    });

    suggest.sort((a, b) => urgencyOf(a) - urgencyOf(b));

    return { execute, suggest: suggest.slice(0, SUGGESTIONS.MAX) };
}

/**
 * Explanation of a suggestion in Spanish, with the responsible agent
 *
 * @function explain
 * @param decision {object} `{ callsign, command, reason, agent }`
 * @return {string}
 */
export function explain(decision) {
    const agent = AGENT_LABEL[decision.agent] || 'Copiloto';
    const urgency = ['URGENTE', 'separación', 'secuencia', 'eficiencia'][urgencyOf(decision)];

    return `[${agent} · ${urgency}] ${decision.callsign} ${decision.command} — ${decision.reason || 'sin motivo'}`;
}

/**
 * Parses the target of `delegate` / `recover`: a sector name or a callsign
 *
 * @function parseTarget
 * @param argument {string}
 * @return {object} `{ kind: 'sector', agents }` or `{ kind: 'callsign', callsign }`
 */
export function parseTarget(argument) {
    const key = String(argument || '').toLowerCase();

    if (SECTORS[key]) {
        return { kind: 'sector', agents: SECTORS[key] };
    }

    return { kind: 'callsign', callsign: key.toUpperCase() };
}

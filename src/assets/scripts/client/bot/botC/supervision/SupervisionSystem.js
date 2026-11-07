import { ACTIONS, ACTION_TYPE, getApplicableActions } from '../../actionSpace';
import { AGENT, ownerOf } from '../agents';
import { isSupervisedPair, predictPairLoss } from './independentPrediction';
import { VERDICT, auditInstruction } from './supervisors';

/**
 * Why an incident happened
 *
 * @property INCIDENT_CATEGORY
 * @type {object}
 * @final
 */
export const INCIDENT_CATEGORY = {
    NEGLIGENCE: 'NEGLIGENCIA',
    DECISION_ERROR: 'ERROR_DE_DECISION',
    INSUFFICIENT: 'ACTUACION_INSUFICIENTE',
    COORDINATION: 'FALLO_DE_COORDINACION',
    SUPERVISION: 'FALLO_DE_SUPERVISION',
    UNAVOIDABLE: 'INEVITABLE',
    OTHER: 'SIN_CAUSA_ATRIBUIDA'
};

/**
 * Risk alerts look this far ahead, in seconds
 *
 * @property RISK_HORIZON_SECONDS
 * @type {number}
 * @final
 */
const RISK_HORIZON_SECONDS = 90;

/**
 * An alert older than this that got no instruction, when one was possible, is negligence
 *
 * @property ALERT_REACTION_SECONDS
 * @type {number}
 * @final
 */
const ALERT_REACTION_SECONDS = 30;

/**
 * An incident is linked to the instructions of the aircraft involved given in this time before it
 *
 * @property INCIDENT_LOOKBACK_SECONDS
 * @type {number}
 * @final
 */
const INCIDENT_LOOKBACK_SECONDS = 180;

/**
 * An aircraft that changes of responsible agent this long before an incident points to the handoff
 *
 * @property HANDOFF_LOOKBACK_SECONDS
 * @type {number}
 * @final
 */
const HANDOFF_LOOKBACK_SECONDS = 60;

/**
 * Two opposite instructions of the same kind within this time are a reversal, and this many
 * reversals of an aircraft within the window a loop
 *
 * @property LOOP
 * @type {object}
 * @final
 */
const LOOP = {
    WINDOW_SECONDS: 120,
    REVERSALS: 2
};

/**
 * Most entries kept, for the longest games in the browser
 *
 * @property MAX_ENTRIES
 * @type {number}
 * @final
 */
const MAX_ENTRIES = 20000;

const pairKey = (first, second) => [first, second].sort().join('/');

/**
 * Independent audit of Bot C: one supervisor per agent (`auditInstruction`) and this global
 * supervisor for what crosses agents (risk alerts, loops, handoffs, cause of each incident).
 *
 * It only reads observations and writes its log: it has no way to give an instruction. Entries are
 * only added or completed with what happened afterwards, never removed.
 *
 * @class SupervisionSystem
 */
export default class SupervisionSystem {
    /**
     * @constructor
     */
    constructor() {
        this.reset();
    }

    /**
     * @for SupervisionSystem
     * @method reset
     */
    reset() {
        this.entries = [];
        this.incidents = [];
        this.handoffs = [];
        this.authorityBreaches = [];
        this.alerts = {};
        this.alertsRaised = 0;
        this._owners = {};
        this._history = {};
        this._judgedCancellations = 0;
        this._nextId = 1;
    }

    /**
     * Audit the instructions of this cycle and follow what happened since the last one
     *
     * @for SupervisionSystem
     * @method audit
     * @param decisions {array<object>}
     * @param observation {object}
     */
    audit(decisions, observation) {
        const byCallsign = {};

        observation.aircraft.forEach((aircraft) => {
            byCallsign[aircraft.callsign] = aircraft;
        });

        this._followHandoffs(observation);
        this._judgeCancellations(observation);
        this._updateAlerts(observation, byCallsign);
        this._recordViolations(observation, byCallsign);

        decisions.forEach((decision) => {
            if (decision.command && byCallsign[decision.callsign]) {
                this._auditDecision(decision, byCallsign[decision.callsign], observation);
            }
        });
    }

    /**
     * An agent tried to give an instruction outside its authority; it was not issued
     *
     * @for SupervisionSystem
     * @method recordAuthorityBreach
     * @param agent {string}
     * @param callsign {string}
     * @param action {number}
     * @param reason {string}
     * @param observation {object}
     */
    recordAuthorityBreach(agent, callsign, action, reason, observation) {
        this.authorityBreaches.push({
            time: observation.time, agent, callsign, action: ACTIONS[action].type, reason
        });
    }

    /**
     * Totals by agent and verdict, and incidents by category
     *
     * @for SupervisionSystem
     * @method getSummary
     * @return {object}
     */
    getSummary() {
        const byAgent = {};
        const incidents = {};

        this.entries.forEach(({ agent, verdict }) => {
            byAgent[agent] = byAgent[agent] || {
                [VERDICT.GOOD]: 0, [VERDICT.QUESTIONABLE]: 0, [VERDICT.BAD]: 0, [VERDICT.PENDING]: 0
            };
            byAgent[agent][verdict] += 1;
        });
        this.incidents.forEach(({ category }) => {
            incidents[category] = (incidents[category] || 0) + 1;
        });

        return {
            instructions: this.entries.length,
            byAgent,
            incidents,
            alertsRaised: this.alertsRaised,
            handoffs: this.handoffs.length,
            authorityBreaches: this.authorityBreaches.length
        };
    }

    /**
     * The log, as plain data
     *
     * @for SupervisionSystem
     * @method getSnapshot
     * @param [rows] {number}  most recent rows of each list
     * @return {object}
     */
    getSnapshot(rows = Infinity) {
        const last = (list) => (rows === Infinity ? list.slice() : list.slice(-rows));

        return {
            summary: this.getSummary(),
            entries: last(this.entries),
            incidents: last(this.incidents)
        };
    }

    /**
     * The log as JSON lines
     *
     * @for SupervisionSystem
     * @method toJsonLines
     * @return {string}
     */
    toJsonLines() {
        return [
            { type: 'supervision-summary', ...this.getSummary() },
            ...this.entries.map((entry) => ({ type: 'instruction', ...entry })),
            ...this.incidents.map((incident) => ({ type: 'incident', ...incident })),
            ...this.handoffs.map((handoff) => ({ type: 'handoff', ...handoff })),
            ...this.authorityBreaches.map((breach) => ({ type: 'authority-breach', ...breach }))
        ].map((line) => JSON.stringify(line)).join('\n');
    }

    _followHandoffs(observation) {
        const { time } = observation;

        observation.aircraft.forEach((aircraft) => {
            const owner = ownerOf(aircraft, observation);
            const previous = this._owners[aircraft.callsign];

            if (previous && previous !== owner) {
                this.handoffs.push({
                    time, callsign: aircraft.callsign, from: previous, to: owner
                });
            }

            this._owners[aircraft.callsign] = owner;
        });
    }

    _judgeCancellations(observation) {
        const cancellations = observation.realism.takeoffCancellations || [];

        cancellations.slice(this._judgedCancellations).forEach((cancellation) => {
            const entry = this.entries.slice().reverse().find(({ callsign, actionType }) => callsign === cancellation.callsign &&
                actionType === ACTION_TYPE.CANCEL_TAKEOFF);

            if (!entry) {
                return;
            }

            entry.verdict = cancellation.isJustified ? VERDICT.GOOD : VERDICT.BAD;
            entry.findings = [{
                severity: entry.verdict,
                text: `${cancellation.isJustified ? 'justificada' : 'injustificada, penalizada'}: ${cancellation.reason}; ` +
                    `pista ocupada ${cancellation.occupiedSeconds} s`,
                reference: 'ICAO Doc 4444 7.9'
            }];
        });
        this._judgedCancellations = cancellations.length;
    }

    /**
     * Raise an alert for each pair that the independent prediction sees losing separation soon
     */
    _updateAlerts(observation, byCallsign) {
        const {
            aircraft, airport, realism, time
        } = observation;
        const current = {};

        for (let i = 0; i < aircraft.length; i++) {
            for (let j = i + 1; j < aircraft.length; j++) {
                const first = aircraft[i];
                const second = aircraft[j];

                if (!isSupervisedPair(first, second, airport.elevation) || (!first.isControllable && !second.isControllable)) {
                    continue;
                }

                const loss = predictPairLoss(first, second, realism.separationMinima, RISK_HORIZON_SECONDS);

                if (loss) {
                    current[pairKey(first.callsign, second.callsign)] = loss;
                }
            }
        }

        Object.keys(current).forEach((key) => {
            if (!this.alerts[key]) {
                this.alertsRaised += 1;
                this.alerts[key] = {
                    since: time, seconds: current[key].seconds, canAct: key.split('/').some((callsign) => this._canAct(byCallsign[callsign], observation))
                };
            }

            this.alerts[key].lastSeen = time;
        });

        // an alert is remembered a while: the incident it warned about comes when it has ended
        Object.keys(this.alerts).forEach((key) => {
            if (time - this.alerts[key].lastSeen > INCIDENT_LOOKBACK_SECONDS) {
                delete this.alerts[key];
            }
        });
    }

    _canAct(aircraft, observation) {
        return Boolean(aircraft) && aircraft.isControllable &&
            getApplicableActions(aircraft, observation).filter(Boolean).length > 1;
    }

    _auditDecision(decision, aircraft, observation) {
        const { time } = observation;
        const { verdict, findings } = auditInstruction(decision, aircraft, observation);
        const action = ACTIONS[decision.action];
        const entry = {
            id: this._nextId,
            time,
            agent: decision.agent,
            supervisor: decision.agent === AGENT.SHIELD ? 'GLOBAL' : decision.agent,
            callsign: decision.callsign,
            command: decision.command,
            actionType: action.type,
            agentReason: decision.reason,
            verdict,
            findings,
            consequence: null
        };

        this._nextId += 1;
        this._checkLoop(entry, action);

        if (this.entries.length < MAX_ENTRIES) {
            this.entries.push(entry);
        }

        this._history[decision.callsign] = this._history[decision.callsign] || [];
        this._history[decision.callsign].push({ time, action, entry });
    }

    /**
     * Global supervisor: an instruction that undoes the last one, again and again, is a loop
     */
    _checkLoop(entry, action) {
        if (action.type !== ACTION_TYPE.ALTITUDE && action.type !== ACTION_TYPE.HOLD && action.type !== ACTION_TYPE.PROCEDURE) {
            return;
        }

        const recent = (this._history[entry.callsign] || []).filter(({ time, action: previous }) => entry.time - time <= LOOP.WINDOW_SECONDS &&
            (previous.type === ACTION_TYPE.ALTITUDE || previous.type === ACTION_TYPE.HOLD || previous.type === ACTION_TYPE.PROCEDURE));
        const sequence = [...recent.map((item) => item.action), action];
        let reversals = 0;

        for (let i = 2; i < sequence.length; i++) {
            const isSameInstruction = sequence[i].type === sequence[i - 2].type && sequence[i].value === sequence[i - 2].value;

            if (isSameInstruction && sequence[i].index !== sequence[i - 1].index) {
                reversals += 1;
            }
        }

        if (reversals >= LOOP.REVERSALS) {
            entry.verdict = VERDICT.BAD;
            entry.findings.push({
                severity: VERDICT.BAD,
                text: `órdenes en bucle: ${reversals} vueltas atrás en ${LOOP.WINDOW_SECONDS} s`,
                reference: null
            });
        } else if (reversals === 1 && entry.verdict === VERDICT.GOOD) {
            entry.verdict = VERDICT.QUESTIONABLE;
            entry.findings.push({ severity: VERDICT.QUESTIONABLE, text: 'deshace la orden anterior', reference: null });
        }
    }

    _recordViolations(observation, byCallsign) {
        (observation.violations || []).forEach((violation) => {
            const incident = this._classify(violation, observation, byCallsign);

            this.incidents.push(incident);
            incident.relatedInstructions.forEach((id) => {
                const entry = this.entries.find((candidate) => candidate.id === id);

                if (entry) {
                    entry.consequence = `${incident.rule}: ${incident.details}`;
                }
            });
        });
    }

    /**
     * Assign a cause to a broken rule, following `INCIDENT_CATEGORY`
     */
    _classify(violation, observation, byCallsign) {
        const {
            callsigns, rule, tier, time, details, reference
        } = violation;
        const recent = callsigns.reduce((list, callsign) => list.concat(
            (this._history[callsign] || []).filter((item) => time - item.time <= INCIDENT_LOOKBACK_SECONDS)
        ), []).sort((a, b) => b.time - a.time);
        const badOne = recent.find(({ entry }) => entry.verdict === VERDICT.BAD);
        const responsible = callsigns.map((callsign) => this._owners[callsign]).filter(Boolean);
        const alert = callsigns.length === 2 ? this.alerts[pairKey(callsigns[0], callsigns[1])] : null;
        const lastHandoff = this.handoffs.slice().reverse().find((handoff) => callsigns.indexOf(handoff.callsign) !== -1);
        const incident = {
            time,
            rule,
            tier,
            callsigns,
            details,
            reference,
            responsible: badOne ? badOne.entry.agent : responsible[0] || null,
            relatedInstructions: recent.slice(0, 5).map(({ entry }) => entry.id)
        };
        const conclude = (category, explanation) => ({ ...incident, category, explanation });

        if (badOne) {
            return conclude(INCIDENT_CATEGORY.DECISION_ERROR, `la orden "${badOne.entry.command}" ya se auditó como mala`);
        }

        if (callsigns.length === 2) {
            const hasAlert = Boolean(alert) && alert.since < time;
            const reacted = recent.some((item) => hasAlert && item.time >= alert.since);

            if (hasAlert && !reacted && alert.canAct && time - alert.since >= ALERT_REACTION_SECONDS) {
                return conclude(INCIDENT_CATEGORY.NEGLIGENCE, `alerta desde hace ${Math.round(time - alert.since)} s, sin ninguna orden`);
            }

            if (hasAlert && !reacted && !alert.canAct) {
                return conclude(INCIDENT_CATEGORY.UNAVOIDABLE, 'alerta sin ninguna acción posible');
            }

            if (hasAlert && reacted) {
                return conclude(INCIDENT_CATEGORY.INSUFFICIENT, 'hubo órdenes tras la alerta, pero no evitaron la pérdida');
            }

            if (lastHandoff && time - lastHandoff.time <= HANDOFF_LOOKBACK_SECONDS) {
                return conclude(INCIDENT_CATEGORY.COORDINATION, `traspaso ${lastHandoff.from} a ${lastHandoff.to} de ${lastHandoff.callsign} ` +
                    `hace ${Math.round(time - lastHandoff.time)} s`);
            }

            if (!alert && callsigns.every((callsign) => byCallsign[callsign])) {
                return conclude(INCIDENT_CATEGORY.SUPERVISION, 'el monitor de riesgo no avisó antes');
            }
        }

        return conclude(INCIDENT_CATEGORY.OTHER, 'sin alerta ni orden que lo explique');
    }
}

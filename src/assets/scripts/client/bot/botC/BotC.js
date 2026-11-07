import BotA from '../botA/BotA';
import SupervisionSystem from './supervision/SupervisionSystem';
import {
    ACTIONS, ACTION_INDEX, ACTION_TYPE, actionToCommand
} from '../actionSpace';
import { distance } from '../botGeometry';
import { findNextArrival } from '../botRules';
import { AGENT, hasAuthority, ownerOf } from './agents';

/**
 * Tower sends an arrival around when the runway will not be free this many seconds before it lands
 *
 * @property RUNWAY_FREE_MARGIN_SECONDS
 * @type {number}
 * @final
 */
const RUNWAY_FREE_MARGIN_SECONDS = 5;

/**
 * The go-around is decided within this time of landing: before that the runway may still be vacated
 *
 * @property GO_AROUND_DECISION_SECONDS
 * @type {number}
 * @final
 */
const GO_AROUND_DECISION_SECONDS = 50;

/**
 * Time a departure on its roll is expected to keep the runway occupied
 *
 * @property DEPARTURE_ROLL_SECONDS
 * @type {number}
 * @final
 */
const DEPARTURE_ROLL_SECONDS = 30;

/**
 * An aircraft lined up is sent off the runway when an arrival is this much closer than the
 * arrival-departure separation, with time to vacate before it lands
 *
 * @property LINED_UP_ARRIVAL_MARGIN_NM
 * @type {number}
 * @final
 */
const LINED_UP_ARRIVAL_MARGIN_NM = 0.9;

/**
 * Bot C: specialist agents with one responsible agent per aircraft (see `ownerOf`), supervised by
 * an independent `SupervisionSystem` that audits every instruction and never gives one.
 *
 * Every decision cycle, in order of priority:
 * 1. the actions imposed by the safety shield
 * 2. Tower: cancels takeoffs and sends arrivals around when the runway is not usable
 * 3. Separation: conflicts and restricted areas, for any aircraft in the air
 * 4. Tower: gate, taxi and takeoff clearances
 * 5. the responsible agent of each aircraft: Departures, Arrivals, ILS or Tower
 *
 * For now the agents use the planning of Bot A, so they can be replaced one by one: each decision
 * goes through `_issue`, which checks that the agent has authority over that kind of action.
 *
 * @class BotC
 * @extends BotA
 */
export default class BotC extends BotA {
    /**
     * @constructor
     * @param [parameters] {object}  overrides of `BOT_A_PARAMETER_SPACE`
     */
    constructor(parameters = {}) {
        super(parameters);

        /**
         * Auditor of every instruction
         *
         * @property supervision
         * @type {SupervisionSystem}
         */
        this.supervision = new SupervisionSystem();
    }

    /**
     * Forget everything about the current episode
     *
     * @for BotC
     * @method reset
     */
    reset() {
        super.reset();

        if (this.supervision) {
            this.supervision.reset();
        }
    }

    /**
     * Decide the actions for this cycle
     *
     * @for BotC
     * @method decide
     * @param observation {object}
     * @return {array<object>} `{ callsign, action, command, reason, agent }`
     */
    decide(observation) {
        const context = this._buildContext(observation);
        const decisions = {};
        const as = (agent) => (callsign, action, reason) => this._issue(agent, callsign, action, reason, context, decisions);
        const byOwner = (callsign, action, reason) => {
            const aircraft = context.byCallsign[callsign];

            return aircraft ? as(ownerOf(aircraft, observation))(callsign, action, reason) : null;
        };
        const byOwnerChecked = (callsign, action, reason) => {
            const checked = this._checkLevel(callsign, action, context);

            return byOwner(callsign, checked, checked === action ? reason : `${reason}, stopped short for traffic`);
        };

        this._coordinate = as(AGENT.COORDINATOR);
        this._forgetGoneAircraft(context);

        const required = this.shield.getRequiredActions(observation);

        Object.keys(required).forEach((callsign) => {
            const given = as(AGENT.SHIELD)(callsign, required[callsign], 'safety: spacing on final');

            if (given !== null && ACTIONS[given].type === ACTION_TYPE.HEADING) {
                this._breakOff(callsign, given, context);
            }
        });

        this._watchRunways(context, as(AGENT.TOWER));
        this._resolveConflicts(context, as(AGENT.SEPARATION));
        this._avoidRestrictedAreas(context, as(AGENT.SEPARATION));
        this._sequenceDepartures(context, as(AGENT.TOWER));
        this._controlDepartureClimbs(context, byOwnerChecked);
        this._controlArrivals(context, byOwnerChecked);

        this.lastPlan = { sequences: this._sequences, decisions: Object.values(decisions) };
        // a copy: what the supervisors see cannot change what was decided
        this.supervision.audit(this.lastPlan.decisions.map((decision) => ({ ...decision })), observation);

        return this.lastPlan.decisions;
    }

    /**
     * Runway changes belong to the coordinator, whoever flies the aircraft
     *
     * @for BotC
     * @method _balanceParallelRunways
     * @param byRunway {object}
     * @param context {object}
     * @private
     */
    _balanceParallelRunways(byRunway, context) {
        super._balanceParallelRunways(byRunway, context, this._coordinate);
    }

    /**
     * @for BotC
     * @method _issue
     * @param agent {string}      one of `AGENT`
     * @param callsign {string}
     * @param action {number}
     * @param reason {string}
     * @param context {object}
     * @param decisions {object}  by callsign, at most one per aircraft
     * @return {number|null} the action given, or null
     * @private
     */
    _issue(agent, callsign, action, reason, context, decisions) {
        const { observation } = context;
        const aircraft = context.byCallsign[callsign];

        if (decisions[callsign] || action === ACTION_INDEX.NOOP || !aircraft ||
            !this.shield.getActionMask(aircraft, observation)[action]) {
            return null;
        }

        if (!hasAuthority(agent, action)) {
            this.supervision.recordAuthorityBreach(agent, callsign, action, reason, observation);

            return null;
        }

        decisions[callsign] = {
            callsign, action, command: actionToCommand(action, aircraft, observation), reason, agent
        };
        this._remember(callsign, action, observation.time);

        return action;
    }

    /**
     * Tower protects the runway: a takeoff roll is stopped while it can still be, and an arrival
     * that would land on an occupied runway goes around before reaching the decision height
     *
     * @for BotC
     * @method _watchRunways
     * @param context {object}
     * @param add {function}
     * @private
     */
    _watchRunways(context, add) {
        const { observation, runwayIndex } = context;
        const occupancyOf = (physicalName) => observation.realism.runwayOccupancy
            .find((runway) => runway.runway === physicalName);

        observation.aircraft.forEach((aircraft) => {
            const isOnRunway = aircraft.flightPhase === 'TAKEOFF' || aircraft.flightPhase === 'LINE_UP';

            if (!isOnRunway || !aircraft.isOnGround || !aircraft.isControllable) {
                return;
            }

            const runwayName = aircraft.departureRunway || observation.airport.departureRunway;
            const physicalName = runwayIndex.physicalName[runwayName];
            const occupancy = occupancyOf(physicalName);
            const occupant = occupancy && occupancy.occupants.find(({ callsign }) => callsign !== aircraft.callsign);
            const arrival = findNextArrival(physicalName, observation, runwayIndex);

            if (occupant) {
                add(aircraft.callsign, ACTION_INDEX.CANCEL_TAKEOFF, `reject takeoff: ${occupant.callsign} on the runway`);
            } else if (arrival && arrival.distanceToThreshold < observation.realism.separationMinima.arrivalDepartureNm +
                (aircraft.flightPhase === 'LINE_UP' ? LINED_UP_ARRIVAL_MARGIN_NM : 0)) {
                add(aircraft.callsign, ACTION_INDEX.CANCEL_TAKEOFF, `reject takeoff: ${arrival.aircraft.callsign} landing`);
            }
        });

        Object.keys(runwayIndex.frames).forEach((runwayName) => {
            const physicalName = runwayIndex.physicalName[runwayName];
            const arrival = findNextArrival(physicalName, observation, runwayIndex);
            const occupancy = occupancyOf(physicalName);

            if (!arrival || !occupancy || arrival.aircraft.arrivalRunway !== runwayName) {
                return;
            }

            const seconds = distance(arrival.aircraft, runwayIndex.runways[runwayName].threshold) / arrival.groundSpeed * 3600;
            const isBlocked = occupancy.occupants.some(({ callsign, remainingSeconds }) => callsign !== arrival.aircraft.callsign &&
                (remainingSeconds === null ? DEPARTURE_ROLL_SECONDS : remainingSeconds) > seconds - RUNWAY_FREE_MARGIN_SECONDS);

            if (seconds < GO_AROUND_DECISION_SECONDS && isBlocked) {
                add(arrival.aircraft.callsign, ACTION_INDEX.GO_AROUND, 'go around: the runway will not be free');
            }
        });
    }
}

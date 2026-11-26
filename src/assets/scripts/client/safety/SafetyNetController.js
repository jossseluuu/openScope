import GameController from '../game/GameController';
import UiController from '../ui/UiController';
import { RULE } from '../realism/Rulebook';
import { abs } from '../math/core';
import { nm } from '../utilities/unitConverters';
import { AIRPORT_CONTROL_POSITION_NAME } from '../constants/airportConstants';
import { GAME_OPTION_NAMES } from '../constants/gameOptionConstants';
import {
    AREA_WARNINGS,
    RA_SENSE,
    STCA_LEVEL,
    TCAS,
    TCAS_STATE,
    coordinatedSenses,
    sensitivityLevel,
    stcaLevel,
    stcaTimeToLoss,
    tcasThreatLevel,
    timeBelowMinimumAltitude,
    timeToAreaEntry
} from './safetyNetLogic';

/**
 * Below this height radar separation (and so STCA) does not apply (SEP-003)
 *
 * @property STCA_MIN_HEIGHT_FT
 * @type {number}
 * @final
 */
const STCA_MIN_HEIGHT_FT = 1000;

/**
 * Mode C resolution: margin under the minima before an alert (SEP-002, TER-002)
 *
 * @property VERTICAL_TOLERANCE_FT
 * @type {number}
 * @final
 */
const VERTICAL_TOLERANCE_FT = 50;
const MSAW_TOLERANCE_FT = 100;

/**
 * Departures this close to the airport may climb out below the MVA (diverse vector area), as in the MVA rule
 *
 * @property DEPARTURE_CLIMB_OUT_RADIUS_NM
 * @type {number}
 * @final
 */
const DEPARTURE_CLIMB_OUT_RADIUS_NM = 10;

const KM_PER_NM = 1.852;

const pairKey = (first, second) => [first.id, second.id].sort().join('|');

/**
 * Whether the aircraft carries TCAS II: ACAS II is mandatory in Europe above 5700 kg or 19 seats, which
 * is approximated by every wake category except light (TCA-007)
 *
 * @function hasTcas
 * @param aircraftModel {AircraftModel}
 * @return {boolean}
 */
export function hasTcas(aircraftModel) {
    return Boolean(aircraftModel.model) && aircraftModel.model.weightClass !== 'L';
}

/**
 * Text shown in the data block for the most severe safety net alert of an aircraft, and its severity
 *
 * @function safetyNetTag
 * @param aircraftModel {AircraftModel}
 * @return {object|null} `{ text, severity: 'alert'|'caution' }`
 */
export function safetyNetTag(aircraftModel) {
    const { safetyNet } = aircraftModel;

    if (!safetyNet) {
        return null;
    }

    if (safetyNet.tcas && safetyNet.tcas.state === TCAS_STATE.RA) {
        return { text: 'RA', severity: 'alert' };
    }

    if (safetyNet.stca === STCA_LEVEL.ALERT) {
        return { text: 'STCA', severity: 'alert' };
    }

    if (safetyNet.msaw) {
        return { text: 'MSAW', severity: 'alert' };
    }

    if (safetyNet.apw) {
        return { text: 'APW', severity: 'alert' };
    }

    // heading into (or inside) a thunderstorm cell (WeatherController, MET-007)
    if (aircraftModel.weatherWarning) {
        return { text: 'CB', severity: 'alert' };
    }

    if (safetyNet.tcas && safetyNet.tcas.state === TCAS_STATE.TA) {
        return { text: 'TA', severity: 'caution' };
    }

    if (safetyNet.stca === STCA_LEVEL.PREDICTED) {
        return { text: 'STCA', severity: 'caution' };
    }

    return null;
}

/**
 * Safety nets: STCA for the controller, TCAS II on board, MSAW and APW.
 *
 * Owned by the `RealismController`, which calls `update()` every second of game time. The results are
 * kept on each aircraft (`aircraftModel.safetyNet`) for the scope, the bots and the audit:
 * `{ stca, stcaWith, tcas: { state, sense, intruder, issuedAt, effectiveAt }, msaw, apw }`.
 *
 * A TCAS resolution advisory takes over the vertical guidance of the aircraft (`AircraftModel`
 * `_applyResolutionAdvisory`) until clear of conflict; the pilot then returns to the last clearance.
 *
 * @class SafetyNetController
 */
export default class SafetyNetController {
    /**
     * @constructor
     * @param realismController {RealismController}
     */
    constructor(realismController) {
        this._realism = realismController;
        // headless runs set it with `configure()`; otherwise the game option decides
        this._enabledOverride = null;
        this.reset();
    }

    /**
     * Whether the safety nets run: the headless override, or the game option (on by default)
     *
     * @for SafetyNetController
     * @property isEnabled
     * @type {boolean}
     */
    get isEnabled() {
        if (this._enabledOverride !== null) {
            return this._enabledOverride;
        }

        const option = GameController.game && GameController.game.option ?
            GameController.game.option.getOptionByName(GAME_OPTION_NAMES.SAFETY_NETS) :
            null;

        return option !== 'off';
    }

    /**
     * @for SafetyNetController
     * @method configure
     * @param options {object} `{ enabled }`: true or false, or null to follow the game option
     */
    configure({ enabled = null } = {}) {
        this._enabledOverride = enabled;
    }

    /**
     * @for SafetyNetController
     * @method reset
     */
    reset() {
        this._previousAltitudes = {};
        this._lastTime = null;
        // pairs that already scored an RA in their present encounter
        this._raEncounters = {};
        this.stcaAlerts = [];
    }

    /**
     * @for SafetyNetController
     * @method update
     * @param aircraftList {array<AircraftModel>}
     * @param airportModel {AirportModel}
     * @param time {number} game seconds
     */
    update(aircraftList, airportModel, time) {
        const elapsed = this._lastTime === null ? 0 : time - this._lastTime;
        const airborne = aircraftList.filter((aircraftModel) => !aircraftModel.isOnGround() && !aircraftModel.hit);
        const states = new Map();

        this._lastTime = time;

        aircraftList.forEach((aircraftModel) => {
            aircraftModel.safetyNet = aircraftModel.safetyNet || { tcas: { state: TCAS_STATE.CLEAR } };
        });

        airborne.forEach((aircraftModel) => {
            states.set(aircraftModel, this._buildState(aircraftModel, airportModel, elapsed));
        });

        this._forgetGone(aircraftList);

        if (!this.isEnabled) {
            aircraftList.forEach((aircraftModel) => this._clearAll(aircraftModel));

            return;
        }

        this._updateStca(airborne, states, airportModel);
        this._updateTcas(airborne, states, time);
        this._updateAreaWarnings(airborne, states, airportModel);
    }

    /**
     * Summary for the bots' observation
     *
     * @for SafetyNetController
     * @method getObservationFor
     * @param aircraftModel {AircraftModel}
     * @return {object}
     */
    getObservationFor(aircraftModel) {
        const safetyNet = aircraftModel.safetyNet || {};
        const tcas = safetyNet.tcas || { state: TCAS_STATE.CLEAR };

        return {
            stca: safetyNet.stca || STCA_LEVEL.NONE,
            tcas: tcas.state,
            raSense: tcas.state === TCAS_STATE.RA ? tcas.sense : null,
            msaw: Boolean(safetyNet.msaw),
            apw: safetyNet.apw || null
        };
    }

    // ------------------------------------------------------------------ states

    _buildState(aircraftModel, airportModel, elapsed) {
        const previous = this._previousAltitudes[aircraftModel.id];
        const verticalSpeed = previous !== undefined && elapsed > 0 ? (aircraftModel.altitude - previous) / elapsed : 0;
        const speedNmPerSecond = (aircraftModel.groundSpeed || 0) / 3600;

        this._previousAltitudes[aircraftModel.id] = aircraftModel.altitude;

        return {
            x: aircraftModel.relativePosition[0] / KM_PER_NM,
            y: aircraftModel.relativePosition[1] / KM_PER_NM,
            vx: Math.sin(aircraftModel.groundTrack || 0) * speedNmPerSecond,
            vy: Math.cos(aircraftModel.groundTrack || 0) * speedNmPerSecond,
            altitude: aircraftModel.altitude,
            verticalSpeed,
            targetAltitude: aircraftModel.target ? aircraftModel.target.altitude : aircraftModel.altitude,
            heightAgl: aircraftModel.altitude - airportModel.elevation,
            ceiling: aircraftModel.model ? aircraftModel.model.ceiling : Infinity
        };
    }

    _forgetGone(aircraftList) {
        const present = new Set(aircraftList.map((aircraftModel) => aircraftModel.id));

        Object.keys(this._previousAltitudes).forEach((id) => {
            if (!present.has(id) && !present.has(Number(id))) {
                delete this._previousAltitudes[id];
            }
        });
    }

    _clearAll(aircraftModel) {
        if (aircraftModel.safetyNet && aircraftModel.safetyNet.tcas.state === TCAS_STATE.RA) {
            aircraftModel.resolutionAdvisory = null;
        }

        aircraftModel.safetyNet = { tcas: { state: TCAS_STATE.CLEAR } };
    }

    // ------------------------------------------------------------------ STCA

    /**
     * STCA (STC-001 .. STC-003): predicted loss of radar separation between controlled aircraft above
     * 1000 ft AGL, except pairs separated by other means (same final, independent parallel approaches,
     * diverging departures: the same exemptions as the separation rule)
     *
     * @for SafetyNetController
     * @method _updateStca
     * @private
     */
    _updateStca(airborne, states, airportModel) {
        const profile = airportModel.regulatoryProfile;
        const minima = {
            lateralNm: profile.radarSeparationNm,
            verticalFt: profile.verticalSeparationFt - VERTICAL_TOLERANCE_FT
        };
        const candidates = airborne.filter((aircraftModel) => aircraftModel.isControllable &&
            states.get(aircraftModel).heightAgl >= STCA_MIN_HEIGHT_FT);
        const levels = new Map();
        const alerts = [];
        const severity = { [STCA_LEVEL.NONE]: 0, [STCA_LEVEL.PREDICTED]: 1, [STCA_LEVEL.ALERT]: 2 };

        for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
                const first = candidates[i];
                const second = candidates[j];
                const firstState = states.get(first);
                const secondState = states.get(second);
                const distance = Math.hypot(firstState.x - secondState.x, firstState.y - secondState.y);

                // quick rejection: they cannot meet within the horizon
                if (distance > 25 || this._realism._isExemptFromRadarSeparation(first, second, distance, airportModel, profile)) {
                    continue; // eslint-disable-line no-continue
                }

                const timeToLoss = stcaTimeToLoss(firstState, secondState, minima);
                const level = stcaLevel(timeToLoss);

                if (level === STCA_LEVEL.NONE) {
                    continue; // eslint-disable-line no-continue
                }

                alerts.push({ callsigns: [first.callsign, second.callsign], level, timeToLoss });
                [[first, second], [second, first]].forEach(([own, other]) => {
                    const current = levels.get(own);

                    if (!current || severity[level] > severity[current.level]) {
                        levels.set(own, { level, with: other.callsign });
                    }
                });
            }
        }

        airborne.forEach((aircraftModel) => {
            const result = levels.get(aircraftModel);

            aircraftModel.safetyNet.stca = result ? result.level : STCA_LEVEL.NONE;
            aircraftModel.safetyNet.stcaWith = result ? result.with : null;
        });

        this.stcaAlerts = alerts;
    }

    // ------------------------------------------------------------------ TCAS

    /**
     * TCAS II (TCA-001 .. TCA-007): traffic and resolution advisories, coordinated senses, clear of conflict
     *
     * @for SafetyNetController
     * @method _updateTcas
     * @private
     */
    _updateTcas(airborne, states, time) {
        const equipped = airborne.filter(hasTcas);
        // strongest threat of each equipped aircraft this second
        const threats = new Map();

        equipped.forEach((own) => {
            const ownState = states.get(own);
            let best = { state: TCAS_STATE.CLEAR, intruder: null };

            airborne.forEach((intruder) => {
                if (intruder === own) {
                    return;
                }

                const intruderState = states.get(intruder);

                // TCAS ignores traffic far away (saves the pair geometry)
                if (Math.hypot(ownState.x - intruderState.x, ownState.y - intruderState.y) > 15 ||
                    abs(ownState.altitude - intruderState.altitude) > 3000) {
                    return;
                }

                const state = tcasThreatLevel(ownState, intruderState);

                if (state === TCAS_STATE.RA || (state === TCAS_STATE.TA && best.state === TCAS_STATE.CLEAR)) {
                    best = { state, intruder };
                }
            });

            threats.set(own, best);
        });

        equipped.forEach((own) => this._updateTcasOf(own, threats.get(own), threats, states, time));

        // aircraft without TCAS never have advisories
        airborne.filter((aircraftModel) => !hasTcas(aircraftModel)).forEach((aircraftModel) => {
            aircraftModel.safetyNet.tcas = { state: TCAS_STATE.CLEAR };
        });
    }

    _updateTcasOf(own, threat, threats, states, time) {
        const { tcas } = own.safetyNet;

        if (tcas.state === TCAS_STATE.RA) {
            const intruder = tcas.intruderModel;
            const stillThreat = intruder && threat.state === TCAS_STATE.RA && threat.intruder === intruder;

            if (stillThreat) {
                tcas.clearSince = null;

                return;
            }

            tcas.clearSince = tcas.clearSince === null || tcas.clearSince === undefined ? time : tcas.clearSince;

            if (time - tcas.clearSince >= TCAS.CLEAR_OF_CONFLICT_SECONDS || !intruder || intruder.hit) {
                this._clearOfConflict(own);
            }

            return;
        }

        if (threat.state !== TCAS_STATE.RA) {
            own.safetyNet.tcas = threat.state === TCAS_STATE.TA ?
                { state: TCAS_STATE.TA, intruder: threat.intruder.callsign } :
                { state: TCAS_STATE.CLEAR };

            return;
        }

        const { intruder } = threat;
        const intruderTcas = intruder.safetyNet && intruder.safetyNet.tcas;
        let sense;

        // coordination: if the intruder already manoeuvres against us, take the complementary sense
        if (intruderTcas && intruderTcas.state === TCAS_STATE.RA && intruderTcas.intruderModel === own) {
            sense = intruderTcas.sense === RA_SENSE.LEVEL ? RA_SENSE.LEVEL : -intruderTcas.sense;
        } else {
            const row = sensitivityLevel(own.altitude, states.get(own).heightAgl);
            const [ownSense, intruderSense] = coordinatedSenses(states.get(own), states.get(intruder), row.alim);

            sense = ownSense;

            // the intruder's TCAS, if it also sees us as an RA threat, gets the complementary sense now
            const intruderThreat = threats.get(intruder);

            if (intruderThreat && intruderThreat.state === TCAS_STATE.RA && intruderThreat.intruder === own &&
                !(intruderTcas && intruderTcas.state === TCAS_STATE.RA)) {
                this._issueRa(intruder, own, intruderSense, time);
            }
        }

        this._issueRa(own, intruder, sense, time);
    }

    _issueRa(own, intruder, sense, time) {
        own.safetyNet.tcas = {
            state: TCAS_STATE.RA,
            sense,
            intruder: intruder.callsign,
            intruderModel: intruder,
            issuedAt: time,
            effectiveAt: time + TCAS.PILOT_REACTION_SECONDS,
            clearSince: null
        };
        own.resolutionAdvisory = {
            sense,
            effectiveAt: time + TCAS.PILOT_REACTION_SECONDS,
            verticalSpeedFpm: TCAS.RA_VERTICAL_SPEED_FPM
        };

        const words = { [RA_SENSE.CLIMB]: 'climb', [RA_SENSE.DESCEND]: 'descend', [RA_SENSE.LEVEL]: 'level off' };

        own.radioCall(`TCAS RA, ${words[sense]}`, AIRPORT_CONTROL_POSITION_NAME.APPROACH, true);

        const key = pairKey(own, intruder);

        if (!this._raEncounters[key]) {
            this._raEncounters[key] = true;
            this._realism.rulebook.record(
                RULE.TCAS_RA,
                [own.callsign, intruder.callsign],
                `TCAS resolution advisory (${words[sense]}) against ${intruder.callsign}, ` +
                `${Math.round(abs(own.altitude - intruder.altitude))} ft apart`
            );
        }
    }

    _clearOfConflict(own) {
        const intruder = own.safetyNet.tcas.intruderModel;

        own.safetyNet.tcas = { state: TCAS_STATE.CLEAR };
        own.resolutionAdvisory = null;
        own.radioCall(
            `clear of conflict, returning to ${Math.round((own.mcp && own.mcp.altitude) || own.altitude)}`,
            AIRPORT_CONTROL_POSITION_NAME.APPROACH
        );

        // the encounter is over once neither aircraft has an RA against the other
        if (intruder) {
            const intruderTcas = intruder.safetyNet && intruder.safetyNet.tcas;

            if (!intruderTcas || intruderTcas.state !== TCAS_STATE.RA || intruderTcas.intruderModel !== own) {
                delete this._raEncounters[pairKey(own, intruder)];
            }
        }
    }

    // ------------------------------------------------------------------ MSAW / APW

    /**
     * MSAW (MSW-001): predicted below the minimum vectoring altitude within 30 s. APW (APW-001): predicted
     * entry into a restricted area below its ceiling within 60 s. Neither scores: the rules that score are
     * the minimum altitude and restricted area rules.
     *
     * @for SafetyNetController
     * @method _updateAreaWarnings
     * @private
     */
    _updateAreaWarnings(airborne, states, airportModel) {
        const terrainClearance = this._realism._getTerrainClearance(airportModel);
        const areas = (airportModel.restricted_areas || []).map((area) => ({
            name: area.name || 'restricted area',
            height: area.height,
            polygon: area.poly.map((point) => ({ x: point[0] / KM_PER_NM, y: point[1] / KM_PER_NM }))
        }));

        airborne.forEach((aircraftModel) => {
            const state = states.get(aircraftModel);
            const isRelevant = aircraftModel.isControllable && !this._realism._isOnFinalApproach(aircraftModel);
            const isClimbingOut = aircraftModel.isDeparture() && nm(aircraftModel.distance) < DEPARTURE_CLIMB_OUT_RADIUS_NM;
            let msaw = false;

            // nothing to look up if even the lowest predicted altitude stays above the highest MVA
            const lowestPredicted = state.altitude + Math.min(0, state.verticalSpeed) * AREA_WARNINGS.MSAW_LOOKAHEAD_SECONDS;
            const canBeLow = terrainClearance &&
                lowestPredicted < terrainClearance.highestMinimumVectoringAltitude - MSAW_TOLERANCE_FT;

            if (canBeLow && isRelevant && !isClimbingOut && state.verticalSpeed <= 0) {
                const minimumAltitudeAt = (position) => terrainClearance.getMinimumVectoringAltitude([
                    position.x * KM_PER_NM,
                    position.y * KM_PER_NM
                ]);

                msaw = timeBelowMinimumAltitude(state, minimumAltitudeAt, MSAW_TOLERANCE_FT) !== null;
            }

            const entry = isRelevant && areas.length > 0 ? timeToAreaEntry(state, areas) : null;

            aircraftModel.safetyNet.msaw = msaw;
            aircraftModel.safetyNet.apw = entry ? entry.area.name : null;
        });
    }
}

/**
 * Log a safety net event in the radio log (used by the commander when a clearance is refused)
 *
 * @function logSafetyNet
 * @param message {string}
 */
export function logSafetyNet(message) {
    UiController.ui_log(message, true);
}

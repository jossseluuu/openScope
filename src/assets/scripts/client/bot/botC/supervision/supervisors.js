import { ACTIONS, ACTION_TYPE } from '../../actionSpace';
import {
    RunwayIndex, checkRunwayEntry, checkTakeoff, findNextArrival
} from '../../botRules';
import { AGENT } from '../agents';
import { predictTraffic } from './independentPrediction';

/**
 * Result of auditing an instruction, from the worst to the best
 *
 * @property VERDICT
 * @type {object}
 * @final
 */
export const VERDICT = {
    BAD: 'MALA',
    QUESTIONABLE: 'DUDOSA',
    GOOD: 'BUENA',
    PENDING: 'PENDIENTE'
};

/**
 * How far ahead an instruction is judged, in seconds
 *
 * @property JUDGEMENT_HORIZON_SECONDS
 * @type {number}
 * @final
 */
export const JUDGEMENT_HORIZON_SECONDS = 120;

/**
 * Largest angle to intercept a localizer, in degrees (ICAO Doc 8168)
 *
 * @property MAXIMUM_INTERCEPT_DEGREES
 * @type {number}
 * @final
 */
const MAXIMUM_INTERCEPT_DEGREES = 30;

const bad = (text, reference = null) => ({ severity: VERDICT.BAD, text, reference });
const doubtful = (text, reference = null) => ({ severity: VERDICT.QUESTIONABLE, text, reference });
const good = (text, reference = null) => ({ severity: VERDICT.GOOD, text, reference });

const headingGap = (first, second) => Math.abs(((first - second + 540) % 360) - 180);

/**
 * The aircraft as it would fly after the instruction, as far as a straight prediction can tell
 */
function afterInstruction(aircraft, action) {
    if (action.type === ACTION_TYPE.ALTITUDE) {
        return { ...aircraft, clearance: { ...aircraft.clearance, altitude: action.value } };
    }

    if (action.type === ACTION_TYPE.HEADING) {
        return { ...aircraft, groundTrack: aircraft.groundTrack + action.value };
    }

    return aircraft;
}

/**
 * Checks valid for every instruction given to an aircraft in the air
 */
function checkFlight(aircraft, action, observation) {
    const findings = [];
    const before = predictTraffic(aircraft, observation, JUDGEMENT_HORIZON_SECONDS);
    const after = predictTraffic(afterInstruction(aircraft, action), observation, JUDGEMENT_HORIZON_SECONDS);

    if (after.loss && !before.loss) {
        findings.push(bad(
            `crea un conflicto con ${after.with} en ${after.loss.seconds} s ` +
            `(${after.loss.lateralNm.toFixed(1)} nm y ${Math.round(after.loss.verticalFt)} ft)`,
            'ICAO Doc 4444 8.7.3'
        ));
    } else if (after.loss) {
        findings.push(doubtful(`el conflicto con ${after.with} sigue en ${after.loss.seconds} s`, 'ICAO Doc 4444 8.7.3'));
    } else if (before.loss) {
        findings.push(good(`resuelve el conflicto con ${before.with} previsto en ${before.loss.seconds} s`, 'ICAO Doc 4444 8.7.3'));
    } else if (after.nearest) {
        findings.push(good(`sin conflicto en ${JUDGEMENT_HORIZON_SECONDS} s (${after.nearest.callsign} a ${after.nearest.nm.toFixed(1)} nm)`));
    } else {
        findings.push(good(`sin tráfico en ${JUDGEMENT_HORIZON_SECONDS} s`));
    }

    if (action.type === ACTION_TYPE.ALTITUDE) {
        if (Number.isFinite(aircraft.minimumVectoringAltitude) && action.value < aircraft.minimumVectoringAltitude) {
            findings.push(bad(
                `${action.value} ft por debajo de la altitud mínima de vectores (${aircraft.minimumVectoringAltitude} ft)`,
                'ICAO Doc 4444 8.6.5.2'
            ));
        }

        if (aircraft.category === 'arrival' && Number.isFinite(aircraft.airspaceFloor) && action.value < aircraft.airspaceFloor) {
            findings.push(bad(`${action.value} ft por debajo del suelo del espacio aéreo (${aircraft.airspaceFloor} ft)`));
        }
    }

    if (action.type === ACTION_TYPE.SPEED && action.value > 250 && aircraft.altitude < 10000) {
        findings.push(bad(`${action.value} kt por debajo de 10 000 ft (máximo 250 kt)`, 'ICAO Doc 4444 Apéndice 4'));
    }

    return findings;
}

function checkTower(aircraft, action, observation) {
    const runwayIndex = new RunwayIndex(observation.airport);
    const runwayName = aircraft.departureRunway || observation.airport.departureRunway;

    switch (action.type) {
        case ACTION_TYPE.TAKEOFF: {
            const check = checkTakeoff(aircraft, observation, runwayIndex);

            return [check.ok ?
                good(`pista ${runwayName} libre, estela e intervalo con las llegadas correctos`, 'ICAO Doc 4444 7.9') :
                bad(`despegue autorizado con ${check.reason}`, 'ICAO Doc 4444 7.9')];
        }
        case ACTION_TYPE.LINE_UP: {
            const check = checkRunwayEntry(aircraft, observation, runwayIndex);

            return [check.ok ?
                good(`pista ${runwayName} libre para alinearse`, 'ICAO Doc 4444 7.9') :
                bad(`alineado con ${check.reason}`, 'ICAO Doc 4444 7.9')];
        }
        case ACTION_TYPE.CANCEL_TAKEOFF:
            return [{ severity: VERDICT.PENDING, text: 'a juzgar cuando el motor valore la cancelación', reference: null }];
        case ACTION_TYPE.GO_AROUND: {
            const physicalName = runwayIndex.physicalName[aircraft.arrivalRunway];
            const occupied = observation.realism.runwayOccupancy.find((runway) => runway.runway === physicalName);

            return [occupied ?
                good(`frustrada: pista ocupada por ${occupied.occupants[0].callsign}`, 'ICAO Doc 4444 7.10') :
                doubtful('frustrada con la pista libre')];
        }
        case ACTION_TYPE.TAXI:
            return [good(`rodaje a ${runwayName}`)];
        default:
            return [];
    }
}

function checkArrivalPath(aircraft, action, observation) {
    if (action.type === ACTION_TYPE.HOLD && aircraft.emergency) {
        return [bad('espera a un avión en emergencia, que tiene prioridad', 'ICAO Doc 4444 15.1.3')];
    }

    if (action.type !== ACTION_TYPE.ILS) {
        return [];
    }

    const runway = observation.airport.runways.flat().find(({ name }) => name === aircraft.arrivalRunway);
    const intercept = runway ? headingGap(aircraft.groundTrack, runway.heading) : 0;

    if (intercept > MAXIMUM_INTERCEPT_DEGREES) {
        return [doubtful(`intercepta el localizador a ${Math.round(intercept)}°, más de ${MAXIMUM_INTERCEPT_DEGREES}°`, 'ICAO Doc 8168')];
    }

    return [good(`intercepta el localizador a ${Math.round(intercept)}°`, 'ICAO Doc 8168')];
}

function checkCoordinator(aircraft, action, observation) {
    const runwayIndex = new RunwayIndex(observation.airport);
    const physicalName = runwayIndex.physicalName[aircraft.arrivalRunway];
    const next = physicalName ? findNextArrival(physicalName, observation, runwayIndex) : null;

    if (aircraft.hasApproachClearance) {
        return [bad('cambio de pista a un avión ya autorizado a la aproximación')];
    }

    return [good(next ? `adelanta el aterrizaje; ${next.aircraft.callsign} sigue en la pista actual` : 'adelanta el aterrizaje')];
}

/**
 * Domain checks of each agent's supervisor, on top of `checkFlight`
 *
 * @property DOMAIN_CHECKS
 * @type {object}
 * @final
 */
const DOMAIN_CHECKS = {
    [AGENT.COORDINATOR]: checkCoordinator,
    [AGENT.ARRIVALS]: checkArrivalPath,
    [AGENT.ILS]: checkArrivalPath,
    [AGENT.TOWER]: checkTower,
    [AGENT.DEPARTURES]: () => [],
    [AGENT.SEPARATION]: () => [],
    [AGENT.SHIELD]: () => [good('impuesta por el escudo de seguridad')]
};

/**
 * Audit an instruction of an agent. Reads only the observation and never changes anything.
 *
 * @function auditInstruction
 * @param decision {object}     `{ callsign, action, agent }`
 * @param aircraft {object}
 * @param observation {object}
 * @return {object} `{ verdict, findings }`
 */
export function auditInstruction(decision, aircraft, observation) {
    const action = ACTIONS[decision.action];
    const findings = [
        ...DOMAIN_CHECKS[decision.agent](aircraft, action, observation),
        ...(aircraft.isOnGround ? [] : checkFlight(aircraft, action, observation))
    ];
    const severities = findings.map(({ severity }) => severity);
    const worst = [VERDICT.BAD, VERDICT.PENDING, VERDICT.QUESTIONABLE].find((severity) => severities.indexOf(severity) !== -1);

    return { verdict: worst || VERDICT.GOOD, findings };
}

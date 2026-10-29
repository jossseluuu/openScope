import ava from 'ava';

import MetricsCollector from '../../src/assets/scripts/client/realism/MetricsCollector';
import { FLIGHT_PHASE } from '../../src/assets/scripts/client/constants/aircraftConstants';

const createAircraft = (overrides = {}) => ({
    id: 'aircraft-1',
    model: { weightClass: 'M', category: { recatEu: 'D' } },
    flightPhase: FLIGHT_PHASE.CRUISE,
    groundSpeed: 360,
    isControllable: true,
    isOnGround: () => false,
    isTaxiing: () => false,
    isTakeoff: () => false,
    ...overrides
});

ava('.update() integrates track miles and fuel of airborne aircraft', (t) => {
    const metrics = new MetricsCollector();
    const aircraftModel = createAircraft();

    metrics.update(0, [aircraftModel]);
    metrics.update(10, [aircraftModel]);
    metrics.recordLanding(aircraftModel, 10);

    const summary = metrics.getSummary();

    t.is(summary.landings, 1);
    t.is(summary.averageArrivalTrackMiles, 1);
    t.is(summary.averageArrivalTimeInAirspaceSeconds, 10);
    t.is(summary.fuelKg, 7);
    t.is(summary.co2Kg, 7 * 3.16);
});

ava('.recordTakeoff() measures ground time and holding point wait', (t) => {
    const metrics = new MetricsCollector();
    const departure = createAircraft({ flightPhase: FLIGHT_PHASE.APRON, isOnGround: () => true, isTaxiing: () => true });

    metrics.update(0, [departure]);
    departure.flightPhase = FLIGHT_PHASE.WAITING;
    metrics.update(300, [departure]);
    metrics.recordTakeoff(departure, 330);

    const summary = metrics.getSummary();

    t.is(summary.takeoffs, 1);
    t.is(summary.averageDepartureGroundTimeSeconds, 330);
    t.is(summary.averageHoldingPointWaitSeconds, 30);
});

ava('.getSummary() reports null averages when nothing happened', (t) => {
    const summary = new MetricsCollector().getSummary();

    t.is(summary.averageArrivalTrackMiles, null);
    t.is(summary.goArounds, 0);
    t.is(summary.movementsPerHour, 0);
});

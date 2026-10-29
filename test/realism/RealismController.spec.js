import ava from 'ava';
import sinon from 'sinon';

import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import GameController from '../../src/assets/scripts/client/game/GameController';
import RealismController from '../../src/assets/scripts/client/realism/RealismController';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import { FLIGHT_PHASE } from '../../src/assets/scripts/client/constants/aircraftConstants';
import { km } from '../../src/assets/scripts/client/utilities/unitConverters';
import { AIRPORT_JSON_KLAS_MOCK } from '../airport/_mocks/airportJsonMock';

const A388 = { weightClass: 'J', category: { recatEu: 'A', wakeFaa: 'SUPER' }, speed: { landing: 145 } };
const B77W = { weightClass: 'H', category: { recatEu: 'B', wakeFaa: 'HEAVY' }, speed: { landing: 145 } };
const A320 = { weightClass: 'M', category: { recatEu: 'D', wakeFaa: 'LARGE' }, speed: { landing: 130 } };
const C172 = { weightClass: 'L', category: { recatEu: 'F', wakeFaa: 'SMALL' }, speed: { landing: 60 } };

let sandbox;
let now;
let airportModel;
let aircraftList;
let controller;

/**
 * Point `distanceNm` before the threshold of `runwayModel`, on its extended centerline
 */
const onFinal = (runwayModel, distanceNm) => [
    runwayModel.relativePosition[0] - Math.sin(runwayModel.angle) * km(distanceNm),
    runwayModel.relativePosition[1] - Math.cos(runwayModel.angle) * km(distanceNm)
];

let nextId = 0;

const createAircraft = (overrides = {}) => {
    nextId += 1;

    const aircraftModel = {
        id: `aircraft-${nextId}`,
        callsign: `TST${nextId}`,
        model: A320,
        category: 'arrival',
        flightPhase: FLIGHT_PHASE.CRUISE,
        relativePosition: [0, 0],
        altitude: 10000,
        speed: 250,
        groundSpeed: 250,
        groundTrack: 0,
        distance: 0,
        isControllable: true,
        hit: false,
        projected: false,
        onGround: false,
        pilot: { hasApproachClearance: false },
        fms: { arrivalRunwayModel: null, departureRunwayModel: null },
        isArrival() { return this.category === 'arrival'; },
        isDeparture() { return this.category === 'departure'; },
        isOnGround() { return this.onGround; },
        isAirborne() { return !this.onGround; },
        isTaxiing() { return false; },
        isTakeoff() { return this.flightPhase === FLIGHT_PHASE.TAKEOFF; },
        isEstablishedOnCourse() { return true; },
        isEstablishedOnGlidepath() { return true; },
        cancelLanding: sinon.spy(),
        ...overrides
    };

    aircraftList.push(aircraftModel);

    return aircraftModel;
};

const createArrivalOnFinal = (runwayModel, distanceNm, overrides = {}) => createAircraft({
    flightPhase: FLIGHT_PHASE.LANDING,
    relativePosition: onFinal(runwayModel, distanceNm),
    altitude: runwayModel.elevation + distanceNm * 318,
    speed: 140,
    pilot: { hasApproachClearance: true },
    fms: { arrivalRunwayModel: runwayModel, departureRunwayModel: null },
    ...overrides
});

const createDeparture = (runwayModel, overrides = {}) => createAircraft({
    category: 'departure',
    flightPhase: FLIGHT_PHASE.TAKEOFF,
    relativePosition: runwayModel.relativePosition.slice(),
    altitude: runwayModel.elevation,
    onGround: true,
    fms: { arrivalRunwayModel: null, departureRunwayModel: runwayModel },
    ...overrides
});

const recordedRules = () => controller.rulebook.drainViolations().map((violation) => violation.rule);

ava.serial.beforeEach(() => {
    sandbox = sinon.createSandbox();
    now = 1000;
    aircraftList = [];
    airportModel = new AirportModel(AIRPORT_JSON_KLAS_MOCK);

    sandbox.stub(TimeKeeper, 'accumulatedDeltaTime').get(() => now);
    sandbox.stub(AirportController, 'airport_get').returns(airportModel);
    sandbox.stub(GameController, 'events_recordNew');
    sandbox.stub(UiController, 'ui_log');

    controller = new RealismController({ aircraft: { list: aircraftList } });
    controller.update();
});

ava.serial.afterEach.always(() => {
    controller.disable();
    sandbox.restore();
});

ava.serial('groups runway ends by physical runway', (t) => {
    t.is(controller.getPhysicalRunwayName(airportModel.getRunway('25R')), '07L/25R');
    t.is(controller.getPhysicalRunwayName(airportModel.getRunway('07L')), '07L/25R');
});

ava.serial('a landing aircraft occupies the runway for its runway occupancy time', (t) => {
    const runwayModel = airportModel.getRunway('25L');
    const arrival = createArrivalOnFinal(runwayModel, 0, { onGround: true, altitude: runwayModel.elevation });

    controller.update();
    t.true(controller.isRunwayOccupied(runwayModel));
    t.true(controller.isRunwayOccupied(airportModel.getRunway('07R')));
    t.false(controller.isRunwayOccupied(runwayModel, arrival));

    now += 100;
    controller.update();
    t.false(controller.isRunwayOccupied(runwayModel));
});

ava.serial('a takeoff on an occupied runway is a runway incursion', (t) => {
    const runwayModel = airportModel.getRunway('25L');

    createArrivalOnFinal(runwayModel, 0, { onGround: true, altitude: runwayModel.elevation });
    controller.update();
    recordedRules();

    const departure = createDeparture(runwayModel);

    controller._onTakeoff(departure, runwayModel);

    t.deepEqual(recordedRules(), ['RUNWAY_INCURSION']);
});

ava.serial('a departure occupies the runway until it is airborne past the runway end', (t) => {
    const runwayModel = airportModel.getRunway('25R');
    const departure = createDeparture(runwayModel);

    controller._onTakeoff(departure, runwayModel);
    t.true(controller.isRunwayOccupied(runwayModel));

    departure.onGround = false;
    departure.relativePosition = onFinal(runwayModel, -3);
    controller.update();
    t.false(controller.isRunwayOccupied(runwayModel));
});

ava.serial('a takeoff with an arrival closer than 2 nm to the threshold breaks arrival/departure separation', (t) => {
    const runwayModel = airportModel.getRunway('25R');

    createArrivalOnFinal(runwayModel, 1.5);
    controller._onTakeoff(createDeparture(runwayModel), runwayModel);

    t.deepEqual(recordedRules(), ['ARRIVAL_DEPARTURE']);
});

ava.serial('departures behind a super need the wake turbulence time interval', (t) => {
    const runwayModel = airportModel.getRunway('25R');
    const leader = createDeparture(runwayModel, { model: A388 });

    controller._onTakeoff(leader, runwayModel);
    leader.onGround = false;
    leader.relativePosition = onFinal(runwayModel, -5);
    now += 60;
    controller.update();

    const follower = createDeparture(runwayModel, { model: C172 });

    controller._onTakeoff(follower, runwayModel);

    t.deepEqual(recordedRules(), ['WAKE_DEPARTURE']);

    follower.onGround = false;
    follower.relativePosition = onFinal(runwayModel, -5);
    now += 200;
    controller.update();
    controller._onTakeoff(createDeparture(runwayModel, { model: C172 }), runwayModel);
    t.deepEqual(recordedRules(), []);
});

ava.serial('an arrival goes around at decision height when the runway is occupied', (t) => {
    const runwayModel = airportModel.getRunway('25L');

    createArrivalOnFinal(runwayModel, 0, { onGround: true, altitude: runwayModel.elevation });
    const arrival = createArrivalOnFinal(runwayModel, 0.5, { altitude: runwayModel.elevation + 150 });

    controller.update();

    t.true(arrival.cancelLanding.calledOnce);
    t.regex(arrival.cancelLanding.firstCall.args[0], /runway occupied/);
});

ava.serial('an arrival too fast at 1000 ft goes around', (t) => {
    const runwayModel = airportModel.getRunway('25L');
    const arrival = createArrivalOnFinal(runwayModel, 3, { altitude: runwayModel.elevation + 950, speed: 200 });

    controller.update();

    t.true(arrival.cancelLanding.calledOnceWith('unstable approach, too fast'));
});

ava.serial('a stable arrival on a clear runway continues', (t) => {
    const runwayModel = airportModel.getRunway('25L');
    const arrival = createArrivalOnFinal(runwayModel, 0.5, { altitude: runwayModel.elevation + 150 });

    controller.update();

    t.false(arrival.cancelLanding.called);
});

ava.serial('a go-around is recorded in the rulebook and the metrics', (t) => {
    const arrival = createAircraft();

    controller._onGoAround(arrival, airportModel.getRunway('25L'));

    t.deepEqual(recordedRules(), ['GO_AROUND']);
    t.is(controller.metrics.goArounds, 1);
});

ava.serial('a loss of radar separation is recorded once while it lasts', (t) => {
    createAircraft({ relativePosition: [20, 20], altitude: 10000 });
    const second = createAircraft({ relativePosition: [20, 20 + km(10)], altitude: 10500 });

    now += 1;
    controller.update();
    now += 120;
    second.relativePosition = [20, 20 + km(2)];
    controller.update();
    t.deepEqual(recordedRules(), ['RADAR_SEPARATION']);

    now += 1;
    controller.update();
    t.deepEqual(recordedRules(), []);
    t.true(controller.metrics.separationLossSeconds > 0);
});

ava.serial('aircraft handed over unseparated are not counted during the grace time', (t) => {
    controller.update();
    createAircraft({ relativePosition: [20, 20], altitude: 10000 });
    createAircraft({ relativePosition: [20, 20 + km(2)], altitude: 10000 });

    now += 1;
    controller.update();
    t.deepEqual(recordedRules(), []);

    now += 70;
    controller.update();
    t.deepEqual(recordedRules(), ['RADAR_SEPARATION']);
});

ava.serial('aircraft 1000 ft apart are separated', (t) => {
    createAircraft({ relativePosition: [20, 20], altitude: 10000 });
    createAircraft({ relativePosition: [20, 20], altitude: 11000 });

    controller.update();
    now += 120;
    controller.update();

    t.deepEqual(recordedRules(), []);
});

ava.serial('wake turbulence separation applies behind a super on final', (t) => {
    const runwayModel = airportModel.getRunway('25L');

    createArrivalOnFinal(runwayModel, 4, { model: A388 });
    createArrivalOnFinal(runwayModel, 8, { model: A320 });

    now += 1;
    controller.update();

    // FAA: large behind super, 7 nm
    t.deepEqual(recordedRules(), ['WAKE_ARRIVAL']);
});

ava.serial('aircraft closer than the minimum on the same final lose final approach separation', (t) => {
    const runwayModel = airportModel.getRunway('25L');

    createArrivalOnFinal(runwayModel, 4, { model: B77W });
    createArrivalOnFinal(runwayModel, 6, { model: B77W });

    now += 1;
    controller.update();

    t.deepEqual(recordedRules(), ['FINAL_APPROACH_SEPARATION']);
});

ava.serial('.getObservation() describes the profile, runway occupancy and metrics', (t) => {
    const runwayModel = airportModel.getRunway('25R');

    controller._onTakeoff(createDeparture(runwayModel), runwayModel);

    const observation = controller.getObservation();

    t.is(observation.regulatoryProfile, 'FAA');
    t.is(observation.wakeScheme, 'FAA');
    t.is(observation.runwayOccupancy[0].runway, '07L/25R');
    t.is(observation.runwayOccupancy[0].occupants[0].kind, 'departure');
    t.is(observation.metrics.takeoffs, 1);
});

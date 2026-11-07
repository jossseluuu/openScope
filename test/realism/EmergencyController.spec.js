import ava from 'ava';
import sinon from 'sinon';

import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import EmergencyController, {
    EMERGENCY_SQUAWK,
    EMERGENCY_TYPES
} from '../../src/assets/scripts/client/realism/EmergencyController';
import GameController, { GAME_EVENTS } from '../../src/assets/scripts/client/game/GameController';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import { RULE } from '../../src/assets/scripts/client/realism/Rulebook';
import { FLIGHT_PHASE } from '../../src/assets/scripts/client/constants/aircraftConstants';

let sandbox;
let rulebook;
let nextId = 0;

const RUNWAY = { name: '32L', relativePosition: [0, 0] };

const createAircraft = (overrides = {}) => {
    nextId += 1;

    return {
        id: `aircraft-${nextId}`,
        callsign: `TST${nextId}`,
        category: 'arrival',
        flightPhase: FLIGHT_PHASE.DESCENT,
        // 20 km from the threshold
        relativePosition: [20, 0],
        distance: 20,
        altitude: 9000,
        origin: 'LEMD',
        destination: 'LEMD',
        transponderCode: '4521',
        emergency: null,
        isControllable: true,
        hit: false,
        projected: false,
        pilot: { hasApproachClearance: false, maintainPresentHeading: sinon.spy() },
        mcp: { altitude: 24000, setAltitudeFieldValue: sinon.spy(), setAltitudeHold: sinon.spy() },
        fms: { arrivalRunwayModel: RUNWAY },
        isArrival() { return this.category === 'arrival'; },
        isDeparture() { return this.category === 'departure'; },
        isOnGround() { return false; },
        radioCall: sinon.spy(),
        setFlightPhase: sinon.spy(),
        ...overrides
    };
};

ava.beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(AirportController, 'airport_get').returns({ arrivalRunwayModel: RUNWAY });
    sandbox.stub(GameController, 'events_recordNew');
    sandbox.stub(UiController, 'ui_log');
    rulebook = { record: sinon.spy() };
});

ava.afterEach(() => {
    sandbox.restore();
});

ava.serial('with a rate of 1 every arrival declares an emergency within its window, squawking 7700', (t) => {
    const controller = new EmergencyController(rulebook);
    const aircraftModel = createAircraft();

    controller.configure({ seed: 1, rate: 1 });
    controller.update([aircraftModel], 0);
    t.is(aircraftModel.emergency, null);

    controller.update([aircraftModel], 800);

    t.not(aircraftModel.emergency, null);
    t.is(aircraftModel.transponderCode, EMERGENCY_SQUAWK);
    t.true(EMERGENCY_TYPES.some((type) => type.id === aircraftModel.emergency.type));
    t.true(GameController.events_recordNew.calledWith(GAME_EVENTS.EMERGENCY_DECLARED));
    t.true(aircraftModel.radioCall.calledOnce);
    t.true(aircraftModel.radioCall.firstCall.args[0].startsWith('MAYDAY MAYDAY MAYDAY'));
});

ava.serial('with a rate of 0 nobody declares an emergency', (t) => {
    const controller = new EmergencyController(rulebook);
    const aircraftModel = createAircraft();

    controller.configure({ seed: 1, rate: 0 });
    controller.update([aircraftModel], 0);
    controller.update([aircraftModel], 5000);

    t.is(aircraftModel.emergency, null);
});

ava.serial('the same seed gives the same emergencies', (t) => {
    const first = new EmergencyController(rulebook);
    const second = new EmergencyController(rulebook);
    const a = createAircraft();
    const b = createAircraft({ id: a.id });

    first.configure({ seed: 42, rate: 1 });
    second.configure({ seed: 42, rate: 1 });
    first.update([a], 0);
    second.update([b], 0);
    first.update([a], 800);
    second.update([b], 800);

    t.deepEqual(a.emergency, b.emergency);
});

ava.serial('the deadline is never shorter than a direct approach plus a margin', (t) => {
    const controller = new EmergencyController(rulebook);
    // 100 nm out: about 30 minutes at 200 kt
    const aircraftModel = createAircraft({ relativePosition: [185.2, 0], distance: 185.2 });

    controller.declare(aircraftModel, 'SMOKE', 0);

    t.true(aircraftModel.emergency.deadline >= 100 / 200 * 3600 + 600);
});

ava.serial('a missed deadline is recorded once in the Rulebook', (t) => {
    const controller = new EmergencyController(rulebook);
    const aircraftModel = createAircraft();

    controller.declare(aircraftModel, 'MEDICAL', 0);
    controller.update([aircraftModel], aircraftModel.emergency.deadline + 1);
    controller.update([aircraftModel], aircraftModel.emergency.deadline + 60);

    t.true(rulebook.record.calledOnce);
    t.is(rulebook.record.firstCall.args[0], RULE.EMERGENCY_DEADLINE);
});

ava.serial('landing in time is scored, and the deadline no longer applies', (t) => {
    const controller = new EmergencyController(rulebook);
    const aircraftModel = createAircraft();

    controller.declare(aircraftModel, 'ENGINE_FAILURE', 0);
    controller.onTouchdown(aircraftModel, 600);
    controller.update([aircraftModel], aircraftModel.emergency.deadline + 1);

    t.true(GameController.events_recordNew.calledWith(GAME_EVENTS.EMERGENCY_LANDING));
    t.false(rulebook.record.called);
});

ava.serial('leaving the airspace in emergency misses the deadline at once', (t) => {
    const controller = new EmergencyController(rulebook);
    const aircraftModel = createAircraft();

    controller.declare(aircraftModel, 'FUEL', 0);
    aircraftModel.isControllable = false;
    controller.update([aircraftModel], 10);

    t.true(rulebook.record.calledOnce);
});

ava.serial('a departure never declares an emergency', (t) => {
    const controller = new EmergencyController(rulebook);
    const aircraftModel = createAircraft({
        category: 'departure',
        flightPhase: FLIGHT_PHASE.CLIMB,
        altitude: 4300,
        destination: 'EGLL'
    });

    t.is(controller.declare(aircraftModel, 'ENGINE_FAILURE', 0), null);
    t.is(aircraftModel.emergency, null);
});

ava.serial('aircraft about to land, or on the ground, do not declare emergencies', (t) => {
    const controller = new EmergencyController(rulebook);
    const landing = createAircraft({ flightPhase: FLIGHT_PHASE.LANDING });
    const notOurs = createAircraft({ isControllable: false });

    t.is(controller.declare(landing, null, 0), null);
    t.is(controller.declare(notOurs, null, 0), null);
});

ava.serial('getObservation() lists the emergencies not yet landed', (t) => {
    const controller = new EmergencyController(rulebook);
    const first = createAircraft();
    const second = createAircraft();

    controller.declare(first, 'MEDICAL', 0);
    controller.declare(second, 'MEDICAL', 0);
    controller.onTouchdown(first, 300);

    const observation = controller.getObservation(400);

    t.is(observation.length, 1);
    t.is(observation[0].callsign, second.callsign);
    t.true(observation[0].remainingSeconds > 0);
});

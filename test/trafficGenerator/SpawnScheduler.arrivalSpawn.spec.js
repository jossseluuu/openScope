import ava from 'ava';
import sinon from 'sinon';
import SpawnScheduler from '../../src/assets/scripts/client/trafficGenerator/SpawnScheduler';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';
import GameController from '../../src/assets/scripts/client/game/GameController';

// Arrival spacing at airports with `arrivalSpawn` (Spanish airports): an arrival takes the next free slot,
// later arrivals queue one interval apart, and nothing is queued more than 10 minutes ahead.

const INTERVAL = 120;
let sandbox;
let now;
let timeouts;
let controller;

function arrivalModel() {
    return { isAirborneAtSpawn: () => true, method: 'random', rate: 10 };
}

function departureModel() {
    return { isAirborneAtSpawn: () => false, method: 'random', rate: 10 };
}

ava.beforeEach(() => {
    sandbox = sinon.createSandbox();
    now = 1000;
    timeouts = [];
    controller = {
        createAircraftWithSpawnPatternModel: sinon.stub(),
        tryCreateAirborneAircraft: sinon.stub().returns({ created: true })
    };

    sandbox.stub(TimeKeeper, 'accumulatedDeltaTime').get(() => now);
    sandbox.stub(AirportController, 'airport_get').returns({ arrivalSpawn: { minimumIntervalSeconds: INTERVAL } });
    sandbox.stub(GameController, 'game_timeout').callsFake((callback, delay, that, args) => {
        timeouts.push({ callback, delay, args });

        return [timeouts.length];
    });

    SpawnScheduler._nextArrivalTime = 0;
});

ava.afterEach.always(() => {
    sandbox.restore();
});

ava.serial('a departure is created at once, without spacing', (t) => {
    SpawnScheduler._spawn(departureModel(), controller);

    t.true(controller.createAircraftWithSpawnPatternModel.calledOnce);
    t.is(timeouts.length, 0);
    t.is(SpawnScheduler._nextArrivalTime, 0);
});

ava.serial('the first arrival takes the free slot now, 10 nm before the boundary', (t) => {
    const model = arrivalModel();

    SpawnScheduler._spawn(model, controller);

    t.true(controller.tryCreateAirborneAircraft.calledOnceWith(model, 10));
    t.is(SpawnScheduler._nextArrivalTime, now + INTERVAL);
});

ava.serial('the following arrivals are queued one interval apart', (t) => {
    SpawnScheduler._spawn(arrivalModel(), controller);
    SpawnScheduler._spawn(arrivalModel(), controller);
    SpawnScheduler._spawn(arrivalModel(), controller);

    t.is(controller.tryCreateAirborneAircraft.callCount, 1);
    t.deepEqual(timeouts.map((timeout) => timeout.delay), [INTERVAL, 2 * INTERVAL]);
    t.is(SpawnScheduler._nextArrivalTime, now + 3 * INTERVAL);

    timeouts[0].callback(timeouts[0].args);
    t.is(controller.tryCreateAirborneAircraft.callCount, 2);
    t.is(controller.tryCreateAirborneAircraft.secondCall.args[1], 10);
});

ava.serial('an arrival that would wait more than 10 minutes is dropped', (t) => {
    // 600 s / 120 s: slots at +0, +120 ... +600 are accepted, the next one is not
    for (let i = 0; i < 6; i++) {
        SpawnScheduler._spawn(arrivalModel(), controller);
    }

    const queuedBefore = timeouts.length;
    const nextBefore = SpawnScheduler._nextArrivalTime;

    SpawnScheduler._spawn(arrivalModel(), controller);

    t.is(queuedBefore, 5);
    t.is(timeouts.length, queuedBefore);
    t.is(SpawnScheduler._nextArrivalTime, nextBefore);
});

ava.serial('a slot in the past is not reused: the arrival goes now', (t) => {
    SpawnScheduler._nextArrivalTime = now - 500;

    SpawnScheduler._spawn(arrivalModel(), controller);

    t.true(controller.tryCreateAirborneAircraft.calledOnce);
    t.is(SpawnScheduler._nextArrivalTime, now + INTERVAL);
});

ava.serial('without arrivalSpawn an arrival is created at once at the start of its route', (t) => {
    AirportController.airport_get.returns({});
    const model = arrivalModel();

    SpawnScheduler._spawn(model, controller);

    t.true(controller.tryCreateAirborneAircraft.calledOnceWith(model, null));
    t.is(timeouts.length, 0);
});

ava.serial('a spawn refused by the safety check is retried every 30 s, at most 10 times', (t) => {
    controller.tryCreateAirborneAircraft.returns({ created: false });

    SpawnScheduler._spawn(arrivalModel(), controller);

    while (timeouts.length > 0) {
        const timeout = timeouts.shift();

        t.is(timeout.delay, 30);
        timeout.callback(timeout.args);
    }

    t.is(controller.tryCreateAirborneAircraft.callCount, 10);
});

ava.serial('a retried spawn stops as soon as it is created', (t) => {
    controller.tryCreateAirborneAircraft.onFirstCall().returns({ created: false });

    SpawnScheduler._spawn(arrivalModel(), controller);
    timeouts.shift().callback([arrivalModel(), controller]);

    t.is(controller.tryCreateAirborneAircraft.callCount, 2);
    t.is(timeouts.length, 0);
});

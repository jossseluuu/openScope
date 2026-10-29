/**
 * Runs an airport headless with no controller input and prints a summary.
 *
 * Usage: node tools/sim/demo.js [icao] [minutes] [seed]
 */
const { HeadlessSimulator, ASSETS_PATH } = require('./bootstrap');

const [icao = 'lemd', minutes = '30', seed = '1'] = process.argv.slice(2);
const simulator = new HeadlessSimulator({ assetsPath: ASSETS_PATH });
const started = process.hrtime.bigint();
let observation = simulator.reset(icao, Number(seed));

console.log(`${icao.toUpperCase()} seed ${seed}: ${observation.aircraft.length} aircraft at start`);

for (let minute = 1; minute <= Number(minutes); minute++) {
    observation = simulator.step(60);

    if (minute % 10 === 0) {
        const airborne = observation.aircraft.filter((aircraft) => !aircraft.isOnGround).length;

        console.log(`t=${minute}min aircraft=${observation.aircraft.length} airborne=${airborne} score=${observation.score}`);
    }
}

const seconds = Number(process.hrtime.bigint() - started) / 1e9;

console.log(`simulated ${minutes} min in ${seconds.toFixed(1)} s (${(Number(minutes) * 60 / seconds).toFixed(0)}x real time)`);
console.log('events:', JSON.stringify(observation.events));
console.log('first aircraft:', JSON.stringify(observation.aircraft[0], null, 1));

/* eslint-disable no-console */
/**
 * Runs an airport with the dynamic weather and prints its state every few minutes (wind, visibility,
 * thunderstorm cells, runway configuration), to look at the weather evolution without the browser.
 *
 * Usage:
 *   node tools/sim/weather-demo.js [--airport lemd] [--seed 1] [--hours 4] [--every 20]
 */
const { HeadlessSimulator, ASSETS_PATH } = require('./bootstrap');

const AirportController = require('../../src/assets/scripts/client/airport/AirportController').default; // eslint-disable-line import/order

const argValue = (name, fallback) => {
    const index = process.argv.indexOf(name);

    return index === -1 ? fallback : process.argv[index + 1];
};

const airport = argValue('--airport', 'lemd');
const seed = Number(argValue('--seed', 1));
const hours = Number(argValue('--hours', 4));
const everyMinutes = Number(argValue('--every', 20));

const sim = new HeadlessSimulator({ assetsPath: ASSETS_PATH });

sim.reset(airport, seed, { weather: 'dynamic' });

const { weather } = sim.aircraftController.realismController;
const totalSeconds = hours * 3600;

for (let time = 0; time <= totalSeconds; time += 60) {
    if (time % (everyMinutes * 60) === 0) {
        const airportModel = sim.botApi.getObservation().airport;
        const { state } = weather;

        console.log(`${String(Math.round(time / 60)).padStart(4)} min  ${weather.getMetar(AirportController.airport_get())}` +
            `  config ${airportModel.runwayConfiguration || '-'}  cells ${state.cells.map((cell) => `${cell.id}(i${cell.intensity} ` +
            `${Math.round(Math.hypot(cell.x, cell.y))}nm)`).join(' ') || '-'}${state.isLowVisibility ? '  LVP' : ''}`);
    }

    sim.step(60);
}

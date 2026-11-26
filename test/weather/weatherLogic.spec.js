import ava from 'ava';
import {
    APPROACH_CATEGORIES,
    EPISODES,
    WIND_EVOLUTION,
    buildMetar,
    ceilingForVisibility,
    cellAt,
    cellPolygon,
    createCell,
    createWeatherRandom,
    evolveWind,
    fogVisibility,
    isInsideCell,
    isLowVisibility,
    requiredCategory,
    windAtAltitude
} from '../../src/assets/scripts/client/weather/weatherLogic';

// MET-002
ava('wind at the surface is the surface wind', (t) => {
    t.deepEqual(windAtAltitude({ angle: 270, speed: 10 }, 0), { angle: 270, speed: 10 });
});

ava('wind grows and veers with height', (t) => {
    const low = windAtAltitude({ angle: 270, speed: 10 }, 2000);
    const high = windAtAltitude({ angle: 270, speed: 10 }, 30000);

    t.is(low.angle, 290);
    t.is(low.speed, 16);
    t.is(high.angle, 315);
    t.is(high.speed, 65);
});

ava('wind is interpolated between levels and calm stays calm', (t) => {
    const between = windAtAltitude({ angle: 0, speed: 10 }, 1000);

    t.is(between.angle, 10);
    t.true(between.speed > 10 && between.speed < 16);
    t.is(windAtAltitude({ angle: 90, speed: 0 }, 20000).speed, 0);
});

// MET-003
ava('wind evolution stays within its bounds and reports gusts in strong wind', (t) => {
    const random = createWeatherRandom(1);
    const initial = { angle: 350, speed: 18 };
    let wind = { ...initial };

    for (let minute = 0; minute < 600; minute++) {
        wind = evolveWind(wind, initial, random);

        const drift = Math.abs(((wind.angle - initial.angle + 540) % 360) - 180);

        t.true(drift <= WIND_EVOLUTION.MAX_DIRECTION_DRIFT_DEG + 1e-9);
        t.true(Math.abs(wind.speed - initial.speed) <= WIND_EVOLUTION.MAX_SPEED_DRIFT_KT + 1e-9);

        if (wind.speed >= WIND_EVOLUTION.GUST_THRESHOLD_KT) {
            t.true(wind.gust >= wind.speed + WIND_EVOLUTION.GUST_MIN_KT - 1);
        }
    }
});

ava('the weather random generator is deterministic', (t) => {
    const first = createWeatherRandom(42);
    const second = createWeatherRandom(42);

    t.deepEqual([first(), first(), first()], [second(), second(), second()]);
});

// MET-005
ava('fog lowers the visibility, stays, and lifts', (t) => {
    const episode = { start: 1000, duration: 3600, minimumVisibility: 300 };

    t.is(fogVisibility(episode, 500, 10000), 10000);
    t.true(fogVisibility(episode, 1000 + EPISODES.FOG_ONSET_SECONDS / 2, 10000) < 10000);
    t.is(fogVisibility(episode, 2500, 10000), 300);
    t.is(fogVisibility(episode, 1000 + 3600 + 1, 10000), 10000);
});

ava('low visibility procedures and ceiling', (t) => {
    t.is(ceilingForVisibility(9999), null);
    t.is(ceilingForVisibility(500), 100);
    t.true(isLowVisibility(400, null));
    t.false(isLowVisibility(2000, 1500));
    t.true(isLowVisibility(2000, 100));
});

// MET-001
ava('approach category needed for an RVR', (t) => {
    t.is(requiredCategory(800, ['I']), 'I');
    t.is(requiredCategory(400, ['I']), null);
    t.is(requiredCategory(400, ['I', 'II']), 'II');
    t.is(requiredCategory(200, ['I', 'II', 'IIIA']), 'IIIA');
    t.is(APPROACH_CATEGORIES.I.decisionHeightFt, 200);
});

// MET-006, MET-007
ava('a thunderstorm cell grows, drifts with the wind and dies', (t) => {
    const cell = createCell(createWeatherRandom(3), 0, { angle: 270, speed: 30 });

    t.is(cellAt(cell, -1), null);
    t.true(cellAt(cell, EPISODES.CELL_GROWTH_SECONDS).intensity >= cellAt(cell, 10).intensity);
    // a westerly wind takes it east
    t.true(cellAt(cell, 1200).x > cell.x);
    t.is(cellAt(cell, cell.life + 1), null);
});

ava('inside a cell means within its radius and below its top', (t) => {
    const cell = {
        x: 10, y: 0, radius: 4, top: 35000, intensity: 4
    };

    t.true(isInsideCell({ x: 11, y: 1 }, 20000, cell));
    t.false(isInsideCell({ x: 11, y: 1 }, 37000, cell));
    t.false(isInsideCell({ x: 20, y: 0 }, 20000, cell));
    t.false(isInsideCell({ x: 11, y: 1 }, 20000, { ...cell, intensity: 2 }));
});

ava('the cell polygon contains the whole circle', (t) => {
    const polygon = cellPolygon({ x: 0, y: 0, radius: 5 });

    t.is(polygon.length, 8);
    polygon.forEach((point) => t.true(Math.hypot(point.x, point.y) >= 5));
});

// MET-008
ava('METAR text', (t) => {
    const date = new Date(Date.UTC(2026, 10, 20, 9, 30));
    const clear = buildMetar('lemd', {
        wind: { angle: 323, speed: 12, gust: null }, visibility: 10000, ceiling: null, temperature: 14, dewPoint: 8, qnh: 1018
    }, date);
    const fog = buildMetar('lemd', {
        wind: { angle: 0, speed: 0, gust: null }, visibility: 300, ceiling: 0, temperature: -2, dewPoint: -2, qnh: 1025
    }, date);

    t.is(clear, 'METAR LEMD 200930Z 32012KT 9999 NSC 14/08 Q1018');
    t.is(fog, 'METAR LEMD 200930Z 00000KT 0300 FG VV001 M02/M02 Q1025');
});

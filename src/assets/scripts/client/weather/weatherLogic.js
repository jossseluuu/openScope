/**
 * Pure logic of the dynamic weather (rules MET-* in docs/especificacion/reglas.yaml).
 *
 * Positions in nm relative to the airport (x east, y north), altitudes in ft, wind directions in degrees
 * (where the wind comes from, true), speeds in knots, visibility in metres.
 */

/**
 * Small deterministic random generator (mulberry32): the weather has its own, seeded from the episode
 * (seed + 8800), so turning it on or off does not change the traffic
 *
 * @function createWeatherRandom
 * @param seed {number}
 * @return {function} numbers in [0, 1)
 */
/* eslint-disable no-bitwise */
export function createWeatherRandom(seed) {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6D2B79F5) | 0;

        let t = state;

        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/* eslint-enable no-bitwise */

/**
 * Vertical wind profile (MET-002): at each level the speed is `surface × factor + add` and the direction
 * veers clockwise with height (friction backs the surface wind in the boundary layer, northern hemisphere)
 *
 * @property WIND_PROFILE
 * @type {array<object>}
 * @final
 */
export const WIND_PROFILE = [
    {
        altitude: 0, factor: 1, add: 0, veer: 0
    },
    {
        altitude: 2000, factor: 1.3, add: 3, veer: 20
    },
    {
        altitude: 5000, factor: 1.4, add: 8, veer: 30
    },
    {
        altitude: 10000, factor: 1.2, add: 18, veer: 35
    },
    {
        altitude: 18000, factor: 1.1, add: 32, veer: 40
    },
    {
        altitude: 24000, factor: 1, add: 45, veer: 45
    },
    {
        altitude: 30000, factor: 1, add: 55, veer: 45
    },
    {
        altitude: 39000, factor: 1, add: 50, veer: 45
    }
];

/**
 * Limits of the wind evolution (MET-003)
 *
 * @property WIND_EVOLUTION
 * @type {object}
 * @final
 */
export const WIND_EVOLUTION = {
    // random walk per minute, bounded around the initial wind
    DIRECTION_STEP_DEG: 2,
    SPEED_STEP_KT: 0.6,
    MAX_DIRECTION_DRIFT_DEG: 40,
    MAX_SPEED_DRIFT_KT: 10,
    // gusts reported above this mean speed, 5 to 15 kt above it
    GUST_THRESHOLD_KT: 15,
    GUST_MIN_KT: 5,
    GUST_MAX_KT: 15
};

/**
 * Instrument approach categories (MET-001): decision height and minimum RVR
 *
 * @property APPROACH_CATEGORIES
 * @type {object}
 * @final
 */
export const APPROACH_CATEGORIES = {
    I: { decisionHeightFt: 200, rvrM: 550 },
    II: { decisionHeightFt: 100, rvrM: 300 },
    IIIA: { decisionHeightFt: 50, rvrM: 175 },
    IIIB: { decisionHeightFt: 20, rvrM: 50 }
};

/**
 * Low visibility procedures (MET-004): from this RVR or ceiling; final approach spacing in LVP
 *
 * @property LVP
 * @type {object}
 * @final
 */
export const LVP = {
    RVR_M: 550,
    CEILING_FT: 200,
    FINAL_SPACING_NM: 4
};

/**
 * Fog and thunderstorm episodes (MET-005, MET-006)
 *
 * @property EPISODES
 * @type {object}
 * @final
 */
export const EPISODES = {
    DEFAULT_FOG_PER_HOUR: 0.05,
    DEFAULT_THUNDERSTORMS_PER_HOUR: 0.15,
    FOG_ONSET_SECONDS: 900,
    FOG_MIN_DURATION_SECONDS: 1800,
    FOG_MAX_DURATION_SECONDS: 3600,
    FOG_MIN_VISIBILITY_M: 150,
    FOG_MAX_VISIBILITY_M: 800,
    CELL_MIN_RADIUS_NM: 3,
    CELL_MAX_RADIUS_NM: 6,
    CELL_MIN_DISTANCE_NM: 15,
    CELL_MAX_DISTANCE_NM: 40,
    CELL_GROWTH_SECONDS: 900,
    CELL_MIN_LIFE_SECONDS: 2700,
    CELL_MAX_LIFE_SECONDS: 5400,
    CELL_MIN_TOP_FT: 30000,
    CELL_MAX_TOP_FT: 45000,
    // radar intensity (1-6) from which aircraft must not enter (MET-007)
    AVOID_INTENSITY: 3
};

const normalizeDegrees = (degrees) => ((degrees % 360) + 360) % 360;

/**
 * Wind at an altitude above the airport from the surface wind (MET-002), linear between profile levels
 *
 * @function windAtAltitude
 * @param surface {object} `{ angle, speed }` degrees, knots
 * @param heightAboveAirport {number} ft
 * @return {object} `{ angle, speed }`
 */
export function windAtAltitude(surface, heightAboveAirport) {
    const height = Math.max(0, heightAboveAirport);
    let upperIndex = WIND_PROFILE.findIndex((level) => level.altitude >= height);

    if (upperIndex === -1) {
        upperIndex = WIND_PROFILE.length - 1;
    }

    const lower = WIND_PROFILE[Math.max(0, upperIndex - 1)];
    const upper = WIND_PROFILE[upperIndex];
    const span = upper.altitude - lower.altitude;
    const fraction = span > 0 ? Math.min(1, (height - lower.altitude) / span) : 0;
    const levelValue = (level) => ({
        speed: surface.speed * level.factor + (surface.speed > 0 ? level.add : 0),
        veer: level.veer
    });
    const a = levelValue(lower);
    const b = levelValue(upper);

    return {
        angle: normalizeDegrees(surface.angle + a.veer + (b.veer - a.veer) * fraction),
        speed: a.speed + (b.speed - a.speed) * fraction
    };
}

/**
 * One minute of wind evolution: bounded random walk around the initial wind (MET-003)
 *
 * @function evolveWind
 * @param wind {object} `{ angle, speed }` current surface wind
 * @param initial {object} `{ angle, speed }` wind the airport started with
 * @param random {function}
 * @return {object} `{ angle, speed, gust }`
 */
export function evolveWind(wind, initial, random) {
    const directionDrift = ((wind.angle - initial.angle + 540) % 360) - 180;
    let drift = directionDrift + (random() * 2 - 1) * WIND_EVOLUTION.DIRECTION_STEP_DEG;
    let speed = wind.speed + (random() * 2 - 1) * WIND_EVOLUTION.SPEED_STEP_KT;

    drift = Math.max(-WIND_EVOLUTION.MAX_DIRECTION_DRIFT_DEG, Math.min(WIND_EVOLUTION.MAX_DIRECTION_DRIFT_DEG, drift));
    speed = Math.max(0, Math.max(initial.speed - WIND_EVOLUTION.MAX_SPEED_DRIFT_KT,
        Math.min(initial.speed + WIND_EVOLUTION.MAX_SPEED_DRIFT_KT, speed)));

    const gust = speed >= WIND_EVOLUTION.GUST_THRESHOLD_KT ?
        Math.round(speed + WIND_EVOLUTION.GUST_MIN_KT + random() * (WIND_EVOLUTION.GUST_MAX_KT - WIND_EVOLUTION.GUST_MIN_KT)) :
        null;

    return { angle: normalizeDegrees(initial.angle + drift), speed, gust };
}

/**
 * Visibility during a fog episode: falls to the minimum over the onset, stays, then lifts over the onset
 *
 * @function fogVisibility
 * @param episode {object} `{ start, duration, minimumVisibility }` seconds, metres
 * @param time {number}
 * @param clearVisibility {number} metres outside fog
 * @return {number} metres
 */
export function fogVisibility(episode, time, clearVisibility) {
    if (!episode || time < episode.start || time > episode.start + episode.duration) {
        return clearVisibility;
    }

    const elapsed = time - episode.start;
    const remaining = episode.start + episode.duration - time;
    const onset = Math.min(EPISODES.FOG_ONSET_SECONDS, episode.duration / 2);
    const fraction = Math.min(1, elapsed / onset, remaining / onset);

    return Math.round(clearVisibility - (clearVisibility - episode.minimumVisibility) * fraction);
}

/**
 * Cloud ceiling that goes with a visibility: low stratus in fog (MET-005)
 *
 * @function ceilingForVisibility
 * @param visibility {number} metres
 * @return {number|null} ft, null = no ceiling
 */
export function ceilingForVisibility(visibility) {
    if (visibility >= 5000) {
        return null;
    }

    return Math.max(0, Math.round(visibility / 5 / 100) * 100);
}

/**
 * Whether low visibility procedures apply (MET-004)
 *
 * @function isLowVisibility
 */
export function isLowVisibility(visibility, ceiling) {
    return visibility < LVP.RVR_M || (ceiling !== null && ceiling < LVP.CEILING_FT);
}

/**
 * Lowest approach category that allows a landing with this RVR, or null if none of those available
 *
 * @function requiredCategory
 * @param rvr {number} metres
 * @param available {array<string>} categories of the runway, e.g. `['I', 'II', 'IIIA']`
 * @return {string|null}
 */
export function requiredCategory(rvr, available) {
    const order = ['I', 'II', 'IIIA', 'IIIB'];

    return order.find((category) => available.includes(category) && rvr >= APPROACH_CATEGORIES[category].rvrM) || null;
}

/**
 * Thunderstorm cell at a moment of its life: growth, mature, decay (MET-006)
 *
 * @function cellAt
 * @param cell {object} `{ x, y, vx, vy, radius, top, peakIntensity, born, life }`
 * @param time {number}
 * @return {object|null} `{ x, y, radius, top, intensity }`, null before birth or after death
 */
export function cellAt(cell, time) {
    const age = time - cell.born;

    if (age < 0 || age > cell.life) {
        return null;
    }

    const growth = Math.min(1, age / EPISODES.CELL_GROWTH_SECONDS);
    const decay = Math.min(1, (cell.life - age) / EPISODES.CELL_GROWTH_SECONDS);
    const strength = Math.min(growth, decay);

    return {
        x: cell.x + cell.vx * age,
        y: cell.y + cell.vy * age,
        radius: cell.radius * (0.5 + 0.5 * strength),
        top: cell.top,
        intensity: Math.max(1, Math.round(cell.peakIntensity * strength))
    };
}

/**
 * A new thunderstorm cell somewhere around the airport, drifting with the wind at 10 000 ft
 *
 * @function createCell
 * @param random {function}
 * @param time {number}
 * @param steeringWind {object} `{ angle, speed }` wind the cell drifts with
 * @return {object}
 */
export function createCell(random, time, steeringWind) {
    const bearing = random() * 2 * Math.PI;
    const distance = EPISODES.CELL_MIN_DISTANCE_NM + random() * (EPISODES.CELL_MAX_DISTANCE_NM - EPISODES.CELL_MIN_DISTANCE_NM);
    // the wind comes from `angle`: the cell moves towards angle + 180
    const toward = ((steeringWind.angle + 180) * Math.PI) / 180;
    const speedNmPerSecond = (steeringWind.speed * 0.8) / 3600;

    return {
        id: `CB${Math.floor(time)}${Math.floor(random() * 100)}`,
        x: Math.sin(bearing) * distance,
        y: Math.cos(bearing) * distance,
        vx: Math.sin(toward) * speedNmPerSecond,
        vy: Math.cos(toward) * speedNmPerSecond,
        radius: EPISODES.CELL_MIN_RADIUS_NM + random() * (EPISODES.CELL_MAX_RADIUS_NM - EPISODES.CELL_MIN_RADIUS_NM),
        top: Math.round((EPISODES.CELL_MIN_TOP_FT + random() * (EPISODES.CELL_MAX_TOP_FT - EPISODES.CELL_MIN_TOP_FT)) / 1000) * 1000,
        peakIntensity: 3 + Math.floor(random() * 3),
        born: time,
        life: EPISODES.CELL_MIN_LIFE_SECONDS + random() * (EPISODES.CELL_MAX_LIFE_SECONDS - EPISODES.CELL_MIN_LIFE_SECONDS)
    };
}

/**
 * Whether a point at an altitude is inside a cell that must be avoided
 *
 * @function isInsideCell
 */
export function isInsideCell(point, altitude, cellNow) {
    return Boolean(cellNow) && cellNow.intensity >= EPISODES.AVOID_INTENSITY && altitude < cellNow.top &&
        Math.hypot(point.x - cellNow.x, point.y - cellNow.y) < cellNow.radius;
}

/**
 * Octagon around a cell, for the bots (as a restricted area) and the scope
 *
 * @function cellPolygon
 * @param cellNow {object}
 * @param margin {number} nm added to the radius
 * @return {array<object>} `[{ x, y }]`
 */
export function cellPolygon(cellNow, margin = 0) {
    const radius = (cellNow.radius + margin) / Math.cos(Math.PI / 8);

    return Array.from({ length: 8 }, (value, index) => {
        const angle = (index * Math.PI) / 4 + Math.PI / 8;

        return { x: cellNow.x + Math.sin(angle) * radius, y: cellNow.y + Math.cos(angle) * radius };
    });
}

const pad = (number, length) => String(Math.round(number)).padStart(length, '0');

/**
 * METAR text of the weather state (MET-008)
 *
 * @function buildMetar
 * @param icao {string}
 * @param state {object} `{ wind: { angle, speed, gust }, visibility, ceiling, temperature, dewPoint, qnh,
 *   thunderstorm }`
 * @param time {Date}
 * @return {string}
 */
export function buildMetar(icao, state, time) {
    const { wind } = state;
    const windText = wind.speed < 1 ?
        '00000KT' :
        `${pad(Math.round(wind.angle / 10) * 10 || 360, 3)}${pad(wind.speed, 2)}${wind.gust ? `G${pad(wind.gust, 2)}` : ''}KT`;
    const visibilityText = state.visibility >= 10000 ? '9999' : pad(Math.floor(state.visibility / 50) * 50, 4);
    const parts = [
        'METAR',
        icao.toUpperCase(),
        `${pad(time.getUTCDate(), 2)}${pad(time.getUTCHours(), 2)}${pad(time.getUTCMinutes(), 2)}Z`,
        windText,
        visibilityText
    ];

    if (state.visibility < 1000) {
        parts.push('FG');
    } else if (state.visibility < 5000) {
        parts.push('BR');
    }

    if (state.thunderstorm) {
        parts.push('VCTS');
    }

    if (state.ceiling !== null && state.ceiling !== undefined) {
        parts.push(state.ceiling < 100 ? 'VV001' : `OVC${pad(state.ceiling / 100, 3)}`);
    } else if (state.thunderstorm) {
        parts.push('FEW040CB');
    } else {
        parts.push('NSC');
    }

    const temperature = (value) => (value < 0 ? `M${pad(-value, 2)}` : pad(value, 2));

    parts.push(`${temperature(state.temperature)}/${temperature(state.dewPoint)}`, `Q${pad(state.qnh, 4)}`);

    return parts.join(' ');
}

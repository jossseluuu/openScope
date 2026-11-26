/* eslint-disable no-console */ // development tool
/**
 * Converts the old map format of openScope (`"maps": { "base": [lines] }`, no `defaultMaps`) into the
 * current one (`"maps": [{ "name", "lines" }]` + `"defaultMaps"`). Airports without `maps` get an empty
 * "Base Map", which the engine accepts.
 *
 * Usage:
 *   node tools/validate/convert-old-maps.js [icao ...]          dry run: what would change and what the
 *                                                                validator would still report
 *   node tools/validate/convert-old-maps.js [icao ...] --write  rewrite the files (4-space JSON)
 *
 * Without ICAO codes it takes every airport disabled in airportLoadList.json. It never enables an
 * airport: that is done by hand once it passes the validator and flies (`check-airports.js`).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const AIRPORTS_DIR = path.join(ROOT, 'assets', 'airports');
const BASE_MAP_NAME = 'Base Map';

/**
 * Convert the `maps` of an airport object in place
 *
 * @function convertMaps
 * @param airport {object}
 * @return {string|null} description of the change, null when it already has the current format
 */
function convertMaps(airport) {
    if (Array.isArray(airport.maps) && Array.isArray(airport.defaultMaps)) {
        return null;
    }

    if (Array.isArray(airport.maps)) {
        airport.defaultMaps = airport.maps.length > 0 ? [airport.maps[0].name] : [BASE_MAP_NAME];

        if (airport.maps.length === 0) {
            airport.maps = [{ name: BASE_MAP_NAME, lines: [] }];
        }

        return 'añadido defaultMaps';
    }

    const oldMaps = airport.maps && typeof airport.maps === 'object' ? airport.maps : {};
    const entries = Object.entries(oldMaps).filter(([, lines]) => Array.isArray(lines));
    const nameOf = (key) => (key === 'base' ? BASE_MAP_NAME : key);

    airport.maps = entries.length > 0 ?
        entries.map(([key, lines]) => ({ name: nameOf(key), lines })) :
        [{ name: BASE_MAP_NAME, lines: [] }];
    airport.defaultMaps = [airport.maps[0].name];

    return entries.length > 0 ?
        `maps{} → maps[] (${entries.map(([key, lines]) => `${nameOf(key)}: ${lines.length} líneas`).join(', ')})` :
        'sin mapas: añadido un "Base Map" vacío';
}

/**
 * JSON with 4-space indentation and arrays of plain values on one line, as the airport files are written
 *
 * @function stringifyAirport
 */
function stringifyAirport(value, indent = '') {
    const inner = `${indent}    `;

    if (Array.isArray(value)) {
        if (value.every((item) => item === null || typeof item !== 'object')) {
            return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
        }

        if (value.length === 0) {
            return '[]';
        }

        const items = value.map((item) => `${inner}${stringifyAirport(item, inner)}`);

        return `[\n${items.join(',\n')}\n${indent}]`;
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value);

        if (entries.length === 0) {
            return '{}';
        }

        const items = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${stringifyAirport(item, inner)}`);

        return `{\n${items.join(',\n')}\n${indent}}`;
    }

    return JSON.stringify(value);
}

/**
 * Put `maps` and `defaultMaps` where the current airports have them (after `airspace`) without
 * reordering the other keys
 *
 * @function withMapsInPlace
 */
function withMapsInPlace(airport) {
    const { maps, defaultMaps, ...rest } = airport;
    const result = {};
    let placed = false;

    Object.entries(rest).forEach(([key, value]) => {
        result[key] = value;

        if (key === 'airspace') {
            result.maps = maps;
            result.defaultMaps = defaultMaps;
            placed = true;
        }
    });

    if (!placed) {
        result.maps = maps;
        result.defaultMaps = defaultMaps;
    }

    return result;
}

function main() {
    const args = process.argv.slice(2);
    const write = args.includes('--write');
    const loadList = JSON.parse(fs.readFileSync(path.join(AIRPORTS_DIR, 'airportLoadList.json'), 'utf8'));
    const requested = args.filter((arg) => !arg.startsWith('--')).map((icao) => icao.toLowerCase());
    const targets = requested.length > 0 ? requested : loadList.filter((entry) => entry.disabled).map((entry) => entry.icao);
    const changed = [];

    targets.forEach((icao) => {
        const file = path.join(AIRPORTS_DIR, `${icao}.json`);
        const airport = JSON.parse(fs.readFileSync(file, 'utf8'));
        const change = convertMaps(airport);

        if (!change) {
            return;
        }

        changed.push(icao);
        console.log(`${icao}: ${change}`);

        if (write) {
            fs.writeFileSync(file, `${JSON.stringify(withMapsInPlace(airport), null, 4)}\n`);
        }
    });

    if (!write || changed.length === 0) {
        console.log(`\n${changed.length} aeropuertos por convertir${write ? '' : ' (prueba: añade --write)'}`);

        return;
    }

    console.log('\nValidador tras la conversión:');

    try {
        console.log(execFileSync(process.execPath, [path.join(__dirname, 'validate-airports.js'), '--quiet', ...changed], {
            encoding: 'utf8'
        }));
    } catch (error) {
        // exit code 1 when some airport still has errors: show the report anyway
        console.log(error.stdout);
    }
}

if (require.main === module) {
    main();
}

module.exports = { convertMaps, stringifyAirport };

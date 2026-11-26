/**
 * Light structural check of an airport JSON before the engine builds it (validator rule set in
 * `tools/validate/`, which uses ajv and is too heavy for the client). It only looks at what would
 * break the load or leave the airport unplayable, and reports it in Spanish so a broken airport shows a
 * readable message instead of an exception half way through the airport change.
 *
 * @function findAirportJsonProblems
 * @param json {object} airport JSON
 * @return {array<string>} problems, empty when the airport can be loaded
 */
export function findAirportJsonProblems(json) {
    const problems = [];

    if (!json || typeof json !== 'object') {
        return ['el archivo no es un objeto JSON'];
    }

    if (typeof json.icao !== 'string' || json.icao.length === 0) {
        problems.push('falta "icao"');
    }

    if (!Array.isArray(json.position) || json.position.length < 2) {
        problems.push('falta "position" (latitud y longitud)');
    }

    if (!Array.isArray(json.runways) || json.runways.length === 0) {
        problems.push('no hay pistas ("runways")');
    } else {
        json.runways.forEach((pair, index) => {
            if (!pair || !Array.isArray(pair.name) || pair.name.length !== 2 || !Array.isArray(pair.end) || pair.end.length !== 2) {
                problems.push(`la pista ${index} necesita "name" y "end" con dos extremos`);
            }
        });
    }

    if (!Array.isArray(json.airspace) || json.airspace.length === 0) {
        problems.push('no hay espacio aéreo ("airspace")');
    } else {
        json.airspace.forEach((sector, index) => {
            if (!sector || !Array.isArray(sector.poly) || sector.poly.length < 3) {
                problems.push(`el sector ${index} del espacio aéreo necesita un polígono de al menos 3 puntos`);
            } else if (sector.floor > sector.ceiling) {
                problems.push(`el sector ${index} del espacio aéreo tiene el suelo por encima del techo`);
            }
        });
    }

    if (!Array.isArray(json.maps)) {
        problems.push('"maps" tiene el formato antiguo (objeto): ver tools/validate/convert-old-maps.js');
    } else if (!Array.isArray(json.defaultMaps) || json.defaultMaps.length === 0) {
        problems.push('falta "defaultMaps"');
    } else {
        const names = json.maps.map((map) => map && map.name);
        const missing = json.defaultMaps.filter((name) => !names.includes(name));

        if (missing.length > 0) {
            problems.push(`los mapas por defecto ${missing.join(', ')} no existen en "maps"`);
        }
    }

    if (!Array.isArray(json.spawnPatterns)) {
        problems.push('falta "spawnPatterns"');
    } else {
        json.spawnPatterns.forEach((pattern, index) => {
            const airlines = pattern && pattern.airlines;

            if (!Array.isArray(airlines) || airlines.length === 0 ||
                airlines.some((entry) => !Array.isArray(entry) || entry.length < 2 || !(entry[1] > 0))) {
                problems.push(`el spawn pattern ${index} necesita aerolíneas con peso ([icao, peso])`);
            }
        });
    }

    return problems;
}

export default findAirportJsonProblems;

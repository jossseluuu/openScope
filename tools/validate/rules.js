/* eslint-disable no-continue */
/**
 * Coherence rules for airport files, run after the JSON schema
 * (`assets/airports/schema/airport.schema.json`) has checked the structure.
 *
 * Each rule has an id (`AP-xxx`), a severity (`error` stops the airport from loading in CI and
 * should be fixed, `warning` is reported only) and a `check(airport, context)` that returns a list
 * of `{ path, message }`. Messages are in Spanish, like the rest of the user documentation.
 *
 * The rules only read the JSON; they never load the airport into the engine (the headless check,
 * `tools/sim/check-airports.js`, does that).
 */
const fs = require('fs');
const path = require('path');

const { parseCoordinate } = require('../../src/assets/scripts/client/utilities/unitConverters');

const EARTH_RADIUS_NM = 3440.065;

/**
 * Name of the fix in a procedure leg, or null when the leg is not a fix (a heading `#270`)
 *
 * @function fixNameOfLeg
 * @param leg {string|array<string>}
 * @return {string|null}
 */
function fixNameOfLeg(leg) {
    const text = Array.isArray(leg) ? leg[0] : leg;

    if (typeof text !== 'string' || text.length === 0 || text[0] === '#') {
        return null;
    }

    // ^ fly-over, @ hold
    return text.replace(/^[\^@]+/, '');
}

function segmentsOf(procedure, keys) {
    const segments = [];

    keys.forEach((key) => {
        const value = procedure[key];

        if (Array.isArray(value)) {
            segments.push({ key, legs: value });
        } else if (value && typeof value === 'object') {
            Object.entries(value).forEach(([name, legs]) => segments.push({ key: `${key}/${name}`, legs }));
        }
    });

    return segments;
}

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function positionOf(latLon) {
    return { lat: parseCoordinate(latLon[0]), lon: parseCoordinate(latLon[1]) };
}

function distanceNm(a, b) {
    const dLat = toRadians(b.lat - a.lat);
    const dLon = toRadians(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDegrees(a, b) {
    const y = Math.sin(toRadians(b.lon - a.lon)) * Math.cos(toRadians(b.lat));
    const x = Math.cos(toRadians(a.lat)) * Math.sin(toRadians(b.lat)) -
        Math.sin(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.cos(toRadians(b.lon - a.lon));

    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDifference(a, b) {
    const difference = Math.abs(a - b) % 360;

    return difference > 180 ? 360 - difference : difference;
}

/**
 * Whether segments p1-p2 and p3-p4 cross (shared end points do not count)
 *
 * @function segmentsCross
 * @return {boolean}
 */
function segmentsCross(p1, p2, p3, p4) {
    const orientation = (a, b, c) => Math.sign((b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon));
    const o1 = orientation(p1, p2, p3);
    const o2 = orientation(p1, p2, p4);
    const o3 = orientation(p3, p4, p1);
    const o4 = orientation(p3, p4, p2);

    return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Runway names of a pair, and the runway a SID/STAR `rwy` key refers to (`KSEA16L` -> `16L`)
 *
 * @function runwayOfProcedureKey
 */
function runwayOfProcedureKey(key, icao) {
    return key.toUpperCase().startsWith(icao) ? key.slice(icao.length) : key;
}

function allRunwayNames(airport) {
    return new Set(airport.runways.flatMap((pair) => pair.name));
}

/**
 * Local flat projection in nm around a reference latitude (good enough for a TMA)
 *
 * @function toLocalNm
 */
function toLocalNm(point, referenceLat) {
    return { x: Number(point.lon) * 60 * Math.cos(toRadians(referenceLat)), y: Number(point.lat) * 60 };
}

/**
 * Whether a point is inside a polygon (ray casting on the local projection)
 *
 * @function isInsidePolygon
 * @param point {object} {lat, lon}
 * @param polygon {array<object>} [{lat, lon}]
 * @return {boolean}
 */
function isInsidePolygon(point, polygon) {
    const p = toLocalNm(point, point.lat);
    const vertices = polygon.map((vertex) => toLocalNm(vertex, point.lat));
    let inside = false;

    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
        const a = vertices[i];
        const b = vertices[j];

        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * Whether segment a-b goes through a polygon (an end inside, or crossing an edge)
 *
 * @function segmentEntersPolygon
 */
function segmentEntersPolygon(a, b, polygon) {
    if (isInsidePolygon(a, polygon) || isInsidePolygon(b, polygon)) {
        return true;
    }

    return polygon.some((vertex, i) => segmentsCross(a, b, vertex, polygon[(i + 1) % polygon.length]));
}

/**
 * Lowest altitude in ft of a spawn pattern (`altitude` may be a number, a numeric text or [min, max])
 *
 * @function lowestSpawnAltitudeFt
 */
function lowestSpawnAltitudeFt(altitude) {
    const values = (Array.isArray(altitude) ? altitude : [altitude]).map(Number).filter((value) => Number.isFinite(value));

    return values.length > 0 ? Math.min(...values) : null;
}

/**
 * Lowest altitude in ft a procedure leg restriction lets the aircraft fly at (`A70+`, `A70`, `A70-`,
 * `A70+|A100-`), null without an altitude restriction. `A70-` alone counts as 7000 ft: the procedure
 * expects about that
 *
 * @function lowestRestrictionAltitudeFt
 */
function lowestRestrictionAltitudeFt(leg) {
    if (!Array.isArray(leg) || typeof leg[1] !== 'string') {
        return null;
    }

    const altitudes = leg[1].split('|')
        .map((part) => part.trim().match(/^A(?:FL)?(\d+)([+-]?)$/i))
        .filter(Boolean)
        .map((match) => ({ feet: Number(match[1]) * 100, sign: match[2] }));

    if (altitudes.length === 0) {
        return null;
    }

    const floors = altitudes.filter((altitude) => altitude.sign !== '-');

    return Math.min(...(floors.length > 0 ? floors : altitudes).map((altitude) => altitude.feet));
}

/**
 * Restricted area ceiling in ft (`"5000ft"`, `"FL180"`, `"Infinity"`)
 *
 * @function restrictedCeilingFt
 */
function restrictedCeilingFt(height) {
    const text = String(height).trim();

    if (/^infinity$/i.test(text)) {
        return Infinity;
    }

    const flightLevel = text.match(/^FL(\d+)$/i);

    if (flightLevel) {
        return Number(flightLevel[1]) * 100;
    }

    const feet = parseFloat(text);

    return Number.isFinite(feet) ? feet : Infinity;
}

/**
 * Airspace sectors as {floorFt, ceilingFt, points}
 *
 * @function sectorsOf
 */
function sectorsOf(airport) {
    return airport.airspace.map((sector) => ({
        floorFt: sector.floor * 100,
        ceilingFt: sector.ceiling * 100,
        points: sector.poly.map(positionOf)
    }));
}

/**
 * Every leg of a STAR in flying order: each entry transition + body + each runway transition
 *
 * @function starLegSequences
 */
function starLegSequences(star) {
    const entries = segmentsOf(star, ['entryPoints']).map((segment) => segment.legs);
    const body = Array.isArray(star.body) ? star.body : [];
    const runways = segmentsOf(star, ['rwy']).map((segment) => segment.legs);
    const sequences = [];

    (entries.length > 0 ? entries : [[]]).forEach((entry) => {
        (runways.length > 0 ? runways : [[]]).forEach((runway) => sequences.push([...entry, ...body, ...runway]));
    });

    return sequences;
}

/**
 * Every rule, in report order
 *
 * @property RULES
 * @type {array<object>}
 */
const RULES = [
    {
        id: 'AP-001',
        severity: 'error',
        description: 'El nombre del archivo coincide con el ICAO y el aeropuerto está en airportLoadList.json',
        check(airport, context) {
            const problems = [];

            if (airport.icao.toLowerCase() !== context.fileIcao) {
                problems.push({ path: '/icao', message: `el ICAO ${airport.icao} no coincide con el archivo ${context.fileIcao}.json` });
            }

            if (!context.loadListEntry) {
                problems.push({ path: '', message: `${context.fileIcao} no está en airportLoadList.json` });
            }

            return problems;
        }
    },
    {
        id: 'AP-002',
        severity: 'error',
        description: 'Cada par de pistas tiene nombres recíprocos (18 de diferencia, L↔R, C↔C) y umbrales distintos',
        check(airport) {
            const problems = [];
            const opposite = {
                L: 'R', R: 'L', C: 'C', '': ''
            };

            airport.runways.forEach((pair, index) => {
                const [first, second] = pair.name.map((name) => name.match(/^(\d+)([LCR]?)$/));

                if (!first || !second) {
                    return;
                }

                const numberDifference = Math.abs(Number(first[1]) - Number(second[1]));

                if (numberDifference !== 18 || opposite[first[2]] !== second[2]) {
                    problems.push({
                        path: `/runways/${index}/name`,
                        message: `${pair.name[0]} y ${pair.name[1]} no son recíprocas`
                    });
                }

                const length = distanceNm(positionOf(pair.end[0]), positionOf(pair.end[1]));

                if (!(length > 0.1)) {
                    problems.push({
                        path: `/runways/${index}/end`,
                        message: `los umbrales de ${pair.name.join('/')} están a ${length.toFixed(2)} NM (¿coordenadas mal escritas?)`
                    });
                }
            });

            return problems;
        }
    },
    {
        id: 'AP-003',
        severity: 'error',
        description: 'Todo fijo usado en SID, STAR, aerovías y rutas de aparición existe en fixes',
        check(airport) {
            const fixes = new Set(Object.keys(airport.fixes));
            const missing = new Map();
            const note = (name, where) => {
                if (!fixes.has(name)) {
                    if (!missing.has(name)) {
                        missing.set(name, where);
                    }
                }
            };

            Object.entries(airport.sids).forEach(([name, sid]) => {
                segmentsOf(sid, ['rwy', 'body', 'exitPoints']).forEach(({ key, legs }) => {
                    legs.forEach((leg) => {
                        const fix = fixNameOfLeg(leg);

                        if (fix) {
                            note(fix, `/sids/${name}/${key}`);
                        }
                    });
                });
            });
            Object.entries(airport.stars || {}).forEach(([name, star]) => {
                segmentsOf(star, ['entryPoints', 'body', 'rwy']).forEach(({ key, legs }) => {
                    legs.forEach((leg) => {
                        const fix = fixNameOfLeg(leg);

                        if (fix) {
                            note(fix, `/stars/${name}/${key}`);
                        }
                    });
                });
            });
            Object.entries(airport.airways || {}).forEach(([name, list]) => {
                list.forEach((fix) => note(fix, `/airways/${name}`));
            });

            return [...missing.entries()].map(([fix, where]) => ({ path: where, message: `el fijo ${fix} no está definido` }));
        }
    },
    {
        id: 'AP-004',
        severity: 'error',
        description: 'Las pistas citadas (por defecto, configuraciones, rodaje, procedimientos) existen',
        check(airport) {
            const runways = allRunwayNames(airport);
            const problems = [];
            const expectRunway = (name, where) => {
                if (!runways.has(name)) {
                    problems.push({ path: where, message: `la pista ${name} no existe` });
                }
            };

            expectRunway(airport.arrivalRunway, '/arrivalRunway');
            expectRunway(airport.departureRunway, '/departureRunway');
            (airport.runwayConfigurations || []).forEach((configuration, index) => {
                expectRunway(configuration.arrivalRunway, `/runwayConfigurations/${index}/arrivalRunway`);
                expectRunway(configuration.departureRunway, `/runwayConfigurations/${index}/departureRunway`);
                configuration.runways.forEach((runway) => expectRunway(runway, `/runwayConfigurations/${index}/runways`));
            });
            Object.keys(airport.taxiTimes || {}).forEach((runway) => expectRunway(runway, '/taxiTimes'));
            Object.entries(airport.sids).forEach(([name, sid]) => {
                Object.keys(sid.rwy).forEach((key) => expectRunway(runwayOfProcedureKey(key, airport.icao), `/sids/${name}/rwy`));
            });
            Object.entries(airport.stars || {}).forEach(([name, star]) => {
                Object.keys(star.rwy).forEach((key) => expectRunway(runwayOfProcedureKey(key, airport.icao), `/stars/${name}/rwy`));
            });

            return problems;
        }
    },
    {
        id: 'AP-005',
        severity: 'error',
        description: 'Cada nombre de las rutas de aparición es un fijo, un procedimiento, una aerovía o un aeropuerto (con pista opcional)',
        check(airport) {
            const fixes = new Set(Object.keys(airport.fixes));
            const procedures = new Set([...Object.keys(airport.sids), ...Object.keys(airport.stars || {})]);
            const airways = new Set(Object.keys(airport.airways || {}));
            const runways = allRunwayNames(airport);
            const problems = [];

            airport.spawnPatterns.forEach((pattern, index) => {
                const airports = new Set([airport.icao, pattern.origin, pattern.destination]
                    .filter(Boolean).map((icao) => icao.toUpperCase()));
                // `LEMD`, or `LEMD32L` (airport followed by one of its runways)
                const isAirportToken = (token) => {
                    const upper = token.toUpperCase();

                    return airports.has(upper) ||
                        (airports.has(upper.slice(0, 4)) && runways.has(upper.slice(4)));
                };
                const unknown = new Set();

                pattern.route.split('.').filter(Boolean).forEach((token) => {
                    if (!fixes.has(token) && !procedures.has(token) && !airways.has(token) && !isAirportToken(token)) {
                        unknown.add(token);
                    }
                });

                unknown.forEach((token) => problems.push({
                    path: `/spawnPatterns/${index}/route`,
                    message: `"${token}" de la ruta "${pattern.route}" no es un fijo, procedimiento, aerovía ni aeropuerto conocido`
                }));
            });

            return problems;
        }
    },
    {
        id: 'AP-018',
        severity: 'error',
        description: 'En las rutas de aparición, la entrada y la salida de cada SID y STAR existen en el procedimiento',
        check(airport) {
            const problems = [];
            // what the engine accepts (ProcedureModel): SID entry = rwy key, exit = exitPoints key;
            // STAR entry = entryPoints key, exit = rwy key
            const ends = (procedure, isSid) => ({
                entries: Object.keys((isSid ? procedure.rwy : procedure.entryPoints) || {}),
                exits: Object.keys((isSid ? procedure.exitPoints : procedure.rwy) || {})
            });

            airport.spawnPatterns.forEach((pattern, index) => {
                // `..` is a direct leg; procedures appear as `ENTRY.PROCEDURE.EXIT` inside a segment
                pattern.route.split('..').forEach((segment) => {
                    const tokens = segment.split('.');

                    tokens.forEach((token, position) => {
                        const isSid = Object.prototype.hasOwnProperty.call(airport.sids, token);
                        const isStar = Object.prototype.hasOwnProperty.call(airport.stars || {}, token);

                        if (!isSid && !isStar) {
                            return;
                        }

                        const { entries, exits } = ends(isSid ? airport.sids[token] : airport.stars[token], isSid);
                        const entry = tokens[position - 1];
                        const exit = tokens[position + 1];
                        const path = `/spawnPatterns/${index}/route`;

                        if (entry && !entries.includes(entry)) {
                            problems.push({ path, message: `${token} no tiene la entrada ${entry} (tiene: ${entries.join(', ') || 'ninguna'})` });
                        }

                        if (exit && !exits.includes(exit)) {
                            problems.push({ path, message: `${token} no tiene la salida ${exit} (tiene: ${exits.join(', ') || 'ninguna'})` });
                        }
                    });
                });
            });

            return problems;
        }
    },
    {
        id: 'AP-006',
        severity: 'error',
        description: 'Las aerolíneas y flotas de los spawn patterns existen (con mayúsculas exactas)',
        check(airport, context) {
            const problems = [];

            airport.spawnPatterns.forEach((pattern, index) => {
                pattern.airlines.forEach(([reference]) => {
                    const [airlineId, fleet] = reference.split('/');
                    const airline = context.airline(airlineId);

                    if (!airline) {
                        problems.push({ path: `/spawnPatterns/${index}/airlines`, message: `la aerolínea ${airlineId} no existe en assets/airlines` });
                    } else if (fleet && !(airline.fleets && Object.prototype.hasOwnProperty.call(airline.fleets, fleet))) {
                        problems.push({ path: `/spawnPatterns/${index}/airlines`, message: `la flota ${fleet} no existe en ${airlineId} (distingue mayúsculas)` });
                    }
                });
            });

            return problems;
        }
    },
    {
        id: 'AP-007',
        severity: 'error',
        description: 'El suelo de cada sector de espacio aéreo no está por encima de su techo (igual: aviso, sector de grosor cero)',
        check(airport) {
            return airport.airspace
                .map((sector, index) => ({ sector, index }))
                .filter(({ sector }) => sector.floor >= sector.ceiling)
                .map(({ sector, index }) => ({
                    path: `/airspace/${index}`,
                    severity: sector.floor === sector.ceiling ? 'warning' : 'error',
                    message: sector.floor === sector.ceiling ?
                        `sector de grosor cero (suelo y techo FL${sector.floor})` :
                        `suelo FL${sector.floor} por encima del techo FL${sector.ceiling}`
                }));
        }
    },
    {
        id: 'AP-008',
        severity: 'warning',
        description: 'Los polígonos de espacio aéreo y de zonas restringidas no se cruzan consigo mismos',
        check(airport) {
            const problems = [];
            const checkPolygon = (poly, where) => {
                const points = poly.map(positionOf);
                const count = points.length;

                for (let i = 0; i < count; i++) {
                    for (let j = i + 2; j < count; j++) {
                        if (i === 0 && j === count - 1) {
                            continue;
                        }

                        if (segmentsCross(points[i], points[(i + 1) % count], points[j], points[(j + 1) % count])) {
                            problems.push({ path: where, message: `el polígono se cruza consigo mismo (lados ${i} y ${j})` });

                            return;
                        }
                    }
                }
            };

            airport.airspace.forEach((sector, index) => checkPolygon(sector.poly, `/airspace/${index}/poly`));
            (airport.restricted || []).forEach((area, index) => checkPolygon(area.poly, `/restricted/${index}/poly`));

            return problems;
        }
    },
    {
        id: 'AP-009',
        severity: 'error',
        description: 'Los mapas por defecto existen en maps',
        check(airport) {
            const names = new Set(airport.maps.map((map) => map.name));

            return airport.defaultMaps
                .filter((name) => !names.has(name))
                .map((name) => ({ path: '/defaultMaps', message: `el mapa "${name}" no existe en maps` }));
        }
    },
    {
        id: 'AP-010',
        severity: 'error',
        description: 'Existe el archivo de terreno cuando has_terrain es true',
        check(airport, context) {
            if (airport.has_terrain && !context.hasTerrainFile) {
                return [{ path: '/has_terrain', message: `falta assets/airports/terrain/${context.fileIcao}.geojson` }];
            }

            return [];
        }
    },
    {
        id: 'AP-011',
        severity: 'warning',
        description: 'Los aeropuertos españoles hacen entrar las llegadas escalonadas (arrivalSpawn)',
        check(airport) {
            if (!airport.icao.startsWith('LE')) {
                return [];
            }

            const spawn = airport.arrivalSpawn;

            if (!spawn || spawn.preSpawn !== false || !(spawn.minimumIntervalSeconds > 0)) {
                return [{ path: '/arrivalSpawn', message: 'falta arrivalSpawn con preSpawn false y minimumIntervalSeconds > 0' }];
            }

            return [];
        }
    },
    {
        id: 'AP-012',
        severity: 'warning',
        description: 'El icao de cada SID y STAR coincide con su clave',
        check(airport) {
            const problems = [];

            ['sids', 'stars'].forEach((kind) => {
                Object.entries(airport[kind] || {}).forEach(([key, procedure]) => {
                    if (procedure.icao !== key) {
                        problems.push({ path: `/${kind}/${key}/icao`, message: `icao "${procedure.icao}" distinto de la clave "${key}"` });
                    }
                });
            });

            return problems;
        }
    },
    {
        id: 'AP-013',
        severity: 'warning',
        description: 'El rumbo entre umbrales coincide con el nombre de la pista (±15°, ya corregido por la declinación)',
        check(airport) {
            const problems = [];

            airport.runways.forEach((pair, index) => {
                const number = Number(pair.name[0].match(/^\d+/)[0]);
                const trueBearing = bearingDegrees(positionOf(pair.end[0]), positionOf(pair.end[1]));
                const magneticBearing = (trueBearing - airport.magnetic_north + 360) % 360;
                const difference = angleDifference(magneticBearing, number * 10);

                if (difference > 15) {
                    problems.push({
                        path: `/runways/${index}`,
                        message: `${pair.name[0]} apunta a ${magneticBearing.toFixed(0)}° magnéticos (${difference.toFixed(0)}° de diferencia)`
                    });
                }
            });

            return problems;
        }
    },
    {
        id: 'AP-014',
        severity: 'warning',
        description: 'Las configuraciones de pista usadas en spawn patterns existen',
        check(airport) {
            const names = new Set((airport.runwayConfigurations || []).map((configuration) => configuration.name));

            return airport.spawnPatterns
                .map((pattern, index) => ({ pattern, index }))
                .filter(({ pattern }) => pattern.runwayConfiguration && !names.has(pattern.runwayConfiguration))
                .map(({ pattern, index }) => ({
                    path: `/spawnPatterns/${index}/runwayConfiguration`,
                    message: `la configuración "${pattern.runwayConfiguration}" no existe en runwayConfigurations`
                }));
        }
    },
    {
        id: 'AP-015',
        severity: 'warning',
        description: 'Una llegada que aparece dentro del espacio aéreo lo hace entre el suelo y el techo de algún sector',
        check(airport) {
            const problems = [];
            const sectors = sectorsOf(airport);

            airport.spawnPatterns.forEach((pattern, index) => {
                if (pattern.category !== 'arrival' || typeof pattern.route !== 'string') {
                    return;
                }

                const firstFix = pattern.route.split('.')[0];
                const coordinates = airport.fixes[firstFix];
                const altitude = lowestSpawnAltitudeFt(pattern.altitude);

                if (!coordinates) {
                    return; // AP-003/AP-005 report unknown fixes
                }

                const point = positionOf(coordinates);
                const containing = sectors.filter((sector) => isInsidePolygon(point, sector.points));

                if (containing.length === 0) {
                    return; // the engine lets arrivals start outside and fly in
                }

                if (altitude !== null && !containing.some((sector) => altitude >= sector.floorFt && altitude <= sector.ceilingFt)) {
                    const ranges = containing.map((sector) => `${sector.floorFt}-${sector.ceilingFt} ft`).join(', ');

                    problems.push({
                        path: `/spawnPatterns/${index}/altitude`,
                        message: `la llegada aparece en ${firstFix} a ${altitude} ft, fuera de los sectores de ese punto (${ranges})`
                    });
                }
            });

            return problems;
        }
    },
    {
        id: 'AP-016',
        severity: 'warning',
        description: 'Las restricciones de altitud de las STAR no quedan por debajo del suelo de los sectores en ese punto',
        check(airport) {
            const problems = [];
            const sectors = sectorsOf(airport);
            const reported = new Set();

            Object.entries(airport.stars || {}).forEach(([key, star]) => {
                starLegSequences(star).forEach((legs) => {
                    legs.forEach((leg) => {
                        const fix = fixNameOfLeg(leg);
                        const altitude = lowestRestrictionAltitudeFt(leg);

                        if (!fix || altitude === null || !airport.fixes[fix] || reported.has(`${key}/${fix}`)) {
                            return;
                        }

                        const point = positionOf(airport.fixes[fix]);
                        const containing = sectors.filter((sector) => isInsidePolygon(point, sector.points));

                        if (containing.length === 0 || containing.some((sector) => altitude >= sector.floorFt)) {
                            return;
                        }

                        reported.add(`${key}/${fix}`);
                        problems.push({
                            path: `/stars/${key}`,
                            message: `${fix} a ${altitude} ft queda por debajo del suelo del espacio aéreo en ese punto ` +
                                `(${Math.min(...containing.map((sector) => sector.floorFt))} ft)`
                        });
                    });
                });
            });

            return problems;
        }
    },
    {
        id: 'AP-017',
        severity: 'warning',
        description: 'Ningún tramo de STAR atraviesa una zona restringida por debajo de su techo',
        check(airport) {
            const problems = [];
            const areas = (airport.restricted || [])
                .map((area, index) => ({ area, index }))
                .filter(({ area }) => Array.isArray(area.poly) && area.poly.length >= 3)
                .map(({ area, index }) => ({
                    index,
                    name: area.name || `#${index}`,
                    ceilingFt: restrictedCeilingFt(area.height),
                    points: area.poly.map(positionOf)
                }));

            if (areas.length === 0) {
                return problems;
            }

            const crossings = new Map(); // area index -> names of the STARs that cross it

            Object.entries(airport.stars || {}).forEach(([key, star]) => {
                starLegSequences(star).forEach((legs) => {
                    let previous = null;

                    legs.forEach((leg) => {
                        const fix = fixNameOfLeg(leg);

                        if (!fix || !airport.fixes[fix]) {
                            previous = null;

                            return;
                        }

                        const current = { fix, point: positionOf(airport.fixes[fix]), altitude: lowestRestrictionAltitudeFt(leg) };

                        if (previous) {
                            areas.forEach((area) => {
                                // a leg known to be above the area at both ends does not count
                                const isAbove = previous.altitude !== null && current.altitude !== null &&
                                    Math.min(previous.altitude, current.altitude) >= area.ceilingFt;

                                if (!isAbove && segmentEntersPolygon(previous.point, current.point, area.points)) {
                                    if (!crossings.has(area.index)) {
                                        crossings.set(area.index, new Set());
                                    }

                                    crossings.get(area.index).add(key);
                                }
                            });
                        }

                        previous = current;
                    });
                });
            });

            areas.filter((area) => crossings.has(area.index)).forEach((area) => {
                const stars = [...crossings.get(area.index)];
                const ceiling = Number.isFinite(area.ceilingFt) ? ` (techo ${area.ceilingFt} ft)` : '';
                const list = stars.length > 4 ? `${stars.slice(0, 4).join(', ')} y ${stars.length - 4} más` : stars.join(', ');

                problems.push({
                    path: `/restricted/${area.index}`,
                    message: `la zona ${area.name}${ceiling} la atraviesan las STAR ${list}`
                });
            });

            return problems;
        }
    }
];

/**
 * What the rules may need besides the airport JSON
 *
 * @function buildContext
 * @param root {string} repository root
 * @param fileIcao {string}
 * @param loadList {array<object>}
 */
function buildContext(root, fileIcao, loadList) {
    const airlineCache = buildContext.airlineCache || (buildContext.airlineCache = new Map());

    return {
        fileIcao,
        loadListEntry: loadList.find((entry) => entry.icao === fileIcao) || null,
        hasTerrainFile: ['geojson', 'geoJSON', 'json']
            .some((extension) => fs.existsSync(path.join(root, 'assets', 'airports', 'terrain', `${fileIcao}.${extension}`))),
        airline(id) {
            const key = id.toLowerCase();

            if (!airlineCache.has(key)) {
                const file = path.join(root, 'assets', 'airlines', `${key}.json`);

                airlineCache.set(key, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
            }

            return airlineCache.get(key);
        }
    };
}

module.exports = {
    RULES, buildContext, fixNameOfLeg, isInsidePolygon, lowestRestrictionAltitudeFt, restrictedCeilingFt
};

/**
 * Geometry helpers for bots, working on observations: positions in nautical miles
 * (x east, y north), headings in degrees true.
 */

const DEG = Math.PI / 180;

/**
 * Glidepath gradient used for planning, in feet per nautical mile (3 degrees)
 *
 * @property GLIDEPATH_FT_PER_NM
 * @type {number}
 * @final
 */
export const GLIDEPATH_FT_PER_NM = 318;

/**
 * @function normalizeHeading
 * @param heading {number} degrees
 * @return {number} in [0, 360)
 */
export const normalizeHeading = (heading) => ((heading % 360) + 360) % 360;

/**
 * Signed smallest difference `to - from`, in (-180, 180]
 *
 * @function headingDifference
 * @param from {number}
 * @param to {number}
 * @return {number}
 */
export const headingDifference = (from, to) => {
    const difference = normalizeHeading(to - from);

    return difference > 180 ? difference - 360 : difference;
};

/**
 * @function distance
 * @param a {object} `{ x, y }`
 * @param b {object} `{ x, y }`
 * @return {number} nm
 */
export const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * True bearing from `a` to `b`
 *
 * @function bearing
 * @param a {object}
 * @param b {object}
 * @return {number} degrees
 */
export const bearing = (a, b) => normalizeHeading(Math.atan2(b.x - a.x, b.y - a.y) / DEG);

/**
 * Unit vector of a heading
 *
 * @function headingVector
 * @param heading {number}
 * @return {object} `{ x, y }`
 */
export const headingVector = (heading) => ({ x: Math.sin(heading * DEG), y: Math.cos(heading * DEG) });

/**
 * Point at `distanceNm` from `point` on `heading`
 *
 * @function project
 * @param point {object}
 * @param heading {number}
 * @param distanceNm {number}
 * @return {object}
 */
export const project = (point, heading, distanceNm) => {
    const unit = headingVector(heading);

    return { x: point.x + unit.x * distanceNm, y: point.y + unit.y * distanceNm };
};

/**
 * Coordinate frame of a final approach. `along` is the distance from the
 * threshold measured outward on the extended centerline (positive on the
 * approach side); `lateral` is the distance from the centerline, positive to
 * the right of an aircraft flying the approach.
 *
 * @class FinalApproachFrame
 */
export class FinalApproachFrame {
    /**
     * @constructor
     * @param runway {object}  runway end from the observation (`name`, `heading`, `threshold`, `elevation`)
     */
    constructor(runway) {
        this.runway = runway;
        this.name = runway.name;
        this.course = runway.heading;
        this.threshold = runway.threshold;
        this.elevation = runway.elevation;
        this._outward = headingVector(runway.heading + 180);
        this._right = headingVector(runway.heading + 90);
    }

    /**
     * @for FinalApproachFrame
     * @method along
     * @param point {object}
     * @return {number}
     */
    along(point) {
        return (point.x - this.threshold.x) * this._outward.x + (point.y - this.threshold.y) * this._outward.y;
    }

    /**
     * @for FinalApproachFrame
     * @method lateral
     * @param point {object}
     * @return {number}
     */
    lateral(point) {
        return (point.x - this.threshold.x) * this._right.x + (point.y - this.threshold.y) * this._right.y;
    }

    /**
     * Point of the frame
     *
     * @for FinalApproachFrame
     * @method point
     * @param along {number}
     * @param lateral {number}
     * @return {object}
     */
    point(along, lateral) {
        return {
            x: this.threshold.x + this._outward.x * along + this._right.x * lateral,
            y: this.threshold.y + this._outward.y * along + this._right.y * lateral
        };
    }

    /**
     * Glidepath altitude at `along` nm from the threshold
     *
     * @for FinalApproachFrame
     * @method glidepathAltitude
     * @param along {number}
     * @return {number} ft
     */
    glidepathAltitude(along) {
        return this.elevation + Math.max(0, along) * GLIDEPATH_FT_PER_NM;
    }

    /**
     * Heading that closes the centerline at `interceptAngle` degrees from `point`
     *
     * @for FinalApproachFrame
     * @method interceptHeading
     * @param point {object}
     * @param interceptAngle {number}
     * @return {number}
     */
    interceptHeading(point, interceptAngle) {
        // right of the centerline: turn left of the course to close it, and vice versa
        const side = this.lateral(point) >= 0 ? -1 : 1;

        return normalizeHeading(this.course + side * interceptAngle);
    }

    /**
     * Heading perpendicular to the final approach course, toward the centerline (base leg)
     *
     * @for FinalApproachFrame
     * @method baseHeading
     * @param point {object}
     * @return {number}
     */
    baseHeading(point) {
        return this.interceptHeading(point, 90);
    }

    /**
     * Downwind heading: reciprocal of the course
     *
     * @for FinalApproachFrame
     * @property downwindHeading
     * @type {number}
     */
    get downwindHeading() {
        return normalizeHeading(this.course + 180);
    }
}

/**
 * True airspeed factor at an altitude (about 2% per 1000 ft)
 *
 * @function trueAirspeedFactor
 * @param altitude {number} ft
 * @return {number}
 */
export const trueAirspeedFactor = (altitude) => 1 + Math.max(0, altitude) * 0.00002;

/**
 * @function isInsidePolygon
 * @param point {object}
 * @param polygon {array<object>}
 * @return {boolean}
 */
export function isInsidePolygon(point, polygon) {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const a = polygon[i];
        const b = polygon[j];

        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }

    return inside;
}

function distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));

    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Distance from a point to the edges of a polygon
 *
 * @function distanceToPolygonEdge
 * @param point {object}
 * @param polygon {array<object>}
 * @return {number} nm
 */
export function distanceToPolygonEdge(point, polygon) {
    let minimum = Infinity;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        minimum = Math.min(minimum, distanceToSegment(point, polygon[j], polygon[i]));
    }

    return minimum;
}

/**
 * How far to each side of an edge to look for a neighbouring sector, in nm
 *
 * @property SHARED_EDGE_PROBE_NM
 * @type {number}
 * @final
 */
const SHARED_EDGE_PROBE_NM = 0.05;

/**
 * Length of the pieces edges are checked in
 *
 * @property EDGE_PIECE_NM
 * @type {number}
 * @final
 */
const EDGE_PIECE_NM = 1;

const outerEdgesCache = new WeakMap();

/**
 * Edges on the outer boundary of the airspace: those of every sector except the ones
 * shared with a neighbouring sector (e.g. the TMA Madrid sectors)
 *
 * @function outerEdges
 * @param airspace {array<object>}
 * @return {array<array<object>>} `[a, b]` pairs
 */
function outerEdges(airspace) {
    if (outerEdgesCache.has(airspace)) {
        return outerEdgesCache.get(airspace);
    }

    const isCovered = (point) => airspace.some(({ polygon }) => isInsidePolygon(point, polygon));
    const edges = [];

    airspace.forEach(({ polygon }) => {
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
            const a = polygon[j];
            const b = polygon[i];
            const length = Math.hypot(b.x - a.x, b.y - a.y);

            if (length === 0) {
                continue;
            }

            // sectors may overlap along part of an edge only, so check it piece by piece
            const pieces = Math.ceil(length / EDGE_PIECE_NM);
            const normal = { x: -(b.y - a.y) / length * SHARED_EDGE_PROBE_NM, y: (b.x - a.x) / length * SHARED_EDGE_PROBE_NM };
            const at = (fraction) => ({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });

            let start = null;

            for (let k = 0; k <= pieces; k++) {
                const middle = at((k + 0.5) / pieces);
                const isOuter = k < pieces && (
                    !isCovered({ x: middle.x + normal.x, y: middle.y + normal.y }) ||
                    !isCovered({ x: middle.x - normal.x, y: middle.y - normal.y })
                );

                // consecutive outer pieces are kept as one segment
                if (isOuter && start === null) {
                    start = k;
                } else if (!isOuter && start !== null) {
                    edges.push([at(start / pieces), at(k / pieces)]);
                    start = null;
                }
            }
        }
    });

    outerEdgesCache.set(airspace, edges);

    return edges;
}

/**
 * How far inside the controlled airspace a point is (negative outside)
 *
 * The airspace may be split into sectors; only its outer boundary counts.
 *
 * @function distanceInsideAirspace
 * @param point {object}
 * @param airspace {array<object>}  `observation.airport.airspace`
 * @return {number} nm, Infinity when the airport has no airspace
 */
export function distanceInsideAirspace(point, airspace) {
    if (!airspace || airspace.length === 0) {
        return Infinity;
    }

    const isInside = airspace.some(({ polygon }) => isInsidePolygon(point, polygon));
    let minimum = Infinity;

    outerEdges(airspace).forEach(([a, b]) => {
        minimum = Math.min(minimum, distanceToSegment(point, a, b));
    });

    return isInside ? minimum : -minimum;
}

/**
 * Floor of the controlled airspace at a point: the lowest floor of the sectors over it
 *
 * @function airspaceFloorAt
 * @param point {object}
 * @param airspace {array<object>}  `observation.airport.airspace`
 * @return {number|null} ft, null outside the airspace
 */
export function airspaceFloorAt(point, airspace) {
    let lowest = null;

    (airspace || []).forEach(({ floor, polygon }) => {
        if ((lowest === null || floor < lowest) && isInsidePolygon(point, polygon)) {
            lowest = floor;
        }
    });

    return lowest;
}

/**
 * Highest airspace floor along a path, sampled every `stepNm`, over its first `lengthNm`
 *
 * @function highestFloorAlongPath
 * @param points {array<object>}
 * @param airspace {array<object>}
 * @param [lengthNm] {number}
 * @param [stepNm] {number}
 * @return {number} ft, 0 where the airspace reaches the ground (or outside it)
 */
export function highestFloorAlongPath(points, airspace, lengthNm = Infinity, stepNm = 1) {
    let highest = 0;
    let travelled = 0;

    for (let i = 1; i < points.length && travelled < lengthNm; i++) {
        const a = points[i - 1];
        const b = points[i];
        const length = distance(a, b);

        for (let s = 0; s < length && travelled + s <= lengthNm; s += stepNm) {
            const floor = airspaceFloorAt({ x: a.x + (b.x - a.x) * s / length, y: a.y + (b.y - a.y) * s / length }, airspace);

            highest = Math.max(highest, floor || 0);
        }

        travelled += length;
    }

    return highest;
}

/**
 * Whether a point at an altitude is inside the controlled airspace: inside a sector laterally and
 * between its floor and its ceiling. Sectors may leave gaps between them in altitude (e.g. the
 * shelves of a class B airspace like KLAX), so the lowest floor and the highest ceiling are not enough.
 *
 * @function isInsideAirspaceAt
 * @param point {object}
 * @param altitude {number} ft
 * @param airspace {array<object>}
 * @return {boolean}
 */
export function isInsideAirspaceAt(point, altitude, airspace) {
    return (airspace || []).some(({ floor, ceiling, polygon }) => altitude >= floor && altitude <= ceiling &&
        isInsidePolygon(point, polygon));
}

/**
 * Points every `stepNm` along a path, over its first `lengthNm`
 *
 * @function samplePath
 * @param points {array<object>}
 * @param lengthNm {number}
 * @param [stepNm] {number}
 * @return {array<object>}
 */
export function samplePath(points, lengthNm, stepNm = 1) {
    const samples = [];
    let travelled = 0;

    for (let i = 1; i < points.length && travelled <= lengthNm; i++) {
        const a = points[i - 1];
        const b = points[i];
        const length = distance(a, b);

        for (let s = 0; s < length && travelled + s <= lengthNm; s += stepNm) {
            samples.push({ x: a.x + (b.x - a.x) * s / length, y: a.y + (b.y - a.y) * s / length });
        }

        travelled += length;
    }

    return samples.length > 0 ? samples : points.slice(0, 1);
}

/**
 * Levels that stay inside the controlled airspace at every point, `marginFt` above and below
 *
 * @function levelsInsideAirspace
 * @param points {array<object>}
 * @param airspace {array<object>}
 * @param levels {array<number>}
 * @param [marginFt] {number}
 * @return {array<number>}
 */
export function levelsInsideAirspace(points, airspace, levels, marginFt = 400) {
    return levels.filter((level) => points.every((point) => isInsideAirspaceAt(point, level - marginFt, airspace) &&
        isInsideAirspaceAt(point, level + marginFt, airspace)));
}

const gapsCache = new WeakMap();

/**
 * Whether the airspace has gaps in altitude: two sectors over the same place whose altitude ranges
 * do not meet, with nothing in between (the shelves of a class B airspace like KLAX). Elsewhere the
 * lowest floor and the highest ceiling describe it well enough, and the bots use those.
 *
 * @function hasAltitudeGaps
 * @param airspace {array<object>}
 * @return {boolean}
 */
export function hasAltitudeGaps(airspace) {
    if (!airspace || airspace.length < 2) {
        return false;
    }

    if (!gapsCache.has(airspace)) {
        const overlaps = (a, b) => a.polygon.some((point) => isInsidePolygon(point, b.polygon)) ||
            b.polygon.some((point) => isInsidePolygon(point, a.polygon));
        const hasGap = airspace.some((lower) => airspace.some((upper) => lower.ceiling < upper.floor &&
            overlaps(lower, upper) &&
            !airspace.some((between) => between.floor <= lower.ceiling && between.ceiling >= upper.floor &&
                overlaps(between, lower))));

        gapsCache.set(airspace, hasGap);
    }

    return gapsCache.get(airspace);
}

/**
 * Half width of the corridor checked along a track, so a track that only grazes an area counts
 *
 * @property RESTRICTED_CORRIDOR_NM
 * @type {number}
 * @final
 */
const RESTRICTED_CORRIDOR_NM = 1;

const RESTRICTED_STEP_SECONDS = 15;

const areaBoundsCache = new WeakMap();

function areaBounds(area) {
    if (!areaBoundsCache.has(area)) {
        const xs = area.polygon.map((point) => point.x);
        const ys = area.polygon.map((point) => point.y);

        areaBoundsCache.set(area, {
            minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)
        });
    }

    return areaBoundsCache.get(area);
}

/**
 * The restricted area a point at an altitude is in, if any
 *
 * @function restrictedAreaAt
 * @param point {object}
 * @param altitude {number} ft
 * @param areas {array<object>}  `observation.airport.restrictedAreas`
 * @return {object|undefined}
 */
export function restrictedAreaAt(point, altitude, areas) {
    return (areas || []).find((area) => {
        if (area.height !== null && altitude > area.height) {
            return false;
        }

        const bounds = areaBounds(area);

        return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY &&
            isInsidePolygon(point, area.polygon);
    });
}

/**
 * Time until an aircraft enters a restricted area on `track`. An area it is already in does not
 * count: it only has to get out of it.
 *
 * @function secondsToRestrictedArea
 * @param aircraft {object}
 * @param areas {array<object>}
 * @param horizonSeconds {number}
 * @param [track] {number}
 * @return {object|null} `{ seconds, area }`
 */
export function secondsToRestrictedArea(aircraft, areas, horizonSeconds, track = aircraft.groundTrack) {
    if (!areas || areas.length === 0) {
        return null;
    }

    const clearance = aircraft.clearance || {};
    const altitude = Number.isFinite(clearance.altitude) ? Math.min(aircraft.altitude, clearance.altitude) : aircraft.altitude;
    const unit = headingVector(track);
    const side = { x: unit.y, y: -unit.x };
    const speed = Math.max(aircraft.groundSpeed, 120);
    const inside = restrictedAreaAt(aircraft, altitude, areas);

    for (let seconds = RESTRICTED_STEP_SECONDS; seconds <= horizonSeconds; seconds += RESTRICTED_STEP_SECONDS) {
        const flown = speed * seconds / 3600;

        for (let offset = -RESTRICTED_CORRIDOR_NM; offset <= RESTRICTED_CORRIDOR_NM; offset += RESTRICTED_CORRIDOR_NM) {
            const area = restrictedAreaAt({
                x: aircraft.x + unit.x * flown + side.x * offset,
                y: aircraft.y + unit.y * flown + side.y * offset
            }, altitude, areas);

            if (area && area !== inside) {
                return { seconds, area };
            }
        }
    }

    return null;
}

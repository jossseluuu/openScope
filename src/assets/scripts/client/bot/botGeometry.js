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

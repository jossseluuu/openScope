import { distance_to_poly, point_in_poly } from '../math/vector';
import { km } from '../utilities/unitConverters';

/**
 * Terrain files contain contours every 1000 ft: the polygons of level `L` cover
 * the areas where the terrain is at or above `L` ft
 *
 * @property TERRAIN_BAND_FT
 * @type {number}
 * @final
 */
const TERRAIN_BAND_FT = 1000;

/**
 * Minimum obstacle clearance of a minimum vectoring altitude
 * (ICAO Doc 4444 8.6.5.2; FAA JO 7210.3 3-9-1)
 *
 * @property OBSTACLE_CLEARANCE_FT
 * @type {number}
 * @final
 */
const OBSTACLE_CLEARANCE_FT = 1000;

/**
 * Horizontal buffer around terrain used for minimum vectoring altitudes
 *
 * @property MVA_BUFFER_NM
 * @type {number}
 * @final
 */
const MVA_BUFFER_NM = 3;

/**
 * Size of the cells used to cache minimum vectoring altitudes, in km
 *
 * @property CACHE_CELL_KM
 * @type {number}
 * @final
 */
const CACHE_CELL_KM = 0.5;

/**
 * Terrain queries over the contours of an airport's terrain file
 *
 * @class TerrainClearance
 */
export default class TerrainClearance {
    /**
     * @constructor
     * @param terrain {object}  `AirportModel#terrain`: polygons (rings of relative positions, in km) by level in ft
     */
    constructor(terrain) {
        this._levels = Object.keys(terrain)
            .map(Number)
            .filter((level) => level > 0)
            .sort((a, b) => b - a)
            .map((level) => ({ level, polygons: terrain[level] }));
        this._mvaCache = {};
    }

    /**
     * @for TerrainClearance
     * @property hasTerrain
     * @type {boolean}
     */
    get hasTerrain() {
        return this._levels.length > 0;
    }

    /**
     * Highest terrain contour at `position`, or within `bufferKm` of it, in ft
     *
     * @for TerrainClearance
     * @method getTerrainLevel
     * @param position {array<number>}  relative position, in km
     * @param [bufferKm] {number}
     * @return {number}  0 when below the lowest contour
     */
    getTerrainLevel(position, bufferKm = 0) {
        for (let i = 0; i < this._levels.length; i++) {
            const { level, polygons } = this._levels[i];

            if (polygons.some((polygon) => this._isNearPolygon(position, polygon, bufferKm))) {
                return level;
            }
        }

        return 0;
    }

    /**
     * Minimum vectoring altitude at `position`: the top of the highest terrain band within
     * 3 nm, plus the minimum obstacle clearance, rounded up to 100 ft
     *
     * @for TerrainClearance
     * @method getMinimumVectoringAltitude
     * @param position {array<number>}
     * @return {number}  ft
     */
    getMinimumVectoringAltitude(position) {
        const key = `${Math.round(position[0] / CACHE_CELL_KM)},${Math.round(position[1] / CACHE_CELL_KM)}`;

        if (!(key in this._mvaCache)) {
            const level = this.getTerrainLevel(position, km(MVA_BUFFER_NM));

            this._mvaCache[key] = Math.ceil((level + TERRAIN_BAND_FT + OBSTACLE_CLEARANCE_FT) / 100) * 100;
        }

        return this._mvaCache[key];
    }

    /**
     * Whether an aircraft at `altitude` is certainly below the terrain (under the floor of its band)
     *
     * @for TerrainClearance
     * @method isBelowTerrain
     * @param position {array<number>}
     * @param altitude {number}
     * @return {boolean}
     */
    isBelowTerrain(position, altitude) {
        return altitude < this.getTerrainLevel(position);
    }

    /**
     * @for TerrainClearance
     * @method _isNearPolygon
     * @param position {array<number>}
     * @param polygon {array<array>}  outer ring followed by holes
     * @param bufferKm {number}
     * @return {boolean}
     * @private
     */
    _isNearPolygon(position, polygon, bufferKm) {
        const [outerRing, ...holes] = polygon;

        if (point_in_poly(position, outerRing)) {
            const hole = holes.find((ring) => point_in_poly(position, ring));

            return !hole || (bufferKm > 0 && distance_to_poly(position, hole) < bufferKm);
        }

        return bufferKm > 0 && distance_to_poly(position, outerRing) < bufferKm;
    }
}

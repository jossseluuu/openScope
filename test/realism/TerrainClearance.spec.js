import ava from 'ava';

import TerrainClearance from '../../src/assets/scripts/client/realism/TerrainClearance';
import { km } from '../../src/assets/scripts/client/utilities/unitConverters';

// a 3000 ft plateau with a 5000 ft peak in it and a valley (hole) below 3000 ft, in km
const square = (x0, y0, size) => [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size]];
const TERRAIN = {
    3000: [[square(0, 0, 40), square(30, 30, 5)]],
    4000: [[square(10, 10, 10)]],
    5000: [[square(12, 12, 4)]]
};

ava('.hasTerrain is false without contours', (t) => {
    t.false(new TerrainClearance({}).hasTerrain);
    t.true(new TerrainClearance(TERRAIN).hasTerrain);
});

ava('.getTerrainLevel() returns the highest contour containing the position', (t) => {
    const terrainClearance = new TerrainClearance(TERRAIN);

    t.is(terrainClearance.getTerrainLevel([14, 14]), 5000);
    t.is(terrainClearance.getTerrainLevel([11, 11]), 4000);
    t.is(terrainClearance.getTerrainLevel([5, 5]), 3000);
    t.is(terrainClearance.getTerrainLevel([100, 100]), 0);
});

ava('.getTerrainLevel() excludes holes', (t) => {
    t.is(new TerrainClearance(TERRAIN).getTerrainLevel([32, 32]), 0);
});

ava('.getMinimumVectoringAltitude() adds a 3 nm buffer, the band and 1000 ft of clearance', (t) => {
    const terrainClearance = new TerrainClearance(TERRAIN);

    // 3 km from the 5000 ft peak: within 3 nm
    t.is(terrainClearance.getMinimumVectoringAltitude([12, 12 + 4 + 3]), 7000);
    // far from everything
    t.is(terrainClearance.getMinimumVectoringAltitude([100 + km(5), 100]), 2000);
});

ava('.isBelowTerrain() compares the altitude with the floor of the band', (t) => {
    const terrainClearance = new TerrainClearance(TERRAIN);

    t.true(terrainClearance.isBelowTerrain([14, 14], 4900));
    t.false(terrainClearance.isBelowTerrain([14, 14], 5100));
});

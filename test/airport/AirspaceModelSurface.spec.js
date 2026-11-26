import ava from 'ava';
import AirspaceModel from '../../src/assets/scripts/client/airport/AirspaceModel';
import { isInsideAirspaceAt } from '../../src/assets/scripts/client/bot/botGeometry';

// ASP-003: a floor of 0 is the surface, also at airports below sea level (EHAM, -11 ft)

function sector(floor, ceiling) {
    const model = Object.create(AirspaceModel.prototype);

    model.floor = floor;
    model.ceiling = ceiling;
    model.isPointInside2D = () => true;

    return model;
}

ava('a sector from the surface contains an aircraft on a runway below sea level', (t) => {
    t.true(sector(0, 3000).isPointInside([0, 0], -11));
});

ava('a sector with a floor above the surface still excludes what is below it', (t) => {
    t.false(sector(1500, 3000).isPointInside([0, 0], 1400));
    t.true(sector(1500, 3000).isPointInside([0, 0], 1500));
});

ava('the bot geometry agrees with the engine below sea level', (t) => {
    const polygon = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];

    t.true(isInsideAirspaceAt({ x: 0, y: 0 }, -11, [{ floor: 0, ceiling: 3000, polygon }]));
    t.false(isInsideAirspaceAt({ x: 0, y: 0 }, 900, [{ floor: 1000, ceiling: 3000, polygon }]));
});

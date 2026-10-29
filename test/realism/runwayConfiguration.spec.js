import ava from 'ava';

import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import { selectRunwayConfiguration } from '../../src/assets/scripts/client/realism/runwayConfiguration';
import { AIRPORT_JSON_KLAS_MOCK } from '../airport/_mocks/airportJsonMock';

const CONFIGURATIONS = [
    {
        name: 'west', arrivalRunway: '25L', departureRunway: '25R', runways: ['25L', '25R']
    },
    {
        name: 'east', arrivalRunway: '07L', departureRunway: '07R', runways: ['07L', '07R']
    }
];

const createAirportModel = (wind, extra = {}) => new AirportModel({
    ...AIRPORT_JSON_KLAS_MOCK,
    wind,
    ...extra
});

ava('selectRunwayConfiguration() returns null when the airport defines no configuration', (t) => {
    t.is(selectRunwayConfiguration(createAirportModel({ angle: 250, speed: 10 }), undefined), null);
    t.is(selectRunwayConfiguration(createAirportModel({ angle: 250, speed: 10 }), []), null);
});

ava('selectRunwayConfiguration() keeps the preferred configuration while the tailwind is within limits', (t) => {
    // 4 kt tailwind on runways 25 (limit 5 kt)
    const airportModel = createAirportModel({ angle: 70, speed: 4 });

    t.is(selectRunwayConfiguration(airportModel, CONFIGURATIONS).name, 'west');
});

ava('selectRunwayConfiguration() switches configuration when the tailwind exceeds the limit', (t) => {
    const airportModel = createAirportModel({ angle: 70, speed: 15 });

    t.is(selectRunwayConfiguration(airportModel, CONFIGURATIONS).name, 'east');
});

ava('AirportModel uses the selected configuration as its active runways', (t) => {
    const airportModel = createAirportModel({ angle: 70, speed: 15 }, { runwayConfigurations: CONFIGURATIONS });

    t.is(airportModel.runwayConfiguration.name, 'east');
    t.is(airportModel.arrivalRunwayModel.name, '07L');
    t.is(airportModel.departureRunwayModel.name, '07R');
});

ava('AirportModel keeps its default runways when it defines no configuration', (t) => {
    const airportModel = createAirportModel({ angle: 70, speed: 15 });

    t.is(airportModel.runwayConfiguration, null);
    t.is(airportModel.arrivalRunwayModel.name, AIRPORT_JSON_KLAS_MOCK.arrivalRunway);
    t.is(airportModel.regulatoryProfile.id, 'FAA');
});

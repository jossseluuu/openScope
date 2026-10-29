/**
 * Minimal observations for bot tests: one runway 27/09 with the threshold of 27
 * at the origin (final approach from the east), EASA rules.
 */
export const createRunway = (name, heading, x, y) => ({
    name,
    heading,
    threshold: { x, y },
    elevation: 0,
    length: 2,
    ils: true,
    queue: [],
    minimumAltitudeOnFinal: null
});

export const createAircraft = (overrides = {}) => ({
    callsign: 'TST1',
    category: 'arrival',
    flightPhase: 'DESCENT',
    type: 'A320',
    weightClass: 'M',
    recatEu: 'D',
    wakeFaa: 'LARGE',
    x: 20,
    y: 0,
    distance: 20,
    altitude: 5000,
    heading: 270,
    groundTrack: 270,
    speed: 220,
    groundSpeed: 220,
    trend: 0,
    isControllable: true,
    isOnGround: false,
    isTaxiing: false,
    isEstablishedOnCourse: false,
    hasApproachClearance: false,
    hasDepartureClearance: false,
    minimumVectoringAltitude: null,
    speedLimits: { min: 110, landing: 130, max: 350 },
    ceiling: 39000,
    route: 'ABC.ABC1A.TEST27',
    waypoints: [],
    isHoldAssigned: false,
    arrivalRunway: '27',
    departureRunway: null,
    clearance: {
        altitudeMode: 'HOLD',
        altitude: 5000,
        headingMode: 'HOLD',
        heading: 270,
        speedMode: 'HOLD',
        speed: 220
    },
    ...overrides
});

export const createObservation = (aircraft = [], realism = {}) => ({
    time: 1000,
    airport: {
        icao: 'TEST',
        elevation: 0,
        arrivalRunway: '27',
        departureRunway: '27',
        airspace: [{
            floor: 0,
            ceiling: 24000,
            polygon: [{ x: -60, y: -60 }, { x: 60, y: -60 }, { x: 60, y: 60 }, { x: -60, y: 60 }]
        }],
        runways: [[createRunway('27', 270, 0, 0), createRunway('09', 90, -2, 0)]]
    },
    realism: {
        wakeScheme: 'RECAT_EU',
        separationMinima: {
            radarNm: 3,
            verticalFt: 1000,
            finalApproachNm: 2.5,
            arrivalDepartureNm: 2
        },
        runwayOccupancy: [],
        lastTakeoffs: [],
        ...realism
    },
    aircraft
});

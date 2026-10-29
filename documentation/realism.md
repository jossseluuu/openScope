# Operational realism

The realism layer (`src/assets/scripts/client/realism`) adds the airport and
separation rules a real controller works with on top of the aircraft physics.
It is always on, at every airport, in the browser and in the headless
simulator.

## Regulatory profiles

Each airport applies one set of rules, chosen from its ICAO identifier or set
with `regulatoryProfile` in the airport file:

| Profile | Airports | Wake scheme | Radar | Final approach | Arrival / departure |
|---|---|---|---|---|---|
| `EASA` | Europe (E, L, BI) | RECAT-EU | 3 nm / 1000 ft | 2.5 nm | 2 nm |
| `FAA` | United States (K, P, TJ, TI) | FAA JO 7110.65 | 3 nm / 1000 ft | 3 nm | 2 nm |
| `ICAO` | everywhere else | ICAO Doc 4444 (J/H/M/L) | 3 nm / 1000 ft | 3 nm | 2 nm |

All profiles limit runway use to 5 kt of tailwind and 20 kt of crosswind.

## Rules

Rules are ordered in tiers. A lower tier always takes precedence: no gain in a
higher tier makes up for a violation in a lower one.

| Tier | Rule | Checked | Reference |
|---|---|---|---|
| 0 Safety | `RUNWAY_INCURSION` | a landing or takeoff on an occupied runway | Doc 4444 7.10, 7.11; 7110.65 3-9-6, 3-10-3 |
| 0 Safety | `TERRAIN_COLLISION` | an aircraft below the terrain | Doc 4444 8.6.5.2 |
| 0 Safety | `MINIMUM_ALTITUDE` | a vectored aircraft below the minimum vectoring altitude | Doc 4444 8.6.5.2; 7110.65 5-6-1 |
| 1 Separation | `RADAR_SEPARATION` | less than the radar minimum, laterally and vertically | Doc 4444 8.7.3; 7110.65 5-5-4 |
| 1 Separation | `FINAL_APPROACH_SEPARATION` | less than the minimum between consecutive aircraft on the same final | Doc 4444 8.7.3.2 |
| 1 Separation | `WAKE_ARRIVAL` | less than the wake distance on the same final | Doc 4444 8.7.3.4; RECAT-EU; 7110.65 5-5-4 |
| 1 Separation | `WAKE_DEPARTURE` | less than the wake time between departures | Doc 4444 5.8.3; RECAT-EU; 7110.65 3-9-6 |
| 1 Separation | `ARRIVAL_DEPARTURE` | a takeoff roll with an arrival inside 2 nm | Doc 4444 7.11.3; 7110.65 3-9-6 |
| 2 Procedure | `RUNWAY_WIND_LIMIT` | a runway used beyond its wind limits | Doc 4444 7.2.3 |
| 3 Efficiency | `GO_AROUND` | a missed approach | stabilized approach criteria |

Details:

- **Radar separation** is checked between aircraft under our control, both at
  least 1000 ft above the airport (below that the runway rules apply). It does
  not apply to aircraft established on approaches to different parallel
  runways that keep the dependent-approach minimum, nor to departures from
  parallel runways on headings diverging by 15 degrees or more and moving apart.
  A loss counts once, however long it lasts. Pairs that enter our airspace
  already too close get 60 seconds to be separated.
- **Wake turbulence** treats parallel runways less than 2500 ft apart as one
  runway. Aircraft categories come from `recatEu` and `wakeFaa` in the aircraft
  files.
- **Minimum vectoring altitude** is the top of the highest 1000 ft terrain band
  within 3 nm plus 1000 ft of obstacle clearance. It applies to aircraft flying
  an assigned heading, except climbing aircraft, departures within 10 nm of the
  airport and aircraft established on an approach. It needs a terrain file.

## Runways and approaches

- A landing aircraft occupies its runway (both ends) for its runway occupancy
  time, 45 to 70 seconds by RECAT-EU category, varied by 90% to 120%. A
  departure occupies it from the start of its takeoff roll until it is airborne
  past the runway end.
- Pilots check the approach at 1000 ft above the threshold. If they are not
  established on the localizer and glidepath, or are more than 20 kt above
  their landing speed, they go around. They plan to be at landing speed
  0.5 nm before that point, so the controller must have them slow enough at
  the final approach fix (160 kt is typical).
- At 200 ft above the threshold, pilots go around if the runway is occupied.
- The controller can order a go-around with `ga`.
- Taxiing to the runway takes the airport's `taxiTimes`, or 5 minutes, varied
  by 85% to 125%. Any aircraft at the holding point can be cleared for takeoff.
- The runway configuration is chosen from the wind when the airport loads, see
  `runwayConfigurations` in the [airport format](airport-format.md).

## Metrics

`RealismController#getObservation().metrics` gives:

- landings, takeoffs and movements per hour
- go-arounds and total time without separation
- average time in airspace and track miles of arrivals
- average ground time and holding point wait of departures
- estimated fuel burn and CO2

Fuel uses flat flow rates by RECAT-EU category. It is meant to compare
strategies, not to predict a real flight's fuel.

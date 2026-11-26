### About this facility
Schiphol Approach (LVNL), Netherlands

Schiphol Approach controls the arrivals and departures of Amsterdam Airport Schiphol, one of the busiest airports in Europe and the hub of KLM. Its traffic is a dense mix of European and intercontinental flights.

### Airspace
The airspace is the SCHIPHOL TMA (parts 1 to 8), as published in ENR 2.1 (AIRAC AMDT 11-2026), with the SCHIPHOL CTR (ground to 3000 ft) of AD 2 EHAM. The TMA parts have floors from 1500 ft to FL055 and the TMA ends at FL095. Above part 1, a layer from FL095 to FL195 stands for the Amsterdam control sectors (see Deviations from Reality). **An aircraft that descends below the floor of the part it is in leaves the airspace**, and an arrival that does so is lost. The transition altitude is 3000 ft; departures are initially cleared to 6000 ft.

The game starts with the arrivals of the first ten minutes already inside the airspace, each on a different STAR and at a different distance; new arrivals then appear on their STAR shortly before the airspace boundary, at least 75 seconds apart. Traffic is an estimate: about 18 arrivals and 16-24 departures an hour.

### Runway Configurations
Schiphol has six runways: 18R/36L (Polderbaan, 3800 m), 18C/36C (3300 m), 18L/36R (3400 m), 06/24 (3439 m), 09/27 (3453 m) and 04/22 (2020 m). Runway 18R is only used for landing and 36L only for take-off; 18L is only used for take-off and 36R only for landing. ATC selects the combination in use from a preferential runway system; two common combinations are modelled:

- **South:** arrivals land on 18R and 18C, departures use 24 and 18L.
- **North:** arrivals land on 36R and 06, departures use 36L and 36C.

Arrivals via `ARTIP` (from the east) land on 18C or 06, and arrivals via `SUGOL` and `RIVER` land on 18R or 36R. Western and southern departures take off from 24 or 36L, the others from 18L or 36C. openScope chooses the combination from the wind.

### Instrument Procedures
All SIDs and STARs are RNAV1.

- **SIDs:** every SID of AD 2.22 whose waypoints are published, from runways 04, 06, 09, 18C, 18L, 22, 24, 27, 36C and 36L. The supplementary SIDs of 36L are available but not used by the traffic.
- **STARs** end at one of the three initial approach fixes, `ARTIP`, `SUGOL` and `RIVER`, at FL070-FL100. From there, the initial and intermediate approach is flown on radar vectors, as at the real airport.

### Ground Operations
Taxi times are approximate: about 15 minutes to and from the Polderbaan (18R/36L), and 6 to 8 minutes for the other runways.

### Terrain
The airport lies 11 ft below sea level in the Haarlemmermeer polder. The surroundings are flat; the base map shows the coastline and the inland lakes.

### Airports of Interest

#### EHAM (Primary Airport)
Amsterdam Airport Schiphol

Located 9 km south-west of Amsterdam at an elevation of 11 ft below sea level.

### Deviations from Reality
- The SCHIPHOL TMA ends at FL095. The layer from FL095 to FL195 over part 1 is not part of the TMA: it stands for the Amsterdam control sectors, so that arrivals and departures stay inside the airspace.
- Only two runway combinations are modelled, and the split of arrivals and departures between their runways is simplified.
- Seven SIDs whose waypoints are not published in the charts read by the build script are not modelled, and the STAR `RKN2A` is not modelled.
- The night transitions are not modelled.
- Lelystad, Rotterdam and the military areas are not modelled.
- Taxi times and the split of the traffic between routes and airlines are estimates.

### Additional Resources
LVNL, eAIP Netherlands, AD 2 EHAM (https://eaip.lvnl.nl/)

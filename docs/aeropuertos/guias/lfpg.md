### About this facility
De Gaulle Approach (DSNA), France

De Gaulle Approach controls the arrivals and departures of Paris-Charles de Gaulle, the busiest airport in France and the main hub of Air France. Its traffic is a mix of short- and medium-haul flights across Europe and a large share of long-haul flights to every continent.

### Airspace
The airspace is the TMA PARIS (parts 1 to 10), as published in ENR 2.1 (AIRAC 2610), with the CTR PARIS (surface to 2000 ft) of AD 2 LFPG. The TMA is built as a stack of layers whose floors rise away from the airports: 1500 ft, 2500 ft, 3500 ft and 4500 ft close in, then FL065 and FL085, up to its ceiling at FL115. Above it, a layer from FL115 to FL195 stands for the Paris control sectors (see Deviations from Reality). **An aircraft that descends below the floor of the layer it is in leaves the airspace**, and an arrival that does so is lost. Departures are initially cleared to 5000 ft.

The game starts with the arrivals of the first ten minutes already inside the airspace, each on a different STAR and at a different distance; new arrivals then appear on their STAR shortly before the airspace boundary, at least 60 seconds apart. Traffic is an estimate for a busy hour: about 30 arrivals and 32 departures.

### Runway Configurations
Charles de Gaulle has two pairs of parallel runways: the north pair 09L/27R (2700 m) and 09R/27L (4200 m), and the south pair 08L/26R (4142 m) and 08R/26L (2700 m). The outer runways are used for landing and the inner runways for take-off:

- **West configuration (preferential):** arrivals land on 27R and 26L, departures use 27L and 26R.
- **East configuration:** arrivals land on 09L and 08R, departures use 09R and 08L.

Arrivals land on the pair on the side of their initial approach fix (`LORNI` and `MOPAR` to the north pair, `OKIPA` and `BANOX` to the south pair), and departures take off from the pair on the side of their exit point. openScope chooses the configuration from the wind. ILS approaches are available on every runway.

### Instrument Procedures
All SIDs and STARs are RNAV1.

- **SIDs:** `A` from 27L/27R, `B` from 26L/26R, `G` from 09L/09R and `H` from 08L/08R are the day SIDs used by the traffic. The `D`, `E`, `K`, `L` and `Z` variants are also available.
- **STARs:** `W` (west configuration) and `E` (east configuration) end at `LORNI`, `MOPAR`, `OKIPA`, `BANOX`, `MOBRO` or `VEBEK`. From there, the RNAV initial approaches (`1W`, `1E`) lead to the point where vectoring to the final approach starts. The night and tactical variants (`D`, `H`, `J`, `P`, `V`, `X`) are also available.

### Ground Operations
Taxi times from the terminals to the holding points are approximate: 7 to 10 minutes, the inner runways being closer to the terminals.

### Terrain
The airport lies on the plateau of the Pays de France, north-east of Paris, at an elevation of 392 ft. The surrounding terrain is gentle and stays below 700 ft.

### Airports of Interest

#### LFPG (Primary Airport)
Paris Charles de Gaulle Airport

Located 23 km north-east of Paris at an elevation of 392 ft.

### Deviations from Reality
- The TMA PARIS ends at FL115. The layer from FL115 to FL195 over part 1 of the TMA is not part of the TMA: it stands for the Paris control sectors, so that arrivals and departures stay inside the airspace.
- The other aerodromes of the TMA (Orly, Le Bourget, Beauvais) and their traffic are not modelled, and the TMA parts used by Orly approach are controlled as part of the same airspace.
- The split of the traffic between runways follows the side of the initial approach fix or exit point; the real split depends on the traffic of the moment.
- The base map only shows the extended runway centrelines.
- Terrain contours are generated from the AWS Terrain Tiles (derived from SRTM and other public-domain elevation data) and are approximate.
- The restricted and prohibited areas (including LF-P 23 PARIS) are not modelled.
- Taxi times and the split of the traffic between routes and airlines are estimates.

### Additional Resources
SIA, eAIP France, AD 2 LFPG (https://www.sia.aviation-civile.gouv.fr/)

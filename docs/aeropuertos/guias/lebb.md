### About this facility
Bilbao Approach (ENAIRE), Spain

Bilbao Approach controls the arrivals and departures of Bilbao, the busiest airport in northern Spain. Most of its traffic is domestic, to Madrid, Barcelona, the Balearic and Canary Islands and Andalusia, together with flights to the main European hubs.

### Airspace
The airspace is the TMA BILBAO, as published in ENR 2.1 and AD 2-LEBB (AIRAC 2610): Part 1, from 1000 ft above the ground to FL145, and Part 2, a triangle to the south from FL095 to FL145. **The ceiling is FL145**: arrivals appear below it, and departures leave the airspace when they climb through it. The CTR BILBAO (surface to 1000 ft above the ground) lies inside Part 1. **An aircraft that descends below the floor of Part 2 while inside it leaves the airspace**, and an arrival that does so is lost. The transition altitude is 6000 ft, and departures are initially cleared to 6000 ft.

The game starts with the arrivals of the first ten minutes already inside the airspace, each on a different STAR and at a different distance; new arrivals then appear on their STAR shortly before the airspace boundary, at least 180 seconds apart. Traffic is an estimate: about 8 arrivals and 8 departures an hour.

### Runway Configurations
Bilbao has two crossing runways: 12/30 (2600 m, with the 30 threshold displaced 460 m) and 10/28 (1910 m), which is used preferentially for VFR operations. Arrivals and departures share the same runway:

- **West configuration:** runway 30.
- **East configuration:** runway 12.

openScope chooses the configuration from the wind. ILS approaches are available on 12 and 30.

### Instrument Procedures
All SIDs and STARs are RNAV1.

- **SIDs:** the `A` and `E` SIDs from 30, and the `B` and `H` SIDs from 12, to `AMTOS`, `CALCE`, `DOSUL`, `MAPAX`, `PPN`, `SSN` and `XIZCA`.
- **STARs to 12** end at `ASPES`, `KUXUN`, `OLMET` or `SUNIR`, from which aircraft fly via `BB803` to the intermediate fix `BB13W`.
- **STARs to 30** (`Q`) end at `DIRXA` or at `IFASA`, the intermediate fix.

### Ground Operations
Taxi times from the terminal to the holding points are approximate: about 5 minutes to either runway.

### Terrain
The airport lies in a valley 5 km north of Bilbao at an elevation of 136 ft, surrounded by hills. The Gorbeia massif, about 18 nm to the south, reaches 4900 ft, and the Cantabrian Mountains rise above 6000 ft to the south-west.

### Airports of Interest

#### LEBB (Primary Airport)
Bilbao Airport

Located 9 km north of Bilbao at an elevation of 136 ft.

### Deviations from Reality
- The floor of Part 1 of the TMA (1000 ft above the ground) is modelled from the surface.
- The AIP gives no preferential runway for IFR traffic; openScope chooses the runway from the wind.
- The RNP and ILS approaches are not modelled as procedures; their initial segments are used as STAR transitions to the intermediate fix.
- Terrain contours are generated from the AWS Terrain Tiles (derived from SRTM and other public-domain elevation data) and are approximate. Minimum vectoring altitudes are computed from them and do not reproduce the published MVA chart.
- Taxi times and the split of the traffic between routes and airlines are estimates.

### Additional Resources
ENAIRE AIP España, AD 2-LEBB (https://aip.enaire.es/AIP/#LEBB)

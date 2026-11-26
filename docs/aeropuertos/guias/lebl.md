### About this facility
Barcelona Approach (ENAIRE), Spain

Barcelona Approach controls the arrivals and departures of Josep Tarradellas Barcelona-El Prat, the second busiest airport in Spain and the main base of Vueling. Its traffic is a mix of short- and medium-haul flights to the rest of Europe and Spain, together with long-haul flights to the Americas, the Middle East and Asia.

### Airspace
The airspace is the TMA BARCELONA (up to FL245) with its Area 1, a circle of 24 nm around the airport, and the CTR BARCELONA (surface to FL075), formed by two half circles of 12 nm around `TEBLA` and `ASTEK` joined by their tangents, as published in ENR 2.1 and AD 2-LEBL (AIRAC 2609). The floor of the TMA is 3500 ft and the floor of Area 1 is 2500 ft (see Deviations from Reality). **An aircraft that descends below the floor of the airspace it is in leaves the airspace**, and an arrival that does so is lost. The transition altitude is 6000 ft, and departures are initially cleared to 6000 ft.

The game starts with the arrivals of the first ten minutes already inside the airspace, each on a different STAR and at a different distance; new arrivals then appear on their STAR shortly before the airspace boundary, at least 90 seconds apart. Traffic is an estimate for a busy day: about 22 arrivals and 22 departures an hour.

### Runway Configurations
Barcelona has two parallel runways, 06L/24R (3352 m) and 06R/24L (2660 m), and the crossing runway 02/20 (2528 m).

- **West configuration (preferential, daytime):** arrivals land on 24R and departures use 24L.
- **East configuration:** arrivals land on 06L and departures use 06R.

openScope uses the west configuration unless the wind gives more than 5 kt of tailwind or 20 kt of crosswind on its runways (the AIP keeps it up to 10 kt of tailwind, but openScope applies the EASA limits to every European airport). Traffic is generated for the configuration in use. ILS approaches are available on 02, 06L, 06R, 24L and 24R. The night configuration (arrivals on 02, departures from 06R) is not modelled.

### Instrument Procedures
All SIDs and STARs are RNAV1.

- **SIDs:** the `Q` SIDs from 24L and the `R` SIDs from 06R. Departures to the south and west turn left over the sea; departures to the north climb over `PERAL` and `DUQQI`.
- **STARs:** the `W` and `Z` STARs (west configuration) and the `E` and `Y` STARs (east configuration) end at `SLL`, `CLE`, `LESBA`, `RULOS`, `RUBOT`, `VIBIM` or `VLA`. From there, the RNAV transitions (`2W`, `2L`, `2E`, `2R`) lead to a trombone that ends at `BL427` or `BL428` (24) and `BL529` or `BL530` (06), from which aircraft are vectored to the ILS. Traffic is generated on the `W` and `E` STARs.

### Ground Operations
Taxi times from the terminals to the holding points are approximate: about 5 minutes to 06R, 6 minutes to 24L and 8 minutes to 24R and 06L.

### Terrain
The airport lies on the delta of the Llobregat at an elevation of 14 ft. The Garraf massif rises just to the south-west, Collserola and Montserrat to the north, and the Pyrenees, above 9000 ft, lie about 70 nm to the north.

### Airports of Interest

#### LEBL (Primary Airport)
Josep Tarradellas Barcelona-El Prat Airport

Located 12 km south-west of Barcelona at an elevation of 14 ft.

### Deviations from Reality
- The floor of the TMA and of Area 1 is "MAX ALT VFR SECTOR" in the AIP, a value that is only drawn on the visual approach chart. It is approximated as 3500 ft (TMA) and 2500 ft (Area 1), and the Sabadell ATZ is not excluded from the CTR.
- The northern limit of the TMA follows the Spanish-French border, which is approximated with a few points.
- Only the SIDs of the preferential departure runways (24L and 06R) are modelled, and the night configuration is not modelled.
- Terrain contours are generated from the AWS Terrain Tiles (derived from SRTM and other public-domain elevation data) and are approximate. Minimum vectoring altitudes are computed from them and do not reproduce the published MVA chart.
- The restricted and danger areas are not modelled.
- Taxi times and the split of the traffic between routes and airlines are estimates.

### Additional Resources
ENAIRE AIP España, AD 2-LEBL (https://aip.enaire.es/AIP/#LEBL)

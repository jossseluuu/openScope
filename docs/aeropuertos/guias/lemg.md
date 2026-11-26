### About this facility
Málaga Approach (ENAIRE), Spain

Málaga Approach controls the arrivals and departures of Málaga-Costa del Sol, the main gateway to the Costa del Sol and one of the busiest airports in Spain. Most of its traffic is short- and medium-haul leisure flights to the United Kingdom, Ireland, Scandinavia and the rest of Europe.

### Airspace
The airspace is Area 3 of the TMA SEVILLA together with the CTR MÁLAGA, as published in ENR 2.1 and AD 2-LEMG (AIRAC 2610), up to FL245. It is split by the floors of the TSEV sectors that lie inside it: 1000 ft over the sea to the south-east, between 2000 and 4500 ft along the coast, and up to 8500 ft over the mountains to the north-east. The CTR MÁLAGA (surface to 7500 ft) with TSEV-13 above it reaches down to the surface around the airport. **An aircraft that descends below the floor of the sector it is in leaves the airspace**, and an arrival that does so is lost. The sector floors are shown on the scope. The transition altitude is 13000 ft, and departures are initially cleared to 10000 ft on all SIDs.

The game starts with the arrivals of the first ten minutes already inside the airspace, each on a different STAR and at a different distance; new arrivals then appear on their STAR shortly before the airspace boundary, at least 150 seconds apart. Traffic follows the 2025 average (186,990 movements, about 14 arrivals and 14 departures an hour over an 18-hour day).

### Runway Configurations
Málaga has two runways that converge to the south-east: 13/31 (3198 m) and 12/30 (2749 m). Runway 12 can only be used for landing and runway 30 only for take-off.

- **South configuration (preferential):** arrivals land on 12 and departures use 13.
- **North configuration:** arrivals land on 31 and departures use 30.

openScope uses the south configuration unless the wind gives more than 5 kt of tailwind or 20 kt of crosswind on its runways, in which case it uses the north configuration (the AIP keeps the preferential configuration up to 10 kt of tailwind, but openScope applies the EASA limits to every European airport). Traffic is generated for the configuration in use. ILS approaches are available on 12, 13 and 31.

### Instrument Procedures
All SIDs are RNAV1 and end at one of eleven exit points: `BLN`, `EPATA`, `GDA`, `INKAL`, `JRZ`, `NESDA`, `PIMOS`, `RIXUR`, `SVL`, `UMUKA` and `VIBAS`. The last letter identifies the runway: `H` from 13, `L` from 30 and `P` from 31 (for example `BLN5H`, `BLN4L` and `BLN5P`).

STARs are RNAV1 trombone procedures:

- **South configuration:** `A` STARs end at `LENHI` (7000 ft or above), after a trombone north of the airport.
- **North configuration:** `B` STARs end at `RAZID` (3000 ft or above), after a trombone south-east of the airport.

From the last fix of the STAR, aircraft must be vectored to the ILS. The `G` and `R` STARs are for tactical ATC use, and the `X` and `Y` STARs can only be planned at night: they are available but no traffic is generated on them.

### Ground Operations
Taxi times from the terminals to the holding points are approximate: about 5 minutes to 13 and 31, and 8 minutes to 30, which requires crossing runway 13/31.

### Terrain
The airport lies on the coast at an elevation of 52 ft, with the Montes de Málaga rising to the north and the Sierra de Mijas to the west. La Maroma, in the Sierra Tejeda about 25 nm to the north-east, reaches 6780 ft.

### Airports of Interest

#### LEMG (Primary Airport)
Málaga-Costa del Sol Airport

Located 8 km south-west of Málaga at an elevation of 52 ft, it is shared with the Málaga Air Base of the Spanish Air and Space Force.

### Deviations from Reality
- The initial conventional climbs of the `EPATA1V` and `EPATA1Q` SIDs, and the contingency departure `LEMG1L`, are not modelled.
- The RNP and GLS approaches are not modelled, so arriving aircraft must be vectored to the ILS.
- The CTR and sector limits are drawn with 50 m of overlap between neighbouring sectors, so that no gaps are left by rounding in the published coordinates.
- Terrain contours are generated from the AWS Terrain Tiles (derived from SRTM and other public-domain elevation data) and are approximate, and terrain is only modelled inside the airspace. Minimum vectoring altitudes are computed from them and do not reproduce the published MVA chart.
- Taxi times and the split of the traffic between routes and airlines are estimates.

### Additional Resources
ENAIRE AIP España, AD 2-LEMG (https://aip.enaire.es/AIP/#LEMG)

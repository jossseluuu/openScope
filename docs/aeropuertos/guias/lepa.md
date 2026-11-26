### About this facility
Palma Approach (ENAIRE), Spain

Palma Approach controls the arrivals and departures of Palma de Mallorca, the third busiest airport in Spain and one of the busiest leisure airports in Europe. In summer most of its traffic is short- and medium-haul flights to Germany, the United Kingdom and the rest of Europe, together with domestic flights to the Spanish mainland and the other Balearic Islands.

### Airspace
The airspace is the TMA PALMA (sectors TPAM-1 to TPAM-24) together with the CTR PALMA DE MALLORCA, as published in ENR 2.1 and AD 2-LEPA/LESJ (AIRAC 2610), up to FL245. It covers Mallorca, Menorca and Ibiza, and its sectors have different floors: from 1000 ft south-west of Ibiza to 6000 ft over the sea north of Mallorca, 4500-5800 ft over the Serra de Tramuntana, and 1300-1800 ft in the approach sectors TPAM-20 and TPAM-21 either side of the CTR. The CTR (surface to 4500 ft) reaches down to the surface around the airport. The CTRs of Ibiza and Menorca are not part of the TMA: below the floor of the TMA sectors around them there is no controlled airspace. **An aircraft that descends below the floor of the sector it is in leaves the airspace**, and an arrival that does so is lost. The transition altitude is 6000 ft, and departures are initially cleared to 6000 ft.

The game starts with the arrivals of the first ten minutes already inside the airspace, each on a different STAR and at a different distance; new arrivals then appear on their STAR shortly before the airspace boundary, at least 120 seconds apart. Traffic is an estimate for a summer day: about 16 arrivals and 16 departures an hour.

### Runway Configurations
Palma has two parallel runways: 06L/24R (3270 m) and 06R/24L (3000 m).

- **West configuration (preferential):** arrivals land on 24L and departures use 24R.
- **East configuration:** arrivals land on 06L and departures use 06R.

openScope uses the west configuration unless the wind gives more than 5 kt of tailwind or 20 kt of crosswind on its runways (the AIP keeps it up to 10 kt of tailwind, but openScope applies the EASA limits to every European airport). Traffic is generated for the configuration in use. ILS approaches are available on 06L, 24L and 24R.

### Instrument Procedures
SIDs are modelled for the departure runway of each configuration:

- **24R:** the `A` SIDs. Western departures climb on R-236 JOA to `BAKAX` (2000 ft or above) and then turn north or west; southern and eastern departures turn left to `PITUX` and `XURAL`. `ISTER`, `MEROS` and `MORSS` departures then fly over `PTC` and the `MHN` VOR on Menorca.
- **06R:** the `B` and `E` conventional SIDs, and the RNAV1 `R` SIDs (`BAVER4T`, `DRAGO5R`, `EPAMA4R`, `ESPOR5R`, `GALAT5R`), which follow the 15 DME arc of `MJV` to `PETAM` and continue via `NITRU`. Southern departures follow R-090 JOA and the 15 DME arc of `MJV` to `ADROL`.

STARs end at an initial approach fix, from which a transition takes aircraft to the intermediate fix of the runway in use:

- **West configuration:** `P` STARs end at `CDP`, `POS` or `MJV`. From `CDP` and `POS` aircraft fly via `BAVUM` to `PA12E` (24L); from `MJV` via `PA600` to `PA12E`.
- **East configuration:** `M` and `R` STARs end at `ADX` or `MJV`. From `ADX` aircraft fly via `PA407` to `PA09W` (06L); from `MJV` via `PA406`.

From the intermediate fix aircraft must be cleared for the ILS. Conventional (`KENAS`, `LUNIK`, `RIXOT`, `MAMEB`, `MORSS`) and RNAV1 (`GODOX`, `LAMPA`, `LORES`, `MEBUT`, `OSGAL`, `RUXET`, `TOLSO`) STARs are both available; traffic uses the RNAV1 ones where both exist.

### Ground Operations
Taxi times from the terminal to the holding points are approximate: about 5 minutes to 24R and 06L, and 6 minutes to 06R and 24L.

### Terrain
The airport lies on the Bay of Palma at an elevation of 27 ft. The Serra de Tramuntana runs along the north-west coast of Mallorca and reaches 4741 ft at Puig Major, about 18 nm north of the airport.

### Airports of Interest

#### LEPA (Primary Airport)
Palma de Mallorca Airport

Located 8 km east of Palma at an elevation of 27 ft. Son Bonet (LESJ), a general aviation aerodrome, lies 4 nm to the north inside the CTR.

### Deviations from Reality
- Only the SIDs of the preferential departure runways (24R and 06R) are modelled. The `DRAGO5B`, `EPAMA5B`, `ESPOR5B` and `GALAT5B` SIDs are replaced by their RNAV1 equivalents, and the contingency departures (`LEPA2A`, `LEPA3B`) are not modelled.
- Radial and DME points of the conventional procedures are computed from the navaid position and its station declination, and DME arcs are drawn as straight segments every 10°.
- The RNP approaches are not modelled; their initial segments are used as STAR transitions to the intermediate fix.
- The sector limits that follow the coastline of Mallorca and Ibiza use a coastline extracted from elevation data, simplified to about 150 m.
- Terrain contours are generated from the AWS Terrain Tiles (derived from SRTM and other public-domain elevation data) and are approximate. Minimum vectoring altitudes are computed from them and do not reproduce the published MVA chart.
- The restricted and danger areas around Mallorca are not modelled.
- Taxi times and the split of the traffic between routes and airlines are estimates.

### Additional Resources
ENAIRE AIP España, AD 2-LEPA/LESJ (https://aip.enaire.es/AIP/#LEPA/LESJ)

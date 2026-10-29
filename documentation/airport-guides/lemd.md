### About this facility
Madrid ACC / Madrid Approach (ENAIRE), Torrejón, Spain
68.2 million passengers in 2025

Madrid Approach controls the TMA MADRID, a large terminal area that reaches from the Sierra de Guadarrama in the north to La Mancha in the south and up to FL245. Barajas is the main hub of Iberia, Iberia Express, Air Nostrum (Iberia Regional), LEVEL and Air Europa, and the busiest gateway between Europe and Latin America.

### Airspace
The airspace is the TMA MADRID as published in ENR 2.1 (AIRAC 2610), up to FL245, made of its 26 sectors (TMAD-1 to TMAD-25, TMAD-CV and TMAD-MDR). Each sector has its own floor, from 3000 ft over La Mancha to 9500 ft over the Sierra de Guadarrama; only the CTR MADRID with TMAD-MDR above it reaches down to the surface around Barajas, Getafe and Cuatro Vientos. **An aircraft that descends below the floor of the sector it is in leaves the airspace**, and an arrival that does so is lost. The sector floors are shown on the scope. Below FL195 the TMA is class A and above FL195 it is class C. The transition altitude is 13000 ft, and departures are initially cleared to 13000 ft on all SIDs.

The game starts with the arrivals of the first ten minutes already inside the airspace, each on a different STAR and at a different distance; new arrivals then appear on their STAR shortly before the airspace boundary, at least 60 seconds apart. Traffic follows the 2025 average (430,616 movements, about 33 arrivals and 33 departures an hour over an 18-hour day).

### Runway Configurations
Barajas has four runways arranged as two parallel pairs: 18L/36R and 18R/36L run north-south, and 14L/32R and 14R/32L run north-west to south-east.

- **North configuration (preferential):** arrivals land on 32L and 32R, and departures use 36L and 36R.
- **South configuration:** arrivals land on 18L and 18R, and departures use 14L and 14R.

openScope uses the north configuration unless the wind gives more than 5 kt of tailwind or 20 kt of crosswind on its runways, in which case it uses the south configuration. Traffic is generated for the configuration in use.

Arrivals are assigned runways by their entry sector: traffic from the **east** lands on 32R (south: 18L), and traffic from the **west** lands on 32L (south: 18R). ILS approaches are available on 32L, 32R, 18L and 18R only.

### Instrument Procedures
All SIDs are RNAV1 and end at one of the eight TMA exit points: `BARDI`, `CCS`, `ZMR`, `SIE`, `PINAR`, `RBO`, `NANDO` and `VTB`. Each runway has its own set of procedures, identified by the last letter (for example `SIE6L` from 36L or `SIE3W` from 36R). Aircraft on the heavy-aircraft list published in the AIP must use the `X` SIDs from 36L.

STARs are grouped by configuration:

- **South configuration:** `A` STARs (`MORAL7A`, `NONTU3A`, `RIDAV3A`, `SOTUK7A`, `TLD7A`, `ZMR5A`) end at `RILKO`, while `B`/`E` STARs (`ADUXO7B`, `BANEV3B`, `PRADO8E`, `TERSA7E`, `VILLA7E`) end at `LULER`.
- **North configuration:** `C` STARs (`MORAL6C`, `NONTU5C`, `RIDAV5C`, `SOTUK5C`, `TLD4C`, `ZMR6C`) end at `FAFEQ`, while `D`/`Z` STARs (`ADUXO3D`, `BANEV5D`, `PRADO4D`, `TERSA4Z`, `VILLA4D`) end at `RUDBI`.

From the last fix of the STAR, aircraft must be vectored to the ILS.

### Ground Operations
Taxi times from the terminals to the holding points are long: about 10 minutes to 36L, 8 minutes to 36R, 7 minutes to 14L and 9 minutes to 14R (approximate unimpeded times, which vary from flight to flight).

### Terrain
The Sierra de Guadarrama rises to 7970 ft about 25 nm north-west of the airport, and the terrain north of Madrid is above 3000 ft. Minimum vectoring altitudes in openScope are 4000 ft around the airport and up to 9000 ft over the mountains.

### Airports of Interest

#### LEMD (Primary Airport)
Adolfo Suárez Madrid-Barajas Airport
68.2 million passengers (2025)

Madrid-Barajas is Spain's largest airport, located 13 km north-east of the city centre at an elevation of 1998 ft. Its four runways are among the longest in Europe; 18R/36L is 4179 m long.

#### LETO
Torrejón Air Base
5nm to the east of LEMD

A military air base of the Spanish Air and Space Force, also used by government and state flights.

#### LEGT
Getafe Air Base
14nm to the south-west of LEMD

A military air base and Airbus Defence and Space plant, where A400M and A330 MRTT aircraft can often be seen.

#### LECU
Madrid-Cuatro Vientos Airport
12nm to the south-west of LEMD

The main general aviation and flight training airfield of Madrid.

### Deviations from Reality
- Course-to-altitude (CA) and heading-to-intercept (VI) legs at the start of the SIDs are not modelled. Aircraft fly directly to the first fix once airborne.
- The RNP APCH and RNP AR approaches are not modelled, so arriving aircraft must be vectored to the ILS.
- Arcs in the TMA sector limits are drawn as straight segments every 2 degrees, and terrain is only modelled inside the TMA.
- Terrain contours are generated from the AWS Terrain Tiles (derived from SRTM and other public-domain elevation data) and are approximate. Minimum vectoring altitudes are computed from them and do not reproduce the published MVA chart.
- In the south configuration, departures to `BARDI`, `CCS`, `ZMR` and `SIE` use 14R and the others use 14L.

### Additional Resources
ENAIRE AIP España, AD 2-LEMD (https://aip.enaire.es/AIP/#LEMD)

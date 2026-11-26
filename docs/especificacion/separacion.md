<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Separación radar, estela y pistas paralelas

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## Separación radar (SEP)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="sep-001"></a>**SEP-001** | Separación radar mínima horizontal en área terminal | 3 NM | ICAO Doc 4444 8.7.3.2 b; FAA JO 7110.65 5-5-4 a | `realism/regulatoryProfiles.js (radarSeparationNm); constants/aircraftConstants.js (SEPARATION.STANDARD_LATERAL_KM = 5,556 km)` | implementado ✔︎ |
| <a id="sep-002"></a>**SEP-002** | Separación vertical mínima | 1000 ft | ICAO Doc 4444 5.3.2 (RVSM FL290-FL410) | `realism/regulatoryProfiles.js (verticalSeparationFt); constants/aircraftConstants.js (SEPARATION.VERTICAL_FT)` | implementado ✔︎ |
| <a id="sep-003"></a>**SEP-003** | Por debajo de 1000 ft AGL la separación radar no se aplica; rigen la separación en pista, la de estela y las reglas de salida | 1000 ft AGL | ICAO Doc 4444 7 (control de aeródromo) | `realism/RealismController.js (RADAR_SEPARATION_MIN_HEIGHT_FT)` | implementado |
| <a id="sep-004"></a>**SEP-004** | Una pareja que entra ya sin separación es pérdida del sector anterior; solo cuenta si sigue así pasados 60 s | 60 s | Decisión del simulador | `realism/RealismController.js (HANDOVER_GRACE_SECONDS)` | implementado |
| <a id="sep-005"></a>**SEP-005** | Una aeronave nueva solo aparece con margen extra respecto a las demás | separación radar + 5 NM, vertical + 1000 ft | Decisión del simulador | `realism/RealismController.js (SPAWN_SEPARATION_MARGIN)` | implementado |
| <a id="sep-006"></a>**SEP-006** | Los conflictos se comprueban cada segundo de juego | 1 s | Decisión del simulador | `realism/RealismController.js (CHECK_INTERVAL_SECONDS)` | implementado |
| <a id="sep-007"></a>**SEP-007** | Separación en la salida entre una salida y una llegada a la misma pista | 2 NM (la llegada al umbral) | ICAO Doc 4444 7.11.3; FAA JO 7110.65 3-9-6 | `realism/regulatoryProfiles.js (arrivalDepartureSeparationNm)` | implementado ✔︎ |

**Notas**

- **SEP-001:** En ruta la norma es 5 NM, pero el simulador solo representa áreas terminales.
- **SEP-002:** Tolerancia de 50 ft por la resolución del modo C mientras la aeronave se estabiliza (VERTICAL_SEPARATION_TOLERANCE_FT).

## Estela turbulenta (WAK)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="wak-001"></a>**WAK-001** | Esquema de estela según el perfil normativo del aeropuerto | EASA → RECAT-EU; ICAO → categorías ICAO (J/H/M/L); FAA → categorías FAA | ICAO Doc 4444 4.9; RECAT-EU (Eurocontrol); FAA JO 7110.65 5-5-4 | `realism/regulatoryProfiles.js (wakeScheme)` | implementado ✔︎ |
| <a id="wak-002"></a>**WAK-002** | Separación por estela en la aproximación, RECAT-EU (líder → seguidor; sin valor = solo separación radar) | ver tabla WAK-002 | RECAT-EU (Eurocontrol, 2015) | `realism/wakeTurbulence.js (RECAT_EU_ARRIVAL_NM)` | implementado ✔︎ |
| <a id="wak-003"></a>**WAK-003** | Separación por estela en la salida, RECAT-EU | ver tabla WAK-003 | RECAT-EU (Eurocontrol, 2015) | `realism/wakeTurbulence.js (RECAT_EU_DEPARTURE_SECONDS)` | implementado ✔︎ |
| <a id="wak-004"></a>**WAK-004** | Separación por estela en la aproximación, ICAO | ver tabla WAK-004 | ICAO Doc 4444 8.7.3.4 | `realism/wakeTurbulence.js (ICAO_ARRIVAL_NM)` | implementado ✔︎ |
| <a id="wak-005"></a>**WAK-005** | Separación por estela en la salida, ICAO | ver tabla WAK-005 | ICAO Doc 4444 5.8.3 | `realism/wakeTurbulence.js (ICAO_DEPARTURE_SECONDS)` | implementado ✔︎ |
| <a id="wak-006"></a>**WAK-006** | Separación por estela en la aproximación, FAA | ver tabla WAK-006 | FAA JO 7110.65 5-5-4 | `realism/wakeTurbulence.js (FAA_ARRIVAL_NM)` | implementado ✔︎ |
| <a id="wak-007"></a>**WAK-007** | Separación por estela en la salida, FAA | ver tabla WAK-007 | FAA JO 7110.65 3-9-6 | `realism/wakeTurbulence.js (FAA_DEPARTURE_SECONDS)` | implementado ✔︎ |
| <a id="wak-008"></a>**WAK-008** | Categoría por defecto cuando el archivo de la aeronave no la declara | RECAT-EU desde ICAO: J→A, H→B, M→D, L→F. FAA desde ICAO: J→SUPER, H→HEAVY, M→LARGE, L→SMALL | Aproximación del motor | `realism/wakeTurbulence.js (getWakeCategory)` | implementado |

### WAK-002: Separación por estela en la aproximación, RECAT-EU (líder → seguidor; sin valor = solo separación radar)

| Líder ↓ / seguidor → (NM) | A | B | C | D | E | F |
|---|---:|---:|---:|---:|---:|---:|
| **A** | 3 | 4 | 5 | 5 | 6 | 8 |
| **B** | — | 3 | 4 | 4 | 5 | 7 |
| **C** | — | — | 3 | 3 | 4 | 6 |
| **D** | — | — | — | — | — | 5 |
| **E** | — | — | — | — | — | 4 |
| **F** | — | — | — | — | — | 3 |

### WAK-003: Separación por estela en la salida, RECAT-EU

| Líder ↓ / seguidor → (s) | B | C | D | E | F |
|---|---:|---:|---:|---:|---:|
| **A** | 100 | 120 | 140 | 160 | 180 |
| **B** | — | — | 100 | 120 | 140 |
| **C** | — | — | 80 | 100 | 120 |
| **D** | — | — | — | — | 120 |
| **E** | — | — | — | — | 100 |
| **F** | — | — | — | — | 80 |

### WAK-004: Separación por estela en la aproximación, ICAO

| Líder ↓ / seguidor → (NM) | H | M | L |
|---|---:|---:|---:|
| **J** | 6 | 7 | 8 |
| **H** | 4 | 5 | 6 |
| **M** | — | — | 5 |

### WAK-005: Separación por estela en la salida, ICAO

| Líder ↓ / seguidor → (s) | H | M | L |
|---|---:|---:|---:|
| **J** | 120 | 180 | 180 |
| **H** | — | 120 | 120 |
| **M** | — | — | 120 |

### WAK-006: Separación por estela en la aproximación, FAA

| Líder ↓ / seguidor → (NM) | HEAVY | B757 | LARGE | SMALL |
|---|---:|---:|---:|---:|
| **SUPER** | 6 | 7 | 7 | 8 |
| **HEAVY** | 4 | 5 | 5 | 6 |
| **B757** | — | — | — | 4 |
| **LARGE** | — | — | — | 4 |

### WAK-007: Separación por estela en la salida, FAA

| Líder ↓ / seguidor → (s) | HEAVY | B757 | LARGE | SMALL |
|---|---:|---:|---:|---:|
| **SUPER** | 180 | 180 | 180 | 180 |
| **HEAVY** | — | 120 | 120 | 120 |
| **B757** | — | — | — | 120 |

## Pistas paralelas (PAR)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="par-001"></a>**PAR-001** | Pistas paralelas a menos de 2500 ft se tratan como una sola pista a efectos de estela | 2500 ft | ICAO Doc 4444 5.8.2; FAA JO 7110.65 5-8-4 | `realism/RealismController.js (DEPENDENT_PARALLEL_RUNWAY_FT)` | implementado |
| <a id="par-002"></a>**PAR-002** | Aproximaciones paralelas independientes (sin separación entre las dos aeronaves una vez establecidas en sus localizadores) si los ejes están al menos a esta distancia | EASA e ICAO 3400 ft (1035 m); FAA 4300 ft | ICAO Doc 4444 6.7.3.2.1 (modo 1); FAA JO 7110.65 5-9-7 | `realism/regulatoryProfiles.js (independentParallelApproachFt)` | implementado ✔︎ |
| <a id="par-003"></a>**PAR-003** | Salidas simultáneas desde pistas paralelas separadas si sus rumbos divergen al menos 15°, dentro de 10 NM del aeropuerto | 15° / 10 NM | ICAO Doc 4444 6.7.3.2.3; FAA JO 7110.65 5-8-3 | `realism/regulatoryProfiles.js (parallelDepartureDivergenceDeg); realism/RealismController.js (DEPARTURE_DIVERGENCE_RADIUS_NM)` | implementado ✔︎ |

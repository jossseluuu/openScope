<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Aeronaves: velocidades, rendimiento y aproximación

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## Velocidades (VEL)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="vel-001"></a>**VEL-001** | Límite de velocidad por debajo de 10 000 ft | 250 kt IAS | SERA.6001 y anexo (Europa); FAA 14 CFR 91.117 | `aircraft/AircraftModel.js (límite bajo 10 000 ft)` | implementado |
| <a id="vel-002"></a>**VEL-002** | En los últimos 1000 ft antes del nivel autorizado, ascensos y descensos a 1500 ft/min como máximo (salvo orden expedita, despegue o RA) | 1500 ft/min en los últimos 1000 ft | ICAO Doc 8168 Vol I (procedimientos ACAS, evitar RA innecesarios con tráfico a 1000 ft); obligatorio para operadores en Europa | `constants/aircraftConstants.js (PERFORMANCE.LEVEL_OFF_BAND_FT, LEVEL_OFF_MAX_RATE_FPM); aircraft/AircraftModel.js; bot/botA/conflictResolution.js (altitudeTowardLevel)` | implementado ✔︎ |

**Notas**

- **VEL-001:** El motor lo aplica a todas las aeronaves, sin excepciones por clase de espacio aéreo.
- **VEL-002:** Añadida el 2026-11-20 al activar el TCAS. Sin ella casi todos los RA eran nivelaciones a 1000 ft de otra aeronave (el clásico level-off RA).

## Rendimiento de las aeronaves (PER)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="per-001"></a>**PER-001** | Régimen de viraje estándar | 3 °/s | ICAO Doc 8168 (viraje de régimen 1) | `constants/aircraftConstants.js (PERFORMANCE.TURN_RATE, en rad/s)` | implementado ✔︎ |
| <a id="per-002"></a>**PER-002** | Fracción de la tasa máxima de ascenso que se usa normalmente | 0.7 | Aproximación del motor | `constants/aircraftConstants.js (PERFORMANCE.TYPICAL_CLIMB_FACTOR)` | implementado ✔︎ |
| <a id="per-003"></a>**PER-003** | Fracción de la tasa máxima de descenso que se usa normalmente | 0.7 | Aproximación del motor | `constants/aircraftConstants.js (PERFORMANCE.TYPICAL_DESCENT_FACTOR)` | implementado ✔︎ |
| <a id="per-004"></a>**PER-004** | Factor de deceleración en tierra con frenos | 3.5 | Aproximación del motor | `constants/aircraftConstants.js (PERFORMANCE.DECELERATION_FACTOR_DUE_TO_GROUND_BRAKING)` | implementado ✔︎ |
| <a id="per-005"></a>**PER-005** | Altura mínima para iniciar un viraje tras el despegue | 400 ft AGL | ICAO Doc 8168 Vol II (altura mínima de viraje 120 m / 394 ft) | `constants/aircraftConstants.js (PERFORMANCE.TAKEOFF_TURN_ALTITUDE)` | implementado ✔︎ |
| <a id="per-006"></a>**PER-006** | Distancia de anticipación máxima para virar antes de un punto de recorrido (fly-by) | 5 NM | Aproximación del motor | `constants/aircraftConstants.js (PERFORMANCE.MAXIMUM_DISTANCE_TO_FLY_BY_WAYPOINT_NM)` | implementado ✔︎ |

## Aproximación y aterrizaje (APP)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="app-001"></a>**APP-001** | Una aeronave está establecida en el localizador si está a menos de ~500 ft del eje y con menos de 5° de diferencia de rumbo | 0,0822894 NM y 5° | Aproximación del motor | `constants/aircraftConstants.js (PERFORMANCE.MAXIMUM_DISTANCE_CONSIDERED_ESTABLISHED_ON_APPROACH_COURSE_NM, MAXIMUM_ANGLE_CONSIDERED_ESTABLISHED_ON_APPROACH_COURSE)` | implementado ✔︎ |
| <a id="app-002"></a>**APP-002** | Una aeronave está establecida en la senda de planeo si está a menos de 100 ft de ella | 100 ft | Aproximación del motor | `constants/aircraftConstants.js (PERFORMANCE.MAXIMUM_ALTITUDE_DIFFERENCE_CONSIDERED_ESTABLISHED_ON_GLIDEPATH)` | implementado ✔︎ |
| <a id="app-003"></a>**APP-003** | Puerta de aproximación estabilizada | 1000 ft sobre el umbral | Flight Safety Foundation ALAR; criterios de aproximación estabilizada de los operadores | `constants/aircraftConstants.js (PERFORMANCE.STABILIZED_APPROACH_HEIGHT_FT)` | implementado ✔︎ |
| <a id="app-004"></a>**APP-004** | Altitud mínima de descenso de la aproximación instrumental (equivale a la DH de una CAT I) | 200 ft | ICAO Anexo 6 / Doc 9365 (CAT I, DH 200 ft) | `constants/aircraftConstants.js (PERFORMANCE.INSTRUMENT_APPROACH_MINIMUM_DESCENT_ALTITUDE)` | implementado ✔︎ |
| <a id="app-005"></a>**APP-005** | Si la pista no está libre a 200 ft sobre el umbral, el piloto hace la frustrada | 200 ft | Altura de decisión típica | `realism/RealismController.js (RUNWAY_CLEAR_DECISION_HEIGHT_FT)` | implementado |
| <a id="app-006"></a>**APP-006** | Separación radar mínima en la aproximación final | EASA 2,5 NM (RECAT-EU, separación radar mínima reducida); ICAO y FAA 3 NM | ICAO Doc 4444 8.7.3.2; RECAT-EU; FAA JO 7110.65 5-5-4 | `realism/regulatoryProfiles.js (finalApproachSeparationNm)` | implementado ✔︎ |
| <a id="app-007"></a>**APP-007** | Tiempo de ocupación de pista en el aterrizaje por categoría RECAT-EU (varía entre el 90 % y el 120 % según la salida y el frenado) | ver tabla APP-007 | Aproximación del motor | `realism/wakeTurbulence.js (LANDING_RUNWAY_OCCUPANCY_SECONDS)` | implementado ✔︎ |

### APP-007: Tiempo de ocupación de pista en el aterrizaje por categoría RECAT-EU (varía entre el 90 % y el 120 % según la salida y el frenado)

| Clave | Valor (s) |
|---|---|
| A | 70 |
| B | 62 |
| C | 58 |
| D | 52 |
| E | 50 |
| F | 45 |

**Notas**

- **APP-003:** Margen lateral de 0,5 NM (STABILIZED_APPROACH_MARGIN_NM) y velocidad hasta 20 kt sobre la de aterrizaje (realism/RealismController.js, STABILIZED_APPROACH_SPEED_MARGIN_KT). Fuera de criterios, frustrada.
- **APP-004:** Las categorías II y III llegan con la visibilidad (#6b).

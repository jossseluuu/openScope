<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Puntuación y niveles de las reglas

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## Puntuación y niveles de las reglas (SCO)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="sco-001"></a>**SCO-001** | Niveles de las reglas (prioridad lexicográfica) | 0 seguridad > 1 separación > 2 procedimiento > 3 eficiencia > 4 entorno | Decisión de diseño (rulebook) | `realism/Rulebook.js (RULE_TIER)` | implementado ✔︎ |
| <a id="sco-002"></a>**SCO-002** | Puntos por evento del juego | ver tabla SCO-002 | Decisión del simulador | `game/GameController.js (GAME_EVENTS_POINT_VALUES)` | implementado ✔︎ |
| <a id="sco-003"></a>**SCO-003** | Reglas del rulebook, su nivel y su referencia normativa | ver tabla SCO-003 | realism/Rulebook.js | `realism/Rulebook.js (RULE)` | implementado ✔︎ |
| <a id="sco-004"></a>**SCO-004** | Puntuación de los eventos nuevos (valores provisionales, aceptados por defecto el 2026-11-20) | ver tabla SCO-004 | Propuesta aceptada por defecto el 2026-11-20 | `game/GameController.js (GAME_EVENTS_POINT_VALUES)` | implementado |

### SCO-002: Puntos por evento del juego

| Clave | Valor (puntos) |
|---|---|
| ARRIVAL | 10 |
| DEPARTURE | 10 |
| EMERGENCY_DECLARED | 0 |
| EMERGENCY_LANDING | 50 |
| HIGH_CROSSWIND_OPERATION | -5 |
| ILLEGAL_APPROACH_CLEARANCE | -10 |
| LOCALIZER_INTERCEPT_ABOVE_GLIDESLOPE | -10 |
| EXTREME_CROSSWIND_OPERATION | -15 |
| HIGH_TAILWIND_OPERATION | -25 |
| NOT_CLEARED_ON_ROUTE | -25 |
| GO_AROUND | -50 |
| DIVERSION | -50 |
| TAKEOFF_CANCEL_UNJUSTIFIED | -50 |
| EXTREME_TAILWIND_OPERATION | -75 |
| WAKE_SEPARATION_LOSS | -100 |
| WEATHER_PENETRATION | -100 |
| MINIMUM_ALTITUDE_VIOLATION | -150 |
| TCAS_RA | -150 |
| AIRSPACE_BUST | -200 |
| NO_TAKEOFF_SEPARATION | -200 |
| RESTRICTED_AREA_ENTRY | -200 |
| SEPARATION_LOSS | -200 |
| EMERGENCY_DEADLINE_MISSED | -300 |
| INSTRUCTION_CONTRARY_TO_RA | -300 |
| RUNWAY_INCURSION | -500 |
| COLLISION | -1000 |

### SCO-003: Reglas del rulebook, su nivel y su referencia normativa

| Clave | Valor |
|---|---|
| RUNWAY_INCURSION | 0 · ICAO Doc 4444 7.10.1, 7.11.1; FAA JO 7110.65 3-9-6, 3-10-3 |
| TERRAIN_COLLISION | 0 · ICAO Doc 4444 8.6.5.2 |
| MINIMUM_ALTITUDE | 0 · ICAO Doc 4444 8.6.5.2; FAA JO 7110.65 5-6-1 |
| RADAR_SEPARATION | 1 · ICAO Doc 4444 8.7.3; FAA JO 7110.65 5-5-4 |
| FINAL_APPROACH_SEPARATION | 1 · ICAO Doc 4444 8.7.3.2; RECAT-EU reduced MRS; FAA JO 7110.65 5-5-4 |
| WAKE_ARRIVAL | 1 · ICAO Doc 4444 8.7.3.4; RECAT-EU; FAA JO 7110.65 5-5-4 |
| WAKE_DEPARTURE | 1 · ICAO Doc 4444 5.8.3; RECAT-EU; FAA JO 7110.65 3-9-6 |
| EMERGENCY_DEADLINE | 1 · ICAO Doc 4444 15.1.1, 15.1.3 (priority to aircraft in emergency); FAA JO 7110.65 10-2-5 |
| ARRIVAL_DEPARTURE | 1 · ICAO Doc 4444 7.11.3; FAA JO 7110.65 3-9-6 |
| TCAS_RA | 1 · ICAO Annex 10 Vol IV 4; ICAO Doc 4444 15.7.3 |
| INSTRUCTION_CONTRARY_TO_RA | 0 · ICAO Doc 4444 15.7.3.2 |
| WEATHER_PENETRATION | 1 · ICAO Doc 4444 8.6.9 (weather deviations); ICAO Doc 9137 |
| RUNWAY_WIND_LIMIT | 2 · ICAO Doc 4444 7.2.3 |
| TAKEOFF_CANCEL_UNJUSTIFIED | 2 · ICAO Doc 4444 7.9; cancellation of a takeoff clearance |
| GO_AROUND | 3 · ICAO Doc 8168 Vol I; stabilized approach criteria |
| DIVERSION | 3 · ICAO Annex 6 Part I 4.4.1 (aerodrome operating minima) |

### SCO-004: Puntuación de los eventos nuevos (valores provisionales, aceptados por defecto el 2026-11-20)

| Clave | Valor (puntos) |
|---|---|
| TCAS_RA | -150 |
| INSTRUCTION_CONTRARY_TO_RA | -300 |
| WEATHER_PENETRATION | -100 |
| DIVERSION | -50 |

**Notas**

- **SCO-002:** Una pérdida de separación (-200) borra unos 20 movimientos; por eso los bots se juzgan por la puntuación total.
- **SCO-004:** Valores provisionales; están también en SCO-002.

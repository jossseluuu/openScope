<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Unidades, atmósfera y viento

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## Unidades y referencias (UNI)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="uni-001"></a>**UNI-001** | Las distancias se muestran en millas náuticas; internamente el motor trabaja en kilómetros | 1 NM = 1,852 km | ICAO Anexo 5 | `constants/globalConstants.js (PHYSICS_CONSTANTS)` | implementado ✔︎ |
| <a id="uni-002"></a>**UNI-002** | Las altitudes de las aeronaves son en pies sobre el nivel del mar; los suelos y techos del espacio aéreo, en niveles de vuelo (centenas de pies) | ft MSL / FL | ICAO Anexo 5; formato de aeropuerto | `airport/AirspaceModel.js` | implementado |
| <a id="uni-003"></a>**UNI-003** | Los rumbos que ve el jugador son magnéticos; cada aeropuerto declara su declinación (positiva al este) | magnetic_north grados | Formato de aeropuerto | `airport/AirportModel.js (magneticNorth)` | implementado |
| <a id="uni-004"></a>**UNI-004** | Las velocidades que se ordenan son indicadas (IAS) | IAS kt | ICAO Doc 4444 4.6 | `aircraft/AircraftModel.js (speed)` | implementado |
| <a id="uni-005"></a>**UNI-005** | Reglaje altimétrico por defecto (atmósfera estándar) | 29.92 inHg (1013,25 hPa) | ICAO Doc 7488 | `constants/aircraftConstants.js (PERFORMANCE.DEFAULT_ALTIMETER_IN_INHG)` | implementado ✔︎ |

**Notas**

- **UNI-001:** El radio terrestre en NM (3440) se usa para las conversiones; en km es 6370,88.
- **UNI-005:** No hay QNH variable ni altitud de transición; todo se trata como altitud. Llega con la meteorología (#6).

## Atmósfera y viento (ATM)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="atm-001"></a>**ATM-001** | La velocidad verdadera (TAS) crece linealmente con la altitud a partir de la indicada | TAS = IAS × (1 + 0,000016 × altitud) +1,6 % por cada 1000 ft | Aproximación del motor (regla práctica ≈ 2 % por 1000 ft) | `aircraft/AircraftModel.js (updateGroundSpeedPhysics), constants/environmentConstants.js (DENSITY_ALT_INCREASE_FACTOR_PER_FT)` | parcial ✔︎ |
| <a id="atm-002"></a>**ATM-002** | El viento crece con la altitud a partir del de superficie | +2 % por cada 1000 ft | Aproximación del motor | `airport/AirportModel.js (getWindAtAltitude), constants/environmentConstants.js (WIND_INCREASE_FACTOR_PER_FT)` | parcial ✔︎ |
| <a id="atm-003"></a>**ATM-003** | El viento se suma como vector a la velocidad verdadera; la aeronave corrige la deriva (ángulo de corrección) | GS = TAS + viento (vectorial) | Navegación aérea | `aircraft/AircraftModel.js (updateGroundSpeedPhysics, corrección de deriva)` | implementado |
| <a id="atm-004"></a>**ATM-004** | Atmósfera estándar internacional (ISA) de referencia | 15 °C y 1013,25 hPa al nivel del mar; -1,98 °C por 1000 ft; tropopausa a 36 089 ft | ICAO Doc 7488 | `—` | referencia |

**Notas**

- **ATM-001:** Auditoría 2026-11-20. El comentario del código dice "0,16 % por mil pies" pero el valor es 1,6 %. Frente a la atmósfera estándar (ISA) se queda corto en altura: a FL240 la TAS real es ≈ IAS × 1,45 y el motor da × 1,38; a FL390 la real es ≈ × 2,0 y el motor da × 1,62. No modela temperatura ni Mach.
- **ATM-002:** La dirección no cambia con la altura. El perfil por capas llega con la meteorología dinámica (#6).
- **ATM-003:** En tierra la trayectoria se fija al eje de pista para que el viento no saque a la aeronave.
- **ATM-004:** No se usa todavía en el motor; servirá para corregir ATM-001.

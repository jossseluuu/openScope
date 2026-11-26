<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Salidas, torre y emergencias

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## Salidas y torre (DEP)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="dep-001"></a>**DEP-001** | Límites de viento para elegir pista | cola 5 kt, cruzado 20 kt | ICAO Doc 4444 7.2.3 (pistas preferentes por ruido) | `realism/regulatoryProfiles.js (maxTailwindKt, maxCrosswindKt); realism/runwayConfiguration.js` | implementado ✔︎ |
| <a id="dep-002"></a>**DEP-002** | V1 para cancelar un despegue | 0,9 × velocidad mínima de la aeronave | Aproximación del motor (decisión del usuario 2026-10-31) | `realism/takeoffCancel.js (V1_FACTOR)` | implementado ✔︎ |
| <a id="dep-003"></a>**DEP-003** | Tiempos de la cancelación de despegue | deceleración 4 kt/s; 45 s para liberar la pista; 120 s hasta estar lista de nuevo; por encima de 80 kt, 60 s más (frenos calientes) | Aproximación del motor | `realism/takeoffCancel.js (TAKEOFF_CANCEL)` | implementado ✔︎ |
| <a id="dep-004"></a>**DEP-004** | Una cancelación está justificada por una llegada a la misma pista más cerca que el mínimo + 1 NM, o por una emergencia que aterriza en ella en menos de 240 s | 1 NM / 240 s | ICAO Doc 4444 7.9 | `realism/takeoffCancel.js (ARRIVAL_MARGIN_NM, EMERGENCY_PROTECTION_SECONDS)` | implementado |
| <a id="dep-005"></a>**DEP-005** | La torre automática libera una salida al menos 90 s después de otro despegue y 120 s después de otro por la misma SID, y no con llegadas a menos del mínimo + 2 NM | 90 s / 120 s / +2 NM | Decisión del simulador | `realism/RealismController.js (AUTO_TOWER_*)` | implementado |
| <a id="dep-006"></a>**DEP-006** | Tiempo de rodaje por defecto hasta la pista (varía entre el 85 % y el 125 %) | 300 s | Decisión del simulador; cada aeropuerto puede fijarlo por pista (taxiTimes) | `realism/taxiTimes.js (DEFAULT_TAXI_TIME_SECONDS)` | implementado ✔︎ |
| <a id="dep-007"></a>**DEP-007** | Dos salidas consecutivas de la misma pista con un minuto de separación necesitan rumbos que diverjan al menos 45° | 45 ° | ICAO Doc 4444 5.6 (separación de aeronaves que salen) | `bot/botA (regla de salidas del Bot A)` | implementado |

**Notas**

- **DEP-007:** Regla que aplican los bots; el motor no la penaliza por sí misma.

## Emergencias (EMG)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="emg-001"></a>**EMG-001** | Probabilidad de que una llegada declare emergencia (opción del juego) | no / rara 1 % (por defecto) / ocasional 3 % / frecuente 10 % | Decisión del usuario (2026-10-31) | `realism/EmergencyController.js` | implementado |
| <a id="emg-002"></a>**EMG-002** | Momento de la declaración, entre 60 y 720 s después de aparecer, salvo si ya está en final corta (autorizada a menos de 12 NM) | 60-720 s; 12 NM | Decisión del simulador | `realism/EmergencyController.js (DECLARATION_WINDOW_SECONDS, SHORT_FINAL_NM)` | implementado |
| <a id="emg-003"></a>**EMG-003** | Plazo para aterrizar una emergencia = estimación de una aproximación directa (200 kt + 240 s de circuito) + 600 s de margen | 200 kt; 240 s; +600 s | Decisión del simulador | `realism/EmergencyController.js (DEADLINE_ESTIMATE, DEADLINE_MARGIN_SECONDS)` | implementado |
| <a id="emg-004"></a>**EMG-004** | Los pilotos en emergencia rechazan esperas y cambios de código transpondedor, y descienden de forma expedita | — | ICAO Doc 4444 15.1 | `realism/EmergencyController.js; bot/actionSpace.js (isExpeditedDescent)` | implementado |

**Notas**

- **EMG-001:** Solo las llegadas declaran emergencias; generador aleatorio propio (semilla + 7700) para no cambiar el tráfico.

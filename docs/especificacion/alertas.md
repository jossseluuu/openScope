<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Alertas de colisión (STCA y TCAS)

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## STCA (alerta de conflicto en tierra) (STC)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="stc-001"></a>**STC-001** | Horizonte y paso de la predicción del STCA (lineal, respetando la altitud autorizada) | 120 s, pasos de 5 s | Eurocontrol, especificación STCA (horizonte típico de 2 minutos) | `safety/safetyNetLogic.js (STCA)` | implementado ✔︎ |
| <a id="stc-002"></a>**STC-002** | Niveles de alerta del STCA | preventiva (ámbar) si la separación se perderá en ≤ 120 s; alerta (rojo) si en ≤ 60 s o ya perdida | Eurocontrol, especificación STCA | `safety/safetyNetLogic.js (STCA.ALERT_SECONDS, stcaLevel)` | implementado ✔︎ |
| <a id="stc-003"></a>**STC-003** | El STCA usa las mínimas del perfil normativo (radar y vertical - 50 ft), solo entre aeronaves controladas por encima de 1000 ft AGL, y no avisa de parejas separadas por otros medios (misma final, paralelas independientes, salidas divergentes) | mínimas de SEP-001/SEP-002; exenciones de la regla de separación | ICAO Doc 4444 8.7; decisión del simulador | `safety/SafetyNetController.js (_updateStca)` | implementado |

**Notas**

- **STC-003:** El STCA no puntúa; avisa. La penalización sigue siendo la pérdida de separación.

## TCAS II / ACAS II (TCA)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="tca-001"></a>**TCA-001** | Umbrales de TCAS II v7.1 por nivel de sensibilidad (tau en s, DMOD en NM, ZTHR y ALIM en ft; TA / RA) | ver tabla TCA-001 | RTCA DO-185B; Eurocontrol ACAS II Guide (verificar contra la guía antes de cambiarlos) | `safety/safetyNetLogic.js (TCAS_SENSITIVITY_LEVELS)` | implementado ✔︎ |
| <a id="tca-002"></a>**TCA-002** | Inhibiciones de RA | sin RA por debajo de 1000 ft AGL (solo TA); sin RA de descenso por debajo de 1100 ft AGL; sin RA de ascenso en el techo de la aeronave | Eurocontrol ACAS II Guide | `safety/safetyNetLogic.js (TCAS.RA_MINIMUM_HEIGHT_AGL, DESCEND_RA_MINIMUM_HEIGHT_AGL, coordinatedSenses)` | implementado ✔︎ |
| <a id="tca-003"></a>**TCA-003** | Respuesta del piloto a un RA de ascenso o descenso, tras su tiempo de reacción; un RA de nivelar mantiene la altitud actual | 1500 ft/min tras 5 s | ICAO Doc 8168 Vol I (respuesta a RA); Eurocontrol ACAS II Guide | `safety/safetyNetLogic.js (TCAS.RA_VERTICAL_SPEED_FPM, PILOT_REACTION_SECONDS); aircraft/AircraftModel.js (_applyResolutionAdvisory)` | implementado ✔︎ |
| <a id="tca-004"></a>**TCA-004** | Coordinación y fin del RA | sentidos complementarios (la de arriba asciende, la de abajo desciende, sin cruzarse); 'clear of conflict' tras 3 s sin amenaza y vuelta a la última autorización | ICAO Anexo 10 Vol IV; Doc 4444 15.7.3 | `safety/SafetyNetController.js (_updateTcasOf, _clearOfConflict)` | implementado ✔︎ |
| <a id="tca-005"></a>**TCA-005** | Un RA puntúa una vez por encuentro (la separación ya había fallado antes) | TCAS_RA | Decisión del simulador (SCO-004) | `realism/Rulebook.js (TCAS_RA); safety/SafetyNetController.js (_issueRa)` | implementado |
| <a id="tca-006"></a>**TCA-006** | Durante un RA la tripulación rechaza toda orden de altitud ('unable, TCAS RA'); una orden contraria al RA es una violación de seguridad. Los bots no pueden dar órdenes verticales a una aeronave en RA | INSTRUCTION_CONTRARY_TO_RA | ICAO Doc 4444 15.7.3.2 | `aircraft/AircraftCommander.js (runAltitude); realism/RealismController.js (_onContraryToRa); bot/safetyShield.js` | implementado |
| <a id="tca-007"></a>**TCA-007** | Equipamiento TCAS II | todas las aeronaves salvo las de estela ligera (L) | Mandato ACAS II en Europa (más de 5700 kg o 19 asientos), aproximado por la categoría de estela | `safety/SafetyNetController.js (hasTcas)` | implementado |

### TCA-001: Umbrales de TCAS II v7.1 por nivel de sensibilidad (tau en s, DMOD en NM, ZTHR y ALIM en ft; TA / RA)

| Clave | Valor |
|---|---|
| SL2 | < 1000 ft AGL · tau 20 / — · DMOD 0,30 / — · ZTHR 850 / — · ALIM — |
| SL3 | 1000-2350 ft AGL · tau 25 / 15 · DMOD 0,33 / 0,20 · ZTHR 850 / 600 · ALIM 300 |
| SL4 | 2350 ft AGL-5000 ft · tau 30 / 20 · DMOD 0,48 / 0,35 · ZTHR 850 / 600 · ALIM 300 |
| SL5 | 5000-10 000 ft · tau 40 / 25 · DMOD 0,75 / 0,55 · ZTHR 850 / 600 · ALIM 350 |
| SL6 | 10 000-20 000 ft · tau 45 / 30 · DMOD 1,00 / 0,80 · ZTHR 850 / 600 · ALIM 400 |
| SL7 | 20 000-42 000 ft · tau 48 / 35 · DMOD 1,30 / 1,10 · ZTHR 850 / 700 · ALIM 600 |

## MSAW (aviso de altitud mínima) (MSW)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="msw-001"></a>**MSW-001** | MSAW avisa si una aeronave controlada estará más de 100 ft por debajo de la MVA en los próximos 30 s (salvo en final y salidas a menos de 10 NM del aeropuerto, y si no está descendiendo) | 30 s; tolerancia 100 ft | FAA JO 7110.65 5-15 (MSAW); Eurocontrol (MSAW) | `safety/safetyNetLogic.js (AREA_WARNINGS, timeBelowMinimumAltitude); safety/SafetyNetController.js` | implementado ✔︎ |

**Notas**

- **MSW-001:** Solo en aeropuertos con terreno. No puntúa; lo que puntúa es MINIMUM_ALTITUDE_VIOLATION.

## APW (aviso de proximidad a zona restringida) (APW)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="apw-001"></a>**APW-001** | APW avisa si una aeronave controlada entrará en una zona restringida por debajo de su techo en los próximos 60 s | 60 s | Eurocontrol (Area Proximity Warning) | `safety/safetyNetLogic.js (AREA_WARNINGS, timeToAreaEntry); safety/SafetyNetController.js` | implementado ✔︎ |

**Notas**

- **APW-001:** No puntúa; lo que puntúa es RESTRICTED_AREA_ENTRY.

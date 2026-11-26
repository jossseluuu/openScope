<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Hoja de especificaciones físicas y reglas de dominio

Una única fuente de verdad con las constantes físicas y las reglas ATC del simulador: valor, unidad, norma de la que salen, dónde están implementadas y si un test comprueba que el código coincide.

- **Fuente:** `docs/especificacion/reglas.yaml`. Estas páginas se generan con `node tools/docs/generate-spec.js`; CI falla si no están al día.
- **Comprobación:** `test/spec/reglas.spec.js` compara cada regla que tiene `check` con el valor del código.
- **Identificadores:** `DOMINIO-NNN`. Son estables: el código y los tests los citan en comentarios (por ejemplo `// SEP-002`). No se reutiliza un identificador borrado.

## Resumen

85 reglas: 82 implementado, 2 parcial, 1 referencia; 51 comprobadas contra el código.

| Dominio | Página |
|---|---|
| UNI — Unidades y referencias | [Unidades, atmósfera y viento](unidades-atmosfera.md) |
| ATM — Atmósfera y viento | [Unidades, atmósfera y viento](unidades-atmosfera.md) |
| VEL — Velocidades | [Aeronaves: velocidades, rendimiento y aproximación](aeronaves.md) |
| PER — Rendimiento de las aeronaves | [Aeronaves: velocidades, rendimiento y aproximación](aeronaves.md) |
| APP — Aproximación y aterrizaje | [Aeronaves: velocidades, rendimiento y aproximación](aeronaves.md) |
| SEP — Separación radar | [Separación radar, estela y pistas paralelas](separacion.md) |
| WAK — Estela turbulenta | [Separación radar, estela y pistas paralelas](separacion.md) |
| PAR — Pistas paralelas | [Separación radar, estela y pistas paralelas](separacion.md) |
| DEP — Salidas y torre | [Salidas, torre y emergencias](operaciones.md) |
| ASP — Espacio aéreo | [Espacio aéreo y terreno](espacio-aereo-terreno.md) |
| TER — Terreno y altitudes mínimas | [Espacio aéreo y terreno](espacio-aereo-terreno.md) |
| EMG — Emergencias | [Salidas, torre y emergencias](operaciones.md) |
| SCO — Puntuación y niveles de las reglas | [Puntuación y niveles de las reglas](puntuacion.md) |
| STC — STCA (alerta de conflicto en tierra) | [Alertas de colisión (STCA y TCAS)](alertas.md) |
| TCA — TCAS II / ACAS II | [Alertas de colisión (STCA y TCAS)](alertas.md) |
| MSW — MSAW (aviso de altitud mínima) | [Alertas de colisión (STCA y TCAS)](alertas.md) |
| APW — APW (aviso de proximidad a zona restringida) | [Alertas de colisión (STCA y TCAS)](alertas.md) |
| MET — Meteorología | [Meteorología](meteorologia.md) |

## Matriz de trazabilidad

| Regla | Enunciado | Estado | Test |
|---|---|---|---|
| [UNI-001](unidades-atmosfera.md#uni-001) | Las distancias se muestran en millas náuticas; internamente el motor trabaja en kilómetros | implementado | sí |
| [UNI-002](unidades-atmosfera.md#uni-002) | Las altitudes de las aeronaves son en pies sobre el nivel del mar; los suelos y techos del espacio aéreo, en niveles de vuelo (centenas de pies) | implementado | — |
| [UNI-003](unidades-atmosfera.md#uni-003) | Los rumbos que ve el jugador son magnéticos; cada aeropuerto declara su declinación (positiva al este) | implementado | — |
| [UNI-004](unidades-atmosfera.md#uni-004) | Las velocidades que se ordenan son indicadas (IAS) | implementado | — |
| [UNI-005](unidades-atmosfera.md#uni-005) | Reglaje altimétrico por defecto (atmósfera estándar) | implementado | sí |
| [ATM-001](unidades-atmosfera.md#atm-001) | La velocidad verdadera (TAS) crece linealmente con la altitud a partir de la indicada | parcial | sí |
| [ATM-002](unidades-atmosfera.md#atm-002) | El viento crece con la altitud a partir del de superficie | parcial | sí |
| [ATM-003](unidades-atmosfera.md#atm-003) | El viento se suma como vector a la velocidad verdadera; la aeronave corrige la deriva (ángulo de corrección) | implementado | — |
| [ATM-004](unidades-atmosfera.md#atm-004) | Atmósfera estándar internacional (ISA) de referencia | referencia | — |
| [VEL-001](aeronaves.md#vel-001) | Límite de velocidad por debajo de 10 000 ft | implementado | — |
| [VEL-002](aeronaves.md#vel-002) | En los últimos 1000 ft antes del nivel autorizado, ascensos y descensos a 1500 ft/min como máximo (salvo orden expedita, despegue o RA) | implementado | sí |
| [PER-001](aeronaves.md#per-001) | Régimen de viraje estándar | implementado | sí |
| [PER-002](aeronaves.md#per-002) | Fracción de la tasa máxima de ascenso que se usa normalmente | implementado | sí |
| [PER-003](aeronaves.md#per-003) | Fracción de la tasa máxima de descenso que se usa normalmente | implementado | sí |
| [PER-004](aeronaves.md#per-004) | Factor de deceleración en tierra con frenos | implementado | sí |
| [PER-005](aeronaves.md#per-005) | Altura mínima para iniciar un viraje tras el despegue | implementado | sí |
| [PER-006](aeronaves.md#per-006) | Distancia de anticipación máxima para virar antes de un punto de recorrido (fly-by) | implementado | sí |
| [APP-001](aeronaves.md#app-001) | Una aeronave está establecida en el localizador si está a menos de ~500 ft del eje y con menos de 5° de diferencia de rumbo | implementado | sí |
| [APP-002](aeronaves.md#app-002) | Una aeronave está establecida en la senda de planeo si está a menos de 100 ft de ella | implementado | sí |
| [APP-003](aeronaves.md#app-003) | Puerta de aproximación estabilizada | implementado | sí |
| [APP-004](aeronaves.md#app-004) | Altitud mínima de descenso de la aproximación instrumental (equivale a la DH de una CAT I) | implementado | sí |
| [APP-005](aeronaves.md#app-005) | Si la pista no está libre a 200 ft sobre el umbral, el piloto hace la frustrada | implementado | — |
| [APP-006](aeronaves.md#app-006) | Separación radar mínima en la aproximación final | implementado | sí |
| [APP-007](aeronaves.md#app-007) | Tiempo de ocupación de pista en el aterrizaje por categoría RECAT-EU (varía entre el 90 % y el 120 % según la salida y el frenado) | implementado | sí |
| [SEP-001](separacion.md#sep-001) | Separación radar mínima horizontal en área terminal | implementado | sí |
| [SEP-002](separacion.md#sep-002) | Separación vertical mínima | implementado | sí |
| [SEP-003](separacion.md#sep-003) | Por debajo de 1000 ft AGL la separación radar no se aplica; rigen la separación en pista, la de estela y las reglas de salida | implementado | — |
| [SEP-004](separacion.md#sep-004) | Una pareja que entra ya sin separación es pérdida del sector anterior; solo cuenta si sigue así pasados 60 s | implementado | — |
| [SEP-005](separacion.md#sep-005) | Una aeronave nueva solo aparece con margen extra respecto a las demás | implementado | — |
| [SEP-006](separacion.md#sep-006) | Los conflictos se comprueban cada segundo de juego | implementado | — |
| [SEP-007](separacion.md#sep-007) | Separación en la salida entre una salida y una llegada a la misma pista | implementado | sí |
| [WAK-001](separacion.md#wak-001) | Esquema de estela según el perfil normativo del aeropuerto | implementado | sí |
| [WAK-002](separacion.md#wak-002) | Separación por estela en la aproximación, RECAT-EU (líder → seguidor; sin valor = solo separación radar) | implementado | sí |
| [WAK-003](separacion.md#wak-003) | Separación por estela en la salida, RECAT-EU | implementado | sí |
| [WAK-004](separacion.md#wak-004) | Separación por estela en la aproximación, ICAO | implementado | sí |
| [WAK-005](separacion.md#wak-005) | Separación por estela en la salida, ICAO | implementado | sí |
| [WAK-006](separacion.md#wak-006) | Separación por estela en la aproximación, FAA | implementado | sí |
| [WAK-007](separacion.md#wak-007) | Separación por estela en la salida, FAA | implementado | sí |
| [WAK-008](separacion.md#wak-008) | Categoría por defecto cuando el archivo de la aeronave no la declara | implementado | — |
| [PAR-001](separacion.md#par-001) | Pistas paralelas a menos de 2500 ft se tratan como una sola pista a efectos de estela | implementado | — |
| [PAR-002](separacion.md#par-002) | Aproximaciones paralelas independientes (sin separación entre las dos aeronaves una vez establecidas en sus localizadores) si los ejes están al menos a esta distancia | implementado | sí |
| [PAR-003](separacion.md#par-003) | Salidas simultáneas desde pistas paralelas separadas si sus rumbos divergen al menos 15°, dentro de 10 NM del aeropuerto | implementado | sí |
| [DEP-001](operaciones.md#dep-001) | Límites de viento para elegir pista | implementado | sí |
| [DEP-002](operaciones.md#dep-002) | V1 para cancelar un despegue | implementado | sí |
| [DEP-003](operaciones.md#dep-003) | Tiempos de la cancelación de despegue | implementado | sí |
| [DEP-004](operaciones.md#dep-004) | Una cancelación está justificada por una llegada a la misma pista más cerca que el mínimo + 1 NM, o por una emergencia que aterriza en ella en menos de 240 s | implementado | — |
| [DEP-005](operaciones.md#dep-005) | La torre automática libera una salida al menos 90 s después de otro despegue y 120 s después de otro por la misma SID, y no con llegadas a menos del mínimo + 2 NM | implementado | — |
| [DEP-006](operaciones.md#dep-006) | Tiempo de rodaje por defecto hasta la pista (varía entre el 85 % y el 125 %) | implementado | sí |
| [DEP-007](operaciones.md#dep-007) | Dos salidas consecutivas de la misma pista con un minuto de separación necesitan rumbos que diverjan al menos 45° | implementado | — |
| [ASP-001](espacio-aereo-terreno.md#asp-001) | Una aeronave que sale de todos los polígonos de espacio aéreo (lateralmente o por debajo de su suelo) deja de ser controlable y se elimina | implementado | — |
| [ASP-002](espacio-aereo-terreno.md#asp-002) | Entrar en una zona restringida por debajo de su techo | implementado | — |
| [ASP-003](espacio-aereo-terreno.md#asp-003) | Un sector con suelo 0 empieza en la superficie (SFC), también en aeropuertos por debajo del nivel del mar | implementado | — |
| [TER-001](espacio-aereo-terreno.md#ter-001) | Altitud mínima de vectorización (MVA) = terreno más alto en 3 NM alrededor + 1000 ft de franqueamiento | implementado | — |
| [TER-002](espacio-aereo-terreno.md#ter-002) | Se considera violación de altitud mínima cuando la aeronave está más de 100 ft por debajo de la MVA (resolución del modo C) | implementado | — |
| [EMG-001](operaciones.md#emg-001) | Probabilidad de que una llegada declare emergencia (opción del juego) | implementado | — |
| [EMG-002](operaciones.md#emg-002) | Momento de la declaración, entre 60 y 720 s después de aparecer, salvo si ya está en final corta (autorizada a menos de 12 NM) | implementado | — |
| [EMG-003](operaciones.md#emg-003) | Plazo para aterrizar una emergencia = estimación de una aproximación directa (200 kt + 240 s de circuito) + 600 s de margen | implementado | — |
| [EMG-004](operaciones.md#emg-004) | Los pilotos en emergencia rechazan esperas y cambios de código transpondedor, y descienden de forma expedita | implementado | — |
| [SCO-001](puntuacion.md#sco-001) | Niveles de las reglas (prioridad lexicográfica) | implementado | sí |
| [SCO-002](puntuacion.md#sco-002) | Puntos por evento del juego | implementado | sí |
| [SCO-003](puntuacion.md#sco-003) | Reglas del rulebook, su nivel y su referencia normativa | implementado | sí |
| [SCO-004](puntuacion.md#sco-004) | Puntuación de los eventos nuevos (valores provisionales, aceptados por defecto el 2026-11-20) | implementado | — |
| [STC-001](alertas.md#stc-001) | Horizonte y paso de la predicción del STCA (lineal, respetando la altitud autorizada) | implementado | sí |
| [STC-002](alertas.md#stc-002) | Niveles de alerta del STCA | implementado | sí |
| [STC-003](alertas.md#stc-003) | El STCA usa las mínimas del perfil normativo (radar y vertical - 50 ft), solo entre aeronaves controladas por encima de 1000 ft AGL, y no avisa de parejas separadas por otros medios (misma final, paralelas independientes, salidas divergentes) | implementado | — |
| [TCA-001](alertas.md#tca-001) | Umbrales de TCAS II v7.1 por nivel de sensibilidad (tau en s, DMOD en NM, ZTHR y ALIM en ft; TA / RA) | implementado | sí |
| [TCA-002](alertas.md#tca-002) | Inhibiciones de RA | implementado | sí |
| [TCA-003](alertas.md#tca-003) | Respuesta del piloto a un RA de ascenso o descenso, tras su tiempo de reacción; un RA de nivelar mantiene la altitud actual | implementado | sí |
| [TCA-004](alertas.md#tca-004) | Coordinación y fin del RA | implementado | sí |
| [TCA-005](alertas.md#tca-005) | Un RA puntúa una vez por encuentro (la separación ya había fallado antes) | implementado | — |
| [TCA-006](alertas.md#tca-006) | Durante un RA la tripulación rechaza toda orden de altitud ('unable, TCAS RA'); una orden contraria al RA es una violación de seguridad. Los bots no pueden dar órdenes verticales a una aeronave en RA | implementado | — |
| [TCA-007](alertas.md#tca-007) | Equipamiento TCAS II | implementado | — |
| [MSW-001](alertas.md#msw-001) | MSAW avisa si una aeronave controlada estará más de 100 ft por debajo de la MVA en los próximos 30 s (salvo en final y salidas a menos de 10 NM del aeropuerto, y si no está descendiendo) | implementado | sí |
| [APW-001](alertas.md#apw-001) | APW avisa si una aeronave controlada entrará en una zona restringida por debajo de su techo en los próximos 60 s | implementado | sí |
| [MET-001](meteorologia.md#met-001) | Categorías de aproximación por visibilidad (DH y RVR mínimos). Una pista admite su categoría (ilsCategory) y las inferiores; sin dato, una pista con ILS es CAT I. Los aviones comerciales vuelan hasta CAT IIIA, los ligeros CAT I | implementado | sí |
| [MET-002](meteorologia.md#met-002) | Perfil vertical de viento de la meteorología dinámica (velocidad = superficie × factor + suma; dirección girada a la derecha con la altura), interpolado entre niveles | implementado | sí |
| [MET-003](meteorologia.md#met-003) | El viento de superficie evoluciona cada minuto (paseo aleatorio acotado) y da rachas con viento fuerte | implementado | sí |
| [MET-004](meteorologia.md#met-004) | Procedimientos de baja visibilidad (LVP) con RVR < 550 m o techo < 200 ft; en LVP la separación mínima en final sube a 4 NM | implementado | sí |
| [MET-005](meteorologia.md#met-005) | Episodios de niebla (probabilidad por hora según la climatología del aeropuerto, 5 % por defecto); la visibilidad baja a 150-800 m en 15 min, dura 30-60 min y se levanta igual; techo de estratos asociado | implementado | sí |
| [MET-006](meteorologia.md#met-006) | Tormentas (CB) a 15-40 NM del aeropuerto, radio 3-6 NM, cima FL300-FL450, intensidad máxima 3-5; se mueven con el viento a 10 000 ft, crecen en 15 min y viven 45-90 min; como mucho 4 a la vez | implementado | sí |
| [MET-007](meteorologia.md#met-007) | No se entra en una celda de intensidad ≥ 3 por debajo de su cima. El piloto pide desvío si va a entrar en menos de 60 s; entrar puntúa WEATHER_PENETRATION. Para los bots, las celdas son zonas restringidas (con 1 NM de margen) | implementado | sí |
| [MET-008](meteorologia.md#met-008) | METAR del aeropuerto con el comando metar (o atis) | implementado | — |
| [MET-009](meteorologia.md#met-009) | Si el viento lleva las pistas en uso más allá de sus límites (+2 kt de margen), se cambia a la configuración preferente que cumpla, con sus spawn patterns (sin ráfaga de tráfico) | implementado | — |
| [MET-010](meteorologia.md#met-010) | Por debajo de mínimos en la altura de decisión, frustrada; tras 2 frustradas por meteorología, la llegada se desvía a su alternativo (DIVERSION) | implementado | — |
| [MET-011](meteorologia.md#met-011) | La meteorología dinámica tiene su propio generador aleatorio (semilla + 8800). En headless es estática salvo --weather dynamic, para que el protocolo de evaluación de los bots siga siendo comparable; en el navegador es dinámica por defecto | implementado | — |

## Añadir o cambiar una regla

1. Edita `reglas.yaml` (añade `check` si el valor está exportado en el código).
2. Ejecuta `node tools/docs/generate-spec.js` y `npx ava test/spec/reglas.spec.js`.
3. Cita el identificador en el código y en los tests que la implementan.

# Bot information

Referencia del sistema de bots controladores de openScope: qué son, cómo se
activan, cómo funcionan y en qué estado están. Para entrenar tu propio agente,
ver la guía [bot-training.md](bot-training.md).

## Índice

1. [Qué es](#qué-es)
2. [Estado](#estado)
3. [Cómo activar los bots](#cómo-activar-los-bots)
4. [Arquitectura](#arquitectura)
5. [Bot A: reglas expertas y metaheurísticas](#bot-a-reglas-expertas-y-metaheurísticas)
6. [Bot B: aprendizaje por refuerzo](#bot-b-aprendizaje-por-refuerzo)
7. [Escudo de seguridad](#escudo-de-seguridad)
8. [Acciones](#acciones)
9. [La observación](#la-observación-qué-ve-un-bot)
10. [Reglas, prioridades y puntuación](#reglas-prioridades-y-puntuación)
11. [Uso desde programas (Python y JavaScript)](#uso-desde-programas)
12. [Resultados del Bot A](#resultados-del-bot-a)
13. [Mapa de archivos](#mapa-de-archivos)
14. [Limitaciones conocidas](#limitaciones-conocidas)

## Qué es

Dos programas que hacen de controlador aéreo y gestionan **todo** el tráfico de
un aeropuerto:

- **Llegadas:** secuenciación, esperas, vectores e ILS.
- **Salidas:** autorización, rodaje, despegue y salida.
- **Conflictos** entre todos ellos.

| | Bot A | Bot B |
|---|---|---|
| Enfoque | Reglas expertas + optimización metaheurística | Aprendizaje por refuerzo (PPO) |
| Cómo decide | Planifica secuencias y resuelve conflictos con algoritmos | Red neuronal entrenada con millones de decisiones |
| Dónde se ejecuta | JavaScript: navegador y simulador | Entrena en Python/PyTorch; juega en el navegador con ONNX |
| Explicable | Sí: cada orden lleva su motivo | No directamente |
| Necesita entrenamiento | No; sus parámetros se pueden ajustar con CMA-ES | Sí: unas 6-7 horas en la GPU |

Los dos están sujetos a las mismas reglas (OACI, EASA/RECAT-EU, FAA) y al mismo
**escudo de seguridad**. Solo pueden dar las órdenes que daría un controlador
humano, con la misma sintaxis y por el mismo camino.

Aeropuertos de referencia: **LEMD** (Madrid-Barajas) y **EDDM** (Múnich).
Funcionan en cualquier aeropuerto.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Simulador sin navegador, Bot API, puente con Python | ✅ |
| 2 | Realismo avanzado, Rulebook y métricas | ✅ |
| 3 | Bot A: AMAN/DMAN, vectores, esperas, conflictos | ✅ |
| 4 | Ajuste del Bot A con CMA-ES | ✅ programado; ejecutarlo es opcional |
| 5 | Entorno Gymnasium, imitación del Bot A y DAgger | ✅ |
| 6 | PPO con curriculum, escudo y comparación A contra B | ✅ programado; **falta entrenar** |
| 7 | Bots en el juego del navegador (`bot a`, `bot b`, `bot off`) | ✅ (`bot b` necesita un modelo entrenado) |

## Cómo activar los bots

### En el juego del navegador

Escribe en la barra de órdenes (la misma donde das las autorizaciones):

| Orden | Efecto |
|---|---|
| `bot a` | El Bot A toma el control de todo el tráfico |
| `bot b` | El Bot B toma el control (carga `assets/bots/botB.onnx`) |
| `bot off` | Recuperas el control |

- Las órdenes del bot aparecen en el registro como `[bot A] IBE1234 fh r 270 - ...`,
  con la respuesta del piloto.
- Solo hay un bot activo a la vez. Puedes cambiar de uno a otro sin apagarlo.
- El bot decide cada 5 s de tiempo de juego, así que funciona con cualquier
  aceleración (`tw 2`, `tw 5`…).
- Para el Bot B hace falta exportar antes un modelo entrenado
  ([bot-training.md](bot-training.md), paso 5) y conexión a internet la primera
  vez, para descargar ONNX Runtime Web.

### Panel de auditoría

Abre **`http://localhost:3003/bot-audit`** en otra pestaña (o escribe `audit` en la barra de
órdenes del juego, que la abre). La página recibe los datos de la partida abierta en otra pestaña
del mismo sitio, sin pasar por el servidor, y se actualiza cada segundo. Registra la partida
completa, juegues tú, el Bot A o el Bot B:

| Pestaña | Qué muestra |
|---|---|
| Aeronaves | todo el tráfico en vivo: tipo y estela, fase, altitud y autorizada, IAS/GS y autorizada, rumbo, distancia, próximo punto (y distancia), pista, ruta, altitud mínima (MVA o suelo del sector) y estado (no controlado, aproximación autorizada, en espera, infracciones del último minuto, bajo mínimos) |
| Decisiones | cada orden (del jugador o de un bot), su motivo y su consecuencia a los 3 minutos: ok, aterrizó, salió, procedimiento, separación, seguridad o perdido, con el estado antes y después |
| Puntuación | cada cambio de puntos con la hora, la regla, las aeronaves y el detalle, y el total por motivo |
| Spawns | cada aeronave creada, las aplazadas por la comprobación de seguridad y su motivo |
| Resumen | puntuación, aterrizajes, despegues, movimientos por hora, frustradas, infracciones por regla |

**Exportar** descarga todo en un fichero `.jsonl` (lo genera la pestaña del juego). Ese fichero también sirve para entrenar al
Bot B: en cada paso guarda lo que ve el Bot B y la acción del Bot A (la real si mandaba el Bot A;
si no, la de un Bot A "en la sombra" que decide sin actuar), con la consecuencia de cada aeronave.
Guárdalo en `bots/audits/` y entrena con `--audit ../audits` (ver [bot-training.md](bot-training.md)).

### Comprobación de seguridad de los spawns

Antes de crear una aeronave en vuelo, el juego comprueba que está a más de 8 NM (mínimo radar
de 3 NM + 5 NM de margen) o a más de 2000 ft (1000 ft + 1000 ft) de cualquier otra aeronave en
vuelo, y que no queda por debajo del suelo del sector ni de la altitud mínima de vectores (si
queda por debajo, se sube). Si no se cumple, se reintenta cada 30 s, hasta 10 veces.

### En el simulador (sin navegador)

Desde la raíz del proyecto, tras `npm install --ignore-scripts`:

```sh
node tools/sim/run-bot.js --bot A --airport lemd --minutes 60 --seed 1
```

| Opción | Uso |
|---|---|
| `--airport eddm` | otro aeropuerto |
| `--seed 7` | otra semilla (otro tráfico, reproducible) |
| `--wind 180/15` | viento de 180° a 15 kt (en LEMD activa la configuración sur) |
| `--traffic 1.5` | 50% más tráfico |
| `--params bots/params/botA_tuned.json` | parámetros ajustados por CMA-ES |
| `--verbose` | muestra cada orden con su motivo |

El Bot B se ejecuta desde Python (en `bots/python`):

```sh
.venv\Scripts\python -m openscope_bots.run --bot B --model ../runs/botB/best.pt --airport lemd
```

## Arquitectura

```
       ┌──────────────────────── Motor openScope ────────────────────────┐
       │ aeronaves · rutas · física · realismo (pista, separación, estela,│
       │ terreno, frustradas) · Rulebook · métricas                        │
       └──────────────▲──────────────────────────────┬────────────────────┘
                      │ órdenes ("fh 270 a 50")       │ observación
       ┌──────────────┴────────────── Bot API ────────▼────────────────────┐
       │ catálogo de acciones · escudo de seguridad · codificador de rasgos │
       └───────▲───────────────────────▲────────────────────────▲──────────┘
               │                       │                        │
        Bot A (JS)              BotController             RlEnvironment
   AMAN · DMAN · CD&R         (juego del navegador)   (simulador, para Python)
   vectores · esperas          bot a / bot b / off      Gymnasium · PPO · ONNX
```

El catálogo de acciones, el escudo, el codificador de rasgos y la recompensa
están escritos una sola vez, en JavaScript. Así el Bot A, el entrenamiento y el
navegador usan exactamente la misma lógica.

## Bot A: reglas expertas y metaheurísticas

Cada 5 s (`src/assets/scripts/client/bot/botA/BotA.js`) hace, en este orden:

1. **Seguridad.** Aplica las acciones que impone el escudo de seguridad.
2. **Conflictos (CD&R).** Predice las trayectorias 2 minutos hacia delante. Si
   dos aviones van a perder la separación, elige la maniobra de menor coste:
   parar un ascenso o descenso, cambiar de nivel o, como último recurso, un
   viraje. Antes de darla **comprueba que funciona**: que separa a la pareja y
   no crea un conflicto con un tercero. Si ninguna lo consigue, elige la que más
   retrasa la pérdida. Mantiene la maniobra hasta que reanudar la ruta ya no
   recrearía el conflicto. Las maniobras laterales y verticales se recuerdan por
   separado, para que una no borre a la otra.
   - La predicción de los aviones que suben o bajan por el procedimiento
     (`dvs` / `cvs`) reproduce la del simulador: respetan la siguiente
     restricción "a o por encima" y "a o por debajo", y empiezan a bajar en su
     punto de inicio de descenso.
   - Dos aviones en la misma final se espacian por la secuencia. En finales
     paralelas se exige el mínimo de aproximaciones dependientes del simulador
     (1, 1,5 o 2 NM en diagonal según la distancia entre ejes, 3 NM si es mayor).
3. **Salidas (DMAN).**
   - Saca aviones del aparcamiento mientras haya sitio en la cola del punto de
     espera (máximo 4 por pista).
   - En cada pista despega primero la salida que más lleva esperando de entre
     las que pueden irse ya.
   - Para poder irse, una salida necesita pista libre, el tiempo de estela tras
     la anterior, 2 minutos si sigue la misma ruta (1 si diverge) y que ninguna
     llegada vaya a necesitar la pista.
   - Desde pistas paralelas, exige rutas iniciales divergentes al menos 15°.
4. **Llegadas (AMAN).**
   - Estima la hora de llegada de cada avión siguiendo su ruta o su circuito de
     vectores.
   - Calcula la secuencia de aterrizaje de cada pista: separación de estela,
     tiempo de ocupación de pista y huecos para salidas en pistas mixtas.
   - Mejora el orden con **recocido simulado** bajo *Constrained Position
     Shifting*: cada avión puede adelantar o retrasar como mucho 2 puestos.
     Los pesados pesan más porque gastan más combustible esperando.
   - Reparte las llegadas entre pistas paralelas (`e 26R`) cuando la otra
     ofrece un hueco claramente antes y está de su lado.
5. **Absorber el retraso** que pide la secuencia:
   - **Reduce la velocidad.** Busca por bisección la velocidad que cuadra la
     hora.
   - **Manda a espera** si el retraso es grande. Cada avión va a un nivel libre
     de la pila (separados 1000 ft), bajan conforme se libera el de abajo y
     sale primero el de abajo. Solo usa fijos a más de 10 NM del límite del
     espacio aéreo.
   - **Alarga el tramo de viento en cola** cuando el avión va con vectores
     (la "trombón").
6. **Vectores al ILS.**
   - Funciona como una secuencia que solo avanza: viento en cola, base,
     interceptación y autorización ILS.
   - Solo vira a base cuando el espaciado con **todos** los aviones que van por
     delante será suficiente al llegar al localizador.
   - Intercepta por debajo de la senda de planeo, a 30°.
   - Da primero el rumbo y después la autorización ILS, porque un rumbo
     posterior la cancelaría.
   - Si se queda alto o se pasa del localizador, rompe la aproximación y vuelve
     al viento en cola.
7. **En final.** Mantiene el espaciado con la velocidad, bajando hasta la de
   aterrizaje si es necesario.

**Comprobación de niveles.** Toda altitud que piden la secuencia, la espera o
los vectores pasa antes por una comprobación: se predice el ascenso o descenso
completo, no solo el nivel final, y un nivel que otro avión está dejando solo se
ocupa cuando ya está libre (si el de delante se nivelara, seguiría habiendo
separación). Si el nivel pedido no es seguro, el avión se queda en el nivel
seguro más cercano a él y lo vuelve a intentar en el siguiente ciclo. En una
espera, un avión solo baja al nivel de abajo cuando el que lo ocupaba lo ha
dejado de verdad.

**Rupturas de aproximación.** Cuando el escudo rompe una aproximación, el avión
mantiene el rumbo de ruptura 45 s y después se le vectoriza en un circuito
nuevo, en lugar de volver enseguida al localizador. En base, si el tráfico de la
final se ha acercado más de lo previsto, se alarga el viento en cola.

Todos los márgenes y umbrales son **parámetros**, con su rango de ajuste
(`botA/botAParameters.js`). La Fase 4 los optimiza con CMA-ES.

## Bot B: aprendizaje por refuerzo

- **Entrada.** Hasta 48 aviones × 50 rasgos, más 5 rasgos globales (ver
  [la observación](#la-observación-qué-ve-un-bot)).
- **Red.** Un *transformer* de 3 capas sobre la lista de aviones, con una cabeza
  de política por avión y otra de valor, unos 480.000 parámetros.
- **Salida.** Una acción del catálogo para cada avión en cada decisión (cada 10 s).
- **Entrenamiento.** Imitación del Bot A, después DAgger y después PPO con un
  curriculum: de poco tráfico en LEMD a tráfico completo en LEMD y EDDM con
  viento variable.
- **Recompensa.** Construida a partir del Rulebook, ponderada por niveles
  (seguridad −10, separación −3, procedimiento −0,5, frustrada −1, aterrizaje o
  salida +1…).
- **En el navegador.** Se exporta a ONNX y se ejecuta con ONNX Runtime Web.

Cómo entrenarlo: [bot-training.md](bot-training.md).

## Escudo de seguridad

`src/assets/scripts/client/bot/safetyShield.js`, común a los dos bots:

- **Prohíbe:**
  - despegar con la pista ocupada, sin la separación de estela o temporal con
    la salida anterior, o con una llegada demasiado cerca;
  - asignar una altitud por debajo de la mínima de vectores donde está el avión
    o en su trayectoria durante los próximos 2 minutos (o de 1500 ft sobre el
    aeropuerto donde no hay datos de terreno).
- **Impone:** si dos aviones en la misma final están por debajo del mínimo, el
  de detrás hace frustrada (a menos de 6 NM) o rompe la aproximación con un
  viraje de 45° (más lejos).

El Bot B no puede saltárselo: las acciones prohibidas reciben probabilidad cero.

## Acciones

Una por avión y decisión, 64 en total (`src/assets/scripts/client/bot/actionSpace.js`):

| Grupo | Acciones | Orden que generan |
|---|---|---|
| Nada | 1 | — |
| Rumbo | ±5, 10, 20, 30, 45, 60, 90° sobre el rumbo asignado | `fh l 250` / `fh r 300` |
| Altitud | 2000 a 24000 ft, cada 1000 | `a 50` |
| Velocidad | 140 a 300 kt, cada 10 | `sp 210` |
| Directo | al siguiente fijo de la ruta | `pd FAFEQ` |
| Procedimiento | descender por la STAR / subir por la SID | `dvs` / `cvs` |
| ILS | autorización ILS a su pista | `i 32L` |
| Pista paralela | esperar la otra pista paralela | `e 32R` |
| Espera | en el siguiente fijo / salir de ella | `hold ADUXO` / `xh` |
| Frustrada | | `ga` |
| Rodaje | autorización, rodaje y subida por la SID | `caf taxi 36L cvs` |
| Despegue | | `cto` |

Para la referencia completa de órdenes, ver [aircraft-commands.md](aircraft-commands.md).

## La observación: qué ve un bot

Unidades: millas náuticas, pies, nudos y grados. Las posiciones son relativas al
punto de referencia del aeropuerto (x al este, y al norte).

### Aeropuerto (`airport`)

- `icao`, `elevation`, `wind`, `regulatoryProfile`, `runwayConfiguration`,
  `arrivalRunway`, `departureRunway`.
- `airspace`: polígonos con suelo y techo.
- `runways`: por cada cabecera, `name`, `heading`, `threshold`, `elevation`,
  `length`, `ils`, `queue` y `minimumAltitudeOnFinal` (altitud mínima a 10 NM
  en final).

### Realismo (`realism`)

Normativa y mínimos de separación, configuración de pistas, ocupación de cada
pista, último despegue de cada pista, infracciones acumuladas y métricas
(aterrizajes, despegues, movimientos por hora, frustradas, tiempo sin
separación, millas y tiempo de las llegadas, espera de las salidas, combustible
y CO₂).

### Cada aeronave

| Grupo | Campos |
|---|---|
| Identidad | `callsign`, `category`, `type`, `origin`, `destination` |
| Estela | `weightClass`, `recatEu`, `wakeFaa`, `wakeCategory` |
| Estado | `flightPhase`, `x`, `y`, `altitude`, `heading`, `groundTrack`, `speed`, `groundSpeed`, `trend`, `distance` |
| Situación | `isControllable`, `isOnGround`, `isTaxiing`, `taxiRemainingSeconds`, `isEstablishedOnCourse`, `hasApproachClearance`, `hasDepartureClearance`, `isHoldAssigned`, `conflicts` |
| Prestaciones | `speedLimits` (mínima, aterrizaje, máxima) y `ceiling` |
| Ruta | `route`, `nextWaypoint`, `waypoints` (posición, restricciones, rumbo de los tramos de vector), `arrivalRunway`, `departureRunway` |
| Autorización vigente | `clearance` (modos y valores de altitud, rumbo y velocidad) |
| Terreno | `minimumVectoringAltitude` (donde está) y `minimumVectoringAltitudeAhead` (la más alta en su trayectoria durante los próximos 2 minutos) |

En el simulador cada observación incluye además `violations` (reglas
incumplidas desde la anterior), `scoreEvents` y `radio`.

## Reglas, prioridades y puntuación

La normativa completa está en [realism.md](realism.md). Las prioridades son
**lexicográficas**: un nivel inferior manda siempre.

| Nivel | Reglas |
|---|---|
| 0 Seguridad | incursión en pista, impacto contra el terreno, vectores bajo la altitud mínima, colisión |
| 1 Separación | radar, final de aproximación, estela en llegadas y salidas, llegada-salida |
| 2 Procedimiento | límites de viento en pista, salida sin ruta, interceptación sobre la senda |
| 3 Eficiencia | frustradas, aterrizajes, salidas, retrasos, millas recorridas |
| 4 Entorno y carga | combustible, CO₂ y número de órdenes |

El mismo orden se usa para:
- la recompensa del Bot B;
- el coste que minimiza el ajuste del Bot A (`bots/python/openscope_bots/fitness.py`);
- la comparación entre los dos bots.

## Uso desde programas

### Python (`bots/python/openscope_sim`)

```python
from openscope_sim import SimulatorClient

with SimulatorClient() as sim:
    obs = sim.reset("lemd", seed=1, wind=(180, 15), traffic_scale=1.2)
    obs, results = sim.step(5, [("IBE3141", "fh 270 a 70 sp 210")])
    summary = sim.run_bot_episode(bot="A", airport="eddm", seed=3, minutes=60)["summary"]
```

Para RL hay `rl_spec()`, `rl_reset(...)` y `rl_step(actions)`, o directamente
el entorno Gymnasium `openscope_bots.env.OpenScopeEnv`.

### JavaScript

```js
const { BOTS, runEpisode } = require('./tools/sim/botRunner');

const { summary } = runEpisode({ bot: BOTS.A({}), airport: 'lemd', seed: 1, minutes: 60 });
```

## Resultados del Bot A

Bot A con los parámetros por defecto (sin ajustar), episodios de 60 minutos con
el tráfico normal de cada aeropuerto, semillas 1 a 3:

| | LEMD | EDDM |
|---|---|---|
| Colisiones, incursiones en pista, impactos contra el terreno, vectores bajo la altitud mínima | 0 | 0 |
| Llegadas que abandonan el espacio aéreo | 0 | 0 |
| Aterrizajes por hora | 20 | 20-22 |
| Despegues por hora | 21-25 | 25 |
| Frustradas por hora | 0 | 0-2 |
| Pérdidas de separación (radar y estela) por hora | 4-11 | 5-6 |

Antes de la comprobación de niveles y de la predicción VNAV, las pérdidas de
separación radar eran de 18-32 por hora en LEMD y de 35-65 en EDDM, con los mismos
aterrizajes. Las que quedan son sobre todo aviones que se juntan en el viento en
cola o al salir de las esperas, y aviones en finales paralelas sin escalonar.

Se probó a secuenciar juntas las pistas paralelas con un escalonamiento entre
ellas, y empeoró las dos cosas (más pérdidas y menos aterrizajes): los vectores no
entregan los aviones con la precisión que eso exige.

## Mapa de archivos

| Ruta | Contenido |
|---|---|
| `src/assets/scripts/client/bot/BotApi.js` | interfaz: observación y órdenes |
| `src/assets/scripts/client/bot/BotController.js` | `bot a` / `bot b` / `bot off` en el juego |
| `src/assets/scripts/client/bot/actionSpace.js` | catálogo de acciones |
| `src/assets/scripts/client/bot/safetyShield.js` | escudo de seguridad |
| `src/assets/scripts/client/bot/botRules.js` | reglas de despegue, espaciado y altitud mínima |
| `src/assets/scripts/client/bot/botGeometry.js` | geometría: final, rumbos, espacio aéreo |
| `src/assets/scripts/client/bot/botA/` | Bot A: secuenciación, planificador de llegadas, conflictos, parámetros |
| `src/assets/scripts/client/bot/rl/` | codificador de rasgos, recompensa y ejecución del Bot B en el navegador |
| `src/assets/scripts/client/realism/` | realismo y Rulebook |
| `src/assets/scripts/headless/` | simulador sin navegador y entorno de RL |
| `tools/sim/` | `run-bot.js`, `demo.js`, servidor para Python |
| `bots/python/openscope_sim/` | cliente de Python del simulador |
| `bots/python/openscope_bots/` | ajuste del A, entrenamiento, evaluación y exportación del B |
| `bots/configs/default.json` | configuración de entrenamiento |
| `bots/params/` | parámetros ajustados del Bot A |
| `bots/runs/` | resultados de entrenamiento (no se guardan en git) |
| `assets/bots/` | modelo del Bot B para el juego |
| `test/bot/`, `test/realism/`, `bots/python/tests/` | tests |

## Limitaciones conocidas

- El Bot B está programado pero **sin entrenar**: no habrá `bot b` en el juego
  hasta completar [bot-training.md](bot-training.md).
- El Bot A todavía pierde la separación unas 5 veces por hora (ver
  [resultados](#resultados-del-bot-a)).
- No se simula el rodaje por calles: es un tiempo de espera por pista.
- Las frustradas siguen el rumbo actual, no el procedimiento publicado.
- Las altitudes mínimas de vectores se calculan a partir de un terreno
  aproximado; solo existen en aeropuertos con datos de terreno.
- La configuración de pistas se elige al cargar el aeropuerto; el viento no
  cambia durante la partida.
- `bot b` en el navegador descarga ONNX Runtime Web de internet la primera vez.
- El combustible es una estimación para comparar estrategias, no un dato real.

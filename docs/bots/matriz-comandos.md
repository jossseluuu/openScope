<!-- Página generada por tools/docs/generate-bot-docs.js desde el código. No la edites a mano. -->

# Matriz de comandos de los bots

Las 66 acciones que puede elegir un bot en cada ciclo para cada aeronave (`bot/actionSpace.js`), qué comando del simulador dan, cuándo están disponibles (máscara de acciones) y quién puede usarlas. Los bots no tienen atajos: cada acción es un comando normal, como el que teclearía el jugador.

## Resumen por tipo de acción

| Acción | Nº | Comando | Fraseología (EN) | Fraseología (ES) | Bot A | Escudo | Bot B | Agentes del Bot C |
|---|---:|---|---|---|:-:|:-:|:-:|---|
| `NOOP` | 1 | `—` | — | — | ✔ | — | ✔ | todos |
| `HEADING` | 14 | `fh l/r {rumbo}` | turn left/right heading {hdg} | vire a la izquierda/derecha rumbo {rumbo} | ✔ | ✔ | ✔ | Entradas, ILS, Salidas, Separación |
| `ALTITUDE` | 23 | `a {nivel} [ex]` | climb/descend and maintain {alt} [expedite] | ascienda/descienda y mantenga {altitud} [expedito] | ✔ | ✔ | ✔ | Entradas, ILS, Torre, Salidas, Separación |
| `SPEED` | 17 | `sp {kt}` | reduce/increase speed {kt} | reduzca/aumente velocidad {nudos} | ✔ | — | ✔ | Entradas, ILS, Torre, Salidas, Separación |
| `DIRECT_NEXT` | 1 | `pd {fijo}` | proceed direct {fix} | proceda directo a {fijo} | ✔ | — | ✔ | Entradas, ILS, Salidas, Separación |
| `PROCEDURE` | 1 | `dvs (llegadas) / cvs (salidas)` | descend via STAR / climb via SID | descienda según la STAR / ascienda según la SID | ✔ | — | ✔ | Entradas, ILS, Torre, Salidas, Separación |
| `ILS` | 1 | `i {pista}` | cleared ILS runway {rwy} approach | autorizado aproximación ILS pista {pista} | ✔ | — | ✔ | Entradas, ILS, Torre |
| `PARALLEL_RUNWAY` | 1 | `e {pista}` | expect runway {rwy} | espere pista {pista} | ✔ | — | ✔ | Coordinador |
| `HOLD` | 1 | `hold {fijo}` | hold at {fix} as published | mantenga en espera sobre {fijo} según publicado | ✔ | — | ✔ | Entradas, ILS |
| `EXIT_HOLD` | 1 | `xh` | exit hold, proceed on course | abandone la espera, prosiga en ruta | ✔ | — | ✔ | Entradas, ILS |
| `GO_AROUND` | 1 | `ga` | go around | motor y al aire | — | ✔ | ✔ | Torre |
| `TAXI` | 1 | `caf taxi {pista} cvs` | cleared as filed, taxi to runway {rwy} | autorizado según plan de vuelo, ruede a pista {pista} | ✔ | — | ✔ | Torre |
| `TAKEOFF` | 1 | `cto` | runway {rwy}, cleared for takeoff | pista {pista}, autorizado a despegar | ✔ | — | ✔ | Torre |
| `CANCEL_TAKEOFF` | 1 | `abort` | hold position, cancel takeoff clearance / stop immediately | mantenga posición, cancelo autorización de despegue / pare inmediatamente | — | — | ✔ | Torre |
| `LINE_UP` | 1 | `lineup` | runway {rwy}, line up and wait | pista {pista}, alinee y espere | — | — | ✔ | Torre |

- **Bot A:** acciones que usa su planificador (detectado en `bot/botA/`). No usa `LINE_UP` ni `CANCEL_TAKEOFF`; eso lo hace la Torre del Bot C.
- **Escudo:** acciones que el escudo de seguridad puede imponer a cualquier bot (`safetyShield.getRequiredActions`): frustrada o viraje de separación en final y ascenso ante un suelo de espacio aéreo más alto.
- **Bot B:** la red puede elegir cualquier acción que la máscara permita; el escudo filtra y corrige.
- **Bot C:** cada aeronave tiene un agente dueño; un agente solo puede dar las acciones de su competencia (`bot/botC/agents.js`, `AGENT_AUTHORITY`). La Torre es dueña de todo lo que está en tierra o a menos de 3000 ft sobre el aeropuerto.

## Disponibilidad (máscara de acciones)

| Acción | Disponible cuando | Para qué sirve |
|---|---|---|
| `NOOP` | siempre | no dar ninguna orden en este ciclo |
| `HEADING` | en el aire | cambio de rumbo relativo al actual o al asignado |
| `ALTITUDE` | en el aire, hasta el techo de la aeronave; `ex` (expedito) solo en emergencia y bajando 1000 ft o más | altitud autorizada |
| `SPEED` | en el aire, entre la mínima + 10 kt y la máxima (250 kt por debajo de 10 000 ft) | velocidad indicada |
| `DIRECT_NEXT` | si tiene un siguiente fijo con posición | directo al siguiente fijo de la ruta |
| `PROCEDURE` | si tiene un siguiente fijo y no es un sobrevuelo | volver a seguir el perfil vertical del procedimiento |
| `ILS` | llegadas a una pista con ILS | autorización de aproximación ILS |
| `PARALLEL_RUNWAY` | llegadas aún no en aproximación, con una pista paralela | cambio a la pista paralela |
| `HOLD` | con un siguiente fijo, sin espera asignada y no en emergencia (los pilotos en emergencia la rechazan) | espera en el siguiente fijo |
| `EXIT_HOLD` | con espera asignada | salir de la espera |
| `GO_AROUND` | llegadas en aproximación | frustrada |
| `TAXI` | salidas en plataforma (APRON) | autorización y rodaje a la pista de salida |
| `TAKEOFF` | salidas en el punto de espera o alineadas, cuando ya pueden salir | autorización de despegue |
| `CANCEL_TAKEOFF` | en el punto de espera, alineada, o en la carrera por debajo de V1 | cancelar el despegue |
| `LINE_UP` | la siguiente en salir, en el punto de espera y lista | alinear en pista |

En tierra solo hay acciones de salida (`TAXI`, `TAKEOFF`, `LINE_UP`, `CANCEL_TAKEOFF`); una aeronave no controlable solo admite `NOOP`.

## Valores discretos

- **Rumbo** (grados respecto al rumbo de referencia; negativo = izquierda): -90, -60, -45, -30, -20, -10, -5, 5, 10, 20, 30, 45, 60, 90.
- **Altitud** (ft): 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000, 21000, 22000, 23000, 24000.
- **Velocidad** (kt IAS): 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300.

## Competencias de los agentes del Bot C

| Agente | `HEADING` | `ALTITUDE` | `SPEED` | `DIRECT_NEXT` | `PROCEDURE` | `ILS` | `PARALLEL_RUNWAY` | `HOLD` | `EXIT_HOLD` | `GO_AROUND` | `TAXI` | `TAKEOFF` | `CANCEL_TAKEOFF` | `LINE_UP` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Coordinador | — | — | — | — | — | — | ✔ | — | — | — | — | — | — | — |
| Entradas | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ | ✔ | — | — | — | — | — |
| ILS | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ | ✔ | — | — | — | — | — |
| Torre | — | ✔ | ✔ | — | ✔ | ✔ | — | — | — | ✔ | ✔ | ✔ | ✔ | ✔ |
| Salidas | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — | — | — | — | — | — | — |
| Separación | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — | — | — | — | — | — | — |

El Escudo (escudo) puede imponer cualquier acción por seguridad. Ver [Bot C](bot-c.md) y [niveles de automatización](automatizacion.md).

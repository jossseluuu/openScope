# Bot C: agentes especialistas y supervisión

El Bot C reparte el control entre agentes sencillos, cada uno con su función, y
audita todas sus órdenes con supervisores independientes. La referencia general
de los bots está en [bot-information.md](bot-information.md).

## Índice

1. [Cómo usarlo](#cómo-usarlo)
2. [Los agentes](#los-agentes)
3. [Prioridad de las órdenes](#prioridad-de-las-órdenes)
4. [Cancelar un despegue](#cancelar-un-despegue)
5. [La supervisión](#la-supervisión)
6. [El registro](#el-registro)
7. [Resultados](#resultados)
8. [Limitaciones](#limitaciones)
9. [Mapa de archivos](#mapa-de-archivos)

## Cómo usarlo

En el juego, escribe `bot c`. Para ver la auditoría, escribe `audit` y abre la
pestaña **Supervisión**. **Exportar** añade todo el registro al fichero `.jsonl`.

Sin navegador:

```sh
node tools/sim/run-bot.js --bot C --airport lemd --seed 4 --minutes 60 --supervision-log registro.jsonl
```

## Los agentes

Cada avión tiene **un solo responsable** en cada momento (`ownerOf` en
`agents.js`). Un agente solo puede dar los tipos de orden de su competencia: si
intenta otra, no se emite y queda registrada.

| Agente | Función | Tramo | Órdenes |
|---|---|---|---|
| **Coordinador** | Decide pista y orden de llegada | Todo el tráfico | Cambio de pista paralela |
| **Entradas** | Bajar y frenar para cumplir la hora | Llegadas en su ruta | Rumbo, altitud, velocidad, directo, procedimiento, ILS, esperas |
| **ILS** | Vectores y unión al localizador | Llegadas con vectores o en final por encima de 3000 ft AGL | Las mismas que Entradas |
| **Torre** | Pista, despegues, cancelaciones y frustradas | Salidas y llegadas en final por debajo de 3000 ft AGL | Altitud, velocidad, procedimiento, ILS, frustrada, rodaje, alinearse, despegue, cancelar despegue |
| **Salidas** | Ascenso y salida, también sobrevuelos | Salidas por encima de 3000 ft AGL | Rumbo, altitud, velocidad, directo, procedimiento |
| **Separación** | Conflictos y zonas restringidas; puede dar órdenes complementarias a los dos aviones | Cualquier avión en vuelo | Rumbo, altitud, velocidad, directo, procedimiento |

Separación puede actuar sobre un avión de otro agente, durante un tiempo limitado.

## Prioridad de las órdenes

Cada avión recibe como máximo una orden por ciclo, en este orden:

1. Lo que impone el escudo de seguridad.
2. Torre protege la pista: cancela despegues y manda frustradas.
3. Separación resuelve conflictos y evita zonas restringidas.
4. Torre gestiona rodajes y despegues.
5. El responsable de cada avión da su orden.

## Cancelar un despegue

La orden `abort` funciona para cualquier jugador, no solo para los bots.

| Situación | Qué ocurre | Pista ocupada |
|---|---|---|
| En espera | Vuelve al final de la cola; listo en 60 s | No |
| Alineado (`lineup`) | Sale de pista y vuelve a la cola | 45 s |
| En carrera, por debajo de V1 | Frena sobre la pista, sale y vuelve a la cola | Tiempo de frenar a 4 kt/s + 45 s para salir de pista, + 60 s de inspección de frenos por encima de 80 kt |
| En carrera, en V1 o más | El piloto responde que no puede parar | Sigue el despegue |

- V1 es el 90 % de la velocidad de rotación del avión.
- Tras cancelar en pista, el avión rueda 2 minutos de vuelta a la cola: desaparece
  del radar y reaparece en la espera.
- `lineup` solo vale para el siguiente de la cola y ocupa la pista desde ese momento.
  `cto` desde la espera sigue funcionando: alinearse es opcional.
- Torre no alinea aviones por su cuenta: se probó y empeoró la puntuación (ver
  [resultados](#resultados)). Si un avión está alineado y se acerca una llegada, Torre
  sí lo saca de la pista.

**Cuándo está justificada.** Si hay otro avión en pista, si no se cumple la estela,
si una llegada está más cerca que la separación mínima + 1 NM, o si una emergencia
aterriza por esa pista en menos de 4 minutos. Justificada no resta puntos;
injustificada resta **50 puntos** y cuenta como infracción de procedimiento
(`TAKEOFF_CANCEL_UNJUSTIFIED`).

## La supervisión

**Los supervisores no intervienen:** reciben una copia de las decisiones, no pueden
dar órdenes y solo escriben en el registro. Tampoco usan la predicción de los
agentes, sino una propia y más simple, para no compartir sus errores.

Hay un supervisor por agente y uno global:

| Supervisor | Qué comprueba además de lo común |
|---|---|
| **Torre** | Pista libre, estela e intervalo con llegadas al despegar; motivo de cada frustrada; juicio de cada cancelación |
| **Entradas e ILS** | Ángulo de interceptación del localizador; ninguna espera a un avión en emergencia |
| **Coordinador** | Ningún cambio de pista a un avión ya autorizado |
| **Salidas y Separación** | Las comprobaciones comunes |
| **Global** | Alertas de riesgo a 90 s, órdenes en bucle, traspasos entre agentes y causa de cada incidente |

Comprobaciones comunes a toda orden en vuelo: separación durante 120 s, altitud
mínima de vectores, suelo del espacio aéreo y 250 kt por debajo de 10 000 ft.

Cada orden queda como **BUENA**, **DUDOSA** o **MALA**, siempre con el porqué. Una
cancelación queda como **PENDIENTE** hasta que el motor la juzga.

### Causa de cada incidente

Cada infracción del Rulebook se clasifica con criterios objetivos:

| Causa | Criterio |
|---|---|
| `ERROR_DE_DECISION` | Una orden reciente de esos aviones ya se había juzgado MALA |
| `NEGLIGENCIA` | Alerta de al menos 30 s, se podía actuar y nadie dio ninguna orden |
| `ACTUACION_INSUFICIENTE` | Hubo órdenes tras la alerta, pero no evitaron la pérdida |
| `INEVITABLE` | Había alerta y ninguna acción posible |
| `FALLO_DE_COORDINACION` | Traspaso entre agentes en el último minuto, sin alerta previa |
| `FALLO_DE_SUPERVISION` | El monitor de riesgo no avisó antes |
| `SIN_CAUSA_ATRIBUIDA` | Infracción de un solo avión sin orden mala asociada |

Una infracción de dos aviones que aún no tiene explicación suele indicar que la
predicción simple se quedó corta: por eso los supervisores también se evalúan.

## El registro

Fichero `.jsonl`, una línea por elemento. Las entradas solo se añaden o se completan
con lo ocurrido después.

| `type` | Contenido |
|---|---|
| `supervision-summary` | Totales por agente y causa, alertas, traspasos |
| `instruction` | Hora, agente, supervisor, avión, orden, motivo del agente, juicio, `findings` con el porqué y su referencia normativa, y `consequence` si acabó en incidente |
| `incident` | Regla, aviones, causa, responsable, explicación y órdenes relacionadas |
| `handoff` | Traspaso de un avión entre agentes |
| `authority-breach` | Orden rechazada por estar fuera de la competencia del agente |

## Resultados

En esta fase el Bot C usa la planificación del Bot A, así que debe volar igual,
salvo cuando Torre cancela o manda una frustrada por su cuenta.

30 episodios de 60 minutos sin emergencias, semillas 4 a 9, en LEMD norte, LEMD sur
(180/15), EDDM, LEMG y KLAX:

| | LEMD | EDDM | LEMG | KLAX | Total | Aterrizajes | Pérdidas de separación |
|---|---|---|---|---|---|---|---|
| Bot A | −10 825 | −5910 | −400 | −21 825 | −38 960 | 469 | 221 |
| Bot C | −10 825 | −5530 | −400 | −21 825 | −38 580 | 469 | 219 |

Solo cambia EDDM: la diferencia es pequeña y no demuestra que el Bot C sea mejor.

**Con el planificador de noviembre de 2026** (unión al ILS sobre el terreno y resolución
de conflictos revisada, ver [Bot A](bot-a.md#resultados)), mismo protocolo:

| | LEMD norte | LEMD sur | EDDM | LEMG | KLAX | Total | Aterrizajes | Pérdidas radar |
|---|---|---|---|---|---|---|---|---|
| Bot A | 1750 | −2050 | 240 | 1100 | −4985 | −3945 | 494 | 43 |
| Bot C | 1480 | −950 | 240 | 1090 | −7840 | −5980 | 501 | 57 |

Ninguna colisión ni salida del espacio aéreo con el Bot C. Las diferencias con el Bot A
vienen de que Torre cancela o manda frustradas por su cuenta y eso cambia el resto del
episodio: mejor en LEMD sur, peor en KLAX. Con 6 episodios por escenario no se puede decir
que uno sea mejor que el otro.

Auditoría de esos episodios: 36 935 órdenes buenas, 3983 dudosas, 772 malas, 0 fuera de
competencia, 1212 alertas y 4203 traspasos.

| Causa de los incidentes | Veces |
|---|---|
| `ERROR_DE_DECISION` | 112 |
| `ACTUACION_INSUFICIENTE` | 41 |
| `FALLO_DE_SUPERVISION` | 30 |
| `SIN_CAUSA_ATRIBUIDA` | 28 |
| `FALLO_DE_COORDINACION` | 18 |
| `NEGLIGENCIA`, `INEVITABLE` | 0 |

Las causas se asignan con reglas: `ERROR_DE_DECISION` depende de que una orden reciente
se juzgara MALA, aunque no siempre fuera ella quien causó la pérdida.

**Cancelación automática.** En una partida real de EDDM se autorizó a mano un despegue
con una llegada encima: Torre lo abortó en el ciclo siguiente a 45 kt y el motor lo
juzgó justificado (llegada a 0,7 NM). No ocurre en partidas normales, porque Torre no
autoriza despegues en esa situación.

**Alineado automático, descartado.** Con Torre alineando salidas retenidas solo por el
intervalo con el último despegue, en 30 episodios y con la versión anterior de la
resolución: LEMD y LEMG igual, EDDM −5670 frente a −5135 y KLAX −30 795 frente a −28 880.

## Limitaciones

- Los agentes comparten la planificación del Bot A: están separados por responsabilidad
  y competencia, pero todavía no son programas independientes ni aprenden.
- El Coordinador solo tiene una orden propia, el cambio de pista; la secuencia que
  calcula se apoya en el planificador común.
- La predicción de los supervisores usa trayectorias rectas: no ve los giros previstos
  y por eso una orden puede quedar DUDOSA sin serlo. Las pistas paralelas en final las
  juzga el Rulebook.

## Mapa de archivos

| Ruta | Contenido |
|---|---|
| `src/assets/scripts/client/bot/botC/BotC.js` | Ciclo de decisión y competencias |
| `src/assets/scripts/client/bot/botC/agents.js` | Agentes, responsable de cada avión y órdenes permitidas |
| `src/assets/scripts/client/bot/botC/supervision/supervisors.js` | Juicio de cada instrucción |
| `src/assets/scripts/client/bot/botC/supervision/SupervisionSystem.js` | Supervisor global y registro |
| `src/assets/scripts/client/bot/botC/supervision/independentPrediction.js` | Predicción propia de los supervisores |
| `src/assets/scripts/client/realism/takeoffCancel.js` | V1, ocupación de pista y juicio de la cancelación |
| `test/bot/botC.spec.js`, `test/realism/takeoffCancel.spec.js` | Tests |

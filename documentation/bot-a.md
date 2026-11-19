# Bot A: reglas expertas y metaheurísticas

El Bot A es un controlador experto programado: cada orden sale de reglas y de
algoritmos de planificación, y cada una lleva su motivo. No necesita entrenamiento.
La referencia común a todos los bots está en
[bot-information.md](bot-information.md).

## Índice

1. [Cómo usarlo](#cómo-usarlo)
2. [Qué hace en cada ciclo](#qué-hace-en-cada-ciclo)
3. [Detalles del control](#detalles-del-control)
4. [Parámetros y ajuste](#parámetros-y-ajuste)
5. [Resultados](#resultados)
6. [Limitaciones](#limitaciones)
7. [Mapa de archivos](#mapa-de-archivos)

## Cómo usarlo

En el juego, escribe `bot a`; con `bot off` recuperas el control.

Sin navegador:

```sh
node tools/sim/run-bot.js --bot A --airport lemd --seed 1 --minutes 60
```

Opciones: `--wind 180/15`, `--traffic 1.5`, `--emergencies 0.05`,
`--params bots/params/botA_tuned.json` y `--verbose`, que imprime cada orden con su motivo.

## Qué hace en cada ciclo

Cada 5 s (`src/assets/scripts/client/bot/botA/BotA.js`) hace, en este orden:

1. **Seguridad.** Aplica las acciones que impone el escudo de seguridad.
2. **Conflictos (CD&R).** Predice las trayectorias 2 minutos hacia delante. Si
   dos aviones van a perder la separación, elige la maniobra de menor coste:
   parar un ascenso o descenso, cambiar de nivel o un viraje. Antes de darla
   **comprueba que funciona**: que separa a la pareja y no crea un conflicto con
   un tercero. Si mover a un avión no basta, **coordina a los dos** con órdenes
   complementarias: uno sube y otro baja, uno acelera y otro frena, o giran
   alejándose. Si nada lo evita del todo, da lo que más retrasa la primera pérdida
   de cualquier pareja, salvo si eso lo mete en una pérdida real con un tercero
   en menos de 60 s: entonces no hace nada, porque crearía una pérdida nueva.
   Mantiene la maniobra hasta que reanudar la ruta ya no
   recrearía el conflicto. Las maniobras laterales y verticales se recuerdan por
   separado, para que una no borre a la otra.
   - Nunca da como resolución el nivel que el avión ya tiene autorizado: no
     cambia nada.
   - La predicción mira cada 2 s los primeros 10 s y cada 10 s después: un
     ascenso o descenso empieza enseguida, y dos aviones a 2 NM pierden la
     separación en 3 s, antes de que una predicción más gruesa lo vea.
   - Una orden de altitud se predice como la vuela el simulador, directa al
     nivel (modo HOLD). En los ascensos esto es clave: en VNAV, una restricción
     "a o por debajo" de la STAR hacía creer que el avión no subía, y subía
     contra el tráfico. En los descensos se mantiene la predicción por el
     procedimiento, que se midió mejor.
   - La predicción de los aviones que suben o bajan por el procedimiento
     (`dvs` / `cvs`) reproduce la del simulador: respetan la siguiente
     restricción "a o por encima" y "a o por debajo", y empiezan a bajar en su
     punto de inicio de descenso.
   - Dos aviones en la misma final se espacian por la secuencia. En finales
     paralelas **independientes** (ejes a 1035 m o más; 4300 ft con el perfil
     FAA) no se exige nada una vez establecidos los dos (ICAO Doc 4444 6.7.3.2,
     FAA 5-9-7). En paralelas **dependientes**, el mínimo en diagonal según la
     distancia entre ejes (1, 1,5 o 2 NM, FAA 5-9-6). Hasta estar establecidos,
     3 NM o 1000 ft como cualquiera.
   - Antes de mover a un avión en emergencia prueba todas las maniobras del
     otro.
3. **Salidas (DMAN).**
   - Saca aviones del aparcamiento mientras haya sitio en la cola del punto de
     espera (máximo 4 por pista).
   - En cada pista despega primero la salida que más lleva esperando de entre
     las que pueden irse ya.
   - Para poder irse, una salida necesita pista libre, el tiempo de estela tras
     la anterior y que ninguna llegada vaya a necesitar la pista. Tras otra
     salida de la misma pista: **1 minuto solo si las derrotas iniciales
     divergen 45° o más** (ICAO Doc 4444 5.8.2), 2 minutos si no, y 1 minuto
     más si la de detrás es 30 kt o más rápida.
   - No autoriza despegues por la pista de una emergencia en los 4 minutos
     anteriores a su aterrizaje.
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
     ofrece un hueco claramente antes y está de su lado. Solo entre paralelas que
     admiten aproximaciones simultáneas: dos pistas demasiado juntas (24R/24L y
     25L/25R en KLAX, a unos 700 ft) exigen la mínima radar completa entre las
     dos finales, no añaden capacidad y sus llegadas se cruzan.
   - **Emergencias primero**: tras optimizar, el avión en emergencia pasa
     delante de todos salvo los que ya están en el localizador o virando hacia
     él. Ver [emergencias.md](emergencias.md#bot-a).
5. **Absorber el retraso** que pide la secuencia:
   - **Reduce la velocidad.** Busca por bisección la velocidad que cuadra la
     hora.
   - **Manda a espera** si el retraso es grande. Cada avión va a un nivel libre
     de la pila (separados 1000 ft), bajan conforme se libera el de abajo y
     sale primero el de abajo. Solo usa fijos a más de 10 NM del límite del
     espacio aéreo.
   - **Alarga el tramo de viento en cola** cuando el avión va con vectores
     (la "trombón").
6. **Vectores al ILS: unión en cualquier punto del localizador.**
   - El punto de unión no es fijo. Cada ciclo se prueba cada 0,5 NM, desde la
     unión más cercana permitida (`minimumJoinDistanceNm`, 8 NM, y nunca tan
     cerca que no dé tiempo a capturar la senda desde abajo) hasta la más lejana
     del circuito. Se elige la que aterriza más cerca de la hora asignada:
     **aterrizar antes es aceptable** (cada segundo de adelanto cuenta solo un
     cuarto), aterrizar después es lo que se evita.
   - **El terreno se mira a lo largo de la trayectoria**, no alrededor: la
     altitud de unión es la mayor entre la del circuito y la altitud mínima de
     vectores en la base y en el tramo de interceptación. Una unión solo vale si
     el avión puede estar nivelado por debajo de la senda 2 NM antes, bajando de
     forma progresiva por el camino. Antes, en LEMG, las llegadas se quedaban a
     7000 ft por el terreno de los 6 NM de alrededor y se unían a 24 NM; ahora se
     unen a unas 12 NM.
   - Cada unión candidata se comprueba contra **todos** los aviones del
     localizador: los que ya están en final, en su posición real, y los que van
     a unirse por delante en la secuencia o ya están en base. Se simula el
     espaciado hasta el umbral, incluida la **compresión**: el simulador
     mantiene la velocidad autorizada hasta 5 NM y frena después hasta la de
     aterrizaje en la puerta estabilizada, así que el hueco se cierra en las
     últimas millas. Esto causaba pérdidas de estela como "2,9 NM con mínimo
     3 NM".
   - También se descartan las uniones para las que el avión no puede bajar a
     tiempo.
   - Con mucho tráfico la unión se aleja (se alarga la cola). Si no hay ningún
     hueco, el avión espera en el viento en cola más largo.
   - **Acortar** (unirse más cerca que la unión nominal de `interceptDistanceNm`,
     10 NM) es arriesgado. Solo se hace si el avión va más de
     `shortJoinPenaltySeconds` (60 s) tarde o si ninguna unión más larga cabe sin
     mover a los de delante o detrás, y exige `shortJoinBufferNm` (1 NM) más de
     espaciado.
   - Vira a base cuando lo que queda hasta la unión basta para bajar a la altitud
     de interceptación, no a una altitud fija.
   - Un avión que ya está cerca del eje y vuela hacia la pista desde más allá de
     la unión sigue hacia el localizador: un viento en cola le haría dar la vuelta.
   - Los aviones que llegan desde más lejos que el punto de base (por ejemplo
     desde RUDBI o FAFEQ en LEMD norte) no dan la vuelta por el viento en cola:
     van directos al punto de base (tramo *inbound*) y se unen donde haga falta.
   - Funciona como una secuencia que solo avanza: viento en cola o *inbound*,
     base, interceptación y autorización ILS. En viento en cola e *inbound* el
     avión se mantiene por encima de la altitud mínima de vectores de las
     próximas 8 NM de su trayectoria (2 NM en base e interceptación), con un
     pequeño margen a cada lado. Solo sin datos de terreno se usa la de los 6 NM
     de alrededor.
   - Intercepta por debajo de la senda de planeo, a 30°.
   - Da primero el rumbo y después la autorización ILS, porque un rumbo
     posterior la cancelaría.
   - Si se queda alto, se pasa del localizador o en base ya no hay hueco donde
     va a unirse, rompe la aproximación y vuelve al viento en cola.
   - Solo los aviones ya comprometidos (en base, interceptando o en final) se
     separan por esta planificación. En viento en cola o *inbound* los vigila
     también la detección de conflictos.
7. **En final, en base y en la interceptación.** Mantiene el espaciado con la
   velocidad. Elige la más rápida (hasta la de aterrizaje) con la que el
   espaciado previsto al umbral, con la compresión incluida, sigue cumpliendo
   el mínimo.

## Detalles del control

**Descensos progresivos (`dvs`) y vectores.** Un avión que deja la STAR por
vectores sigue en modo VNAV: aunque su altitud autorizada coincida con la del
perfil, obedece las restricciones de la STAR y puede quedarse nivelado minutos
(se vio en LEMG: 8000 ft con 7000 autorizados durante dos minutos). Por eso, a un
avión vectorizado en VNAV se le da un nivel explícito del perfil (nunca por
encima de donde está) aunque coincida con el autorizado. Además, cada nivel del perfil se
mantiene por encima del **suelo del espacio aéreo a lo largo de toda la
trayectoria prevista** hasta el localizador (con 500 ft de margen), no solo en
la proa actual: el tramo de viento en cola se aleja del aeropuerto hacia
sectores con el suelo más alto, y antes el escudo tenía que subir al avión
contra el tráfico.

**Circuito dentro del espacio aéreo (cualquier aeropuerto).** En LEMD o EDDM
la TMA es enorme, pero en muchos aeropuertos el espacio aéreo es pequeño por un
lado de la final (EGNM: unas 3 NM a un lado y 12 al otro) o se acaba a 20 NM
(KDAB). Por eso:
- Para cada pista y lado se calcula hasta dónde caben el viento en cola, la base
  y la final con 2 NM de margen dentro del espacio aéreo. El viento en cola no
  se alarga más allá, y las uniones lejanas al localizador se limitan a eso.
- Se usa el lado de la final con más sitio si el otro deja al menos 3 NM más.
- Si en el viento en cola la derrota va a salir del espacio aéreo en el
  próximo minuto, vira a base; si aún está demasiado cerca para la base, pasa
  el viento en cola al otro lado de la final (una sola vez).
- **Techo**: las llegadas no suben por encima del techo del espacio aéreo
  menos 500 ft, ni donde están ni en su derrota de los próximos 2 minutos
  (`airspaceCeiling`, `airspaceCeilingAhead` en la observación). El escudo lo
  prohíbe, baja a la que vuela hacia un techo más bajo, y la resolución de
  conflictos solo elige maniobras permitidas.
- **Repisas de Clase B**: donde dos sectores superpuestos dejan un hueco de
  altitud entre ellos (de los aeropuertos activos, solo KLAX) se comprueba cada
  nivel contra los sectores reales (`hasAltitudeGaps`, `isInsideAirspaceAt`).
  En el resto no se aplica: empeoraba LEMD y EDDM.

Esto lo detectó `tools/sim/check-airports.js` al probar todos los aeropuertos.

**Comprobación de niveles.** Toda altitud que piden la secuencia, la espera o
los vectores pasa antes por una comprobación: se predice el ascenso o descenso
completo, no solo el nivel final, y un nivel que otro avión está dejando solo se
ocupa cuando ya está libre (si el de delante se nivelara, seguiría habiendo
separación). Si el nivel pedido no es seguro, el avión se queda en el nivel
seguro más cercano a él y lo vuelve a intentar en el siguiente ciclo. En una
espera, un avión solo baja al nivel de abajo cuando el que lo ocupaba lo ha
dejado de verdad. Si una resolución lo movió a otro nivel libre de la pila, se
queda en él en lugar de volver a su nivel atravesando el tráfico.

**Suelo de un sector más alto por delante.** El escudo obliga a subir a una
llegada que vuela hacia un sector con el suelo más alto. Esa subida también pasa
por la comprobación de niveles. Si el tráfico de arriba no deja subir nada y
además el terreno por delante supera al avión (la sierra de Guadarrama en LEMD
sur), vira hacia el aeropuerto. Con solo un suelo más alto mantiene su derrota:
virarlo hacia el tráfico del aeropuerto costaba más (KLAX, EDDM).

**Rupturas de aproximación.** Cuando el escudo rompe una aproximación, el avión
mantiene el rumbo de ruptura 45 s y después se le vectoriza en un circuito
nuevo, en lugar de volver enseguida al localizador. Una maniobra lateral para
resolver un conflicto termina antes de tiempo si el rumbo lleva hacia terreno
más alto que el avión.

## Parámetros y ajuste

Todos los márgenes y umbrales son **parámetros** con su rango de ajuste
(`botA/botAParameters.js`). `tune_bot_a` los optimiza con CMA-ES: ver
[bot-training.md](bot-training.md#paso-2-ajustar-el-bot-a-opcional-1-3-horas).

- `bots/params/botA_tuned.json` está **desfasado** respecto al código actual: hay
  que repetir el ajuste antes de usarlo.
- El ajuste no influye en el Bot B: su imitación usa los parámetros por defecto.

## Resultados

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

**Unión al ILS en cualquier punto (octubre de 2026).** Se comparó con la versión
anterior (unión fija a unas 10 NM y alargando solo el viento en cola) en 18
episodios de 60 minutos con semillas 4 a 9 (LEMD norte, LEMD sur con viento
180/15 y EDDM). Se usa la puntuación del juego: −200 por pérdida radar y −100
por pérdida de estela.

| | Antes | Ahora |
|---|---|---|
| Aterrizajes | 244 | 255 |
| Pérdidas radar | 131 | 100 |
| Pérdidas de estela | 4 | 5 |
| Puntuación total | −21 235 | −16 950 |

Mejora sobre todo LEMD sur (+11 aterrizajes, 19 pérdidas radar menos). En EDDM
hay menos pérdidas pero también 7 aterrizajes menos, y en LEMD norte hay 7
aterrizajes más con las mismas pérdidas. Un episodio suelto varía en unos ±1500
puntos, así que los cambios se evalúan siempre con muchas semillas.

**Emergencias, límites del espacio aéreo y salidas (31 de octubre de 2026).**
24 episodios de 60 minutos, semillas 4 a 9, en LEMD norte, LEMD sur (180/15),
EDDM y LEMG, sin emergencias:

| | Antes | Ahora |
|---|---|---|
| Puntuación total | −16 910 | −14 240 |
| Aterrizajes | 304 | 316 |
| Despegues entregados | 395 | 392 |
| Pérdidas de separación | 104 | 101 |
| Pérdidas de estela | 5 | 1 |
| Salidas de espacio aéreo | 11 | 3 |
| Infracciones de nivel 0 | 0 | 0 |

**Cuidado al leer esta tabla:** "Ahora" incluye la regla nueva de aproximaciones
paralelas independientes, que deja de penalizar situaciones legales. En una
versión intermedia esa regla sola valía unos 4400 puntos en estos episodios, así
que la mejora de puntuación se debe a ella más que al bot. Lo que sí es del bot:
más aterrizajes, menos pérdidas de estela y menos salidas del espacio aéreo. Las
pérdidas de separación apenas cambian. En semillas 10 a 15 la versión final da
−20 680 (sin referencia anterior con la que comparar).

Con un 10 % de emergencias (mucho más que el 1 % del juego): de 126 declaradas,
**68 aterrizaron a tiempo y 18 incumplieron el plazo** (79 % de las resueltas); las
40 restantes seguían en vuelo al acabar el episodio. Hubo 1 infracción de nivel 0.

Se probaron y **descartaron** por medición: escalonar 1000 ft las finales
paralelas (−16 530 frente a −12 755), dar el nivel antes que el rumbo a los aviones
en VNAV (−12 755 frente a −9635) y predecir las resoluciones en modo HOLD
(−15 335 frente a −9635). En noviembre, con el resto del bot cambiado, predecir en
HOLD **solo los ascensos** sí mejoró mucho (ver más abajo); en los descensos sigue
siendo peor.

**Resolución coordinada (31 de octubre de 2026).** 30 episodios de 60 minutos,
semillas 4 a 9, en LEMD norte, LEMD sur (180/15), EDDM, LEMG y KLAX, sin emergencias.

| Versión | LEMD | EDDM | LEMG | KLAX | Total | Aterrizajes |
|---|---|---|---|---|---|---|
| Base: mueve a un avión, puede meterlo en un tercero | −9910 | −7080 | −210 | −22 425 | −39 625 | 456 |
| Un avión, sin terceros, no actúa si nada retrasa la pérdida | −7220 | −5135 | −370 | −28 880 | −41 605 | 482 |
| Lo anterior, actuando siempre | −11 895 | −7755 | −210 | −24 470 | −44 330 | 468 |
| Coordina a los dos y no actúa si nada retrasa la pérdida | −7120 | −6875 | −370 | −32 210 | −46 575 | 481 |
| **Coordina a los dos y actúa siempre (actual)** | −10 825 | −5910 | −400 | −21 825 | **−38 960** | 469 |

La versión actual es el mejor total y la que elige el proyecto: nunca renuncia a
evitar un conflicto. Su coste es **LEMD sur**, que baja de −7240 a −11 360. LEMD norte
mejora de +20 a +535, y las pérdidas de separación totales bajan de 226 a 221.

Se investigó LEMD sur y se probaron dos cambios, **descartados** por medición:

| Cambio | Total | LEMD |
|---|---|---|
| No repetir un nivel ya autorizado | −46 500 | −14 805 |
| No reanudar un descenso a los 240 s si el conflicto sigue | −39 535 | −12 945 |
| Los dos | −46 950 | −12 815 |

Sigue sin resolver: en LEMD sur, un avión que reanuda el descenso tras 240 s se acerca al
que tiene 1000 ft debajo y pierde la separación a unos 930-949 ft, a veces varias veces
seguidas con la misma pareja.

**Unión al ILS sobre el terreno y pérdidas de separación (17 de noviembre de
2026).** Mismo protocolo: 30 episodios de 60 minutos, semillas 4 a 9, LEMD norte,
LEMD sur (180/15), EDDM, LEMG y KLAX, sin emergencias.

| | LEMD norte | LEMD sur | EDDM | LEMG | KLAX | Total |
|---|---|---|---|---|---|---|
| Antes (resolución coordinada) | 535 | −11 360 | −5910 | −400 | −21 825 | −38 960 |
| **Ahora** | 1750 | −2050 | 240 | 1100 | −4985 | **−3945** |

| | Antes | Ahora |
|---|---|---|
| Pérdidas de separación radar | 221 | 43 |
| Pérdidas de estela | 10 | 5 |
| Aterrizajes | 466 | 494 |
| Despegues entregados | 537 | 539 |
| Salidas del espacio aéreo | 1 | 1 |
| Vectores bajo la altitud mínima | 0 | 5 |
| Colisiones (aviones o terreno) | 0 | 0 |
| LEMG: minutos y NM por llegada | 27,6 / 106 | 24,0 / 96 |

De dónde sale la mejora, en orden de medición: la unión al ILS sobre el terreno
(−38 960 → −32 860); no repartir llegadas entre paralelas demasiado juntas en
KLAX, no repetir niveles y no meter a nadie en un tercero (→ −20 090); predecir
más fino los primeros segundos y no reanudar la STAR en las esperas (→ −14 085);
y sobre todo **predecir las órdenes de altitud en modo HOLD** (→ −5145). Los
vectores bajo la altitud mínima son de LEMD sur (3), EDDM y KLAX.

Se probaron y **descartaron** por medición: 30 s mínimos en el viento en cola
tras volver de la base (pérdidas 39 → 66), virar hacia el aeropuerto también por
un suelo más alto sin terreno (KLAX 17 → 28 pérdidas), terminar antes una
resolución vertical si hay terreno por delante (mejor en LEMD sur, peor en EDDM)
y comprobar la subida inicial de cada despegue contra el tráfico (EDDM 6 → 3
pérdidas, pero 19 despegues menos y KLAX peor).

**Todos los aeropuertos** (`check-airports.js`, 20 minutos, semilla 1): 58 con
tráfico suficiente para entrenar, todos sin fallos con la versión de noviembre.
Los 20 minutos son pocos para aterrizar, así que sirve para detectar fallos, no
para medir rendimiento.

## Limitaciones

- Sigue perdiendo la separación, aunque mucho menos: unas 1,4 veces por hora de
  media en estos cinco escenarios. Casi todas en KLAX (esperas en niveles altos,
  aviones nivelados contra otros que bajan por la senda de otra pista) y en LEMD
  sur. En EDDM quedan salidas que suben contra llegadas vectorizadas.
- En LEMD sur todavía hay algún vector bajo la altitud mínima cerca de la sierra.
- Un avión puede alternar entre viento en cola y base varios ciclos seguidos
  cuando los dos criterios de "demasiado alto" no coinciden.
- No usa las órdenes `lineup` ni `abort`: eso lo hace Torre en el
  [Bot C](bot-c.md).
- Las frustradas siguen el rumbo actual, no el procedimiento publicado.

## Mapa de archivos

| Ruta | Contenido |
|---|---|
| `src/assets/scripts/client/bot/botA/BotA.js` | Ciclo de decisión y control de cada avión |
| `src/assets/scripts/client/bot/botA/sequencing.js` | Secuencia de aterrizaje (recocido simulado) |
| `src/assets/scripts/client/bot/botA/arrivalPlanner.js` | Rutas, circuito y perfil de descenso |
| `src/assets/scripts/client/bot/botA/finalApproach.js` | Compresión y espaciado en final |
| `src/assets/scripts/client/bot/botA/conflictResolution.js` | Detección y resolución de conflictos |
| `src/assets/scripts/client/bot/botA/botAParameters.js` | Parámetros y rangos de ajuste |
| `bots/python/openscope_bots/tune_bot_a.py` | Ajuste con CMA-ES |
| `bots/params/` | Parámetros ajustados |

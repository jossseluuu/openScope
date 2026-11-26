# Emergencias (squawk 7700)

De vez en cuando un vuelo declara una emergencia. Aparece en **rojo** en la
pantalla y hay que hacerlo aterrizar **con prioridad sobre el resto del tráfico**
antes de un plazo generoso. Funciona igual cuando controla una persona, el
Bot A o el Bot B, en el navegador y en el simulador sin navegador.

## Índice

- [Cuándo ocurren](#cuándo-ocurren)
- [Tipos y plazos](#tipos-y-plazos)
- [Cómo se ven](#cómo-se-ven)
- [Qué hace el piloto](#qué-hace-el-piloto)
- [Qué debe hacer el controlador](#qué-debe-hacer-el-controlador)
- [Puntuación](#puntuación)
- [Comandos y opciones](#comandos-y-opciones)
- [Cómo las gestionan los bots](#cómo-las-gestionan-los-bots)
- [En el simulador y en el entrenamiento](#en-el-simulador-y-en-el-entrenamiento)
- [Normativa de referencia](#normativa-de-referencia)
- [Archivos](#archivos)

## Cuándo ocurren

Cada vuelo tiene una probabilidad de declarar una emergencia, que se elige en
**Settings → Emergencies (squawk 7700)**:

| Opción | Probabilidad por vuelo | Para qué |
|---|---|---|
| Off | 0 % | sin emergencias |
| Rare (por defecto) | 1 % | lo realista: con unos 45 movimientos por hora en LEMD, una cada dos horas aproximadamente |
| Occasional | 3 % | más práctica sin saturar |
| Frequent | 10 % | entrenamiento intensivo |

Se decide cuando el vuelo pasa a estar bajo nuestro control:

- **Llegadas**: declaran entre 1 y 12 minutos después de entrar en nuestro
  espacio aéreo, siempre que no estén ya a punto de aterrizar (autorizadas al
  ILS a menos de 12 NM del umbral o en la fase de aterrizaje).
- Las **salidas** y los sobrevuelos **nunca** declaran emergencias. La orden
  `emergency` tampoco funciona con ellos.

## Tipos y plazos

El plazo para aterrizar es el **mayor** de dos valores: el mínimo del tipo de
emergencia, o lo que tarda una aproximación directa desde donde está el avión
(distancia al umbral a 200 kt, más 4 minutos de circuito) **más 10 minutos**.
Así, un avión que declara lejos siempre tiene tiempo de sobra.

| Tipo | Mensaje del piloto | Plazo mínimo | Frecuencia relativa |
|---|---|---|---|
| `MEDICAL` | medical emergency on board | 25 min | 4 |
| `ENGINE_FAILURE` | engine failure | 20 min | 3 |
| `HYDRAULIC_FAILURE` | hydraulic failure | 25 min | 2 |
| `PRESSURIZATION` | loss of cabin pressure | 20 min | 2 |
| `SMOKE` | smoke in the cabin | 15 min | 1 |
| `FUEL` | MAYDAY fuel | 18 min | 2 |

## Cómo se ven

- El **punto del radar**, su **histórico** y un **doble anillo** (1,5 y 2 NM)
  alrededor del avión en rojo.
- El **bloque de datos** y su línea guía en rojo (con relleno rojo en el tema
  *Classic*), y la segunda línea termina en `EM`: `120 25 EM`.
- La **ficha de progreso** (strip) con fondo rojo.
- En el registro de radio, en rojo:
  `Madrid Approach, IBE3141 MAYDAY MAYDAY MAYDAY, engine failure, squawking 7700, request priority landing`
  y `IBE3141 is in EMERGENCY: land it within 20 min`.

## Qué hace el piloto

- Pone el transpondedor en **7700** y lo mantiene: si se le pide otro código
  responde `unable, we are in an emergency, squawking 7700`.
- **No acepta esperas**: `unable to hold, we are in an emergency, ...`. Si ya
  estaba en una espera, el controlador debe sacarlo (`xh`) y darle vectores.
- Todo lo demás (vectores, descensos, autorización ILS) lo da el controlador.

El controlador **no puede asignar** los códigos de emergencia 7500, 7600 y 7700
con `sq`.

## Qué debe hacer el controlador

Lo que haría un controlador real (ICAO Doc 4444, capítulo 15):

1. **Prioridad en la secuencia de aterrizaje**: la emergencia va delante de
   todos los que aún no están en el localizador o virando hacia él. Los demás
   se reajustan detrás (velocidad, tramo de viento en cola más largo, esperas).
2. **Vectores directos**: si va por una STAR, sacarlo de ella cuando los
   vectores acorten el recorrido; unirlo al localizador lo más cerca que
   permita la separación con quien ya está en final.
3. **Descenso rápido**: `a 50 ex` (expedite) cuando haya que bajar mucho.
4. **Pista libre**: no autorizar despegues por la pista de la emergencia en
   los minutos anteriores a su aterrizaje.
5. **La separación sigue siendo obligatoria**: el avión en emergencia tiene
   prioridad, pero perder la separación con él cuenta igual. Normalmente se
   mueve a los demás, no a la emergencia.

## Puntuación

| Evento | Puntos | Cuándo |
|---|---|---|
| `EMERGENCY_DECLARED` | 0 | al declararse (solo se cuenta, para los informes) |
| `EMERGENCY_LANDING` | **+50** | toma de contacto antes del plazo, además de los +10 del aterrizaje |
| `EMERGENCY_DEADLINE_MISSED` | **−300** | el plazo vence con el avión en el aire, o sale del espacio aéreo |

El plazo incumplido es también una violación del Rulebook,
`EMERGENCY_DEADLINE`, de **nivel 1** (como la separación): nunca compensa
perder separación para aterrizar una emergencia, pero ninguna ganancia de
eficiencia compensa dejarla en el aire. Una pérdida de separación vale −200;
el plazo incumplido, −300.

## Comandos y opciones

| Comando | Qué hace |
|---|---|
| `emergency` (o `mayday`) | un avión al azar en el aire y bajo nuestro control declara una emergencia ahora (para practicar) |
| `emergency IBE3141` | ese avión declara una emergencia ahora, si puede |
| `IBE3141 a 50 ex` | descenso expedito |
| `IBE3141 xh` | salir de la espera |

Opción del juego: **Settings → Emergencies (squawk 7700)** (ver arriba).

## Cómo las gestionan los bots

Los bots ven, en cada avión de la observación, `squawk` y `emergency`:

```json
"emergency": {
    "type": "ENGINE_FAILURE",
    "description": "engine failure",
    "declaredAt": 1834,
    "deadline": 3034,
    "remainingSeconds": 812
}
```

y en `realism.emergencies` la lista de emergencias en curso.

### Máscara de acciones (para los dos bots)

- `HOLD` está prohibido para un avión en emergencia.
- Las acciones de altitud que bajan 1000 ft o más se envían con `ex`
  (descenso expedito), y la predicción de conflictos usa entonces la
  velocidad vertical máxima.

### Bot A

- **Secuencia (AMAN)**: tras optimizar la secuencia, la emergencia se coloca
  detrás solo de los aviones ya comprometidos (en el localizador o en el tramo
  de interceptación) que aterrizan antes de lo que ella podría; el resto pasa
  detrás y absorbe el retraso.
- **Ruta**: si va por la STAR y los vectores acortan el recorrido en 3 NM o
  más, la saca de la STAR con un rumbo hacia el viraje a base (si está más
  lejos) o hacia el tramo de viento en cola.
- **Unión al localizador**: elige la unión que aterriza antes, sin penalizar
  las aproximaciones acortadas, y solo cede ante quien ya está en el
  localizador o virando hacia él. Los que están en base y le estorban vuelven
  al tramo de viento en cola.
- **Velocidad**: 220 kt hasta la base (en vez de 210) y nunca reduce para
  absorber retraso.
- **Esperas**: nunca la manda a esperar; si estaba en una, la saca (`xh`).
- **Pista paralela**: puede cambiarla a la paralela más cerca del aeropuerto
  (12 NM en vez de 35), más a menudo y por una ganancia menor (20 s).
- **Despegues**: no autoriza despegues por esa pista durante los 4 minutos
  anteriores a su hora prevista de aterrizaje.
- **Conflictos**: prueba todas las maneras de mover al otro avión antes de
  mover a la emergencia.

### Bot B

- Las características de entrada incluyen en cada avión `emergency` y
  `emergency_remaining` (tiempo restante / 30 min), y en las globales
  `emergency_count`. Los aviones en
  emergencia van siempre los primeros en la lista de aviones que ve la red.
- La **recompensa** suma +3 por cada emergencia aterrizada a tiempo, −6 por
  cada plazo incumplido (en lugar de contarlo como nivel 1) y −0,002 por
  segundo y emergencia en el aire, para que aterrizarla antes siempre sea mejor.
- Aprende la gestión del Bot A por imitación y la mejora con PPO. Un modelo
  entrenado con la versión 2 ya no se carga: hay que entrenarlo de nuevo (ver
  [bot-training.md](../bots/entrenamiento.md)).

## En el simulador y en el entrenamiento

- `node tools/sim/run-bot.js --bot A --airport lemd --emergencies 0.1`: la
  probabilidad por vuelo (por defecto 0.01; `0` las desactiva). El resumen
  incluye `emergencies: { declared, landedInTime, missed }`.
- `HeadlessSimulator#reset(icao, seed, { emergencyRate })`, y en el puente de
  Python `reset(..., emergencyRate=...)` / `rl_reset(..., emergencyRate=...)`.
- En la configuración del Bot B, `env.emergency_rate` es un intervalo
  `[mínimo, máximo]` del que se sortea la probabilidad de cada episodio.
- Las emergencias usan **su propio generador aleatorio**, sembrado con la
  semilla del episodio: con la misma semilla se repiten igual, y activarlas o
  desactivarlas no cambia el resto del tráfico.

## Resultados

Bot A con un 10 % de emergencias, 24 episodios de 60 minutos en LEMD norte, LEMD
sur, EDDM y LEMG: de 126 declaradas, 68 aterrizaron a tiempo, 18 incumplieron el
plazo y 40 seguían en vuelo al terminar el episodio. Esa medición incluye salidas en
emergencia, que ya no existen. Las causas de plazo incumplido que se encontraron y
corrigieron fueron el cambio continuo de pista paralela y los circuitos demasiado altos.
El Bot B aún no se ha entrenado, así que no hay resultados suyos.

## Normativa de referencia

- ICAO Doc 4444 (PANS-ATM) 15.1.1 a 15.1.3: aeronaves en emergencia, prioridad
  y asistencia.
- ICAO Doc 8168 y Anexo 10 vol. IV: código 7700 de emergencia, 7600 de fallo
  de comunicaciones y 7500 de interferencia ilícita.
- FAA JO 7110.65, 10-2-5: prioridad de las aeronaves en emergencia.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `src/assets/scripts/client/realism/EmergencyController.js` | probabilidades, tipos, plazos, declaración, puntuación |
| `src/assets/scripts/client/realism/Rulebook.js` | regla `EMERGENCY_DEADLINE` |
| `src/assets/scripts/client/game/GameController.js` | eventos y puntos |
| `src/assets/scripts/client/aircraft/AircraftCommander.js` | rechazo de esperas y de cambios de squawk |
| `src/assets/scripts/client/canvas/CanvasController.js`, `constants/themes/*` | dibujo en rojo |
| `src/assets/scripts/client/aircraft/StripView/StripViewModel.js`, `style/landmark/_stripView.less` | ficha en rojo |
| `src/assets/scripts/client/bot/actionSpace.js` | máscara y descenso expedito |
| `src/assets/scripts/client/bot/botA/BotA.js` | gestión del Bot A |
| `src/assets/scripts/client/bot/rl/featureEncoder.js`, `rewardFunction.js` | Bot B |
| `test/realism/EmergencyController.spec.js`, `test/bot/emergency.spec.js` | pruebas |

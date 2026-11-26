# Bot B: aprendizaje por refuerzo

El Bot B es una red neuronal que controla el tráfico. Primero aprende imitando al
Bot A y después mejora por su cuenta, por recompensa. **Todavía no está entrenado**:
`bot b` no funciona hasta completar [bot-training.md](entrenamiento.md). La referencia
común a todos los bots está en [bot-information.md](informacion.md).

## Índice

1. [Cómo usarlo](#cómo-usarlo)
2. [La red](#la-red)
3. [Qué ve y qué puede hacer](#qué-ve-y-qué-puede-hacer)
4. [Cómo aprende](#cómo-aprende)
5. [Recompensa](#recompensa)
6. [Seguridad](#seguridad)
7. [Compatibilidad de modelos](#compatibilidad-de-modelos)
8. [Limitaciones](#limitaciones)
9. [Mapa de archivos](#mapa-de-archivos)

## Cómo usarlo

El proceso completo, con los comandos y tiempos, está en
[bot-training.md](entrenamiento.md). En resumen:

1. Entrenar con `openscope_bots.train`.
2. Comparar con el Bot A con `openscope_bots.evaluate`.
3. Exportar con `openscope_bots.export_onnx` y recompilar el juego.
4. Escribir `bot b` en el juego; `bot off` te devuelve el control.

## La red

- Un *transformer* de 3 capas sobre la lista de aviones, con una cabeza de política
  por avión y otra de valor: unos 480.000 parámetros.
- Decide una acción para cada avión cada 10 s.
- En el navegador se ejecuta con ONNX Runtime Web, que se descarga de internet la
  primera vez.

## Qué ve y qué puede hacer

- **Entrada:** hasta 48 aviones × 55 rasgos, más 6 rasgos globales (versión 6 de la
  codificación). Los aviones en emergencia van los primeros.
- **Salida:** una de las 66 acciones del catálogo por avión, también `lineup` y
  `abort`. El detalle está en
  [la observación](informacion.md#la-observación-qué-ve-un-bot) y en
  [acciones](informacion.md#acciones).

## Cómo aprende

| Fase | Qué hace |
|---|---|
| **Imitación** | Copia 40.000 decisiones del Bot A, con sus parámetros por defecto |
| **DAgger** | La red vuela y el Bot A corrige sus errores, en 3 rondas |
| **PPO, etapa 1** | Poco tráfico en LEMD, LEMG y EDDM |
| **PPO, etapa 2** | Todos los aeropuertos, tráfico medio, algo de viento y emergencias frecuentes |
| **PPO, etapa 3** | Todos los aeropuertos, tráfico completo, viento variable y emergencias |

Los aeropuertos salen de `bots/configs/airports.json`; la configuración, de
`bots/configs/default.json`. También puede aprender de partidas auditadas exportadas
desde el panel, ver [bot-training.md](entrenamiento.md#aprender-también-de-partidas-auditadas).

## Recompensa

Se construye con el Rulebook, ponderada por niveles
(`bot/rl/rewardFunction.js`):

| Evento | Recompensa |
|---|---|
| Nivel 0, seguridad | −10 |
| Colisión entre aviones | −10 |
| Plazo de emergencia incumplido | −6 |
| Salir del espacio aéreo o entrar en zona restringida | −5 |
| Nivel 1, separación | −3 |
| Frustrada o salir sin estar en ruta | −1 |
| Nivel 2, procedimiento (incluye cancelar un despegue sin justificación) | −0,5 |
| Interceptar por encima de la senda | −0,3 |
| Aterrizaje o salida | +1 |
| Emergencia aterrizada a tiempo | +3 |
| Por segundo y emergencia en el aire | −0,002 |
| Por segundo y avión bajo control | −0,0005 |
| Por orden dada | −0,002 |

## Seguridad

El [escudo de seguridad](informacion.md#escudo-de-seguridad) está activo también
durante el entrenamiento: la red solo elige entre las acciones permitidas, y el
escudo impone las necesarias para evitar una infracción inminente.

## Compatibilidad de modelos

Un modelo solo funciona con la codificación y el catálogo de acciones con los que se
entrenó. Si cambian la observación, los rasgos o las acciones, hay que entrenarlo de
nuevo desde la imitación: `--resume` no sirve y el juego rechaza el modelo.

## Limitaciones

- Sin entrenar, no hay resultados suyos que comparar con los Bots A y C.
- Sus decisiones no se explican solas, y no tiene supervisores como el Bot C: la
  explicación disponible es el panel de auditoría.
- Solo se comporta bien donde aprendió: un cambio grande de reglas o de tráfico exige
  reentrenarlo.

## Mapa de archivos

| Ruta | Contenido |
|---|---|
| `src/assets/scripts/client/bot/rl/featureEncoder.js` | Rasgos de cada avión y globales |
| `src/assets/scripts/client/bot/rl/rewardFunction.js` | Recompensa |
| `src/assets/scripts/client/bot/rl/BotBRuntime.js` | Ejecución en el navegador |
| `src/assets/scripts/headless/RlEnvironment.js` | Entorno de entrenamiento en el simulador |
| `bots/python/openscope_bots/env.py` | Entorno Gymnasium |
| `bots/python/openscope_bots/model.py` | La red |
| `bots/python/openscope_bots/imitation.py` | Imitación y DAgger |
| `bots/python/openscope_bots/ppo.py` | PPO y curriculum |
| `bots/python/openscope_bots/train.py` | Entrenamiento completo |
| `bots/python/openscope_bots/evaluate.py` | Comparación A contra B |
| `bots/python/openscope_bots/export_onnx.py` | Exportación al juego |
| `bots/configs/default.json` | Configuración de entrenamiento |
| `bots/runs/` | Resultados de entrenamiento (no se guardan en git) |
| `assets/bots/` | Modelo para el juego |

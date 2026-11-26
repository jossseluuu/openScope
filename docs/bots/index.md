# Bots: controladores automáticos

Tres controladores automáticos llevan un aeropuerto entero (llegadas, aproximación, aterrizaje, rodaje,
despegue y salida) dando solo las órdenes que daría un controlador humano. Los tres ven lo mismo (la
observación de `BotApi`), eligen entre las mismas [66 acciones](matriz-comandos.md) y pasan por el mismo
[escudo de seguridad](arquitectura.md#escudo-de-seguridad).

| | Bot A | Bot B | Bot C |
|---|---|---|---|
| Enfoque | Reglas expertas + metaheurísticas (secuenciación AMAN/DMAN, detección y resolución de conflictos) | Aprendizaje por refuerzo (red con atención, imitación del Bot A + PPO) | Agentes especialistas (Coordinador, Entradas, ILS, Torre, Salidas, Separación) con supervisores |
| Cómo se activa | `bot a` | `bot b` | `bot c` |
| Entrenamiento | Ninguno (parámetros ajustables con CMA-ES) | Sí, horas de GPU | Ninguno (comparte el planificador del Bot A) |
| Explica sus decisiones | Motivo de cada orden | No (panel de auditoría) | Sí: un supervisor por agente y uno global |
| Resultado (protocolo de 30 episodios, 2026-11-26, con redes de seguridad y VEL-002) | **-10680** puntos · 505 aterrizajes · 59 pérdidas de separación | Sin evaluar con el protocolo (la imitación aún no pasa la puerta frente al Bot A) | **-9885** puntos · 497 aterrizajes · 61 pérdidas |
| Documentación | [Bot A](bot-a.md) | [Bot B](bot-b.md) | [Bot C](bot-c.md) |

## Para entenderlos

- [Arquitectura](arquitectura.md): de la observación a la orden, el escudo, el entrenamiento del Bot B.
- [Modelo de razonamiento](razonamiento.md): qué hace cada bot en cada ciclo.
- [Priorización de tareas](priorizacion.md): qué se resuelve primero y por qué.
- [Niveles de automatización](automatizacion.md): del control manual al automático total (y el copiloto).
- [Matriz de comandos](matriz-comandos.md): qué puede ordenar cada bot y cada agente, y cuándo.
- [Parámetros del Bot A](parametros.md), [evaluación](evaluacion.md), [limitaciones](limitaciones.md),
  [glosario](glosario.md).
- Uso y detalles técnicos: [información técnica](informacion.md); entrenamiento:
  [cómo entrenar el Bot B](entrenamiento.md).

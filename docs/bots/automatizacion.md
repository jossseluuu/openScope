# Niveles de automatización

Una escala común para los bots y el [copiloto](../guia-jugador/copiloto.md): quién decide y quién ejecuta en cada nivel.

| Nivel | Nombre | Quién decide | Quién ejecuta | Dónde existe |
|:-:|---|---|---|---|
| 0 | Manual | Jugador | Jugador | Partida normal |
| 1 | Avisos | Jugador; el sistema alerta | Jugador | Copiloto (nivel «avisos»), STCA/TCAS (#3) |
| 2 | Sugerencias explicadas | El sistema propone y explica por qué | El jugador teclea la orden | Copiloto («solo sugerencias») |
| 3 | Sugerencias aceptables | El sistema propone | El jugador acepta con una tecla | Copiloto |
| 4 | Delegación de tareas | El sistema, en las aeronaves cedidas | El sistema | Copiloto (`delegate IBE123`) |
| 5 | Delegación de sector o fase | El sistema, en Torre, Salidas, Aproximación o Final | El sistema | Copiloto (`delegate tower`), agentes del Bot C |
| 6 | Automático total | Bot A, B o C | El bot | `bot a`, `bot b`, `bot c` |

## Reglas comunes a todos los niveles

- El **escudo de seguridad** actúa en cualquier nivel con sistema (del 3 al 6): ninguna orden automática puede
  saltarse la máscara de acciones.
- Toda orden automática queda registrada con su **motivo** en la auditoría.
- Las órdenes automáticas usan la misma [cadena de comandos](../motor/comandos.md) que el jugador.
- Un RA del TCAS (#3) manda sobre cualquier orden: ningún nivel puede sugerir ni dar una orden contraria.

## Relación con el Bot C

El nivel 5 es exactamente lo que hacen los agentes del Bot C con cada sector: si el jugador delega la Torre, el
agente Torre lleva esas aeronaves con las mismas competencias que en el [Bot C](bot-c.md). Delegar todos los
sectores equivale a `bot c`.

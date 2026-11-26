# Priorización de tareas

## El principio: orden lexicográfico

Las reglas se agrupan en niveles ([ADR 0002](../adr/0002-rulebook-lexicografico.md),
[SCO-001](../especificacion/puntuacion.md)). Un nivel superior manda siempre: ninguna cantidad de eficiencia
compensa una pérdida de separación.

| Nivel | Nombre | Ejemplos de reglas | Penalización típica |
|:-:|---|---|---|
| 0 | Seguridad | Incursión en pista, colisión con el terreno, por debajo de la altitud mínima | -500 / -1000 / -150 |
| 1 | Separación | Pérdida de separación radar, separación en final, estela, salida con llegada cerca, emergencia fuera de plazo | -200 / -100 / -300 |
| 2 | Procedimiento | Pista fuera de límites de viento, cancelación de despegue injustificada | -5 a -75 / -50 |
| 3 | Eficiencia | Frustradas, esperas, millas voladas | -50 |
| 4 | Entorno y carga | Combustible, CO₂, número de órdenes | (métricas, sin puntos) |

## Cómo se traduce en los bots

1. **Orden de las tareas en el ciclo** ([razonamiento](razonamiento.md)): seguridad, conflictos, zonas
   restringidas, salidas, ascensos, llegadas. Como cada aeronave recibe como máximo una orden por ciclo, una
   tarea de mayor prioridad ocupa a la aeronave antes que una de menor.
2. **Elección de la maniobra** en un conflicto: entre las que separan, la de menor coste (primero parar un
   ascenso o descenso, luego otro nivel, luego un viraje); antes de mover a una aeronave en emergencia se prueban
   todas las maniobras de la otra.
3. **Secuencia de aterrizaje:** por orden de llegada (*first come, first served*), con un desplazamiento máximo
   de 2 puestos para mejorar el total y las emergencias delante de todo lo que aún no está en el localizador.
4. **Salidas:** la pista se reserva para una emergencia que va a aterrizar; entre salidas, separación por estela
   y divergencia de 45° para el intervalo de un minuto.

## Qué gana cuando chocan dos objetivos

| Conflicto | Gana | Por qué |
|---|---|---|
| Aterrizar antes frente a mantener la separación | Separación | Nivel 1 frente a nivel 3 |
| Emergencia frente a separación con un tercero | Separación, pero se mueve antes a la otra aeronave | Las dos son nivel 1; la emergencia tiene preferencia en la secuencia |
| Salir a tiempo frente a una llegada a 2 NM | Esperar | Separación salida/llegada ([SEP-007](../especificacion/separacion.md)) |
| Ruido (pista preferente) frente a viento en cola | Cambiar de configuración | Límite de viento ([DEP-001](../especificacion/operaciones.md)) |
| Ahorrar millas frente a respetar un suelo de espacio aéreo | Suelo | Salir del espacio aéreo es AIRSPACE_BUST (-200) |

# 0004. Simulador determinista por semilla

- **Estado:** aceptada (2026-10-27)

## Contexto

Para comparar dos versiones de un bot hace falta que la única diferencia entre dos ejecuciones sea el bot.

## Decisión

El simulador headless instala un `Math.random` con semilla antes de cargar el motor. Cada sistema aleatorio
nuevo usa su propio generador derivado de la semilla (emergencias: semilla + 7700), de modo que activarlo o
desactivarlo no cambia el tráfico generado.

## Consecuencias

- Mismo código y misma semilla dan exactamente el mismo resultado (comprobado: puntuación, aterrizajes y
  combustible idénticos). La regresión de bots (`tools/sim/regression.js`) puede usar una tolerancia pequeña.
- La meteorología dinámica (#6) tendrá su propio generador.

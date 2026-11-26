# Evaluación de los bots

## Protocolo

Un cambio en un bot o en el motor se acepta solo si no empeora la **puntuación total** de este protocolo:

- semillas 4 a 9;
- escenarios: LEMD norte, LEMD sur (viento 180/15), EDDM, LEMG y KLAX;
- 60 minutos de juego por episodio, emergencias desactivadas;
- 30 episodios en total.

Se juzga por la puntuación y no por los aterrizajes: una pérdida de separación (-200) borra unos 20 movimientos
(+10 cada uno). Un solo episodio no sirve: varía ±1500 puntos de una semilla a otra.

```sh
node tools/sim/regression.js --bot A            # compara con bots/baselines/botA.json
node tools/sim/regression.js --bot A --quick    # 10 episodios (semillas 4-5), unos 3 minutos
```

El simulador es determinista: con el mismo código y la misma semilla el resultado es idéntico, así que la
regresión detecta cualquier cambio de comportamiento. El nightly de GitHub Actions la ejecuta cada noche para
los bots A y C y abre una issue si empeoran. Detalles en [testing](../desarrollo/testing.md#regresión-de-los-bots).

## Líneas base (2026-11-26)

Con las redes de seguridad (STCA, TCAS, MSAW, APW) y la nivelación realista VEL-002 activas:

| Bot | Puntuación | Aterrizajes | Despegues | Pérdidas de separación | Pérdidas de estela | Violaciones de espacio aéreo | Tier 0 | RA de TCAS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A | -10680 | 505 | 546 | 59 | 8 | 2 | 2 | 18 |
| C | -9885 | 497 | 546 | 61 | 7 | 1 | 4 | 16 |

La línea base anterior (2026-11-20, commit 773063d0) era A -3945 y C -5980. La bajada no es un fallo:
con `LEVEL_OFF_BAND_FT: 0` y `--safety-nets off` el Bot A vuelve a dar -3945 exacto en todas las métricas.
Unos -6300 puntos vienen de VEL-002 (las aeronaves nivelan a 1500 ft/min en los últimos 1000 ft, como en la
realidad, y el Bot A pierde separación en esa franja) y unos -400 de las redes de seguridad. Mejorar el Bot A
para VEL-002 está pendiente (`phacer.md`, sección 8b).

## Bot B

El Bot B se evalúa además con una **puerta** antes de PPO (`check_against_bot_a`): en 6 episodios de 30 minutos
(LEMD, LEMG, EDDM; tráfico 0,5) debe aterrizar al menos el 80 % que el Bot A, sin más tier 0 y con como mucho
un tier 1 extra por episodio. Las comparaciones finales usan 18 episodios porque 6 dan demasiado ruido. Último
resultado (2026-11-18/19): la imitación aterriza 12 de 22 (55 %), así que todavía no pasa.

## Medir un cambio

1. Congela una copia del código por experimento si vas a comparar varias variantes a la vez (los procesos de
   `run-bot` leen las fuentes en vivo).
2. Ejecuta la regresión completa y compara con la línea base.
3. Si mejora y se acepta, actualiza la línea base (`--write-baseline`) en el mismo commit y pon la tabla en el PR.
4. Si empeora, anótalo en la lista de ideas rechazadas ([limitaciones](limitaciones.md)) con el número medido.

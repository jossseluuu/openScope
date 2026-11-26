# Limitaciones conocidas e ideas rechazadas

## Limitaciones

### Todos los bots

- Las frustradas siguen el rumbo actual, no el procedimiento publicado.
- No hay rodaje por calles: es un tiempo de espera por pista.
- En headless (bots, regresión) la meteorología es estática por defecto; con `--weather dynamic` el viento cambia,
  hay niebla y tormentas, pero el Bot B aún no ve esos datos (features v8).
- Las altitudes mínimas de vectores salen de un terreno aproximado y solo existen en aeropuertos con terreno.
- Las emergencias no cambian las prestaciones de la aeronave: son prioridad y plazo.

### Bot A

- Sigue perdiendo la separación (≈1,4 veces por hora en el protocolo), sobre todo en KLAX (plataformas de
  espacio aéreo, esperas en niveles altos) y en LEMD sur (terreno y suelos).
- No evita activamente las zonas restringidas en todos los casos (KIAD, KELP).
- No usa `lineup` ni `abort` (lo hace la Torre del Bot C).
- El ajuste CMA-ES guardado (`bots/params/botA_tuned.json`) es anterior a los cambios de ILS y separación.

### Bot B

- Sin evaluar con el protocolo: la imitación no pasa todavía la puerta frente al Bot A (55 % de sus aterrizajes).
- No explica sus decisiones; solo queda el panel de auditoría.
- Solo se comporta bien en condiciones parecidas a las de su entrenamiento.

### Bot C

- Los agentes comparten el planificador del Bot A: están separados por responsabilidad, no son programas
  independientes ni aprenden.
- Los supervisores predicen trayectorias rectas y pueden marcar como dudosa una orden correcta con un giro previsto.

### Aeropuertos

- EGNM puntúa muy mal con el Bot A (-2825 en 20 minutos), por un problema previo de su tráfico.
- 38 aeropuertos desactivados usan el formato antiguo de mapas y no cargan en headless (EGLL entre ellos).

## Ideas rechazadas por medición

Se probaron, se midieron con el protocolo y empeoraban la puntuación. No volver a probarlas sin un motivo nuevo.

| Idea | Resultado |
|---|---|
| Secuenciar pistas paralelas como un solo flujo escalonado | Más pérdidas y menos aterrizajes (16 episodios) |
| Acciones de altitud «what-if» pasando a modo HOLD | -15 335 frente a -9635 |
| Dar el nivel antes que el rumbo a aeronaves en VNAV | -12 755 |
| 1000 ft de escalonamiento entre finales paralelas | -16 530 |
| No repetir el nivel ya autorizado en las resoluciones | -46 500 frente a -38 960 |
| No forzar la reanudación vertical tras 240 s | -39 535 |
| Las dos anteriores juntas | -46 950 |
| Torre del Bot C alineando por su cuenta | Peor (medido 2026-10-31) |
| Bot B como corrector del Bot A | Descartado por el usuario: rompe la comparación justa entre A y B |

## Descripción

<!-- Qué cambia y por qué. -->

Resuelve #

## Tipo de cambio

- [ ] Corrección de error
- [ ] Funcionalidad nueva
- [ ] Aeropuerto nuevo o actualizado
- [ ] Bots
- [ ] Documentación
- [ ] CI / herramientas
- [ ] Refactorización sin cambio de comportamiento

## Lista de comprobación

- [ ] Tests nuevos o actualizados, y `npm test` pasa
- [ ] Sin errores nuevos de ESLint en las líneas cambiadas
- [ ] Si toca aeropuertos: validador sin errores y vuelo headless (`tools/sim/check-airports.js`)
- [ ] Documentación actualizada (y diagramas Mermaid si cambia la arquitectura)
- [ ] Entrada en `CHANGELOG.md`
- [ ] Si añade reglas o constantes: entrada en la hoja de especificaciones

## Bots

- [ ] Este cambio **no** afecta al comportamiento de las aeronaves ni de los bots
- [ ] Cambia la observación (`BotApi`, `featureEncoder.js`) o las acciones (`actionSpace.js`): versión de features subida y Bot B marcado para reentrenar

Si afecta al motor o a los bots, resultados del protocolo de 30 episodios (semillas 4-9 × LEMD N, LEMD S, EDDM, LEMG, KLAX):

| Métrica | Antes | Después |
|---|---|---|
| Puntuación total | | |
| Aterrizajes | | |
| Pérdidas de separación | | |
| Tier 0 | | |

## Capturas

<!-- Si cambia la interfaz. -->

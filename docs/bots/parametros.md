<!-- Página generada por tools/docs/generate-bot-docs.js desde el código. No la edites a mano. -->

# Parámetros del Bot A

Valores por defecto y rango que explora el ajuste automático (CMA-ES, `bots/python/openscope_bots/tune_bot_a.py`). Fuente: `bot/botA/botAParameters.js`. Distancias en NM, velocidades en kt, tiempos en s, altitudes en ft.

| Parámetro | Valor | Mínimo | Máximo | Descripción |
|---|---:|---:|---:|---|
| `decisionIntervalSeconds` | 5 | 5 | 5 | time between decisions |
| `freezeSeconds` | 240 | 60 | 600 | arrivals closer than this keep their place in the sequence |
| `maxPositionShift` | 2 | 0 | 3 | how many places an arrival may move from first-come first-served (entero) |
| `sequenceStabilitySeconds` | 20 | 0 | 120 | cost of changing the previous sequence, per changed position |
| `finalSpacingBufferNm` | 0.7 | 0.2 | 2 | margin over the wake or radar minimum on final |
| `landingOccupancyBufferSeconds` | 15 | 0 | 40 | margin over the runway occupancy time of the previous landing |
| `mixedModeGapSeconds` | 150 | 90 | 300 | gap between landings left for departures on mixed-mode runways |
| `cruiseSpeed` | 280 | 250 | 300 |  |
| `arrivalSpeed` | 250 | 220 | 250 | below FL100, more than 30 nm from the threshold |
| `intermediateSpeed` | 220 | 200 | 240 | 15 to 30 nm from the threshold |
| `baseSpeed` | 180 | 170 | 200 | 6 to 15 nm from the threshold |
| `finalSpeed` | 160 | 150 | 170 | established on final |
| `minimumSpeedReduction` | 0.75 | 0.6 | 0.95 | slowest planned speed as a fraction of the nominal one |
| `holdThresholdSeconds` | 180 | 60 | 600 | delay left after speed control that triggers a hold |
| `holdExitMarginSeconds` | 30 | 0 | 120 |  |
| `holdMinimumDistanceNm` | 25 | 15 | 60 | hold only at fixes at least this far from the threshold |
| `maximumBaseTurnDistanceNm` | 28 | 18 | 40 | longest downwind |
| `interceptDistanceNm` | 10 | 8 | 14 | nominal join on the localizer; further out when the stream is busy |
| `minimumJoinDistanceNm` | 8 | 6 | 10 | closest join on the localizer, for shortened approaches |
| `shortJoinBufferNm` | 1 | 0.5 | 2 | extra spacing margin required to join closer than the nominal join |
| `shortJoinPenaltySeconds` | 60 | 0 | 180 | time a shortened approach must recover to be used |
| `interceptLateralNm` | 2.5 | 1.5 | 4 |  |
| `interceptAngle` | 30 | 20 | 30 |  |
| `downwindLateralNm` | 5 | 3 | 8 |  |
| `ilsClearanceDistanceNm` | 22 | 10 | 35 | route distance at which aircraft on a STAR are cleared for the ILS |
| `descentGradientFtPerNm` | 300 | 250 | 350 |  |
| `maxDepartureQueue` | 4 | 1 | 8 | aircraft taxiing or holding per runway (entero) |
| `sameRouteDepartureSeconds` | 120 | 60 | 180 |  |
| `divergingDepartureSeconds` | 60 | 45 | 120 |  |
| `departureRunwayOccupancySeconds` | 60 | 40 | 90 |  |
| `arrivalDepartureMarginSeconds` | 20 | 0 | 60 |  |
| `conflictHorizonSeconds` | 120 | 60 | 240 |  |
| `conflictBufferNm` | 2 | 0.5 | 4 | margin over the radar minimum |
| `resolutionHoldSeconds` | 60 | 30 | 180 | how long a resolution is kept before resuming |
| `resolutionTurnDegrees` | 30 | 20 | 45 |  |

Los parámetros ajustados se guardan en `bots/params/botA_tuned.json` y se usan con `run-bot.js --params`. El ajuste guardado es anterior a los cambios de ILS y separación de noviembre de 2026: hay que repetirlo antes de usarlo.

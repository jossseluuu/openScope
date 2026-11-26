<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Espacio aéreo y terreno

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## Espacio aéreo (ASP)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="asp-001"></a>**ASP-001** | Una aeronave que sale de todos los polígonos de espacio aéreo (lateralmente o por debajo de su suelo) deja de ser controlable y se elimina | AIRSPACE_BUST | Decisión del motor | `aircraft/AircraftController.js; game/GameController.js (AIRSPACE_BUST)` | implementado |
| <a id="asp-002"></a>**ASP-002** | Entrar en una zona restringida por debajo de su techo | RESTRICTED_AREA_ENTRY | ICAO Anexo 11 2.17 | `realism/RealismController.js; game/GameController.js (RESTRICTED_AREA_ENTRY)` | implementado |

**Notas**

- **ASP-001:** Para una llegada cuenta -200. Por eso los bots respetan los suelos escalonados.

## Terreno y altitudes mínimas (TER)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="ter-001"></a>**TER-001** | Altitud mínima de vectorización (MVA) = terreno más alto en 3 NM alrededor + 1000 ft de franqueamiento | +1000 ft, radio 3 NM | ICAO Doc 8168 Vol II; FAA JO 7210.3 (MVA) | `realism/TerrainClearance.js (OBSTACLE_CLEARANCE_FT, MVA_BUFFER_NM)` | implementado |
| <a id="ter-002"></a>**TER-002** | Se considera violación de altitud mínima cuando la aeronave está más de 100 ft por debajo de la MVA (resolución del modo C) | 100 ft | Resolución del modo C | `realism/RealismController.js (MINIMUM_ALTITUDE_TOLERANCE_FT)` | implementado |

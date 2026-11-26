<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->

# Meteorología

✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).

## Meteorología (MET)

| ID | Regla | Valor | Fuente | Implementado en | Estado |
|---|---|---|---|---|---|
| <a id="met-001"></a>**MET-001** | Categorías de aproximación por visibilidad (DH y RVR mínimos). Una pista admite su categoría (ilsCategory) y las inferiores; sin dato, una pista con ILS es CAT I. Los aviones comerciales vuelan hasta CAT IIIA, los ligeros CAT I | ver tabla MET-001 | ICAO Anexo 6; Doc 9365 (DH de CAT IIIA/IIIB simplificadas a 50/20 ft) | `weather/weatherLogic.js (APPROACH_CATEGORIES); airport/runway/RunwayModel.js (ilsCategories)` | implementado ✔︎ |
| <a id="met-002"></a>**MET-002** | Perfil vertical de viento de la meteorología dinámica (velocidad = superficie × factor + suma; dirección girada a la derecha con la altura), interpolado entre niveles | ver tabla MET-002 | Aproximación del simulador (capa límite y corriente en chorro típicas de latitudes medias) | `weather/weatherLogic.js (WIND_PROFILE, windAtAltitude); airport/AirportModel.js (windProfile)` | implementado ✔︎ |
| <a id="met-003"></a>**MET-003** | El viento de superficie evoluciona cada minuto (paseo aleatorio acotado) y da rachas con viento fuerte | ±2°/min y ±0,6 kt/min, como mucho 40° y 10 kt del inicial; rachas 5-15 kt por encima a partir de 15 kt | Aproximación del simulador | `weather/weatherLogic.js (WIND_EVOLUTION, evolveWind)` | implementado ✔︎ |
| <a id="met-004"></a>**MET-004** | Procedimientos de baja visibilidad (LVP) con RVR < 550 m o techo < 200 ft; en LVP la separación mínima en final sube a 4 NM | RVR 550 m · techo 200 ft · final 4 NM | ICAO Doc 9365 (LVP); separación en final en LVP, decisión del simulador | `weather/weatherLogic.js (LVP); weather/WeatherController.js (finalApproachMinimumNm)` | implementado ✔︎ |
| <a id="met-005"></a>**MET-005** | Episodios de niebla (probabilidad por hora según la climatología del aeropuerto, 5 % por defecto); la visibilidad baja a 150-800 m en 15 min, dura 30-60 min y se levanta igual; techo de estratos asociado | 5 %/h; 150-800 m; 30-60 min | Aproximación del simulador; climatología en el JSON del aeropuerto (weather.climatology.fogPerHour) | `weather/weatherLogic.js (EPISODES, fogVisibility, ceilingForVisibility)` | implementado ✔︎ |
| <a id="met-006"></a>**MET-006** | Tormentas (CB) a 15-40 NM del aeropuerto, radio 3-6 NM, cima FL300-FL450, intensidad máxima 3-5; se mueven con el viento a 10 000 ft, crecen en 15 min y viven 45-90 min; como mucho 4 a la vez | 15 %/h por defecto | Aproximación del simulador; climatología (weather.climatology.thunderstormsPerHour) | `weather/weatherLogic.js (createCell, cellAt)` | implementado ✔︎ |
| <a id="met-007"></a>**MET-007** | No se entra en una celda de intensidad ≥ 3 por debajo de su cima. El piloto pide desvío si va a entrar en menos de 60 s; entrar puntúa WEATHER_PENETRATION. Para los bots, las celdas son zonas restringidas (con 1 NM de margen) | intensidad 3; 60 s | ICAO Doc 4444 8.6.9 (desvíos por meteorología); ICAO Doc 9137 | `weather/WeatherController.js (_checkThunderstorms, getCellAreas); bot/BotApi.js (restrictedAreas)` | implementado ✔︎ |
| <a id="met-008"></a>**MET-008** | METAR del aeropuerto con el comando metar (o atis) | METAR LEMD 200930Z 32012KT 9999 NSC 14/08 Q1018 | ICAO Anexo 3 (formato METAR) | `weather/weatherLogic.js (buildMetar); InputController.js (metar)` | implementado |
| <a id="met-009"></a>**MET-009** | Si el viento lleva las pistas en uso más allá de sus límites (+2 kt de margen), se cambia a la configuración preferente que cumpla, con sus spawn patterns (sin ráfaga de tráfico) | límites de DEP-001 + 2 kt | ICAO Doc 4444 7.2.3 | `weather/WeatherController.js (_checkRunwayConfiguration); trafficGenerator/SpawnScheduler.js (switchSpawnPatterns)` | implementado |
| <a id="met-010"></a>**MET-010** | Por debajo de mínimos en la altura de decisión, frustrada; tras 2 frustradas por meteorología, la llegada se desvía a su alternativo (DIVERSION) | 2 frustradas | ICAO Anexo 6 Parte I 4.4.1 (mínimos de utilización de aeródromo) | `weather/WeatherController.js (checkLandingMinima, afterApproach); realism/RealismController.js (_checkDiversions)` | implementado |
| <a id="met-011"></a>**MET-011** | La meteorología dinámica tiene su propio generador aleatorio (semilla + 8800). En headless es estática salvo --weather dynamic, para que el protocolo de evaluación de los bots siga siendo comparable; en el navegador es dinámica por defecto | semilla + 8800 | Decisión del simulador (ADR 0004) | `weather/WeatherController.js; headless/HeadlessSimulator.js` | implementado |

### MET-001: Categorías de aproximación por visibilidad (DH y RVR mínimos). Una pista admite su categoría (ilsCategory) y las inferiores; sin dato, una pista con ILS es CAT I. Los aviones comerciales vuelan hasta CAT IIIA, los ligeros CAT I

| Líder ↓ / seguidor → | decisionHeightFt | rvrM |
|---|---:|---:|
| **I** | 200 | 550 |
| **II** | 100 | 300 |
| **IIIA** | 50 | 175 |
| **IIIB** | 20 | 50 |

### MET-002: Perfil vertical de viento de la meteorología dinámica (velocidad = superficie × factor + suma; dirección girada a la derecha con la altura), interpolado entre niveles

| Clave | Valor |
|---|---|
| 0 ft | ×1,0 · +0 kt · 0° |
| 2000 ft | ×1,3 · +3 kt · 20° |
| 5000 ft | ×1,4 · +8 kt · 30° |
| 10 000 ft | ×1,2 · +18 kt · 35° |
| 18 000 ft | ×1,1 · +32 kt · 40° |
| 24 000 ft | ×1,0 · +45 kt · 45° |
| 30 000 ft | ×1,0 · +55 kt · 45° |
| 39 000 ft | ×1,0 · +50 kt · 45° |

**Notas**

- **MET-002:** Solo en meteorología dinámica; la estática conserva ATM-002.

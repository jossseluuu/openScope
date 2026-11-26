<!-- Página generada por tools/docs/generate-schema-docs.js desde el schema. No la edites a mano. -->

# Esquema de aeropuerto

Cada aeropuerto es un archivo `assets/airports/<icao>.json`. La guía explicada con ejemplos está en [Formato de aeropuerto](../aeropuertos/formato-aeropuerto.md); las reglas de coherencia, en el [validador](../aeropuertos/validador.md). Fuente: `assets/airports/schema/airport.schema.json` (JSON Schema draft 2019-09).

## Raíz

Estructura de assets/airports/<icao>.json tal como la lee el motor (AirportModel y modelos relacionados). La coherencia entre partes (fijos usados que existen, pistas recíprocas, rutas, etc.) la comprueban las reglas de tools/validate/rules.js.

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `airac` | no | entero | ≥ 1000, ≤ 9913 | Ciclo AIRAC del que se tomaron los datos (AAMM, p. ej. 2511) |
| `radio` | sí | objeto |  |  |
| `radio.twr` | sí | texto | mín. 1 caracteres |  |
| `radio.app` | sí | texto | mín. 1 caracteres |  |
| `radio.dep` | sí | texto | mín. 1 caracteres |  |
| `icao` | sí | texto | patrón `^[A-Z]{4}$` | Identificador ICAO en mayúsculas |
| `iata` | sí | texto | patrón `^([A-Z0-9]{3})?$` |  |
| `magnetic_north` | sí | número | ≥ -180, ≤ 180 | Declinación magnética en grados (positivo = este) |
| `ctr_radius` | sí | número | > 0 | Radio del área simulada, en km |
| `ctr_ceiling` | sí | número | > 0 | Techo del área simulada, en ft |
| `initial_alt` | sí | número | > 0 | Altitud inicial de las salidas, en ft |
| `position` | sí | [latLonElevation](#latlonelevation) |  |  |
| `rangeRings` | no | objeto |  |  |
| `rangeRings.enabled` | sí | booleano |  |  |
| `rangeRings.center` | sí | [latLon](#latlon) |  |  |
| `rangeRings.radius_nm` | sí | número | > 0 |  |
| `has_terrain` | sí | booleano |  |  |
| `wind` | sí | objeto |  |  |
| `wind.angle` | sí | número | ≥ 0, ≤ 360 |  |
| `wind.speed` | sí | número | ≥ 0, ≤ 100 |  |
| `regulatoryProfile` | no | `"EASA"`, `"FAA"`, `"ICAO"` |  |  |
| `arrivalRunway` | sí | [runwayName](#runwayname) |  |  |
| `departureRunway` | sí | [runwayName](#runwayname) |  |  |
| `runwayConfigurations` | no | lista de objeto | mín. 1 elementos |  |
| `taxiTimes` | no | objeto |  | Tiempo de rodaje sin esperas hasta cada pista de salida, en segundos |
| `arrivalSpawn` | no | objeto |  |  |
| `arrivalSpawn.preSpawn` | no | booleano |  |  |
| `arrivalSpawn.minimumIntervalSeconds` | no | número | ≥ 0 |  |
| `defaultMaps` | sí | lista de texto | mín. 1 elementos |  |
| `airspace` | sí | lista de [airspace](#airspace) | mín. 1 elementos |  |
| `fixes` | sí | objeto |  |  |
| `restricted` | no | lista de [restricted](#restricted) |  |  |
| `runways` | sí | lista de [runwayPair](#runwaypair) | mín. 1 elementos |  |
| `airways` | no | objeto |  |  |
| `sids` | sí | objeto |  |  |
| `stars` | no | objeto |  |  |
| `spawnPatterns` | sí | lista de [spawnPattern](#spawnpattern) | mín. 1 elementos |  |
| `maps` | sí | lista de [map](#map) | mín. 1 elementos |  |
| `weather` | no | objeto |  | Climatología para la meteorología dinámica (MET-005, MET-006) |
| `weather.climatology` | no | objeto |  |  |
| `weather.climatology.fogPerHour` | no | número | ≥ 0, ≤ 1 |  |
| `weather.climatology.thunderstormsPerHour` | no | número | ≥ 0, ≤ 2 |  |
| `weather.climatology.temperature` | no | número | ≥ -40, ≤ 50 |  |

## Definiciones

### coordinate

Latitud o longitud: número decimal, o texto N/S/E/W en grados decimales, grados y minutos (N40d56.811) o grados, minutos y segundos (N40d56m48.65)

Tipo: número o texto.

### elevation

Elevación: número o texto con unidad opcional (sin unidad = pies), p. ej. "866ft", "12.5m" o "19000"

Tipo: número o texto.

### latLon

Tipo: lista de [coordinate](#coordinate) (mín. 2 elementos, máx. 2 elementos).

### latLonElevation

Tipo: [[coordinate](#coordinate), [coordinate](#coordinate), [elevation](#elevation)] (mín. 2 elementos, máx. 3 elementos).

### polygon

Tipo: lista de [latLon](#latlon) (mín. 3 elementos).

### runwayName

Nombre de pista: 01-36 con L, C o R opcional

Tipo: texto (patrón `^(0?[1-9]|[12][0-9]|3[0-6])[LCR]?$`).

### fix

[latitud, longitud] o [latitud, longitud, pronunciación]

Tipo: [[coordinate](#coordinate), [coordinate](#coordinate), texto] (mín. 2 elementos, máx. 3 elementos).

### airspace

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `name` | no | texto |  |  |
| `_name` | no | texto |  | Nombre informativo (no lo lee el motor) |
| `floor` | sí | número | ≥ 0 | Suelo en niveles de vuelo (centenas de ft) |
| `ceiling` | sí | número | > 0 | Techo en niveles de vuelo (centenas de ft) |
| `airspace_class` | sí | `"A"`, `"B"`, `"C"`, `"D"`, `"E"`, `"F"`, `"G"` |  |  |
| `poly` | sí | [polygon](#polygon) |  |  |
| `labelPositions` | no | lista de [latLon](#latlon) |  |  |

### restricted

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `name` | no | texto |  |  |
| `height` | sí | [elevation](#elevation) o `"Infinity"` |  | Techo de la zona: elevación con unidad, o "Infinity" (sin techo) |
| `poly` | sí | [polygon](#polygon) |  |  |
| `labelPositions` | no | lista de [latLon](#latlon) |  |  |

### runwayPair

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `name` | sí | lista de [runwayName](#runwayname) | mín. 2 elementos, máx. 2 elementos |  |
| `end` | sí | lista de [latLonElevation](#latlonelevation) | mín. 2 elementos, máx. 2 elementos |  |
| `ils` | no | lista de booleano | mín. 2 elementos, máx. 2 elementos |  |
| `ils_distance` | no | lista de número | mín. 2 elementos, máx. 2 elementos |  |
| `loc_maxDist` | no | lista de número | mín. 2 elementos, máx. 2 elementos |  |
| `glideslope` | no | lista de número | mín. 2 elementos, máx. 2 elementos |  |
| `ils_gs_maxHeight` | no | lista de número | mín. 2 elementos, máx. 2 elementos |  |
| `sepFromAdjacent` | no | lista de número | mín. 2 elementos, máx. 2 elementos |  |
| `delay` | no | lista de número | mín. 2 elementos, máx. 2 elementos |  |
| `ilsCategory` | no | lista de null o `"I"`, `"II"`, `"IIIA"`, `"IIIB"` | mín. 2 elementos, máx. 2 elementos | Categoría ILS de cada extremo (MET-001); null si no tiene |

### leg

Elemento de un segmento de procedimiento: nombre de fijo (con ^ sobrevuelo, @ espera, # rumbo) o [fijo, restricciones]

Tipo: texto o lista de texto.

### segment

Tipo: lista de [leg](#leg).

### segmentMap

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `<clave>` | no | [segment](#segment) | | Cualquier otra clave |

### drawLines

Tipo: lista de lista de texto.

### sid

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `icao` | sí | texto | mín. 1 caracteres |  |
| `name` | sí | texto | mín. 1 caracteres |  |
| `suffix` | no | objeto |  |  |
| `altitude` | no | número | > 0 |  |
| `rwy` | sí | [segmentMap](#segmentmap) |  |  |
| `body` | no | [segment](#segment) |  |  |
| `exitPoints` | sí | [segmentMap](#segmentmap) |  |  |
| `draw` | sí | [drawLines](#drawlines) |  |  |

### star

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `icao` | sí | texto | mín. 1 caracteres |  |
| `name` | sí | texto | mín. 1 caracteres |  |
| `entryPoints` | sí | [segmentMap](#segmentmap) |  |  |
| `body` | sí | [segment](#segment) |  |  |
| `rwy` | sí | [segmentMap](#segmentmap) |  |  |
| `draw` | sí | [drawLines](#drawlines) |  |  |
| `holds` | no | objeto |  |  |

### spawnPattern

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `origin` | sí | texto |  |  |
| `destination` | sí | texto |  |  |
| `category` | sí | `"arrival"`, `"departure"`, `"overflight"` |  |  |
| `route` | sí | texto | mín. 1 caracteres |  |
| `altitude` | no | número o texto o lista de número |  | Altitud de aparición en ft: número, [mínimo, máximo], texto numérico, o vacío (salidas) |
| `speed` | no | número o texto |  |  |
| `method` | sí | `"random"`, `"cyclic"`, `"surge"`, `"wave"` |  |  |
| `rate` | sí | número | ≥ 0 |  |
| `offset` | no | número |  |  |
| `period` | no | número | > 0 |  |
| `variation` | no | número | ≥ 0 |  |
| `entrail` | no | lista de número | mín. 2 elementos, máx. 2 elementos |  |
| `commands` | no | objeto |  |  |
| `runwayConfiguration` | no | texto | mín. 1 caracteres |  |
| `airlines` | sí | lista de [texto, número] | mín. 1 elementos |  |

### map

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `name` | sí | texto | mín. 1 caracteres |  |
| `lines` | sí | lista de lista de [coordinate](#coordinate) |  |  |

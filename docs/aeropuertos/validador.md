# Validador de aeropuertos

Comprueba cada archivo `assets/airports/<icao>.json` antes de que llegue al simulador. Se ejecuta en
local y en cada pull request (trabajo **Validar assets** de `ci.yml`); un error bloquea el PR. El mismo
trabajo valida las aeronaves y las aerolíneas (ver más abajo).

```sh
npm run validate:airports                 # todos los aeropuertos activos
node tools/validate/validate-airports.js lemd lemg   # solo algunos
node tools/validate/validate-airports.js --all       # también los desactivados
node tools/validate/validate-airports.js --json      # informe para otras herramientas
node tools/validate/validate-airports.js --quiet     # solo errores
```

```mermaid
flowchart LR
    F[icao.json] --> S{Schema JSON<br/>estructura}
    S -->|falla| E1[Errores SCHEMA<br/>con la ruta JSON]
    S -->|pasa| R[Reglas AP-001…AP-018<br/>coherencia]
    R --> K{¿Está en<br/>known-issues.json?}
    K -->|sí| C[conocido<br/>no falla]
    K -->|no| G{Gravedad}
    G -->|error| E2[Falla: código de salida 1]
    G -->|aviso| W[Se informa]
```

## Dos niveles

1. **Schema** (`assets/airports/schema/airport.schema.json`, JSON Schema draft 2019-09): estructura y
   tipos tal como los lee el motor. Rechaza propiedades que el motor no lee (por ejemplo una errata como
   `lenght`), coordenadas mal escritas, líneas de mapa incompletas o aerolíneas sin peso. Si el schema
   falla, las reglas no se ejecutan.
2. **Reglas** (`tools/validate/rules.js`): coherencia entre partes del archivo y con el resto de assets.

## Reglas

| ID | Gravedad | Qué comprueba |
|---|---|---|
| AP-001 | error | El nombre del archivo coincide con el ICAO y el aeropuerto está en `airportLoadList.json` |
| AP-002 | error | Pares de pistas recíprocos (18 de diferencia, L↔R, C↔C) y umbrales en sitios distintos |
| AP-003 | error | Todo fijo usado en SID, STAR y aerovías existe en `fixes` |
| AP-004 | error | Las pistas citadas (por defecto, configuraciones, rodaje, procedimientos) existen |
| AP-005 | error | Cada nombre de una ruta de aparición es un fijo, un procedimiento, una aerovía o un aeropuerto (con pista opcional) |
| AP-006 | error | Las aerolíneas y flotas de los spawn patterns existen, con las mayúsculas exactas |
| AP-007 | error / aviso | Suelo de cada sector por debajo del techo (si son iguales: aviso, sector de grosor cero) |
| AP-008 | aviso | Los polígonos de espacio aéreo y zonas restringidas no se cruzan consigo mismos |
| AP-009 | error | Los mapas de `defaultMaps` existen |
| AP-010 | error | Existe `terrain/<icao>.geojson` cuando `has_terrain` es `true` |
| AP-011 | aviso | Los aeropuertos españoles (`LE**`) hacen entrar las llegadas escalonadas (`arrivalSpawn`) |
| AP-012 | aviso | El `icao` de cada SID y STAR coincide con su clave |
| AP-013 | aviso | El rumbo entre umbrales coincide con el nombre de la pista (±15°, corregido por la declinación) |
| AP-014 | aviso | Las configuraciones de pista citadas en los spawn patterns existen |
| AP-015 | aviso | Una llegada que aparece dentro del espacio aéreo lo hace entre el suelo y el techo de algún sector de ese punto |
| AP-016 | aviso | Las restricciones de altitud de las STAR no quedan por debajo del suelo de los sectores en ese punto |
| AP-018 | error | En las rutas de aparición, la entrada y la salida de cada SID y STAR existen en el procedimiento (lo que comprueba `ProcedureModel` al crear la aeronave) |
| AP-017 | aviso | Ningún tramo de STAR atraviesa una zona restringida por debajo de su techo (un aviso por zona, con las STAR afectadas) |

Las reglas AP-015 a AP-017 trabajan con geometría: punto en polígono y cruce de segmentos sobre una
proyección plana local, suficiente a la escala de un TMA. Para AP-016 y AP-017, `A70+` y `A70` cuentan
como 7000 ft y `A70-` también (el procedimiento espera unos 7000 ft); un tramo con las dos puntas por
encima del techo de la zona no cuenta.

Las coordenadas se interpretan con `parseCoordinate` del propio motor, así que el validador lee los datos
igual que el juego.

## Aeronaves y aerolíneas

```sh
npm run validate:fleet        # assets/aircraft y assets/airlines
npm run validate:assets       # aeropuertos (solo errores) + aeronaves y aerolíneas
```

Schemas en `tools/validate/schema/` (no en `assets/`, porque la build junta todos los JSON de esas
carpetas en `aircraft.json` y `airlines.json`). Reglas:

| ID | Gravedad | Qué comprueba |
|---|---|---|
| AC-001 | error | El nombre del archivo coincide con el `icao` del tipo |
| AC-002 | error | Velocidades en orden: `min` ≤ `landing` ≤ `cruise` ≤ `max` |
| AL-001 | error | El nombre del archivo coincide con el `icao` de la aerolínea |
| AL-002 | error | Cada tipo de cada flota existe en `assets/aircraft` |
| AL-003 | aviso | Ningún formato de indicativo empieza por 0 (el motor lo descarta) |

Al crearlo apareció `ttw.json` con `callsignFormats` como texto (`"###"`) en vez de lista: el motor
habría tomado cada carácter como un formato. Corregido.

## Comprobación al cargar (en el navegador)

`src/assets/scripts/client/airport/airportJsonCheck.js` hace una comprobación ligera, sin ajv, antes de
construir el aeropuerto: pistas, espacio aéreo, mapas (incluido el formato antiguo), `defaultMaps` y pesos
de las aerolíneas. Si falla, el juego se queda en el aeropuerto actual y escribe el motivo en el registro
en vez de romperse a mitad del cambio. Un test comprueba que todos los aeropuertos activos la pasan.

## Formato antiguo de mapas

`tools/validate/convert-old-maps.js` convierte `"maps": { "base": [...] }` en `"maps": [{ "name", "lines" }]`
+ `defaultMaps`. Sin `--write` solo informa; con `--write` reescribe los archivos y pasa el validador.

```sh
node tools/validate/convert-old-maps.js            # los 36 desactivados con el formato antiguo
node tools/validate/convert-old-maps.js egll --write
```

Probado con EGLL y KDFW: los mapas quedan bien, pero esos aeropuertos tienen **más** problemas del formato
antiguo (SID sin `exitPoints`, STAR sin `draw`, altitudes y velocidades de spawn con otro formato), y la
reescritura cambia decenas de miles de líneas. Por eso no se ha aplicado en bloque: se usa al rehacer o
recuperar un aeropuerto concreto.

## Referencia generada

`npm run docs:generate` escribe `docs/referencia/esquema-*.md` a partir de los tres schemas, y
`npm run docs:check` (en CI) falla si no están al día.

## Problemas conocidos

`tools/validate/known-issues.json` recoge defectos reales que no se pueden corregir sin datos fiables (por
ejemplo, un fijo sin coordenadas publicadas a mano). Aparecen como `conocido` y no hacen fallar la
validación. Cada entrada lleva el motivo; se borra en cuanto se corrige el dato.

## Añadir una regla

1. Añade un objeto a `RULES` en `tools/validate/rules.js` con `id` (el siguiente `AP-xxx` libre),
   `severity`, `description` en español y `check(airport, context)`, que devuelve `[{ path, message }]`.
   Un problema puede llevar su propia `severity` si la gravedad depende del caso.
2. Añade un test en `test/tools/validateAirports.spec.js` que rompa LEMD a propósito y espere la regla.
3. Ejecuta `npm run validate:airports`. Si la regla nueva da errores en aeropuertos existentes, corrige
   el dato o, si no hay datos fiables, regístralo en `known-issues.json` con su motivo.
4. Añade la fila a la tabla de esta página y ejecuta `npm run docs:generate` si cambiaste un schema.

## Estado (2026-11-26)

- 72 aeropuertos activos: 0 errores. Las reglas geométricas nuevas avisan de 45 casos, casi todos STAR
  que cruzan zonas restringidas (EIDW, OMDB, OMAA, LHBP...). En LFPG destaparon un error real: las llegadas
  por ENORI, KOVAK y ROMGO aparecían a 15 000 ft, por encima de las partes del TMA de ese punto (techo
  FL115) y fuera de la capa FL115-FL195. Ahora aparecen a 10 000-11 000 ft (también en `build_lfpg.py`).
- AP-018 nació de un fallo de EHAM que solo se veía al volar: 12 rutas de salida salían de su SID por el
  fijo del nombre (KUDAD) cuando el SID termina en otro (WOODY), y el motor lanzaba una excepción al crear
  la aeronave. Corregido en `eham.json` y en `tools/aip/airport_builder.py`.

## Estado (2026-11-20)

- 66 aeropuertos activos: 0 errores, 10 con avisos.
- Corregidos al crear el validador:
  - **RJAA:** coordenada del fijo `_NRE045021` (`E140d40d06.00` → `E140d40m06.00`).
  - **LTBA:** 16 coordenadas del mapa con grados y minutos invertidos.
  - **EGNM:** una polilínea del mapa escrita como 121 puntos sueltos, convertida en 120 segmentos.
  - **KIAD:** la aerolínea `n/fastGA` no tenía peso y nunca aparecía; ahora tiene peso 1.
  - **EDDF:** fijo `tau` en minúsculas en la STAR KERA4M (`TAU`).
- 38 de los 40 aeropuertos desactivados usan el formato antiguo de mapas (sin `defaultMaps`, `maps` como
  objeto) y no pasan el schema.

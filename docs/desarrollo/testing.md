# Testing

El proyecto se comprueba en capas, de la más rápida a la más lenta. Todas corren en local con un solo
comando y las mismas corren en GitHub Actions (ver [CI/CD](ci.md)).

| Capa | Comando | Qué comprueba | Duración aprox. | Dónde corre en CI |
|---|---|---|---|---|
| Unitarios | `npm run test:unit` | Funciones y modelos del motor, bots y auditoría (AVA) | 1 min | Cada PR y push |
| Unitarios + cobertura | `npm test` | Lo mismo, con informe de cobertura de nyc en `coverage/` | 1 min | Cada PR y push |
| Aeropuertos | `npm run validate:airports` | Schema y reglas de coherencia de cada aeropuerto activo (ver [validador](../aeropuertos/validador.md)) | 5 s | Cada PR y push |
| Headless | `npm run test:headless` | El Bot A vuela 20 min en LEMD, LEMG, EDDM, KLAX y EGCC sin que el simulador falle | 30 s | Cada PR y push |
| Python | `npm run test:py` | Herramientas de entrenamiento, cliente del simulador y exportación ONNX | 25 s | Cada PR y push |
| Regresión rápida de bots | `npm run test:bots` | Bot A en 10 episodios comparado con su línea base | 3 min | — (solo local) |
| Regresión completa de bots | `node tools/sim/regression.js --bot A` | Protocolo de 30 episodios comparado con la línea base | 10 min (7 núcleos) | Nightly, bots A y C |
| Todos los aeropuertos | `node tools/sim/check-airports.js --strict` | Cada aeropuerto activo vuela 20 min en headless | 5-10 min | Nightly |

## Requisitos

- Node.js 22 o superior (la versión de referencia está en `.nvmrc`: 24).
- `npm install` en la raíz.
- Para `test:py`: Python 3.11 con las dependencias de `bots/python/requirements.txt`. En Windows, con el
  venv del proyecto: `cd bots/python && .venv\Scripts\python -m unittest discover -s tests`.

## Estado de referencia (2026-11-20)

- 1491 tests unitarios en verde (1475 del motor y los bots + 16 del validador), 17 omitidos y 14 pendientes (`todo`), en Node 24.21.
- Cobertura: 67,8 % de sentencias, 54,9 % de ramas, 69,8 % de funciones, 67,5 % de líneas.
- 15 tests de Python en verde.
- Líneas base de los bots (protocolo completo, ver abajo):

  | Bot | Puntuación | Aterrizajes | Despegues | Pérdidas de separación | Pérdidas de estela | Tier 0 |
  |---|---:|---:|---:|---:|---:|---:|
  | A | -3945 | 494 | 539 | 43 | 5 | 5 |
  | C | -5980 | 501 | 538 | 57 | 7 | 2 |

## Tests unitarios (AVA)

- Los archivos se llaman `*.spec.js` y viven en `test/`, con la misma estructura de carpetas que
  `src/assets/scripts/client/`.
- AVA carga Babel y un entorno de navegador simulado (`test/testHelpers/`).
- Para un solo archivo: `npx ava test/bot/sequencing.spec.js`. Para filtrar por nombre:
  `npx ava --match "*emergency*"`.
- Las observaciones de ejemplo para los bots están en `test/bot/_observationFixture.js`.

Ejemplo mínimo:

```js
import ava from 'ava';
import { isExpeditedDescent } from '../../src/assets/scripts/client/bot/actionSpace';

ava('solo una aeronave en emergencia desciende de forma expedita', (t) => {
    t.true(isExpeditedDescent({ emergency: true, altitude: 9000 }, 5000));
    t.false(isExpeditedDescent({ emergency: false, altitude: 9000 }, 5000));
});
```

## Simulador headless

`tools/sim/check-airports.js` lanza el Bot A en cada aeropuerto, cada uno en su propio proceso. Con
`--strict` termina con código 1 si algún aeropuerto no llega a ejecutarse (error al cargar o excepción
durante la partida). No juzga lo bien que juega el bot; para eso está la regresión.

## Regresión de los bots

`tools/sim/regression.js` ejecuta el **protocolo de evaluación**: semillas 4-9 × LEMD norte, LEMD sur
(viento 180/15), EDDM, LEMG y KLAX, 60 minutos, sin emergencias (30 episodios). Suma los resultados y los
compara con `bots/baselines/bot<A|C>.json`.

- El simulador headless es **determinista**: con el mismo código y la misma semilla, el resultado se
  repite exactamente. Por eso cualquier diferencia indica un cambio real de comportamiento.
- Falla si la puntuación total baja más de un 2 % del valor absoluto de la línea base (`--tolerance`), o si
  aumentan los eventos de tier 0 (seguridad).
- La puntuación manda: una pérdida de separación (-200) borra unos 20 movimientos.

### Actualizar una línea base

Solo cuando un cambio del bot o del motor se ha medido y aceptado:

```sh
node tools/sim/regression.js --bot A --write-baseline
node tools/sim/regression.js --bot C --write-baseline
node tools/sim/regression.js --bot A --quick --write-baseline
```

Haz commit de los JSON de `bots/baselines/` junto con el cambio que los justifica, y pon la tabla
antes/después en la descripción del PR.

## Añadir tests a una funcionalidad nueva

- Todo módulo nuevo debe llegar con tests (objetivo: al menos un 80 % de líneas cubiertas).
- Si añade una regla de dominio, el test cita su identificador de la hoja de especificaciones
  (por ejemplo `// SEP-002`).
- Si cambia el comportamiento de las aeronaves o de los bots, ejecuta la regresión y actualiza la línea
  base si el cambio se acepta.

<!-- Página generada por tools/docs/generate-schema-docs.js desde el schema. No la edites a mano. -->

# Esquema de tipo de aeronave

Cada tipo de aeronave es un archivo `assets/aircraft/<tipo>.json`. Guía: [Formato de aeronave](../motor/formato-aeronave.md). Se valida con `npm run validate:fleet`. Fuente: `tools/validate/schema/aircraft.schema.json` (JSON Schema draft 2019-09).

## Raíz

Escrito a partir de lo que leen AircraftTypeDefinitionModel y AircraftModel. Ver docs/motor/formato-aeronave.md.

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `name` | sí | texto | mín. 1 caracteres |  |
| `icao` | sí | texto | patrón `^[A-Z0-9]{2,4}$` |  |
| `engines` | sí | objeto |  |  |
| `engines.number` | sí | entero | ≥ 1, ≤ 8 |  |
| `engines.type` | sí | `"J"`, `"T"`, `"P"` |  | J reactor, T turbohélice, P pistón |
| `weightClass` | sí | `"S"`, `"L"`, `"M"`, `"H"`, `"J"`, `"U"` |  |  |
| `category` | sí | objeto |  |  |
| `category.srs` | sí | entero o null | ≥ 1, ≤ 3 |  |
| `category.lahso` | sí | entero o null | ≥ 1, ≤ 10 |  |
| `category.recat` | sí | `"A"`, `"B"`, `"C"`, `"D"`, `"E"`, `"F"`, `"H"` |  |  |
| `category.recatEu` | no | `"A"`, `"B"`, `"C"`, `"D"`, `"E"`, `"F"` |  |  |
| `category.wakeFaa` | no | `"SUPER"`, `"HEAVY"`, `"B757"`, `"LARGE"`, `"SMALL"` |  |  |
| `ceiling` | sí | número | ≥ 1000, ≤ 70000 |  |
| `rate` | sí | objeto |  |  |
| `rate.climb` | sí | número | > 0, ≤ 10000 | ft/min |
| `rate.descent` | sí | número | > 0, ≤ 10000 | ft/min |
| `rate.accelerate` | sí | número | > 0, ≤ 20 | kt/s |
| `rate.decelerate` | sí | número | > 0, ≤ 20 | kt/s |
| `runway` | sí | objeto |  |  |
| `runway.takeoff` | sí | número | > 0, ≤ 5 | km |
| `runway.landing` | sí | número | > 0, ≤ 5 | km |
| `speed` | sí | objeto |  |  |
| `speed.min` | sí | número | > 0 |  |
| `speed.landing` | sí | número | > 0 |  |
| `speed.cruise` | sí | número | > 0 |  |
| `speed.cruiseM` | no | número o null | > 0, ≤ 3 |  |
| `speed.max` | sí | número | > 0 |  |
| `speed.maxM` | no | número o null | > 0, ≤ 3 |  |
| `capability` | sí | objeto |  |  |
| `capability.ils` | sí | booleano |  |  |
| `capability.fix` | sí | booleano |  |  |

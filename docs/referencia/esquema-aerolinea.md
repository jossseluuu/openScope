<!-- Página generada por tools/docs/generate-schema-docs.js desde el schema. No la edites a mano. -->

# Esquema de aerolínea

Cada aerolínea es un archivo `assets/airlines/<icao>.json`. Guía: [Formato de aerolínea](../motor/formato-aerolinea.md). Se valida con `npm run validate:fleet`. Fuente: `tools/validate/schema/airline.schema.json` (JSON Schema draft 2019-09).

## Raíz

Escrito a partir de lo que lee AirlineModel. Ver docs/motor/formato-aerolinea.md.

| Propiedad | Obligatoria | Tipo | Límites | Descripción |
|---|---|---|---|---|
| `icao` | sí | texto | patrón `^[a-z0-9]{1,4}$` |  |
| `name` | sí | texto | mín. 1 caracteres |  |
| `callsign` | sí | objeto |  |  |
| `callsign.name` | sí | texto | mín. 1 caracteres | Indicativo radiotelefónico |
| `callsign.callsignFormats` | no | lista de texto | mín. 1 elementos | # dígito, @ letra |
| `callsign.length` | no | cualquiera |  | Heredado: el motor no lo lee |
| `callsign.callsignFormat` | no | cualquiera |  | Heredado: el motor no lo lee (se usa callsignFormats) |
| `fleets` | sí | objeto |  |  |
| `fleets.default` | sí | [fleet](#fleet) |  |  |
| `fleets.<clave>` | no | [fleet](#fleet) | | Cualquier otra clave |

## Definiciones

### fleet

Tipo: lista de [texto, número] (mín. 1 elementos).

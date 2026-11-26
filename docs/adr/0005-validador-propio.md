# 0005. Validador de aeropuertos propio

- **Estado:** aceptada (2026-11-20)

## Contexto

`@openscope/validator` (2.4.1) usa un esquema estricto del openScope original: rechaza LEMD y LEMG por campos
propios de este fork (`runwayConfiguration`, `arrivalSpawn`), su script estaba roto y se instalaba como
`latest`.

## Decisión

Validador propio en dos niveles: un JSON Schema (`assets/airports/schema/airport.schema.json`) que describe lo
que el motor lee, y reglas de coherencia con identificador (`tools/validate/rules.js`). Los defectos conocidos
sin datos para corregirlos se registran en `known-issues.json` con su motivo.

## Consecuencias

- CI bloquea un PR con un aeropuerto inválido.
- Al crearlo aparecieron y se corrigieron cinco errores de datos reales (RJAA, LTBA, EGNM, KIAD, EDDF).
- Los aeropuertos desactivados con formato antiguo no pasan el schema hasta que se conviertan o rehagan.

# 0002. Reglas con prioridad lexicográfica

- **Estado:** aceptada (2026-10-26)

## Contexto

Los bots necesitan un criterio para decidir entre objetivos que chocan (aterrizar antes frente a mantener la
separación, ruido frente a capacidad). Una suma ponderada permite compensar una pérdida de separación con
mucha eficiencia, lo que no es aceptable en control real.

## Decisión

Las reglas se agrupan en niveles (`RULE_TIER` en `realism/Rulebook.js`): 0 seguridad, 1 separación,
2 procedimiento, 3 eficiencia, 4 entorno y carga de trabajo. Un nivel superior manda siempre sobre los
inferiores. La puntuación del juego refleja ese orden (una pérdida de separación, -200, borra unos 20
movimientos). Cada aeropuerto aplica su perfil normativo: EASA/RECAT-EU, FAA JO 7110.65 o ICAO Doc 4444.

## Consecuencias

- Los bots se evalúan por la puntuación total, no por el número de aterrizajes.
- Las emergencias pesan como la separación (nivel 1): nunca compensa romper la separación por ellas, pero
  ninguna ganancia de eficiencia justifica dejarlas en el aire.
- Ver [priorización](../bots/priorizacion.md) y la hoja [SCO-001 a SCO-003](../especificacion/puntuacion.md).

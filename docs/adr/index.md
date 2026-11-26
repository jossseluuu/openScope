# Decisiones de arquitectura (ADR)

Cada decisión que condiciona el diseño se registra en un archivo corto con el formato
[MADR](https://adr.github.io/madr/): contexto, decisión, alternativas y consecuencias. Una decisión no se
borra: si cambia, se escribe otra que la sustituye y se marca la antigua como *sustituida*.

| ADR | Decisión | Estado |
|---|---|---|
| [0001](0001-docs-as-code.md) | Documentación como código en `docs/`, publicada con MkDocs y copiada a la Wiki | aceptada |
| [0002](0002-rulebook-lexicografico.md) | Reglas con prioridad lexicográfica (seguridad > separación > procedimiento > eficiencia > entorno) | aceptada |
| [0003](0003-bot-b-python-puente-node.md) | Bot B entrenado en Python con un puente al simulador Node | aceptada |
| [0004](0004-simulador-determinista.md) | Simulador determinista por semilla; sistemas aleatorios con generador propio | aceptada |
| [0005](0005-validador-propio.md) | Validador de aeropuertos propio (JSON Schema + reglas) en lugar de `@openscope/validator` | aceptada |

Plantilla para una nueva: copia cualquiera y numérala con el siguiente número libre.

# Diagramas

Los diagramas se escriben en [Mermaid](https://mermaid.js.org/), dentro de bloques de código ` ```mermaid `.
GitHub, MkDocs Material y la Wiki los dibujan directamente, y se revisan en los PR como cualquier texto. CI
comprueba que todos se pueden dibujar.

## Reglas

- Tipos permitidos: `flowchart` (estructura y flujos), `sequenceDiagram` (interacción en el tiempo),
  `stateDiagram-v2` (estados), `classDiagram`/`erDiagram` (modelos de datos) y `gantt` (planificación).
- En los nodos, los nombres reales de archivos, clases y métodos (`AircraftController`, `BotA.decide`), para
  poder buscarlos en el código.
- Unos 25 nodos como máximo; si crece más, se parte en dos diagramas.
- Sin colores fijos (`style`, `classDef` con colores): el tema claro y el oscuro los dibujan bien por sí solos.
- Texto en español; `<br/>` para partir líneas largas dentro de un nodo.
- Cada diagrama, en la página que explica lo que representa, con un párrafo antes que diga qué se ve.

## Diagramas existentes

| Diagrama | Tipo | Página |
|---|---|---|
| Arquitectura del motor | flowchart | [motor/arquitectura](../motor/arquitectura.md) |
| Bucle de simulación | sequenceDiagram | [motor/bucle](../motor/bucle.md) |
| Fases de vuelo | stateDiagram-v2 | [motor/aeronaves](../motor/aeronaves.md) |
| Cadena de un comando | flowchart | [motor/comandos](../motor/comandos.md) |
| Validación de un aeropuerto | flowchart | [aeropuertos/validador](../aeropuertos/validador.md) |
| Estados del TCAS | stateDiagram-v2 | [motor/stca-tcas](../motor/stca-tcas.md) |
| Encuentro con RA coordinado | sequenceDiagram | [motor/stca-tcas](../motor/stca-tcas.md) |
| Flujo de la meteorología dinámica | flowchart | [motor/meteorologia](../motor/meteorologia.md) |
| Voz: del micrófono al comando | sequenceDiagram | [guia-jugador/voz](../guia-jugador/voz.md) |
| Copiloto: sugerencias y delegación | sequenceDiagram | [guia-jugador/copiloto](../guia-jugador/copiloto.md) |
| Arquitectura de los bots | flowchart | [bots/arquitectura](../bots/arquitectura.md) |
| Razonamiento del Bot A por ciclo | flowchart | [bots/razonamiento](../bots/razonamiento.md) |
| Entrenamiento del Bot B | flowchart | [bots/arquitectura](../bots/arquitectura.md) |
| CI/CD | flowchart | [desarrollo/ci](ci.md) |
| Fuentes de la documentación | flowchart | [desarrollo/documentar](documentar.md) |

## Comprobar en local

```sh
npm run docs:mermaid
```

Extrae cada bloque Mermaid de `docs/` y lo dibuja con `@mermaid-js/mermaid-cli`; falla con la página y el
error si alguno tiene la sintaxis rota.

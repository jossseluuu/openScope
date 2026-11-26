# 0001. Documentación como código

- **Estado:** aceptada (2026-11-20)

## Contexto

La documentación estaba repartida en `documentation/` (mezcla de inglés heredado y español nuevo), sin índice
ni web. El usuario pidió una Wiki y un sistema de documentación centralizado.

## Decisión

`docs/` es la **única fuente**. MkDocs Material la publica en GitHub Pages (`/openScope/docs/`) y
`wiki-sync.yml` la copia a la Wiki de GitHub en cada push a `main`. La Wiki no se edita a mano. Las páginas que
dependen del código (hoja de especificaciones, matriz de comandos de los bots) se generan y CI comprueba que
están al día.

## Alternativas

- Solo Wiki: no se revisa en PR ni se versiona con el código.
- Solo Markdown en el repositorio: sin buscador ni navegación.
- Wiki y `docs/` editadas por separado: divergen enseguida.

## Consecuencias

- Toda la documentación pasa por PR y CI (`mkdocs build --strict`, Mermaid, generadores).
- Las guías de aeropuerto se movieron a `docs/aeropuertos/guias/`; la build las lee desde ahí (`tools/options.js`).
- Lo heredado en inglés se traduce solo cuando se modifica.

# Crear un aeropuerto a partir del AIP

Procedimiento para añadir un aeropuerto al nivel de LEMD, LEMG y LEPA. Los datos salen del AIP vigente. Lo que se pueda leer de una tabla del AIP se lee con un script, para poder regenerar el aeropuerto en cada ciclo AIRAC.

## Herramientas (`tools/aip/`)

| Archivo | Qué hace |
|---|---|
| `aiplib.py` | Coordenadas del AIP ↔ decimales, geodesia (distancia, rumbo, punto de destino, arcos), teselas de elevación *terrarium* de AWS (descarga con caché), contornos y costa de una isla. |
| `enaire_airspace.py` | Lee los sectores de un TMA del ENR 2.1 de ENAIRE: coordenadas, arcos alrededor de un ARP y tramos «siguiendo la línea de costa», más las bandas verticales. Los sectores vecinos que citan los mismos puntos reciben los mismos vértices, así que los bordes compartidos quedan soldados. |
| `sia_charts.py` | Lee el eAIP francés: texto de las páginas HTML, partes de TMA/CTR con arcos, listas de puntos DATA y tablas de codificación RNAV (SID, STAR, INA) convertidas con `pdftotext -table`. |
| `enaire_charts.py` | Lee las cartas de ENAIRE: tablas «WPT COORD», descripciones tabulares de los procedimientos RNAV (con sus restricciones en formato openScope) y los puntos significativos del ENR 4.4. |
| `airport_builder.py` | Piezas comunes: libro de fijos con puntos radial/DME, montaje de SID y STAR, spawn patterns, terreno, mapa y escritura. |
| `build_<icao>.py` | Uno por aeropuerto: construye `assets/airports/<icao>.json` y `assets/airports/terrain/<icao>.geojson`. `build_lebl.py` es la plantilla para aeropuertos con todo RNAV; `build_lepa.py`, para procedimientos convencionales. |

Requisitos: Python 3.10+ con `numpy`, `pillow` y `matplotlib` (de este último solo se usa `contourpy`), y `pdftotext` (Poppler; en Windows viene con Git for Windows en `mingw64/bin`).

## Pasos

### 1. Descargar el AIP

En ENAIRE, los documentos de un aeródromo están en `https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/<carpeta>/`. La carpeta no siempre es el indicativo: Palma es `LEPA_LESJ` (comparte AD 2 con Son Bonet). La lista completa está en la portada `https://aip.enaire.es/AIP/` (buscar `contenido_AIP/AD/AD2/`). Hay que descargar:

- `LE_AD_2_<carpeta>_en.pdf`: texto del AD 2 (pistas, CTR, radioayudas, uso preferente de pistas).
- `..._SID_<n>_en.pdf`, `..._STAR_<n>_en.pdf`, `..._IAC_<n>_en.pdf`: cartas.
- `contenido_AIP/ENR/LE_ENR_2_1_en.pdf` (TMA y CTR), `LE_ENR_4_1_en.pdf` (radioayudas) y `LE_ENR_4_4_en.pdf` (puntos significativos).

`curl` necesita una cabecera `User-Agent` de navegador. Cada PDF se convierte dos veces: `pdftotext -layout` para leerlo y `pdftotext -raw` para los scripts (sale en orden de lectura y no mezcla columnas).

### 2. Pistas y radioayudas

Del AD 2.12 (umbrales, elevación, umbrales desplazados), AD 2.19 (radioayudas con su declinación de estación y categoría ILS) y AD 2.20 (configuraciones preferentes: qué pista para llegadas y cuál para salidas). Se escriben a mano en el script, con la sección de origen en un comentario.

### 3. Espacio aéreo

`parse_sectors(texto_enr21, 'TPAM')` devuelve los sectores; `sector_polygon()` los convierte en polígonos. Para los tramos de costa se extrae la costa de la isla de las teselas de elevación (contorno de 0,5 m, simplificado a unos 150 m) y se sigue por el camino más corto entre los dos puntos. Se añade el CTR del AD 2.17. Comprobar a ojo dibujando los polígonos (matplotlib) y con el validador (AP-008 detecta polígonos que se cruzan).

### 4. Fijos y procedimientos

- Procedimientos RNAV: `tabular_procedures()` sobre cada carta.
- Procedimientos convencionales: se escriben a mano desde la descripción textual. Los puntos radial/DME se calculan con la posición y la declinación de estación de la radioayuda y se nombran `_<VOR><radial>D<distancia>` (por ejemplo `_JOA236D07`). Los arcos DME se dibujan con un punto cada 10°.
- Las STAR terminan en un IAF. La transición hasta el IF de cada pista sale de los tramos iniciales de las aproximaciones RNP (cartas IAC).
- Solo hace falta modelar las SID de las pistas de salida de cada configuración.

### 5. Terreno y mapa

Contornos cada 1000 ft desde las mismas teselas de elevación, guardados en metros como los demás aeropuertos. El mapa base lleva la costa y las prolongaciones de eje de las pistas con ILS.

### 6. Tráfico

Aerolíneas y flotas que existan en `assets/airlines/` (las flotas distinguen mayúsculas). Llegadas escalonadas con `arrivalSpawn` (`preSpawn: false`). Cada salida termina en un punto ficticio `_<SALIDA>_X`, 30 NM más allá del punto de salida, para que abandone el espacio aéreo. Las tasas por ruta son una estimación y se anotan como tal en la guía.

### 7. Comprobaciones

1. `npm run validate:airports -- <icao>`: sin errores.
2. Entrada en `assets/airports/airportLoadList.json`, guía en `docs/aeropuertos/guias/<icao>.md` y enlace en el índice de guías.
3. `node tools/sim/run-bot.js --bot A --airport <icao> --minutes 60 --seed 4` con las dos configuraciones (`--wind`): sin pérdidas al aparecer ni aeronaves que se salgan del espacio aéreo por su procedimiento.
4. Probar sin bot, como juega el usuario (`towerController: 'SYSTEM'`), y en el navegador: qué se ve al empezar, etiquetas, mapas y rendimiento.
5. Añadirlo a `bots/configs/airports.json` cuando vuele bien.

## Aeropuertos hechos así

| Aeropuerto | AIRAC | Script |
|---|---|---|
| LEPA Palma de Mallorca | 2610 | `tools/aip/build_lepa.py` |
| LEBB Bilbao | 2610 | `tools/aip/build_lebb.py` (cartas solo en español: las tablas son bilingües) |
| EHAM Ámsterdam-Schiphol | 2611 | `tools/aip/build_eham.py` (eAIP de LVNL: tablas de SID y descripciones abreviadas de STAR en el HTML del AD 2.22; el servidor exige User-Agent de navegador) |
| LFPG París-Charles de Gaulle | 2610 | `tools/aip/build_lfpg.py` (eAIP de Francia: HTML + tablas de codificación con `pdftotext -table`, lector `sia_charts.py`) |
| WSSS Singapur-Changi | 2611 | `tools/aip/build_wsss.py` (eAIP de CAAS: descripciones abreviadas en el reverso de cada carta SID/STAR, lector `caas_charts.py`) |
| LEBL Barcelona-El Prat | 2609 | `tools/aip/build_lebl.py` (todo RNAV: procedimientos 100 % desde las tablas) |

LEMD y LEMG se hicieron con el mismo método, pero sus scripts no se guardaron.

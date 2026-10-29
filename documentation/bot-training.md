# Cómo entrenar tu propio agente

Guía paso a paso para entrenar el Bot B (aprendizaje por refuerzo), ajustar el
Bot A y comparar los dos. La referencia general de los bots está en
[bot-information.md](bot-information.md).

## Índice

1. [Qué vas a hacer](#qué-vas-a-hacer)
2. [Preparación (una sola vez)](#preparación-una-sola-vez)
3. [Paso 1: prueba rápida](#paso-1-prueba-rápida-5-minutos)
4. [Paso 2: ajustar el Bot A (opcional)](#paso-2-ajustar-el-bot-a-opcional-1-3-horas)
5. [Paso 3: entrenar el Bot B](#paso-3-entrenar-el-bot-b-6-7-horas)
6. [Paso 4: comparar A contra B](#paso-4-comparar-a-contra-b)
7. [Paso 5: usar el Bot B en el juego](#paso-5-usar-el-bot-b-en-el-juego)
8. [Cómo seguir el entrenamiento](#cómo-seguir-el-entrenamiento)
9. [Si algo va mal](#si-algo-va-mal)
10. [Personalizar el entrenamiento](#personalizar-el-entrenamiento)
11. [Cómo funciona por dentro](#cómo-funciona-por-dentro)

## Qué vas a hacer

```
Bot A (reglas)  ──vuela──►  datos  ──imitación──►  red neuronal  ──PPO──►  Bot B entrenado  ──ONNX──►  juego
                                     (+ DAgger)                    (curriculum)
```

1. El **Bot A** controla miles de situaciones y la red aprende a imitarle
   (*behaviour cloning*). Después la red vuela y el Bot A corrige sus errores
   (*DAgger*).
2. Con **PPO** la red mejora por su cuenta, por recompensa, empezando con poco
   tráfico en LEMD y acabando con tráfico completo en LEMD y EDDM con viento
   variable.
3. El modelo se exporta a **ONNX** y se juega con él en el navegador escribiendo
   `bot b`.

El escudo de seguridad está activo durante todo el entrenamiento: la red nunca
puede elegir una acción que rompa una regla conocida de seguridad o separación.

## Preparación (una sola vez)

Todo se ejecuta desde la carpeta `bots/python` del proyecto, en una terminal
(PowerShell o Git Bash).

### 1. Dependencias de JavaScript

En la raíz del proyecto:

```sh
npm install --ignore-scripts
```

Si cambia `package-lock.json`, restáuralo con `git checkout -- package-lock.json`.

### 2. Entorno de Python

El entorno virtual `bots/python/.venv` ya está creado, con PyTorch 2.11 + CUDA
12.8 (necesario para la RTX 5050), NumPy, Gymnasium y ONNX Runtime. Para
recrearlo en otro equipo:

```sh
cd bots/python
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
.venv\Scripts\python -m pip install numpy gymnasium onnxruntime
```

Comprueba que se ve la GPU:

```sh
.venv\Scripts\python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Debe imprimir `True NVIDIA GeForce RTX 5050 Laptop GPU`.

> **Windows Smart App Control.** En este equipo está activado. La primera vez
> bloqueó una DLL de PyTorch y después la permitió. Si vuelve a ocurrir
> (`Una directiva de Control de aplicaciones bloqueó este archivo`), repite el
> comando de comprobación unos minutos después. Si sigue bloqueando, la
> alternativa recomendada es entrenar dentro de WSL2 (Ubuntu), que también
> usa la GPU. El paquete `onnx` está bloqueado, pero no hace falta.

## Paso 1: prueba rápida (5 minutos)

Comprueba que toda la cadena funciona antes de lanzar algo largo:

```sh
cd bots/python
.venv\Scripts\python -m openscope_bots.train --quick
```

Debe terminar con `done.` y dejar los ficheros en `bots/runs/quick-check/`.

## Paso 2: ajustar el Bot A (opcional, 1-3 horas)

Busca con CMA-ES los parámetros del Bot A que mejor funcionan en LEMD y EDDM.
Conviene hacerlo antes de entrenar el B, porque el B aprende imitando al A.

```sh
.venv\Scripts\python -m openscope_bots.tune_bot_a --airports lemd eddm --seeds 1 2 --minutes 45 --generations 30 --workers 8
```

- Resultado: `bots/params/botA_tuned.json`, con el registro en `botA_tuned.csv`.
- Cada generación evalúa unos 14 candidatos × 4 episodios. Con 8 procesos
  tarda de 2 a 4 minutos.
- Se puede parar en cualquier momento (Ctrl+C): el mejor resultado ya está guardado.

Para ver el Bot A con esos parámetros:

```sh
node tools/sim/run-bot.js --bot A --airport lemd --params bots/params/botA_tuned.json
```

## Paso 3: entrenar el Bot B (6-7 horas)

```sh
.venv\Scripts\python -m openscope_bots.train --config ../configs/default.json
```

Lo que ocurre, en orden:

| Fase | Qué hace | Tiempo aproximado |
|---|---|---|
| Recogida | el Bot A vuela 20.000 decisiones | 10-15 min |
| Imitación | 10 épocas de clonado | 1-2 min |
| DAgger | 3 rondas: la red vuela y el Bot A corrige | 15-20 min |
| PPO etapa 1 | 100 actualizaciones, poco tráfico en LEMD | ~45 min |
| PPO etapa 2 | 200 actualizaciones, LEMD y EDDM, tráfico medio, algo de viento | ~1,7 h |
| PPO etapa 3 | 400 actualizaciones, tráfico completo y viento variable | ~3,3 h |

Medido en este equipo: unas 36 decisiones por segundo con 8 simuladores y unos
30 s por actualización.

Todo se guarda en `bots/runs/botB/`:

| Fichero | Contenido |
|---|---|
| `config.json` | la configuración usada |
| `imitation_dataset.npz` | los datos del Bot A (se reutilizan si repites) |
| `bc.pt`, `dagger_N.pt`, `imitation.pt` | la red tras cada fase de imitación |
| `ppo_checkpoint.pt` | el último estado de PPO (se guarda cada 10 actualizaciones) |
| `best.pt` | **el mejor modelo según la evaluación** (cada 25 actualizaciones) |
| `ppo_log.csv` | una fila por actualización |

### Aprender también de partidas auditadas

Las partidas exportadas con el panel de auditoría (`audit` → **Exportar**) se pueden añadir a la
imitación. Guarda los `.jsonl` en `bots/audits/` y:

```sh
.venv\Scripts\python -m openscope_bots.audit_data ../audits
.venv\Scripts\python -m openscope_bots.train --config ../configs/default.json --audit ../audits
```

Cada aeronave de cada paso cuenta según lo que le pasó después: completa si todo fue bien, la
mitad con una infracción de procedimiento, 0,1 si perdió la separación y nada si hubo un problema
de seguridad o se perdió. Los ficheros grabados con otra versión de la codificación se ignoran.

### Parar y continuar

Puedes parar con Ctrl+C cuando quieras. Para continuar desde el último punto
guardado:

```sh
.venv\Scripts\python -m openscope_bots.train --config ../configs/default.json --stage ppo --resume
```

Así puedes entrenar una noche y continuar la siguiente.

## Paso 4: comparar A contra B

Los dos vuelan exactamente los mismos episodios (mismas semillas, aeropuertos y
viento):

```sh
.venv\Scripts\python -m openscope_bots.evaluate --model ../runs/botB/best.pt --bot-a-params ../params/botA_tuned.json --airports lemd eddm --seeds 101 102 103 --minutes 60
```

Imprime una tabla y la guarda en `bots/runs/evaluation/` (Markdown y JSON). Se
compara en orden de prioridad: seguridad, después separación, después
procedimiento y por último eficiencia (aterrizajes, despegues, frustradas,
órdenes).

Para ver un solo episodio del Bot B en detalle:

```sh
.venv\Scripts\python -m openscope_bots.run --bot B --model ../runs/botB/best.pt --airport eddm --seed 7
```

## Paso 5: usar el Bot B en el juego

1. Exporta el modelo:

   ```sh
   .venv\Scripts\python -m openscope_bots.export_onnx --model ../runs/botB/best.pt
   ```

   Escribe `assets/bots/botB.onnx` y `assets/bots/botB.json`, y comprueba que
   ONNX da los mismos resultados que PyTorch.
2. Recompila el juego desde la raíz del proyecto: `npx gulp build`.
3. Abre el juego, elige LEMD o EDDM y escribe en la barra de órdenes:

   ```
   bot b
   ```

   El juego descarga ONNX Runtime Web de cdn.jsdelivr.net la primera vez, así
   que necesita internet. `bot off` te devuelve el control.

## Cómo seguir el entrenamiento

`bots/runs/botB/ppo_log.csv` se puede abrir con Excel. Columnas importantes:

| Columna | Qué indica | Qué esperar |
|---|---|---|
| `episode_return` | recompensa total por episodio | sube con el tiempo |
| `landings` | aterrizajes por episodio | sube |
| `tier0` | infracciones de seguridad por episodio | baja hacia 0 |
| `tier1` | pérdidas de separación por episodio | baja |
| `entropy` | cuánto explora la red | baja poco a poco; si cae a casi 0 muy pronto, la red se ha "atascado" |
| `clip_fraction` | tamaño de los cambios en cada actualización | normalmente 0,05-0,3 |

En la consola verás también `evaluation at update N: cost X` cada 25
actualizaciones. Cuanto más bajo, mejor; `best.pt` guarda el mejor.

## Si algo va mal

| Síntoma | Causa probable | Solución |
|---|---|---|
| `torch.cuda.is_available()` es `False` | se instaló PyTorch sin CUDA | reinstala con el índice `cu128` (preparación, paso 2) |
| `Una directiva de Control de aplicaciones bloqueó...` | Smart App Control de Windows | ver la nota de la preparación |
| `simulator process exited` | falta `npm install` o Node no está en el PATH | `npm install --ignore-scripts` en la raíz |
| Va muy lento | pocos simuladores en paralelo | sube `envs` en la configuración (máximo ~12 con 16 hilos) |
| `CUDA out of memory` | red o lotes demasiado grandes | baja `model.width` a 96 o sube `ppo.minibatches` a 8 |
| `episode_return` no sube | recompensa o curriculum mal ajustados | prueba `ppo.entropy` 0.02, o más actualizaciones en la etapa 1 |
| El juego dice `trained with a different version` | cambió el código de los bots después de entrenar | vuelve a exportar; si cambió la codificación, reentrena |

## Personalizar el entrenamiento

Copia `bots/configs/default.json` con otro nombre, cámbialo y pásalo con
`--config`. Las secciones son:

- `name`: carpeta dentro de `bots/runs/`.
- `envs`: simuladores en paralelo.
- `env`: tipo de episodios (`airports`, `traffic_scale` como `[mínimo, máximo]`,
  `episode_minutes`, `decision_seconds`, `random_wind_probability`,
  `max_wind_kt`, `reward_weights`).
- `model`: tamaño de la red (`width`, `heads`, `layers`).
- `imitation`: cantidad de datos del Bot A, épocas y rondas de DAgger.
- `ppo`: hiperparámetros de PPO.
- `curriculum`: etapas en orden, cada una con su número de actualizaciones y los
  cambios sobre `env`.
- `evaluation`: episodios con los que se elige `best.pt`.

### Pesos de la recompensa

En `env.reward_weights` puedes cambiar cualquiera de estos valores:

| Peso | Por defecto | Cuándo se aplica |
|---|---|---|
| `tier0` | -10 | cada infracción de seguridad |
| `tier1` | -3 | cada pérdida de separación |
| `tier2` | -0.5 | cada infracción de procedimiento |
| `goAround` | -1 | cada frustrada |
| `arrival` / `departure` | +1 | cada aterrizaje / salida entregada |
| `aircraftCollision` | -10 | colisión entre aviones |
| `airspaceBust` | -5 | llegada que abandona el espacio aéreo |
| `notClearedOnRoute` | -1 | salida que sale sin ruta |
| `localizerAboveGlideslope` | -0.3 | interceptación por encima de la senda |
| `timePenalty` | -0.0005 | por segundo y avión bajo control (anima a resolver rápido) |
| `commandPenalty` | -0.002 | por orden (anima a no sobrecargar la frecuencia) |

### Entrenar para otro aeropuerto

Cualquier aeropuerto de `assets/airports/airportLoadList.json` sirve. Pon su
código OACI en minúsculas en `env.airports` y en `evaluation.airports`. Una red
entrenada en varios aeropuertos generaliza mejor que una entrenada en uno.

## Cómo funciona por dentro

- **Observación.** Hasta 48 aviones, ordenados con los controlables primero y
  después por distancia, cada uno con 50 rasgos: tipo de vuelo, fase,
  posición, altitud, rumbo, velocidad, autorizaciones, categoría de estela,
  altitud mínima, posición respecto a su pista, siguiente fijo, ocupación de
  pista, distancia al límite del espacio aéreo… Se añaden 5 rasgos globales:
  viento, tráfico y hora. Código: `src/assets/scripts/client/bot/rl/featureEncoder.js`.
- **Acciones.** Una por avión y decisión (cada 10 s), entre 64: nada, 14 cambios
  de rumbo, 23 altitudes, 17 velocidades, directo al siguiente fijo, seguir el
  procedimiento, ILS, pista paralela, espera, salir de espera, frustrada,
  rodaje y despegue. Código: `src/assets/scripts/client/bot/actionSpace.js`.
- **Escudo de seguridad.** Elimina las acciones inseguras (despegar con la pista
  ocupada o sin separación de estela, bajar de la altitud mínima…) e impone
  frustradas o rupturas de aproximación cuando dos aviones se juntan en final.
  Código: `src/assets/scripts/client/bot/safetyShield.js`.
- **Red.** Un *transformer* de 3 capas en el que cada avión "atiende" a los demás,
  con una cabeza que puntúa las acciones de cada avión y otra que estima el
  valor. Tiene unos 480.000 parámetros. Código: `bots/python/openscope_bots/model.py`.
- **PPO.** Política conjunta factorizada por avión: la probabilidad de una
  decisión es el producto de las de cada avión. Usa GAE (γ 0,99, λ 0,95) y
  *clipping* 0,2. Código: `bots/python/openscope_bots/ppo.py`.

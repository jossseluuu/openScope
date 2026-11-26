# 0003. Bot B en Python con puente al simulador Node

- **Estado:** aceptada (2026-10-26)

## Contexto

El aprendizaje por refuerzo tiene sus mejores herramientas en Python (PyTorch, Gymnasium), pero el simulador es
JavaScript. Reescribir el motor en Python duplicaría el código y lo haría divergir.

## Decisión

El entrenamiento corre en Python (`bots/python/`) y controla procesos `HeadlessSimulator` de Node a través de
un puente (`openscope_sim`). El modelo entrenado se exporta a ONNX y el navegador lo ejecuta con
`onnxruntime-web` (`bot/rl/BotBRuntime.js`). La codificación de la observación (`featureEncoder.js`) es la
misma en los dos lados.

## Consecuencias

- Cualquier cambio en la observación o en las acciones obliga a subir la versión de features y a reentrenar.
- Varios simuladores en paralelo consumen mucha memoria (15 GB con 8 + 7 procesos llegaron a fallar).
- El Bot A sirve de maestro para la imitación y de referencia para la comparación.

# Partidas auditadas

Guarda aquí los ficheros `.jsonl` que descarga el botón **Exportar** de la página de auditoría
(`http://localhost:3003/bot-audit`, o la orden `audit` en el juego). El entrenamiento del Bot B los usa con:

```sh
cd bots/python
.venv\Scripts\python -m openscope_bots.audit_data ../audits      # resumen de lo que contienen
.venv\Scripts\python -m openscope_bots.train --config ../configs/default.json --audit ../audits
```

Cada fichero tiene, para cada paso de la partida y cada aeronave, lo que ve el Bot B, la acción
del Bot A (real o "en la sombra") y lo que le pasó a esa aeronave en los 3 minutos siguientes.
Las decisiones que acabaron en pérdida de separación, problema de seguridad o aeronave perdida
apenas cuentan (o no cuentan) en el entrenamiento.

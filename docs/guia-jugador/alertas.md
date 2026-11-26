# Alertas de colisión

El radar avisa de los conflictos antes de que ocurran, y las aeronaves llevan su propio sistema anticolisión.
Se activan o desactivan en las opciones: *Safety nets (STCA, TCAS, MSAW, APW)*.

## Qué verás

| Etiqueta sobre el bloque | Color | Significa | Qué hacer |
|---|---|---|---|
| `STCA` | ámbar | Dos aeronaves perderán la separación en menos de 2 minutos | Planifica ya: cambio de nivel, rumbo o velocidad |
| `STCA` | rojo | La perderán en menos de 1 minuto (o ya la han perdido) | Actúa ahora |
| `TA` | ámbar | El TCAS de la aeronave ve tráfico cerca (aviso de tráfico) | Da información de tráfico o separa |
| `RA` | rojo | El TCAS manda subir, bajar o nivelar | **No des órdenes de altitud** hasta que comunique «clear of conflict» |
| `MSAW` | rojo | Quedará por debajo de la altitud mínima en 30 s | Haz subir a la aeronave |
| `APW` | rojo | Entrará en una zona restringida en 60 s | Vira o cambia de nivel |

## El RA manda sobre el controlador

Con un RA, la tripulación sigue al TCAS (ICAO Doc 4444 15.7.3):

1. Comunica «TCAS RA, climb» (o *descend*, *level off*).
2. Sube o baja a 1500 ft/min durante el tiempo necesario.
3. Rechaza cualquier orden de altitud con «unable, TCAS RA».
4. Al terminar comunica «clear of conflict, returning to …» y vuelve a la última altitud autorizada.

## Puntuación

- Un RA cuesta **-150** puntos (una vez por encuentro): indica que la separación ya había fallado.
- Dar una orden de altitud **contraria** a un RA cuesta **-300**.
- El STCA, el MSAW y el APW no puntúan: avisan. Lo que puntúa es la pérdida de separación, bajar de la altitud
  mínima o entrar en la zona restringida.

Detalles técnicos: [redes de seguridad](../motor/stca-tcas.md).

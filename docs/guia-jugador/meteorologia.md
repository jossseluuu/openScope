# Meteorología

En las opciones, *Weather*: **Dynamic** (por defecto) o **Static** (viento fijo, como el openScope original).

## Qué cambia con la meteorología dinámica

- **El viento cambia** poco a poco, más fuerte y girado en altura. Con viento fuerte hay **rachas**.
- **Cambios de pista:** si el viento deja las pistas fuera de límites, el aeropuerto cambia de configuración; lo verás
  en el registro. Las llegadas ya en el aire siguen con su ruta: reasígnales la pista nueva.
- **Niebla:** la visibilidad puede bajar a unos cientos de metros. Con **LVP** (RVR por debajo de 550 m) deja al menos
  **4 NM** entre llegadas en final. Si la visibilidad está por debajo de los mínimos de la pista, la aeronave hará la
  frustrada en la altura de decisión; tras dos, se irá a su alternativo (-50).
- **Tormentas:** aparecen como ecos ámbar o rojos con su cima (`CB FL380`). No metas aeronaves en las rojas por debajo
  de su cima: el piloto pedirá desvío (`CB` en rojo sobre el bloque) y, si entra, -100.

## Comandos

| Comando | Qué hace |
|---|---|
| `metar` o `atis` | Muestra el METAR actual del aeropuerto y avisa si hay LVP |

Detalles técnicos: [meteorología dinámica](../motor/meteorologia.md).

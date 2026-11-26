# openScope (fork): documentación

Simulador de control de tráfico aéreo en HTML5, basado en [openScope](https://github.com/openscope/openscope),
con tres añadidos principales:

- **Controladores automáticos (bots)** que llevan un aeropuerto entero (llegadas, aproximación, aterrizaje,
  rodaje, despegue y salida) usando solo las órdenes de un controlador humano: el Bot A (reglas expertas y
  metaheurísticas), el Bot B (aprendizaje por refuerzo) y el Bot C (agentes especialistas con supervisores).
- **Realismo operacional** con perfiles normativos por aeropuerto (EASA/RECAT-EU, FAA, ICAO), emergencias y
  puntuación alineada con las prioridades reales: seguridad > separación > procedimientos > eficiencia.
- **Aeropuertos españoles actualizados** con datos AIRAC reales (LEMD, LEMG).

[Jugar en el navegador](https://jossseluuu.github.io/openScope/){ .md-button .md-button--primary }
[Código en GitHub](https://github.com/jossseluuu/openScope){ .md-button }

## Por dónde empezar

| Quiero… | Página |
|---|---|
| Jugar y conocer los comandos | [Comandos](guia-jugador/comandos.md), [comandos de aeronave](guia-jugador/comandos-aeronave.md) |
| Entender la puntuación | [Puntuación](guia-jugador/puntuacion.md), [reglas de puntuación](especificacion/puntuacion.md) |
| Ver cómo funciona el motor | [Arquitectura](motor/arquitectura.md), [bucle](motor/bucle.md), [aeronaves](motor/aeronaves.md) |
| Consultar una constante o una norma | [Hoja de especificaciones](especificacion/index.md) |
| Entender los bots | [Bots](bots/index.md), [modelo de razonamiento](bots/razonamiento.md), [matriz de comandos](bots/matriz-comandos.md) |
| Crear o corregir un aeropuerto | [Formato](aeropuertos/formato-aeropuerto.md), [validador](aeropuertos/validador.md) |
| Contribuir | [Testing](desarrollo/testing.md), [CI/CD](desarrollo/ci.md), [cómo documentar](desarrollo/documentar.md) |

## Estado del proyecto

El plan de trabajo vivo está en `phacer.md` (raíz del repositorio). Las decisiones de arquitectura se
registran en [Decisiones (ADR)](adr/index.md).

!!! note "Idioma"
    La documentación nueva está en español. Las páginas heredadas de openScope siguen en inglés (lo indica un
    aviso al principio) y se traducen cuando se modifican.

# Laboratorio Representación de Fronteras B-Rep

Aplicación web didáctica para explorar la representación de fronteras, validar defectos frecuentes y observar una secuencia simplificada de operadores de Euler.

## Ejecución local

```bash
npm install
npm run dev
```

Vite mostrará la dirección local de la aplicación. Para generar la versión final:

```bash
npm run build
npm run preview
```

## Despliegue en Render

El repositorio incluye `render.yaml`. En Render:

1. Subir esta carpeta a un repositorio de GitHub.
2. Seleccionar **New > Blueprint** y conectar el repositorio.
3. Render detectará la configuración y publicará `dist` como sitio estático.

Configuración manual equivalente:

- Build command: `npm ci && npm run build`
- Publish directory: `dist`

## Alcance

- Visualización de caras, aristas, vértices y normales.
- Cálculo de la característica de Euler y del volumen con signo.
- Estructura Half-Edge visible: flechas de semiaristas, tabla con next, prev y twin, y recorrido animado del contorno de una cara.
- Validación jerárquica (vértices, aristas, contornos, caras, incidencia, orientación y topología global) que señala el nivel donde se origina el defecto.
- Defectos controlados sobre cualquier sólido: abertura, orientación invertida, arista non-manifold, cara degenerada y sólido invertido.
- Tolerancia ε ajustable para fusionar vértices casi coincidentes.
- Caso visual predefinido de autointersección.
- Construcción de un cubo con operadores de Euler reales (MVFS, MEV, MEF y sus inversos KEV, KEF); χ = 2 se conserva en los 13 pasos.
- Sólidos adicionales: marco de género 1 (χ = 0, validado contra 2 − 2g) y cilindro teselado con número de lados ajustable.
- Geometría frente a topología: trasladar, escalar y desplazar un vértice sin alterar la conectividad.
- Selección de caras, aristas y vértices con sus relaciones de adyacencia e incidencia; registro Winged-Edge de cada arista.
- Comparación en vivo de lista de caras, Winged-Edge y Half-Edge: registros, referencias y costo de una consulta de vecindad.
- Subdivisión de caras con MEF y su inverso KEF sobre cualquier sólido.
- Recorrido guiado de 12 pasos que sigue los capítulos del informe.
- Atajos de teclado: 1, 2, 3 (modos), ← → (pasos), H (semiaristas), N (normales), R (vista), G (recorrido), Espacio y Retroceso (pasos del recorrido).

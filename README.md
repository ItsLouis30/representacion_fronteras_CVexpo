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
- Cálculo de la característica de Euler.
- Detección didáctica de aberturas, orientación incompatible, aristas non-manifold y caras degeneradas.
- Caso visual predefinido de autointersección.
- Construcción guiada de un prisma con operadores MVFS, MEV y MEF.

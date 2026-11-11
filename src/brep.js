// Lógica B-Rep pura (sin DOM ni Three.js): geometría básica, Half-Edge,
// validación jerárquica, tolerancias y operadores de Euler.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.hypot(a[0], a[1], a[2]);

export const vec = { sub, add, scale, dot, cross, length };

export function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function centroid(vertices, indices) {
  if (!indices.length) return [0, 0, 0];
  const sum = indices.reduce((acc, index) => add(acc, vertices[index]), [0, 0, 0]);
  return scale(sum, 1 / indices.length);
}

// Vector de área (método de Newell): su dirección es la normal y su módulo, el doble del área.
export function areaVector(vertices, face) {
  let total = [0, 0, 0];
  for (let index = 0; index < face.length; index += 1) {
    const current = vertices[face[index]];
    const next = vertices[face[(index + 1) % face.length]];
    total = add(total, cross(current, next));
  }
  return total;
}

export function polygonArea(vertices, face) {
  if (face.length < 3) return 0;
  return length(areaVector(vertices, face)) * 0.5;
}

export function faceNormal(vertices, face) {
  const normal = areaVector(vertices, face);
  const size = length(normal);
  return size > 1e-9 ? scale(normal, 1 / size) : null;
}

export function orientFaces(vertices, faces) {
  const center = centroid(vertices, vertices.map((_, index) => index));
  return faces.map((face) => {
    if (face.length < 3) return [...face];
    const normal = areaVector(vertices, face);
    const outward = sub(centroid(vertices, face), center);
    return dot(normal, outward) < 0 ? [...face].reverse() : [...face];
  });
}

export function collectEdges(model) {
  const edgeMap = new Map();
  model.faces.forEach((face, faceIndex) => {
    face.forEach((vertex, index) => {
      const next = face[(index + 1) % face.length];
      const key = edgeKey(vertex, next);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { key, a: Math.min(vertex, next), b: Math.max(vertex, next), uses: [] });
      }
      edgeMap.get(key).uses.push({ faceIndex, from: vertex, to: next });
    });
  });

  (model.explicitEdges ?? []).forEach(([a, b]) => {
    const key = edgeKey(a, b);
    if (!edgeMap.has(key)) edgeMap.set(key, { key, a: Math.min(a, b), b: Math.max(a, b), uses: [] });
  });
  return edgeMap;
}

// Volumen con signo (teorema de la divergencia): positivo si las normales apuntan hacia afuera.
export function signedVolume(model) {
  let volume = 0;
  model.faces.forEach((face) => {
    for (let index = 1; index < face.length - 1; index += 1) {
      const a = model.vertices[face[0]];
      const b = model.vertices[face[index]];
      const c = model.vertices[face[index + 1]];
      volume += dot(a, cross(b, c)) / 6;
    }
  });
  return volume;
}

// Estructura Half-Edge derivada de los contornos de las caras.
export function buildHalfEdges(model) {
  const halfEdges = [];
  const byDirection = new Map();
  model.faces.forEach((face, faceIndex) => {
    if (face.length < 2) return;
    const first = halfEdges.length;
    face.forEach((vertex, index) => {
      const target = face[(index + 1) % face.length];
      const id = first + index;
      halfEdges.push({
        id,
        origin: vertex,
        target,
        face: faceIndex,
        next: first + ((index + 1) % face.length),
        prev: first + ((index - 1 + face.length) % face.length),
        twin: null,
      });
      const key = `${vertex}>${target}`;
      if (!byDirection.has(key)) byDirection.set(key, []);
      byDirection.get(key).push(id);
    });
  });

  halfEdges.forEach((halfEdge) => {
    const same = byDirection.get(`${halfEdge.origin}>${halfEdge.target}`) ?? [];
    const opposite = byDirection.get(`${halfEdge.target}>${halfEdge.origin}`) ?? [];
    // Solo hay twin cuando la arista es manifold y está orientada de forma compatible.
    if (same.length === 1 && opposite.length === 1 && opposite[0] !== halfEdge.id) {
      halfEdge.twin = opposite[0];
    }
  });
  return halfEdges;
}

// Fusiona los vértices cuya distancia es menor o igual que la tolerancia eps.
export function weldVertices(model, eps) {
  const count = model.vertices.length;
  const parent = model.vertices.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    parent[index] = root;
    return root;
  };

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      if (length(sub(model.vertices[i], model.vertices[j])) <= eps) {
        const rootI = find(i);
        const rootJ = find(j);
        if (rootI !== rootJ) parent[Math.max(rootI, rootJ)] = Math.min(rootI, rootJ);
      }
    }
  }

  const remap = new Map();
  const vertices = [];
  for (let index = 0; index < count; index += 1) {
    const root = find(index);
    if (!remap.has(root)) {
      remap.set(root, vertices.length);
      vertices.push([...model.vertices[root]]);
    }
  }
  const mapIndex = (index) => remap.get(find(index));

  return {
    ...model,
    vertices,
    faces: model.faces.map((face) => face.map(mapIndex)),
    explicitEdges: model.explicitEdges?.map((edge) => edge.map(mapIndex)),
    merged: count - vertices.length,
  };
}

// Validación jerárquica: de las entidades elementales a la envolvente (Sakkalis et al., 2000).
export function validateModel(model) {
  const edges = collectEdges(model);
  const edgeList = [...edges.values()];
  const forcedErrors = model.forcedErrors ?? [];
  const referenced = new Set();
  model.faces.forEach((face) => face.forEach((vertex) => referenced.add(vertex)));
  (model.explicitEdges ?? []).forEach((edge) => edge.forEach((vertex) => referenced.add(vertex)));
  if (model.vertices.length === 1) referenced.add(0);

  // Nivel 1: vértices
  const invalidVertices = model.vertices.filter((vertex) => !vertex.every(Number.isFinite)).length;
  let duplicateVertices = 0;
  for (let i = 0; i < model.vertices.length; i += 1) {
    for (let j = i + 1; j < model.vertices.length; j += 1) {
      if (length(sub(model.vertices[i], model.vertices[j])) < 1e-9) duplicateVertices += 1;
    }
  }

  // Nivel 2: aristas
  const zeroEdges = edgeList.filter(
    (edge) => edge.a === edge.b || length(sub(model.vertices[edge.a], model.vertices[edge.b])) < 1e-9,
  );

  // Nivel 3: contornos
  const brokenLoops = model.faces.filter((face) => new Set(face).size < 3 || new Set(face).size !== face.length);

  // Nivel 4: caras
  const degenerateFaces = model.faces.filter((face) => polygonArea(model.vertices, face) < 1e-6);

  // Nivel 5: incidencia y cierre
  const boundaryEdges = edgeList.filter((edge) => edge.uses.length === 1);
  const nonManifoldEdges = edgeList.filter((edge) => edge.uses.length > 2);
  const closed = model.faces.length > 0 && boundaryEdges.length === 0 && nonManifoldEdges.length === 0;

  // Nivel 6: orientación
  const orientationErrors = edgeList.filter((edge) => {
    if (edge.uses.length !== 2) return false;
    const [first, second] = edge.uses;
    return first.from === second.from && first.to === second.to;
  });
  const volume = signedVolume(model);
  const inwardNormals = closed && orientationErrors.length === 0 && volume < -1e-9;

  // Nivel 7: topología global
  const chi = referenced.size - edges.size + model.faces.length;
  const genus = model.genus ?? 0;
  const expectedChi = 2 - 2 * genus;

  const levels = [
    {
      level: "Vértices",
      ok: invalidVertices === 0 && duplicateVertices === 0,
      label: invalidVertices
        ? `${invalidVertices} vértice(s) con coordenadas no finitas.`
        : duplicateVertices
          ? `${duplicateVertices} par(es) de vértices duplicados.`
          : "Coordenadas finitas y sin duplicados.",
    },
    {
      level: "Aristas",
      ok: zeroEdges.length === 0,
      label: zeroEdges.length
        ? `${zeroEdges.length} arista(s) de longitud cero.`
        : "Extremos distintos: ninguna arista de longitud cero.",
    },
    {
      level: "Contornos",
      ok: brokenLoops.length === 0,
      label: brokenLoops.length
        ? `${brokenLoops.length} contorno(s) con vértices repetidos o insuficientes.`
        : "Cada contorno es un ciclo cerrado de al menos tres vértices.",
    },
    {
      level: "Caras",
      ok: degenerateFaces.length === 0 && forcedErrors.length === 0,
      label: degenerateFaces.length
        ? `${degenerateFaces.length} cara(s) degenerada(s) de área nula.`
        : forcedErrors.length
          ? forcedErrors[0]
          : "Caras con área positiva y sin autointersecciones.",
    },
    {
      level: "Incidencia y cierre",
      ok: closed,
      label: closed
        ? "Frontera cerrada y manifold: n(e) = 2 en todas las aristas."
        : [
            boundaryEdges.length ? `${boundaryEdges.length} arista(s) con n(e) = 1 (abertura)` : "",
            nonManifoldEdges.length ? `${nonManifoldEdges.length} arista(s) con n(e) > 2 (non-manifold)` : "",
          ].filter(Boolean).join("; ") + "." ,
    },
    {
      level: "Orientación",
      ok: orientationErrors.length === 0 && !inwardNormals,
      label: orientationErrors.length
        ? `${orientationErrors.length} arista(s) recorridas en el mismo sentido por sus dos caras.`
        : inwardNormals
          ? `Volumen con signo negativo (${volume.toFixed(2)}): las normales apuntan al interior.`
          : "Caras adyacentes compatibles y normales hacia el exterior.",
    },
    {
      level: "Topología global",
      ok: chi === expectedChi,
      label: chi !== expectedChi
        ? `χ = ${chi}; se esperaba ${expectedChi}${genus ? ` (2 − 2g con g = ${genus})` : ""}.`
        : genus
          ? `χ = ${chi} = 2 − 2·${genus}: superficie con ${genus} túnel(es).`
          : "χ = V − E + F = 2: superficie sin túneles.",
    },
  ];

  const firstFailure = levels.findIndex((item) => !item.ok);
  const checks = levels.map((item, index) => ({
    ...item,
    origin: index === firstFailure,
    consequence: !item.ok && index > firstFailure,
  }));

  return {
    edges,
    vertices: referenced.size,
    faces: model.faces.length,
    chi,
    genus,
    volume,
    closed,
    valid: firstFailure === -1,
    checks,
    boundaryKeys: new Set(boundaryEdges.map((edge) => edge.key)),
    nonManifoldKeys: new Set(nonManifoldEdges.map((edge) => edge.key)),
    orientationKeys: new Set(orientationErrors.map((edge) => edge.key)),
  };
}

// ---------------------------------------------------------------------------
// Operadores de Euler. La topología se guarda como ciclos de vértices: cada par
// consecutivo de un ciclo es una semiarista, por lo que E = (suma de longitudes) / 2.
// ---------------------------------------------------------------------------

export function mvfs(point) {
  return { vertices: [[...point]], loops: [[0]] };
}

export function mev(topo, loopIndex, vertex, point) {
  const loops = topo.loops.map((loop) => [...loop]);
  const loop = loops[loopIndex];
  const position = loop.indexOf(vertex);
  if (position === -1) throw new Error(`MEV: V${vertex + 1} no pertenece al ciclo ${loopIndex}.`);
  const created = topo.vertices.length;
  if (loop.length === 1) loop.push(created);
  else loop.splice(position, 1, vertex, created, vertex);
  return { vertices: [...topo.vertices.map((p) => [...p]), [...point]], loops };
}

export function mef(topo, loopIndex, a, b) {
  const loops = topo.loops.map((loop) => [...loop]);
  const loop = loops[loopIndex];
  const i = loop.indexOf(a);
  const j = loop.indexOf(b);
  if (i === -1 || j === -1 || i === j) throw new Error("MEF: los vértices deben pertenecer al mismo ciclo.");
  const walk = (from, to) => {
    const result = [];
    for (let index = from; ; index = (index + 1) % loop.length) {
      result.push(loop[index]);
      if (index === to) break;
    }
    return result;
  };
  loops[loopIndex] = walk(j, i); // ciclo restante, cerrado por la semiarista a→b
  loops.push(walk(i, j)); // cara nueva, cerrada por la semiarista b→a
  return { vertices: topo.vertices.map((p) => [...p]), loops };
}

export function topoCounts(topo) {
  const halfEdges = topo.loops.reduce((sum, loop) => sum + (loop.length > 1 ? loop.length : 0), 0);
  const v = topo.vertices.length;
  const e = halfEdges / 2;
  const f = topo.loops.length;
  return { v, e, f, chi: v - e + f };
}

export function topoEdges(topo) {
  const seen = new Map();
  topo.loops.forEach((loop) => {
    if (loop.length < 2) return;
    loop.forEach((vertex, index) => {
      const next = loop[(index + 1) % loop.length];
      seen.set(edgeKey(vertex, next), [Math.min(vertex, next), Math.max(vertex, next)]);
    });
  });
  return [...seen.values()];
}

// Un ciclo se puede dibujar como cara cuando es un polígono simple con área.
export function isSimpleLoop(vertices, loop) {
  return loop.length >= 3 && new Set(loop).size === loop.length && polygonArea(vertices, loop) > 1e-6;
}

const base = [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]];
const top = base.map(([x, , z]) => [x, 1, z]);

export const cubeProgram = [
  { op: "MVFS", inverse: null, point: base[0], title: "Crear la estructura inicial", description: "Nacen V1, una cara y la envolvente. Ya se cumple 1 − 0 + 1 = 2." },
  { op: "MEV", inverse: "KEV", vertex: 0, point: base[1], title: "Arista V1–V2", description: "Se crean a la vez un vértice y una arista: ΔV − ΔE = 0." },
  { op: "MEV", inverse: "KEV", vertex: 1, point: base[2], title: "Arista V2–V3", description: "El contorno de la base se extiende con V3." },
  { op: "MEV", inverse: "KEV", vertex: 2, point: base[3], title: "Arista V3–V4", description: "V4 completa los vértices de la base; el ciclo aún es una línea abierta." },
  { op: "MEF", inverse: "KEF", a: 3, b: 0, title: "Cerrar la base", description: "La arista V4–V1 divide el ciclo en dos caras: una lámina sin volumen." },
  { op: "MEV", inverse: "KEV", vertex: 0, point: top[0], title: "Elevar V1 → V5", description: "Primera arista vertical de la extrusión." },
  { op: "MEV", inverse: "KEV", vertex: 1, point: top[1], title: "Elevar V2 → V6", description: "Segunda arista vertical." },
  { op: "MEV", inverse: "KEV", vertex: 2, point: top[2], title: "Elevar V3 → V7", description: "Tercera arista vertical." },
  { op: "MEV", inverse: "KEV", vertex: 3, point: top[3], title: "Elevar V4 → V8", description: "Cuarta arista vertical: ya existen los ocho vértices." },
  { op: "MEF", inverse: "KEF", a: 4, b: 5, title: "Cara lateral V5–V6", description: "La arista V5–V6 separa la primera cara lateral." },
  { op: "MEF", inverse: "KEF", a: 5, b: 6, title: "Cara lateral V6–V7", description: "Segunda cara lateral." },
  { op: "MEF", inverse: "KEF", a: 6, b: 7, title: "Cara lateral V7–V8", description: "Tercera cara lateral." },
  { op: "MEF", inverse: "KEF", a: 7, b: 4, title: "Cerrar la envolvente", description: "La última arista separa la cuarta cara lateral; el ciclo restante es la cara superior." },
];

// Devuelve el estado topológico después de cada operación del programa.
export function runProgram(program) {
  const states = [];
  let topo = null;
  program.forEach((step) => {
    if (step.op === "MVFS") topo = mvfs(step.point);
    else if (step.op === "MEV") topo = mev(topo, 0, step.vertex, step.point);
    else if (step.op === "MEF") topo = mef(topo, 0, step.a, step.b);
    states.push(topo);
  });
  return states;
}

// ---------------------------------------------------------------------------
// Sólidos adicionales
// ---------------------------------------------------------------------------

// Marco cuadrado: poliedro de género 1 (un túnel). V = 16, E = 32, F = 16, χ = 0.
export function torusModel(outer = 1.5, inner = 0.7, depth = 0.5) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const ring = (size, z) => corners.map(([x, y]) => [x * size, y * size, z]);
  const vertices = [...ring(outer, depth), ...ring(inner, depth), ...ring(outer, -depth), ...ring(inner, -depth)];
  const faces = [];
  for (let k = 0; k < 4; k += 1) {
    const n = (k + 1) % 4;
    const [of, nf, oi, ni] = [k, n, 4 + k, 4 + n];
    const [ob, nb, obi, nbi] = [8 + k, 8 + n, 12 + k, 12 + n];
    faces.push([of, nf, ni, oi]); // frente (+z)
    faces.push([ob, obi, nbi, nb]); // reverso (−z)
    faces.push([of, ob, nb, nf]); // lateral exterior
    faces.push([oi, ni, nbi, obi]); // lateral interior: su normal apunta al túnel
  }
  return { name: "Marco B-Rep (toro poliédrico)", vertices, faces, genus: 1 };
}

// Prisma de n lados que aproxima un cilindro: V = 2n, E = 3n, F = n + 2.
export function cylinderModel(sides = 12) {
  const vertices = [];
  for (const y of [-1, 1]) {
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2;
      vertices.push([Math.cos(angle) * 1.2, y, Math.sin(angle) * 1.2]);
    }
  }
  const bottom = Array.from({ length: sides }, (_, index) => index);
  const faces = [bottom, bottom.map((index) => index + sides)];
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    faces.push([index, next, sides + next, sides + index]);
  }
  return { name: `Cilindro teselado (${sides} lados)`, vertices, faces: orientFaces(vertices, faces), genus: 0 };
}

// ---------------------------------------------------------------------------
// Winged-Edge y comparación de estructuras
// ---------------------------------------------------------------------------

// Registro Winged-Edge de cada arista, derivado de las semiaristas.
export function wingedEdges(halfEdges) {
  const keyOf = (id) => (id === null ? null : edgeKey(halfEdges[id].origin, halfEdges[id].target));
  const records = new Map();
  halfEdges.forEach((halfEdge) => {
    const key = edgeKey(halfEdge.origin, halfEdge.target);
    if (records.has(key)) return;
    const twin = halfEdge.twin === null ? null : halfEdges[halfEdge.twin];
    records.set(key, {
      key,
      start: halfEdge.origin,
      end: halfEdge.target,
      leftFace: halfEdge.face,
      rightFace: twin ? twin.face : null,
      leftPrev: keyOf(halfEdge.prev),
      leftNext: keyOf(halfEdge.next),
      rightPrev: twin ? keyOf(twin.prev) : null,
      rightNext: twin ? keyOf(twin.next) : null,
    });
  });
  return records;
}

// Registros, referencias y costo de la consulta "caras vecinas de F1" en cada estructura.
export function structureStats(model, halfEdges) {
  const v = model.vertices.length;
  const f = model.faces.length;
  const e = new Set(halfEdges.map((item) => edgeKey(item.origin, item.target))).size;
  const h = halfEdges.length;
  const indexCount = model.faces.reduce((sum, face) => sum + face.length, 0);
  const first = model.faces[0] ?? [];

  // Lista de caras: hay que comparar cada arista de F1 con las aristas de todas las demás caras.
  let comparisons = 0;
  const neighbours = new Set();
  first.forEach((vertex, index) => {
    const key = edgeKey(vertex, first[(index + 1) % first.length]);
    model.faces.forEach((face, faceIndex) => {
      if (faceIndex === 0) return;
      face.forEach((other, position) => {
        comparisons += 1;
        if (edgeKey(other, face[(position + 1) % face.length]) === key) neighbours.add(faceIndex);
      });
    });
  });

  return {
    neighbours: [...neighbours],
    faceList: { records: v + f, references: indexCount, steps: comparisons },
    wingedEdge: { records: v + e + f, references: 8 * e + v + f, steps: first.length },
    halfEdge: { records: v + h + f, references: 5 * h + v + f, steps: first.length },
  };
}

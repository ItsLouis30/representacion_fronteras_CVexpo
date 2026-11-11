import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  buildHalfEdges,
  centroid,
  collectEdges,
  cubeProgram,
  cylinderModel,
  faceNormal,
  isSimpleLoop,
  mef,
  orientFaces,
  runProgram,
  structureStats,
  topoCounts,
  topoEdges,
  torusModel,
  validateModel,
  vec,
  weldVertices,
  wingedEdges,
} from "./brep.js";
import "./styles.css";

const canvas = document.querySelector("#brep-canvas");
const canvasWrap = document.querySelector("#canvas-wrap");
const $ = (selector) => document.querySelector(selector);
const v3 = (point) => new THREE.Vector3(point[0], point[1], point[2]);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9eef1);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(5.6, 4.2, 6.4);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
canvasWrap.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3.6;
controls.maxDistance = 13;
controls.target.set(0, 0, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xf7fafc, 0x52616d, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(5, 7, 6);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9fc5dd, 1.2);
fillLight.position.set(-5, 2, -4);
scene.add(fillLight);

const grid = new THREE.GridHelper(10, 10, 0xb6c1c8, 0xd3dade);
grid.position.y = -1.65;
scene.add(grid);

const modelRoot = new THREE.Group();
scene.add(modelRoot);

const defaultLayers = { faces: true, edges: true, vertices: true, normals: false, halfedges: false };

const state = {
  mode: "explore",
  model: "cube",
  defect: "valid",
  buildStep: 0,
  selectedFace: null,
  eps: 0,
  sides: 12,
  transform: { tx: 0, scale: 1, v1: 0 },
  edits: [],
  tour: null,
  visible: { ...defaultLayers },
};

const palette = {
  face: 0x75a9ca,
  faceSelected: 0xd2944c,
  faceInvalid: 0xca6c64,
  edge: 0x173b59,
  edgeInvalid: 0xb43e38,
  edgeSelected: 0xe08a00,
  vertex: 0xcf7d31,
  vertexSelected: 0x7a1fa2,
  normal: 0x2c7550,
  normalInvalid: 0xb43e38,
  halfEdge: 0x7a4fb5,
  halfEdgeActive: 0xe08a00,
};

const cubeVertices = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const tetrahedronVertices = [[1.2, 1.1, 1.1], [-1.2, -1.1, 1.1], [-1.2, 1.1, -1.1], [1.2, -1.1, -1.1]];
const prismVertices = [[-1.25, -0.9, -1], [1.25, -0.9, -1], [0, 1.2, -1], [-1.25, -0.9, 1], [1.25, -0.9, 1], [0, 1.2, 1]];

const models = {
  cube: {
    name: "Cubo B-Rep",
    vertices: cubeVertices,
    faces: orientFaces(cubeVertices, [
      [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
      [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2],
    ]),
  },
  tetrahedron: {
    name: "Tetraedro B-Rep",
    vertices: tetrahedronVertices,
    faces: orientFaces(tetrahedronVertices, [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]),
  },
  prism: {
    name: "Prisma triangular B-Rep",
    vertices: prismVertices,
    faces: orientFaces(prismVertices, [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]]),
  },
  torus: torusModel(),
};

// Estados topológicos tras cada operador de Euler (MVFS, MEV, MEF).
const buildStates = runProgram(cubeProgram);

function baseModel() {
  return state.model === "cylinder" ? cylinderModel(state.sides) : models[state.model];
}

function cloneModel(model) {
  return {
    name: model.name,
    genus: model.genus ?? 0,
    vertices: model.vertices.map((vertex) => [...vertex]),
    faces: model.faces.map((face) => [...face]),
    forcedErrors: [],
  };
}

// Subdivisiones de caras: cada una es un MEF real sobre la diagonal de la cara.
function applyEdits(model) {
  state.edits.forEach(({ faceIndex }) => {
    const face = model.faces[faceIndex];
    if (!face || face.length < 4) return;
    model.faces = mef({ vertices: model.vertices, loops: model.faces }, faceIndex, face[0], face[2]).loops;
  });
}

// Transformaciones geométricas: cambian coordenadas, no conectividad.
function applyTransform(model) {
  const { tx, scale, v1 } = state.transform;
  if (v1) {
    const center = centroid(model.vertices, model.vertices.map((_, index) => index));
    const outward = vec.sub(model.vertices[0], center);
    model.vertices[0] = vec.add(model.vertices[0], vec.scale(outward, v1 / (vec.length(outward) || 1)));
  }
  model.vertices = model.vertices.map((vertex) => vec.add(vec.scale(vertex, scale), [tx, 0, 0]));
}

function modelForState() {
  if (state.mode === "build") {
    const topo = buildStates[state.buildStep];
    return {
      name: "Construcción de un cubo",
      vertices: topo.vertices.map((vertex) => [...vertex]),
      faces: topo.loops.filter((loop) => loop.length > 1).map((loop) => [...loop]),
      explicitEdges: topoEdges(topo),
      forcedErrors: [],
      construction: true,
    };
  }

  const model = cloneModel(baseModel());
  if (state.mode === "explore") {
    applyEdits(model);
    applyTransform(model);
    return model;
  }
  if (state.defect === "valid") return model;

  if (state.defect === "opening") {
    model.faces.splice(1, 1);
  }

  if (state.defect === "inverted") {
    model.faces[1] = [...model.faces[1]].reverse();
  }

  if (state.defect === "flipall") {
    model.faces = model.faces.map((face) => [...face].reverse());
  }

  if (state.defect === "nonmanifold") {
    const [first, second] = model.faces[0];
    const center = centroid(model.vertices, model.vertices.map((_, index) => index));
    const midpoint = vec.scale(vec.add(model.vertices[first], model.vertices[second]), 0.5);
    const outward = vec.sub(midpoint, center);
    const fin = vec.add(midpoint, vec.scale(outward, 1.1 / (vec.length(outward) || 1)));
    model.vertices.push(fin);
    model.faces.push([second, first, model.vertices.length - 1]);
  }

  if (state.defect === "degenerate") {
    model.faces[1] = [model.faces[1][0], model.faces[1][1], model.faces[1][1]];
  }

  if (state.defect === "selfintersection") {
    model.forcedErrors.push("Se detectó una autointersección entre regiones de la frontera.");
  }

  if (state.defect === "tolerance") {
    // La cara 2 usa copias de sus vértices separadas 0.03: parece cerrada, pero no comparte aristas.
    const normal = faceNormal(model.vertices, model.faces[1]);
    model.faces[1] = model.faces[1].map((index) => {
      model.vertices.push(vec.add(model.vertices[index], vec.scale(normal, 0.03)));
      return model.vertices.length - 1;
    });
    const welded = weldVertices(model, state.eps);
    welded.name = model.name;
    return welded;
  }

  return model;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child instanceof CSS2DObject) {
      child.element.remove();
    }
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}

function clearModel() {
  while (modelRoot.children.length) {
    const child = modelRoot.children[0];
    modelRoot.remove(child);
    disposeObject(child);
  }
}

function faceGeometry(vertices, face) {
  const positions = [];
  if (face.length >= 3) {
    for (let index = 1; index < face.length - 1; index += 1) {
      [face[0], face[index], face[index + 1]].forEach((vertexIndex) => {
        positions.push(...vertices[vertexIndex]);
      });
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeSelfIntersectionVisual(group) {
  const material = new THREE.MeshBasicMaterial({
    color: palette.faceInvalid,
    transparent: true,
    opacity: 0.54,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(3.1, 2.5);
  const plane = new THREE.Mesh(geometry, material);
  plane.rotation.y = Math.PI / 2;
  plane.rotation.z = Math.PI / 4;
  plane.userData.decorative = true;
  group.add(plane);
}

// Flecha de una semiarista, desplazada hacia el interior de su cara.
function halfEdgeArrow(model, halfEdge) {
  const start = model.vertices[halfEdge.origin];
  const end = model.vertices[halfEdge.target];
  const direction = vec.sub(end, start);
  const size = vec.length(direction);
  if (size < 1e-6) return null;
  const unit = vec.scale(direction, 1 / size);
  const normal = faceNormal(model.vertices, model.faces[halfEdge.face]);
  let left = vec.cross(normal ?? [0, 1, 0], unit);
  if (vec.length(left) < 1e-6) left = vec.cross([0, 0, 1], unit);
  const inset = Math.min(0.1, size * 0.18);
  left = vec.scale(left, inset / vec.length(left));
  const origin = vec.add(vec.add(start, vec.scale(unit, size * 0.14)), left);
  const head = Math.min(0.17, size * 0.3);
  return new THREE.ArrowHelper(v3(unit), v3(origin), size * 0.72, palette.halfEdge, head, head * 0.55);
}

let faceMeshes = [];
let edgeLines = [];
let vertexMeshes = [];
let normalArrows = [];
let halfEdgeArrows = new Map();
let layerGroups = {};
let current = { model: null, validation: null, halfEdges: [], edgeMap: new Map() };
let traversalTimer = null;

function stopTraversal() {
  if (traversalTimer) clearInterval(traversalTimer);
  traversalTimer = null;
}

function applyVisibility() {
  Object.entries(layerGroups).forEach(([name, group]) => {
    group.visible = state.visible[name];
  });
  normalArrows.forEach((arrow) => {
    arrow.visible = state.visible.normals;
  });
}

function renderModel() {
  stopTraversal();
  clearModel();
  faceMeshes = [];
  edgeLines = [];
  vertexMeshes = [];
  normalArrows = [];
  halfEdgeArrows = new Map();
  state.selectedFace = null;

  const model = modelForState();
  const validation = validateModel(model);
  const halfEdges = buildHalfEdges(model);
  const edgeMap = collectEdges(model);
  current = { model, validation, halfEdges, edgeMap };
  const validating = state.mode === "validate";

  const faceGroup = new THREE.Group();
  model.faces.forEach((face, faceIndex) => {
    if (model.construction && !isSimpleLoop(model.vertices, face)) return;
    const invalidFace = validating && (
      (state.defect === "inverted" && faceIndex === 1) ||
      (state.defect === "degenerate" && faceIndex === 1) ||
      (state.defect === "nonmanifold" && faceIndex === model.faces.length - 1) ||
      state.defect === "flipall"
    );
    const material = new THREE.MeshStandardMaterial({
      color: invalidFace ? palette.faceInvalid : palette.face,
      transparent: true,
      opacity: 0.67,
      side: THREE.DoubleSide,
      roughness: 0.68,
      metalness: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(faceGeometry(model.vertices, face), material);
    mesh.userData = { type: "face", faceIndex, face, baseColor: material.color.getHex() };
    faceMeshes.push(mesh);
    faceGroup.add(mesh);

    const normal = faceNormal(model.vertices, face);
    if (normal) {
      const arrow = new THREE.ArrowHelper(
        v3(normal),
        v3(centroid(model.vertices, face)),
        0.62,
        invalidFace ? palette.normalInvalid : palette.normal,
        0.16,
        0.1,
      );
      normalArrows.push(arrow);
      modelRoot.add(arrow);
    }
  });
  if (validating && state.defect === "selfintersection") makeSelfIntersectionVisual(faceGroup);
  modelRoot.add(faceGroup);

  const edgeGroup = new THREE.Group();
  edgeMap.forEach((edge) => {
    if (edge.a === edge.b) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([v3(model.vertices[edge.a]), v3(model.vertices[edge.b])]);
    const invalid = validating && (
      validation.boundaryKeys.has(edge.key) ||
      validation.nonManifoldKeys.has(edge.key) ||
      validation.orientationKeys.has(edge.key)
    );
    const baseColor = invalid ? palette.edgeInvalid : palette.edge;
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: baseColor }));
    line.userData = { type: "edge", key: edge.key, a: edge.a, b: edge.b, baseColor };
    edgeLines.push(line);
    edgeGroup.add(line);
  });
  modelRoot.add(edgeGroup);

  const halfEdgeGroup = new THREE.Group();
  halfEdges.forEach((halfEdge) => {
    const arrow = halfEdgeArrow(model, halfEdge);
    if (!arrow) return;
    halfEdgeArrows.set(halfEdge.id, arrow);
    halfEdgeGroup.add(arrow);
  });
  modelRoot.add(halfEdgeGroup);

  const vertexGroup = new THREE.Group();
  const showLabels = model.vertices.length <= 32;
  const sphereGeometry = new THREE.SphereGeometry(0.075, 18, 18);
  model.vertices.forEach((vertex, index) => {
    const sphere = new THREE.Mesh(
      sphereGeometry.clone(),
      new THREE.MeshStandardMaterial({ color: palette.vertex, roughness: 0.55 }),
    );
    sphere.position.set(...vertex);
    sphere.userData = { type: "vertex", vertexIndex: index, baseColor: palette.vertex };
    vertexMeshes.push(sphere);
    vertexGroup.add(sphere);

    if (!showLabels) return;
    const labelElement = document.createElement("span");
    labelElement.className = "vertex-label";
    labelElement.dataset.vertex = index;
    labelElement.textContent = `V${index + 1}`;
    const label = new CSS2DObject(labelElement);
    label.position.set(vertex[0], vertex[1] + 0.16, vertex[2]);
    vertexGroup.add(label);
  });
  sphereGeometry.dispose();
  modelRoot.add(vertexGroup);

  layerGroups = { faces: faceGroup, edges: edgeGroup, vertices: vertexGroup, halfedges: halfEdgeGroup };
  applyVisibility();
  updateInterface(model, validation);
  renderHalfEdgeTable();
  renderStructures();
  updateEditButtons();
}

const signed = (value) => (value > 0 ? `+${value}` : `${value}`);

function buildChecks(counts, delta) {
  const step = cubeProgram[state.buildStep];
  const topo = buildStates[state.buildStep];
  const pending = topo.loops.filter((loop) => !isSimpleLoop(topo.vertices, loop)).length;
  const lamina = pending === 0 && counts.f === 2;
  return [
    { ok: true, level: "Invariante", label: `χ = ${counts.v} − ${counts.e} + ${counts.f} = 2 se conserva tras ${step.op}.` },
    { ok: true, level: "Variación", label: `ΔV ${signed(delta.v)}, ΔE ${signed(delta.e)}, ΔF ${signed(delta.f)} ⇒ ΔV − ΔE + ΔF = 0.` },
    {
      ok: false,
      level: "Geometría",
      label: lamina
        ? "Lámina de dos caras opuestas: topología válida, pero aún sin volumen."
        : `${pending} ciclo(s) todavía no delimitan una cara plana.`,
    },
  ];
}

function updateInterface(model, validation) {
  const buildMode = state.mode === "build";
  const completeBuild = buildMode && state.buildStep === cubeProgram.length - 1;
  const statusBadge = $("#status-badge");

  $("#viewer-title").textContent = model.name;
  $("#viewer-kicker").textContent = buildMode ? "Construcción incremental" : state.mode === "validate" ? "Modo de validación" : "Modo de exploración";

  statusBadge.classList.remove("status-badge--valid", "status-badge--invalid", "status-badge--progress");
  if (buildMode && !completeBuild) {
    statusBadge.textContent = "Construcción en progreso";
    statusBadge.classList.add("status-badge--progress");
  } else if (validation.valid) {
    statusBadge.textContent = "Modelo válido";
    statusBadge.classList.add("status-badge--valid");
  } else {
    statusBadge.textContent = "Modelo inválido";
    statusBadge.classList.add("status-badge--invalid");
  }

  let counts = { v: validation.vertices, e: validation.edges.size, f: validation.faces, chi: validation.chi };
  let deltaText = "";
  let checks = validation.checks;
  if (buildMode) {
    counts = topoCounts(buildStates[state.buildStep]);
    const previous = state.buildStep ? topoCounts(buildStates[state.buildStep - 1]) : { v: 0, e: 0, f: 0 };
    const delta = { v: counts.v - previous.v, e: counts.e - previous.e, f: counts.f - previous.f };
    deltaText = `${cubeProgram[state.buildStep].op}: ΔV ${signed(delta.v)} · ΔE ${signed(delta.e)} · ΔF ${signed(delta.f)}`;
    if (!completeBuild) checks = buildChecks(counts, delta);
  } else {
    const notes = [];
    if (validation.genus) notes.push(`género g = ${validation.genus}: ${validation.genus} túnel`);
    if (state.mode === "explore" && state.edits.length) notes.push(`${state.edits.length} × MEF: ΔE +1 · ΔF +1 cada uno`);
    deltaText = notes.join(" · ");
  }

  $("#metric-v").textContent = counts.v;
  $("#metric-e").textContent = counts.e;
  $("#metric-f").textContent = counts.f;
  $("#metric-chi").textContent = counts.chi;
  $("#metric-volume").textContent = validation.closed && (!buildMode || completeBuild) ? validation.volume.toFixed(2) : "—";
  const expectedChi = 2 - 2 * validation.genus;
  const genusSuffix = !buildMode && validation.genus
    ? ` ${counts.chi === expectedChi ? "=" : "≠"} 2 − 2·${validation.genus}`
    : "";
  const chiText = String(counts.chi).replace("-", "−");
  $("#metric-chi").textContent = chiText;
  $("#euler-formula").textContent = `${counts.v} − ${counts.e} + ${counts.f} = ${chiText}${genusSuffix}`;
  $("#euler-delta").textContent = deltaText;

  const checkList = $("#check-list");
  checkList.innerHTML = "";
  checks.forEach((check) => {
    const item = document.createElement("li");
    item.className = `check-item${check.ok ? "" : " is-failed"}`;
    const tag = check.origin ? '<em class="check-tag">origen del defecto</em>' : check.consequence ? '<em class="check-tag check-tag--soft">consecuencia</em>' : "";
    item.innerHTML = `<span class="check-icon">${check.ok ? "✓" : "!"}</span><span><b>${check.level}.</b> ${check.label} ${tag}</span>`;
    checkList.appendChild(item);
  });

  const toleranceActive = state.mode === "validate" && state.defect === "tolerance";
  $("#tolerance-control").classList.toggle("is-hidden", !toleranceActive);
  if (toleranceActive) {
    $("#tolerance-value").textContent = `ε = ${state.eps.toFixed(2)} · ${model.merged} vértice(s) fusionado(s)`;
  }

  const cylinderActive = !buildMode && state.model === "cylinder";
  $("#sides-control").classList.toggle("is-hidden", !cylinderActive);
  if (cylinderActive) {
    const n = state.sides;
    $("#sides-value").textContent = `n = ${n} · Malla: V = ${2 * n}, E = ${3 * n}, F = ${n + 2}`;
  }

  if (buildMode) updateBuildPanel();
}

function updateBuildPanel() {
  const step = cubeProgram[state.buildStep];
  $("#operator-name").textContent = step.op;
  $("#operator-title").textContent = step.title;
  $("#operator-description").textContent = step.description;
  $("#step-label").textContent = `Paso ${state.buildStep + 1} de ${cubeProgram.length}`;
  $("#progress-bar").style.width = `${((state.buildStep + 1) / cubeProgram.length) * 100}%`;
  const previousButton = $("#previous-step");
  previousButton.disabled = state.buildStep === 0;
  previousButton.textContent = step.inverse ? `Deshacer (${step.inverse})` : "Anterior";
  const nextButton = $("#next-step");
  const nextStep = cubeProgram[state.buildStep + 1];
  nextButton.disabled = !nextStep;
  nextButton.textContent = nextStep ? `Aplicar ${nextStep.op}` : "Modelo completo";
}

const heName = (id) => (id === null ? "—" : `h${id + 1}`);
const faceName = (index) => (index === null ? "—" : `F${index + 1}`);
const edgeName = (key) => {
  if (!key) return "—";
  const [a, b] = key.split("-").map(Number);
  return `E(${a + 1},${b + 1})`;
};

function renderHalfEdgeTable() {
  const { halfEdges } = current;
  $("#halfedge-count").textContent = `${halfEdges.length} semiaristas · ${halfEdges.filter((item) => item.twin === null).length} sin twin`;
  $("#halfedge-body").innerHTML = halfEdges.map((item) => `
    <tr data-he="${item.id}" data-face="${item.face}"${item.twin === null ? ' class="is-broken"' : ""}>
      <td>${heName(item.id)}</td>
      <td>V${item.origin + 1} → V${item.target + 1}</td>
      <td>F${item.face + 1}</td>
      <td>${heName(item.next)}</td>
      <td>${heName(item.prev)}</td>
      <td>${heName(item.twin)}</td>
    </tr>`).join("");
}

// Comparación en vivo de las tres estructuras de datos del Capítulo III.
function renderStructures() {
  const stats = structureStats(current.model, current.halfEdges);
  const cards = [
    { name: "Lista de caras", element: "Cara", adjacency: "No explícita", data: stats.faceList, unit: "comparaciones de índices" },
    { name: "Winged-Edge", element: "Arista (8 referencias)", adjacency: "Explícita", data: stats.wingedEdge, unit: "registros visitados" },
    { name: "Half-Edge", element: "Semiarista (5 referencias)", adjacency: "Explícita", data: stats.halfEdge, unit: "registros visitados" },
  ];
  $("#structure-query").textContent = stats.neighbours.length
    ? `Consulta: caras vecinas de F1 → ${stats.neighbours.map(faceName).join(", ")}`
    : "Consulta: caras vecinas de F1";
  $("#structure-grid").innerHTML = cards.map((card) => `
    <article class="structure-card">
      <h3>${card.name}</h3>
      <dl>
        <div><dt>Elemento principal</dt><dd>${card.element}</dd></div>
        <div><dt>Adyacencia</dt><dd>${card.adjacency}</dd></div>
        <div><dt>Registros</dt><dd>${card.data.records}</dd></div>
        <div><dt>Referencias almacenadas</dt><dd>${card.data.references}</dd></div>
        <div class="structure-cost"><dt>Costo de la consulta</dt><dd>${card.data.steps} <small>${card.unit}</small></dd></div>
      </dl>
    </article>`).join("");
}

function highlightHalfEdge(activeId, faceIndex) {
  halfEdgeArrows.forEach((arrow, id) => {
    arrow.setColor(id === activeId ? palette.halfEdgeActive : palette.halfEdge);
  });
  document.querySelectorAll("#halfedge-body tr").forEach((row) => {
    row.classList.toggle("is-face", Number(row.dataset.face) === faceIndex);
    row.classList.toggle("is-current", Number(row.dataset.he) === activeId);
  });
}

function clearSelection() {
  stopTraversal();
  [...faceMeshes, ...edgeLines, ...vertexMeshes].forEach((object) => object.material.color.setHex(object.userData.baseColor));
  highlightHalfEdge(null, -1);
  state.selectedFace = null;
  updateEditButtons();
}

function setEntityDetails(code, title, body) {
  $("#entity-details").innerHTML = `
    <span class="entity-code">${code}</span>
    <div>
      <strong>${title}</strong>
      ${body}
    </div>
  `;
}

function resetEntityDetails() {
  setEntityDetails("?", "Consulta de entidades", "<p>Haz clic en una <b>cara</b>, una <b>arista</b> o un <b>vértice</b> para consultar sus relaciones de adyacencia e incidencia.</p>");
}

function selectFace(mesh) {
  clearSelection();
  mesh.material.color.setHex(palette.faceSelected);
  const { faceIndex, face } = mesh.userData;
  const loop = current.halfEdges.filter((item) => item.face === faceIndex);
  const neighbours = [...new Set(loop.filter((item) => item.twin !== null).map((item) => current.halfEdges[item.twin].face))];
  const rows = loop.map((item) => {
    const twin = item.twin === null ? "sin twin" : `twin ${heName(item.twin)} (F${current.halfEdges[item.twin].face + 1})`;
    return `${heName(item.id)}: V${item.origin + 1}→V${item.target + 1} · next ${heName(item.next)} · ${twin}`;
  });
  setEntityDetails(
    `F${faceIndex + 1}`,
    `Cara con ${face.length} semiaristas`,
    `<p>${rows.join("<br>")}</p>
     <p class="entity-neighbours">Caras adyacentes por twin: ${neighbours.length ? neighbours.map(faceName).join(", ") : "ninguna"}.</p>`,
  );
  state.selectedFace = faceIndex;
  updateEditButtons();

  // Recorrido animado del contorno siguiendo el puntero next.
  if (!state.visible.halfedges) setLayer("halfedges", true);
  let position = 0;
  const advance = () => {
    if (!loop.length) return;
    highlightHalfEdge(loop[position].id, faceIndex);
    position = (position + 1) % loop.length;
  };
  advance();
  traversalTimer = setInterval(advance, 520);
}

function selectEdge(line) {
  clearSelection();
  line.material.color.setHex(palette.edgeSelected);
  const { key, a, b } = line.userData;
  const edge = current.edgeMap.get(key);
  const faces = [...new Set(edge.uses.map((use) => use.faceIndex))];
  faceMeshes.filter((mesh) => faces.includes(mesh.userData.faceIndex)).forEach((mesh) => mesh.material.color.setHex(palette.faceSelected));
  const halfEdges = current.halfEdges.filter((item) => edgeNameOf(item) === key);
  const record = wingedEdges(current.halfEdges).get(key);
  const winged = record
    ? `<p class="entity-neighbours">Registro Winged-Edge</p>
       <p>Vértices: V${record.start + 1}, V${record.end + 1}<br>
       Caras: izquierda ${faceName(record.leftFace)}, derecha ${faceName(record.rightFace)}<br>
       Ala izquierda: ${edgeName(record.leftPrev)} (anterior), ${edgeName(record.leftNext)} (siguiente)<br>
       Ala derecha: ${edgeName(record.rightPrev)} (anterior), ${edgeName(record.rightNext)} (siguiente)</p>`
    : "";
  setEntityDetails(
    "E",
    `Arista ${edgeName(key)} · n(e) = ${edge.uses.length}`,
    `<p>Vértices incidentes: V${a + 1}, V${b + 1}.<br>
     Caras incidentes: ${faces.length ? faces.map(faceName).join(", ") : "ninguna"}.<br>
     Semiaristas: ${halfEdges.length ? halfEdges.map((item) => heName(item.id)).join(", ") : "ninguna"}.</p>${winged}`,
  );
}

function edgeNameOf(halfEdge) {
  return halfEdge.origin < halfEdge.target ? `${halfEdge.origin}-${halfEdge.target}` : `${halfEdge.target}-${halfEdge.origin}`;
}

function selectVertex(sphere) {
  clearSelection();
  sphere.material.color.setHex(palette.vertexSelected);
  const index = sphere.userData.vertexIndex;
  const edges = edgeLines.filter((line) => line.userData.a === index || line.userData.b === index);
  edges.forEach((line) => line.material.color.setHex(palette.edgeSelected));
  const faces = faceMeshes.filter((mesh) => mesh.userData.face.includes(index));
  faces.forEach((mesh) => mesh.material.color.setHex(palette.faceSelected));
  const [x, y, z] = current.model.vertices[index];
  const neighbours = edges.map((line) => (line.userData.a === index ? line.userData.b : line.userData.a));
  setEntityDetails(
    `V${index + 1}`,
    `Vértice de grado ${edges.length}`,
    `<p>Coordenadas: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}).<br>
     Aristas incidentes: ${edges.length ? edges.map((line) => edgeName(line.userData.key)).join(", ") : "ninguna"}.<br>
     Caras incidentes: ${faces.length ? faces.map((mesh) => faceName(mesh.userData.faceIndex)).join(", ") : "ninguna"}.</p>
     <p class="entity-neighbours">Vértices adyacentes: ${neighbours.length ? neighbours.map((item) => `V${item + 1}`).join(", ") : "ninguno"}.</p>`,
  );
}

function updateEditButtons() {
  const face = state.selectedFace === null ? null : current.model?.faces[state.selectedFace];
  $("#subdivide-face").disabled = !(state.mode === "explore" && face && face.length >= 4);
  $("#undo-subdivide").disabled = state.edits.length === 0;
}

const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.07;
const pointer = new THREE.Vector2();
let pointerStart = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
  // Un arrastre rota la cámara; solo un clic sin desplazamiento selecciona.
  if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const faceHit = state.visible.faces ? raycaster.intersectObjects(faceMeshes, false)[0] : null;
  const vertexHit = state.visible.vertices ? raycaster.intersectObjects(vertexMeshes, false)[0] : null;
  const edgeHit = state.visible.edges ? raycaster.intersectObjects(edgeLines, false)[0] : null;
  // Vértices y aristas tienen prioridad si no quedan ocultos detrás de una cara.
  const limit = faceHit ? faceHit.distance + 0.15 : Infinity;
  if (vertexHit && vertexHit.distance <= limit) selectVertex(vertexHit.object);
  else if (edgeHit && edgeHit.distance <= limit) selectEdge(edgeHit.object);
  else if (faceHit) selectFace(faceHit.object);
});

const toggleMap = {
  faces: "toggle-faces",
  edges: "toggle-edges",
  vertices: "toggle-vertices",
  normals: "toggle-normals",
  halfedges: "toggle-halfedges",
};

// Lleva el estado a los controles de la interfaz.
function syncControls() {
  document.querySelectorAll(".mode-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  document.querySelectorAll(".mode-section").forEach((section) => {
    section.classList.toggle("is-hidden", !section.dataset.section.split(" ").includes(state.mode));
  });
  $("#model-select").value = state.model;
  document.querySelectorAll(".defect-button").forEach((button) => button.classList.toggle("is-active", button.dataset.defect === state.defect));
  Object.entries(toggleMap).forEach(([name, id]) => {
    $(`#${id}`).checked = state.visible[name];
  });
  $("#tolerance-range").value = state.eps;
  $("#sides-range").value = state.sides;
  $("#tf-translate").value = state.transform.tx;
  $("#tf-scale").value = state.transform.scale;
  $("#tf-vertex").value = state.transform.v1;
}

function refresh() {
  syncControls();
  renderModel();
  resetEntityDetails();
}

function setMode(mode) {
  state.mode = mode;
  refresh();
}

document.querySelectorAll(".mode-tab").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

$("#model-select").addEventListener("change", (event) => {
  state.model = event.target.value;
  state.edits = [];
  refresh();
});

document.querySelectorAll(".defect-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.defect = button.dataset.defect;
    refresh();
  });
});

$("#tolerance-range").addEventListener("input", (event) => {
  state.eps = Number(event.target.value);
  renderModel();
  resetEntityDetails();
});

$("#sides-range").addEventListener("input", (event) => {
  state.sides = Number(event.target.value);
  state.edits = [];
  renderModel();
  resetEntityDetails();
});

[["tf-translate", "tx"], ["tf-scale", "scale"], ["tf-vertex", "v1"]].forEach(([id, property]) => {
  $(`#${id}`).addEventListener("input", (event) => {
    state.transform[property] = Number(event.target.value);
    renderModel();
    resetEntityDetails();
  });
});

$("#tf-reset").addEventListener("click", () => {
  state.transform = { tx: 0, scale: 1, v1: 0 };
  refresh();
});

$("#subdivide-face").addEventListener("click", () => {
  if (state.selectedFace === null) return;
  const faceIndex = state.selectedFace;
  state.edits.push({ faceIndex });
  renderModel();
  setEntityDetails("MEF", `Cara F${faceIndex + 1} subdividida`, "<p>Se insertó una arista en la diagonal: ΔE = +1 y ΔF = +1, por lo que χ no cambia. El sólido sigue siendo válido y su volumen es el mismo.</p>");
});

$("#undo-subdivide").addEventListener("click", () => {
  if (!state.edits.length) return;
  state.edits.pop();
  renderModel();
  setEntityDetails("KEF", "Subdivisión deshecha", "<p>KEF elimina la arista y fusiona las dos caras: ΔE = −1 y ΔF = −1. Es el operador inverso de MEF.</p>");
});

function setLayer(name, visible) {
  state.visible[name] = visible;
  $(`#${toggleMap[name]}`).checked = visible;
  applyVisibility();
}

Object.entries(toggleMap).forEach(([name, id]) => {
  $(`#${id}`).addEventListener("change", (event) => setLayer(name, event.target.checked));
});

function stepBuild(offset) {
  const next = Math.min(cubeProgram.length - 1, Math.max(0, state.buildStep + offset));
  if (next === state.buildStep) return;
  state.buildStep = next;
  renderModel();
  resetEntityDetails();
}

$("#previous-step").addEventListener("click", () => stepBuild(-1));
$("#next-step").addEventListener("click", () => stepBuild(1));

function resetCamera() {
  camera.position.set(5.6, 4.2, 6.4);
  controls.target.set(0, 0, 0);
  controls.update();
}

$("#reset-camera").addEventListener("click", resetCamera);

// ---------------------------------------------------------------------------
// Recorrido guiado: sigue el orden de los capítulos del informe.
// ---------------------------------------------------------------------------

const tourSteps = [
  {
    chapter: "Capítulo II · 2.2",
    title: "Las entidades de la frontera",
    text: "B-Rep describe un sólido por su límite: caras, aristas y vértices. En el cubo son 6, 12 y 8. Haz clic en cualquiera para ver sus relaciones.",
    set: { mode: "explore", model: "cube" },
  },
  {
    chapter: "Capítulo II · 2.4",
    title: "Orientación y normales",
    text: "Cada cara tiene una normal que apunta al exterior. El orden de sus vértices define ese sentido mediante la regla de la mano derecha.",
    set: { mode: "explore", model: "cube", layers: { normals: true } },
  },
  {
    chapter: "Capítulo II · 2.6",
    title: "Fórmula de Euler",
    text: "En una superficie cerrada sin túneles, V − E + F = 2. El tetraedro lo cumple con 4 − 6 + 4.",
    set: { mode: "explore", model: "tetrahedron" },
  },
  {
    chapter: "Capítulo II · 2.6",
    title: "Género: un sólido con túnel",
    text: "Con g túneles la relación es V − E + F = 2 − 2g. Este marco tiene g = 1 y da 16 − 32 + 16 = 0, y aun así es un sólido válido.",
    set: { mode: "explore", model: "torus" },
  },
  {
    chapter: "Capítulo II · 2.1",
    title: "Geometría frente a topología",
    text: "Al escalar y trasladar cambian las coordenadas y el volumen, pero V, E, F y todas las conexiones permanecen iguales.",
    set: { mode: "explore", model: "cube", transform: { tx: 0.8, scale: 0.7, v1: 0.5 } },
  },
  {
    chapter: "Capítulo III · 3.4",
    title: "Half-Edge: recorrer con next y twin",
    text: "Cada arista se guarda como dos semiaristas opuestas. Con next se recorre el contorno de una cara; con twin se salta a la cara vecina.",
    set: { mode: "explore", model: "cube", layers: { halfedges: true } },
    after: () => faceMeshes[1] && selectFace(faceMeshes[1]),
  },
  {
    chapter: "Capítulo III · 3.5",
    title: "Tres estructuras, una misma consulta",
    text: "Hallar las caras vecinas de F1 exige decenas de comparaciones en una lista de caras y solo unos pasos con Winged-Edge o Half-Edge.",
    set: { mode: "explore", model: "cube" },
    scroll: "#structure-panel",
  },
  {
    chapter: "Capítulo IV · 4.2",
    title: "Operadores de Euler: MVFS",
    text: "La construcción parte de un vértice, una cara y una envolvente. Desde el primer paso se cumple 1 − 0 + 1 = 2.",
    set: { mode: "build", buildStep: 0 },
  },
  {
    chapter: "Capítulo IV · 4.3",
    title: "MEV y MEF conservan χ",
    text: "MEV añade un vértice y una arista; MEF añade una arista y una cara. En ambos casos ΔV − ΔE + ΔF = 0. Aquí la base es una lámina de dos caras.",
    set: { mode: "build", buildStep: 4, layers: { halfedges: true } },
  },
  {
    chapter: "Capítulo IV · 4.7",
    title: "La envolvente se cierra",
    text: "Tras 13 operadores se obtiene 8 − 12 + 6 = 2 con una frontera cerrada. Cada paso se deshace con su inverso, KEV o KEF.",
    set: { mode: "build", buildStep: 12 },
  },
  {
    chapter: "Capítulo V · 5.2",
    title: "Euler no basta",
    text: "Con una cara invertida la fórmula sigue dando 2, pero la orientación es incompatible y el volumen calculado cae. La validación jerárquica señala el nivel de origen.",
    set: { mode: "validate", model: "cube", defect: "inverted", layers: { normals: true } },
  },
  {
    chapter: "Capítulo V · 5.3",
    title: "Tolerancias numéricas",
    text: "Una cara separada 0.03 parece unida, pero deja la frontera abierta. Con ε = 0.05 los vértices se fusionan y el sólido vuelve a ser válido.",
    set: { mode: "validate", model: "cube", defect: "tolerance", eps: 0.05 },
  },
];

function showTour(index) {
  state.tour = Math.min(tourSteps.length - 1, Math.max(0, index));
  const step = tourSteps[state.tour];
  const { layers, transform, ...rest } = step.set;
  Object.assign(state, { defect: "valid", eps: 0, buildStep: 0, edits: [] }, rest);
  state.transform = { tx: 0, scale: 1, v1: 0, ...transform };
  state.visible = { ...defaultLayers, ...layers };
  refresh();
  step.after?.();

  $("#tour-bar").classList.remove("is-hidden");
  $("#tour-kicker").textContent = `Recorrido guiado · Paso ${state.tour + 1} de ${tourSteps.length} · ${step.chapter}`;
  $("#tour-title").textContent = step.title;
  $("#tour-text").textContent = step.text;
  $("#tour-prev").disabled = state.tour === 0;
  $("#tour-next").disabled = state.tour === tourSteps.length - 1;
  const target = step.scroll ? $(step.scroll) : $("#tour-bar");
  target.scrollIntoView({ behavior: "smooth", block: step.scroll ? "center" : "start" });
}

function exitTour() {
  state.tour = null;
  $("#tour-bar").classList.add("is-hidden");
  state.visible = { ...defaultLayers };
  state.transform = { tx: 0, scale: 1, v1: 0 };
  refresh();
}

$("#tour-start").addEventListener("click", () => showTour(0));
$("#tour-prev").addEventListener("click", () => showTour(state.tour - 1));
$("#tour-next").addEventListener("click", () => showTour(state.tour + 1));
$("#tour-exit").addEventListener("click", exitTour);

// Atajos de teclado para la exposición.
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(event.target.tagName) && [" ", "Backspace"].includes(event.key)) return;
  if (["SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
  if (event.target.tagName === "INPUT" && event.key.startsWith("Arrow")) return;
  const key = event.key.toLowerCase();
  const modes = { 1: "explore", 2: "validate", 3: "build" };
  const touring = state.tour !== null;
  if (modes[key]) setMode(modes[key]);
  else if (key === "g") touring ? exitTour() : showTour(0);
  else if (key === " " && touring) showTour(state.tour + 1);
  else if (key === "backspace" && touring) showTour(state.tour - 1);
  else if (key === "escape" && touring) exitTour();
  else if (key === "arrowright" && state.mode === "build") stepBuild(1);
  else if (key === "arrowleft" && state.mode === "build") stepBuild(-1);
  else if (key === "n") setLayer("normals", !state.visible.normals);
  else if (key === "h") setLayer("halfedges", !state.visible.halfedges);
  else if (key === "r") resetCamera();
  else return;
  event.preventDefault();
});

function resize() {
  const width = canvasWrap.clientWidth;
  const height = canvasWrap.clientHeight;
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvasWrap);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(animate);
}

refresh();
resize();
animate();

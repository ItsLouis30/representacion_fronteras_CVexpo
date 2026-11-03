import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import "./styles.css";

const canvas = document.querySelector("#brep-canvas");
const canvasWrap = document.querySelector("#canvas-wrap");

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

const state = {
  mode: "explore",
  model: "cube",
  defect: "valid",
  buildStep: 0,
  selectedFace: null,
  visible: {
    faces: true,
    edges: true,
    vertices: true,
    normals: false,
  },
};

const palette = {
  face: 0x75a9ca,
  faceSelected: 0xd2944c,
  faceInvalid: 0xca6c64,
  edge: 0x173b59,
  edgeInvalid: 0xb43e38,
  vertex: 0xcf7d31,
  normal: 0x2c7550,
  normalInvalid: 0xb43e38,
};

function cloneModel(model) {
  return {
    name: model.name,
    vertices: model.vertices.map((vertex) => [...vertex]),
    faces: model.faces.map((face) => [...face]),
    explicitEdges: model.explicitEdges?.map((edge) => [...edge]),
    forcedErrors: [...(model.forcedErrors ?? [])],
  };
}

function orientFaces(vertices, faces) {
  const center = vertices
    .map((point) => new THREE.Vector3(...point))
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .divideScalar(vertices.length || 1);

  return faces.map((face) => {
    if (face.length < 3) return [...face];
    const a = new THREE.Vector3(...vertices[face[0]]);
    const b = new THREE.Vector3(...vertices[face[1]]);
    const c = new THREE.Vector3(...vertices[face[2]]);
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    const faceCenter = face
      .map((index) => new THREE.Vector3(...vertices[index]))
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .divideScalar(face.length);
    return normal.dot(faceCenter.sub(center)) < 0 ? [...face].reverse() : [...face];
  });
}

const cubeVertices = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

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
    vertices: [[1.2, 1.1, 1.1], [-1.2, -1.1, 1.1], [-1.2, 1.1, -1.1], [1.2, -1.1, -1.1]],
    faces: [],
  },
  prism: {
    name: "Prisma triangular B-Rep",
    vertices: [[-1.25, -0.9, -1], [1.25, -0.9, -1], [0, 1.2, -1], [-1.25, -0.9, 1], [1.25, -0.9, 1], [0, 1.2, 1]],
    faces: [],
  },
};

models.tetrahedron.faces = orientFaces(models.tetrahedron.vertices, [
  [0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2],
]);
models.prism.faces = orientFaces(models.prism.vertices, [
  [0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5],
]);

const buildSteps = [
  {
    operator: "MVFS",
    title: "Crear estructura inicial",
    description: "Se crea el primer vértice, una cara y la envolvente inicial.",
    vertices: [cubeVertices[0]],
    edges: [],
    faces: [],
  },
  {
    operator: "MEV",
    title: "Añadir un vértice y una arista",
    description: "La primera arista conecta V1 con el nuevo vértice V2.",
    vertices: cubeVertices.slice(0, 2),
    edges: [[0, 1]],
    faces: [],
  },
  {
    operator: "MEV",
    title: "Extender el contorno",
    description: "Se incorpora V3 y una segunda arista al recorrido de la base.",
    vertices: cubeVertices.slice(0, 3),
    edges: [[0, 1], [1, 2]],
    faces: [],
  },
  {
    operator: "MEV",
    title: "Completar los vértices de la base",
    description: "Se crea V4 y la tercera arista del contorno inferior.",
    vertices: cubeVertices.slice(0, 4),
    edges: [[0, 1], [1, 2], [2, 3]],
    faces: [],
  },
  {
    operator: "MEF",
    title: "Cerrar la primera cara",
    description: "Una nueva arista cierra el ciclo y define la cara inferior.",
    vertices: cubeVertices.slice(0, 4),
    edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
    faces: [[0, 1, 2, 3]],
  },
  {
    operator: "MEV ×4",
    title: "Elevar el perfil",
    description: "Cuatro operaciones MEV crean los vértices superiores y las aristas verticales.",
    vertices: cubeVertices,
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 6], [3, 7]],
    faces: [[0, 1, 2, 3]],
  },
  {
    operator: "MEF ×4",
    title: "Crear las caras laterales",
    description: "Se cierran los cuatro contornos laterales y se completa el anillo superior.",
    vertices: cubeVertices,
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 6], [3, 7], [4, 5], [5, 6], [6, 7], [7, 4]],
    faces: orientFaces(cubeVertices, [[0, 1, 2, 3], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]),
  },
  {
    operator: "MEF",
    title: "Cerrar la envolvente",
    description: "La cara superior completa el prisma: la frontera queda cerrada y satisface Euler.",
    vertices: cubeVertices,
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 6], [3, 7], [4, 5], [5, 6], [6, 7], [7, 4]],
    faces: models.cube.faces,
  },
];

function modelForState() {
  if (state.mode === "build") {
    const step = buildSteps[state.buildStep];
    return {
      name: "Construcción de un prisma",
      vertices: step.vertices.map((vertex) => [...vertex]),
      faces: step.faces.map((face) => [...face]),
      explicitEdges: step.edges.map((edge) => [...edge]),
      forcedErrors: [],
      construction: true,
    };
  }

  const model = cloneModel(models[state.model]);
  if (state.mode !== "validate" || state.defect === "valid") return model;

  if (state.defect === "opening") {
    model.faces.splice(1, 1);
  }

  if (state.defect === "inverted") {
    model.faces[1] = [...model.faces[1]].reverse();
  }

  if (state.defect === "nonmanifold") {
    const edge = [model.faces[0][0], model.faces[0][1]];
    const a = new THREE.Vector3(...model.vertices[edge[0]]);
    const b = new THREE.Vector3(...model.vertices[edge[1]]);
    const midpoint = a.clone().add(b).multiplyScalar(0.5);
    model.vertices.push([midpoint.x, midpoint.y - 1.35, midpoint.z + 0.85]);
    model.faces.push([edge[1], edge[0], model.vertices.length - 1]);
  }

  if (state.defect === "degenerate") {
    model.faces[1] = [model.faces[1][0], model.faces[1][1], model.faces[1][1]];
  }

  if (state.defect === "selfintersection") {
    model.forcedErrors.push("Se detectó una autointersección entre regiones de la frontera.");
  }

  return model;
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function collectEdges(model) {
  const edgeMap = new Map();
  model.faces.forEach((face, faceIndex) => {
    face.forEach((vertex, index) => {
      const next = face[(index + 1) % face.length];
      const key = edgeKey(vertex, next);
      if (!edgeMap.has(key)) edgeMap.set(key, { a: Math.min(vertex, next), b: Math.max(vertex, next), uses: [] });
      edgeMap.get(key).uses.push({ faceIndex, from: vertex, to: next });
    });
  });

  (model.explicitEdges ?? []).forEach(([a, b]) => {
    const key = edgeKey(a, b);
    if (!edgeMap.has(key)) edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), uses: [] });
  });
  return edgeMap;
}

function polygonArea(vertices, face) {
  if (face.length < 3) return 0;
  const origin = new THREE.Vector3(...vertices[face[0]]);
  let areaVector = new THREE.Vector3();
  for (let index = 1; index < face.length - 1; index += 1) {
    const a = new THREE.Vector3(...vertices[face[index]]).sub(origin);
    const b = new THREE.Vector3(...vertices[face[index + 1]]).sub(origin);
    areaVector.add(new THREE.Vector3().crossVectors(a, b));
  }
  return areaVector.length() * 0.5;
}

function validateModel(model) {
  const edges = collectEdges(model);
  const referencedVertices = new Set();
  model.faces.forEach((face) => face.forEach((vertex) => referencedVertices.add(vertex)));
  (model.explicitEdges ?? []).forEach((edge) => edge.forEach((vertex) => referencedVertices.add(vertex)));
  if (model.vertices.length === 1) referencedVertices.add(0);

  const boundaryEdges = [...edges.values()].filter((edge) => edge.uses.length === 1);
  const nonManifoldEdges = [...edges.values()].filter((edge) => edge.uses.length > 2);
  const orientationErrors = [...edges.values()].filter((edge) => {
    if (edge.uses.length !== 2) return false;
    const [first, second] = edge.uses;
    return first.from === second.from && first.to === second.to;
  });
  const degenerateFaces = model.faces.filter((face) => new Set(face).size < 3 || polygonArea(model.vertices, face) < 1e-6);
  const chi = referencedVertices.size - edges.size + model.faces.length;
  const closed = model.faces.length > 0 && boundaryEdges.length === 0 && nonManifoldEdges.length === 0;
  const manifold = nonManifoldEdges.length === 0;
  const oriented = orientationErrors.length === 0;
  const geometryValid = degenerateFaces.length === 0 && model.forcedErrors.length === 0;
  const valid = closed && manifold && oriented && geometryValid && chi === 2;

  const checks = [
    {
      ok: closed,
      label: closed ? "Frontera cerrada: cada arista pertenece a dos caras." : `${boundaryEdges.length} arista(s) de frontera impiden el cierre.`,
    },
    {
      ok: manifold,
      label: manifold ? "Incidencia manifold: no hay aristas con más de dos caras." : `${nonManifoldEdges.length} arista(s) presentan incidencia non-manifold.`,
    },
    {
      ok: oriented,
      label: oriented ? "Orientación coherente entre caras adyacentes." : `${orientationErrors.length} arista(s) presentan orientación incompatible.`,
    },
    {
      ok: geometryValid,
      label: geometryValid ? "No se detectaron caras degeneradas ni autointersecciones." : degenerateFaces.length ? `${degenerateFaces.length} cara(s) degenerada(s) detectada(s).` : model.forcedErrors[0],
    },
    {
      ok: chi === 2,
      label: chi === 2 ? "La característica de Euler coincide con una superficie sin túneles." : `La característica de Euler obtenida es χ = ${chi}.`,
    },
  ];

  return {
    edges,
    vertices: referencedVertices.size,
    faces: model.faces.length,
    chi,
    valid,
    closed,
    checks,
  };
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

function faceNormal(vertices, face) {
  if (face.length < 3) return new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3(...vertices[face[0]]);
  for (let index = 1; index < face.length - 1; index += 1) {
    const b = new THREE.Vector3(...vertices[face[index]]);
    const c = new THREE.Vector3(...vertices[face[index + 1]]);
    const normal = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a));
    if (normal.lengthSq() > 1e-8) return normal.normalize();
  }
  return new THREE.Vector3(0, 1, 0);
}

function faceCenter(vertices, face) {
  if (!face.length) return new THREE.Vector3();
  return face
    .map((index) => new THREE.Vector3(...vertices[index]))
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .divideScalar(face.length);
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

let faceMeshes = [];

function renderModel() {
  clearModel();
  faceMeshes = [];
  const model = modelForState();
  const validation = validateModel(model);

  const faceGroup = new THREE.Group();
  faceGroup.name = "faces";
  model.faces.forEach((face, faceIndex) => {
    const invalidFace = state.mode === "validate" && (
      (state.defect === "inverted" && faceIndex === 1) ||
      (state.defect === "degenerate" && faceIndex === 1) ||
      (state.defect === "nonmanifold" && faceIndex === model.faces.length - 1)
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
    const center = faceCenter(model.vertices, face);
    const normalColor = invalidFace ? palette.normalInvalid : palette.normal;
    const arrow = new THREE.ArrowHelper(normal, center, 0.62, normalColor, 0.16, 0.1);
    arrow.name = "normal";
    arrow.visible = state.visible.normals;
    faceGroup.add(arrow);
  });
  faceGroup.visible = state.visible.faces;
  modelRoot.add(faceGroup);

  if (state.mode === "validate" && state.defect === "selfintersection") {
    makeSelfIntersectionVisual(faceGroup);
  }

  const edgeGroup = new THREE.Group();
  edgeGroup.name = "edges";
  const edgeMap = collectEdges(model);
  edgeMap.forEach((edge) => {
    const points = [
      new THREE.Vector3(...model.vertices[edge.a]),
      new THREE.Vector3(...model.vertices[edge.b]),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const invalid = state.mode === "validate" && (edge.uses.length !== 2 || state.defect === "inverted");
    const material = new THREE.LineBasicMaterial({ color: invalid ? palette.edgeInvalid : palette.edge });
    edgeGroup.add(new THREE.Line(geometry, material));
  });
  edgeGroup.visible = state.visible.edges;
  modelRoot.add(edgeGroup);

  const vertexGroup = new THREE.Group();
  vertexGroup.name = "vertices";
  const sphereGeometry = new THREE.SphereGeometry(0.075, 18, 18);
  model.vertices.forEach((vertex, index) => {
    const sphere = new THREE.Mesh(
      sphereGeometry.clone(),
      new THREE.MeshStandardMaterial({ color: palette.vertex, roughness: 0.55 }),
    );
    sphere.position.set(...vertex);
    sphere.userData = { type: "vertex", vertexIndex: index };
    vertexGroup.add(sphere);

    const labelElement = document.createElement("span");
    labelElement.className = "vertex-label";
    labelElement.textContent = `V${index + 1}`;
    const label = new CSS2DObject(labelElement);
    label.position.set(vertex[0], vertex[1] + 0.16, vertex[2]);
    vertexGroup.add(label);
  });
  vertexGroup.visible = state.visible.vertices;
  modelRoot.add(vertexGroup);

  updateInterface(model, validation);
}

function updateInterface(model, validation) {
  const buildMode = state.mode === "build";
  const completeBuild = buildMode && state.buildStep === buildSteps.length - 1;
  const statusBadge = document.querySelector("#status-badge");

  document.querySelector("#viewer-title").textContent = model.name;
  document.querySelector("#viewer-kicker").textContent = buildMode ? "Construcción incremental" : state.mode === "validate" ? "Modo de validación" : "Modo de exploración";

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

  document.querySelector("#metric-v").textContent = validation.vertices;
  document.querySelector("#metric-e").textContent = validation.edges.size;
  document.querySelector("#metric-f").textContent = validation.faces;
  document.querySelector("#metric-chi").textContent = validation.chi;
  document.querySelector("#euler-formula").textContent = `${validation.vertices} − ${validation.edges.size} + ${validation.faces} = ${validation.chi}`;

  const checkList = document.querySelector("#check-list");
  checkList.innerHTML = "";
  const checks = buildMode && !completeBuild
    ? [
        { ok: true, label: "La secuencia conserva referencias entre las entidades creadas." },
        { ok: false, label: "La frontera permanecerá abierta hasta crear la última cara." },
        { ok: true, label: `Operador activo: ${buildSteps[state.buildStep].operator}.` },
      ]
    : validation.checks;

  checks.forEach((check) => {
    const item = document.createElement("li");
    item.className = `check-item${check.ok ? "" : " is-failed"}`;
    item.innerHTML = `<span class="check-icon">${check.ok ? "✓" : "!"}</span><span>${check.label}</span>`;
    checkList.appendChild(item);
  });

  if (buildMode) updateBuildPanel();
}

function updateBuildPanel() {
  const step = buildSteps[state.buildStep];
  document.querySelector("#operator-name").textContent = step.operator;
  document.querySelector("#operator-title").textContent = step.title;
  document.querySelector("#operator-description").textContent = step.description;
  document.querySelector("#step-label").textContent = `Paso ${state.buildStep + 1} de ${buildSteps.length}`;
  document.querySelector("#progress-bar").style.width = `${((state.buildStep + 1) / buildSteps.length) * 100}%`;
  document.querySelector("#previous-step").disabled = state.buildStep === 0;
  const nextButton = document.querySelector("#next-step");
  nextButton.disabled = state.buildStep === buildSteps.length - 1;
  nextButton.textContent = state.buildStep === buildSteps.length - 2 ? "Completar modelo" : "Siguiente paso";
}

function setMode(mode) {
  state.mode = mode;
  state.selectedFace = null;
  document.querySelectorAll(".mode-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  document.querySelectorAll(".mode-section").forEach((section) => section.classList.toggle("is-hidden", section.dataset.section !== mode));
  renderModel();
  resetEntityDetails();
}

function resetEntityDetails() {
  document.querySelector("#entity-details").innerHTML = `
    <span class="entity-code">F1</span>
    <div>
      <strong>Consulta de entidades</strong>
      <p>Selecciona una cara para consultar sus vértices y aristas.</p>
    </div>
  `;
}

function selectFace(mesh) {
  faceMeshes.forEach((faceMesh) => faceMesh.material.color.setHex(faceMesh.userData.baseColor));
  mesh.material.color.setHex(palette.faceSelected);
  const model = modelForState();
  const { faceIndex, face } = mesh.userData;
  const edgeLabels = face.map((vertex, index) => {
    const next = face[(index + 1) % face.length];
    return `E(${vertex + 1},${next + 1})`;
  });
  document.querySelector("#entity-details").innerHTML = `
    <span class="entity-code">F${faceIndex + 1}</span>
    <div>
      <strong>Cara con ${face.length} vértices</strong>
      <p>Vértices: ${face.map((index) => `V${index + 1}`).join(", ")}.<br>Contorno: ${edgeLabels.join(", ")}.</p>
    </div>
  `;
  state.selectedFace = faceIndex;
  void model;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener("pointerdown", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(faceMeshes, false);
  if (hits.length) selectFace(hits[0].object);
});

document.querySelectorAll(".mode-tab").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

document.querySelector("#model-select").addEventListener("change", (event) => {
  state.model = event.target.value;
  state.defect = "valid";
  renderModel();
  resetEntityDetails();
});

document.querySelectorAll(".defect-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.defect = button.dataset.defect;
    state.model = "cube";
    document.querySelector("#model-select").value = "cube";
    document.querySelectorAll(".defect-button").forEach((item) => item.classList.toggle("is-active", item === button));
    renderModel();
    resetEntityDetails();
  });
});

const toggleMap = {
  "toggle-faces": "faces",
  "toggle-edges": "edges",
  "toggle-vertices": "vertices",
  "toggle-normals": "normals",
};

Object.entries(toggleMap).forEach(([id, property]) => {
  document.querySelector(`#${id}`).addEventListener("change", (event) => {
    state.visible[property] = event.target.checked;
    renderModel();
  });
});

document.querySelector("#previous-step").addEventListener("click", () => {
  state.buildStep = Math.max(0, state.buildStep - 1);
  renderModel();
});

document.querySelector("#next-step").addEventListener("click", () => {
  state.buildStep = Math.min(buildSteps.length - 1, state.buildStep + 1);
  renderModel();
});

document.querySelector("#reset-camera").addEventListener("click", () => {
  camera.position.set(5.6, 4.2, 6.4);
  controls.target.set(0, 0, 0);
  controls.update();
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

renderModel();
resize();
animate();

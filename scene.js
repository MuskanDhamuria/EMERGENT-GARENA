import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.004);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(45, 38, 45);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
document.body.appendChild(renderer.domElement);

// Load Inter font
const fontLink = document.createElement('link');
fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
fontLink.rel = 'stylesheet';
document.head.appendChild(fontLink);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minDistance = 15;
controls.maxDistance = 100;

// Lights - bright daytime
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfff5e0, 2.0);
dirLight.position.set(40, 60, 30);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 120;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xaaccff, 0.5);
fillLight.position.set(-30, 25, -20);
scene.add(fillLight);

const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x5a8a3c, 0.6);
scene.add(hemiLight);

// Grid configuration
const GRID_SIZE = 6;
const CELL_SIZE = 7;
const ROAD_WIDTH = 3;
const GRID_OFFSET = -(GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * ROAD_WIDTH) / 2 + CELL_SIZE / 2;

function getCellWorldPos(row, col) {
  const x = GRID_OFFSET + col * (CELL_SIZE + ROAD_WIDTH);
  const z = GRID_OFFSET + row * (CELL_SIZE + ROAD_WIDTH);
  return { x, z };
}

// Large green ground
const groundGeo = new THREE.PlaneGeometry(200, 200);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x6abf5e, roughness: 0.95, metalness: 0.0 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
ground.receiveShadow = true;
scene.add(ground);

// Outer grass hills
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  const dist = 55 + Math.random() * 20;
  const hillGeo = new THREE.SphereGeometry(6 + Math.random() * 8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x5aad4e + Math.floor(Math.random() * 0x102010), roughness: 1 });
  const hill = new THREE.Mesh(hillGeo, hillMat);
  hill.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
  hill.scale.y = 0.3 + Math.random() * 0.3;
  hill.receiveShadow = true;
  scene.add(hill);
}

// Grid cells (sidewalk-like pads)
const gridCells = [];
const gridGroup = new THREE.Group();
scene.add(gridGroup);

for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    const pos = getCellWorldPos(row, col);
    // Sidewalk base
    const cellGeo = new THREE.BoxGeometry(CELL_SIZE, 0.15, CELL_SIZE);
    const cellMat = new THREE.MeshStandardMaterial({
      color: 0x8cc878,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.9,
    });
    const cell = new THREE.Mesh(cellGeo, cellMat);
    cell.position.set(pos.x, 0.075, pos.z);
    cell.receiveShadow = true;
    cell.userData = { type: 'cell', row, col, occupied: false };
    gridCells.push(cell);
    gridGroup.add(cell);
  }
}

// Roads
const roadGroup = new THREE.Group();
scene.add(roadGroup);

const roadMat = new THREE.MeshStandardMaterial({ color: 0x6e6e78, roughness: 0.95 });
const dashMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 });
const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c0, roughness: 0.85 });

const totalSpan = GRID_SIZE * CELL_SIZE + (GRID_SIZE - 1) * ROAD_WIDTH;

// Horizontal roads (between rows)
for (let row = 0; row < GRID_SIZE - 1; row++) {
  const pos1 = getCellWorldPos(row, 0);
  const pos2 = getCellWorldPos(row + 1, 0);
  const roadZ = (pos1.z + pos2.z) / 2;
  const roadCenterX = (getCellWorldPos(0, 0).x + getCellWorldPos(0, GRID_SIZE - 1).x) / 2;

  // Road surface
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(totalSpan + ROAD_WIDTH * 2, 0.06, ROAD_WIDTH),
    roadMat
  );
  road.position.set(roadCenterX, 0.03, roadZ);
  road.receiveShadow = true;
  roadGroup.add(road);

  // Sidewalk edges
  for (let side = -1; side <= 1; side += 2) {
    const sw = new THREE.Mesh(
      new THREE.BoxGeometry(totalSpan + ROAD_WIDTH * 2, 0.12, 0.3),
      sidewalkMat
    );
    sw.position.set(roadCenterX, 0.06, roadZ + side * (ROAD_WIDTH / 2 + 0.15));
    sw.receiveShadow = true;
    roadGroup.add(sw);
  }

  // Dashed center line
  const dashCount = Math.floor((totalSpan + ROAD_WIDTH * 2) / 2.5);
  const startX = roadCenterX - (totalSpan + ROAD_WIDTH * 2) / 2;
  for (let d = 0; d < dashCount; d++) {
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.07, 0.15),
      dashMat
    );
    dash.position.set(startX + d * 2.5 + 1.25, 0.065, roadZ);
    roadGroup.add(dash);
  }
}

// Vertical roads (between columns)
for (let col = 0; col < GRID_SIZE - 1; col++) {
  const pos1 = getCellWorldPos(0, col);
  const pos2 = getCellWorldPos(0, col + 1);
  const roadX = (pos1.x + pos2.x) / 2;
  const roadCenterZ = (getCellWorldPos(0, 0).z + getCellWorldPos(GRID_SIZE - 1, 0).z) / 2;

  const road = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_WIDTH, 0.06, totalSpan + ROAD_WIDTH * 2),
    roadMat
  );
  road.position.set(roadX, 0.03, roadCenterZ);
  road.receiveShadow = true;
  roadGroup.add(road);

  for (let side = -1; side <= 1; side += 2) {
    const sw = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, totalSpan + ROAD_WIDTH * 2),
      sidewalkMat
    );
    sw.position.set(roadX + side * (ROAD_WIDTH / 2 + 0.15), 0.06, roadCenterZ);
    sw.receiveShadow = true;
    roadGroup.add(sw);
  }

  const dashCount = Math.floor((totalSpan + ROAD_WIDTH * 2) / 2.5);
  const startZ = roadCenterZ - (totalSpan + ROAD_WIDTH * 2) / 2;
  for (let d = 0; d < dashCount; d++) {
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.07, 1.2),
      dashMat
    );
    dash.position.set(roadX, 0.065, startZ + d * 2.5 + 1.25);
    roadGroup.add(dash);
  }
}

// Perimeter roads
const perimX = (getCellWorldPos(0, 0).x + getCellWorldPos(0, GRID_SIZE - 1).x) / 2;
const perimZ = (getCellWorldPos(0, 0).z + getCellWorldPos(GRID_SIZE - 1, 0).z) / 2;
const fullLen = totalSpan + ROAD_WIDTH * 4;

// Top & Bottom
for (let side = -1; side <= 1; side += 2) {
  const edgeZ = perimZ + side * (totalSpan / 2 + ROAD_WIDTH / 2 + CELL_SIZE / 2 - CELL_SIZE / 2 + ROAD_WIDTH);
  const edgeRoad = new THREE.Mesh(new THREE.BoxGeometry(fullLen, 0.06, ROAD_WIDTH), roadMat);
  edgeRoad.position.set(perimX, 0.03, perimZ + side * (totalSpan / 2 + ROAD_WIDTH * 0.5 + CELL_SIZE * 0.5));
  edgeRoad.receiveShadow = true;
  roadGroup.add(edgeRoad);
}
// Left & Right
for (let side = -1; side <= 1; side += 2) {
  const edgeRoad = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.06, fullLen), roadMat);
  edgeRoad.position.set(perimX + side * (totalSpan / 2 + ROAD_WIDTH * 0.5 + CELL_SIZE * 0.5), 0.03, perimZ);
  edgeRoad.receiveShadow = true;
  roadGroup.add(edgeRoad);
}

// Intersection squares
for (let row = 0; row < GRID_SIZE - 1; row++) {
  for (let col = 0; col < GRID_SIZE - 1; col++) {
    const p1 = getCellWorldPos(row, col);
    const p2 = getCellWorldPos(row + 1, col + 1);
    const ix = (p1.x + p2.x) / 2;
    const iz = (p1.z + p2.z) / 2;
    const inter = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_WIDTH + 0.2, 0.061, ROAD_WIDTH + 0.2),
      roadMat
    );
    inter.position.set(ix, 0.03, iz);
    inter.receiveShadow = true;
    roadGroup.add(inter);

    // Crosswalk markings
    for (let dir = 0; dir < 4; dir++) {
      for (let s = -2; s <= 2; s++) {
        const cw = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.2), dashMat);
        if (dir === 0) cw.position.set(ix + s * 0.7, 0.066, iz - ROAD_WIDTH / 2 - 0.1);
        else if (dir === 1) cw.position.set(ix + s * 0.7, 0.066, iz + ROAD_WIDTH / 2 + 0.1);
        else if (dir === 2) {
          cw.rotation.y = Math.PI / 2;
          cw.position.set(ix - ROAD_WIDTH / 2 - 0.1, 0.066, iz + s * 0.7);
        } else {
          cw.rotation.y = Math.PI / 2;
          cw.position.set(ix + ROAD_WIDTH / 2 + 0.1, 0.066, iz + s * 0.7);
        }
        roadGroup.add(cw);
      }
    }
  }
}

// Street trees along roads
function createStreetTree(x, z) {
  const tg = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.9 })
  );
  trunk.position.y = 0.6;
  trunk.castShadow = true;
  tg.add(trunk);

  const colors = [0x2d8a4e, 0x3a9d5c, 0x228844];
  for (let i = 0; i < 2; i++) {
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(0.55 - i * 0.1, 8, 6),
      new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)], roughness: 0.85 })
    );
    foliage.position.y = 1.4 + i * 0.4;
    foliage.castShadow = true;
    tg.add(foliage);
  }

  tg.position.set(x, 0, z);
  scene.add(tg);
  return tg;
}

// Place street trees along edges of blocks
for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    const pos = getCellWorldPos(row, col);
    if (Math.random() > 0.4) {
      createStreetTree(pos.x + CELL_SIZE / 2 + 0.8, pos.z + (Math.random() - 0.5) * 3);
    }
    if (Math.random() > 0.4) {
      createStreetTree(pos.x + (Math.random() - 0.5) * 3, pos.z + CELL_SIZE / 2 + 0.8);
    }
  }
}

// Street lamps
function createLamp(x, z) {
  const lg = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.06, 2.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.3 })
  );
  pole.position.y = 1.25;
  pole.castShadow = true;
  lg.add(pole);

  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xffeebb, emissiveIntensity: 0.3 })
  );
  lamp.position.y = 2.6;
  lg.add(lamp);

  lg.position.set(x, 0, z);
  scene.add(lg);
}

for (let row = 0; row < GRID_SIZE; row++) {
  const pos = getCellWorldPos(row, 0);
  createLamp(pos.x - CELL_SIZE / 2 - 1.2, pos.z);
  const pos2 = getCellWorldPos(row, GRID_SIZE - 1);
  createLamp(pos2.x + CELL_SIZE / 2 + 1.2, pos2.z);
}

// Cars on roads
const carColors = [0xe74c3c, 0x3498db, 0xf39c12, 0x2ecc71, 0x9b59b6, 0x1abc9c];
const cars = [];

function createCar(x, z, rotY) {
  const cg = new THREE.Group();
  const col = carColors[Math.floor(Math.random() * carColors.length)];

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.4, 0.6),
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.4 })
  );
  body.position.y = 0.35;
  body.castShadow = true;
  cg.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.3, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xaaddee, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.7 })
  );
  cabin.position.y = 0.65;
  cabin.position.x = -0.05;
  cg.add(cabin);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const positions = [[-0.35, 0.12, 0.3], [-0.35, 0.12, -0.3], [0.35, 0.12, 0.3], [0.35, 0.12, -0.3]];
  positions.forEach(p => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(...p);
    cg.add(w);
  });

  cg.position.set(x, 0, z);
  cg.rotation.y = rotY;
  cg.userData.speed = 2 + Math.random() * 3;
  cg.userData.direction = rotY;
  cg.userData.axis = Math.abs(Math.sin(rotY)) < 0.5 ? 'x' : 'z';
  scene.add(cg);
  cars.push(cg);
  return cg;
}

// Place cars on horizontal roads
for (let row = 0; row < GRID_SIZE - 1; row++) {
  const p1 = getCellWorldPos(row, 0);
  const p2 = getCellWorldPos(row + 1, 0);
  const roadZ = (p1.z + p2.z) / 2;
  if (Math.random() > 0.3) createCar(getCellWorldPos(0, Math.floor(Math.random() * GRID_SIZE)).x, roadZ + 0.5, 0);
  if (Math.random() > 0.3) createCar(getCellWorldPos(0, Math.floor(Math.random() * GRID_SIZE)).x, roadZ - 0.5, Math.PI);
}

// Place cars on vertical roads
for (let col = 0; col < GRID_SIZE - 1; col++) {
  const p1 = getCellWorldPos(0, col);
  const p2 = getCellWorldPos(0, col + 1);
  const roadX = (p1.x + p2.x) / 2;
  if (Math.random() > 0.3) createCar(roadX + 0.5, getCellWorldPos(Math.floor(Math.random() * GRID_SIZE), 0).z, Math.PI / 2);
  if (Math.random() > 0.3) createCar(roadX - 0.5, getCellWorldPos(Math.floor(Math.random() * GRID_SIZE), 0).z, -Math.PI / 2);
}

// Clouds
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);

function createCloud(x, y, z) {
  const cg = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const count = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const s = 1.5 + Math.random() * 2.5;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), cloudMat);
    puff.position.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 3);
    puff.scale.y = 0.5 + Math.random() * 0.3;
    cg.add(puff);
  }
  cg.position.set(x, y, z);
  cg.userData.speed = 0.3 + Math.random() * 0.5;
  cloudGroup.add(cg);
}

for (let i = 0; i < 8; i++) {
  createCloud(
    (Math.random() - 0.5) * 120,
    30 + Math.random() * 15,
    (Math.random() - 0.5) * 80
  );
}

// Block types with building generation - bright pastel colors
const BLOCK_TYPES = [
  { name: 'Skyscraper', color: 0xb0bec5, accent: 0x546e7a, height: [10, 18], style: 'tower' },
  { name: 'Office', color: 0x90a4ae, accent: 0x5c6bc0, height: [6, 11], style: 'office' },
  { name: 'Residential', color: 0xd7ccc8, accent: 0xc0876e, height: [3, 7], style: 'residential' },
  { name: 'Park', color: 0x66bb6a, accent: 0x388e3c, height: [0.3, 0.5], style: 'park' },
  { name: 'Commercial', color: 0xbcaaa4, accent: 0xe57373, height: [2.5, 5], style: 'commercial' },
  { name: 'Industrial', color: 0x9e9e9e, accent: 0x757575, height: [3.5, 6], style: 'industrial' },
];

const blocks = [];

function createWindows(width, height, depth, parent) {
  const windowRows = Math.max(1, Math.floor(height - 1));
  const windowCols = Math.max(1, Math.floor(width * 1.5));
  const windowGeo = new THREE.PlaneGeometry(0.35, 0.5);

  for (let side = 0; side < 4; side++) {
    for (let r = 0; r < windowRows; r++) {
      for (let c = 0; c < windowCols; c++) {
        const isLit = Math.random() > 0.25;
        const windowMat = new THREE.MeshStandardMaterial({
          color: isLit ? 0xfff9c4 : 0x90caf9,
          emissive: isLit ? 0xffe082 : 0x42a5f5,
          emissiveIntensity: isLit ? 0.15 : 0.05,
          roughness: 0.1,
          metalness: 0.3,
        });
        const win = new THREE.Mesh(windowGeo, windowMat);

        const yPos = 1 + r * 1;
        const spacing = (width * 0.8) / (windowCols + 1);

        if (side === 0) {
          win.position.set(-width / 2 + spacing * (c + 1), yPos, depth / 2 + 0.01);
        } else if (side === 1) {
          win.position.set(-width / 2 + spacing * (c + 1), yPos, -depth / 2 - 0.01);
          win.rotation.y = Math.PI;
        } else if (side === 2) {
          win.position.set(width / 2 + 0.01, yPos, -depth / 2 + spacing * (c + 1));
          win.rotation.y = Math.PI / 2;
        } else {
          win.position.set(-width / 2 - 0.01, yPos, -depth / 2 + spacing * (c + 1));
          win.rotation.y = -Math.PI / 2;
        }
        parent.add(win);
      }
    }
  }
}

function createBuilding(type, cellRow, cellCol) {
  const group = new THREE.Group();
  const config = BLOCK_TYPES[type];
  const h = config.height[0] + Math.random() * (config.height[1] - config.height[0]);

  if (config.style === 'park') {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(CELL_SIZE - 0.6, 0.25, CELL_SIZE - 0.6),
      new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.95 })
    );
    base.position.y = 0.125;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Path through park
    const path = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.26, CELL_SIZE - 1.5),
      new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 0.9 })
    );
    path.position.y = 0.13;
    path.receiveShadow = true;
    group.add(path);

    // Trees
    for (let i = 0; i < 6; i++) {
      const treeGroup = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.13, 1.0, 6),
        new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.9 })
      );
      trunk.position.y = 0.7;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      const foliageColors = [0x388e3c, 0x43a047, 0x2e7d32, 0x4caf50];
      const foliage = new THREE.Mesh(
        new THREE.SphereGeometry(0.5 + Math.random() * 0.35, 8, 6),
        new THREE.MeshStandardMaterial({ color: foliageColors[Math.floor(Math.random() * foliageColors.length)], roughness: 0.85 })
      );
      foliage.position.y = 1.5;
      foliage.castShadow = true;
      treeGroup.add(foliage);

      const topFoliage = new THREE.Mesh(
        new THREE.SphereGeometry(0.3 + Math.random() * 0.2, 8, 6),
        new THREE.MeshStandardMaterial({ color: foliageColors[Math.floor(Math.random() * foliageColors.length)], roughness: 0.85 })
      );
      topFoliage.position.y = 1.95;
      topFoliage.castShadow = true;
      treeGroup.add(topFoliage);

      let tx, tz;
      do {
        tx = (Math.random() - 0.5) * (CELL_SIZE - 2);
        tz = (Math.random() - 0.5) * (CELL_SIZE - 2);
      } while (Math.abs(tx) < 0.6);
      treeGroup.position.set(tx, 0.1, tz);
      group.add(treeGroup);
    }

    // Bench
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.15, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.8 })
    );
    bench.position.set(1.2, 0.45, 0.8);
    bench.castShadow = true;
    group.add(bench);

  } else if (config.style === 'tower') {
    // Main tower
    const w = 2 + Math.random() * 1.5;
    const d = 2 + Math.random() * 1.5;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.35, metalness: 0.4 })
    );
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Top section - stepped
    const topH = 2 + Math.random() * 2;
    const topW = w * 0.65;
    const topD = d * 0.65;
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(topW, topH, topD),
      new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.3, metalness: 0.5 })
    );
    top.position.y = h + topH / 2;
    top.castShadow = true;
    group.add(top);

    // Roof detail - random type
    const roofType = Math.floor(Math.random() * 3);
    if (roofType === 0) {
      // Pyramid top
      const pyramid = new THREE.Mesh(
        new THREE.ConeGeometry(topW * 0.6, 2, 4),
        new THREE.MeshStandardMaterial({ color: 0x78909c, metalness: 0.6, roughness: 0.2 })
      );
      pyramid.position.y = h + topH + 1;
      pyramid.rotation.y = Math.PI / 4;
      pyramid.castShadow = true;
      group.add(pyramid);
    } else if (roofType === 1) {
      // Flat top with antenna
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.06, 2.5, 4),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 })
      );
      antenna.position.y = h + topH + 1.25;
      group.add(antenna);

      const topLight = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 })
      );
      topLight.position.y = h + topH + 2.5;
      group.add(topLight);
    } else {
      // Dome
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(topW * 0.5, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: config.accent, metalness: 0.5, roughness: 0.3 })
      );
      dome.position.y = h + topH;
      dome.castShadow = true;
      group.add(dome);
    }

    createWindows(w, h, d, group);

  } else if (config.style === 'office') {
    const w = 2.5 + Math.random() * 1.5;
    const d = 2.5 + Math.random() * 1;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.3, metalness: 0.45 })
    );
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Rooftop box (AC unit style)
    const roofBox = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.4, 0.6, d * 0.4),
      new THREE.MeshStandardMaterial({ color: config.accent, roughness: 0.5, metalness: 0.3 })
    );
    roofBox.position.set(w * 0.15, h + 0.3, 0);
    roofBox.castShadow = true;
    group.add(roofBox);

    createWindows(w, h, d, group);

  } else if (config.style === 'residential') {
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const bh = h * (0.6 + Math.random() * 0.5);
      const bw = 1.8 + Math.random() * 0.8;
      const bd = 1.8 + Math.random() * 0.8;

      const colors = [0xd7ccc8, 0xe8d5b7, 0xc8b8a8, 0xbcaaa4, 0xdec8b0];
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)], roughness: 0.75, metalness: 0.05 })
      );
      building.position.set(
        (i - (count - 1) / 2) * 2.2,
        bh / 2,
        (Math.random() - 0.5) * 1
      );
      building.castShadow = true;
      building.receiveShadow = true;
      group.add(building);

      // Pitched roof
      const roofColors = [0xc0876e, 0xb06040, 0x9e6050, 0x7e8b72];
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(bw * 0.75, 1.2, 4),
        new THREE.MeshStandardMaterial({ color: roofColors[Math.floor(Math.random() * roofColors.length)], roughness: 0.8 })
      );
      roof.position.set(building.position.x, bh + 0.6, building.position.z);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);

      // Windows on residential
      const winGeo = new THREE.PlaneGeometry(0.4, 0.5);
      const winRows = Math.max(1, Math.floor(bh - 1));
      for (let r = 0; r < winRows; r++) {
        for (let c = 0; c < 2; c++) {
          const isLit = Math.random() > 0.3;
          const wMat = new THREE.MeshStandardMaterial({
            color: isLit ? 0xfff9c4 : 0x90caf9,
            emissive: isLit ? 0xffe082 : 0x000000,
            emissiveIntensity: isLit ? 0.1 : 0,
          });
          const w = new THREE.Mesh(winGeo, wMat);
          w.position.set(
            building.position.x - bw * 0.25 + c * bw * 0.5,
            0.8 + r * 1.0,
            building.position.z + bd / 2 + 0.01
          );
          group.add(w);

          const w2 = new THREE.Mesh(winGeo, wMat);
          w2.position.set(
            building.position.x - bw * 0.25 + c * bw * 0.5,
            0.8 + r * 1.0,
            building.position.z - bd / 2 - 0.01
          );
          w2.rotation.y = Math.PI;
          group.add(w2);
        }
      }
    }

  } else if (config.style === 'commercial') {
    const w = 3.5;
    const d = 3;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.6, metalness: 0.15 })
    );
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Storefront glass
    const storefront = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.4, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xb3e5fc, emissive: 0x81d4fa, emissiveIntensity: 0.15, roughness: 0.1, metalness: 0.3 })
    );
    storefront.position.set(0, 0.9, d / 2 + 0.01);
    group.add(storefront);

    // Awning
    const awningColors = [0xe57373, 0x64b5f6, 0x81c784, 0xffb74d];
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.4, 0.1, 1),
      new THREE.MeshStandardMaterial({ color: awningColors[Math.floor(Math.random() * awningColors.length)], roughness: 0.7 })
    );
    awning.position.set(0, 1.7, d / 2 + 0.5);
    awning.castShadow = true;
    group.add(awning);

    // Flat colored roof
    const roofPad = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.15, d + 0.2),
      new THREE.MeshStandardMaterial({ color: config.accent, roughness: 0.7 })
    );
    roofPad.position.y = h + 0.075;
    roofPad.castShadow = true;
    group.add(roofPad);

    // Striped awning detail
    for (let s = 0; s < 4; s++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.11, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
      );
      stripe.position.set(-w / 2 + 0.6 + s * (w / 4), 1.7, d / 2 + 0.5);
      group.add(stripe);
    }

  } else if (config.style === 'industrial') {
    const w = 3.5;
    const d = 3;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.85, metalness: 0.25 })
    );
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Chimney
    const chimney = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.4, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x757575, metalness: 0.5, roughness: 0.4 })
    );
    chimney.position.set(w / 2 - 0.6, h + 1.5, 0);
    chimney.castShadow = true;
    group.add(chimney);

    // Second chimney
    const chimney2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.3, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x616161, metalness: 0.5, roughness: 0.4 })
    );
    chimney2.position.set(w / 2 - 1.4, h + 1.1, 0.5);
    chimney2.castShadow = true;
    group.add(chimney2);

    // Corrugated wall detail
    for (let i = 0; i < 5; i++) {
      const ridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, h - 0.5, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.7 })
      );
      ridge.position.set(-w / 2 + 0.5 + i * 0.7, h / 2, d / 2 + 0.01);
      group.add(ridge);
    }

    // Roll-up door
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x616161, roughness: 0.7, metalness: 0.3 })
    );
    door.position.set(0, 1.0, d / 2 + 0.02);
    group.add(door);
  }

  const pos = getCellWorldPos(cellRow, cellCol);
  group.position.set(pos.x, 0, pos.z);

  group.userData = {
    type: 'block',
    blockType: type,
    row: cellRow,
    col: cellCol,
    typeName: config.name,
  };

  return group;
}

// Initial city layout
const initialLayout = [
  [0, 1, 3, 2, 4, 1],
  [2, 4, 1, 0, 3, 5],
  [3, 0, 5, 4, 1, 2],
  [1, 2, 4, 3, 5, 0],
  [5, 3, 2, 1, 0, 4],
  [4, 5, 0, 5, 2, 3],
];

for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    const blockType = initialLayout[row][col];
    const block = createBuilding(blockType, row, col);
    scene.add(block);
    blocks.push(block);

    const cellIndex = row * GRID_SIZE + col;
    gridCells[cellIndex].userData.occupied = true;
    gridCells[cellIndex].userData.blockId = blocks.length - 1;
  }
}

// Clock for animations
const clock = new THREE.Clock();

// Animate
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  controls.update();

  // Move clouds
  cloudGroup.children.forEach(cloud => {
    cloud.position.x += cloud.userData.speed * delta;
    if (cloud.position.x > 80) cloud.position.x = -80;
  });

  // Move cars
  const roadBound = totalSpan / 2 + ROAD_WIDTH * 2;
  cars.forEach(car => {
    const dir = car.userData.direction;
    const speed = car.userData.speed;
    car.position.x += Math.cos(dir) * speed * delta;
    car.position.z += Math.sin(dir) * speed * delta;

    // Wrap around
    if (car.position.x > roadBound + 5) car.position.x = -roadBound - 5;
    if (car.position.x < -roadBound - 5) car.position.x = roadBound + 5;
    if (car.position.z > roadBound + 5) car.position.z = -roadBound - 5;
    if (car.position.z < -roadBound - 5) car.position.z = roadBound + 5;
  });

  renderer.render(scene, camera);
}
animate();

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

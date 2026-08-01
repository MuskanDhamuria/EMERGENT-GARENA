import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { io } from 'socket.io-client';

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

// Emergent prototype layer
const WORLD_LIMIT = totalSpan / 2 + 10;
const input = new Set();
const playerGroup = new THREE.Group();
const botGroup = new THREE.Group();
const artifactGroup = new THREE.Group();
const mutationGroup = new THREE.Group();
scene.add(playerGroup, botGroup, artifactGroup, mutationGroup);

const memory = JSON.parse(localStorage.getItem('emergentMemory') || '{"sessions":0,"collected":0,"loner":0,"linked":0}');
memory.sessions += 1;
localStorage.setItem('emergentMemory', JSON.stringify(memory));

// The Game Master observes behaviour, never raw keystrokes or personal data.
// This compact session state is what is sent to the optional model endpoint.
const sessionSignals = {
  startedAt: performance.now(),
  lastUserPosition: new THREE.Vector3(0, 0, -10),
  movementDistance: 0,
  proximitySeconds: 0,
  isolationSeconds: 0,
  nearbyMovementSeconds: 0,
  visitedCells: new Set(),
};

function createNamePlate(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  ctx.font = 'bold 28px Inter, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(3.4, 0.85, 1);
  sprite.position.y = 2.5;
  return sprite;
}

function createPlayer(name, color, position, isUser = false) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 1.1, 6, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 })
  );
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.54, 0.16, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.2 })
  );
  visor.position.set(0, 1.22, 0.38);
  group.add(visor);

  const aura = new THREE.Mesh(
    new THREE.RingGeometry(0.65, 0.8, 28),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: isUser ? 0.42 : 0.22 })
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.04;
  group.add(aura);
  group.add(createNamePlate(name, `#${new THREE.Color(color).getHexString()}`));
  group.position.copy(position);
  return {
    name,
    color,
    mesh: group,
    health: 100,
    speed: isUser ? 8 : 4,
    isUser,
    wanderTarget: position.clone(),
    wanderTimer: 0,
    stillTimer: 0,
    followTimers: new Map(),
  };
}

const socket = io({ autoConnect: false });
const players = [];
const playersById = new Map();
let userPlayer = null;
let joined = false;
let roomState = null;
let lastInputSentAt = 0;
let announcedRuleKey = null;
let spectating = false;

const artifacts = [];
const artifactsByIndex = new Map();
function createArtifact(position, index) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45, 0),
    new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      emissive: 0x4c1d95,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.35,
    })
  );
  core.castShadow = true;
  group.add(core);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.025, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.65 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  group.position.copy(position);
  group.userData = { index, collected: false, followOffset: new THREE.Vector3() };
  artifactGroup.add(group);
  artifacts.push(group);
  artifactsByIndex.set(index, group);
}

const secretLayer = new THREE.Group();
secretLayer.visible = false;
mutationGroup.add(secretLayer);
for (let i = 0; i < 18; i++) {
  const marker = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.28, 0),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.48 })
  );
  marker.position.set(THREE.MathUtils.randFloatSpread(WORLD_LIMIT * 1.6), 2 + Math.random() * 4, THREE.MathUtils.randFloatSpread(WORLD_LIMIT * 1.6));
  secretLayer.add(marker);
}

const linkMaterial = new THREE.LineBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.85 });
const linkGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const tetherLine = new THREE.Line(linkGeometry, linkMaterial);
tetherLine.visible = false;
scene.add(tetherLine);

const ruleState = {
  linkedTo: null,
  artifactsAwake: false,
  alternateSight: false,
  distortion: false,
  collected: 0,
  lonelyTimer: 0,
  feed: [],
  activeRule: null,
  activeRuleEndsAt: 0,
  lastDecisionAt: -20,
  deciding: false,
  lastDecisionSource: 'watching',
  lastReason: 'The city is learning how this group moves.',
};

const RULE_LIBRARY = {
  bond: {
    id: 'bond',
    title: 'Unwanted Bond',
    body: 'Stay close to your bonded partner. If either of you strays too far, both of you continuously lose life.',
    duration: 70,
    counterplay: 'Stay within the pink tether range.',
  },
  archive: {
    id: 'archive',
    title: 'The Archive Demands Witnesses',
    body: 'You gathered too much alone. Keep another player near your archive, or its weight continuously drains your life.',
    duration: 65,
    counterplay: 'Bring a teammate within range of the collector.',
  },
  sight: {
    id: 'sight',
    title: 'Private Vision',
    body: 'The city shows you a hidden layer, but it needs solitude. Let someone get too close and your life continuously drains.',
    duration: 60,
    counterplay: 'The Seer must explore alone while guiding the group.',
  },
  ripple: {
    id: 'ripple',
    title: 'Restless Physics',
    body: 'Momentum has chosen you. Keep moving, or standing still continuously drains your life.',
    duration: 50,
    counterplay: 'The Runner must keep moving.',
  },
};

function makePanel(styles = '') {
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed; z-index: 20; font-family: Inter, system-ui, -apple-system, sans-serif;
    color: #18212f; pointer-events: none; ${styles}
  `;
  document.body.appendChild(panel);
  return panel;
}

const statusPanel = makePanel('top: 14px; left: 14px; width: 300px;');
const feedPanel = makePanel('left: 14px; bottom: 14px; width: min(380px, calc(100vw - 28px));');
const rulePanel = makePanel('right: 14px; top: 14px; width: min(330px, calc(100vw - 28px));');
const directorPanel = makePanel('right: 14px; bottom: 14px; width: min(330px, calc(100vw - 28px)); pointer-events: auto;');
let directorView = false;
let lastDirectorRender = 0;

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function pushFeed(text) {
  ruleState.feed.unshift({ text, time: 6 });
  ruleState.feed = ruleState.feed.slice(0, 4);
}

function announceRule(title, body, counterplay = '') {
  rulePanel.innerHTML = `
    <div style="background:linear-gradient(145deg, rgba(30,18,56,.96), rgba(16,23,47,.96)); color:#f8fafc; border:1px solid rgba(196,181,253,.35); border-radius:12px; padding:15px; box-shadow:0 10px 34px rgba(15,23,42,.32);">
      <div style="font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:#c4b5fd; font-weight:800;">Survival directive</div>
      <div style="font-size:18px; font-weight:800; margin-top:5px;">${escapeHtml(title)}</div>
      <div style="font-size:12px; line-height:1.5; color:#e2e8f0; margin-top:7px;">${escapeHtml(body)}</div>
      ${counterplay ? `<div style="margin-top:10px; padding:8px 9px; border-radius:7px; background:rgba(196,181,253,.13); font-size:11px; line-height:1.4; color:#ddd6fe;"><strong>Stay alive:</strong> ${escapeHtml(counterplay)}</div>` : ''}
    </div>
  `;
}

function updateHud() {
  if (!joined || !userPlayer) {
    statusPanel.innerHTML = '';
    feedPanel.innerHTML = '';
    return;
  }
  const linked = ruleState.linkedTo ? ruleState.linkedTo.name : 'none';
  const activeRule = roomState?.activeRule?.title || (ruleState.activeRule ? RULE_LIBRARY[ruleState.activeRule].title : 'None yet');
  const healthReadout = `<br>Life: ${Math.max(0, Math.round(userPlayer.health))}%`;
  const survivalText = userPlayer.dead ? 'You died. The city remembers.' : 'Survive. Follow the city\'s rule.';
  statusPanel.innerHTML = `
    <div style="background: rgba(255,255,255,0.84); border: 1px solid rgba(15,23,42,0.10); border-radius: 8px; padding: 11px 13px; box-shadow: 0 4px 18px rgba(15,23,42,0.12);">
      <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; color: #7c3aed;">Emergent · Room ${escapeHtml(roomState?.code || '')}</div>
      <div style="font-size: 14px; font-weight: 700; color: #334155; margin-top: 3px;">${escapeHtml(survivalText)}</div>
      <div style="font-size: 11px; color: #64748b; line-height: 1.5; margin-top: 6px;">Current rule: ${escapeHtml(activeRule)}<br>Connection: ${escapeHtml(linked)}${healthReadout}</div>
    </div>
  `;
  const activeRuleObject = roomState?.activeRule;
  const targets = activeRuleObject?.participants.map((id) => playersById.get(id)?.name).filter(Boolean) || [];
  const youAreTarget = activeRuleObject?.participants.includes(socket.id);
  const health = Math.max(0, Math.round(userPlayer.health));
  const healthColor = health > 60 ? '#34d399' : health > 30 ? '#fbbf24' : '#fb7185';
  const timeLeft = activeRuleObject ? Math.max(0, Math.ceil((activeRuleObject.endsAt - Date.now()) / 1000)) : null;
  const party = roomState?.players || [];
  statusPanel.innerHTML = `
    <div style="background:rgba(12,18,35,.88); color:#f8fafc; border:1px solid rgba(148,163,184,.2); border-radius:12px; padding:14px; box-shadow:0 10px 34px rgba(15,23,42,.28);">
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:#c4b5fd; font-weight:800;"><span>Emergent</span><span>Room ${escapeHtml(roomState?.code || '')}</span></div>
      <div style="font-size:16px; font-weight:800; margin-top:7px;">${userPlayer.dead ? 'You became city memory' : 'Stay alive.'}</div>
      <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:11px; color:#cbd5e1;"><span>YOUR LIFE</span><strong style="color:${healthColor}">${health}%</strong></div>
      <div style="height:7px; background:rgba(148,163,184,.2); border-radius:999px; overflow:hidden; margin-top:5px;"><div style="height:100%; width:${health}%; background:${healthColor}; border-radius:999px;"></div></div>
      <div style="margin-top:12px; padding:9px; border-radius:8px; background:${activeRuleObject ? 'rgba(124,58,237,.18)' : 'rgba(148,163,184,.10)'}; font-size:11px; line-height:1.45; color:#e2e8f0;">
        <strong style="color:#c4b5fd; text-transform:uppercase; letter-spacing:.06em; font-size:9px;">${activeRuleObject ? (youAreTarget ? 'Rule affecting you' : 'Help your team') : 'The city is observing'}</strong><br>
        ${activeRuleObject ? escapeHtml(youAreTarget ? activeRuleObject.counterplay : `${targets.join(' and ')}: ${activeRuleObject.counterplay}`) : 'Your group\'s behaviour will become the next survival rule.'}
        ${timeLeft !== null ? `<span style="float:right; color:#ddd6fe; font-weight:700;">${timeLeft}s</span>` : ''}
      </div>
      <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:11px;">${party.map((player) => `<span style="padding:4px 6px; border-radius:999px; background:${player.dead ? 'rgba(248,113,113,.2)' : 'rgba(255,255,255,.08)'}; color:${player.dead ? '#fda4af' : '#cbd5e1'}; font-size:10px;">${escapeHtml(player.name)} ${player.dead ? '†' : ''}</span>`).join('')}</div>
    </div>`;
  feedPanel.innerHTML = ruleState.feed.map(item => `
    <div style="background: rgba(15,23,42,0.74); color: #f8fafc; border-radius: 8px; padding: 9px 11px; margin-top: 7px; font-size: 12px; line-height: 1.35;">
      ${item.text}
    </div>
  `).join('');
  updateDirectorView();
}

function updateDirectorView(force = false) {
  if (!force && performance.now() - lastDirectorRender < 350) return;
  lastDirectorRender = performance.now();
  if (!directorView) {
    directorPanel.innerHTML = `<button id="director-toggle" style="border: 0; border-radius: 999px; background: rgba(15,23,42,0.78); color: white; padding: 8px 11px; font: 600 11px Inter, system-ui; cursor: pointer;">Director view</button>`;
  } else {
    const telemetry = getTelemetry(clock.getElapsedTime());
    directorPanel.innerHTML = `
      <div style="background: rgba(15,23,42,0.90); color: #e2e8f0; border-radius: 10px; padding: 12px; box-shadow: 0 8px 28px rgba(15,23,42,0.28); font-size: 11px; line-height: 1.55;">
        <div style="display:flex; justify-content:space-between; gap:10px; color:#c4b5fd; font-weight:700; letter-spacing:.07em; text-transform:uppercase;">
          <span>AI Director</span><button id="director-toggle" style="border:0; background:transparent; color:#cbd5e1; font:inherit; cursor:pointer;">close</button>
        </div>
        <div style="margin-top:7px; color:#f8fafc;">${escapeHtml(ruleState.lastReason)}</div>
        <div style="margin-top:7px; color:#94a3b8;">Source: ${escapeHtml(ruleState.lastDecisionSource)} · Cohesion ${telemetry.cohesion} · Exploration ${telemetry.exploration} · Collection ${telemetry.hoarding}</div>
        <div style="margin-top:5px; color:#94a3b8;">Signals are converted into bounded mechanics; the model cannot write game code.</div>
      </div>`;
  }
  document.getElementById('director-toggle')?.addEventListener('click', () => { directorView = !directorView; updateDirectorView(true); });
}

const lobby = document.createElement('div');
lobby.style.cssText = 'position:fixed; inset:0; z-index:40; display:grid; place-items:center; padding:20px; background:linear-gradient(145deg, rgba(8,15,30,.82), rgba(26,12,46,.74)); font-family:Inter,system-ui,sans-serif;';
lobby.innerHTML = `
  <form id="lobby-form" style="width:min(420px,100%); background:rgba(255,255,255,.96); border-radius:16px; padding:28px; box-shadow:0 18px 65px rgba(0,0,0,.35);">
    <div style="font-size:11px; color:#7c3aed; font-weight:800; letter-spacing:.12em; text-transform:uppercase;">Emergent · survival room</div>
    <h1 style="font-size:29px; margin:8px 0 7px; color:#172033;">The city watches friends.</h1>
    <p style="font-size:13px; line-height:1.5; color:#64748b; margin:0 0 20px;">Stay alive. The director observes your group and activates only prebuilt survival rules.</p>
    <label style="display:block; font-size:12px; font-weight:700; color:#334155; margin:12px 0 5px;">Your name</label>
    <input id="player-name" required maxlength="16" value="Player" style="width:100%; padding:11px 12px; border:1px solid #cbd5e1; border-radius:8px; font:inherit;" />
    <label style="display:block; font-size:12px; font-weight:700; color:#334155; margin:12px 0 5px;">Room code</label>
    <input id="room-code" required maxlength="6" value="${Math.random().toString(36).slice(2, 6).toUpperCase()}" style="width:100%; padding:11px 12px; border:1px solid #cbd5e1; border-radius:8px; font:700 16px ui-monospace,monospace; letter-spacing:.12em; text-transform:uppercase;" />
    <button type="submit" style="width:100%; margin-top:18px; padding:12px; border:0; border-radius:8px; background:#6d28d9; color:white; font:700 14px Inter,system-ui; cursor:pointer;">Enter room</button>
    <div id="lobby-error" style="min-height:18px; margin-top:10px; color:#dc2626; font-size:12px;"></div>
    <div style="margin-top:12px; font-size:11px; line-height:1.45; color:#64748b;">Share this room code with up to three friends. Everyone uses the same link, then enters the same code.</div>
  </form>`;
document.body.appendChild(lobby);

const deathOverlay = document.createElement('div');
deathOverlay.style.cssText = 'position:fixed; inset:0; z-index:50; display:none; place-items:center; padding:20px; background:radial-gradient(circle at 50% 35%, rgba(127,29,29,.52), rgba(2,6,23,.94) 58%); font-family:Inter,system-ui,sans-serif;';
deathOverlay.innerHTML = `
  <section style="width:min(460px,100%); text-align:center; color:#f8fafc;">
    <div style="font-size:11px; color:#fda4af; font-weight:800; letter-spacing:.16em; text-transform:uppercase;">City memory recorded</div>
    <h1 style="font-size:44px; line-height:1; margin:13px 0 10px; letter-spacing:-.05em;">YOU DIED</h1>
    <p id="death-copy" style="margin:0 auto; max-width:350px; color:#cbd5e1; font-size:14px; line-height:1.55;"></p>
    <div style="display:flex; gap:10px; justify-content:center; margin-top:24px; flex-wrap:wrap;">
      <button id="spectate-button" style="border:0; border-radius:8px; padding:11px 15px; background:#ddd6fe; color:#312e81; font:800 13px Inter,system-ui; cursor:pointer;">Spectate survivors</button>
      <button id="leave-button" style="border:1px solid rgba(226,232,240,.32); border-radius:8px; padding:11px 15px; background:transparent; color:#f8fafc; font:700 13px Inter,system-ui; cursor:pointer;">Leave room</button>
    </div>
  </section>`;
document.body.appendChild(deathOverlay);

function showDeathScreen(name) {
  deathOverlay.style.display = 'grid';
  document.getElementById('death-copy').textContent = `${name} did not survive the city. Your friends are still playing—watch them adapt, or leave to start another room.`;
}

document.getElementById('spectate-button').addEventListener('click', () => {
  spectating = true;
  deathOverlay.style.display = 'none';
  pushFeed('Spectating survivors. The city is still watching.');
});
document.getElementById('leave-button').addEventListener('click', () => {
  socket.disconnect();
  window.location.reload();
});

const lobbyForm = document.getElementById('lobby-form');
const lobbyError = document.getElementById('lobby-error');
lobbyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('player-name').value;
  const roomCode = document.getElementById('room-code').value;
  lobbyError.textContent = 'Connecting to the city...';
  socket.connect();
  socket.emit('join-room', { name, roomCode }, (result) => {
    if (!result?.ok) { lobbyError.textContent = result?.error || 'Unable to enter this room.'; return; }
    joined = true;
    lobby.remove();
    pushFeed(`Connected to room ${result.code}. Survive together.`);
  });
});

socket.on('world-state', syncWorldState);
socket.on('gm-rule', (rule) => {
  roomState = { ...(roomState || {}), activeRule: rule };
  applyNetworkRule(rule);
});
socket.on('feed', pushFeed);
socket.on('player-died', ({ id, name }) => {
  if (id === socket.id) showDeathScreen(name);
  else pushFeed(`${name} did not survive the city.`);
});
socket.on('connect_error', () => { lobbyError.textContent = 'Could not reach the game server. Check the shared link and try again.'; });
socket.on('disconnect', () => { if (joined) pushFeed('Connection lost. Rejoin the room to continue.'); });

function triggerLink(target, decision = RULE_LIBRARY.bond) {
  if (ruleState.linkedTo) return;
  ruleState.linkedTo = target;
  memory.linked += 1;
  localStorage.setItem('emergentMemory', JSON.stringify(memory));
  pushFeed(`You kept close to ${target.name}. The world calls it attachment.`);
  announceRule(decision.title, decision.body);
  tetherLine.visible = true;
}

function awakenArtifacts(decision = RULE_LIBRARY.archive) {
  if (ruleState.artifactsAwake) return;
  ruleState.artifactsAwake = true;
  memory.collected += ruleState.collected;
  localStorage.setItem('emergentMemory', JSON.stringify(memory));
  pushFeed('The artifacts remember being gathered.');
  announceRule(decision.title, decision.body);
  artifacts.filter(a => a.userData.collected).forEach((artifact, index) => {
    artifact.userData.followOffset.set(Math.cos(index) * 1.6, 1.1 + index * 0.08, Math.sin(index) * 1.6);
  });
}

function grantAlternateSight(decision = RULE_LIBRARY.sight) {
  if (ruleState.alternateSight) return;
  ruleState.alternateSight = true;
  memory.loner += 1;
  localStorage.setItem('emergentMemory', JSON.stringify(memory));
  scene.fog.color.set(0xa5f3fc);
  secretLayer.visible = true;
  pushFeed('The quiet player sees the city underneath the city.');
  announceRule(decision.title, decision.body);
}

function triggerDistortion(decision = RULE_LIBRARY.ripple) {
  if (ruleState.distortion) return;
  ruleState.distortion = true;
  pushFeed('The city notices repeated motion and loosens its physics.');
  announceRule(decision.title, decision.body);
}

function getNearestBot() {
  return players.slice(1).reduce((nearest, bot) => {
    const distance = userPlayer.mesh.position.distanceTo(bot.mesh.position);
    return !nearest || distance < nearest.distance ? { bot, distance } : nearest;
  }, null);
}

function updateBehaviourSignals(delta) {
  const movement = userPlayer.mesh.position.distanceTo(sessionSignals.lastUserPosition);
  sessionSignals.movementDistance += movement;
  sessionSignals.lastUserPosition.copy(userPlayer.mesh.position);
  const nearest = getNearestBot();
  if (nearest?.distance < 8) sessionSignals.proximitySeconds += delta;
  if (nearest?.distance > 17) sessionSignals.isolationSeconds += delta;
  if (nearest?.distance < 6 && movement > delta * 2) sessionSignals.nearbyMovementSeconds += delta;

  const cellX = Math.floor((userPlayer.mesh.position.x + WORLD_LIMIT) / 9);
  const cellZ = Math.floor((userPlayer.mesh.position.z + WORLD_LIMIT) / 9);
  sessionSignals.visitedCells.add(`${cellX}:${cellZ}`);
}

function getTelemetry(elapsed) {
  if (roomState?.director?.telemetry) {
    const telemetry = roomState.director.telemetry;
    return {
      cohesion: telemetry.averageCohesion ?? 0,
      exploration: telemetry.explorers ?? 0,
      hoarding: telemetry.totalArtifactsCollected ?? 0,
    };
  }
  const sessionSeconds = Math.max(1, elapsed);
  return {
    sessionSeconds: Math.round(sessionSeconds),
    playersObserved: players.length,
    cohesion: Number(THREE.MathUtils.clamp(sessionSignals.proximitySeconds / sessionSeconds, 0, 1).toFixed(2)),
    exploration: Number(THREE.MathUtils.clamp(sessionSignals.visitedCells.size / 8, 0, 1).toFixed(2)),
    hoarding: ruleState.collected,
    isolation: Number(THREE.MathUtils.clamp(sessionSignals.isolationSeconds / sessionSeconds, 0, 1).toFixed(2)),
    sharedMomentum: Number(THREE.MathUtils.clamp(sessionSignals.nearbyMovementSeconds / sessionSeconds, 0, 1).toFixed(2)),
    activeRule: ruleState.activeRule,
  };
}

function getRuleCandidates(telemetry) {
  const candidates = [];
  const nearest = getNearestBot();
  if (telemetry.cohesion >= 0.28 && nearest?.distance < 9) candidates.push({ ...RULE_LIBRARY.bond, observedPattern: 'Two players repeatedly remain close.' });
  if (telemetry.hoarding >= 2) candidates.push({ ...RULE_LIBRARY.archive, observedPattern: 'One player repeatedly gathers objects.' });
  if (telemetry.isolation >= 0.22 || telemetry.exploration >= 0.38) candidates.push({ ...RULE_LIBRARY.sight, observedPattern: 'A player separates from the group to explore.' });
  if (telemetry.sharedMomentum >= 0.16 && telemetry.hoarding >= 1) candidates.push({ ...RULE_LIBRARY.ripple, observedPattern: 'A player moves urgently near the group.' });
  return candidates;
}

function clearActiveRule(message = '') {
  const endedRule = ruleState.activeRule;
  if (!endedRule) return;
  if (endedRule === 'bond') { ruleState.linkedTo = null; tetherLine.visible = false; }
  if (endedRule === 'archive') ruleState.artifactsAwake = false;
  if (endedRule === 'sight') { ruleState.alternateSight = false; secretLayer.visible = false; scene.fog.color.set(0x87CEEB); }
  if (endedRule === 'ripple') ruleState.distortion = false;
  ruleState.activeRule = null;
  ruleState.activeRuleEndsAt = 0;
  rulePanel.innerHTML = '';
  if (message) pushFeed(message);
}

function syncPlayers(serverPlayers) {
  const activeIds = new Set(serverPlayers.map((player) => player.id));
  for (const player of [...players]) {
    if (!activeIds.has(player.id)) {
      player.mesh.parent?.remove(player.mesh);
      playersById.delete(player.id);
      players.splice(players.indexOf(player), 1);
    }
  }
  serverPlayers.forEach((state) => {
    let player = playersById.get(state.id);
    if (!player) {
      player = createPlayer(state.name, state.color, new THREE.Vector3(state.x, 0, state.z), state.id === socket.id);
      player.id = state.id;
      playersById.set(state.id, player);
      players.push(player);
      (player.isUser ? playerGroup : botGroup).add(player.mesh);
    }
    player.health = state.health;
    player.dead = state.dead;
    player.artifactCount = state.artifactCount;
    player.mesh.position.lerp(new THREE.Vector3(state.x, 0, state.z), player.isUser ? 0.42 : 0.28);
    player.mesh.visible = true;
  });
  userPlayer = playersById.get(socket.id) || userPlayer;
}

function syncArtifacts(serverArtifacts) {
  serverArtifacts.forEach((state) => {
    let artifact = artifactsByIndex.get(state.index);
    if (!artifact) {
      createArtifact(new THREE.Vector3(state.x, 0.75, state.z), state.index);
      artifact = artifactsByIndex.get(state.index);
    }
    artifact.userData.collected = Boolean(state.collectedBy);
    artifact.userData.ownerId = state.collectedBy;
    if (!state.collectedBy) {
      artifact.position.x = state.x;
      artifact.position.z = state.z;
      artifact.children[0].material.color.set(0x7c3aed);
      artifact.children[0].material.emissive.set(0x4c1d95);
    } else {
      artifact.children[0].material.color.set(0xfacc15);
      artifact.children[0].material.emissive.set(0x854d0e);
    }
  });
}

function applyNetworkRule(rule) {
  const key = rule ? `${rule.id}:${rule.endsAt}` : null;
  players.forEach((player) => {
    const aura = player.mesh.children[2];
    if (aura?.material?.color) {
      aura.material.color.set(rule?.participants.includes(player.id) ? 0xf43f5e : player.color);
      aura.material.opacity = rule?.participants.includes(player.id) ? 0.72 : (player.isUser ? 0.42 : 0.22);
    }
  });
  if (key === announcedRuleKey) return;
  announcedRuleKey = key;
  clearActiveRule();
  if (!rule) return;
  ruleState.activeRule = rule.id;
  ruleState.activeRuleEndsAt = rule.endsAt;
  ruleState.lastDecisionSource = roomState?.director?.source || 'room Game Master';
  ruleState.lastReason = roomState?.director?.reason || 'The Game Master made a room decision.';
  const affected = rule.participants.includes(socket.id);
  if (rule.id === 'bond' && affected) {
    const partnerId = rule.participants.find((id) => id !== socket.id);
    ruleState.linkedTo = playersById.get(partnerId) || null;
    tetherLine.visible = Boolean(ruleState.linkedTo);
  }
  if (rule.id === 'archive') ruleState.artifactsAwake = true;
  if (rule.id === 'sight') {
    ruleState.alternateSight = affected;
    secretLayer.visible = affected;
    scene.fog.color.set(affected ? 0xa5f3fc : 0x87CEEB);
  }
  if (rule.id === 'ripple') ruleState.distortion = true;
  const selectedNames = rule.participants.map((id) => playersById.get(id)?.name).filter(Boolean).join(' and ');
  announceRule(rule.title, affected ? rule.body : `${selectedNames || 'A teammate'} is affected. ${rule.counterplay}`, rule.counterplay);
}

function syncWorldState(state) {
  roomState = state;
  ruleState.lastDecisionSource = state.director?.source || ruleState.lastDecisionSource;
  ruleState.lastReason = state.director?.reason || ruleState.lastReason;
  syncPlayers(state.players);
  syncArtifacts(state.artifacts);
  applyNetworkRule(state.activeRule);
}

function applyGameMasterDecision(decision, elapsed) {
  const rule = RULE_LIBRARY[decision.ruleId];
  if (!rule) return;
  clearActiveRule();
  ruleState.activeRule = rule.id;
  ruleState.activeRuleEndsAt = elapsed + rule.duration;
  ruleState.lastDecisionSource = decision.source === 'model' ? 'configured AI model' : 'local Game Master fallback';
  ruleState.lastReason = decision.reason || 'The Game Master found a new group pattern.';
  if (rule.id === 'bond') triggerLink(getNearestBot()?.bot, decision);
  if (rule.id === 'archive') awakenArtifacts(decision);
  if (rule.id === 'sight') grantAlternateSight(decision);
  if (rule.id === 'ripple') triggerDistortion(decision);
}

async function askGameMaster(elapsed) {
  if (ruleState.deciding || ruleState.activeRule || elapsed - ruleState.lastDecisionAt < 14) return;
  const telemetry = getTelemetry(elapsed);
  const candidates = getRuleCandidates(telemetry);
  if (!candidates.length) {
    ruleState.lastReason = 'The Game Master is still looking for a distinct group pattern.';
    return;
  }
  ruleState.deciding = true;
  ruleState.lastDecisionAt = elapsed;
  try {
    const response = await fetch('/api/game-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telemetry, candidates: candidates.map(({ id, title, body, counterplay, observedPattern }) => ({ id, title, body, counterplay, observedPattern })) }),
    });
    if (!response.ok) throw new Error('Game Master endpoint unavailable');
    applyGameMasterDecision(await response.json(), elapsed);
  } catch {
    // A self-contained prototype is more reliable during a demo than a hard dependency on a network service.
    applyGameMasterDecision({ ruleId: candidates[0].id, ...candidates[0], source: 'fallback', reason: candidates[0].observedPattern }, elapsed);
  } finally {
    ruleState.deciding = false;
  }
}

function updateUser(delta) {
  if (!joined || !userPlayer || userPlayer.dead) return;
  const move = new THREE.Vector3();
  if (input.has('KeyW') || input.has('ArrowUp')) move.z -= 1;
  if (input.has('KeyS') || input.has('ArrowDown')) move.z += 1;
  if (input.has('KeyA') || input.has('ArrowLeft')) move.x -= 1;
  if (input.has('KeyD') || input.has('ArrowRight')) move.x += 1;
  if (move.lengthSq() > 0) {
    move.normalize();
    userPlayer.mesh.rotation.y = Math.atan2(move.x, move.z);
  }
  if (performance.now() - lastInputSentAt > 75) {
    socket.emit('move', { x: move.x, z: move.z });
    lastInputSentAt = performance.now();
  }
}

function updateBots() {}

function updateArtifacts(delta, elapsed) {
  artifacts.forEach((artifact, index) => {
    artifact.rotation.y += delta * 1.6;
    artifact.children[1].rotation.z += delta * 2;
    artifact.position.y = 0.75 + Math.sin(elapsed * 2 + index) * 0.12;
    const archiveRule = roomState?.activeRule?.id === 'archive';
    const owner = playersById.get(artifact.userData.ownerId);
    artifact.visible = !artifact.userData.collected || (archiveRule && Boolean(owner));
    if (artifact.userData.collected && archiveRule && owner) {
      const offset = new THREE.Vector3(Math.cos(index * 2.2) * 1.55, 1.0 + (index % 3) * 0.15, Math.sin(index * 2.2) * 1.55);
      const target = owner.mesh.position.clone().add(offset);
      artifact.position.lerp(target, 1 - Math.pow(0.001, delta));
    }
  });
}

function updateGameMaster(delta) {
  if (!joined || !userPlayer) return;
  if (ruleState.linkedTo) {
    const points = tetherLine.geometry.attributes.position;
    points.setXYZ(0, userPlayer.mesh.position.x, 1.4, userPlayer.mesh.position.z);
    points.setXYZ(1, ruleState.linkedTo.mesh.position.x, 1.4, ruleState.linkedTo.mesh.position.z);
    points.needsUpdate = true;
  }

  ruleState.feed.forEach(item => item.time -= delta);
  ruleState.feed = ruleState.feed.filter(item => item.time > 0);
}

function updateCamera() {
  if (!userPlayer) return;
  const survivor = spectating ? players.find((player) => !player.dead && player.id !== socket.id) : null;
  const target = (survivor || userPlayer).mesh.position;
  const desired = target.clone().add(new THREE.Vector3(18, 18, 18));
  camera.position.lerp(desired, 0.035);
  controls.target.lerp(target, 0.08);
}

window.addEventListener('keydown', (event) => input.add(event.code));
window.addEventListener('keyup', (event) => input.delete(event.code));
updateHud();

// Clock for animations
const clock = new THREE.Clock();

// Animate
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  updateUser(delta);
  updateBots(delta);
  updateArtifacts(delta, elapsed);
  updateGameMaster(delta, elapsed);
  updateCamera();
  updateHud();
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

const SPECIES_CONFIGS = {
  1: { 
    Hm: 30, 
    a: 75,  
    c: 600, 
    m: 2.0, 
    n: 1.0, 
    rho_s: 0.6 
  },
  2: { 
    Hm: 24, 
    a: 110, 
    c: 450, 
    m: 1.8, 
    n: 1.5, 
    rho_s: 0.5 
  },
  3: { 
    Hm: 17, 
    a: 100, 
    c: 800, 
    m: 2.2, 
    n: 1.2, 
    rho_s: 0.7 
  }
};

// PlantFATE Math
class PlantFATEMath {
  constructor(basalDiameter, speciesId = 1) {
    const config = SPECIES_CONFIGS[speciesId] ?? SPECIES_CONFIGS[1];
    Object.assign(this, config);

    this.D = Number(basalDiameter);
    if (!Number.isFinite(this.D) || this.D <= 0) {
      this.D = 0;
    }

    // Precompute height, crown area, max crown radius
    this.height = this.Hm * (1 - Math.exp((-this.a * this.D) / this.Hm));
    this.crownArea = this.height > 0 ? ((Math.PI * this.c) / (4 * this.a)) * this.height * this.D : 0;
    this.maxCrownRadius = this.crownArea > 0 ? Math.sqrt(this.crownArea / Math.PI) : 0.5;
    this.zmratio = this.#computeZmRatio();
  }

  #computeZmRatio() {
    const denominator = (this.m * this.n) - 1;
    const numerator = this.n - 1;
    if (this.n === 0 || denominator === 0) return 0;

    const base = numerator / denominator;
    if (base < 0) return 0;

    const result = Math.pow(base, 1 / this.n);
    return Number.isFinite(result) ? result : 0;
  }

  calculateHeight() { return this.height; }
  calculateCrownArea() { return this.crownArea; }
  getMaxCrownRadius() { return this.maxCrownRadius; }

  calculateCrownRadiusAtHeight(z, H) {
    if (H <= 0) return 0;
    const zRatio = z / H;
    let base = 1 - Math.pow(zRatio, this.n);
    if (base < 0) base = 0;
    const q_z = this.m * this.n * Math.pow(zRatio, (this.n - 1)) * Math.pow(base, (this.m - 1));
    const A_c = this.crownArea;
    const z_m = H * this.zmratio;
    const q_m = this.calculateQatHeight(z_m, H);
    if (q_m === 0) return 0;
    const r0 = Math.sqrt(A_c / Math.PI) / q_m;
    return r0 * q_z;
  }

  calculateQatHeight(z, H) {
    if (H <= 0) return 0;
    const zRatio = z / H;
    const base = 1 - Math.pow(zRatio, this.n);
    return this.m * this.n * Math.pow(zRatio, (this.n - 1)) * Math.pow(base, (this.m - 1));
  }

  stemRadiusAtHeight(z, H) {
    const baseRadius = this.D / 2.0;
    if (H <= 0) return baseRadius;
    return baseRadius * (1.0 - Math.pow(z / H, 1.5));
  }
}

// Initialize Texture Loader
const _texLoader = new THREE.TextureLoader();

const tree1 = _texLoader.load('images/leaf1.jpg');
const tree2 = _texLoader.load('images/leaf2.jpg');
const tree3 = _texLoader.load('images/leaf3.jpg');

const BARK_COLOR = {
  1: new THREE.Color(0x8B6340),
  2: new THREE.Color(0x7A5C35),
  3: new THREE.Color(0x6B4F2E)
};

const LEAF_MAT  = {};
const BARK_MAT  = {};

[1, 2, 3].forEach(sid => {
  let activeTex = tree1;
  if (sid === 2) activeTex = tree2;
  if (sid === 3) activeTex = tree3;

  LEAF_MAT[sid] = new THREE.MeshLambertMaterial({
    map: activeTex,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.4,
    depthWrite: true
  });
  
  BARK_MAT[sid] = new THREE.MeshLambertMaterial({ 
    color: BARK_COLOR[sid] 
  });
});

function buildCrownLathePts(pf, H, crownBaseZ, segments) {
  segments = segments || 32;
  const pts = [];
  pts.push(new THREE.Vector2(0, 0));
  const maxCR = pf.getMaxCrownRadius();
  const heightSpan = H - crownBaseZ;
  for (let i = 0; i <= segments; i++) {
    const z = crownBaseZ + (i / segments) * heightSpan;
    const r = Math.max(0, pf.calculateCrownRadiusAtHeight(z, H));
    const rNorm = maxCR > 0 ? (r / maxCR) : 0;
    const zNorm = heightSpan > 0 ? ((z - crownBaseZ) / heightSpan) : 0;
    pts.push(new THREE.Vector2(rNorm, zNorm));
  }
  return pts;
}

function buildUnitTemplateGeometry(speciesId) {
  const sampleDiameter = 1.0;
  const pf = new PlantFATEMath(sampleDiameter, speciesId);
  const H = pf.calculateHeight();
  const crownBaseZ = (pf.zmratio > 0) ? Math.max(H * 0.20, Math.min(H * 0.85, H * pf.zmratio * 0.5)) : H * 0.30;
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.0, 8);
  trunkGeo.translate(0, 0.5, 0); 
  const lathePts = buildCrownLathePts(pf, H, crownBaseZ, 32);
  const crownGeo = new THREE.LatheGeometry(lathePts, 16);
  return { trunkTemplate: trunkGeo, crownTemplate: crownGeo };
}

const SPECIES_TEMPLATES = {
  1: buildUnitTemplateGeometry(1),
  2: buildUnitTemplateGeometry(2),
  3: buildUnitTemplateGeometry(3)
};

class ForestScene {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0c120d);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = _texLoader.load('images/background.png'); 
    this.scene.fog = new THREE.Fog(0x0c120d, 180, 500);
    
    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 500);
    this.camera.position.set(0, 50, 80);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 4, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xfff5e6, 0.9);
    sun.position.set(40, 80, 20);
    this.scene.add(sun);

    this._addGround();

    window.addEventListener('resize', () => {
      const w = container.clientWidth, h = container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  _addGround() {
    const groundTex = _texLoader.load('images/soil.png'); 
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(10, 10); 
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100), 
      new THREE.MeshLambertMaterial({ map: groundTex, color: 0x4a3728 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

class ForestManager {
  constructor(scene3) {
    this.s3          = scene3;
    this.forestGroup = new THREE.Group();
    this.s3.scene.add(this.forestGroup);
    this.allYears   = [];
    this.playing    = false;
    this.yearIndex  = 0;
    this.accumulatedTime = 0;
    this._lastTime        = null;
    this.cohortPositionsMap = {};
  }

  init(data) {
    this.data     = data;
    this.allYears = Object.keys(data).map(Number).sort((a, b) => a - b);
    if (this.allYears.length > 0) {
      this._generatePermanentCoordinates();
      this.showYear(0);
    }
  }

  _generatePermanentCoordinates() {
    const maxTreesPerCohort = 5000; 
    this.allYears.forEach(year => {
      const cohorts = this.data[year] || [];
      cohorts.forEach(co => {
        if (co.c === 0) return;

        const cohortKey = `S${co.s}_C${co.c}`; 
        if (!this.cohortPositionsMap[cohortKey]) {
          const dedicatedCoords = [];
          for (let i = 0; i < maxTreesPerCohort; i++) {
            const seedX = co.s * 17.13 + co.c * 53.79 + i * 23.41;
            const seedZ = co.s * 89.71 + co.c * 11.23 + i * 71.19;
            const hashX = Math.sin(seedX) * 43758.5453;
            const hashZ = Math.sin(seedZ) * 23421.6312;
            dedicatedCoords.push({
              x: (hashX - Math.floor(hashX) - 0.5) * 100, 
              z: (hashZ - Math.floor(hashZ) - 0.5) * 100, 
              rotY: (hashX * Math.PI * 2) % (Math.PI * 2)
            });
          }
          this.cohortPositionsMap[cohortKey] = dedicatedCoords;
        }
      });
    });
  }

  resetToYear(targetYear) {
    const idx = this.allYears.indexOf(Number(targetYear));
    if (idx !== -1) this.showYear(idx);
    else this.showYear(0); 
  }

  showYear(index) {
    this.yearIndex = Math.max(0, Math.min(index, this.allYears.length - 1));
    this._renderCurrentTimelineFrame();
  }

  next() { 
    if (this.yearIndex < this.allYears.length - 1) 
      this.showYear(this.yearIndex + 1); 
  }

  prev() { 
    if (this.yearIndex > 0) 
      this.showYear(this.yearIndex - 1); 
  }

  togglePlay() {
    this.playing   = !this.playing;
    this._lastTime = null;
    this.accumulatedTime = 0;
  }

  tick(now) {
    if (!this.playing) return;
    if (this._lastTime === null) { this._lastTime = now; return; }
    const dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    this.accumulatedTime += dt;
    if (this.accumulatedTime >= 0.6) {
      this.accumulatedTime = 0;
      if (this.yearIndex < this.allYears.length - 1) this.next();
      else this.playing = false;
    }
  }

  _renderCurrentTimelineFrame() {
    const currentYear = this.allYears[this.yearIndex];
    if (!currentYear) return;

    const cohorts = this.data[currentYear] || [];

    while (this.forestGroup.children.length > 0) {
      this.forestGroup.remove(this.forestGroup.children[0]);
    }

    const speciesBins = { 1: [], 2: [], 3: [] };
    const activeMathProfiles = { 1: null, 2: null, 3: null };
    let totalTreeCount = 0;
    let nonZeroCohortCount = 0;

    cohorts.forEach(co => {
      if (co.c === 0 || co.bd <= 0 || co.d <= 0) return;

      nonZeroCohortCount++;
      const plotCount = Math.max(1, Math.round(co.d * 10000));
      const pf = new PlantFATEMath(co.bd, co.s);
      
      activeMathProfiles[co.s] = pf;

      const H = pf.calculateHeight();
      const crownBaseZ = (pf.zmratio > 0) ? Math.max(H * 0.20, Math.min(H * 0.85, H * pf.zmratio * 0.5)) : H * 0.30;
      const maxCrownRadius = pf.getMaxCrownRadius();

      speciesBins[co.s].push({
        cohortKey: `S${co.s}_C${co.c}`, 
        count: plotCount,
        height: H,
        trunkHeight: crownBaseZ,
        maxCrownRadius: maxCrownRadius,
        pf: pf
      });
      totalTreeCount += plotCount;
    });

    const _up = new THREE.Vector3(0, 1, 0);

    [1, 2, 3].forEach(sid => {
      const activeAllocations = speciesBins[sid];
      if (activeAllocations.length === 0) return;
      
      const totalSpeciesInstances = activeAllocations.reduce((sum, item) => sum + item.count, 0);
      const barkIM = new THREE.InstancedMesh(SPECIES_TEMPLATES[sid].trunkTemplate, BARK_MAT[sid], totalSpeciesInstances);
      const leafIM = new THREE.InstancedMesh(SPECIES_TEMPLATES[sid].crownTemplate, LEAF_MAT[sid], totalSpeciesInstances);
      
      let instanceIdx = 0;
      
      activeAllocations.forEach(treeGroup => {
        const crownLength = treeGroup.height - treeGroup.trunkHeight;
        const trunkThickness = treeGroup.pf.D * 4.0; 
        const permanentPool = this.cohortPositionsMap[treeGroup.cohortKey];
        
        // Safety validation in case a tracking key coordinate set wasn't registered
        if (!permanentPool) return;

        for (let i = 0; i < treeGroup.count; i++) {
          const pos = permanentPool[i]; 
          if (!pos) break;
          
          const trunkMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(pos.x, 0, pos.z),
            new THREE.Quaternion().setFromAxisAngle(_up, pos.rotY),
            new THREE.Vector3(trunkThickness, treeGroup.trunkHeight, trunkThickness)
          );
          
          const leafMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(pos.x, treeGroup.trunkHeight, pos.z),
            new THREE.Quaternion().setFromAxisAngle(_up, pos.rotY),
            new THREE.Vector3(treeGroup.maxCrownRadius * 2.0, crownLength, treeGroup.maxCrownRadius * 2.0)
          );
          
          barkIM.setMatrixAt(instanceIdx, trunkMatrix);
          leafIM.setMatrixAt(instanceIdx, leafMatrix);
          instanceIdx++;
        }
      });
      
      barkIM.instanceMatrix.needsUpdate = true;
      leafIM.instanceMatrix.needsUpdate = true;
      this.forestGroup.add(barkIM);
      this.forestGroup.add(leafIM);
    });

    [1, 2, 3].forEach(sid => {
      const pm       = activeMathProfiles[sid];
      const shapeMEl = document.getElementById(`s${sid}-shape-m`);
      const shapeNEl = document.getElementById(`s${sid}-shape-n`);

      if (pm) {
        if (shapeMEl) shapeMEl.textContent = pm.m.toFixed(1);
        if (shapeNEl) shapeNEl.textContent = pm.n.toFixed(1);
      } 
      else {
        const fallbackConfig = SPECIES_CONFIGS[sid];
        if (shapeMEl && fallbackConfig) shapeMEl.textContent = fallbackConfig.m.toFixed(1);
        if (shapeNEl && fallbackConfig) shapeNEl.textContent = fallbackConfig.n.toFixed(1);
      }
    });

    UI.update(currentYear, nonZeroCohortCount, totalTreeCount);
  }
}

// UI controller methods 
const UI = {
  statY: document.getElementById('stat-year'),
  statC: document.getElementById('stat-cohorts'),
  statTrees: document.getElementById('stat-trees'),

  update(year, activeCohortCount, calculatedTrees) {
    if (this.statY) 
      this.statY.textContent = Math.round(year);
    if (this.statC) 
      this.statC.textContent = activeCohortCount; 
    if (this.statTrees) 
      this.statTrees.textContent = calculatedTrees;
  }
};

const container = document.getElementById('simulation-viewport');
const scene3    = new ForestScene(container);
const forest    = new ForestManager(scene3);

function waitForData() {
  Papa.parse('cohort_props.csv', {
    download:       true,
    header:         true,
    dynamicTyping:  true,
    skipEmptyLines: true,
    complete: function(results) {
      const raw    = results.data;
      const byYear = {};
      raw.forEach(row => {
        if (row.YEAR === undefined || row.YEAR === null) return;
        const yr = Number(row.YEAR);
        if (Number.isNaN(yr)) return;
        if (!byYear[yr]) byYear[yr] = [];
        
        byYear[yr].push({
          s:  row.speciesID,
          c:  row.cohortID, 
          d:  row.density,
          bd: row.basal_diameter,
          h:  row.height
        });
      });

      forest.init(byYear);
      const loadEl = document.getElementById('loading');
      if (loadEl) loadEl.classList.add('hidden');
      bindUI();
      requestAnimationFrame(loop);
    },
    error: function(err) {
      console.error('CSV parse error:', err);
    }
  });
}

function loop(now) {
  requestAnimationFrame(loop);
  forest.tick(now);
  scene3.render();
}

function bindUI() {
  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'n') forest.next();
    if (e.key.toLowerCase() === 'p') forest.prev();
    if (e.key.toLowerCase() === ' ') {
      e.preventDefault();
      forest.togglePlay();
    }
    if (e.key.toLowerCase() === 'r') {
      forest.resetToYear(2000);
      forest.playing = false; 
      scene3.camera.position.set(0, 50, 80);
      scene3.controls.target.set(0, 4, 0);
      scene3.controls.update();
    }
  });
}
waitForData();
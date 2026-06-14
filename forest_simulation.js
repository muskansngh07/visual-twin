// PlantFATE Math - Preserved completely for exact mathematical scaling rules
class PlantFATEMath {
  constructor(basalDiameter) {
    this.Hm = 35; // maximum height
    this.a = 75; // stem slenderness ratio
    this.c = 600; // area ratio
    this.m = 1.5; // crown shape parameter
    this.n = 2; // crown shape parameter
    this.rho_s = 0.6; // wood density
    this.D = Number(basalDiameter); // basal diameter, from csv

    try {
      const denominator = (this.m * this.n) - 1;
      const numerator = this.n - 1;
      if (denominator == 0 || this.n == 0) {
        throw new RangeError("ZeroDivisionError");
      }
      const base = numerator / denominator;
      if (base < 0 && (1 / this.n) % 1 !== 0) {
        throw new RangeError("ValueError");
      }
      this.zmratio = Math.pow(base, (1 / this.n));
      if (Number.isNaN(this.zmratio)) {
        throw new Error("Invalid");
      }
    } 
    catch (error) {
      this.zmratio = 0.0;
    }
  }

  calculateHeight() {
    return this.Hm * (1 - Math.exp((-this.a * this.D) / this.Hm));
  }

  calculateDBH() {
    const H = this.calculateHeight();
    if (H <= 1.3) return this.D * 0.85; // Fallback scaling for young saplings below 1.3m
    return this.stemRadiusAtHeight(1.3, H) * 2.0;
  }
  
  calculateCrownArea() {
    const H = this.calculateHeight();
    return ((Math.PI * this.c) / (4 * this.a)) * H * this.D;
  }

  // Helper to extract maximum dynamic crown radius based on calculated area
  getMaxCrownRadius() {
    const area = this.calculateCrownArea();
    if (area <= 0) return 0.5;
    return Math.sqrt(area / Math.PI);
  }

  calculateSapwoodFraction() {
    const H = this.calculateHeight();
    if ((this.a * this.D) == 0) return 0;
    return H / (this.a * this.D);
  }
  
  calculateCrownRadiusAtHeight(z, H) {
    const zRatio = z / H;
    let base = 1 - Math.pow(zRatio, this.n);
    if (base < 0) base = 0;
    const q_z = this.m * this.n * Math.pow(zRatio, (this.n - 1)) * Math.pow(base, (this.m - 1));
    const A_c = this.calculateCrownArea();
    const z_m = H * this.zmratio;
    const q_m = this.calculateQatHeight(z_m, H);
    if (q_m == 0) return 0;
    const r0 = Math.sqrt(A_c / Math.PI) / q_m;
    return r0 * q_z;
  }

  calculateQatHeight(z, H) {
    const zRatio = z / H;
    const base = 1 - Math.pow(zRatio, this.n);
    return this.m * this.n * Math.pow(zRatio, (this.n - 1)) * Math.pow(base, (this.m - 1));
  }

  stemRadiusAtHeight(z, H) {
    const baseRadius = this.D / 2.0;
    if (H <= 0) return baseRadius;
    const heightRatio = z / H;
    const taperFactor = 1.0 - Math.pow(heightRatio, 1.5);
    return baseRadius * taperFactor;
  }
}

// Species styling configurations
const SPECIES_CONFIG = {
  1: { leafUrl: 'images/tree1.png', leafSizeFactor: 2.0, branchAngle: 0.70, lengthTaper: 0.68, alphaTest: 0.08 },
  2: { leafUrl: 'images/tree2.png', leafSizeFactor: 1.0, branchAngle: 0.55, lengthTaper: 0.70, alphaTest: 0.15 },
  3: { leafUrl: 'images/tree3.png', leafSizeFactor: 1.5, branchAngle: 0.60, lengthTaper: 0.75, alphaTest: 0.08 }
};

const BARK_COLOR = {
  1: new THREE.Color(0x5c4033),
  2: new THREE.Color(0x4a3b32),
  3: new THREE.Color(0x3d2b1f)
};

const _texLoader = new THREE.TextureLoader();
const LEAF_TEX   = {};
const LEAF_MAT   = {};
const BARK_MAT   = {};

[1, 2, 3].forEach(sid => {
  const cfg = SPECIES_CONFIG[sid];
  LEAF_TEX[sid] = _texLoader.load(cfg.leafUrl);
  LEAF_MAT[sid] = new THREE.MeshLambertMaterial({
    map:        LEAF_TEX[sid],
    transparent: true,
    alphaTest:   cfg.alphaTest,
    side:        THREE.DoubleSide,
    depthWrite:  false
  });
  BARK_MAT[sid] = new THREE.MeshLambertMaterial({ color: BARK_COLOR[sid] });
});

// Generates an unscaled Master Template pair at normalized dimensions (H=1, D=1)
function createMasterUnitTemplates(speciesId) {
  const cfg = SPECIES_CONFIG[speciesId] || SPECIES_CONFIG[1];
  
  // 1. Standalone standard unit trunk cylinder
  const trunkGeo = new THREE.CylinderGeometry(0.75, 1.0, 1.0, 5);
  trunkGeo.translate(0, 0.5, 0); // Bottom boundary registration pivot point

  // 2. Canopy template containing branch and leaf architectures
  const pfUnit = new PlantFATEMath(1.0);
  const H_unit = pfUnit.calculateHeight();
  const maxDepth = speciesId === 2 ? 4 : 3;
  const trunkLength = H_unit * 0.38;

  const bGeos = [];
  const lGeos = [];

  function collectBranchUnitGeometries(currentZ, length, depth, worldMatrix) {
    const zBottom = Math.min(H_unit, currentZ);
    const zTop = Math.min(H_unit, currentZ + length);
    const rBottom = pfUnit.stemRadiusAtHeight(zBottom, H_unit);
    const rTop = pfUnit.stemRadiusAtHeight(zTop, H_unit);

    const cylGeo = new THREE.CylinderGeometry(rTop, rBottom, length, 5);
    cylGeo.translate(0, length / 2, 0);
    cylGeo.applyMatrix4(worldMatrix);
    bGeos.push(cylGeo);

    const tipMatrix = worldMatrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, length, 0));

    if (depth >= maxDepth) {
      const planeSize = length * cfg.leafSizeFactor;
      const pGeo = new THREE.PlaneGeometry(planeSize, planeSize);
      pGeo.translate(0, planeSize / 2, 0);

      const p1 = pGeo.clone().applyMatrix4(tipMatrix);
      lGeos.push(p1);

      const p2 = pGeo.clone();
      p2.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2)).applyMatrix4(tipMatrix);
      lGeos.push(p2);

      pGeo.dispose();
      return;
    }

    const nextLength = length * cfg.lengthTaper;
    const angle      = cfg.branchAngle;
    const rotOffset  = (speciesId * 0.5) + depth;

    for (let i = 0; i < 3; i++) {
      const twist = rotOffset + i * (Math.PI * 1.33);
      const childMatrix = tipMatrix.clone().multiply(
        new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(angle, twist, 0, 'YXZ'))
      );
      collectBranchUnitGeometries(zTop, nextLength, depth + 1, childMatrix);
    }
  }

  collectBranchUnitGeometries(trunkLength, H_unit * 0.22, 0, new THREE.Matrix4());

  const canopyBark = bGeos.length ? THREE.BufferGeometryUtils.mergeBufferGeometries(bGeos) : null;
  const canopyLeaf = lGeos.length ? THREE.BufferGeometryUtils.mergeBufferGeometries(lGeos) : null;

  bGeos.forEach(g => g.dispose());
  lGeos.forEach(g => g.dispose());

  return { trunk: trunkGeo, canopyBark: canopyBark, canopyLeaf: canopyLeaf };
}

const LAND_AREA = 120 * 120;

class ForestScene {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0c120d);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = _texLoader.load('images/background.png');
    this.scene.fog = new THREE.Fog(0x0c120d, 180, 500);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 500);
    this.camera.position.set(0, 40, 75);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 4, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
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
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshLambertMaterial({ map: groundTex, color: 0x4a3728 }));
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

    this.positions  = {};
    this.allYears   = [];
    this.playing    = false;
    this.speed      = 2.5; 
    this.currentYearFloat = 0;
    this._lastTime   = null;

    // Cache exactly one unscaled geometric template set per species
    this.masterTemplates = {
      1: createMasterUnitTemplates(1),
      2: createMasterUnitTemplates(2),
      3: createMasterUnitTemplates(3)
    };
  }

  init(data) {
    this.data     = data;
    this.allYears = Object.keys(data).map(Number).sort((a, b) => a - b);
    
    if (this.allYears.length > 0) {
      this._initPositions();
      this.currentYearFloat = this.allYears[0];
      this._renderCurrentTimelineFrame();
    }
  }

  _initPositions() {
    const existingSpawns = []; 
    const MIN_EDGE_GAP = 2.0;   

    this.allYears.forEach(year => {
      const cohorts = this.data[year] || [];
      const sortedCohorts = [...cohorts].sort((a,b) => (b.bd || 0) - (a.bd || 0));

      sortedCohorts.forEach((co) => {
        const key = `S${co.s}_C${co.c}`;
        if (this.positions[key]) return;

        const evalMath = new PlantFATEMath(co.bd || 0.1);
        const crownRad = evalMath.getMaxCrownRadius();

        const maxCohortTrees = Math.min(4, Math.max(1, Math.round(co.d * 80)));
        this.positions[key] = [];

        let attempts = 0;
        while (this.positions[key].length < maxCohortTrees && attempts < 80) {
          attempts++;
          const candidateX = -50 + Math.random() * 100;
          const candidateZ = -50 + Math.random() * 100;

          let spatialViolation = false;
          for (let s = 0; s < existingSpawns.length; s++) {
            const activeSpawn = existingSpawns[s];
            const dist = Math.sqrt((candidateX - activeSpawn[0])**2 + (candidateZ - activeSpawn[1])**2);
            if (dist < MIN_EDGE_GAP) {
              spatialViolation = true;
              break;
            }
          }

          if (!spatialViolation) {
            this.positions[key].push([candidateX, candidateZ]);
            existingSpawns.push([candidateX, candidateZ]);
          }
        }
      });
    });
  }

  get totalYears() { return this.allYears.length; }

  showYear(index) { 
    const safeIdx = Math.max(0, Math.min(index, this.allYears.length - 1));
    this.currentYearFloat = this.allYears[safeIdx]; 
    this._renderCurrentTimelineFrame(); 
  }

  next() { 
    let idx = this.allYears.findIndex(y => y > this.currentYearFloat); 
    if (idx !== -1) this.showYear(idx); 
  }

  prev() { 
    let idx = this.allYears.findIndex(y => y >= this.currentYearFloat); 
    if (idx > 0) this.showYear(idx - 1); 
  }

  togglePlay() { 
    this.playing = !this.playing; 
    this._lastTime = null; 
  }

  tick(now) {
    if (!this.playing) return;
    if (this._lastTime === null) { this._lastTime = now; return; }
    
    const dt = (now - this._lastTime) / 1000;
    this._lastTime = now;

    this.currentYearFloat += dt * this.speed;
    
    const endYear = this.allYears[this.allYears.length - 1];
    if (this.currentYearFloat >= endYear) {
      this.currentYearFloat = endYear;
      this.playing = false;
      UI.setPlayBtn(false);
    }
    
    this._renderCurrentTimelineFrame();
  }

  // 60FPS Frame Render Loop: Multi-Component Matrix Scaling preserves allometric proportions on the GPU
  _renderCurrentTimelineFrame() {
    const currentYearFloat = this.currentYearFloat;
    if (this.allYears.length === 0) return;

    let idx = this.allYears.findIndex(y => y > currentYearFloat);
    if (idx === -1) idx = this.allYears.length - 1;

    const baseIdx = Math.max(0, idx - 1);
    const nextIdx = Math.min(this.allYears.length - 1, baseIdx + 1);
    
    const yearA = this.allYears[baseIdx];
    const yearB = this.allYears[nextIdx];

    let t = 0;
    if (yearB !== yearA) {
      t = (currentYearFloat - yearA) / (yearB - yearA);
    }

    const cohortsA = this.data[yearA] || [];
    const cohortsB = this.data[yearB] || [];

    while(this.forestGroup.children.length > 0) {
      this.forestGroup.remove(this.forestGroup.children[0]);
    }

    let totalTreeCount = 0;
    const activeMathProfiles = { 1: null, 2: null, 3: null };
    const _up = new THREE.Vector3(0, 1, 0);

    cohortsA.forEach(cA => {
      const cB = cohortsB.find(c => c.s === cA.s && c.c === cA.c) || cA;
      const currentBD = cA.bd + (cB.bd - cA.bd) * t;
      if (currentBD <= 0) return;

      const sid = cA.s || 1;
      
      const bioMath = new PlantFATEMath(currentBD);
      if (!activeMathProfiles[sid]) {
         activeMathProfiles[sid] = bioMath;
      }

      // Extract accurate, non-linear physical dimensions for this specific growth frame
      const trueHeight = bioMath.calculateHeight();
      const trueDBH    = bioMath.calculateDBH();
      const crownRad   = bioMath.getMaxCrownRadius();

      const key = `S${cA.s}_C${cA.c}`;
      const coords = this.positions[key] || [];
      if (coords.length === 0) return;

      const tmpl = this.masterTemplates[sid];

      // Declare independent components to allow separate non-linear scaling bounds
      const trunkMesh = new THREE.InstancedMesh(tmpl.trunk, BARK_MAT[sid], coords.length);
      const cBarkMesh = new THREE.InstancedMesh(tmpl.canopyBark, BARK_MAT[sid], coords.length);
      const cLeafMesh = new THREE.InstancedMesh(tmpl.canopyLeaf, LEAF_MAT[sid], coords.length);

      coords.forEach(([x, z], cIdx) => {
        const rotY = (cA.c * 13.37) % (Math.PI * 2);
        const qRot = new THREE.Quaternion().setFromAxisAngle(_up, rotY);

        // A) Scale Trunk Cylinder: Width via dynamic DBH, Height via true non-linear height
        const trunkMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          qRot,
          new THREE.Vector3(trueDBH, trueHeight, trueDBH)
        );
        trunkMesh.setMatrixAt(cIdx, trunkMatrix);

        // B) Scale Branching/Leaf System: Width via dynamic Crown Area, Length via height limits
        const canopyMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          qRot,
          new THREE.Vector3(crownRad * 2.0, trueHeight, crownRad * 2.0)
        );
        cBarkMesh.setMatrixAt(cIdx, canopyMatrix);
        cLeafMesh.setMatrixAt(cIdx, canopyMatrix);

        totalTreeCount++;
      });

      trunkMesh.instanceMatrix.needsUpdate = true;
      cBarkMesh.instanceMatrix.needsUpdate = true;
      cLeafMesh.instanceMatrix.needsUpdate = true;

      this.forestGroup.add(trunkMesh, cBarkMesh, cLeafMesh);
    });

    UI.update(Math.floor(currentYearFloat), baseIdx, this.allYears.length, cohortsA);
    
    [1, 2, 3].forEach(sid => {
       const pm = activeMathProfiles[sid];
       const shapeMEl = document.getElementById(`s${sid}-shape-m`);
       const shapeNEl = document.getElementById(`s${sid}-shape-n`);
       const angleEl  = document.getElementById(`s${sid}-branch-angle`);
       
       if (pm) {
          if (shapeMEl) {
             shapeMEl.innerHTML = `
               <span style="color:#81c784; display:block; font-size:11px;">BD: ${pm.D.toFixed(2)}m</span>
               <span style="color:#64b5f6; display:block; font-size:11px;">DBH: ${pm.calculateDBH().toFixed(2)}m</span>
               <span style="color:#ffb74d; display:block; font-size:11px;">H: ${pm.calculateHeight().toFixed(1)}m</span>
             `;
          }
          if (shapeNEl) shapeNEl.textContent = pm.n.toFixed(2);
          if (angleEl)  angleEl.textContent  = (SPECIES_CONFIG[sid]?.branchAngle || 0).toFixed(2);
       } else {
          if (shapeMEl) shapeMEl.textContent = "--";
       }
    });

    const statTrees = document.getElementById('stat-trees');
    if (statTrees) statTrees.textContent = totalTreeCount;
  }
}

// Resilient UI controller methods
const UI = {
  yearEl:   document.getElementById('year-display'),
  cohortEl: document.getElementById('year-cohort-line'),
  sliderEl: document.getElementById('timeline-slider'),
  statC:    document.getElementById('stat-cohorts'),
  playBtn:  document.getElementById('btn-play'),

  update(year, index, total, cohorts) {
    if (this.yearEl)   this.yearEl.textContent   = year;
    if (this.cohortEl) this.cohortEl.textContent = `${cohorts.length} cohorts active`;
    if (this.statC)   this.statC.textContent   = cohorts.length;
    
    if (this.sliderEl) {
      this.sliderEl.max = total - 1;
      this.sliderEl.value = index;
    }
  },

  setPlayBtn(playing) {
    if (!this.playBtn) return;
    this.playBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
  }
};

const container = document.getElementById('simulation-viewport');
const scene3    = new ForestScene(container);
const forest    = new ForestManager(scene3);

function waitForData() {
  Papa.parse('cohort_props.csv', {
    download: true, 
    header: true, 
    dynamicTyping: true, 
    skipEmptyLines: true,
    complete: function(results) {
      const raw = results.data;
      const byYear = {};

      raw.forEach(row => {
        if (row.YEAR === undefined || row.YEAR === null) return;
        const yr = Number(row.YEAR);
        if (Number.isNaN(yr)) return;
        
        if (!byYear[yr]) byYear[yr] = [];
        byYear[yr].push({
          s:  row.speciesID,                
          c:  row.cohortNum,                
          d:  row.density,                  
          bd: row.basal_diameter,           
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
  const q = id => document.getElementById(id);

  if (q('btn-prev'))  q('btn-prev').onclick  = () => { forest.playing = false; UI.setPlayBtn(false); forest.prev(); };
  if (q('btn-next'))  q('btn-next').onclick  = () => { forest.playing = false; UI.setPlayBtn(false); forest.next(); };
  if (q('btn-reset')) q('btn-reset').onclick = () => {
    forest.playing = false;
    UI.setPlayBtn(false);
    forest.showYear(0);
    scene3.camera.position.set(0, 40, 75);
    scene3.controls.target.set(0, 4, 0);
    scene3.controls.update();
  };
  
  if (q('btn-play')) {
    q('btn-play').onclick = () => { 
      forest.togglePlay(); 
      UI.setPlayBtn(forest.playing); 
    };
  }

  const slider = q('timeline-slider');
  if (slider) {
    slider.addEventListener('input', e => {
      forest.playing = false;
      UI.setPlayBtn(false);
      forest.showYear(parseInt(e.target.value, 10));
    });
  }
}

waitForData();
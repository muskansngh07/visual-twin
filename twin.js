// PlantFATE Math - Preserved completely for exact mathematical scaling rules
class PlantFATEMath {
  constructor(basalDiameter) {
    this.Hm = 35;
    this.a = 75;
    this.c = 600;
    this.m = 1.8;
    this.n = 2.3;
    this.rho_s = 0.6;
    this.D = Number(basalDiameter);

    try {
      const denominator = (this.m * this.n) - 1;
      const numerator = this.n - 1;
      if (denominator == 0 || this.n == 0) throw new RangeError("ZeroDivisionError");
      const base = numerator / denominator;
      if (base < 0 && (1 / this.n) % 1 !== 0) throw new RangeError("ValueError");
      this.zmratio = Math.pow(base, (1 / this.n));
      if (Number.isNaN(this.zmratio)) throw new Error("Invalid");
    } catch (error) {
      this.zmratio = 0.0;
    }
  }

  calculateHeight() {
    return this.Hm * (1 - Math.exp((-this.a * this.D) / this.Hm));
  }

  calculateDBH() {
    const H = this.calculateHeight();
    if (H <= 1.3) return this.D * 0.85;
    return this.stemRadiusAtHeight(1.3, H) * 2.0;
  }

  calculateCrownArea() {
    const H = this.calculateHeight();
    return ((Math.PI * this.c) / (4 * this.a)) * H * this.D;
  }

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

// Initialize Texture Loader
const _texLoader = new THREE.TextureLoader();

// 1. Load crown textures properly
const tree1 = _texLoader.load('images/leaves1.png');
const tree2 = _texLoader.load('images/leaves2.png');
const tree3 = _texLoader.load('images/leaves3.png');

const BARK_COLOR = {
  1: new THREE.Color(0x8B6340),
  2: new THREE.Color(0x7A5C35),
  3: new THREE.Color(0x6B4F2E)
};

const LEAF_MAT  = {};
const BARK_MAT  = {};

// 2. Setup materials correctly with texture references, transparency, and alpha testing
[1, 2, 3].forEach(sid => {
  let activeTex = tree1;
  if (sid === 2) activeTex = tree2;
  if (sid === 3) activeTex = tree3;

  LEAF_MAT[sid] = new THREE.MeshLambertMaterial({
    map: activeTex,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.5 // Prevents depth-sorting artifacts in InstancedMesh layout
  });
  
  BARK_MAT[sid] = new THREE.MeshLambertMaterial({ color: BARK_COLOR[sid] });
});

function buildCrownLathePts(pf, H, crownBaseZ, segments) {
  segments = segments || 32;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const z = crownBaseZ + (i / segments) * (H - crownBaseZ);
    const r = Math.max(0, pf.calculateCrownRadiusAtHeight(z, H));
    pts.push(new THREE.Vector2(r, z - crownBaseZ));
  }
  return pts;
}

// Single trunk cylinder + lathe crown, both fully governed by PlantFATE math
function buildMergedTreeGeo(D, speciesId) {
  const sid = speciesId || 1;
  const pf  = new PlantFATEMath(D);
  const H   = pf.calculateHeight();
  if (H <= 0) return null;

  // Crown base: zmratio inflection point; fallback to 35% of H if degenerate
  const crownBaseZ  = (pf.zmratio > 0)
    ? Math.max(0, Math.min(H * 0.85, H * pf.zmratio * 0.5))
    : H * 0.35;
  const trunkHeight = crownBaseZ;

  // Trunk: single tapered cylinder from ground to crownBaseZ
  const rBase    = pf.stemRadiusAtHeight(0,           H);
  const rTop     = pf.stemRadiusAtHeight(trunkHeight, H);
  const trunkGeo = new THREE.CylinderGeometry(rTop, rBase, trunkHeight, 8);
  trunkGeo.translate(0, trunkHeight / 2, 0);

  // Crown: LatheGeometry profile driven by m and n, lifted onto trunk top
  const lathePts = buildCrownLathePts(pf, H, crownBaseZ, 32);
  const crownGeo = new THREE.LatheGeometry(lathePts, 16);
  crownGeo.translate(0, crownBaseZ, 0);

  const mergedBark = THREE.BufferGeometryUtils.mergeBufferGeometries([trunkGeo]);
  const mergedLeaf = THREE.BufferGeometryUtils.mergeBufferGeometries([crownGeo]);

  trunkGeo.dispose();
  crownGeo.dispose();

  return { bark: mergedBark, leaf: mergedLeaf };
}

const LAND_AREA = 120 * 120;

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
    this.camera.position.set(0, 35, 65);

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
      new THREE.PlaneGeometry(120, 120),
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

    this.positions  = {};
    this.allYears   = [];
    this.playing    = false;
    this.speed      = 2;

    this.currentYearFloat = 0;
    this._lastTime        = null;

    this.geometryCache = {};
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
    const existingSpawns  = [];
    const CONSTANT_BUFFER = 0.5;

    const maxCohortDiameters = {};
    this.allYears.forEach(year => {
      const cohorts = this.data[year] || [];
      cohorts.forEach(co => {
        const key = `S${co.s}_C${co.c}`;
        if (!maxCohortDiameters[key] || co.bd > maxCohortDiameters[key]) {
          maxCohortDiameters[key] = co.bd;
        }
      });
    });

    const masterCohortList = [];
    this.allYears.forEach(year => {
      const cohorts = this.data[year] || [];
      cohorts.forEach(co => {
        const key = `S${co.s}_C${co.c}`;
        if (!masterCohortList.some(item => item.key === key)) {
          masterCohortList.push({
            key:   key,
            s:     co.s,
            c:     co.c,
            d:     co.d,
            maxBd: maxCohortDiameters[key] || 0.1
          });
        }
      });
    });

    masterCohortList.sort((a, b) => b.maxBd - a.maxBd);

    masterCohortList.forEach(co => {
      if (this.positions[co.key]) return;

      const evalMath           = new PlantFATEMath(co.maxBd);
      const currentMaxCrownRad = evalMath.getMaxCrownRadius();
      const maxCohortTrees     = Math.min(6, Math.max(1, Math.round(co.d * 100)));
      this.positions[co.key]   = [];

      let attempts = 0;
      while (this.positions[co.key].length < maxCohortTrees && attempts < 200) {
        attempts++;
        const candidateX = -50 + Math.random() * 100;
        const candidateZ = -50 + Math.random() * 100;
        let spatialViolation = false;

        for (let s = 0; s < existingSpawns.length; s++) {
          const activeSpawn = existingSpawns[s];
          const dx = candidateX - activeSpawn[0];
          const dz = candidateZ - activeSpawn[1];
          const distance = Math.sqrt(dx * dx + dz * dz);
          const minRequiredDistance = currentMaxCrownRad + activeSpawn[2] + CONSTANT_BUFFER;
          if (distance < minRequiredDistance) {
            spatialViolation = true;
            break;
          }
        }

        if (!spatialViolation) {
          this.positions[co.key].push([candidateX, candidateZ]);
          existingSpawns.push([candidateX, candidateZ, currentMaxCrownRad]);
        }
      }
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
    this.playing   = !this.playing;
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
    if (yearB !== yearA) t = (currentYearFloat - yearA) / (yearB - yearA);

    const cohortsA = this.data[yearA] || [];
    const cohortsB = this.data[yearB] || [];

    while (this.forestGroup.children.length > 0) {
      this.forestGroup.remove(this.forestGroup.children[0]);
    }

    let totalTreeCount = 0;
    const activeMathProfiles = { 1: null, 2: null, 3: null };
    const _up = new THREE.Vector3(0, 1, 0);

    cohortsA.forEach(cA => {
      const cB = cohortsB.find(c => c.s === cA.s && c.c === cA.c) || cA;
      const currentDiameter = cA.bd + (cB.bd - cA.bd) * t;
      if (currentDiameter <= 0) return;

      const sid = cA.s || 1;

      if (!activeMathProfiles[sid]) {
        activeMathProfiles[sid] = new PlantFATEMath(currentDiameter);
      }

      const stepDiameter = Math.round(currentDiameter * 100) / 100;
      const cacheKey     = `${sid}_step_${stepDiameter.toFixed(2)}`;

      if (!this.geometryCache[cacheKey]) {
        this.geometryCache[cacheKey] = buildMergedTreeGeo(stepDiameter, sid);
      }

      const exactGeoPair = this.geometryCache[cacheKey];
      if (!exactGeoPair) return;

      const key    = `S${cA.s}_C${cA.c}`;
      const coords = this.positions[key] || [];

      const barkIM = new THREE.InstancedMesh(exactGeoPair.bark, BARK_MAT[sid], coords.length);
      const leafIM = new THREE.InstancedMesh(exactGeoPair.leaf, LEAF_MAT[sid], coords.length);

      coords.forEach(([x, z], cIdx) => {
        const rotY   = (cA.c * 13.37) % (Math.PI * 2);
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          new THREE.Quaternion().setFromAxisAngle(_up, rotY),
          new THREE.Vector3(1, 1, 1)
        );
        barkIM.setMatrixAt(cIdx, matrix);
        leafIM.setMatrixAt(cIdx, matrix);
        totalTreeCount++;
      });

      barkIM.instanceMatrix.needsUpdate = true;
      leafIM.instanceMatrix.needsUpdate = true;

      this.forestGroup.add(barkIM);
      this.forestGroup.add(leafIM);
    });

    UI.update(Math.floor(currentYearFloat), baseIdx, this.allYears.length, cohortsA);

    [1, 2, 3].forEach(sid => {
      const pm       = activeMathProfiles[sid];
      const shapeMEl = document.getElementById(`s${sid}-shape-m`);
      const shapeNEl = document.getElementById(`s${sid}-shape-n`);
      const angleEl  = document.getElementById(`s${sid}-branch-angle`);

      if (pm) {
        if (shapeMEl) shapeMEl.textContent = pm.m.toFixed(2) + ` (D:${pm.D.toFixed(2)}m)`;
        if (shapeNEl) shapeNEl.textContent = pm.n.toFixed(2);
        if (angleEl)  angleEl.textContent  = '--';
      } else {
        if (shapeMEl) shapeMEl.textContent = '--';
      }
    });

    const statTrees = document.getElementById('stat-trees');
    if (statTrees) statTrees.textContent = totalTreeCount;
  }

  clearCacheMemory() {
    Object.keys(this.geometryCache).forEach(key => {
      const pair = this.geometryCache[key];
      if (pair) {
        if (pair.bark) pair.bark.dispose();
        if (pair.leaf) pair.leaf.dispose();
      }
      delete this.geometryCache[key];
    });
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
    if (this.statC)    this.statC.textContent    = cohorts.length;
    if (this.sliderEl) {
      this.sliderEl.max   = total - 1;
      this.sliderEl.value = index;
    }
  },

  setPlayBtn(playing) {
    if (!this.playBtn) return;
    this.playBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
    this.playBtn.classList.toggle('active', playing);
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
          c:  row.cohortNum,
          d:  row.density,
          bd: row.basal_diameter
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

  if (q('btn-prev'))  q('btn-prev').onclick  = () => forest.prev();
  if (q('btn-next'))  q('btn-next').onclick  = () => forest.next();
  if (q('btn-reset')) q('btn-reset').onclick = () => {
    forest.showYear(0);
    scene3.camera.position.set(0, 35, 65);
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
    let wasPlaying = false;

    slider.addEventListener('input', e => {
      forest.showYear(parseInt(e.target.value, 10));
    });

    slider.addEventListener('mousedown', () => {
      wasPlaying = forest.playing;
      if (wasPlaying) {
        forest.playing = false;
        UI.setPlayBtn(false);
      }
    });

    slider.addEventListener('mouseup', () => {
      if (wasPlaying) {
        forest.playing   = true;
        UI.setPlayBtn(true);
        forest._lastTime = performance.now();
      }
    });
  }

  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'n') forest.next();
    if (e.key.toLowerCase() === 'p') forest.prev();
    if (e.key === ' ') {
      e.preventDefault();
      forest.togglePlay();
      UI.setPlayBtn(forest.playing);
    }
    if (e.key.toLowerCase() === 'r') {
      scene3.camera.position.set(0, 35, 65);
      scene3.controls.target.set(0, 4, 0);
      scene3.controls.update();
    }
  });
}

waitForData();
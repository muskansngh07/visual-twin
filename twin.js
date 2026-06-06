// PlantFATE Math
class PlantFATEMath {
  constructor(basalDiameter) {
    this.Hm    = 35;
    this.a     = 75;
    this.c     = 600;
    this.m     = 1.5;
    this.n     = 2;
    this.rho_s = 0.6;
    this.D     = Number(basalDiameter);

    try {
      const denominator = (this.m * this.n) - 1;
      const numerator   = this.n - 1;
      if (denominator === 0 || this.n === 0) throw new RangeError("ZeroDivisionError");
      const base = numerator / denominator;
      if (base < 0 && (1 / this.n) % 1 !== 0) throw new RangeError("ValueError");
      this.zmratio = Math.pow(base, 1 / this.n);
      if (Number.isNaN(this.zmratio)) throw new Error("Invalid");
    } catch {
      this.zmratio = 0.0;
      console.warn("Couldn't calculate zmratio, defaulting to 0.0");
    }
  }

  // H = Hm * (1 - exp(-a * D / Hm))
  calculateHeight() {
    return this.Hm * (1 - Math.exp((-this.a * this.D) / this.Hm));
  }

  // A_c = (pi * c * H * D) / (4 * a)
  calculateCrownArea() {
    const H = this.calculateHeight();
    return ((Math.PI * this.c) / (4 * this.a)) * H * this.D;
  }

  // f_s = H / (a * D)
  calculateSapwoodFraction() {
    const H = this.calculateHeight();
    if ((this.a * this.D) === 0) return 0;
    return H / (this.a * this.D);
  }

  calculateQatHeight(z, H) {
    const zRatio = Math.min(1.0, Math.max(0.0, z / H));
    const base   = 1 - Math.pow(zRatio, this.n);
    return this.m * this.n * Math.pow(zRatio, this.n - 1) * Math.pow(Math.max(0, base), this.m - 1);
  }

  // Crown radius profile from PlantFATE documentation
  calculateCrownRadiusAtHeight(z, H) {
    const zRatio = Math.min(1.0, Math.max(0.0, z / H));
    const base   = Math.max(0, 1 - Math.pow(zRatio, this.n));
    const q_z    = this.m * this.n * Math.pow(zRatio, this.n - 1) * Math.pow(base, this.m - 1);
    const A_c    = this.calculateCrownArea();
    const z_m    = H * this.zmratio;
    const q_m    = this.calculateQatHeight(z_m, H);
    if (q_m === 0) return 0;
    const r0 = Math.sqrt(A_c / Math.PI) / q_m;
    return r0 * q_z;
  }

  // Stem taper from PlantFATE documentation
  stemRadiusAtHeight(z, H) {
    const baseRadius  = this.D / 2.0;
    if (H <= 0) return baseRadius;
    const heightRatio = Math.min(1.0, Math.max(0.0, z / H));
    const taperFactor = 1.0 - Math.pow(heightRatio, 1.5);
    return baseRadius * taperFactor;
  }
}

// ─── Species configuration ────────────────────────────────────────────────────
const SPECIES_CONFIG = {
  1: { leafUrl: 'images/tree1.png', leafSizeFactor: 2.0, branchAngle: 0.70, lengthTaper: 0.68, alphaTest: 0.08 },
  2: { leafUrl: 'images/tree2.png', leafSizeFactor: 1.0, branchAngle: 0.55, lengthTaper: 0.70, alphaTest: 0.15 },
  3: { leafUrl: 'images/tree3.png', leafSizeFactor: 1.5, branchAngle: 0.60, lengthTaper: 0.75, alphaTest: 0.08 }
};

const BARK_COLOR = {
  1: new THREE.Color(0xffffff),
  2: new THREE.Color(0xffffff),
  3: new THREE.Color(0xffffff)
};

// ─── Texture / material cache ─────────────────────────────────────────────────
const _texLoader = new THREE.TextureLoader();
const LEAF_TEX = {};
const LEAF_MAT = {};
const BARK_MAT = {};

[1, 2, 3].forEach(sid => {
  const cfg      = SPECIES_CONFIG[sid];
  LEAF_TEX[sid]  = _texLoader.load(cfg.leafUrl);
  LEAF_MAT[sid]  = new THREE.MeshLambertMaterial({
    map: LEAF_TEX[sid], transparent: true,
    alphaTest: cfg.alphaTest, side: THREE.DoubleSide, depthWrite: false
  });
  BARK_MAT[sid]  = new THREE.MeshLambertMaterial({ color: BARK_COLOR[sid] });
});

// ─── Diameter LOD breakpoints (log-spaced, 0.01 → 6.26 m) ────────────────────
// 12 steps so the worst-case residual scale within any band is ≤ ~1.42×,
// small enough to be imperceptible while keeping PlantFATE geometry accurate.
const DIAMETER_STEPS = [
  0.010, 0.018, 0.032, 0.056, 0.100,
  0.180, 0.320, 0.560, 1.000, 1.780,
  3.160, 5.620
];

/**
 * Returns the index of the largest DIAMETER_STEPS value ≤ D.
 * Falls back to 0 for very small seedlings.
 */
function lodIndexForDiameter(D) {
  let idx = 0;
  for (let i = 0; i < DIAMETER_STEPS.length; i++) {
    if (DIAMETER_STEPS[i] <= D) idx = i;
    else break;
  }
  return idx;
}

// ─── Branch geometry builder (PlantFATE-driven) ───────────────────────────────
const _up = new THREE.Vector3(0, 1, 0);

function collectBranchGeometries(
  barkGeos, leafGeos,
  currentZ, length, thickness,
  depth, speciesId, maxDepth,
  worldMatrix, pfMath, H
) {
  const cfg    = SPECIES_CONFIG[speciesId] || SPECIES_CONFIG[1];
  const nextZ  = currentZ + length;

  // PlantFATE stem taper at bottom and top of this segment
  const radiusBottom    = Math.max(0.005, pfMath.stemRadiusAtHeight(currentZ, H));
  const radiusTop       = Math.max(0.002, pfMath.stemRadiusAtHeight(nextZ,    H));

  const cylGeo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 6);
  cylGeo.translate(0, length / 2, 0);
  cylGeo.applyMatrix4(worldMatrix);
  barkGeos.push(cylGeo);

  const tipMatrix = worldMatrix.clone();
  tipMatrix.multiply(new THREE.Matrix4().makeTranslation(0, length, 0));

  // Leaf cross-planes at tips
  if (depth >= maxDepth || nextZ >= H) {
    const planeSize = length * cfg.leafSizeFactor;
    const pGeo      = new THREE.PlaneGeometry(planeSize, planeSize);
    pGeo.translate(0, planeSize / 2, 0);

    const p1 = pGeo.clone();
    p1.applyMatrix4(tipMatrix);
    leafGeos.push(p1);

    const p2  = pGeo.clone();
    const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    p2.applyMatrix4(rot);
    p2.applyMatrix4(tipMatrix);
    leafGeos.push(p2);

    pGeo.dispose();
    return;
  }

  // PlantFATE crown radius envelope — clip branch length to stay inside it
  const allowedCrownRadius = pfMath.calculateCrownRadiusAtHeight(nextZ, H);
  let   nextLength          = length * cfg.lengthTaper;
  if (depth > 0 && nextLength > allowedCrownRadius) {
    nextLength = allowedCrownRadius * 0.5;
  }

  const nextThickness = radiusTop;
  const angle         = cfg.branchAngle;
  const rotOffset     = Math.random() * Math.PI * 2;

  for (let i = 0; i < 4; i++) {
    const twist       = rotOffset + i * (Math.PI / 2);
    const childMatrix = tipMatrix.clone();
    childMatrix.multiply(
      new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(angle, twist, 0, 'YXZ'))
    );
    collectBranchGeometries(
      barkGeos, leafGeos,
      nextZ, nextLength, nextThickness,
      depth + 1, speciesId, maxDepth,
      childMatrix, pfMath, H
    );
  }
}

/**
 * Builds merged bark+leaf geometry for a tree at a specific diameter.
 * This is the function called once per LOD step at startup.
 */
function buildMergedTreeGeo(D, speciesId) {
  const sid = speciesId || 1;
  const pf  = new PlantFATEMath(D);
  const H   = pf.calculateHeight();
  if (H <= 0) return null;

  const maxDepth    = sid === 2 ? 5 : 4;
  const trunkLength = H * 0.38;

  const barkGeos = [];
  const leafGeos = [];

  collectBranchGeometries(
    barkGeos, leafGeos,
    0, trunkLength, D,
    0, sid, maxDepth,
    new THREE.Matrix4(), pf, H
  );

  const mergedBark = barkGeos.length
    ? THREE.BufferGeometryUtils.mergeBufferGeometries(barkGeos) : null;
  const mergedLeaf = leafGeos.length
    ? THREE.BufferGeometryUtils.mergeBufferGeometries(leafGeos) : null;

  barkGeos.forEach(g => g.dispose());
  leafGeos.forEach(g => g.dispose());

  return { bark: mergedBark, leaf: mergedLeaf };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_TREES = 5;
const LAND_SIZE = 500;
const LAND_AREA = LAND_SIZE * LAND_SIZE;

// ─── ForestScene ──────────────────────────────────────────────────────────────
class ForestScene {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0c120d);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = _texLoader.load('images/background.png');
    this.scene.fog = new THREE.Fog(0x0c120d, 400, 1200);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 2000);
    this.camera.position.set(0, 80, 250);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 15, 0);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.07;
    this.controls.update();

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xfff5e6, 0.9);
    sun.position.set(150, 300, 100);
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
    groundTex.repeat.set(40, 40);
    groundTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(LAND_SIZE, LAND_SIZE),
      new THREE.MeshLambertMaterial({ map: groundTex, color: 0x4a3728 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(LAND_SIZE, 40, 0x1a2b1f, 0x111c15);
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// ─── ForestManager ────────────────────────────────────────────────────────────
class ForestManager {
  constructor(scene3) {
    this.s3          = scene3;
    this.forestGroup = new THREE.Group();
    this.s3.scene.add(this.forestGroup);

    this.positions  = {};   // key → [[x,z], ...]
    this.allYears   = [];
    this.playing    = false;
    this.speed      = 10;

    this.currentYearFloat = 0;
    this._lastTime        = null;

    // instancedMeshes[sid][lodIndex] = { bark: InstancedMesh, leaf: InstancedMesh }
    this.instancedMeshes             = {};
    this._maxPossibleInstancePerStep = 600; // per species per LOD step
  }

  init(data) {
    this.data     = data;
    this.allYears = Object.keys(data).map(Number).sort((a, b) => a - b);
    if (this.allYears.length > 0) {
      this._initLODMeshes();
      this._initPositions();
      this.currentYearFloat = this.allYears[0];
      this._renderCurrentTimelineFrame();
    }
  }

  // ── Build one InstancedMesh pair per species × LOD step ──────────────────
  _initLODMeshes() {
    [1, 2, 3].forEach(sid => {
      this.instancedMeshes[sid] = [];

      DIAMETER_STEPS.forEach((D, lodIdx) => {
        const proto = buildMergedTreeGeo(D, sid);
        if (!proto || !proto.bark || !proto.leaf) {
          this.instancedMeshes[sid][lodIdx] = null;
          return;
        }

        const barkIM = new THREE.InstancedMesh(proto.bark, BARK_MAT[sid], this._maxPossibleInstancePerStep);
        const leafIM = new THREE.InstancedMesh(proto.leaf, LEAF_MAT[sid], this._maxPossibleInstancePerStep);
        barkIM.count = 0;
        leafIM.count = 0;
        this.forestGroup.add(barkIM);
        this.forestGroup.add(leafIM);

        this.instancedMeshes[sid][lodIdx] = { bark: barkIM, leaf: leafIM };

        // prototype geometry no longer needed on CPU
        proto.bark.dispose();
        proto.leaf.dispose();
      });
    });
  }

  // ── Space-repulsion layout (preserved exactly) ────────────────────────────
  _initPositions() {
    const uniqueCohortKeys = new Set();
    this.allYears.forEach(year => {
      (this.data[year] || []).forEach(co => uniqueCohortKeys.add(`${co.s}_${co.c}`));
    });

    const flatPointsList  = [];
    const mapExtentLimit  = (LAND_SIZE / 2) - 10;

    uniqueCohortKeys.forEach(key => {
      const [speciesId, cohortNum] = key.split('_').map(Number);

      let maxDensity = 0;
      this.allYears.forEach(year => {
        const found = (this.data[year] || []).find(c => c.s === speciesId && c.c === cohortNum);
        if (found && found.d > maxDensity) maxDensity = found.d;
      });

      const totalCounts  = Math.max(1, Math.round(maxDensity * LAND_AREA));
      const targetsCount = Math.max(1, Math.round(totalCounts * Math.min(1, MAX_TREES / Math.max(totalCounts, 1))));

      this.positions[key] = [];

      for (let j = 0; j < targetsCount; j++) {
        const pt = {
          key,
          x: -mapExtentLimit + Math.random() * (mapExtentLimit * 2),
          z: -mapExtentLimit + Math.random() * (mapExtentLimit * 2)
        };
        flatPointsList.push(pt);
        this.positions[key].push(pt);
      }
    });

    // Repulsion relaxation passes
    const separationBound  = 18.0;
    const passCount        = 15;

    for (let pass = 0; pass < passCount; pass++) {
      for (let i = 0; i < flatPointsList.length; i++) {
        for (let j = i + 1; j < flatPointsList.length; j++) {
          const a  = flatPointsList[i];
          const b  = flatPointsList[j];
          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const d  = Math.sqrt(dx * dx + dz * dz);

          if (d < separationBound && d > 0) {
            const overlap = separationBound - d;
            const pushX   = (dx / d) * overlap * 0.5;
            const pushZ   = (dz / d) * overlap * 0.5;

            a.x = Math.max(-mapExtentLimit, Math.min(mapExtentLimit, a.x + pushX));
            a.z = Math.max(-mapExtentLimit, Math.min(mapExtentLimit, a.z + pushZ));
            b.x = Math.max(-mapExtentLimit, Math.min(mapExtentLimit, b.x - pushX));
            b.z = Math.max(-mapExtentLimit, Math.min(mapExtentLimit, b.z - pushZ));
          }
        }
      }
    }

    // Flatten back to [x, z] pairs
    Object.keys(this.positions).forEach(key => {
      this.positions[key] = this.positions[key].map(pt => [pt.x, pt.z]);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  get totalYears() { return this.allYears.length; }

  showYear(index) {
    const safeIdx = Math.max(0, Math.min(index, this.allYears.length - 1));
    this.currentYearFloat = this.allYears[safeIdx];
    this._renderCurrentTimelineFrame();
  }

  next() {
    const idx = this.allYears.findIndex(y => y > this.currentYearFloat);
    if (idx !== -1) this.showYear(idx);
    else this.showYear(this.allYears.length - 1);
  }

  prev() {
    const idx = this.allYears.findIndex(y => y >= this.currentYearFloat);
    if (idx > 0) this.showYear(idx - 1);
    else if (idx === -1) this.showYear(this.allYears.length - 2);
  }

  togglePlay() { this.playing = !this.playing; this._lastTime = null; }

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

  // ── Core render: pick LOD step per cohort, apply small residual scale ─────
  _renderCurrentTimelineFrame() {
    const currentYearFloat = this.currentYearFloat;

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

    // instance counters per species per LOD step
    // instanceCounters[sid][lodIdx] = number
    const instanceCounters = {};
    [1, 2, 3].forEach(sid => {
      instanceCounters[sid] = new Array(DIAMETER_STEPS.length).fill(0);
    });

    let totalTreeCount = 0;
    const HUD = { 1: null, 2: null, 3: null };

    cohortsA.forEach(cA => {
      const cB              = cohortsB.find(c => c.s === cA.s && c.c === cA.c) || cA;
      const currentDiameter = cA.bd + (cB.bd - cA.bd) * t;
      if (currentDiameter <= 0) return;

      const sid    = cA.s || 1;
      const imBank = this.instancedMeshes[sid];
      if (!imBank) return;

      HUD[sid] = { bd: currentDiameter };

      // ── LOD selection ────────────────────────────────────────────────────
      // Pick the largest breakpoint diameter ≤ currentDiameter
      const lodIdx    = lodIndexForDiameter(currentDiameter);
      const lodD      = DIAMETER_STEPS[lodIdx];
      const imPair    = imBank[lodIdx];
      if (!imPair) return;

      // PlantFATE heights at the baked LOD diameter vs the real diameter
      const pfLOD     = new PlantFATEMath(lodD);
      const pfReal    = new PlantFATEMath(currentDiameter);
      const heightLOD = pfLOD.calculateHeight();
      const heightReal= pfReal.calculateHeight();

      // Residual scale: how much larger/taller is the real tree vs the baked prototype?
      // This is small (≤ ~1.42×) because breakpoints are log-spaced tightly enough.
      const residualXZ = currentDiameter / lodD;
      const residualY  = heightLOD > 0 ? heightReal / heightLOD : 1.0;

      const key    = `${cA.s}_${cA.c}`;
      const coords = this.positions[key];
      if (!coords) return;

      coords.forEach(([x, z]) => {
        const currentIdx = instanceCounters[sid][lodIdx];
        if (currentIdx >= this._maxPossibleInstancePerStep) return;

        const rotY = (cA.c * 13.37) % (Math.PI * 2);

        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          new THREE.Quaternion().setFromAxisAngle(_up, rotY),
          // Residual scale is small — keeps visual continuity while using
          // correctly-shaped PlantFATE geometry from the nearest LOD step
          new THREE.Vector3(residualXZ, residualY, residualXZ)
        );

        imPair.bark.setMatrixAt(currentIdx, matrix);
        imPair.leaf.setMatrixAt(currentIdx, matrix);

        instanceCounters[sid][lodIdx]++;
        totalTreeCount++;
      });
    });

    // Sync all LOD steps to GPU
    [1, 2, 3].forEach(sid => {
      const imBank = this.instancedMeshes[sid];
      DIAMETER_STEPS.forEach((_, lodIdx) => {
        const imPair = imBank[lodIdx];
        if (!imPair) return;
        imPair.bark.count = instanceCounters[sid][lodIdx];
        imPair.leaf.count = instanceCounters[sid][lodIdx];
        imPair.bark.instanceMatrix.needsUpdate = true;
        imPair.leaf.instanceMatrix.needsUpdate = true;
      });
    });

    const currentDisplayYear = Math.floor(currentYearFloat);
    UI.update(currentDisplayYear, baseIdx, this.allYears.length, cohortsA);

    const statTrees = document.getElementById('stat-trees');
    if (statTrees) statTrees.textContent = totalTreeCount;

    [1, 2, 3].forEach(sid => {
      const el = document.getElementById(`s${sid}-basal-dia`);
      if (el) el.textContent = HUD[sid] ? HUD[sid].bd.toFixed(3) + ' m' : '--';
    });
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────
const UI = {
  yearEl:   document.getElementById('year-display'),
  cohortEl: document.getElementById('year-cohort-line'),
  fillEl:   document.getElementById('progress-fill'),
  thumbEl:  document.getElementById('progress-thumb'),
  statC:    document.getElementById('stat-cohorts'),
  playBtn:  document.getElementById('btn-play'),

  update(year, index, total, cohorts) {
    if (this.yearEl)   this.yearEl.textContent   = year;
    if (this.cohortEl) this.cohortEl.textContent = `${cohorts.length} cohorts active`;
    const pct = (index / Math.max(total - 1, 1)) * 100;
    if (this.fillEl)   this.fillEl.style.width = pct + '%';
    if (this.thumbEl)  this.thumbEl.style.left  = pct + '%';
    if (this.statC)    this.statC.textContent   = cohorts.length;
  },

  setPlayBtn(playing) {
    if (!this.playBtn) return;
    this.playBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
    this.playBtn.classList.toggle('active', playing);
  }
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const container = document.getElementById('simulation-viewport');
const scene3    = new ForestScene(container);
const forest    = new ForestManager(scene3);

function waitForData() {
  Papa.parse('cohort_props.csv', {
    download: true,
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete(results) {
      const byYear = {};
      results.data.forEach(row => {
        const yr = Math.floor(row.YEAR);
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
    error(err) { console.error('CSV parse error:', err); }
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
    scene3.camera.position.set(0, 80, 250);
    scene3.controls.target.set(0, 15, 0);
    scene3.controls.update();
  };
  if (q('btn-play')) q('btn-play').onclick = () => {
    forest.togglePlay();
    UI.setPlayBtn(forest.playing);
  };

  const pw = q('progress-wrap');
  if (pw) pw.addEventListener('click', e => {
    const pct = (e.clientX - pw.getBoundingClientRect().left) / pw.offsetWidth;
    forest.showYear(Math.round(pct * (forest.totalYears - 1)));
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'n' || e.key === 'N') forest.next();
    if (e.key === 'p' || e.key === 'P') forest.prev();
    if (e.key === 'r' || e.key === 'R') {
      scene3.camera.position.set(0, 80, 250);
      scene3.controls.target.set(0, 15, 0);
      scene3.controls.update();
    }
    if (e.key === ' ') { e.preventDefault(); forest.togglePlay(); UI.setPlayBtn(forest.playing); }
  });
}

waitForData();
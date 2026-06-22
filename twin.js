// Dedicated configuration parameters mapped to individual species IDs
const SPECIES_CONFIGS = {
  1: { 
    Hm: 30,    // Maximum Height
    a: 75,     // Stem Slenderness Ratio
    c: 600,    // Area Ratio
    m: 2.0,    // Crown Shape Parameter 
    n: 1.0,    // Crown Shape Parameter 
    rho_s: 0.6 // Density 
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

  calculateHeight() { 
    return this.height; 
  }

  calculateCrownArea() { 
    return this.crownArea; 
  }

  getMaxCrownRadius() { 
    return this.maxCrownRadius; 
  }

  calculateSapwoodFraction() {
    const H = this.height;
    if ((this.a * this.D) === 0) 
      return 0;
    return H / (this.a * this.D);
  }

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
    const heightRatio = z / H;
    const taperFactor = 1.0 - Math.pow(heightRatio, 1.5);
    return baseRadius * taperFactor;
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
      alphaTest: 0.5
    });
    
    BARK_MAT[sid] = new THREE.MeshLambertMaterial({ 
      color: BARK_COLOR[sid] 
    });
  });
  
  function buildCrownLathePts(pf, H, crownBaseZ, segments) {
    segments = segments || 32;
    const pts = [];

    // Explicitly close the bottom cap of the canopy profile
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
    const crownBaseZ = (pf.zmratio > 0)? Math.max(H*0.20, Math.min(H * 0.85, H * pf.zmratio * 0.5)): H * 0.30;
    const trunkHeight = crownBaseZ;
    const rBase = pf.stemRadiusAtHeight(0, H) / (sampleDiameter / 2);
    const rTop = pf.stemRadiusAtHeight(trunkHeight, H) / (sampleDiameter / 2);
    const trunkGeo = new THREE.CylinderGeometry(rTop, rBase, 1.0, 8);
    trunkGeo.translate(0, 0.5, 0); 
    const lathePts = buildCrownLathePts(pf, H, crownBaseZ, 32);
    const crownGeo = new THREE.LatheGeometry(lathePts, 16);
    const crownLength = H - trunkHeight;
    if (crownLength > 0) {
      const localOffsetT = trunkHeight / crownLength;
      crownGeo.translate(0, localOffsetT, 0); 
    }
    return { trunkTemplate: trunkGeo, crownTemplate: crownGeo };
  }
  
  // Creating one template per species 
  const SPECIES_TEMPLATES = {
    1: buildUnitTemplateGeometry(1),
    2: buildUnitTemplateGeometry(2),
    3: buildUnitTemplateGeometry(3)
  };
  
  const LAND_AREA = 110 * 110;
  
  class ForestScene {
    constructor(container) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(container.clientWidth, container.clientHeight);
      this.renderer.setClearColor(0x0c120d);
      container.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();

      this.scene.background = _texLoader.load('images/background.png'); // Adding background image 
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
      const groundTex = _texLoader.load('images/soil.png'); // Adding the ground image 
      groundTex.wrapS = THREE.RepeatWrapping;
      groundTex.wrapT = THREE.RepeatWrapping;
      groundTex.repeat.set(10, 10); // Tiling the ground image across 
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(110, 110),
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
      const masterCohortList = [];
      const globalScaleFactor = 100;
      const width = 100;
      const height = 100;
  
      // Gathering cohort density specifications from CSV rows
      this.allYears.forEach(year => {
        const cohorts = this.data[year] || [];
        cohorts.forEach(co => {
          const key = `S${co.s}_C${co.c}`;
          if (!masterCohortList.some(item => item.key === key)) {
            masterCohortList.push({
              key: key,
              s: co.s,
              c: co.c,
              d: co.d
            });
          }
        });
      });
  
      // Mapping CSV rows directly to deterministic space coordinates
      masterCohortList.forEach(co => {
        this.positions[co.key] = [];
        const totalTrees = Math.max(1, Math.round(co.d * globalScaleFactor));
  
        for (let i = 0; i < totalTrees; i++) {
          // A deterministic sine-wave hash function 
          const seedX = co.s * 12.9898 + co.c * 78.233 + i * 37.719;
          const seedZ = co.s * 43.1415 + co.c * 19.543 + i * 91.321;
          
          // Generate values strictly between -0.5 and 0.5 based on the seed
          const hashX = Math.sin(seedX) * 43758.5453123;
          const hashZ = Math.sin(seedZ) * 23421.6312311;
          
          const fracX = hashX - Math.floor(hashX) - 0.5;
          const fracZ = hashZ - Math.floor(hashZ) - 0.5;
  
          const finalX = fracX * width;
          const finalZ = fracZ * height;
  
          this.positions[co.key].push([finalX, finalZ]);
        }
      });
    }
  
    get totalYears() { 
      return this.allYears.length; 
    }
  
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
  
      const activeInstances = [];
  
      cohortsA.forEach(cA => {
        const cB = cohortsB.find(c => c.s === cA.s && c.c === cA.c) || cA;
        const currentDiameter = cA.bd + (cB.bd - cA.bd) * t;
        if (currentDiameter <= 0) return; 
  
        const sid = cA.s || 1;
        const pf = new PlantFATEMath(currentDiameter, sid);
        activeMathProfiles[sid] = pf;
  
        const H = pf.calculateHeight();

        if (H >= (pf.Hm * 0.98)) return; 
  
        const crownBaseZ = (pf.zmratio > 0)? Math.max(H*0.20, Math.min(H * 0.85, H * pf.zmratio * 0.5)): H * 0.30;
        const trunkHeight = crownBaseZ;
        const rBase = pf.stemRadiusAtHeight(0, H);
        const maxCrownRadius = pf.getMaxCrownRadius();
  
        const key = `S${cA.s}_C${cA.c}`;
        const coords = this.positions[key] || [];
  
        coords.forEach(([x, z], cIdx) => {
          activeInstances.push({
            x, z,
            sid,
            cohortNum: cA.c,
            height: H,
            trunkHeight,
            rBase,
            maxCrownRadius,
            key,
            cIdx,
            templates: SPECIES_TEMPLATES[sid]
          });
        });
      });
  
      const instancedMeshGroups = {};
      activeInstances.forEach(inst => {
        if (!instancedMeshGroups[inst.key]) {
          instancedMeshGroups[inst.key] = {
            sid: inst.sid,
            count: 0,
            instances: [],
            barkIM: new THREE.InstancedMesh(inst.templates.trunkTemplate, BARK_MAT[inst.sid], this.positions[inst.key].length),
            leafIM: new THREE.InstancedMesh(inst.templates.crownTemplate, LEAF_MAT[inst.sid], this.positions[inst.key].length)
          };
        }
        instancedMeshGroups[inst.key].instances.push(inst);
      });
  
      // Computing dynamic bending vectors based strictly on overlapping intersection area
      activeInstances.forEach(treeA => {
        treeA.bendAxis = new THREE.Vector3(0, 0, 1);
        treeA.bendAngle = 0;
  
        let totalWeightX = 0;
        let totalWeightZ = 0;
  
        activeInstances.forEach(treeB => {
          if (treeA === treeB) return;
  
          const dx = treeA.x - treeB.x;
          const dz = treeA.z - treeB.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          
          const rA = treeA.maxCrownRadius;
          const rB = treeB.maxCrownRadius;
          const radiusSum = rA + rB;
  
          // Bending occurs if canopies overlap 
          if (distance < radiusSum && distance > 0.01 ) {
            
            let intersectionArea = 0;
            const rA2 = rA * rA;
            const rB2 = rB * rB;
            
            if (distance <= Math.abs(rA - rB)) {
              intersectionArea = Math.PI * Math.pow(Math.min(rA, rB), 2);
            } else {
              const d2 = distance * distance;
  
              const cosAlpha = Math.min(1, Math.max(-1, (rA2 + d2 - rB2) / (2 * rA * distance)));
              const cosBeta  = Math.min(1, Math.max(-1, (rB2 + d2 - rA2) / (2 * rB * distance)));
  
              const alpha = Math.acos(cosAlpha);
              const beta = Math.acos(cosBeta);
  
              const term1 = rA2 * alpha - rA2 * Math.sin(2 * alpha) / 2;
              const term2 = rB2 * beta - rB2 * Math.sin(2 * beta) / 2;
              
              intersectionArea = Math.max(0, term1 + term2);
            }
  
            const totalAreaA = Math.PI * rA2;
            const overlapRatio = totalAreaA > 0 ? (intersectionArea / totalAreaA) : 0;
  
            if (overlapRatio > 0) {
              totalWeightX += (dx / distance) * overlapRatio;
              totalWeightZ += (dz / distance) * overlapRatio;
            }
          }
        });
  
        const pushLength = Math.sqrt(totalWeightX * totalWeightX + totalWeightZ * totalWeightZ);
        if (pushLength > 0) {
          const pushDir = new THREE.Vector3(totalWeightX / pushLength, 0, totalWeightZ / pushLength);
          treeA.bendAngle = Math.min(0.44, pushLength * 0.35);
  
          // Explicit structural cross-product forces authentic outward phototropic tilt curves
          treeA.bendAxis.crossVectors(_up, pushDir).normalize();
        }
      });
  
      // Process instanced mesh configurations with rigid trunks and flexible canopies
      Object.keys(instancedMeshGroups).forEach(key => {
        const group = instancedMeshGroups[key];
        
        group.instances.forEach(tree => {
          const rotY = (tree.cohortNum * 13.37) % (Math.PI * 2);
          const qtrSpin = new THREE.Quaternion().setFromAxisAngle(_up, rotY);
          let qtrTotalTrunk = qtrSpin.clone();
          let qtrTotalCrown = qtrSpin.clone();
          if (tree.bendAngle > 0) {
            const qtrTilt = new THREE.Quaternion().setFromAxisAngle(tree.bendAxis, tree.bendAngle);
            qtrTotalCrown.premultiply(qtrTilt);
            qtrTotalTrunk.premultiply(qtrTilt);
          }
          const trunkScale = new THREE.Vector3(tree.rBase * 2, tree.trunkHeight, tree.rBase * 2);
          const trunkPos = new THREE.Vector3(tree.x, 0, tree.z);
          const trunkMatrix = new THREE.Matrix4().compose(trunkPos, qtrTotalTrunk, trunkScale);
          group.barkIM.setMatrixAt(tree.cIdx, trunkMatrix);
          const crownLength = tree.height - tree.trunkHeight;
          const crownScale = new THREE.Vector3(tree.maxCrownRadius, crownLength, tree.maxCrownRadius);
          const crownPos = new THREE.Vector3(tree.x, 0, tree.z); 
          const crownMatrix = new THREE.Matrix4().compose(crownPos, qtrTotalCrown, crownScale);
          group.leafIM.setMatrixAt(tree.cIdx, crownMatrix);
          totalTreeCount++;
        });
  
        group.barkIM.instanceMatrix.needsUpdate = true;
        group.leafIM.instanceMatrix.needsUpdate = true;
        this.forestGroup.add(group.barkIM);
        this.forestGroup.add(group.leafIM);
      });
  
      // Pass the numeric floor of the fractional playback year to the UI HUD
      UI.update(Math.floor(currentYearFloat), cohortsA);
  
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
  }
  
  // UI controller methods targeting HUD overlays
  const UI = {
    statY: document.getElementById('stat-year'),
    statC: document.getElementById('stat-cohorts'),
  
    update(year, cohorts) {
      if (this.statY) this.statY.textContent = year;
      if (this.statC) this.statC.textContent = cohorts.length;
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
      if (e.key.toLowerCase() === 'r') {
        scene3.camera.position.set(0, 35, 65);
        scene3.controls.target.set(0, 4, 0);
        scene3.controls.update();
      }
    });
  }
  
  waitForData();
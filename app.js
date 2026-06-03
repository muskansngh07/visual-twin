// PlantFATE Math
const traits = {
    Hm: 35, // Maximum height
    a: 75, // stem slenderness ratio
    c: 6000, // area ratio
    m: 1.5, // crown shape parameter
    n:2, // crown shape parameter
    rho_s:    0.6, // wood density
  };
  
  function tree_height(Hm, D, a) {
    return Hm * (1 - Math.exp((-a * D) / Hm));
  }
  
  // A wrapper 
  const PlantFATEMath = {
    height(D) { return tree_height(traits.Hm, D, traits.a); }
  };
  
  // species configuration
  const SPECIES_CONFIG = {
    1: { 
        leafUrl: 'images/tree1.png', 
        leafSizeFactor: 2.0, 
        branchAngle: 0.70, 
        lengthTaper: 0.68, 
        alphaTest: 0.08 
    },
    2: { 
        leafUrl: 'images/tree2.png', 
        leafSizeFactor: 1.0, 
        branchAngle: 0.55, 
        lengthTaper: 0.70, 
        alphaTest: 0.15 
    },
    3: { 
        leafUrl: 'images/tree3.png', 
        leafSizeFactor: 1.5, 
        branchAngle: 0.60, 
        lengthTaper: 0.75, 
        alphaTest: 0.08 
    }
  };

  // species specific bark configuration
  const BARK_COLOR = {
    1: new THREE.Color(0x4a2c0a),
    2: new THREE.Color(0x3b2508),
    3: new THREE.Color(0x5c3a12)
  };
  
  // texture and material cache 
  const _texLoader = new THREE.TextureLoader();
  const LEAF_TEX   = {};
  const LEAF_MAT   = {};
  const BARK_MAT   = {};
  
  [1, 2, 3].forEach(sid => {
    const cfg = SPECIES_CONFIG[sid];
    LEAF_TEX[sid] = _texLoader.load(cfg.leafUrl);
    LEAF_MAT[sid] = new THREE.MeshLambertMaterial({
      map:        LEAF_TEX[sid],
      transparent: true,               // has to be true for alphaTest to work as it controls visibility 
      alphaTest:  cfg.alphaTest,
      side:       THREE.DoubleSide,
      depthWrite: false
    });
    BARK_MAT[sid] = new THREE.MeshLambertMaterial({ color: BARK_COLOR[sid] });
  });
  
  // geometry only tree builder 
  const _up = new THREE.Vector3(0, 1, 0);
  
  function collectBranchGeometries(barkGeos, leafGeos, length, thickness, depth, speciesId, maxDepth, worldMatrix) {
    const cfg = SPECIES_CONFIG[speciesId] || SPECIES_CONFIG[1];
  
    // bark cylinder
    const cylGeo = new THREE.CylinderGeometry(thickness * 0.7, thickness, length, 6);
    cylGeo.translate(0, length / 2, 0);
    cylGeo.applyMatrix4(worldMatrix);
    barkGeos.push(cylGeo);
  
    // tip world matrix
    const tipMatrix = worldMatrix.clone();
    tipMatrix.multiply(new THREE.Matrix4().makeTranslation(0, length, 0));
  
    // Base case: leaf cross-planes at tip
    if (depth >= maxDepth) {
      const planeSize = length * cfg.leafSizeFactor;
      const pGeo = new THREE.PlaneGeometry(planeSize, planeSize);
      pGeo.translate(0, planeSize / 2, 0);
  
      // plane 1
      const p1 = pGeo.clone();
      p1.applyMatrix4(tipMatrix);
      leafGeos.push(p1);
  
      // plane 2 at 90 degrees to p1
      const p2 = pGeo.clone();
      const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      p2.applyMatrix4(rot);
      p2.applyMatrix4(tipMatrix);
      leafGeos.push(p2);
  
      pGeo.dispose();
      return;
    }
  
    // recurse for 4-way split branches 
    const nextLength    = length * cfg.lengthTaper;
    const nextThickness = thickness * 0.64;
    const angle         = cfg.branchAngle;
    const rotOffset = Math.random() * Math.PI * 2;
  
    for (let i = 0; i < 4; i++) {
      const twist = rotOffset + i * (Math.PI / 2);
      const childMatrix = tipMatrix.clone();
      childMatrix.multiply(
        new THREE.Matrix4().makeRotationFromEuler(
          new THREE.Euler(angle, twist, 0, 'YXZ')
        )
      );
      collectBranchGeometries(barkGeos, leafGeos, nextLength, nextThickness, depth + 1, speciesId, maxDepth, childMatrix);
    }
  }
  
  // building the trees by merging geometries 
  function buildMergedTreeGeo(D, speciesId) {
    const sid   = speciesId || 1;
    const H     = PlantFATEMath.height(D);
    if (H <= 0) return null;
  
    const maxDepth      = sid === 2 ? 5 : 4;
    const trunkLength   = H * 0.38;
    const baseThickness = D * 0.5;
  
    const barkGeos = [];
    const leafGeos = [];
  
    collectBranchGeometries(
      barkGeos, leafGeos,
      trunkLength, baseThickness,
      0, sid, maxDepth,
      new THREE.Matrix4()
    );
  
    const mergedBark = barkGeos.length ? THREE.BufferGeometryUtils.mergeBufferGeometries(barkGeos) : null;
    const mergedLeaf = leafGeos.length ? THREE.BufferGeometryUtils.mergeBufferGeometries(leafGeos) : null;
  
    barkGeos.forEach(g => g.dispose());
    leafGeos.forEach(g => g.dispose());
  
    return { bark: mergedBark, leaf: mergedLeaf };
  }
  
  // constants 
  const MAX_TREES = 10;
  const LAND_AREA = 100 * 100; // land area 
  
  // the scene
  class ForestScene {
    constructor(container) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(container.clientWidth, container.clientHeight);
      this.renderer.setClearColor(0x0c120d);
      this.renderer.shadowMap.enabled = false;
      container.appendChild(this.renderer.domElement);
  
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.Fog(0x0c120d, 80, 220);
  
      this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 500);
      this.camera.position.set(0, 8, 22);
  
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(0, 4, 0);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.07;
      this.controls.update();
  
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
      const groundTex = _texLoader.load('images/soil.png'); // loads the soil image 
      
      // to tile the image across the directions 
      groundTex.wrapS = THREE.RepeatWrapping;
      groundTex.wrapT = THREE.RepeatWrapping;
      groundTex.repeat.set(10, 10);  // each tile contains 10 units 
      groundTex.anisotropy= this.renderer.capabilities.getMaxAnisotropy();

      // building the ground by merging the geometry and the material 
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshLambertMaterial({ map: groundTex, color: 0x4a3728 })
      );
      ground.rotation.x = -Math.PI / 2;
      this.scene.add(ground);
  
      const grid = new THREE.GridHelper(100, 20, 0x1a2b1f, 0x111c15);
      grid.position.y = 0.02;
      this.scene.add(grid);
    }
  
    render() {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }
  }
  
  // forest manager 
  class ForestManager {
    constructor(scene3) {
      this.s3          = scene3;
      this.forestGroup = new THREE.Group();
      this.s3.scene.add(this.forestGroup);
  
      this.positions  = {};
      this.allYears   = [];
      this.yearIndex  = 0;
      this.playing    = false;
      this.speed      = 1;
      this._playAccum = 0;
      this._lastTime  = null;
      this._t=0;
    }
  
    init(data) {
      this.data     = data;
      this.allYears = Object.keys(data).map(Number).sort((a, b) => a - b);
      this.showYear(0);
    }
  
    get totalYears() { return this.allYears.length; }
  
    showYear(index) 
    {
        this._t=0;
        this.yearIndex = Math.max(0, Math.min(index, this.allYears.length - 1));
        const yr       = this.allYears[this.yearIndex];
        const cohorts  = this.data[yr] || [];
        this._buildForest(cohorts);
        UI.update(yr, this.yearIndex, this.totalYears, cohorts);
    }
  
    next() { if (this.yearIndex < this.totalYears - 1) this.showYear(this.yearIndex + 1); }
    prev() { if (this.yearIndex > 0)                   this.showYear(this.yearIndex - 1); }
  
    togglePlay() { this.playing = !this.playing; this._lastTime = null; }
  
    tick(now) {
        if (!this.playing) return;
        if (this._lastTime === null) { this._lastTime = now; return; }
        const dt = (now - this._lastTime) / 1000;
        this._lastTime = now;
      
        this._t += dt * this.speed * (1 / 1.2);  // 0→1 over 1.2s
      
        if (this._t >= 1) {
          this._t = 0;
          if (this.yearIndex < this.totalYears - 1) {
            this.yearIndex++;
            this._buildForest(this.data[this.allYears[this.yearIndex]]);
            UI.update(this.allYears[this.yearIndex], this.yearIndex, this.totalYears, this.data[this.allYears[this.yearIndex]]);
          } else {
            this.playing = false;
            UI.setPlayBtn(false);
          }
        }
      
        // smoothly scale forest between current and next year size
        this._applyGrowthScale(this._t);
    }
  
    _buildForest(cohorts) {
      this.forestGroup.children.forEach(mesh => {
        if (mesh.geometry) mesh.geometry.dispose();
      });
      this.forestGroup.clear();
  
      const counts = cohorts.map(c => Math.max(1, Math.round(c.d * LAND_AREA)));
      const total  = counts.reduce((a, b) => a + b, 0);
      const scale  = Math.min(1, MAX_TREES / Math.max(total, 1));
  
      let treeCount = 0;
      const HUD = { 1: null, 2: null, 3: null };
  
      for (let i = 0; i < cohorts.length; i++) {
        const co  = cohorts[i];
        const n   = Math.max(1, Math.round(counts[i] * scale));
        const sid = co.s || 1;
        const key = `${co.s}_${co.c}`;
  
        if (!HUD[sid]) HUD[sid] = co;
  
        if (!this.positions[key]) this.positions[key] = [];
        while (this.positions[key].length < n) {
          this.positions[key].push([
            (Math.random() - 0.5) * 94,
            (Math.random() - 0.5) * 94
          ]);
        }
        const coords = this.positions[key].slice(0, n);
  
        const proto = buildMergedTreeGeo(co.bd, sid);
        if (!proto) continue;
  
        const cohortBark = [];
        const cohortLeaf = [];
  
        for (const [x, z] of coords) {
          const rotY = Math.random() * Math.PI * 2;
          const mat4 = new THREE.Matrix4().compose(
            new THREE.Vector3(x, 0, z),
            new THREE.Quaternion().setFromAxisAngle(_up, rotY),
            new THREE.Vector3(1, 1, 1)
          );
  
          if (proto.bark) { const b = proto.bark.clone(); b.applyMatrix4(mat4); cohortBark.push(b); }
          if (proto.leaf) { const l = proto.leaf.clone(); l.applyMatrix4(mat4); cohortLeaf.push(l); }
          treeCount++;
        }
  
        if (cohortBark.length) {
          const geo = THREE.BufferGeometryUtils.mergeBufferGeometries(cohortBark);
          this.forestGroup.add(new THREE.Mesh(geo, BARK_MAT[sid]));
          cohortBark.forEach(g => g.dispose());
        }
        if (cohortLeaf.length) {
          const geo = THREE.BufferGeometryUtils.mergeBufferGeometries(cohortLeaf);
          this.forestGroup.add(new THREE.Mesh(geo, LEAF_MAT[sid]));
          cohortLeaf.forEach(g => g.dispose());
        }
  
        if (proto.bark) proto.bark.dispose();
        if (proto.leaf) proto.leaf.dispose();
      }
  
      const statTrees = document.getElementById('stat-trees');
      if (statTrees) statTrees.textContent = treeCount;
  
      [1, 2, 3].forEach(sid => {
        const el = document.getElementById(`s${sid}-basal-dia`);
        if (el) el.textContent = HUD[sid] ? HUD[sid].bd.toFixed(3) + ' m' : '--';
      });
    }

    _applyGrowthScale(t) {
        if (this.yearIndex >= this.totalYears - 1) return;
        const currCohorts = this.data[this.allYears[this.yearIndex]];
        const nextCohorts = this.data[this.allYears[this.yearIndex + 1]];
      
        this.forestGroup.children.forEach((mesh, idx) => {
          const cohortIndex = Math.floor(idx / 2); // bark + leaf = 2 meshes per cohort
          const curr = currCohorts[cohortIndex];
          const next = nextCohorts
            ? nextCohorts.find(c => c.s === curr.s && c.c === curr.c)
            : null;
          if (!curr || !next || curr.bd <= 0) return;
      
          const scaleVal = 1 + (next.bd / curr.bd - 1) * t;
          mesh.scale.setScalar(scaleVal);
        });
      }
  }
  
  // user interface 
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
      if (this.fillEl)  this.fillEl.style.width = pct + '%';
      if (this.thumbEl) this.thumbEl.style.left  = pct + '%';
      if (this.statC)   this.statC.textContent   = cohorts.length;
    },
  
    setPlayBtn(playing) {
      if (!this.playBtn) return;
      this.playBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
      this.playBtn.classList.toggle('active', playing);
    }
  };
  
  // bootstrapping 
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
          const yr  = Math.floor(row.YEAR);   // YEAR is a float like 2000.04166667
          if (!byYear[yr]) byYear[yr] = [];
          byYear[yr].push({
            s:  row.speciesID,                // maps to sid
            c:  row.cohortNum,                // cohort identifier for stable positions
            d:  row.density,                  // trees per m² — used for tree count
            bd: row.basal_diameter,           // drives PlantFATE height + trunk thickness
            lai: row.lai,
            mort: row.mort,
            fec:  row.fec,
            gpp:  row.gpp
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
      scene3.camera.position.set(0, 8, 22);
      scene3.controls.target.set(0, 4, 0);
      scene3.controls.update();
    };
    if (q('btn-play')) q('btn-play').onclick = () => { forest.togglePlay(); UI.setPlayBtn(forest.playing); };
  
    ['spd-slow', 'spd-norm', 'spd-fast'].forEach((id, i) => {
      if (!q(id)) return;
      q(id).onclick = () => {
        forest.speed = [0.5, 1, 10][i];
        ['spd-slow', 'spd-norm', 'spd-fast'].forEach(b => { if (q(b)) q(b).classList.remove('active'); });
        q(id).classList.add('active');
      };
    });
  
    const pw = q('progress-wrap');
    if (pw) pw.addEventListener('click', e => {
      const pct = (e.clientX - pw.getBoundingClientRect().left) / pw.offsetWidth;
      forest.showYear(Math.round(pct * (forest.totalYears - 1)));
    });
  
    window.addEventListener('keydown', e => {
      if (e.key === 'n' || e.key === 'N') forest.next();
      if (e.key === 'p' || e.key === 'P') forest.prev();
      if (e.key === 'r' || e.key === 'R') {
        scene3.camera.position.set(0, 8, 22);
        scene3.controls.target.set(0, 4, 0);
        scene3.controls.update();
      }
      if (e.key === ' ') { e.preventDefault(); forest.togglePlay(); UI.setPlayBtn(forest.playing); }
    });
  }
  
waitForData();
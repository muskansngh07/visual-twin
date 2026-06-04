// PlantFATE Math
class PlantFATEMath{
    // PlantFATE parameters
    constructor(basalDiameter){
      this.Hm=35; // maximum height
      this.a=75; // stem slenderness ratio
      this.c=600; // area ratio
      this.m=1.5; // crown shape parameter
      this.n=2; // crown shape parameter
      this.rho_s=0.6; // wood density
      this.D=Number(basalDiameter); // basal diameter, from csv
  
      try{
        const denominator=(this.m*this.n)-1;
        const numerator=this.n-1;
        if(denominator==0 || this.n==0){
          throw new RangeError("ZeroDivisionError");
        }
        const base=numerator/denominator;
        if(base<0 && (1/this.n)%1!==0){
          throw new RangeError("ValueError");
        }
        this.zmratio=Math.pow(base,(1/this.n));
        if(Number.isNaN(this.zmratio)){
          throw new Error("Invalid");
        }
      } 
      catch(error){
        this.zmratio=0.0;
        console.warn("Couldn't calculate zmratio, defaulting to 0.0");
      }
    }
    // Equation : H= Hm*(1-exp(a*D/Hm))
    calculateHeight(){
      return this.Hm*(1-Math.exp((-this.a*this.D)/this.Hm));
    }
  
    // Equation : A_c=(pi*c*H*D)/(4*a) 
    calculateCrownArea(){
      const H=this.calculateHeight();
      return ((Math.PI*this.c)/(4*this.a))*H*this.D;
    }
  
    // Equation: f_s= H/(a*D)
    calculateSapwoodFraction(){
      const H=this.calculateHeight();
      if((this.a*this.D)==0)
        return 0;
      return H/(this.a*this.D);
    }
    
    // Crown radius according to PlantFATE documentation
    calculateCrownRadiusAtHeight(z,H){
      const zRatio=z/H;
      let base=1-Math.pow(zRatio,this.n);
      if(base<0)
        base=0;
      const q_z=this.m*this.n*Math.pow(zRatio,(this.n-1))*Math.pow(base,(this.m-1));
      const A_c=this.calculateCrownArea();
      const z_m=H*this.zmratio;
      const q_m=this.calculateQatHeight(z_m,H);
      if(q_m==0) return 0;
      const r0=Math.sqrt(A_c/Math.PI)/q_m;
      return r0*q_z;
    }
  
    // according to PlantFATE documentation
    calculateQatHeight(z,H){
      const zRatio=z/H;
      const base=1-Math.pow(zRatio,this.n);
      return this.m*this.n*Math.pow(zRatio,(this.n-1))*Math.pow(base,(this.m-1));
    }
  
    // Stem radius according to PlantFATE documentation
    stemRadiusAtHeight(z,H){
      const baseRadius=this.D/2.0;
      if(H<=0) return baseRadius;
      const heightRatio=z/H;
      const taperFactor=1.0-Math.pow(heightRatio,1.5);
      return baseRadius*taperFactor;
    }
  }
  
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
      tipMatrix.makeTranslation(0, length, 0).premultiply(worldMatrix);
    
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
        const childMatrix = new THREE.Matrix4().makeRotationFromEuler(
          new THREE.Euler(angle, twist, 0, 'YXZ')
        ).premultiply(tipMatrix);
        collectBranchGeometries(barkGeos, leafGeos, nextLength, nextThickness, depth + 1, speciesId, maxDepth, childMatrix);
      }
    }
    
    // building the trees by merging geometries 
    function buildMergedTreeGeo(D, speciesId) {
      const sid = speciesId || 1;
  
      // PlantFATEMath is a class — must instantiate with D, then call method
      const pf = new PlantFATEMath(D);
      const H  = pf.calculateHeight();
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
    const MAX_TREES = 5;
    const LAND_AREA = 150 * 150; // land area 
    
    // the forest
    class ForestScene {
      constructor(container) {
        this.renderer = new THREE.WebGLRenderer({ 
          antialias: true, 
          powerPreference: 'high-performance' 
        });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setClearColor(0x0c120d);
        this.renderer.shadowMap.enabled = false;
        container.appendChild(this.renderer.domElement);
    
        this.scene = new THREE.Scene();
        const bgm=_texLoader.load('images/background.png');
        this.scene.background=bgm; // adds background image to the scene
        this.scene.fog = new THREE.Fog(0x0c120d, 180, 500); // adds linear fog 
    
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
          new THREE.PlaneGeometry(150, 150),
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
        this.playing    = false;
        this.speed      = 10; // years per second — default 10
        
        this.currentYearFloat = 0;
        this._lastTime        = null;
        
        // Instantiate permanent InstancedMesh allocations for each species at initialization
        this.instancedMeshes = {};
        this._maxPossibleInstancesPerSpecies = 1500; // Securely sizes the GPU allocation buffers up front
      }
    
      init(data) {
        this.data     = data;
        this.allYears = Object.keys(data).map(Number).sort((a, b) => a - b);
        if (this.allYears.length > 0) {
          this._initPositionsAndPrototypes();
          this.currentYearFloat = this.allYears[0];
          this._renderCurrentTimelineFrame();
        }
      }
      
      // Assigns stable zone-based positions to every cohort key — called ONCE only
      _initPositionsAndPrototypes() {
        // Build base structural prototypes at a uniform normalization thickness scale of D = 1.0
        // This allows us to scale trees dynamically via matrix transforms entirely on the GPU
        [1, 2, 3].forEach(sid => {
          const proto = buildMergedTreeGeo(1.0, sid);
          
          const barkIM = new THREE.InstancedMesh(proto.bark, BARK_MAT[sid], this._maxPossibleInstancesPerSpecies);
          const leafIM = new THREE.InstancedMesh(proto.leaf, LEAF_MAT[sid], this._maxPossibleInstancesPerSpecies);
          
          barkIM.count = 0;
          leafIM.count = 0;
          
          this.forestGroup.add(barkIM);
          this.forestGroup.add(leafIM);
          
          this.instancedMeshes[sid] = { bark: barkIM, leaf: leafIM };
          
          proto.bark.dispose();
          proto.leaf.dispose();
        });
  
        // Map positions across coordinates across the structural array parameters
        this.allYears.forEach(year => {
          const cohorts = this.data[year] || [];
          const cols     = Math.ceil(Math.sqrt(cohorts.length));
          const zoneSize = 94 / cols;
  
          cohorts.forEach((co, i) => {
            const key = `${co.s}_${co.c}`;
            if (this.positions[key]) return;
  
            const col   = i % cols;
            const row   = Math.floor(i / cols);
            const zoneX = -47 + col * zoneSize;
            const zoneZ = -47 + row * zoneSize;
  
            const counts = Math.max(1, Math.round(co.d * LAND_AREA));
            const n      = Math.max(1, Math.round(counts * Math.min(1, MAX_TREES / Math.max(counts, 1))));
  
            this.positions[key] = [];
            for (let j = 0; j < n; j++) {
              this.positions[key].push([
                zoneX + Math.random() * zoneSize,
                zoneZ + Math.random() * zoneSize
              ]);
            }
          });
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
      
        // Advance continuous year counter at 'speed' years per second
        this.currentYearFloat += dt * this.speed;
      
        const endYear = this.allYears[this.allYears.length - 1];
        if (this.currentYearFloat >= endYear) {
          this.currentYearFloat = endYear;
          this.playing = false;
          UI.setPlayBtn(false);
        }
      
        this._renderCurrentTimelineFrame();
      }
  
      // Scales each cohort mesh pair toward the next year's basal diameter — called every frame
      _applyGrowthScale(baseIdx, t) {
        // Instanced Rendering handles scaling calculations cleanly inside the matrix compilation step
      }
    
      // Used by showYear / prev / next — full interpolated rebuild for manual navigation
      _renderCurrentTimelineFrame() {
        const currentYearFloat = this.currentYearFloat;
        
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
    
        // Reset active GPU transformation counters for the frame step loop
        const instanceCounters = { 1: 0, 2: 0, 3: 0 };
        let totalTreeCount = 0;
        const HUD = { 1: null, 2: null, 3: null };
  
        // Process and render out position arrays using the high speed instance buffers
        cohortsA.forEach(cA => {
          const cB = cohortsB.find(c => c.s === cA.s && c.c === cA.c) || cA;
          
          // Calculate the smooth intermediate diameter value for this frame context
          const currentDiameter = cA.bd + (cB.bd - cA.bd) * t;
          if (currentDiameter <= 0) return;
  
          const sid = cA.s || 1;
          if (!HUD[sid]) HUD[sid] = { bd: currentDiameter };
  
          const key = `${cA.s}_${cA.c}`;
          const coords = this.positions[key] || [];
          const imPair = this.instancedMeshes[sid];
  
          if (!imPair) return;
  
          coords.forEach(([x, z]) => {
            const currentIdx = instanceCounters[sid];
            if (currentIdx >= this._maxPossibleInstancesPerSpecies) return;
  
            // Deterministic rotation heading calculation
            const rotY = (cA.c * 13.37) % (Math.PI * 2);
            
            // The scale factor matches the calculated diameter parameter directly!
            const matrix = new THREE.Matrix4().compose(
              new THREE.Vector3(x, 0, z),
              new THREE.Quaternion().setFromAxisAngle(_up, rotY),
              new THREE.Vector3(currentDiameter, currentDiameter, currentDiameter)
            );
  
            imPair.bark.setMatrixAt(currentIdx, matrix);
            imPair.leaf.setMatrixAt(currentIdx, matrix);
            
            instanceCounters[sid]++;
            totalTreeCount++;
          });
        });
  
        // Notify the GPU to refresh tracking allocations immediately
        [1, 2, 3].forEach(sid => {
          const imPair = this.instancedMeshes[sid];
          imPair.bark.count = instanceCounters[sid];
          imPair.leaf.count = instanceCounters[sid];
          imPair.bark.instanceMatrix.needsUpdate = true;
          imPair.leaf.instanceMatrix.needsUpdate = true;
        });
    
        // Keep the UI counters updating seamlessly
        const currentDisplayYear = Math.floor(currentYearFloat);
        UI.update(currentDisplayYear, baseIdx, this.allYears.length, cohortsA);
  
        const statTrees = document.getElementById('stat-trees');
        if (statTrees) statTrees.textContent = totalTreeCount;
    
        [1, 2, 3].forEach(sid => {
          const el = document.getElementById(`s${sid}-basal-dia`);
          if (el) el.textContent = HUD[sid] ? HUD[sid].bd.toFixed(3) + ' m' : '--';
        });
      }
    
      _buildForest(cohorts) {
         // Deprecated: Overridden by the high performance initialization layout routine
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
        if (!this.playBtn) 
          return;
        this.playBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
        this.playBtn.classList.toggle('active', playing);
      }
    };
    
    // bootstrapping 
    const container = document.getElementById('simulation-viewport');
    const scene3    = new ForestScene(container);
    const forest    = new ForestManager(scene3);
    
    function waitForData() 
    {
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
    
    function loop(now) 
    {
      requestAnimationFrame(loop);
      forest.tick(now);
      scene3.render();
    }
    
    function bindUI() 
    {
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
    
      // Speed in years per second: 2 yrs/s = slow, 10 yrs/s = normal, 20 yrs/s = fast (~5s for 100 years)
      ['spd-slow', 'spd-norm', 'spd-fast'].forEach((id, i) => {
        if (!q(id)) return;
        q(id).onclick = () => {
          forest.speed = [2, 10, 20][i];
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
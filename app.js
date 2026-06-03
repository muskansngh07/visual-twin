import { SIGNED_R11_EAC_Format } from "three";

// PlantFATE Maths
const traits={
    Hm:35.0,   // maximum achievable height
    a:120.0,   // stem slenderness ratio
    c:400.0,   // crown-to-spawood ratio
    eta_c:0.7, // crown shape tapering coefficient
    rho_s:600, // wood density
    lambda_l:0.12, // leaf mass per area
    zeta:0.08, // root to leaf coordinating ratio
    f_cr:0.47, // coarse root fraction
    fr_max:0.25, // max reproductive energy allocation
    Dmat:0.3, //maturity diameter threshold
    a2:10.0, // sensitivity paramter for maturity scaling
    m_seed:0.002, // single seed dry weight
    c_acc:0.3, // accessory metabolic seed multiplier cost
    nu_H: 0.0002 // huber value parameter
};

function tree_height(Hm, D,a){
    return Hm*(1-Math.exp((-a*D)/Hm));
}

function crown_projection_area(c,a,H,D){
    return Math.PI*c*H*D/(4*a);
}

function basal_sapwood_area(nu_H,lai,Ac){
    return nu_H*lai*Ac;

}

function coarse_root_mass(rho_s,eta_c,D,H,c,a,f_cr){
    const m_trunk=rho_s*Math.PI*eta_c*D*D*H/4;
    const m_branch=rho_s*Math.PI*c*Math.pow(D,5/2)*Math.sqrt(H)/(12*a);
    const agb=m_trunk+m_branch; // above ground biomass
    const m_cr=f_cr*agb; // below ground coarse anchors
    return {m_trunk,m_branch,agb,m_cr};
}

function leaf_and_root_biomass(lambda_l,zeta,lai,Ac){
    const ml=lambda_l*lai*Ac;
    const m_fr=zeta*ml;
    return {ml,m_fr};

}

function calculate_cohort_instantaneous_rates(D,lai,gpp,t=traits){
    const H=tree_height(t.Hm,D,t.a);
    const Ac=crown_projection_area(t.c,t.a,H,D);
    const As=basal_sapwood_area(t.nu_H,lai,Ac);
    const wood=coarse_root_mass(t.rho_s,t.eta_c,D,H,t.c,t.a,t.f_cr);
    const fine=leaf_and_root_biomass(t.lambda_l,t.zeta,lai,Ac);
    const total_biomass=wood.agb+wood.m_cr+fine.ml+fine.m_fr;

    // respiration and turnover loss
    const R_maintenance=(0.01*wood.agb)+(0.05*fine.ml)+(0.03*fine.m_fr);
    const T_turnover=(fine.ml/1.5)+(fine.m_fr/0.8);
    const cbio=0.5; //carbon conversion index weight
    const y=0.75; //efficiency multiplier constant
    const Pnet=cbio*y*(gpp-R_maintenance)-T_turnover;
    const dB_dt=Math.max(Pnet,0);

    // energy budget partitioning
    const fr_D = t.fr_max / (1 + Math.exp(t.a2 * (1 - D / t.Dmat)));
    const growth_biomass = (1 - fr_D) * dB_dt;
    const reproductive_biomass = fr_D * dB_dt;

    // Differential Structural Geometry Rates
    const structural_resistance = 5.0; // Geometric derivative scaling constant
    const dD_dt = growth_biomass / structural_resistance;

    // Demographic Vectors
    const fec = reproductive_biomass / (t.m_seed * (1 + t.c_acc));
    // Old age physical vulnerability scales exponentially with proximity to max height Hm
    const mort = (0.01 * Math.exp(H / t.Hm)) + (dD_dt < 0.001 ? 0.15 : 0.01);

    return {
        dD_dt,        // Radial change vector (used by Function 2)
        fec,          // Birth multiplier rate (used by Function 2)
        mort,         // Death reduction rate (used by Function 2)
        agb: wood.agb,
        total_biomass
    };
}

// SPECIFIC CONFIGURATION

// Species-specific settings
const SPECIES_CONFIG={
    1:{
        leafUrl:'images/tree1.png',
        leafSizeFactor:2.0,
        branchAngle:0.70,
        lengthTaper:0.68,
        alphaTest:0.08
    },
    2:{
        leafUrl:'images/tree2.png',
        leafSizeFactor:1.0,
        branchAngle:0.55,
        lengthTaper:0.70,
        alphaTest:0.08
    },
    3:{
        leafUrl:'images/tree3.png',
        leafSizeFactor:1.5,
        branchAngle:0.60,
        lengthTaper:0.75,
        alphaTest:0.08
    }
};

// Species-specific bark colours 
const BARK_COLOR={
    1:new THREE.Color(0x4a2c0a),
    2:new THREE.Color(0x3b2508),
    3:new THREE.Color(0x5c3a12)
};

// TEXTURE AND MATERIAL CACHE

const tex_loader=new THREE.TextureLoader();
const LEAF_TEX={};
const LEAF_MAT={};
const BARK_MAT={};

[1,2,3].forEach(sid=>{
    const cfg=SPECIES_CONFIG[sid];
    LEAF_TEX[sid]=tex_loader.load(cfg.leafUrl);
    LEAF_MAT[sid]=new THREE.MeshLambertMaterial({
        map:LEAF_TEX[sid],
        transparent:false,
        alphaTest:cfg.alphaTest,
        side:THREE.DoubleSide,
        depthWrite:false
    });
    BARK_MAT[sid]=new THREE.MeshLambertMaterial({color: BARK_COLOR[sid]});
});

// Geometry only tree builder 

const _dummy=new THREE.Object3D();
const _up=new THREE.Vector3(0,1,0);
const _tangent=new THREE.Vector3();
const _axisX=new THREE.Vector3();

// Bark Geometry which is a cylinder
function collectBranchGeometries(barkGeos,leafGeos,length,thickness,depth,speciesID,maxDepth,worldMatrix){
    const cgf=SPECIES_CONFIG[speciesID]||SPECIES_CONFIG[1];
    const cylGeo=new THREE.CylinderGeometry(thickness*0.7,thickness,length,6);
    cylGeo.translate(0,length/2,0);
    cylGeo.applyMatrix4(worldMatrix);
    barkGeos.push(cylGeo);
    const tipMatrix=worldMatrix.clone();
    tipMatrix.multiply(new THREE.Matrix4().makeTranslation(0,length,0));

    // Base case- leaf cross planes 
    if(depth>=maxDepth){
        const planeSize=length*cfg.leafSizeFactor;
        const pGeo=new THREE.PlaneGeometry(planeSize,planeSize);
        performance.translate(0,planeSize/2,0);

        // plane 1
        const p1=pGeo.clone();
        p1.applyMatrix4(tipMatrix);
        leafGeos.push(p1);

        // plane 2 at 90 degrees to p1
        const p2=pGeo.clone();
        const rot=new THREE.Matrix4.makeRotationY(Math.PI/2);
        p2.applyMatrix4(rot);
        p2.applyMatrix4(tipMatrix);
        leafGeos.push(p2);

        pGeo.dispose();
        return;
    }

    // recurse 
    const nextLength=length*cfg.lengthTaper;
    const nextThickness=thickness*0.64;
    const angle=cfg.branchAngle;
    const rotOffset=Math.random()*Math.pi*2;
    for(let i=0;i<4;i++){
        const twist=rotOffset+i*(Math.PI/2);
        const childMatrix=tipMatric.clone();
        childMatrix.multiply(
            new THREE.Matrix4().makeRotationFromEuler(
                new THREE.Euler(angle,twist,0,'YXZ')
            )
        );
        collectBranchGeometries(barkGeos,leafGeos,nextLength,nextThickness,depth+1,speciesID,maxDepth,childMatrix);
    }

}


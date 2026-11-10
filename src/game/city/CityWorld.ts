import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ColliderGrid, type Circle } from '../LevelPath';
import type { MaterialLibrary } from '../../assets/MaterialLibrary';
import { buildTreeTemplate } from '../../assets/WorldKit';
import { createSeededRandom } from '../../utils/random';

export interface CitySupplySite { position: THREE.Vector3; rotationY: number }
interface CityBuilding { root: THREE.Group; detail: THREE.Group; center: THREE.Vector3; supply: THREE.Vector3; doorway: THREE.Vector3 }

/** Original walled European town: giant-sized boulevards, intimate alleys and enterable stores. */
export class CityWorld {
  readonly root = new THREE.Group();
  readonly colliders = new ColliderGrid();
  /** Tall enemies share every obstacle but cannot squeeze through2.65m house portals. */
  readonly giantColliders = new ColliderGrid();
  readonly spawn = new THREE.Vector3(0, 0, 2);
  readonly extraction = { position: new THREE.Vector3(0, 0, -120), radius: 3.5 };
  readonly supplySites: CitySupplySite[] = [];
  readonly patrolSites: THREE.Vector3[] = [];
  readonly buildings: CityBuilding[] = [];
  readonly bounds = { minX: -54, maxX: 54, minZ: -127, maxZ: 7 };
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly treeBatches: { trunk: THREE.InstancedMesh; canopy: THREE.InstancedMesh; placements: { at: THREE.Vector3; scale: number; yaw: number }[] }[] = [];
  private readonly treeMatrix = new THREE.Matrix4();
  private readonly treeRotation = new THREE.Quaternion();
  private readonly treeScale = new THREE.Vector3();
  private readonly geometryBatches = new Map<THREE.Material, THREE.BufferGeometry[]>();

  constructor(mats: MaterialLibrary) {
    this.root.name = 'western-walled-city';
    const masonry = this.material('#8b8c84', this.surfaceTexture('stone'), 0.95);
    const redRoof = this.material('#984f36', this.surfaceTexture('tile'), 0.84);redRoof.side=THREE.DoubleSide;
    const timber = this.material('#3a2920', this.surfaceTexture('wood'), 0.92);
    const stonePale = this.material('#b1ab98', this.surfaceTexture('stone'), 0.9);
    const window = this.material('#2c3c40', undefined, 0.36);
    const door = this.material('#63503a', undefined, 0.9);
    const street = this.material('#92948c', this.surfaceTexture('paving'), 0.96);
    street.map!.repeat.set(42, 52);
    const floor = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(112, 140).rotateX(-Math.PI / 2)), street);
    floor.position.set(0, -0.035, -60);floor.receiveShadow = true;floor.name = 'city-cobblestone-ground';this.root.add(floor);
    const rng = createSeededRandom(6071);
    // Building fronts address a real connected street grid, with broad escape lanes between blocks.
    const plans = [
      [-19, -16, 0], [19, -16, 1], [-38, -17, 2], [38, -17, 0],
      [-19, -44, 1], [19, -44, 2], [-39, -45, 0], [39, -45, 1],
      [-19, -80, 2], [19, -80, 0], [-39, -80, 1], [39, -80, 2],
      [-19, -109, 0], [19, -109, 1], [-39, -109, 2], [39, -109, 0],
    ];
    plans.forEach(([x, z, style], i) => {
      const plaster = this.material(['#bcae8b', '#a9b0a8', '#b29a82', '#b4a195'][i % 4], this.surfaceTexture('plaster', i), 0.97);
      const center = new THREE.Vector3(x, 0, z);
      const yaw = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      const building = this.buildHouse(center, yaw, style, 6.4 + (i % 3) * 0.75, { masonry, redRoof, timber, plaster, window, door, stonePale });
      this.buildings.push(building);this.root.add(building.root);
      this.supplySites.push({ position: building.supply, rotationY: yaw });
    });
    this.buildWalls(masonry, redRoof, stonePale);
    this.buildMarket(masonry, timber, redRoof, stonePale);
    this.buildExtractionSignal(mats, timber);
    this.buildTrees(rng, mats);
    // Patrol points deliberately stay on the wide streets, clear of spawn and house footprints.
    for (const [x, z] of [[0, -27], [-8, -45], [8, -52], [0, -64], [-29, -62], [29, -62], [-8, -82], [8, -92], [0, -102], [-28, -97], [28, -97], [0, -112]]) {
      this.patrolSites.push(new THREE.Vector3(x, 0, z));
    }
    this.flushBatches(this.root, this.geometryBatches, 'city-wall-and-street-kit');
    this.root.userData.level = 'western-city';
    this.root.userData.buildingFamilies = ['timber-gable', 'stone-merchant', 'stepped-townhouse'];
    this.root.userData.navigation = 'main-boulevard-cross-streets-side-alleys';
  }

  update(_elapsed: number, cameraPos: THREE.Vector3): void {
    for (const b of this.buildings) {
      const d2 = b.center.distanceToSquared(cameraPos);
      b.root.visible = d2 < 115 * 115;
      // Trim, window muntins and ceramic ridges are omitted beyond the readable facade range.
      b.detail.visible = d2 < 48 * 48;
      for(const child of b.root.children)if(child instanceof THREE.Mesh)child.castShadow=d2<60*60;
    }
    for (const batch of this.treeBatches) {
      let trunks = 0, canopies = 0;
      for (const tree of batch.placements) {
        const d2 = tree.at.distanceToSquared(cameraPos);
        this.treeRotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, tree.yaw);
        this.treeScale.setScalar(tree.scale);
        this.treeMatrix.compose(tree.at, this.treeRotation, this.treeScale);
        if (d2 < 86 * 86) batch.trunk.setMatrixAt(trunks++, this.treeMatrix);
        if (d2 < 72 * 72) batch.canopy.setMatrixAt(canopies++, this.treeMatrix);
      }
      batch.trunk.count = trunks;batch.canopy.count = canopies;
      batch.trunk.instanceMatrix.needsUpdate = true;batch.canopy.instanceMatrix.needsUpdate = true;
      batch.trunk.computeBoundingSphere();batch.canopy.computeBoundingSphere();
    }
  }

  dispose(): void {
    this.root.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.root.removeFromParent();this.root.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.clear();this.materials.clear();this.textures.clear();
    this.buildings.length = 0;this.supplySites.length = 0;this.patrolSites.length = 0;this.treeBatches.length = 0;this.colliders.clear();this.giantColliders.clear();
  }

  private addCollider(c: Circle): void { this.colliders.add(c);this.giantColliders.add(c); }
  private keep<T extends THREE.BufferGeometry>(geo: T): T { this.geometries.add(geo);return geo; }
  private material(color: string, map?: THREE.Texture, roughness = 0.9): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, map, roughness, bumpMap:map, bumpScale:map?.025:0 });this.materials.add(m);return m;
  }
  private add(batches: Map<THREE.Material, THREE.BufferGeometry[]>, geo: THREE.BufferGeometry, material: THREE.Material): void {
    const expanded = geo.index ? geo.toNonIndexed() : geo;
    if (expanded !== geo) geo.dispose();
    const list = batches.get(material) ?? [];list.push(expanded);batches.set(material, list);
  }
  private box(batches: Map<THREE.Material, THREE.BufferGeometry[]>, material: THREE.Material, size: [number, number, number], p: [number, number, number], rotationY = 0): void {
    this.add(batches, new THREE.BoxGeometry(...size).rotateY(rotationY).translate(...p), material);
  }
  private flushBatches(root: THREE.Group, batches: Map<THREE.Material, THREE.BufferGeometry[]>, name: string): void {
    for (const [mat, parts] of batches) {
      const geo = mergeGeometries(parts, false);for (const part of parts) part.dispose();
      if (!geo) throw new Error('City geometry merge failed');
      const mesh = new THREE.Mesh(this.keep(geo), mat);mesh.castShadow = root.name!=='city-near-facade-detail';mesh.receiveShadow = true;mesh.name = name;root.add(mesh);
    }
    batches.clear();
  }
  private wallLine(x0: number, z0: number, x1: number, z1: number, radius = 0.28): void {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (radius * 1.45));
    for (let i = 0; i <= steps; i++) {const t = i / Math.max(1, steps);this.addCollider({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, r: radius, sight: true, wall: true });}
  }

  private buildHouse(center: THREE.Vector3, yaw: number, style: number, height: number, mats: Record<string, THREE.Material>): CityBuilding {
    const root = new THREE.Group(), detail = new THREE.Group();root.name = 'city-enterable-house';detail.name = 'city-near-facade-detail';root.add(detail);
    root.position.copy(center);root.rotation.y = yaw;root.userData.style = style;
    const base = new Map<THREE.Material, THREE.BufferGeometry[]>(), fine = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const w = 9 + style * 0.6, d = 12;
    const box = (mat: THREE.Material, size: [number, number, number], p: [number, number, number], fineDetail = false, ry = 0) => this.box(fineDetail ? fine : base, mat, size, p, ry);
    box(mats.masonry, [w + 0.5, 0.1, d + 0.6], [0, 0.025, 0]);
    const transform = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(center);
    const collider = (x0: number, z0: number, x1: number, z1: number) => {const a = transform(x0, z0), b = transform(x1, z1);this.wallLine(a.x, a.z, b.x, b.z);};
    for (const side of [-1, 1]) {
      box(mats.plaster, [0.3, height, d], [side * w / 2, height / 2, 0]);collider(side * w / 2, -d / 2, side * w / 2, d / 2);
      // Front and rear ground-level portals are actual open holes, not doors painted over solids.
      for (const z of [-d / 2, d / 2]) {
        const panelW = w / 2 - 1.25;
        box(mats.plaster, [panelW, height, 0.3], [side * (1.25 + panelW / 2), height / 2, z]);
        collider(side * 1.25, z, side * w / 2, z);
      }
    }
    for (const z of [-d / 2, d / 2]) {
      const a = transform(-1.25,z), b = transform(1.25,z);
      for(let i=0;i<=8;i++) {
        const t=i/8;
        this.giantColliders.add({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,r:0.28,wall:true,sight:true});
      }
      box(mats.plaster, [2.5, height - 2.65, 0.3], [0, 2.65 + (height - 2.65) / 2, z]);
      box(mats.stonePale, [2.75, 0.24, 0.5], [0, 2.68, z], true);
      for (const x of [-1.34, 1.34]) box(mats.stonePale, [0.22, 2.7, 0.46], [x, 1.35, z], true);
      for (const x of [-w * 0.32, w * 0.32]) for (const y of [3.8, ...(height > 7 ? [6.0] : [])]) {
        box(mats.timber, [1.5, 1.75, 0.37], [x, y, z], true);
        box(mats.window, [1.25, 1.5, 0.39], [x, y, z + Math.sign(z) * 0.015], true);
        box(mats.stonePale, [1.65, 0.15, 0.5], [x, y - 0.85, z], true);
        for (const dx of [-0.64, 0, 0.64]) box(mats.timber, [0.055, 1.5, 0.43], [x + dx, y, z], true);
        box(mats.timber, [1.35, 0.07, 0.44], [x, y, z], true);
      }
    }
    for (const y of [0.32, 2.9, height - 0.12]) {
      for (const z of [-d / 2 - 0.05, d / 2 + 0.05]) box(style === 0 ? mats.timber : mats.stonePale, [w + 0.35, 0.18, 0.35], [0, y, z], true);
      for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) box(style === 0 ? mats.timber : mats.stonePale, [0.35, 0.18, d], [x, y, 0], true);
    }
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) box(mats.timber, [0.23, height, 0.26], [x, height / 2, z], true);
    if (style === 0) {
      for (const z of [-d / 2 - 0.18, d / 2 + 0.18]) for (const x of [-w * 0.3, w * 0.3]) {
        const beam = new THREE.BoxGeometry(0.13, 3.2, 0.16);beam.rotateZ(x < 0 ? 0.55 : -0.55).translate(x, 4.7, z);this.add(fine, beam, mats.timber);
      }
    }
    // Pitched red ceramic roof, triangular gable masonry, chimneys and segmented ridge courses.
    const roofH = style === 1 ? 2.4 : 3.4;
    const vertices = [-w/2-0.6,height,-d/2-0.7, w/2+0.6,height,-d/2-0.7, 0,height+roofH,-d/2-0.7,
      -w/2-0.6,height,d/2+0.7, w/2+0.6,height,d/2+0.7, 0,height+roofH,d/2+0.7];
    const geo = new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,4,0,2,2,0,7,4,7,2,9],2));geo.setIndex([0,3,2,3,5,2,1,2,4,4,2,5,0,2,1,3,4,5]);geo.computeVertexNormals();this.add(base,geo,mats.redRoof);
    for (const z of [-d/2 - 0.72, d/2 + 0.72]) {
      const g = new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-w/2,height,z,w/2,height,z,0,height+roofH,z],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1],2));g.setIndex(z>0?[0,1,2]:[0,2,1]);g.computeVertexNormals();this.add(fine,g,mats.plaster);
      for (const side of [-1,1]) {
        const bar = new THREE.BoxGeometry(Math.hypot(w/2,roofH),0.16,0.22);bar.rotateZ(-side*Math.atan2(roofH,w/2)).translate(side*w/4,height+roofH/2,z);this.add(fine,bar,mats.timber);
      }
    }
    for(let z=-6.7;z<=6.7;z+=0.7) this.add(fine,new THREE.CylinderGeometry(.1,.1,.72,6).rotateX(Math.PI/2).translate(0,height+roofH+.04,z),mats.redRoof);
    box(mats.masonry,[0.95,2.6,1.05],[w*.25,height+roofH-.2,-1.8]);box(mats.stonePale,[1.12,.18,1.2],[w*.25,height+roofH+1.14,-1.8],true);
    if(style===2) for(const z of [-d/2-.14,d/2+.14]) for(let i=0;i<5;i++) {
      const width=w*(1-i/5), y=height+i*.55;box(mats.stonePale,[width,.42,.42],[0,y,z],true);
    }
    // A rear wall bench/rack stays outside the central doorway and search standing clearance.
    box(mats.door,[2.1,.14,.65],[w*.28,.65,-d*.32],true);
    for(const x of [w*.28-.75,w*.28+.75])box(mats.timber,[.12,.65,.5],[x,.32,-d*.32],true);
    this.flushBatches(root,base,'city-house-shell');this.flushBatches(detail,fine,'city-house-authored-facade');
    const supply = transform(-1.5,0), doorway = transform(0,d/2);
    return {root,detail,center:center.clone(),supply,doorway};
  }

  private buildWalls(stone: THREE.Material, tile: THREE.Material, pale: THREE.Material): void {
    const b=this.geometryBatches;
    for(const x of [-55,55]) {
      this.box(b,stone,[1.7,15,136],[x,7.5,-60]);this.wallLine(x,-128,x,8,.9);
      for(let z=-126;z<=6;z+=2.4)this.box(b,pale,[2.1,1.3,1.25],[x,15.55,z]);
    }
    for(const z of [8,-128]) for(const side of [-1,1]) {
      this.box(b,stone,[47,15,1.7],[side*31.5,7.5,z]);this.wallLine(side*8,z,side*55,z,.9);
      for(let x=9;x<54;x+=2.4)this.box(b,pale,[1.25,1.3,2.1],[side*x,15.55,z]);
    }
    // Gatehouse arch leaves a16m portal for a12m giant; extraction is in front of the north gate.
    for(const z of [8,-128]) {
      this.box(b,stone,[16,6,2.2],[0,15,z]);this.box(b,pale,[17,.45,2.6],[0,11.9,z]);
      for(const x of [-8.2,8.2]) this.box(b,pale,[.5,11.8,2.4],[x,5.9,z]);
    }
    for(const x of [-54,54])for(const z of [7,-127]) {
      const tower=new THREE.CylinderGeometry(3.2,3.6,21,16).translate(x,10.5,z);this.add(b,tower,stone);
      const cap=new THREE.ConeGeometry(4,5,16).translate(x,23.5,z);this.add(b,cap,tile);
      for(let i=0;i<12;i++){const a=i*Math.PI/6;this.box(b,pale,[.7,1.1,.7],[x+Math.cos(a)*3.05,21.35,z+Math.sin(a)*3.05]);}
      this.addCollider({x,z,r:3.3,sight:true,wall:true});
    }
  }

  private buildMarket(stone: THREE.Material, timber: THREE.Material, roof: THREE.Material, pale: THREE.Material): void {
    const b=this.geometryBatches;
    // A civic bell tower and well provide recognisable midtown landmarks without copying any franchise silhouette.
    const x=39,z=-62;
    this.box(b,stone,[6,16,6],[x,8,z]);
    for(const side of [-1,1]){
      this.box(b,pale,[6.5,.3,6.5],[x,15.6,z]);
      for(const dx of [-2.4,2.4])this.box(b,timber,[.32,3.1,.32],[x+dx,17.1,z+side*2.4]);
    }
    this.add(b,new THREE.ConeGeometry(5,5.5,4).rotateY(Math.PI/4).translate(x,21.1,z),roof);
    this.add(b,new THREE.TorusGeometry(.8,.08,6,20).translate(x,17.5,z+3.05),pale);
    this.box(b,timber,[.12,1.2,.12],[x,17.5,z+3.08]);this.box(b,timber,[.7,.12,.12],[x+.25,17.5,z+3.08]);
    this.wallLine(x-3,z-3,x+3,z-3,.3);this.wallLine(x+3,z-3,x+3,z+3,.3);this.wallLine(x+3,z+3,x-3,z+3,.3);this.wallLine(x-3,z+3,x-3,z-3,.3);
    // Market shelters flank the cross street, not its central escape line.
    for(const side of [-1,1]) {
      const sx=side*15,sz=-62;
      for(const dx of [-2,2])for(const dz of [-1.1,1.1])this.box(b,timber,[.12,2.3,.12],[sx+dx,1.15,sz+dz]);
      this.box(b,roof,[4.8,.16,3.1],[sx,2.4,sz]);
      this.box(b,timber,[3.6,.15,.6],[sx,1.05,sz+1]);
      this.supplySites.push({position:new THREE.Vector3(sx,0,sz-.45),rotationY:0});
    }
  }

  private buildExtractionSignal(mats: MaterialLibrary, timber: THREE.Material): void {
    const cloth=this.material('#327f84',mats.clothTex,1);
    const flame=new THREE.MeshStandardMaterial({color:'#ffc67a',emissive:'#ff9b3f',emissiveIntensity:1.6,roughness:.6});this.materials.add(flame);
    for(const side of [-1,1]) {
      const x=side*5,z=-126;
      this.box(this.geometryBatches,timber,[.11,4.3,.11],[x,7,z]);
      this.box(this.geometryBatches,timber,[1.8,.12,.12],[x+side*.75,9,z]);
      // Uneven cloth hem and warm gate lamps distinguish the extraction gate without navigation arrows.
      const banner=new THREE.BufferGeometry();
      banner.setAttribute('position',new THREE.Float32BufferAttribute([x,8.9,z,x+side*1.5,8.9,z,x,6.2,z+.08,x+side*.75,6.5,z+.12,x+side*1.5,6.2,z+.08],3));
      banner.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,0,0,.5,.1,1,0],2));banner.setIndex(side>0?[0,2,3,0,3,1,1,3,4]:[0,3,2,0,1,3,1,4,3]);banner.computeVertexNormals();
      this.add(this.geometryBatches,banner,cloth);
      this.box(this.geometryBatches,timber,[.55,.65,.55],[side*6.6,2.8,z]);
      this.add(this.geometryBatches,new THREE.SphereGeometry(.21,10,8).scale(1,1.6,1).translate(side*6.6,3.15,z),flame);
    }
  }

  private buildTrees(rng:()=>number, mats: MaterialLibrary):void {
    const bark = mats.bark;
    const leaves = mats.leaves;
    const soil = this.material('#404a35', undefined, 1);
    const templates=[101,303,505].map(seed=>buildTreeTemplate(seed));
    for(const tpl of templates){tpl.trunk.scale(0.95,1.25,0.95);tpl.canopy.scale(0.95,1.25,0.95);this.keep(tpl.trunk);this.keep(tpl.canopy);}
    const positions=[[-10,-35],[10,-35],[-29,-34],[29,-34],[-48,-33],[48,-33],[-10,-92],[10,-92],[-29,-91],[29,-91],[-48,-93],[48,-93],[-8,-113],[8,-113]];
    const placements = templates.map(() => [] as { at: THREE.Vector3; scale: number; yaw: number }[]);
    positions.forEach(([x,z],i)=>{
      const tpl=templates[i%templates.length],at=new THREE.Vector3(x,0,z);
      const scale=2.6+rng()*.65,yaw=rng()*Math.PI*2;
      placements[i%templates.length].push({at,scale,yaw});
      this.addCollider({x,z,r:tpl.trunkRadius*scale+.1,sight:true});
      this.add(this.geometryBatches,new THREE.CircleGeometry(1.55,24).rotateX(-Math.PI/2).translate(x,0.015,z),soil);
    });
    templates.forEach((tpl,i)=>{
      const trunk=new THREE.InstancedMesh(tpl.trunk,bark,placements[i].length);
      const canopy=new THREE.InstancedMesh(tpl.canopy,leaves,placements[i].length);
      trunk.name='city-instanced-tall-trunks';canopy.name='city-instanced-natural-canopy';
      trunk.castShadow=true;trunk.receiveShadow=true;canopy.castShadow=true;canopy.receiveShadow=true;
      this.root.add(trunk,canopy);this.treeBatches.push({trunk,canopy,placements:placements[i]});
    });
    this.update(0,this.spawn);
  }

  private surfaceTexture(kind:'stone'|'tile'|'wood'|'plaster'|'paving',seed=0):THREE.CanvasTexture {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d')!;const rng=createSeededRandom(713+seed*97);c.fillStyle=kind==='tile'?'#b98a70':kind==='wood'?'#9e8a73':'#b5b5aa';c.fillRect(0,0,256,256);
    if(kind==='stone'||kind==='paving') {
      const h=kind==='paving'?32:48,w=kind==='paving'?50:75;
      for(let row=-1;row<9;row++)for(let col=-1;col<8;col++){
        const x=col*w+(row%2)*w*.5,y=row*h;const shade=145+Math.floor(rng()*50);c.fillStyle=`rgb(${shade},${shade},${shade-6})`;c.fillRect(x+2,y+2,w-4,h-4);c.strokeStyle='#686b66';c.lineWidth=2;c.strokeRect(x+2,y+2,w-4,h-4);
      }
    }else if(kind==='tile') {
      for(let row=0;row<12;row++)for(let col=-1;col<10;col++){const x=col*30+(row%2)*15,y=row*24;c.fillStyle=`hsl(15,${30+rng()*16}%,${40+rng()*16}%)`;c.fillRect(x+1,y+1,28,22);c.strokeStyle='#694432';c.strokeRect(x,y,30,24);}
    }else if(kind==='wood') {
      for(let i=0;i<100;i++){c.strokeStyle=`rgba(57,37,22,${.08+rng()*.2})`;c.lineWidth=.5+rng()*2;c.beginPath();const x=rng()*256;c.moveTo(x,0);c.bezierCurveTo(x+10,90,x-10,170,x+5,256);c.stroke();}
    }else { for(let i=0;i<400;i++){c.fillStyle=`rgba(45,42,34,${rng()*.06})`;c.fillRect(rng()*256,rng()*256,1+rng()*6,1+rng()*20);} }
    for(let i=0;i<1500;i++){c.fillStyle=`rgba(20,22,18,${rng()*.065})`;c.fillRect(rng()*256,rng()*256,1,1);}
    const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=2;this.textures.add(texture);return texture;
  }
}

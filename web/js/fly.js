// Procedural 3-D fruit fly with a motor-state driven animation rig, plus the
// small "stage" props each scenario needs (food drop, speaker, looming object,
// trading screen, a singing male).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

function stripedTexture(base = '#6b5233', stripe = '#2a1d10') {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 256);
  g.fillStyle = stripe;
  for (let i = 0; i < 5; i++) g.fillRect(0, 60 + i * 34, 64, 12);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class FlyModel {
  constructor({ scale = 1, bodyColor = 0x7a5c3a, male = false } = {}) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    this.male = male;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.65, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b1e12, roughness: 0.8 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xc8322a, roughness: 0.25, metalness: 0.1, emissive: 0x3a0a08 });
    const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.35, roughness: 0.15,
      transmission: 0.3, side: THREE.DoubleSide, iridescence: 0.6 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.8 });
    this.mats = { bodyMat, darkMat, eyeMat, wingMat, legMat };

    // --- thorax & abdomen ---
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 18), bodyMat);
    thorax.scale.set(1, 0.9, 1.15); thorax.castShadow = true;
    this.root.add(thorax);
    const abdMat = new THREE.MeshStandardMaterial({ map: stripedTexture(male ? '#5c4630' : '#8a6a42', '#1f150c'), roughness: 0.7 });
    this.abdomenPivot = new THREE.Group(); this.abdomenPivot.position.set(0, -0.05, -0.45);
    const abdGeo = new THREE.SphereGeometry(0.5, 24, 18); abdGeo.rotateX(Math.PI / 2);   // poles along z so stripes run across
    const abdomen = new THREE.Mesh(abdGeo, abdMat);
    abdomen.scale.set(1, 0.85, male ? 1.5 : 1.9); abdomen.position.set(0, 0, -0.75); abdomen.castShadow = true;
    this.abdomenPivot.add(abdomen); this.root.add(this.abdomenPivot);
    // halteres
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), darkMat); h.position.set(0.45 * s, 0.15, -0.35); this.root.add(h);
    }

    // --- head ---
    this.headPivot = new THREE.Group(); this.headPivot.position.set(0, 0.12, 0.62);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 18), bodyMat); head.scale.set(1.05, 1, 0.85); head.castShadow = true;
    this.headPivot.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 16), eyeMat);
      eye.position.set(0.3 * s, 0.05, 0.12); eye.scale.set(0.8, 1, 1); this.headPivot.add(eye);
    }
    // antennae (pedicel + funiculus + arista)
    this.antennae = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(0.12 * s, -0.02, 0.38);
      const ped = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), darkMat); a.add(ped);
      const fun = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), bodyMat); fun.position.set(0.02 * s, -0.08, 0.06); a.add(fun);
      const arista = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.32, 6), darkMat);
      arista.position.set(0.08 * s, -0.02, 0.14); arista.rotation.z = -0.9 * s; arista.rotation.x = -0.6;
      a.add(arista);
      a.userData.arista = arista;
      this.headPivot.add(a); this.antennae.push(a);
    }
    // proboscis: rostrum -> haustellum -> labellum
    this.proboscis = new THREE.Group(); this.proboscis.position.set(0, -0.3, 0.12);
    const rostrum = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 10), bodyMat); rostrum.position.y = -0.15; this.proboscis.add(rostrum);
    this.haustellum = new THREE.Group(); this.haustellum.position.y = -0.3;
    const haust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 10), bodyMat); haust.position.y = -0.15; this.haustellum.add(haust);
    const labellum = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: 0x9c7a5a, roughness: 0.6 }));
    labellum.scale.set(1.3, 0.5, 1); labellum.position.y = -0.32; this.haustellum.add(labellum);
    this.proboscis.add(this.haustellum);
    this.headPivot.add(this.proboscis);
    this.root.add(this.headPivot);

    // --- legs (tripod) ---
    this.legs = [];
    const legZ = [0.42, 0.0, -0.42];
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 3; k++) {
        const leg = this._makeLeg(legMat, side);
        leg.root.position.set(0.38 * side, -0.25, legZ[k]);
        leg.side = side; leg.index = k; leg.phase = ((k + (side > 0 ? 1 : 0)) % 2) * Math.PI;
        this.root.add(leg.root); this.legs.push(leg);
      }
    }

    // --- wings ---
    this.wings = [];
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.bezierCurveTo(0.2, 0.42, 1.6, 0.5, 2.3, 0.15);
    wingShape.bezierCurveTo(2.5, 0.0, 2.3, -0.25, 2.0, -0.3);
    wingShape.bezierCurveTo(1.3, -0.42, 0.3, -0.3, 0, 0);
    const wingGeo = new THREE.ShapeGeometry(wingShape, 24);
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(0.22 * s, 0.42, 0.05);
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.rotation.x = -Math.PI / 2;            // lie flat in xz plane, extending along +x
      w.scale.x = s;                          // mirror for the left wing
      // veins as thin lines
      hinge.add(w);
      hinge.side = s;
      this.root.add(hinge); this.wings.push(hinge);
    }

    // motor state (targets) and smoothed values
    this.target = { proboscis: 0, flap: 0, extendL: 0, extendR: 0, songVib: 0, antenna: 0, groom: 0,
      walk: 0, back: 0, turn: 0, jump: 0, headBob: 0, curl: 0, freeze: 0, lean: 0 };
    this.cur = { ...this.target };
    this.heading = 0; this.vel = new THREE.Vector3(); this.y = 0; this.vy = 0; this.airborne = false;
    this.gait = 0; this.t = 0; this.groomPhase = 0;
  }

  _makeLeg(mat, side) {
    const root = new THREE.Group();
    const seg = (len, r0, r1) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 8), mat); m.position.y = -len / 2; m.castShadow = true;
      g.add(m); g.len = len; return g;
    };
    const coxa = seg(0.35, 0.06, 0.05), femur = seg(0.75, 0.05, 0.04), tibia = seg(0.75, 0.04, 0.025), tarsus = seg(0.55, 0.025, 0.015);
    coxa.add(femur); femur.position.y = -0.35; femur.add(tibia); tibia.position.y = -0.75; tibia.add(tarsus); tarsus.position.y = -0.75;
    root.add(coxa);
    return { root, coxa, femur, tibia, tarsus };
  }

  setMotor(partial) { Object.assign(this.target, partial); }

  update(dt) {
    this.t += dt;
    const T = this.target, C = this.cur;
    for (const k in T) { if (k === 'flap' && this.airborne) continue; C[k] = approach(C[k], T[k], k === 'jump' || k === 'flap' ? 18 : 6, dt); }
    const t = this.t;

    // --- proboscis extension (feeding / "BUY") ---
    const p = C.proboscis;
    this.proboscis.rotation.x = lerp(0.9, -0.25, p);       // tucked back -> pointing forward-down
    this.proboscis.scale.y = lerp(0.55, 1.15, p);
    this.haustellum.rotation.x = lerp(1.2, 0.05, p);
    this.headPivot.rotation.x = lerp(0, 0.35, p) + C.headBob * Math.sin(t * TAU * 2.0) * 0.18 - C.groom * 0.3;
    this.headPivot.rotation.y = C.turn * 0.25;

    // --- antennae vibration (hearing) ---
    for (const a of this.antennae) {
      const s = a.position.x > 0 ? 1 : -1;
      const vib = C.antenna * 0.25 * Math.sin(t * 90 + s);
      a.userData.arista.rotation.z = -0.9 * s + vib;
      a.rotation.x = -0.15 * C.antenna + 0.08 * Math.sin(t * 6 + s);
    }

    // --- wings ---
    const flapAmp = C.flap * 1.1;
    for (const h of this.wings) {
      const s = h.side;
      const ext = s < 0 ? C.extendL : C.extendR;         // unilateral extension (courtship song)
      const restYaw = 1.42 * s;                           // folded back along the body
      const extYaw = 0.25 * s;                            // out to the side
      let yaw = lerp(restYaw, extYaw, Math.max(ext, C.flap * 0.9));
      let roll = flapAmp * Math.sin(t * TAU * 22) * s;    // flapping
      roll += ext * C.songVib * 0.12 * Math.sin(t * TAU * 28) * s; // song vibration
      h.rotation.set(0, yaw, roll);
      h.rotation.x = -0.15 * (1 - Math.max(ext, C.flap));
    }

    // --- abdomen (curl for egg-laying / "sell" retreat crouch) ---
    this.abdomenPivot.rotation.x = -0.45 * C.curl + 0.05 * Math.sin(t * 3);

    // --- locomotion ---
    const speed = (C.walk - C.back) * 1.8 * (1 - C.freeze);
    this.heading += C.turn * dt * 1.6;
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.root.position.addScaledVector(fwd, speed * dt);
    const r = this.root.position.length();
    if (r > 4.5) { this.heading += dt * 2.5; this.root.position.multiplyScalar(4.5 / r); }
    this.root.rotation.y = this.heading;
    this.gait += Math.abs(speed) * dt * 6.5;

    // jump / flight: `jump` is a one-shot trigger; wings beat while airborne
    if (T.jump > 0.5 && !this.airborne && this.y < 0.01) {
      this.vy = 5.5; this.airborne = true; this.heading += (Math.random() - 0.5) * 1.2; this.lastJump = t;
    }
    if (this.airborne) {
      this.vy -= 12 * dt; this.y += this.vy * dt;
      C.flap = 1;
      if (this.y <= 0) { this.y = 0; this.airborne = false; this.vy = 0; C.flap = 0; }
      this.target.jump = 0;
    }
    this.root.position.y = this.y + 0.65 + 0.03 * Math.sin(t * 2.2);
    this.root.rotation.x = -C.lean * 0.25 + (this.airborne ? -0.35 : 0) + C.back * 0.12;

    // --- legs ---
    const ph = this.gait;
    for (const L of this.legs) {
      const s = L.side, base = L.phase;
      const dir = Math.sign(speed) || 1;
      const swing = Math.sin(ph + base) * 0.55 * Math.min(1, Math.abs(speed) * 2);
      const lift = Math.max(0, Math.sin(ph + base + Math.PI / 2)) * 0.5 * Math.min(1, Math.abs(speed) * 2);
      // rest pose: coxa out to the side, femur up, tibia down
      L.coxa.rotation.z = s * 1.15;          // splay outward
      L.coxa.rotation.x = 0;
      L.femur.rotation.z = -s * 0.4;
      L.femur.rotation.x = swing * dir - (L.index - 1) * 0.35;
      L.tibia.rotation.z = s * 1.9 - lift * s;
      L.tarsus.rotation.z = s * 0.6;
      // antennal grooming: both front legs sweep over the antennae
      if (L.index === 0 && C.groom > 0.02) {
        const gp = t * 6 + (s > 0 ? 0 : Math.PI);
        const gsw = 0.5 + 0.5 * Math.sin(gp);
        L.coxa.rotation.x = lerp(L.coxa.rotation.x, 1.35, C.groom);
        L.coxa.rotation.z = lerp(L.coxa.rotation.z, s * 0.35, C.groom);
        L.femur.rotation.x = lerp(L.femur.rotation.x, 0.4 - gsw * 0.9, C.groom);
        L.femur.rotation.z = lerp(L.femur.rotation.z, s * 0.15, C.groom);
        L.tibia.rotation.z = lerp(L.tibia.rotation.z, s * (2.3 + gsw * 0.5), C.groom);
        L.tibia.rotation.x = lerp(0, -0.6 + gsw * 0.4, C.groom);
      } else L.tibia.rotation.x = 0;
      if (this.airborne) { L.femur.rotation.x += 0.6; L.tibia.rotation.z += s * 0.4; }
    }
  }
}

// ------------------------------------------------------------------------------------
export class FlyStage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0d14, 14, 30);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    this.camera.position.set(4.8, 3.2, 5.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.target.set(0, 0.6, 0);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; this.controls.minDistance = 2; this.controls.maxDistance = 25;

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30241a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2); sun.position.set(4, 8, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.near = 1; sun.shadow.camera.far = 30;
    for (const k of ['left', 'bottom']) sun.shadow.camera[k] = -8; for (const k of ['right', 'top']) sun.shadow.camera[k] = 8;
    this.scene.add(sun);
    const rim = new THREE.PointLight(0x66aaff, 30, 20); rim.position.set(-5, 2, -4); this.scene.add(rim);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const grid = new THREE.GridHelper(18, 36, 0x2a3446, 0x1c2331); grid.position.y = 0.002; this.scene.add(grid);

    this.fly = new FlyModel(); this.scene.add(this.fly.root);
    this.props = {};
    this._buildProps();
    this.beat = 0;
    this.resize();
  }

  _buildProps() {
    const P = this.props;
    // food drop
    P.food = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xffb35c, transmission: 0.5, roughness: 0.1, thickness: 0.6, transparent: true, opacity: 0.9 }));
    P.food.scale.set(1, 0.35, 1); P.food.position.set(0, 0.17, 1.9); P.food.visible = false; this.scene.add(P.food);
    // bitter drop (green)
    P.bitter = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0x5cff9a, transmission: 0.4, roughness: 0.1, transparent: true, opacity: 0.85 }));
    P.bitter.scale.set(1, 0.35, 1); P.bitter.position.set(0, 0.17, 1.9); P.bitter.visible = false; this.scene.add(P.bitter);
    // speaker
    P.speaker = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 1.0), new THREE.MeshStandardMaterial({ color: 0x1e222c, roughness: 0.6 }));
    box.position.y = 1.0; box.castShadow = true; P.speaker.add(box);
    P.cone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 0.25, 32), new THREE.MeshStandardMaterial({ color: 0x555b66, roughness: 0.4 }));
    P.cone.rotation.x = Math.PI / 2; P.cone.position.set(0, 1.1, 0.5); P.speaker.add(P.cone);
    P.rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 8, 48), new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.6 }));
      ring.position.set(0, 1.1, 0.6); P.speaker.add(ring); P.rings.push(ring);
    }
    P.speaker.position.set(-2.6, 0, -2.0); P.speaker.rotation.y = Math.PI * 0.35; P.speaker.visible = false; this.scene.add(P.speaker);
    // looming object (a swatter disc)
    P.loom = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 40), new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.5 }));
    disc.rotation.x = Math.PI / 2; disc.castShadow = true; P.loom.add(disc);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 12), new THREE.MeshStandardMaterial({ color: 0x333 }));
    handle.position.set(0, 2.2, 0); P.loom.add(handle);
    P.loom.visible = false; this.scene.add(P.loom);
    // trading screen
    P.screenCanvas = document.createElement('canvas'); P.screenCanvas.width = 512; P.screenCanvas.height = 288;
    P.screenTex = new THREE.CanvasTexture(P.screenCanvas);
    P.screen = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.36), new THREE.MeshBasicMaterial({ map: P.screenTex, side: THREE.DoubleSide }));
    P.screen.position.set(-2.4, 1.8, -1.6); P.screen.rotation.y = Math.PI * 0.32; P.screen.visible = false; this.scene.add(P.screen);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.8, 0.15), new THREE.MeshStandardMaterial({ color: 0x222 }));
    P.screen.add(stand); stand.position.set(0, -1.6, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.56, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 0.5 }));
    frame.position.z = -0.06; P.screen.add(frame);
    // male fly (singer) for the courtship track
    P.male = new FlyModel({ male: true, scale: 0.9, bodyColor: 0x5a4430 });
    P.male.root.position.set(-1.6, 0, 1.6); P.male.heading = Math.PI / 2 + 0.7; P.male.root.visible = false;
    this.scene.add(P.male.root);
    // buy/sell badge
    P.badge = document.createElement('div'); P.badge.className = 'badge'; document.getElementById('fly-overlay').appendChild(P.badge);
  }

  show(names) {
    const P = this.props;
    for (const k of ['food', 'bitter', 'speaker', 'loom', 'screen']) P[k].visible = names.includes(k);
    P.male.root.visible = names.includes('male');
  }

  setLoom(progress) {  // 0 far -> 1 hit
    const L = this.props.loom;
    L.visible = progress > 0;
    const x = lerp(-8, -1.3, progress), y = lerp(6, 1.1, progress), z = lerp(-4, 0.2, progress);
    L.position.set(x, y, z); L.rotation.set(0, 0.6, lerp(-0.3, 0.9, progress));
  }

  placeInFront(name, dist) {   // put a prop `dist` ahead of the fly's head, on the ground
    const P = this.props[name]; if (!P) return;
    const f = this.fly, fwd = new THREE.Vector3(Math.sin(f.heading), 0, Math.cos(f.heading));
    P.position.copy(f.root.position).setY(0.17).addScaledVector(fwd, dist);
  }

  drawScreen(draw) { draw(this.props.screenCanvas.getContext('2d'), this.props.screenCanvas); this.props.screenTex.needsUpdate = true; }

  badge(text, cls) {
    const b = this.props.badge; b.textContent = text; b.className = 'badge ' + (cls || '');
    b.style.opacity = text ? 1 : 0;
  }

  update(dt, audioLevel = 0) {
    this.fly.update(dt);
    const P = this.props;
    if (P.speaker.visible) {
      this.beat = approach(this.beat, audioLevel, 25, dt);
      P.cone.position.z = 0.5 + this.beat * 0.12;
      P.rings.forEach((r, i) => {
        const ph = ((performance.now() / 1000) * 0.9 + i / 4) % 1;
        r.scale.setScalar(0.6 + ph * 2.0); r.position.z = 0.6 + ph * 1.6;
        r.material.opacity = (1 - ph) * 0.55 * Math.min(1, 0.2 + this.beat * 2);
      });
    }
    if (P.male.root.visible) P.male.update(dt);
    // fly-fixed badge position
    if (P.badge.style.opacity !== '0') {
      const v = this.fly.root.position.clone(); v.y += 1.3; v.project(this.camera);
      const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
      P.badge.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    }
  }

  resize() {
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
}

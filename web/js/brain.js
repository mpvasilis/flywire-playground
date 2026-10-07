// 3-D rendering of all 139k FlyWire neurons as a GPU point cloud whose colour and
// size follow the live spike trace coming from the simulation worker.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// base tints per super_class (dim, so activity pops)
const SUPER_COLORS = {
  optic: [0.16, 0.28, 0.55], central: [0.42, 0.30, 0.62], sensory: [0.16, 0.55, 0.45],
  visual_projection: [0.20, 0.45, 0.65], ascending: [0.55, 0.45, 0.20], descending: [0.75, 0.35, 0.20],
  sensory_ascending: [0.20, 0.55, 0.35], visual_centrifugal: [0.30, 0.40, 0.60], motor: [0.85, 0.25, 0.25],
  endocrine: [0.70, 0.60, 0.20], unknown: [0.35, 0.35, 0.35],
};

const VERT = /* glsl */`
  attribute vec3 baseColor;
  attribute float act;       // spike trace (0 = silent)
  attribute float hi;        // 1 = highlighted (stim / readout group)
  uniform float uSize, uPixelRatio, uDim;
  varying vec3 vColor; varying float vAct; varying float vHi;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float a = clamp(act, 0.0, 2.5);
    vAct = a; vHi = hi;
    vColor = baseColor;
    float size = uSize * (0.55 + 0.45 * hi) * (1.0 + 1.6 * min(a, 1.5));
    gl_PointSize = size * uPixelRatio * 260.0 / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  precision highp float;
  uniform float uDim;
  varying vec3 vColor; varying float vAct; varying float vHi;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.15, d);
    vec3 hot = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 1.0, 1.0), clamp(vAct - 1.0, 0.0, 1.0));
    float a = clamp(vAct, 0.0, 1.0);
    vec3 col = mix(vColor * uDim * (0.9 + 0.9 * vHi), hot, a);
    float alpha = soft * (0.30 + 0.35 * vHi + 0.85 * a);
    gl_FragColor = vec4(col, alpha);
  }`;

export class BrainView {
  constructor(canvas, data) {
    this.data = data;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
    this.camera.position.set(0, -80, -900);   // looking at the anterior face
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.5;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 150; this.controls.maxDistance = 4000;
    this._userMoved = false;
    this.controls.addEventListener('start', () => { this._userMoved = true; });
    this._buildPoints();
    this._buildLabels();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 6;
    this.resize();
  }

  _buildPoints() {
    const d = this.data, N = d.N;
    const geo = new THREE.BufferGeometry();
    // FlyWire frame: x medio-lateral, y dorsal→ventral (down), z anterior→posterior.
    // Three.js: flip y so dorsal is up, flip z so anterior faces +z (towards default camera).
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[3 * i] = d.pos[3 * i]; pos[3 * i + 1] = -d.pos[3 * i + 1]; pos[3 * i + 2] = -d.pos[3 * i + 2];
    }
    this.positions = pos;
    const base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const c = SUPER_COLORS[d.superName(i)] || SUPER_COLORS.unknown;
      base[3 * i] = c[0]; base[3 * i + 1] = c[1]; base[3 * i + 2] = c[2];
    }
    this.act = new Float32Array(N);
    this.hi = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('baseColor', new THREE.BufferAttribute(base, 3));
    this.actAttr = new THREE.BufferAttribute(this.act, 1); this.actAttr.setUsage(THREE.DynamicDrawUsage);
    this.hiAttr = new THREE.BufferAttribute(this.hi, 1); this.hiAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('act', this.actAttr);
    geo.setAttribute('hi', this.hiAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 2.2 }, uPixelRatio: { value: this.renderer.getPixelRatio() }, uDim: { value: 1.0 } },
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  _buildLabels() {
    this.labels = [];
    const labels = this.data.meta.labels || {};
    for (const [name, p] of Object.entries(labels)) {
      if (!p) continue;
      const el = document.createElement('div');
      el.className = 'brain-label'; el.textContent = name;
      document.getElementById('brain-labels').appendChild(el);
      this.labels.push({ el, pos: new THREE.Vector3(p[0], -p[1], -p[2]) });
    }
  }

  setHighlight(indices, value = 1, clear = true) {
    if (clear) this.hi.fill(0);
    for (const i of indices) this.hi[i] = value;
    this.hiAttr.needsUpdate = true;
  }

  updateTrace(trace) {
    // trace is a Float32Array(N) from the worker; copy into the attribute buffer
    this.act.set(trace);
    this.actAttr.needsUpdate = true;
  }

  resize() {
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // fit the ~820 µm wide brain into the pane, keeping the current viewing direction
    if (this._userMoved) return;
    const halfW = 470, tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(halfW / (tanH * this.camera.aspect), 260 / tanH) * 1.05;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
  }

  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(m, this.camera);
    const hits = this.raycaster.intersectObject(this.points);
    return hits.length ? hits[0].index : -1;
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    // project labels
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight, v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      l.el.style.transform = `translate(${x}px, ${y}px)`;
      l.el.style.opacity = v.z < 1 ? 0.75 : 0;
    }
  }
}

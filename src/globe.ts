import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * 3D globe, ported from earthy_interactive_3d_earth_jukebox.html (procedural textures, atmosphere
 * shader, clouds, starfield, fly-to camera, beacon marker, click-to-pick lat/lon).
 *
 * The surface texture is a STYLISED ILLUSTRATION, not satellite imagery — the About page says so.
 * Changes from the prototype: ES-module three.js (works offline), region markers for the current
 * experience instead of hard-coded "simulated EONET" pins, and no fake "thermal" tint layer.
 */
export const GLOBE_RADIUS = 5;

export interface GlobeMarker {
  id: string;
  lat: number;
  lon: number;
}

export class Globe {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private earth!: THREE.Mesh;
  private clouds!: THREE.Mesh;
  private beacon!: THREE.Group;
  private ring!: THREE.Mesh;
  private markers = new THREE.Group();
  private target: THREE.Vector3 | null = null;
  private lookAt = new THREE.Vector3();
  private dayColor = new THREE.Color(0xffffff);
  onPick: (lat: number, lon: number) => void = () => {};
  onMarker: (id: string) => void = () => {};

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(0x030712);
    this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
    this.camera.position.set(0, 0, 15);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.05, rotateSpeed: 0.6, zoomSpeed: 0.8, minDistance: 6.2, maxDistance: 30 });

    // Light intensities ×π vs the r128 prototype (three ≥ r155 uses physically-based light units).
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2 * Math.PI);
    sun.position.set(20, 10, 20);
    const fill = new THREE.DirectionalLight(0x38bdf8, 0.4 * Math.PI);
    fill.position.set(-20, -10, -20);
    this.scene.add(sun, fill);

    this.buildStars();
    this.buildEarth();
    this.buildBeacon();
    this.scene.add(this.markers);

    addEventListener("resize", () => this.resize());
    this.bindPicking();
    this.animate();
  }

  setStyle(style: "day" | "night"): void {
    (this.earth.material as THREE.MeshPhongMaterial).color.set(style === "night" ? 0x1e293b : this.dayColor);
  }

  setClouds(on: boolean): void {
    this.clouds.visible = on;
  }

  setMarkers(markers: GlobeMarker[], color: string): void {
    this.markers.clear();
    for (const m of markers) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color }));
      mesh.position.copy(latLonToVector3(m.lat, m.lon, GLOBE_RADIUS * 1.01));
      mesh.userData.id = m.id;
      this.markers.add(mesh);
    }
  }

  flyTo(lat: number, lon: number, distance = 9.5): void {
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS * 1.01);
    this.beacon.position.copy(pos);
    this.beacon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
    this.beacon.visible = true;
    this.earth.rotation.y = 0;
    this.markers.rotation.y = 0;
    this.target = latLonToVector3(lat, lon, distance);
  }

  reset(): void {
    this.target = new THREE.Vector3(0, 0, 15);
    this.controls.target.set(0, 0, 0);
    this.beacon.visible = false;
  }

  zoom(factor: number): void {
    this.camera.position.multiplyScalar(factor);
  }

  rotate(dLon: number, dLat: number): void {
    const s = new THREE.Spherical().setFromVector3(this.camera.position);
    s.theta += dLon;
    s.phi = Math.max(0.15, Math.min(Math.PI - 0.15, s.phi + dLat));
    this.camera.position.setFromSpherical(s);
  }

  private buildEarth(): void {
    const t = proceduralTextures();
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64),
      new THREE.MeshPhongMaterial({ map: t.day, bumpMap: t.bump, bumpScale: 0.08, shininess: 15, specular: new THREE.Color(0x22d3ee) }),
    );
    this.scene.add(this.earth);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.025, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vNormal; void main(){ float i = pow(0.65 - dot(vNormal, vec3(0,0,1.0)), 2.5); gl_FragColor = vec4(0.0,0.85,1.0,1.0) * i; }`,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
      }),
    );
    this.scene.add(atmosphere);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.015, 64, 64),
      new THREE.MeshStandardMaterial({ map: t.clouds, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(this.clouds);
  }

  private buildStars(): void {
    const n = 2000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 80 + Math.random() * 100;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.7, color: 0xdde8ff, transparent: true, opacity: 0.8 })));
  }

  private buildBeacon(): void {
    const g = new THREE.Group();
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshBasicMaterial({ color: 0x00f3ff }));
    pin.position.y = 0.08;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.04, 0.8, 16),
      new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.6 }),
    );
    beam.position.y = 0.4;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.18, 32),
      new THREE.MeshBasicMaterial({ color: 0x00f3ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    this.ring.rotation.x = Math.PI / 2;
    g.add(pin, beam, this.ring);
    g.visible = false;
    this.beacon = g;
    this.scene.add(g);
  }

  private bindPicking(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (down) => {
      const t0 = performance.now();
      const up = (e: PointerEvent) => {
        el.removeEventListener("pointerup", up);
        if (performance.now() - t0 > 250 || Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 6) return; // drag
        const r = el.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
        const hitMarker = ray.intersectObjects(this.markers.children)[0];
        if (hitMarker) return this.onMarker(hitMarker.object.userData.id as string);
        const hit = ray.intersectObject(this.earth)[0];
        if (hit) {
          const local = this.earth.worldToLocal(hit.point.clone());
          const { lat, lon } = vector3ToLatLon(local);
          this.onPick(lat, lon);
        }
      };
      el.addEventListener("pointerup", up);
    });
  }

  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.clouds.rotation.y += 0.0004;
    if (!this.target && !this.beacon.visible) {
      this.earth.rotation.y += 0.0002;
      this.markers.rotation.y = this.earth.rotation.y;
    }
    this.ring.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.25);
    if (this.target) {
      this.camera.position.lerp(this.target, 0.05);
      this.controls.target.lerp(this.lookAt, 0.05);
      if (this.camera.position.distanceTo(this.target) < 0.05) this.target = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

export function latLonToVector3(lat: number, lon: number, radius = GLOBE_RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(-(radius * Math.sin(phi) * Math.cos(theta)), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
}

export function vector3ToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  const lat = Math.asin(n.y) * (180 / Math.PI);
  let lon = Math.atan2(n.z, -n.x) * (180 / Math.PI) - 180;
  if (lon < -180) lon += 360;
  return { lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
}

/** Procedural stylised textures, as in the prototype (so the globe works with no image assets). */
function proceduralTextures() {
  const w = 2048;
  const h = 1024;
  const day = document.createElement("canvas");
  day.width = w;
  day.height = h;
  const c = day.getContext("2d")!;
  const ocean = c.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#0a192f");
  ocean.addColorStop(0.5, "#0284c7");
  ocean.addColorStop(1, "#0f172a");
  c.fillStyle = ocean;
  c.fillRect(0, 0, w, h);
  // Continents placed by real lon/lat centres so markers sit roughly on the right land mass.
  const X = (lon: number) => ((lon + 180) / 360) * w;
  const Y = (lat: number) => ((90 - lat) / 180) * h;
  const blob = (lon: number, lat: number, rLon: number, rLat: number, col: string, rot = 0) => {
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(X(lon), Y(lat), (rLon / 360) * w, (rLat / 180) * h, rot, 0, Math.PI * 2);
    c.fill();
  };
  blob(-100, 48, 32, 20, "#22c55e"); // North America
  blob(-60, -15, 16, 24, "#15803d", 0.25); // South America
  blob(15, 50, 22, 12, "#16a34a"); // Europe
  blob(90, 45, 48, 20, "#16a34a"); // Asia
  blob(18, 18, 22, 14, "#d97706"); // Sahara
  blob(22, -8, 16, 20, "#15803d"); // Central/Southern Africa
  blob(134, -25, 17, 11, "#ca8a04"); // Australia
  blob(47, -19, 2.4, 6, "#16a34a", 0.2); // Madagascar
  blob(57.55, -20.25, 0.9, 0.9, "#16a34a"); // Mauritius (oversized so it is visible)
  blob(0, -84, 180, 8, "#f8fafc"); // Antarctica
  blob(0, 86, 180, 6, "#f1f5f9"); // Arctic ice
  blob(-42, 73, 14, 9, "#f1f5f9"); // Greenland
  const img = c.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 15;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  c.putImageData(img, 0, 0);

  const bump = document.createElement("canvas");
  bump.width = w;
  bump.height = h;
  const b = bump.getContext("2d")!;
  b.drawImage(day, 0, 0);
  const bd = b.getImageData(0, 0, w, h);
  for (let i = 0; i < bd.data.length; i += 4) {
    const avg = (bd.data[i] + bd.data[i + 1] + bd.data[i + 2]) / 3;
    bd.data[i] = bd.data[i + 1] = bd.data[i + 2] = avg > 100 ? avg : avg * 0.2;
  }
  b.putImageData(bd, 0, 0);

  const clouds = document.createElement("canvas");
  clouds.width = w;
  clouds.height = h;
  const cc = clouds.getContext("2d")!;
  cc.fillStyle = "rgba(255,255,255,0.7)";
  for (let i = 0; i < 400; i++) {
    cc.beginPath();
    cc.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 0, Math.PI * 2);
    cc.fill();
  }
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { day: tex(day, true), bump: tex(bump, false), clouds: tex(clouds, true) };
}

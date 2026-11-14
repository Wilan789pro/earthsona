import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * 3D globe (three.js), ported from earthy_interactive_3d_earth_jukebox.html and upgraded:
 *  - real NASA imagery: GIBS Blue Marble (day) and VIIRS Black Marble 2016 (night), bundled by
 *    `npm run fetch-data -- --only=imagery`; a plain stylised map is used only if those files are missing
 *  - optional NASA data overlay (GIBS snapshot: MUR SST / MODIS NDVI / MERRA-2 air temperature)
 *  - fits its own layout cell (ResizeObserver), so no UI floats over it
 *  - selected-place label, region markers, click-to-pick lat/lon, keyboard rotate/zoom
 * The prototype's random "clouds" were removed: over real imagery they would look like observations.
 */
export const GLOBE_RADIUS = 5;

export interface GlobeMarker {
  id: string;
  lat: number;
  lon: number;
  label?: string;
}

export class Globe {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private earth!: THREE.Mesh;
  private overlay!: THREE.Mesh;
  private beacon!: THREE.Group;
  private ring!: THREE.Mesh;
  private markers = new THREE.Group();
  private label: THREE.Sprite | null = null;
  private target: THREE.Vector3 | null = null;
  private textures: { day?: THREE.Texture; night?: THREE.Texture } = {};
  private loader = new THREE.TextureLoader();
  private style: "day" | "night" = "day";
  private themeTex: THREE.CanvasTexture | null = null;
  private clouds!: THREE.Mesh;
  private sun!: THREE.DirectionalLight;
  private ambient!: THREE.AmbientLight;
  /** True once real NASA imagery is on the globe. */
  realImagery = false;
  onImagery: (real: boolean) => void = () => {};
  onPick: (lat: number, lon: number) => void = () => {};
  onMarker: (id: string) => void = () => {};

  constructor(private host: HTMLElement, private textureBase = `${import.meta.env?.BASE_URL ?? "/"}textures/`) {
    // Transparent: the page draws the space background, so Luna can pass behind the Earth.
    this.scene.background = null;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    this.camera.position.set(0, 0, 15);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.6, zoomSpeed: 0.8, minDistance: 6.2, maxDistance: 30, enablePan: false });

    // Lighting kept soft and even so the imagery reads like a photograph, not a shaded ball.
    this.ambient = new THREE.AmbientLight(0xffffff, 2.1);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.1);
    this.sun.position.set(20, 10, 20);
    this.scene.add(this.sun);

    this.buildStars();
    this.buildEarth();
    this.buildBeacon();
    this.earth.add(this.markers);

    new ResizeObserver(() => this.resize()).observe(host);
    this.bindPicking();
    this.animate();
  }

  /** Use a painted world look (see globeThemes.ts); null goes back to the NASA photo. */
  setTheme(canvas: HTMLCanvasElement | null): void {
    const m = this.earth.material as THREE.MeshPhongMaterial;
    if (!canvas) {
      this.themeTex = null;
      this.setStyle(this.style);
      return;
    }
    if (!this.themeTex || this.themeTex.image !== canvas) {
      this.themeTex?.dispose();
      this.themeTex = new THREE.CanvasTexture(canvas);
      this.themeTex.colorSpace = THREE.SRGBColorSpace;
      this.themeTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    } else this.themeTex.needsUpdate = true;
    m.map = this.themeTex;
    m.emissiveMap = null;
    m.emissive.set(0x000000);
    m.color.set(0xffffff);
    m.needsUpdate = true;
  }

  /** Repaint after the theme canvas changed. */
  refreshTheme(): void {
    if (this.themeTex) this.themeTex.needsUpdate = true;
  }

  /** Pretend clouds (Luna's playground only). */
  setClouds(canvas: HTMLCanvasElement | null): void {
    const m = this.clouds.material as THREE.MeshPhongMaterial;
    if (!canvas) {
      this.clouds.visible = false;
      return;
    }
    if (!m.map || m.map.image !== canvas) {
      m.map?.dispose();
      m.map = new THREE.CanvasTexture(canvas);
      m.map.colorSpace = THREE.SRGBColorSpace;
    } else m.map.needsUpdate = true;
    m.needsUpdate = true;
    this.clouds.visible = true;
  }

  /** Sunlight strength, 0.3…1.6 (1 = normal). */
  setSunlight(level: number): void {
    this.sun.intensity = 1.1 * level;
    this.ambient.intensity = 1.2 + 0.9 * level;
  }

  /** Where the Earth is on screen (for Luna's orbit), in CSS pixels relative to the globe host. */
  screenDisc(): { cx: number; cy: number; r: number } {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const d = this.camera.position.length();
    const r = (GLOBE_RADIUS / (d * Math.tan((this.camera.fov * Math.PI) / 360))) * (h / 2);
    return { cx: w / 2, cy: h / 2, r };
  }

  setStyle(style: "day" | "night"): void {
    this.style = style;
    if (this.themeTex) return;
    const m = this.earth.material as THREE.MeshPhongMaterial;
    const tex = style === "night" ? this.textures.night : this.textures.day;
    if (tex) {
      m.map = tex;
      m.emissiveMap = style === "night" ? tex : null;
      m.emissive.set(style === "night" ? 0xffffff : 0x000000);
      m.emissiveIntensity = style === "night" ? 0.8 : 0;
      m.color.set(0xffffff);
    } else {
      m.color.set(style === "night" ? 0x334155 : 0xffffff);
    }
    m.needsUpdate = true;
  }

  /** Show a NASA data overlay (transparent PNG, equirectangular) or hide it with null. */
  setOverlay(file: string | null, onDone?: (ok: boolean) => void): void {
    const m = this.overlay.material as THREE.MeshBasicMaterial;
    if (!file) {
      this.overlay.visible = false;
      onDone?.(true);
      return;
    }
    this.loader.load(
      `${this.textureBase}${file}`,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        m.map?.dispose();
        m.map = t;
        m.needsUpdate = true;
        this.overlay.visible = true;
        onDone?.(true);
      },
      undefined,
      () => {
        this.overlay.visible = false;
        onDone?.(false);
      },
    );
  }

  /** Name label floating above the selected place. */
  setLabel(text: string | null, lat?: number, lon?: number): void {
    if (this.label) {
      this.earth.remove(this.label);
      (this.label.material as THREE.SpriteMaterial).map?.dispose();
      this.label = null;
    }
    if (!text || lat === undefined || lon === undefined) return;
    const font = "600 40px Fredoka, Nunito, system-ui, sans-serif";
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 44;
    c.width = w;
    c.height = 68;
    ctx.font = font;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#13b5d6";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, 64, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#17324d";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 22, 36);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set((0.42 * w) / 68, 0.42, 1);
    sprite.position.copy(latLonToVector3(lat, lon, GLOBE_RADIUS * 1.14));
    sprite.renderOrder = 10;
    this.label = sprite;
    this.earth.add(sprite);
  }

  setMarkers(markers: GlobeMarker[], color: string): void {
    this.markers.clear();
    for (const mk of markers) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), new THREE.MeshBasicMaterial({ color }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      halo.userData.id = mk.id;
      mesh.add(halo);
      mesh.position.copy(latLonToVector3(mk.lat, mk.lon, GLOBE_RADIUS * 1.008));
      mesh.userData.id = mk.id;
      this.markers.add(mesh);
    }
  }

  flyTo(lat: number, lon: number, distance = 13): void {
    this.earth.rotation.y = 0;
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS * 1.01);
    this.beacon.position.copy(pos);
    this.beacon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
    this.beacon.visible = true;
    // Narrow (portrait) windows need the camera further back to fit the whole Earth.
    this.target = latLonToVector3(lat, lon, distance * Math.max(1, 1.15 / this.camera.aspect));
  }

  reset(): void {
    this.target = new THREE.Vector3(0, 0, 15 * Math.max(1, 1.15 / this.camera.aspect));
    this.controls.target.set(0, 0, 0);
  }

  zoom(factor: number): void {
    const d = Math.min(30, Math.max(6.2, this.camera.position.length() * factor));
    this.camera.position.setLength(d);
  }

  rotate(dLon: number, dLat: number): void {
    const s = new THREE.Spherical().setFromVector3(this.camera.position);
    s.theta += dLon;
    s.phi = Math.max(0.15, Math.min(Math.PI - 0.15, s.phi + dLat));
    this.camera.position.setFromSpherical(s);
  }

  private buildEarth(): void {
    const mat = new THREE.MeshPhongMaterial({ map: stylisedFallback(), shininess: 6, specular: new THREE.Color(0x0b3a4a) });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 96, 96), mat);
    this.scene.add(this.earth);
    const load = (file: string, cb: (tex: THREE.Texture) => void) =>
      this.loader.load(`${this.textureBase}${file}`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        cb(tex);
      });
    load("blue-marble.jpg", (tex) => {
      this.textures.day = tex;
      this.realImagery = true;
      this.setStyle(this.style);
      this.onImagery(true);
    });
    load("black-marble-2016.jpg", (tex) => {
      this.textures.night = tex;
      if (this.style === "night") this.setStyle("night");
    });

    this.overlay = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.003, 96, 96),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.overlay.visible = false;
    this.earth.add(this.overlay);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.02, 64, 64),
      new THREE.MeshPhongMaterial({ transparent: true, depthWrite: false, opacity: 0.95 }),
    );
    this.clouds.visible = false;
    this.earth.add(this.clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.03, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vNormal; void main(){ float i = pow(0.62 - dot(vNormal, vec3(0,0,1.0)), 3.0); gl_FragColor = vec4(0.2,0.7,1.0,1.0) * i; }`,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
      }),
    );
    this.scene.add(atmosphere);
  }

  private buildStars(): void {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 80 + Math.random() * 100;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.6, color: 0xdde8ff, transparent: true, opacity: 0.7 })));
  }

  private buildBeacon(): void {
    const g = new THREE.Group();
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff5d73 }));
    pin.position.y = 0.07;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.035, 0.6, 16), new THREE.MeshBasicMaterial({ color: 0xff5d73, transparent: true, opacity: 0.7 }));
    beam.position.y = 0.3;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.16, 32), new THREE.MeshBasicMaterial({ color: 0xff5d73, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    this.ring.rotation.x = Math.PI / 2;
    g.add(pin, beam, this.ring);
    g.visible = false;
    this.beacon = g;
    this.earth.add(g);
  }

  private bindPicking(): void {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (down) => {
      const t0 = performance.now();
      const up = (e: PointerEvent) => {
        el.removeEventListener("pointerup", up);
        if (performance.now() - t0 > 300 || Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 6) return; // a drag
        const r = el.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
        const hitMarker = ray.intersectObjects(this.markers.children)[0];
        if (hitMarker) return this.onMarker(hitMarker.object.userData.id as string);
        const hit = ray.intersectObject(this.earth, false)[0];
        if (hit) {
          const { lat, lon } = vector3ToLatLon(this.earth.worldToLocal(hit.point.clone()));
          this.onPick(lat, lon);
        }
      };
      el.addEventListener("pointerup", up);
    });
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Stop drawing while something covers the globe (e.g. the introduction film). */
  paused = false;

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    if (this.paused) return;
    if (!this.target && !this.beacon.visible) this.earth.rotation.y += 0.0004;
    if (this.clouds.visible) this.clouds.rotation.y += 0.0003;
    this.ring.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.25);
    if (this.target) {
      this.camera.position.lerp(this.target, 0.06);
      this.controls.target.lerp(new THREE.Vector3(), 0.06);
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

/** Plain stylised map, used only until (or if) the NASA imagery files are unavailable. */
function stylisedFallback(): THREE.Texture {
  const w = 1024;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b3b5c";
  g.fillRect(0, 0, w, h);
  const X = (lon: number) => ((lon + 180) / 360) * w;
  const Y = (lat: number) => ((90 - lat) / 180) * h;
  const blob = (lon: number, lat: number, rLon: number, rLat: number, col: string, rot = 0) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(X(lon), Y(lat), (rLon / 360) * w, (rLat / 180) * h, rot, 0, Math.PI * 2);
    g.fill();
  };
  blob(-100, 48, 32, 20, "#3f6b3a");
  blob(-60, -15, 16, 24, "#2f5d2a", 0.25);
  blob(15, 50, 22, 12, "#4a6b3a");
  blob(90, 45, 48, 20, "#55703f");
  blob(18, 18, 22, 14, "#b08a4e");
  blob(22, -8, 16, 20, "#3f6b3a");
  blob(134, -25, 17, 11, "#a37b45");
  blob(0, -84, 180, 8, "#e2e8f0");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

import type { ExperienceId } from "../data/types";

/**
 * Animated, procedural environment for each laboratory (canvas 2D, no assets).
 * The scene eases towards the simulation's visual parameters over a few seconds, so changes are gradual.
 * It is a drawing of a SIMULATION, labelled as such in the UI.
 */
type P = Record<string, number>;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (c1: number[], c2: number[], t: number) => `rgb(${c1.map((c, i) => Math.round(lerp(c, c2[i], t))).join(",")})`;
const rnd = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export class LabScene {
  private ctx: CanvasRenderingContext2D;
  private cur: P = {};
  private target: P = {};
  private exp: ExperienceId = "forest";
  private raf = 0;
  private t0 = performance.now();
  private reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  running = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  set(exp: ExperienceId, visual: P, instant = false): void {
    if (exp !== this.exp) instant = true;
    this.exp = exp;
    this.target = { ...visual };
    if (instant || !Object.keys(this.cur).length) this.cur = { ...visual };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    const loop = () => {
      if (!this.running) return;
      this.step();
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  /** Ease every parameter towards its target with a ~0.7 s time constant (settles in ≈2 s at any frame rate). */
  private last = performance.now();
  private step() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const k = this.reduce ? 1 : 1 - Math.exp(-dt / 0.7);
    for (const key of Object.keys(this.target)) this.cur[key] = lerp(this.cur[key] ?? this.target[key], this.target[key], k);
  }

  private draw() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const t = this.reduce ? 0 : (performance.now() - this.t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    if (this.exp === "forest") this.forest(W, H, t, this.cur);
    else if (this.exp === "ocean") this.ocean(W, H, t, this.cur);
    else this.pulse(W, H, t, this.cur);
  }

  // ---------------------------------------------------------------------------
  private forest(W: number, H: number, t: number, p: P) {
    const c = this.ctx;
    const sun = p.sun ?? 0.66;
    const haze = p.haze ?? 0.7;
    // Sky: brighter with more sun, greyer with heavy rain.
    const g = c.createLinearGradient(0, 0, 0, H * 0.65);
    g.addColorStop(0, mix([20, 40, 90], [40, 160, 255], sun * (1 - 0.5 * (p.rain ?? 0.33))));
    g.addColorStop(1, mix([90, 110, 140], [190, 235, 255], sun));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // Sun
    c.fillStyle = `rgba(255, 220, 80, ${0.35 + 0.65 * sun})`;
    c.beginPath();
    c.arc(W * 0.82, H * 0.16, H * (0.05 + 0.05 * sun), 0, Math.PI * 2);
    c.fill();
    // Soil: dark brown when wet, pale cracked tan when dry, puddles when waterlogged.
    const groundY = H * 0.68;
    c.fillStyle = mix([70, 45, 25], [196, 160, 105], p.dry ?? 0);
    c.fillRect(0, groundY, W, H - groundY);
    if ((p.dry ?? 0) > 0.35) {
      c.strokeStyle = `rgba(90, 60, 30, ${(p.dry - 0.35) * 1.4})`;
      c.lineWidth = Math.max(1, W / 600);
      for (let i = 0; i < 40; i++) {
        const x = rnd(i) * W;
        const y = groundY + rnd(i + 99) * (H - groundY);
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (rnd(i + 3) - 0.5) * W * 0.05, y + rnd(i + 7) * H * 0.04);
        c.stroke();
      }
    }
    if ((p.wet ?? 0) > 0.1) {
      c.fillStyle = `rgba(90, 160, 230, ${Math.min(0.8, p.wet)})`;
      for (let i = 0; i < 6; i++) {
        c.beginPath();
        c.ellipse(rnd(i + 20) * W, groundY + H * 0.08 + rnd(i + 30) * H * 0.2, W * 0.06 * p.wet, H * 0.015, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Trees: density sets how many are leafy; green blends to yellow-brown with stress.
    const n = 14;
    const green = p.green ?? 0.8;
    const density = p.density ?? 0.85;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (W / n) + (rnd(i) - 0.5) * (W / n) * 0.6;
      const h = H * (0.22 + rnd(i + 5) * 0.16);
      const base = groundY + rnd(i + 11) * H * 0.04;
      c.fillStyle = "rgb(80, 52, 30)";
      c.fillRect(x - W * 0.006, base - h * 0.55, W * 0.012, h * 0.55);
      const leafy = rnd(i + 40) < density ? 1 : 0.15 + 0.3 * density;
      const sway = Math.sin(t * 1.2 + i) * W * 0.003;
      const col = mix([170, 120, 50], [40, 200, 90], green);
      c.fillStyle = col;
      c.globalAlpha = 0.35 + 0.65 * leafy;
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        c.arc(x + sway + (k - 1) * h * 0.13, base - h * (0.62 + (k % 2) * 0.12), h * 0.2 * (0.6 + 0.4 * leafy), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    // Rain streaks
    const rain = p.rain ?? 0.33;
    c.strokeStyle = "rgba(200, 225, 255, 0.55)";
    c.lineWidth = Math.max(1, W / 900);
    const drops = Math.round(rain * 140);
    for (let i = 0; i < drops; i++) {
      const x = (rnd(i) * W + t * 60) % W;
      const y = (rnd(i + 500) * H + t * H * 0.9) % (groundY + 10);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - W * 0.004, y + H * 0.03);
      c.stroke();
    }
    // Birds = wildlife activity
    const birds = Math.round((p.wildlife ?? 0.8) * 9);
    c.strokeStyle = "rgba(30, 30, 40, 0.8)";
    c.lineWidth = Math.max(1.5, W / 500);
    for (let i = 0; i < birds; i++) {
      const x = ((rnd(i + 70) * W + t * W * 0.04 * (0.5 + rnd(i))) % (W * 1.1)) - W * 0.05;
      const y = H * (0.12 + rnd(i + 80) * 0.25) + Math.sin(t * 2 + i) * H * 0.01;
      const s = W * 0.012;
      c.beginPath();
      c.moveTo(x - s, y);
      c.quadraticCurveTo(x - s / 2, y - s * 0.6, x, y);
      c.quadraticCurveTo(x + s / 2, y - s * 0.6, x + s, y);
      c.stroke();
    }
    // Humidity haze / heat shimmer
    c.fillStyle = `rgba(255, 255, 255, ${0.12 * haze})`;
    c.fillRect(0, groundY - H * 0.25, W, H * 0.25);
    if ((p.heat ?? 0) > 0.2) {
      c.fillStyle = `rgba(255, 120, 40, ${0.18 * p.heat})`;
      c.fillRect(0, 0, W, H);
    }
  }

  private ocean(W: number, H: number, t: number, p: P) {
    const c = this.ctx;
    const clarity = p.clarity ?? 0.85;
    const bloom = p.bloom ?? 0;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(mix([20, 120, 90], [40, 190, 240], clarity).match(/\d+/g)!.map(Number), [70, 150, 60], bloom * 0.8));
    g.addColorStop(1, mix([8, 30, 70], [4, 40, 110], clarity));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // Light rays (fewer in murky water)
    c.fillStyle = `rgba(255, 255, 255, ${0.08 * clarity})`;
    for (let i = 0; i < 5; i++) {
      const x = W * (0.1 + i * 0.2) + Math.sin(t * 0.3 + i) * W * 0.03;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + W * 0.05, 0);
      c.lineTo(x + W * 0.15, H * 0.8);
      c.lineTo(x + W * 0.08, H * 0.8);
      c.fill();
    }
    // Seabed
    const bed = H * 0.8;
    c.fillStyle = "rgb(214, 196, 150)";
    c.fillRect(0, bed, W, H - bed);
    // Corals: number by live coral; colour fades to white with bleaching; acidification thins them.
    const coral = p.coral ?? 0.75;
    const bleach = p.bleach ?? 0;
    const acid = p.acid ?? 0;
    const palettes = [[255, 110, 120], [255, 160, 60], [190, 90, 220], [255, 90, 170], [80, 200, 170]];
    for (let i = 0; i < 18; i++) {
      const alive = rnd(i + 3) < coral / 0.9;
      const x = (i + 0.5) * (W / 18) + (rnd(i) - 0.5) * W * 0.03;
      const h = H * (0.08 + rnd(i + 9) * 0.12) * (1 - 0.4 * acid);
      const col = alive ? mix(palettes[i % 5], [245, 245, 240], bleach) : "rgb(150, 140, 125)";
      c.strokeStyle = col;
      c.lineWidth = W * 0.008 * (1 - 0.4 * acid);
      c.lineCap = "round";
      for (let b = -1; b <= 1; b++) {
        c.beginPath();
        c.moveTo(x, bed);
        c.quadraticCurveTo(x + b * W * 0.012, bed - h * 0.6, x + b * W * 0.02 + Math.sin(t + i) * W * 0.002, bed - h * (0.8 + 0.2 * Math.abs(b)));
        c.stroke();
      }
    }
    // Algal bloom: green scum near the surface
    if (bloom > 0.05) {
      c.fillStyle = `rgba(90, 170, 60, ${0.5 * bloom})`;
      for (let i = 0; i < 30; i++) {
        c.beginPath();
        c.arc((rnd(i + 200) * W + t * 10) % W, H * (0.02 + rnd(i + 210) * 0.15), W * 0.03 * (0.5 + rnd(i)), 0, Math.PI * 2);
        c.fill();
      }
    }
    // Fish: count follows biodiversity; low oxygen makes them sluggish
    const fish = Math.round((p.fish ?? 0.8) * 16);
    const speed = 0.3 + 0.7 * (p.oxygen ?? 0.8);
    for (let i = 0; i < fish; i++) {
      const dir = rnd(i + 300) > 0.5 ? 1 : -1;
      const span = W * 1.2;
      let x = (rnd(i + 310) * span + dir * t * W * 0.05 * speed * (0.5 + rnd(i))) % span;
      if (x < 0) x += span;
      x -= W * 0.1;
      const y = H * (0.25 + rnd(i + 320) * 0.45) + Math.sin(t * 2 * speed + i) * H * 0.01;
      const s = W * (0.012 + rnd(i + 330) * 0.01);
      c.fillStyle = mix([255, 200, 60], [60, 220, 255], rnd(i + 340));
      c.beginPath();
      c.ellipse(x, y, s * 1.6, s * 0.8, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(x - dir * s * 1.4, y);
      c.lineTo(x - dir * s * 2.4, y - s * 0.7);
      c.lineTo(x - dir * s * 2.4, y + s * 0.7);
      c.fill();
    }
    // Bubbles = oxygen
    c.strokeStyle = "rgba(255, 255, 255, 0.5)";
    c.lineWidth = Math.max(1, W / 800);
    const bubbles = Math.round((p.oxygen ?? 0.8) * 25);
    for (let i = 0; i < bubbles; i++) {
      const x = rnd(i + 400) * W;
      const y = bed - ((t * H * 0.08 * (0.5 + rnd(i)) + rnd(i + 410) * H) % bed);
      c.beginPath();
      c.arc(x, y, W * 0.004 * (0.5 + rnd(i + 420)), 0, Math.PI * 2);
      c.stroke();
    }
    // Pollution: floating debris and murk
    const pol = p.pollution ?? 0.15;
    c.fillStyle = `rgba(110, 100, 80, ${0.35 * pol})`;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < Math.round(pol * 20); i++) {
      c.fillStyle = "rgba(230, 230, 230, 0.7)";
      c.fillRect((rnd(i + 500) * W + t * 8) % W, H * rnd(i + 510) * 0.7, W * 0.012, W * 0.004);
    }
  }

  private pulse(W: number, H: number, t: number, p: P) {
    const c = this.ctx;
    const temp = p.temp ?? 0.22;
    c.fillStyle = mix([6, 12, 30], [40, 10, 10], temp * 0.7);
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 80; i++) {
      c.fillStyle = `rgba(255,255,255,${0.3 + 0.7 * rnd(i)})`;
      c.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 1.5, 1.5);
    }
    const R = Math.min(W, H) * 0.36;
    const cx = W * 0.42;
    const cy = H * 0.52;
    // Heat glow
    const glow = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.45);
    glow.addColorStop(0, `rgba(255, ${Math.round(160 - 120 * temp)}, 40, ${0.15 + 0.6 * temp})`);
    glow.addColorStop(1, "rgba(255, 80, 20, 0)");
    c.fillStyle = glow;
    c.beginPath();
    c.arc(cx, cy, R * 1.45, 0, Math.PI * 2);
    c.fill();
    // Ocean: deeper blue; a higher sea floods the coasts (shrinks the land shapes)
    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "rgb(20, 90, 200)";
    c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const sea = p.sea ?? 0.09;
    const veg = p.veg ?? 0.66;
    const land = [[-0.35, -0.1, 0.32, 0.4], [0.25, 0.05, 0.28, 0.48], [0.05, -0.45, 0.25, 0.16], [-0.1, 0.45, 0.2, 0.14]];
    const rot = t * 0.05;
    for (const [lx, ly, rx, ry] of land) {
      const x = cx + (lx + Math.sin(rot) * 0.05) * R;
      const y = cy + ly * R;
      const shrink = 1 - 0.35 * sea;
      c.fillStyle = mix([200, 170, 110], [40, 180, 80], veg);
      c.beginPath();
      c.ellipse(x, y, rx * R * shrink, ry * R * shrink, 0.3, 0, Math.PI * 2);
      c.fill();
      // flooded rim
      c.strokeStyle = `rgba(120, 200, 255, ${0.6 * sea})`;
      c.lineWidth = R * 0.03 * sea;
      c.stroke();
    }
    // Ice caps
    const ice = p.ice ?? 0.66;
    c.fillStyle = "rgba(240, 250, 255, 0.95)";
    c.beginPath();
    c.ellipse(cx, cy - R, R * 0.9 * ice, R * 0.35 * ice, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(cx, cy + R, R * 0.95 * ice, R * 0.4 * ice, 0, 0, Math.PI * 2);
    c.fill();
    // Storms
    const storms = Math.round((p.storms ?? 0.33) * 7);
    for (let i = 0; i < storms; i++) {
      const x = cx + (rnd(i + 600) - 0.5) * R * 1.4;
      const y = cy + (rnd(i + 610) - 0.5) * R * 1.1;
      c.strokeStyle = "rgba(255, 255, 255, 0.75)";
      c.lineWidth = R * 0.02;
      c.beginPath();
      for (let a = 0; a < 12; a += 0.3) {
        const r = R * 0.012 * a * (0.6 + p.storms);
        const px = x + Math.cos(a + t * 2) * r;
        const py = y + Math.sin(a + t * 2) * r;
        a === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.stroke();
    }
    c.restore();
    c.strokeStyle = "rgba(140, 220, 255, 0.6)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.stroke();
    // Thermometer and CO₂ gauge
    const tx = W * 0.86;
    const top = H * 0.15;
    const bot = H * 0.82;
    c.fillStyle = "rgba(255,255,255,0.15)";
    c.fillRect(tx - 10, top, 20, bot - top);
    c.fillStyle = mix([255, 210, 60], [255, 50, 40], temp);
    c.fillRect(tx - 10, bot - (bot - top) * temp, 20, (bot - top) * temp);
    c.beginPath();
    c.arc(tx, bot + 14, 18, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.font = `${Math.round(H * 0.035)}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.fillText("temp", tx, top - 10);
    const gx = W * 0.94;
    const co2 = p.co2 ?? 0.19;
    c.fillStyle = "rgba(255,255,255,0.15)";
    c.fillRect(gx - 8, top, 16, bot - top);
    c.fillStyle = "rgb(190, 140, 255)";
    c.fillRect(gx - 8, bot - (bot - top) * co2, 16, (bot - top) * co2);
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.fillText("CO₂", gx, top - 10);
  }
}

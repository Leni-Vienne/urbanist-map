// Dev-only camera-motion benchmark. Drives a deterministic flight path through the
// active map engine and samples frame health. The same harness runs against the current
// Leaflet+MapLibre setup and a future MapLibre-only build, so before/after is comparable.
//
// Console usage (dev only):
//   window.__perfBench.run()                          run once, print a table
//   window.__perfBench.run({ repeats: 5 })            5 measured passes, report the median
//   window.__perfBench.run({ download: true })        also download the JSON report
//   window.__perfBench.run({ scenarios: ["zoom"] })   a single scenario

import { getMlMap } from "@/services/map/tileLayers";
import type { Map as MaplibreMap } from "maplibre-gl";

export interface Camera {
  center: [number, number]; // [lng, lat]
  zoom: number;
  bearing: number;
}

interface CameraAdapter {
  engine: "leaflet" | "maplibre";
  canRotate: boolean;
  getCamera(): Camera;
  jumpTo(cam: Partial<Camera>): void;
  animateTo(cam: Partial<Camera>, durationMs: number): Promise<void>;
}

interface Segment {
  to: Partial<Camera>;
  durationMs: number;
}

interface Scenario {
  name: string;
  description: string;
  requiresRotation?: boolean;
  start: (base: Camera) => Partial<Camera>;
  segments: (base: Camera) => Segment[];
}

interface FrameStats {
  frames: number;
  durationMs: number;
  fps: number;
  medianFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  longestFrameMs: number;
  jankFrames: number; // frames slower than 50ms
  jankPct: number;
  droppedVs60: number; // estimated dropped frames against a 60fps budget
}

interface LongTaskStats {
  count: number;
  totalMs: number;
  longestMs: number;
}

interface ScenarioResult {
  scenario: string;
  frames: FrameStats;
  longTasks: LongTaskStats;
}

interface BenchReport {
  engine: string;
  timestamp: string;
  url: string;
  userAgent: string;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
  hardwareConcurrency: number;
  deviceMemoryGB: number | null;
  repeats: number;
  memoryMB: { before: number | null; after: number | null };
  results: ScenarioResult[];
}

export interface BenchOptions {
  scenarios?: string[];
  repeats?: number;
  download?: boolean;
}

const PAN_LNG = 0.012;
const PAN_LAT = 0.008;
const FRAME_BUDGET_MS = 1000 / 60;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maplibreAdapter(m: MaplibreMap): CameraAdapter {
  function getCamera(): Camera {
    const c = m.getCenter();
    return { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing() };
  }
  function merge(cam: Partial<Camera>): Camera {
    const cur = getCamera();
    return {
      center: cam.center ?? cur.center,
      zoom: cam.zoom ?? cur.zoom,
      bearing: cam.bearing ?? cur.bearing,
    };
  }
  function jumpTo(cam: Partial<Camera>): void {
    m.jumpTo(merge(cam));
  }
  function animateTo(cam: Partial<Camera>, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      function finish() {
        if (done) return;
        done = true;
        m.off("moveend", finish);
        resolve();
      }
      m.on("moveend", finish);
      m.flyTo({ ...merge(cam), duration: durationMs });
      setTimeout(finish, durationMs + 1500);
    });
  }
  return { engine: "maplibre", canRotate: true, getCamera, jumpTo, animateTo };
}

function getCameraAdapter(): CameraAdapter {
  const ml = getMlMap();
  if (ml) return maplibreAdapter(ml);
  throw new Error("perfBench: no map instance is initialized yet");
}

const scenarios: Scenario[] = [
  {
    name: "pan",
    description: "Pan east and back at street zoom",
    start: (b) => ({ center: b.center, zoom: Math.max(b.zoom, 15) }),
    segments: (b) => {
      const z = Math.max(b.zoom, 15);
      const east: [number, number] = [b.center[0] + PAN_LNG, b.center[1]];
      return [
        { to: { center: east, zoom: z }, durationMs: 3000 },
        { to: { center: b.center, zoom: z }, durationMs: 3000 },
      ];
    },
  },
  {
    name: "zoom",
    description: "Zoom 12 to 17 and back at a fixed center",
    start: (b) => ({ center: b.center, zoom: 12 }),
    segments: (b) => [
      { to: { center: b.center, zoom: 17 }, durationMs: 4000 },
      { to: { center: b.center, zoom: 12 }, durationMs: 4000 },
    ],
  },
  {
    name: "panZoom",
    description: "Diagonal pan with zoom 13 to 16 and back",
    start: (b) => ({ center: b.center, zoom: 13 }),
    segments: (b) => {
      const ne: [number, number] = [b.center[0] + PAN_LNG, b.center[1] + PAN_LAT];
      return [
        { to: { center: ne, zoom: 16 }, durationMs: 4000 },
        { to: { center: b.center, zoom: 13 }, durationMs: 4000 },
      ];
    },
  },
  {
    name: "rotate",
    description: "Rotate bearing 0 to 90 and back (MapLibre only)",
    requiresRotation: true,
    start: (b) => ({ center: b.center, zoom: Math.max(b.zoom, 15), bearing: 0 }),
    segments: (b) => {
      const z = Math.max(b.zoom, 15);
      return [
        { to: { center: b.center, zoom: z, bearing: 90 }, durationMs: 3000 },
        { to: { center: b.center, zoom: z, bearing: 0 }, durationMs: 3000 },
      ];
    },
  },
];

async function runSegments(adapter: CameraAdapter, segments: Segment[]): Promise<void> {
  for (const seg of segments) {
    // eslint-disable-next-line no-await-in-loop
    await adapter.animateTo(seg.to, seg.durationMs);
  }
}

async function recordFrames(routine: () => Promise<void>): Promise<number[]> {
  const deltas: number[] = [];
  let last = performance.now();
  let active = true;
  function tick(now: number) {
    deltas.push(now - last);
    last = now;
    if (active) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  await routine();
  active = false;
  // Drop the first sample: it spans the gap before the animation actually started.
  if (deltas.length > 1) deltas.shift();
  return deltas;
}

function computeStats(deltas: number[]): FrameStats {
  const frames = deltas.length;
  const durationMs = deltas.reduce((sum, d) => sum + d, 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  function percentile(q: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  }
  const jankFrames = deltas.filter((d) => d > 50).length;
  const droppedVs60 = deltas.reduce(
    (sum, d) => sum + Math.max(0, Math.round(d / FRAME_BUDGET_MS) - 1),
    0,
  );
  return {
    frames,
    durationMs: round(durationMs),
    fps: durationMs > 0 ? round((frames / durationMs) * 1000) : 0,
    medianFrameMs: round(percentile(0.5)),
    p95FrameMs: round(percentile(0.95)),
    p99FrameMs: round(percentile(0.99)),
    longestFrameMs: round(Math.max(0, ...deltas)),
    jankFrames,
    jankPct: round((jankFrames / Math.max(1, frames)) * 100),
    droppedVs60,
  };
}

function startLongTaskObserver(): () => LongTaskStats {
  const durations: number[] = [];
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    // longtask is unsupported (e.g. Safari); long-task metrics stay at zero.
  }
  return function stop(): LongTaskStats {
    observer?.disconnect();
    return {
      count: durations.length,
      totalMs: round(durations.reduce((sum, d) => sum + d, 0)),
      longestMs: round(Math.max(0, ...durations)),
    };
  };
}

async function measurePass(
  adapter: CameraAdapter,
  scenario: Scenario,
  base: Camera,
  segments: Segment[],
): Promise<ScenarioResult> {
  adapter.jumpTo(scenario.start(base));
  await delay(400);

  const stopLongTasks = startLongTaskObserver();
  const deltas = await recordFrames(() => runSegments(adapter, segments));
  const longTasks = stopLongTasks();

  return { scenario: scenario.name, frames: computeStats(deltas), longTasks };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function medianResult(name: string, passes: ScenarioResult[]): ScenarioResult {
  function pick(getter: (p: ScenarioResult) => number): number {
    return round(median(passes.map(getter)));
  }
  return {
    scenario: name,
    frames: {
      frames: Math.round(pick((p) => p.frames.frames)),
      durationMs: pick((p) => p.frames.durationMs),
      fps: pick((p) => p.frames.fps),
      medianFrameMs: pick((p) => p.frames.medianFrameMs),
      p95FrameMs: pick((p) => p.frames.p95FrameMs),
      p99FrameMs: pick((p) => p.frames.p99FrameMs),
      longestFrameMs: pick((p) => p.frames.longestFrameMs),
      jankFrames: Math.round(pick((p) => p.frames.jankFrames)),
      jankPct: pick((p) => p.frames.jankPct),
      droppedVs60: Math.round(pick((p) => p.frames.droppedVs60)),
    },
    longTasks: {
      count: Math.round(pick((p) => p.longTasks.count)),
      totalMs: pick((p) => p.longTasks.totalMs),
      longestMs: pick((p) => p.longTasks.longestMs),
    },
  };
}

function memoryMB(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? round(mem.usedJSHeapSize / 1048576) : null;
}

function printReport(report: BenchReport): void {
  console.log(`%cperfBench — ${report.engine}`, "font-weight:bold;font-size:13px");
  console.table(
    report.results.map((r) => ({
      scenario: r.scenario,
      fps: r.frames.fps,
      "median ms": r.frames.medianFrameMs,
      "p95 ms": r.frames.p95FrameMs,
      "p99 ms": r.frames.p99FrameMs,
      "worst ms": r.frames.longestFrameMs,
      "jank %": r.frames.jankPct,
      "dropped/60": r.frames.droppedVs60,
      longtasks: r.longTasks.count,
      "blocked ms": r.longTasks.totalMs,
    })),
  );
  console.log(
    `memory MB: ${report.memoryMB.before ?? "n/a"} → ${report.memoryMB.after ?? "n/a"}`,
    `| repeats: ${report.repeats} | dpr: ${report.devicePixelRatio} | cores: ${report.hardwareConcurrency}`,
  );
}

function downloadReport(report: BenchReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `perfbench-${report.engine}-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function run(opts: BenchOptions = {}): Promise<BenchReport> {
  const adapter = getCameraAdapter();
  const repeats = Math.max(1, opts.repeats ?? 1);
  const selected = scenarios.filter((s) => {
    if (opts.scenarios && !opts.scenarios.includes(s.name)) return false;
    if (s.requiresRotation && !adapter.canRotate) return false;
    return true;
  });

  const memBefore = memoryMB();
  const results: ScenarioResult[] = [];

  for (const scenario of selected) {
    const base = adapter.getCamera();
    const segments = scenario.segments(base);

    // Warm pass: load tiles for the panned-into area so the measured pass reflects
    // rendering cost, not first-time network fetches.
    adapter.jumpTo(scenario.start(base));
    // eslint-disable-next-line no-await-in-loop
    await delay(800);
    // eslint-disable-next-line no-await-in-loop
    await runSegments(adapter, segments);

    const passes: ScenarioResult[] = [];
    for (let i = 0; i < repeats; i += 1) {
      console.log(
        `perfBench: ${scenario.name} (${scenario.description}) — pass ${i + 1}/${repeats}`,
      );
      // eslint-disable-next-line no-await-in-loop
      passes.push(await measurePass(adapter, scenario, base, segments));
    }
    results.push(
      repeats === 1 ? (passes[0] as ScenarioResult) : medianResult(scenario.name, passes),
    );
  }

  const report: BenchReport = {
    engine: adapter.engine,
    timestamp: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
    repeats,
    memoryMB: { before: memBefore, after: memoryMB() },
    results,
  };

  printReport(report);
  if (opts.download) downloadReport(report);
  return report;
}

declare global {
  interface Window {
    __perfBench?: {
      run: typeof run;
      scenarios: string[];
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.env.DEV) {
  window.__perfBench = { run, scenarios: scenarios.map((s) => s.name) };
  console.log(
    "perfBench ready — park the map over a dense area, then run window.__perfBench.run({ repeats: 5, download: true })",
  );
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}

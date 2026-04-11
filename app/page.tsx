"use client";

import db from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type PathPoint = { lat: number; lng: number };

const PATH_STORAGE_KEY = "mission-map-path";

function haversineMeters(a: PathPoint, b: PathPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function totalPathDistanceMeters(points: PathPoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += haversineMeters(points[i - 1], points[i]);
  }
  return sum;
}

function formatMissionClock(elapsedMs: number): string {
  const safe = Math.max(0, elapsedMs);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const centiseconds = Math.floor((safe % 1000) / 10);
  const p2 = (n: number) => n.toString().padStart(2, "0");
  return `${p2(minutes)}:${p2(seconds)}:${p2(centiseconds)}`;
}

function computeBounds(points: PathPoint[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  if (points.length === 0) return null;

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const MIN_SPAN = 1e-6;
  if (maxLat - minLat < MIN_SPAN) {
    const mid = (minLat + maxLat) / 2;
    minLat = mid - MIN_SPAN / 2;
    maxLat = mid + MIN_SPAN / 2;
  }
  if (maxLng - minLng < MIN_SPAN) {
    const mid = (minLng + maxLng) / 2;
    minLng = mid - MIN_SPAN / 2;
    maxLng = mid + MIN_SPAN / 2;
  }

  return { minLat, maxLat, minLng, maxLng };
}

/** Maps GPS (lat, lng) to canvas pixel coordinates; auto-zooms to bounds with padding. */
function gpsToCanvasPixels(
  lat: number,
  lng: number,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  width: number,
  height: number,
  paddingPx: number,
): [number, number] {
  const pad = paddingPx;
  const innerW = Math.max(width - 2 * pad, 1);
  const innerH = Math.max(height - 2 * pad, 1);
  const latSpan = bounds.maxLat - bounds.minLat;
  const lngSpan = bounds.maxLng - bounds.minLng;
  const scale = Math.min(innerW / lngSpan, innerH / latSpan);
  const drawnW = lngSpan * scale;
  const drawnH = latSpan * scale;
  const ox = pad + (innerW - drawnW) / 2;
  const oy = pad + (innerH - drawnH) / 2;
  const x = ox + (lng - bounds.minLng) * scale;
  const y = oy + (bounds.maxLat - lat) * scale;
  return [x, y];
}

function MissionMapCanvas({ path }: { path: PathPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW < 1 || cssH < 1) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgb(15 23 42)";
    ctx.fillRect(0, 0, cssW, cssH);

    if (path.length < 2) return;

    const bounds = computeBounds(path);
    if (!bounds) return;

    const padding = 20;
    const lineWidth = 3;

    ctx.strokeStyle = "rgb(16 185 129)";
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(16, 185, 129, 0.85)";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    const [x0, y0] = gpsToCanvasPixels(
      path[0].lat,
      path[0].lng,
      bounds,
      cssW,
      cssH,
      padding,
    );
    ctx.moveTo(x0, y0);
    for (let i = 1; i < path.length; i++) {
      const [x, y] = gpsToCanvasPixels(
        path[i].lat,
        path[i].lng,
        bounds,
        cssW,
        cssH,
        padding,
      );
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [path]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div
      ref={wrapRef}
      className="relative h-72 w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </div>
  );
}

export default function Home() {
  const [lat, setLat] = useState("0.0000");
  const [lng, setLng] = useState("0.0000");
  const [path, setPath] = useState<PathPoint[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [botStreamActive, setBotStreamActive] = useState(false);
  const [rfidLabel, setRfidLabel] = useState<"Searching..." | "Checkpoint Reached">(
    "Searching...",
  );
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [suppressMissionModal, setSuppressMissionModal] = useState(false);
  const [missionTimerFrozen, setMissionTimerFrozen] = useState(false);

  useLayoutEffect(() => {
    try {
      const raw = sessionStorage.getItem(PATH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const next: PathPoint[] = [];
          for (const item of parsed) {
            if (
              item &&
              typeof item === "object" &&
              "lat" in item &&
              "lng" in item &&
              typeof (item as PathPoint).lat === "number" &&
              typeof (item as PathPoint).lng === "number" &&
              Number.isFinite((item as PathPoint).lat) &&
              Number.isFinite((item as PathPoint).lng)
            ) {
              next.push({ lat: (item as PathPoint).lat, lng: (item as PathPoint).lng });
            }
          }
          setPath(next);
        }
      }
    } catch {
      /* ignore corrupt storage */
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      sessionStorage.setItem(PATH_STORAGE_KEY, JSON.stringify(path));
    } catch {
      /* quota / private mode */
    }
  }, [path, storageReady]);

  useEffect(() => {
    if (rfidLabel === "Searching...") {
      setSuppressMissionModal(false);
    }
  }, [rfidLabel]);

  useEffect(() => {
    if (rfidLabel === "Checkpoint Reached") {
      setMissionTimerFrozen(true);
    }
  }, [rfidLabel]);

  useEffect(() => {
    const open = rfidLabel === "Checkpoint Reached" && !suppressMissionModal;
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [rfidLabel, suppressMissionModal]);

  useEffect(() => {
    if (!storageReady) return;

    const connectedRef = ref(db, ".info/connected");
    const unsubConnected = onValue(connectedRef, (snap) => {
      setFirebaseConnected(!!snap.val());
    });

    const botRef = ref(db, "bot");
    const unsubBot = onValue(botRef, (snapshot) => {
      setBotStreamActive(true);
      const data = snapshot.val() as Record<string, unknown> | null;

      if (!data || typeof data !== "object") {
        setRfidLabel("Searching...");
        return;
      }

      const latNum = data.lat != null ? Number(data.lat) : NaN;
      const lngNum = data.lng != null ? Number(data.lng) : NaN;

      if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
        setLat(latNum.toFixed(4));
        setLng(lngNum.toFixed(4));
        setPath((prev) => [...prev, { lat: latNum, lng: lngNum }]);
      }

      const reached =
        data.checkpoint === true ||
        data.rfidReached === true ||
        data.rfidStatus === "Checkpoint Reached" ||
        data.status === "Checkpoint Reached";

      setRfidLabel(reached ? "Checkpoint Reached" : "Searching...");
    });

    return () => {
      unsubConnected();
      unsubBot();
    };
  }, [storageReady]);

  const clearPath = useCallback(() => {
    setPath([]);
    try {
      sessionStorage.removeItem(PATH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const dataLive = firebaseConnected && botStreamActive;

  useEffect(() => {
    if (dataLive && startTime === null) {
      setStartTime(Date.now());
    }
  }, [dataLive, startTime]);

  useEffect(() => {
    if (startTime === null) return;

    if (missionTimerFrozen) {
      setElapsedTime(Date.now() - startTime);
      return;
    }

    const id = window.setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 10);

    return () => window.clearInterval(id);
  }, [startTime, missionTimerFrozen]);

  const totalDistanceM = totalPathDistanceMeters(path);
  const elapsedSeconds = elapsedTime / 1000;
  const averageSpeedMps = elapsedSeconds > 0 ? totalDistanceM / elapsedSeconds : 0;

  const downloadReport = useCallback(() => {
    const payload = {
      completedAt: new Date().toISOString(),
      totalTimeMs: elapsedTime,
      totalDistanceMeters: totalDistanceM,
      averageSpeedMetersPerSecond: averageSpeedMps,
      pathPointCount: path.length,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `safari-mission-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [elapsedTime, totalDistanceM, averageSpeedMps, path.length]);

  const resetForNewRun = useCallback(() => {
    setSuppressMissionModal(true);
    setMissionTimerFrozen(false);
    setStartTime(null);
    setElapsedTime(0);
    clearPath();
  }, [clearPath]);

  const showMissionModal = rfidLabel === "Checkpoint Reached" && !suppressMissionModal;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-8">
          <h1 className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
            Bot telemetry
          </h1>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                Connection status
              </h2>
              <div className="flex items-center gap-3">
                <span
                  className={`relative flex h-3.5 w-3.5 rounded-full ${
                    dataLive ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.9)]" : "bg-slate-600"
                  } ${dataLive ? "animate-pulse" : ""}`}
                  aria-hidden
                />
                <span className="text-sm text-slate-400">
                  <span className={dataLive ? "text-emerald-400" : "text-slate-500"}>
                    {dataLive ? "Data active" : firebaseConnected ? "Connected — waiting for /bot" : "Disconnected"}
                  </span>
                </span>
              </div>
            </div>
            <div className="sm:text-right">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                Lap timer
              </h2>
              <p
                className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-emerald-500 sm:text-3xl"
                style={{
                  textShadow:
                    "0 0 16px rgba(16, 185, 129, 0.75), 0 0 32px rgba(16, 185, 129, 0.3)",
                }}
              >
                {formatMissionClock(elapsedTime)}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">Min : Sec : Cs</p>
            </div>
          </div>
        </header>

        <section className="grid gap-10 sm:grid-cols-2">
          <div>
            <p
              className="mb-3 text-3xl font-bold tracking-tight text-emerald-500 sm:text-4xl"
              style={{
                textShadow:
                  "0 0 20px rgba(16, 185, 129, 0.85), 0 0 40px rgba(16, 185, 129, 0.35)",
              }}
            >
              LATITUDE
            </p>
            <p
              className="text-4xl font-semibold tabular-nums text-emerald-500 sm:text-5xl"
              style={{
                textShadow:
                  "0 0 20px rgba(16, 185, 129, 0.85), 0 0 40px rgba(16, 185, 129, 0.35)",
              }}
            >
              {lat}
            </p>
          </div>
          <div>
            <p
              className="mb-3 text-3xl font-bold tracking-tight text-emerald-500 sm:text-4xl"
              style={{
                textShadow:
                  "0 0 20px rgba(16, 185, 129, 0.85), 0 0 40px rgba(16, 185, 129, 0.35)",
              }}
            >
              LONGITUDE
            </p>
            <p
              className="text-4xl font-semibold tabular-nums text-emerald-500 sm:text-5xl"
              style={{
                textShadow:
                  "0 0 20px rgba(16, 185, 129, 0.85), 0 0 40px rgba(16, 185, 129, 0.35)",
              }}
            >
              {lng}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
            RFID Status
          </h2>
          <p
            className={`text-xl font-medium ${
              rfidLabel === "Checkpoint Reached" ? "text-emerald-400" : "text-amber-400/90"
            }`}
          >
            {rfidLabel}
          </p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Mission Map
            </h2>
            <button
              type="button"
              onClick={clearPath}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-emerald-600/50 hover:bg-slate-700 hover:text-emerald-200"
            >
              Clear Path
            </button>
          </div>
          <MissionMapCanvas path={path} />
          {path.length < 2 && (
            <p className="mt-3 text-center text-xs text-slate-500">
              Trail appears after at least two GPS samples. Points: {path.length}
            </p>
          )}
        </section>
      </div>

      {showMissionModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mission-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/95 p-8 shadow-[0_0_40px_rgba(16,185,129,0.12)]">
            <h2
              id="mission-modal-title"
              className="mb-6 text-center text-xl font-bold uppercase tracking-wide text-emerald-500 sm:text-2xl"
              style={{
                textShadow:
                  "0 0 18px rgba(16, 185, 129, 0.85), 0 0 36px rgba(16, 185, 129, 0.35)",
              }}
            >
              SAFARI MISSION COMPLETE
            </h2>

            <dl className="space-y-4 border-y border-slate-800 py-6">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Total time
                </dt>
                <dd className="font-mono text-lg tabular-nums text-emerald-400">
                  {formatMissionClock(elapsedTime)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Total distance
                </dt>
                <dd className="text-lg text-slate-100">{totalDistanceM.toFixed(2)} m</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Average speed
                </dt>
                <dd className="text-lg text-slate-100">
                  {elapsedSeconds > 0 ? `${averageSpeedMps.toFixed(3)} m/s` : "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={downloadReport}
                className="flex-1 rounded-lg border border-emerald-600/50 bg-emerald-950/40 px-4 py-2.5 text-sm font-medium text-emerald-300 transition hover:border-emerald-500 hover:bg-emerald-900/30 hover:text-emerald-200"
              >
                Download report
              </button>
              <button
                type="button"
                onClick={resetForNewRun}
                className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700"
              >
                Reset for new run
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

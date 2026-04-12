"use client";

import db from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type PathPoint = { lat: number; lng: number };

type AnimalSighting = { name: string; lat: number; lng: number; time: string };

const PATH_STORAGE_KEY = "mission-map-path";

function detectedAnimalName(val: unknown): string | null {
  if (val == null || val === "") return null;
  if (typeof val === "string") {
    const t = val.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof val === "object" && val !== null && "name" in val) {
    const n = (val as { name: unknown }).name;
    if (typeof n === "string" && n.trim()) return n.trim();
  }
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function computeMapBounds(path: PathPoint[], sightings: AnimalSighting[]) {
  const pts: PathPoint[] = [...path];
  for (const s of sightings) {
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
      pts.push({ lat: s.lat, lng: s.lng });
    }
  }
  if (pts.length === 0) return null;
  return computeBounds(pts);
}

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

function MissionMapCanvas({
  path,
  sightings,
}: {
  path: PathPoint[];
  sightings: AnimalSighting[];
}) {
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

    const bgGrad = ctx.createLinearGradient(0, 0, cssW, cssH);
    bgGrad.addColorStop(0, "#1e2d22");
    bgGrad.addColorStop(0.4, "#152019");
    bgGrad.addColorStop(1, "#0c140e");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = "rgba(212, 188, 142, 0.07)";
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      const baseY = (cssH / 10) * (i + 0.5);
      for (let x = 0; x <= cssW; x += 16) {
        const w = Math.sin(x * 0.018 + i * 0.7) * 5 + Math.sin(x * 0.035) * 2;
        if (x === 0) ctx.moveTo(x, baseY + w);
        else ctx.lineTo(x, baseY + w);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(100, 120, 95, 0.12)";
    for (let j = 0; j < 6; j++) {
      ctx.beginPath();
      const baseX = (cssW / 7) * (j + 0.5);
      for (let y = 0; y <= cssH; y += 14) {
        const w = Math.sin(y * 0.022 + j * 0.5) * 4;
        if (y === 0) ctx.moveTo(baseX + w, y);
        else ctx.lineTo(baseX + w, y);
      }
      ctx.stroke();
    }

    const bounds = computeMapBounds(path, sightings);
    if (!bounds) return;

    const padding = 20;
    const lineWidth = 3;

    if (path.length >= 2) {
      ctx.strokeStyle = "#E85D04";
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(245, 211, 0, 0.75)";
      ctx.shadowBlur = 14;

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
    }

    for (const s of sightings) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      const [sx, sy] = gpsToCanvasPixels(s.lat, s.lng, bounds, cssW, cssH, padding);
      ctx.beginPath();
      ctx.arc(sx, sy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#F0D78C";
      ctx.strokeStyle = "#E85D04";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(245, 211, 0, 0.55)";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      const label = s.name.length <= 6 ? s.name : `${s.name.slice(0, 10)}…`;
      ctx.font = "600 12px system-ui, Segoe UI Emoji, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "#F5EEDC";
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 3;
      ctx.strokeText(label, sx, sy - 11);
      ctx.fillText(label, sx, sy - 11);
    }
  }, [path, sightings]);

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
      className="relative h-72 w-full overflow-hidden rounded-2xl border border-[#D4BC8E] bg-[#2A1F16]/80 shadow-[0_10px_28px_rgba(0,0,0,0.5),0_3px_10px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(245,238,220,0.08)]"
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
  const [sightings, setSightings] = useState<AnimalSighting[]>([]);
  const lastDetectedAnimalRef = useRef<string | null>(null);

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

      const animalName = detectedAnimalName(data.detectedAnimal);
      if (
        animalName != null &&
        animalName !== lastDetectedAnimalRef.current &&
        Number.isFinite(latNum) &&
        Number.isFinite(lngNum)
      ) {
        lastDetectedAnimalRef.current = animalName;
        const ts = new Date().toISOString();
        setSightings((prev) => [
          ...prev,
          { name: animalName, lat: latNum, lng: lngNum, time: ts },
        ]);
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
      animalSightings: sightings,
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
  }, [elapsedTime, totalDistanceM, averageSpeedMps, path.length, sightings]);

  const resetForNewRun = useCallback(() => {
    setSuppressMissionModal(true);
    setMissionTimerFrozen(false);
    setStartTime(null);
    setElapsedTime(0);
    lastDetectedAnimalRef.current = null;
    setSightings([]);
    clearPath();
  }, [clearPath]);

  const showMissionModal = rfidLabel === "Checkpoint Reached" && !suppressMissionModal;

  return (
    <main className="relative min-h-screen overflow-x-hidden px-6 py-12 text-[#F5EEDC]">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-[#1B2613]" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.4]"
        style={{
          backgroundImage: `
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 3px,
              rgba(0, 0, 0, 0.045) 3px,
              rgba(0, 0, 0, 0.045) 4px
            ),
            repeating-linear-gradient(
              90deg,
              transparent,
              transparent 3px,
              rgba(0, 0, 0, 0.035) 3px,
              rgba(0, 0, 0, 0.035) 4px
            ),
            repeating-linear-gradient(
              45deg,
              transparent,
              transparent 6px,
              rgba(245, 238, 220, 0.025) 6px,
              rgba(245, 238, 220, 0.025) 7px
            ),
            repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 8px,
              rgba(0, 0, 0, 0.03) 8px,
              rgba(0, 0, 0, 0.03) 9px
            )
          `,
        }}
      />

      <div className="relative z-10 mx-auto flex max-w-2xl flex-col gap-10">
        <header className="rounded-2xl border border-[#D4BC8E] bg-[#2A1F16]/80 px-5 py-6 shadow-[0_12px_32px_rgba(0,0,0,0.45),0_4px_12px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(245,238,220,0.12)] backdrop-blur-sm">
          <div className="mb-5 flex flex-col gap-3 border-b border-[#D4BC8E]/40 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-[#D4BC8E]/90">┌</span>
              <h1
                className="font-mono text-lg font-bold uppercase tracking-[0.28em] text-[#F5EEDC] sm:text-xl"
                style={{
                  textShadow: "0 0 24px rgba(245, 238, 220, 0.15), 0 1px 0 rgba(0,0,0,0.4)",
                }}
              >
                Wild Horizon
              </h1>
              <span className="font-mono text-xs text-[#D4BC8E]/90">┐</span>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-[#D4BC8E]/75">
              Field // Research
            </p>
          </div>

          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F5EEDC]/80">
                Connection status
              </h2>
              <div className="flex items-center gap-3">
                <span
                  className={`relative flex h-3.5 w-3.5 rounded-full ${
                    dataLive
                      ? "bg-[#E8A317] shadow-[0_0_14px_rgba(232,163,23,0.85)]"
                      : "bg-[#3d342c]"
                  } ${dataLive ? "animate-pulse" : ""}`}
                  aria-hidden
                />
                <span className="text-sm text-[#F5EEDC]/65">
                  <span className={dataLive ? "font-mono text-[#F0D78C]" : "font-mono text-[#D4BC8E]/50"}>
                    {dataLive ? "Data active" : firebaseConnected ? "Connected — waiting for /bot" : "Disconnected"}
                  </span>
                </span>
              </div>
            </div>
            <div className="sm:text-right">
              <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F5EEDC]/80">
                Lap timer
              </h2>
              <p
                className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-[#F0D78C] sm:text-3xl"
                style={{
                  textShadow:
                    "0 0 20px rgba(232, 163, 23, 0.55), 0 0 40px rgba(240, 215, 140, 0.25), 0 0 2px rgba(245, 238, 220, 0.5)",
                }}
              >
                {formatMissionClock(elapsedTime)}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#D4BC8E]/70">
                Min : Sec : Cs
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#D4BC8E] bg-[#2A1F16]/80 p-6 shadow-[0_10px_28px_rgba(0,0,0,0.5),0_3px_10px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(245,238,220,0.06)] backdrop-blur-sm">
            <p
              className="mb-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-[#F5EEDC] sm:text-base"
              style={{
                textShadow: "0 1px 2px rgba(0,0,0,0.45)",
              }}
            >
              LATITUDE
            </p>
            <p
              className="font-mono text-3xl font-semibold tabular-nums text-[#F0D78C] sm:text-4xl"
              style={{
                textShadow:
                  "0 0 22px rgba(232, 163, 23, 0.5), 0 0 44px rgba(240, 215, 140, 0.2), 0 0 2px rgba(245, 238, 220, 0.45)",
              }}
            >
              {lat}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4BC8E] bg-[#2A1F16]/80 p-6 shadow-[0_10px_28px_rgba(0,0,0,0.5),0_3px_10px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(245,238,220,0.06)] backdrop-blur-sm">
            <p
              className="mb-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-[#F5EEDC] sm:text-base"
              style={{
                textShadow: "0 1px 2px rgba(0,0,0,0.45)",
              }}
            >
              LONGITUDE
            </p>
            <p
              className="font-mono text-3xl font-semibold tabular-nums text-[#F0D78C] sm:text-4xl"
              style={{
                textShadow:
                  "0 0 22px rgba(232, 163, 23, 0.5), 0 0 44px rgba(240, 215, 140, 0.2), 0 0 2px rgba(245, 238, 220, 0.45)",
              }}
            >
              {lng}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-[#D4BC8E] bg-[#2A1F16]/80 p-6 shadow-[0_10px_28px_rgba(0,0,0,0.5),0_3px_10px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(245,238,220,0.06)] backdrop-blur-sm">
          <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F5EEDC]/80">
            RFID Status
          </h2>
          <p
            className={`font-mono text-lg font-medium tracking-tight ${
              rfidLabel === "Checkpoint Reached" ? "text-[#F0D78C]" : "text-[#E8A317]"
            }`}
            style={{
              textShadow:
                rfidLabel === "Checkpoint Reached"
                  ? "0 0 14px rgba(240, 215, 140, 0.45), 0 0 2px rgba(245, 238, 220, 0.35)"
                  : "0 0 12px rgba(232, 163, 23, 0.35)",
            }}
          >
            {rfidLabel}
          </p>
        </section>

        <section className="rounded-2xl border border-[#D4BC8E] bg-[#2A1F16]/80 p-6 shadow-[0_10px_28px_rgba(0,0,0,0.5),0_3px_10px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(245,238,220,0.06)] backdrop-blur-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F5EEDC]/80">
              Mission Map
            </h2>
            <button
              type="button"
              onClick={clearPath}
              className="rounded-md border border-[#7a6b58] bg-gradient-to-b from-[#d4c4ae] to-[#a8987a] px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wide text-[#2A1F16] shadow-[0_3px_0_#6b5d4c,0_6px_12px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.35)] transition active:translate-y-px active:shadow-[0_2px_0_#6b5d4c,0_4px_8px_rgba(0,0,0,0.3)] hover:from-[#dcccb6] hover:to-[#b0a088]"
            >
              Clear Path
            </button>
          </div>
          <MissionMapCanvas path={path} sightings={sightings} />
          {path.length < 2 && sightings.length === 0 && (
            <p className="mt-3 text-center font-mono text-xs text-[#D4BC8E]/65">
              Trail appears after at least two GPS samples. Points: {path.length}
            </p>
          )}
          {path.length < 2 && sightings.length > 0 && (
            <p className="mt-3 text-center font-mono text-xs text-[#D4BC8E]/65">
              Animal markers shown; breadcrumb trail needs two GPS samples. Points: {path.length}
            </p>
          )}
        </section>
      </div>

      {showMissionModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B2613]/85 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mission-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#D4BC8E] bg-[#2A1F16]/90 p-8 shadow-[0_14px_40px_rgba(0,0,0,0.55),0_4px_14px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(245,238,220,0.1)] backdrop-blur-md">
            <h2
              id="mission-modal-title"
              className="mb-6 text-center font-mono text-lg font-bold uppercase tracking-[0.2em] text-[#F5EEDC] sm:text-xl"
              style={{
                textShadow: "0 0 20px rgba(245, 238, 220, 0.12), 0 2px 4px rgba(0,0,0,0.4)",
              }}
            >
              SAFARI MISSION COMPLETE
            </h2>

            <dl className="space-y-4 border-y border-[#D4BC8E]/35 py-6">
              <div className="flex flex-col gap-1">
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F5EEDC]/75">
                  Total time
                </dt>
                <dd
                  className="font-mono text-lg tabular-nums text-[#F0D78C]"
                  style={{
                    textShadow: "0 0 16px rgba(232, 163, 23, 0.4)",
                  }}
                >
                  {formatMissionClock(elapsedTime)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F5EEDC]/75">
                  Total distance
                </dt>
                <dd className="font-mono text-lg text-[#F5EEDC]">{totalDistanceM.toFixed(2)} m</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F5EEDC]/75">
                  Average speed
                </dt>
                <dd className="font-mono text-lg text-[#F5EEDC]">
                  {elapsedSeconds > 0 ? `${averageSpeedMps.toFixed(3)} m/s` : "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-8 border-t border-[#D4BC8E]/35 pt-6">
              <h3 className="mb-4 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-[#F5EEDC]/80">
                Animal log
              </h3>
              {sightings.length === 0 ? (
                <p className="font-mono text-sm text-[#D4BC8E]/70">No animals logged this run.</p>
              ) : (
                <ul className="max-h-48 space-y-3 overflow-y-auto pr-1">
                  {sightings.map((s, i) => (
                    <li
                      key={`${s.time}-${i}`}
                      className="rounded-lg border border-[#D4BC8E]/25 bg-black/20 px-3 py-2"
                    >
                      <p className="font-mono text-sm font-semibold text-[#F5EEDC]">{s.name}</p>
                      <p className="mt-1 font-mono text-[11px] text-[#D4BC8E]/85">
                        {new Date(s.time).toLocaleString()}
                      </p>
                      <p className="font-mono text-[11px] tabular-nums text-[#F0D78C]">
                        {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={downloadReport}
                className="flex-1 rounded-md border border-[#7a6b58] bg-gradient-to-b from-[#d4c4ae] to-[#a8987a] px-4 py-2.5 font-mono text-sm font-semibold text-[#2A1F16] shadow-[0_3px_0_#6b5d4c,0_8px_16px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.35)] transition active:translate-y-px active:shadow-[0_2px_0_#6b5d4c] hover:from-[#dcccb6] hover:to-[#b0a088]"
              >
                Download report
              </button>
              <button
                type="button"
                onClick={resetForNewRun}
                className="flex-1 rounded-md border border-[#8a7a68] bg-gradient-to-b from-[#c4b49e] to-[#988878] px-4 py-2.5 font-mono text-sm font-semibold text-[#2A1F16] shadow-[0_3px_0_#5c5044,0_8px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.3)] transition active:translate-y-px active:shadow-[0_2px_0_#5c5044] hover:from-[#cec0aa] hover:to-[#a09080]"
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

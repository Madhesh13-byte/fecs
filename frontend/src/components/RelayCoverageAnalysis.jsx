import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  MapContainer, TileLayer, Circle, Rectangle,
  LayersControl, useMap, Marker, Popup, Tooltip,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { saveCoverageCache, getCoverageCache } from "../services/coverageCache";

// ─── helpers ──────────────────────────────────────────────────────────────────
const R_EARTH = 6378137;
function metersToLatDeg(m)      { return (m / R_EARTH) * (180 / Math.PI); }
function metersToLngDeg(m, lat) { return (m / (R_EARTH * Math.cos((Math.PI * lat) / 180))) * (180 / Math.PI); }
function distMeters(lat1, lng1, lat2, lng2) {
  const dLat = (lat1 - lat2) * (Math.PI / 180) * R_EARTH;
  const dLng = (lng1 - lng2) * (Math.PI / 180) * R_EARTH * Math.cos((lat2 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
function inBounds(b, lat, lng) {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const purpleIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-violet.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});
const relayIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

// ─── Elevation batch ──────────────────────────────────────────────────────────
async function fetchElevationBatch(points, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  if (parentSignal) parentSignal.addEventListener("abort", () => controller.abort());
  try {
    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: points }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return points.map(() => null);
    const data = await res.json();
    return (data.results || []).map((r) => r.elevation ?? null);
  } catch {
    clearTimeout(timer);
    return points.map(() => null);
  }
}

// ─── Overpass terrain ─────────────────────────────────────────────────────────
async function fetchOverpassTerrain(s, w, n, e, signal) {
  const q = `
    [out:json][timeout:20];
    (
      way["landuse"~"residential|commercial"](${s},${w},${n},${e});
      relation["landuse"~"residential|commercial"](${s},${w},${n},${e});
      way["landuse"~"forest|orchard"](${s},${w},${n},${e});
      way["natural"~"wood|scrub"](${s},${w},${n},${e});
      node["natural"~"peak|hill"](${s},${w},${n},${e});
      way["natural"~"cliff|ridge"](${s},${w},${n},${e});
      way["natural"="water"](${s},${w},${n},${e});
      relation["natural"="water"](${s},${w},${n},${e});
      way["waterway"~"river|canal|stream"](${s},${w},${n},${e});
      way["natural"="coastline"](${s},${w},${n},${e});
    );
    out bb center qt;
  `;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: q, signal });
    const data = await res.json();
    const urban = [], forest = [], peaks = [], cliffs = [], inlandWater = [];
    let hasCoastline = false;
    (data.elements || []).forEach((el) => {
      const t = el.tags || {};
      if (t.natural === "coastline") { hasCoastline = true; return; }
      const isUrban       = t.landuse && /residential|commercial/.test(t.landuse);
      const isForest      = (t.landuse && /forest|orchard/.test(t.landuse)) || (t.natural && /wood|scrub/.test(t.natural));
      const isPeak        = t.natural && /peak|hill/.test(t.natural);
      const isCliff       = t.natural && /cliff|ridge/.test(t.natural);
      const isInlandWater = t.natural === "water" || (t.waterway && /river|canal|stream/.test(t.waterway));
      if (isPeak && el.lat) { peaks.push({ lat: el.lat, lng: el.lon }); return; }
      if (el.bounds) {
        const b = { minLat: el.bounds.minlat, maxLat: el.bounds.maxlat, minLng: el.bounds.minlon, maxLng: el.bounds.maxlon };
        if (isUrban)            urban.push(b);
        else if (isForest)      forest.push(b);
        else if (isCliff)       cliffs.push(b);
        else if (isInlandWater) inlandWater.push(b);
      }
    });
    return { urban, forest, peaks, cliffs, inlandWater, hasCoastline };
  } catch {
    return { urban: [], forest: [], peaks: [], cliffs: [], inlandWater: [], hasCoastline: false };
  }
}

// ─── Core grid builder ────────────────────────────────────────────────────────
async function buildCoverageGrid(centerLat, centerLng, radiusMeters, onProgress, abortSignal) {
  const latOff = metersToLatDeg(radiusMeters);
  const lngOff = metersToLngDeg(radiusMeters, centerLat);
  const s = centerLat - latOff, n = centerLat + latOff;
  const w = centerLng - lngOff, e = centerLng + lngOff;

  let steps = 30;
  if (radiusMeters < 5000)  steps = 20;
  if (radiusMeters > 25000) steps = 38;

  const stepLat = (n - s) / steps;
  const stepLng = (e - w) / steps;

  const cells = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const cellLat = s + i * stepLat + stepLat / 2;
      const cellLng = w + j * stepLng + stepLng / 2;
      const dist = distMeters(cellLat, cellLng, centerLat, centerLng);
      if (dist <= radiusMeters) cells.push({ cellLat, cellLng, dist, stepLat, stepLng });
    }
  }

  const BATCH = 80;
  const totalBatches = Math.ceil(cells.length / BATCH);
  const allElevs = new Array(cells.length).fill(null);

  const elevPromises = [];
  for (let b = 0; b < cells.length; b += BATCH) {
    const start = b;
    const chunk = cells.slice(start, start + BATCH);
    elevPromises.push(
      fetchElevationBatch(
        chunk.map((c) => ({ latitude: c.cellLat, longitude: c.cellLng })),
        abortSignal,
      ).then((result) => { result.forEach((v, i) => { allElevs[start + i] = v; }); })
    );
  }

  const terrainPromise = fetchOverpassTerrain(s, w, n, e, abortSignal);

  let completed = 0;
  await Promise.all(
    elevPromises.map((p) => p.then(() => {
      completed++;
      if (onProgress) onProgress(Math.round((completed / totalBatches) * 78));
    }))
  );

  if (abortSignal?.aborted) return null;
  if (onProgress) onProgress(82);

  const terrain = await terrainPromise;
  if (abortSignal?.aborted) return null;
  if (onProgress) onProgress(93);

  const { urban, forest, peaks, cliffs, inlandWater, hasCoastline } = terrain;

  const landElevs = allElevs.filter((v) => v !== null && v > 1);
  const minElev   = landElevs.length ? Math.min(...landElevs) : 0;
  const maxElev   = landElevs.length ? Math.max(...landElevs) : 0;
  const elevRange = maxElev - minElev || 1;
  const deadThresh = minElev + elevRange * 0.78;

  const grid = [];

  cells.forEach(({ cellLat, cellLng, dist, stepLat, stepLng }, idx) => {
    const elev = allElevs[idx] ?? null;
    const isSeaCell = hasCoastline && elev !== null && elev <= 0;

    if (isSeaCell) {
      grid.push({
        bounds: [[cellLat - stepLat/2, cellLng - stepLng/2], [cellLat + stepLat/2, cellLng + stepLng/2]],
        color: "#1565c0", type: "sea", signal: 0, elevation: elev,
        center: { lat: cellLat, lng: cellLng },
      });
      return;
    }

    const isInlandWaterCell = inlandWater.some((b) => inBounds(b, cellLat, cellLng));
    if (isInlandWaterCell) {
      grid.push({
        bounds: [[cellLat - stepLat/2, cellLng - stepLng/2], [cellLat + stepLat/2, cellLng + stepLng/2]],
        color: "#42a5f5", type: "water", signal: 0, elevation: elev,
        center: { lat: cellLat, lng: cellLng },
      });
      return;
    }

    let signal = 100 - (dist / radiusMeters) * 20;
    const isForest = forest.some((b) => inBounds(b, cellLat, cellLng));
    const isUrban  = urban.some((b)  => inBounds(b, cellLat, cellLng));
    const isCliff  = cliffs.some((b) => inBounds(b, cellLat, cellLng));
    const nearPeak = peaks.some((p)  => distMeters(cellLat, cellLng, p.lat, p.lng) < 1500);

    if (isForest)     signal -= 25;
    else if (isUrban) signal -= 10;
    if (isCliff)      signal -= 20;
    if (nearPeak)     signal -= 40;

    const elevDead   = elev !== null && elev >= deadThresh && elevRange > 10;
    const isDeadZone = elevDead || (nearPeak && signal < 20);

    let color, type, baseSignal;
    baseSignal = Math.max(0, Math.round(signal));

    if (isDeadZone) {
      color = "#1a1a2e"; type = "deadzone";
    } else if (isForest) {
      color = "#2e7d32"; type = "forest";
    } else {
      const sc = Math.max(0, signal);
      if (sc >= 85)      { color = "#00e676"; type = "good"; }
      else if (sc >= 65) { color = "#ffee58"; type = "moderate"; }
      else if (sc >= 40) { color = "#ff9800"; type = "weak"; }
      else               { color = "#f44336"; type = "deadzone"; }
    }

    grid.push({
      bounds: [[cellLat - stepLat/2, cellLng - stepLng/2], [cellLat + stepLat/2, cellLng + stepLng/2]],
      color, type, signal: baseSignal, elevation: elev,
      center: { lat: cellLat, lng: cellLng },
    });
  });

  if (onProgress) onProgress(100);

  // Attach metadata to grid
  const total     = grid.length || 1;
  const cnt       = (t) => grid.filter((c) => c.type === t).length;
  const pct       = (t) => Math.round((cnt(t) / total) * 100);
  const goodPct   = pct("good");
  const modPct    = pct("moderate");
  const weakPct   = pct("weak");
  const deadPct   = Math.round((cnt("deadzone") / total) * 100);
  const forestPct = pct("forest");
  const seaPct    = pct("sea");
  const waterPct  = pct("water");

  grid.summary = {
    total, goodPct, modPct, weakPct, deadPct, forestPct, seaPct, waterPct,
    elevMin: Math.round(minElev), elevMax: Math.round(maxElev),
    isCoastal: hasCoastline,
    overallStatus:
      goodPct >= 60 ? "✅ Good Coverage"
      : goodPct >= 35 ? "⚠️ Moderate Coverage"
      : "❌ Poor Coverage",
    statusColor:
      goodPct >= 60 ? "#2e7d32" : goodPct >= 35 ? "#e65100" : "#b71c1c",
  };

  return grid;
}

// ─── Relay suggestion from weak/dead cells ────────────────────────────────────
function suggestRelayPositions(grid, radiusMeters, userRelayRadius) {
  // Only consider weak/dead/forest cells (not water/sea)
  const badCells = grid.filter(
    (c) => c.type === "deadzone" || c.type === "weak" || c.type === "forest"
  );

  if (badCells.length === 0) return [];

  // Cluster radius = actual relay coverage radius user selected
  // So each cluster = one relay's coverage zone, no overlap
  const CLUSTER_RADIUS = userRelayRadius;

  // Minimum spacing between two relay centres = relay radius (no overlap)
  const MIN_SPACING = userRelayRadius;

  const clusters = [];

  badCells.forEach((cell) => {
    let bestCluster = null;
    let bestDist = Infinity;

    clusters.forEach((cluster) => {
      const d = distMeters(cluster.centroid.lat, cluster.centroid.lng, cell.center.lat, cell.center.lng);
      if (d < CLUSTER_RADIUS && d < bestDist) {
        bestDist = d;
        bestCluster = cluster;
      }
    });

    if (bestCluster) {
      bestCluster.cells.push(cell);
      const n = bestCluster.cells.length;
      bestCluster.centroid.lat = bestCluster.cells.reduce((s, c) => s + c.center.lat, 0) / n;
      bestCluster.centroid.lng = bestCluster.cells.reduce((s, c) => s + c.center.lng, 0) / n;
    } else {
      clusters.push({
        centroid: { lat: cell.center.lat, lng: cell.center.lng },
        cells: [cell],
      });
    }
  });

  // Sort by most bad cells first, then enforce MIN_SPACING between chosen relays
  const sorted = clusters
    .filter((c) => c.cells.length >= 2)
    .sort((a, b) => b.cells.length - a.cells.length);

  const chosen = [];
  for (const cluster of sorted) {
    // Skip if too close to an already chosen relay
    const tooClose = chosen.some(
      (r) => distMeters(r.centroid.lat, r.centroid.lng, cluster.centroid.lat, cluster.centroid.lng) < MIN_SPACING
    );
    if (tooClose) continue;
    chosen.push(cluster);
    if (chosen.length >= 8) break;
  }

  return chosen.map((c, i) => ({
    id: i + 1,
    lat: c.centroid.lat,
    lng: c.centroid.lng,
    coverageRadius: userRelayRadius,
    cellCount: c.cells.length,
  }));
}

// ─── Apply relay boost to grid ────────────────────────────────────────────────
function applyRelayCoverage(grid, relays) {
  return grid.map((cell) => {
    // Don't boost water/sea cells
    if (cell.type === "sea" || cell.type === "water") return cell;

    let bestSignal = cell.signal;

    relays.forEach((relay) => {
      const d = distMeters(relay.lat, relay.lng, cell.center.lat, cell.center.lng);
      if (d <= relay.coverageRadius) {
        // Relay signal: strong near relay, fades at edge
        const relaySignal = Math.max(0, 90 - (d / relay.coverageRadius) * 35);
        if (relaySignal > bestSignal) bestSignal = relaySignal;
      }
    });

    if (bestSignal === cell.signal) return cell; // No change

    let color, type;
    const sc = Math.round(bestSignal);
    if (sc >= 85)      { color = "#00e676"; type = "good"; }
    else if (sc >= 65) { color = "#ffee58"; type = "moderate"; }
    else if (sc >= 40) { color = "#ff9800"; type = "weak"; }
    else               { color = "#f44336"; type = "deadzone"; }

    return { ...cell, color, type, signal: sc, relayBoosted: true };
  });
}

// ─── Summary calculator ───────────────────────────────────────────────────────
function calcSummary(grid, isCoastal, elevMin, elevMax) {
  const total     = grid.length || 1;
  const cnt       = (t) => grid.filter((c) => c.type === t).length;
  const pct       = (t) => Math.round((cnt(t) / total) * 100);
  const goodPct   = pct("good");
  const modPct    = pct("moderate");
  const weakPct   = pct("weak");
  const deadPct   = Math.round((cnt("deadzone") / total) * 100);
  const forestPct = pct("forest");
  const seaPct    = pct("sea");
  const waterPct  = pct("water");

  return {
    total, goodPct, modPct, weakPct, deadPct, forestPct, seaPct, waterPct,
    elevMin, elevMax, isCoastal,
    overallStatus:
      goodPct >= 60 ? "✅ Good Coverage"
      : goodPct >= 35 ? "⚠️ Moderate Coverage"
      : "❌ Poor Coverage",
    statusColor:
      goodPct >= 60 ? "#2e7d32" : goodPct >= 35 ? "#e65100" : "#b71c1c",
  };
}

// ─── Map re-centerer ──────────────────────────────────────────────────────────
function MapRecenterer({ lat, lng, zoom }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], zoom); }, [lat, lng, zoom, map]);
  return null;
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ value }) {
  return (
    <div style={{ width: "100%", background: "#e3f2fd", borderRadius: 6, height: 8, overflow: "hidden", marginTop: 8 }}>
      <div style={{
        height: "100%", borderRadius: 6,
        background: "linear-gradient(90deg, #e65100, #ff9800)",
        width: `${value}%`, transition: "width 0.35s ease",
      }}/>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
const LEGEND = [
  { color: "#00e676", label: "Strong Signal (≥ 85%)" },
  { color: "#ffee58", label: "Moderate Signal (65–84%)" },
  { color: "#ff9800", label: "Weak Signal (40–64%)" },
  { color: "#f44336", label: "Poor Signal (< 40%)" },
  { color: "#1a1a2e", label: "Dead Zone" },
  { color: "#2e7d32", label: "Forest / Vegetation" },
  { color: "#1565c0", label: "Sea / Ocean" },
  { color: "#42a5f5", label: "Inland Water" },
];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function RelayCoverageAnalysis({ onBack }) {
  // Use same API as CoverageAnalysis
  const [regions,       setRegions]       = useState([]);
  const [selIdx,        setSelIdx]        = useState(0);
  const [baseGrid,      setBaseGrid]      = useState([]);
  const [relays,        setRelays]        = useState([]);
  const [improvedGrid,  setImprovedGrid]  = useState([]);
  const [baseSummary,   setBaseSummary]   = useState(null);
  const [improvedSummary, setImprovedSummary] = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [analysed,      setAnalysed]      = useState(false);
  const [showImproved,  setShowImproved]  = useState(false);
  const [relayRadius,   setRelayRadius]   = useState(3000); // user-configurable relay radius

  const abortRef = useRef(null);

  // Load regions from same API
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem("token");
        // import getBaseStations from your api service
        const { getBaseStations } = await import("../services/api");
        const data = await getBaseStations(token);
        setRegions(data);
      } catch { setRegions([]); }
    })();
  }, []);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const region = regions[selIdx] || null;

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setProgress(0);
    setProgressLabel("");
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!region) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setBaseGrid([]);
    setRelays([]);
    setImprovedGrid([]);
    setBaseSummary(null);
    setImprovedSummary(null);
    setAnalysed(false);
    setShowImproved(false);
    setProgress(0);
    setProgressLabel("Starting analysis…");

    const result = await buildCoverageGrid(
      region.latitude, region.longitude, region.radius_meters,
      (pct) => {
        setProgress(pct);
        if (pct < 80)       setProgressLabel(`Fetching elevation data… ${pct}%`);
        else if (pct < 93)  setProgressLabel("Fetching terrain data (OSM Overpass)…");
        else if (pct < 100) setProgressLabel("Building coverage heatmap…");
        else                setProgressLabel("Done!");
      },
      controller.signal,
    );

    if (controller.signal.aborted || !result) {
      setLoading(false);
      return;
    }

    // Base grid ready
    setBaseGrid(result);
    setBaseSummary(result.summary);

    // Auto-compute relay positions using actual user relay radius
    setProgressLabel("Computing relay positions…");
    const suggestedRelays = suggestRelayPositions(result, region.radius_meters, relayRadius);
    setRelays(suggestedRelays);

    // Compute improved grid
    setProgressLabel("Applying relay coverage boost…");
    const improved = applyRelayCoverage(result, suggestedRelays);
    setImprovedGrid(improved);
    setImprovedSummary(
      calcSummary(improved, result.summary.isCoastal, result.summary.elevMin, result.summary.elevMax)
    );

    // Save to cache keyed by stationId + relayRadius
    saveCoverageCache(`${region.id}_${relayRadius}`, {
      baseGrid: result,
      relays: suggestedRelays,
      improvedGrid: improved,
      baseSummary: result.summary,
      improvedSummary: calcSummary(improved, result.summary.isCoastal, result.summary.elevMin, result.summary.elevMax),
    });

    setLoading(false);
    setAnalysed(true);
    abortRef.current = null;
  }, [region, relayRadius]);

  const handleRegionChange = (e) => {
    cancelAnalysis();
    const newIdx = Number(e.target.value);
    setSelIdx(newIdx);
    const newRegion = regions[newIdx];
    // Check cache for this station + current relay radius
    const cached = newRegion ? getCoverageCache(`${newRegion.id}_${relayRadius}`) : null;
    if (cached) {
      setBaseGrid(cached.baseGrid || []);
      setRelays(cached.relays || []);
      setImprovedGrid(cached.improvedGrid || []);
      setBaseSummary(cached.baseSummary || null);
      setImprovedSummary(cached.improvedSummary || null);
      setAnalysed(true);
      setShowImproved(false);
    } else {
      setBaseGrid([]);
      setRelays([]);
      setImprovedGrid([]);
      setBaseSummary(null);
      setImprovedSummary(null);
      setAnalysed(false);
      setShowImproved(false);
    }
  };

  const displayGrid = showImproved ? improvedGrid : baseGrid;
  const displaySummary = showImproved ? improvedSummary : baseSummary;

  // Improvement delta
  const delta = (key) => {
    if (!baseSummary || !improvedSummary) return null;
    const d = improvedSummary[key] - baseSummary[key];
    return d;
  };

  const card = (bg, val, label, sub, deltaVal) => (
    <div style={{
      background: bg, borderRadius: 10, padding: "14px 16px",
      textAlign: "center", flex: 1, minWidth: 110, position: "relative",
    }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "white" }}>{val}</div>
      <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.65)", marginTop: 1 }}>{sub}</div>}
      {deltaVal !== null && deltaVal !== undefined && (
        <div style={{
          fontSize: "0.72rem", fontWeight: 700, marginTop: 4,
          color: deltaVal > 0 ? "#b9f6ca" : deltaVal < 0 ? "#ffcdd2" : "rgba(255,255,255,0.5)",
        }}>
          {deltaVal > 0 ? `▲ +${deltaVal}%` : deltaVal < 0 ? `▼ ${deltaVal}%` : "— no change"}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ padding: "20px", fontFamily: "'Segoe UI', sans-serif", background: "#f4f6f9", minHeight: "100vh" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <button onClick={onBack}
          style={{ padding: "9px 18px", background: "#e65100", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          ← Back
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.4rem", color: "#bf360c" }}>⚡ Relay Coverage Analysis</h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#666" }}>
            Real terrain-aware analysis · Auto relay placement · Before vs After comparison
          </p>
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{
        display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16,
        background: "white", padding: "16px 20px", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
        {/* Region selector */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#333", display: "block", marginBottom: 5 }}>
            Select Region (Base Station)
          </label>
          <select value={selIdx} onChange={handleRegionChange} disabled={regions.length === 0}
            style={{ width: "100%", padding: "9px 12px", border: "1px solid #ccc", borderRadius: 7, fontSize: 14 }}>
            {regions.length === 0 && <option>Loading regions…</option>}
            {regions.map((r, i) => (
              <option key={r.id || i} value={i}>{r.name} ({(r.radius_meters / 1000).toFixed(1)} km)</option>
            ))}
          </select>
        </div>

        {/* Relay radius control */}
        <div style={{ minWidth: 200 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#333", display: "block", marginBottom: 5 }}>
            Relay Coverage Radius: {(relayRadius / 1000).toFixed(1)} km
          </label>
          <input
            type="range" min={500} max={8000} step={500}
            value={relayRadius}
            onChange={(e) => setRelayRadius(Number(e.target.value))}
            disabled={loading}
            style={{ width: "100%", cursor: "pointer", accentColor: "#e65100" }}
          />
        </div>

        {/* Toggle before/after */}
        {analysed && (
          <button
            onClick={() => setShowImproved(!showImproved)}
            style={{
              padding: "10px 20px",
              background: showImproved ? "#e65100" : "#546e7a",
              color: "white", border: "none", borderRadius: 8,
              cursor: "pointer", fontWeight: 700, fontSize: 14,
              whiteSpace: "nowrap", alignSelf: "flex-end",
            }}>
            {showImproved ? "📡 Show Base Coverage" : "⚡ Show Relay-Improved"}
          </button>
        )}

        {/* Run / Cancel */}
        {loading ? (
          <button onClick={cancelAnalysis}
            style={{
              padding: "10px 24px", background: "#c62828", color: "white",
              border: "none", borderRadius: 8, cursor: "pointer",
              fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", alignSelf: "flex-end",
            }}>
            ✕ Cancel
          </button>
        ) : (
          <button onClick={runAnalysis} disabled={!region}
            style={{
              padding: "10px 24px",
              background: !region ? "#90a4ae" : "#e65100",
              color: "white", border: "none", borderRadius: 8,
              cursor: !region ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", alignSelf: "flex-end",
            }}>
            🔍 Run Analysis
          </button>
        )}
      </div>

      {/* ── Relay info banner ── */}
      {analysed && relays.length > 0 && (
        <div style={{
          background: "#fff3e0", border: "2px solid #e65100", borderRadius: 10,
          padding: "14px 20px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 28 }}>⚡</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#bf360c", fontSize: "1rem" }}>
              {relays.length} Relay Tower{relays.length > 1 ? "s" : ""} Auto-Placed in Weak/Dead Zones
            </div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
              Each relay covers <strong>{(relayRadius / 1000).toFixed(1)} km</strong> radius.
              Orange markers on map. Toggle to see coverage improvement.
            </div>
          </div>
          {/* Improvement highlight */}
          {baseSummary && improvedSummary && (
            <div style={{
              background: "#e65100", color: "white", borderRadius: 8,
              padding: "10px 16px", textAlign: "center",
            }}>
              <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>
                +{improvedSummary.goodPct - baseSummary.goodPct}%
              </div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>Strong Coverage Gain</div>
            </div>
          )}
        </div>
      )}

      {analysed && relays.length === 0 && (
        <div style={{
          background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 10,
          padding: "12px 18px", marginBottom: 16, color: "#1b5e20", fontSize: 13,
        }}>
          ✅ No relay towers needed — coverage is already excellent in this region!
        </div>
      )}

      {/* ── Summary cards ── */}
      {displaySummary && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            background: displaySummary.statusColor, color: "white", borderRadius: 10,
            padding: "12px 20px", fontSize: "1.05rem", fontWeight: 700, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            {displaySummary.overallStatus}
            <span style={{ fontSize: "0.85rem", fontWeight: 400, opacity: 0.85 }}>
              — {region?.name} · {region && (region.radius_meters / 1000).toFixed(1)} km radius · {displaySummary.total} cells
              {displaySummary.isCoastal && "  🌊 Coastal"}
              {showImproved && "  ⚡ Relay-Improved View"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {card("#00897b", displaySummary.goodPct   + "%", "Strong Coverage", "≥ 85% signal",    showImproved ? delta("goodPct") : null)}
            {card("#f9a825", displaySummary.modPct    + "%", "Moderate",        "65–84% signal",   showImproved ? delta("modPct")  : null)}
            {card("#e64a19", displaySummary.weakPct   + "%", "Weak Signal",     "40–64%",          showImproved ? delta("weakPct") : null)}
            {card("#212121", displaySummary.deadPct   + "%", "Dead Zones",      "elevation shadow", showImproved ? delta("deadPct") : null)}
            {card("#2e7d32", displaySummary.forestPct + "%", "Forest",          "vegetation loss", null)}
            {card("#1565c0", displaySummary.seaPct    + "%", "Sea / Ocean",     "no coverage",     null)}
            {card("#42a5f5", displaySummary.waterPct  + "%", "Inland Water",    "river / lake",    null)}
            {card("#546e7a", displaySummary.elevMin   + " m","Min Elevation",   "",                null)}
            {card("#37474f", displaySummary.elevMax   + " m","Max Elevation",   "",                null)}
          </div>
          {showImproved && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
              ▲ / ▼ values show change from base coverage. Green = improvement, Red = reduction.
            </div>
          )}
        </div>
      )}

      {/* ── Map + Legend ── */}
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{
          flex: 1, borderRadius: 12, overflow: "hidden", border: "2px solid #ddd",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", position: "relative", height: 520,
        }}>
          {/* Loading overlay */}
          {loading && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
              background: "rgba(255,255,255,0.93)", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 10, padding: "0 48px",
            }}>
              <div style={{ fontSize: 42 }}>⚡</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#e65100" }}>Analysing Terrain & Computing Relays…</div>
              <div style={{ fontSize: 13, color: "#555", textAlign: "center" }}>{progressLabel}</div>
              <div style={{ width: "100%", maxWidth: 340 }}>
                <ProgressBar value={progress} />
                <div style={{ textAlign: "center", fontSize: 12, color: "#888", marginTop: 5 }}>{progress}% complete</div>
              </div>
              <button onClick={cancelAnalysis}
                style={{ marginTop: 6, padding: "7px 22px", background: "#c62828", color: "white", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                ✕ Cancel
              </button>
            </div>
          )}

          {region ? (
            <MapContainer center={[region.latitude, region.longitude]} zoom={12} style={{ height: "100%", width: "100%" }}>
              <MapRecenterer lat={region.latitude} lng={region.longitude} zoom={12} />

              <LayersControl position="topright">
                <LayersControl.BaseLayer checked name="Road Map">
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}" attribution="© Esri"/>
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satellite">
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri"/>
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Topographic">
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}" attribution="© Esri"/>
                </LayersControl.BaseLayer>
              </LayersControl>

              {/* Region boundary */}
              <Circle
                center={[region.latitude, region.longitude]}
                radius={region.radius_meters}
                pathOptions={{ color: "#e65100", fillColor: "transparent", weight: 2, dashArray: "6,4" }}
              />

              {/* Coverage heatmap */}
              {displayGrid.map((cell, idx) => (
                <Rectangle key={idx} bounds={cell.bounds}
                  pathOptions={{
                    color: cell.color, fillColor: cell.color,
                    fillOpacity: cell.type === "deadzone" ? 0.82 : 0.62,
                    weight: 0.3, interactive: false,
                  }}
                />
              ))}

              {/* Relay markers + coverage circles */}
              {analysed && relays.map((relay) => (
                <React.Fragment key={relay.id}>
                  <Circle
                    center={[relay.lat, relay.lng]}
                    radius={relay.coverageRadius}
                    pathOptions={{ color: "#ff6d00", fillColor: "#ff6d00", fillOpacity: 0.08, weight: 1.5, dashArray: "4,3" }}
                  />
                  <Marker position={[relay.lat, relay.lng]} icon={relayIcon}>
                    <Popup>
                      <div style={{ minWidth: 150 }}>
                        <strong style={{ color: "#e65100" }}>⚡ Relay Tower #{relay.id}</strong>
                        <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6 }}>
                          <div><strong>Lat:</strong> {relay.lat.toFixed(5)}</div>
                          <div><strong>Lng:</strong> {relay.lng.toFixed(5)}</div>
                          <div><strong>Coverage:</strong> {(relay.coverageRadius / 1000).toFixed(1)} km radius</div>
                          <div><strong>Covers:</strong> {relay.cellCount} weak cells</div>
                        </div>
                      </div>
                    </Popup>
                    <Tooltip permanent direction="top" offset={[0, -40]}>
                      ⚡ Relay #{relay.id}
                    </Tooltip>
                  </Marker>
                </React.Fragment>
              ))}
            </MapContainer>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#999" }}>
              No regions loaded. Deploy a base station first.
            </div>
          )}
        </div>

        {/* ── Legend Panel ── */}
        <div style={{ width: 230, background: "white", borderRadius: 12, padding: 18, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", height: "fit-content" }}>
          <h4 style={{ margin: "0 0 14px", color: "#bf360c", fontSize: "0.95rem" }}>🗺 Map Legend</h4>
          {LEGEND.map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: color, flexShrink: 0, border: "1px solid rgba(0,0,0,0.15)" }}/>
              <span style={{ fontSize: "0.82rem", color: "#333", lineHeight: 1.3 }}>{label}</span>
            </div>
          ))}

          {/* Relay legend entry */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, background: "#ff6d00", flexShrink: 0, border: "1px solid rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>⚡</div>
            <span style={{ fontSize: "0.82rem", color: "#333", lineHeight: 1.3 }}>Relay Tower + Range</span>
          </div>

          {/* How relay works info box */}
          <div style={{ marginTop: 16, padding: "12px", background: "#fff3e0", borderRadius: 8 }}>
            <div style={{ fontSize: "0.8rem", color: "#e65100", fontWeight: 600, marginBottom: 6 }}>⚡ How Relay Works</div>
            <div style={{ fontSize: "0.75rem", color: "#444", lineHeight: 1.5 }}>
              Weak/dead cells are clustered. A relay tower is placed at each cluster center. Signal is boosted up to 90% within relay radius.
            </div>
          </div>

          {/* Before/after tip */}
          {analysed && (
            <div style={{ marginTop: 12, padding: "10px", background: "#fce4ec", borderRadius: 8, fontSize: "0.78rem", color: "#880e4f" }}>
              ☝️ Use <strong>Toggle button</strong> to compare base vs relay-improved coverage. Delta % shown in cards.
            </div>
          )}

          {!analysed && region && (
            <div style={{ marginTop: 12, padding: "10px", background: "#fff3e0", borderRadius: 8, fontSize: "0.78rem", color: "#e65100", textAlign: "center" }}>
              ☝️ Click <strong>Run Analysis</strong> to detect weak zones and auto-place relay towers.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
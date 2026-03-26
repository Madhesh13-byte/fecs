import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  MapContainer, TileLayer, Circle, Rectangle,
  LayersControl, useMap, Marker, Popup, Tooltip,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getBaseStations } from "../services/api";

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

// ─── Purple marker icon ───────────────────────────────────────────────────────
const purpleIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-violet.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

// ─── Elevation batch with 8s timeout + abort ─────────────────────────────────
async function fetchElevationBatch(points, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  if (parentSignal) {
    parentSignal.addEventListener("abort", () => controller.abort());
  }
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
    return points.map(() => null); // timeout or abort → graceful null fallback
  }
}

// ─── Overpass terrain with abort ─────────────────────────────────────────────
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
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", body: q, signal,
    });
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

// ─── Core grid builder — parallel elevation + Overpass, progress callback ─────
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
      if (dist <= radiusMeters) cells.push({ cellLat, cellLng, dist });
    }
  }

  const BATCH = 80;
  const totalBatches = Math.ceil(cells.length / BATCH);
  const allElevs = new Array(cells.length).fill(null);

  // Build all elevation batch promises
  const elevPromises = [];
  for (let b = 0; b < cells.length; b += BATCH) {
    const start = b;
    const chunk = cells.slice(start, start + BATCH);
    elevPromises.push(
      fetchElevationBatch(
        chunk.map((c) => ({ latitude: c.cellLat, longitude: c.cellLng })),
        abortSignal,
      ).then((result) => {
        result.forEach((v, i) => { allElevs[start + i] = v; });
        return result;
      })
    );
  }

  // Start Overpass IN PARALLEL with elevation (don't await elevation first)
  const terrainPromise = fetchOverpassTerrain(s, w, n, e, abortSignal);

  // Await elevation batches one-by-one for progress reporting
  let completed = 0;
  await Promise.all(
    elevPromises.map((p) =>
      p.then(() => {
        completed++;
        if (onProgress) onProgress(Math.round((completed / totalBatches) * 78));
      })
    )
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

  cells.forEach(({ cellLat, cellLng, dist }, idx) => {
    const elev = allElevs[idx] ?? null;
    const isSeaCell = hasCoastline && elev !== null && elev <= 0;

    if (isSeaCell) {
      grid.push({
        bounds: [[cellLat - stepLat/2, cellLng - stepLng/2], [cellLat + stepLat/2, cellLng + stepLng/2]],
        color: "#1565c0", type: "sea", signal: 0, elevation: elev,
      });
      return;
    }

    const isInlandWater = inlandWater.some((b) => inBounds(b, cellLat, cellLng));
    if (isInlandWater) {
      grid.push({
        bounds: [[cellLat - stepLat/2, cellLng - stepLng/2], [cellLat + stepLat/2, cellLng + stepLng/2]],
        color: "#42a5f5", type: "water", signal: 0, elevation: elev,
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

    let color, type;
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
      color, type, signal: Math.max(0, Math.round(signal)), elevation: elev,
    });
  });

  if (onProgress) onProgress(100);

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

// ─── Auto-suggest: highest elevation near centroid ────────────────────────────
function generateSamplePoints(center, count = 12, radius = 800) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const dx = (radius / 111320) * Math.cos(angle);
    const dy = (radius / ((40075000 * Math.cos((center.lat * Math.PI) / 180)) / 360)) * Math.sin(angle);
    points.push({ lat: center.lat + dx, lng: center.lng + dy });
  }
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count + Math.PI / count;
    const dx = ((radius * 0.5) / 111320) * Math.cos(angle);
    const dy = ((radius * 0.5) / ((40075000 * Math.cos((center.lat * Math.PI) / 180)) / 360)) * Math.sin(angle);
    points.push({ lat: center.lat + dx, lng: center.lng + dy });
  }
  points.push(center);
  return points;
}

async function getOptimalBaseStation(region) {
  const center = { lat: region.latitude, lng: region.longitude };
  const samples = generateSamplePoints(center, 12, 800);
  try {
    const resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: samples.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      }),
    });
    if (!resp.ok) throw new Error("API error");
    const data = await resp.json();
    let best = { ...center, elevation: null };
    let maxElev = -Infinity;
    (data.results || []).forEach((r, i) => {
      if (r.elevation != null && r.elevation > 0 && r.elevation > maxElev) {
        maxElev = r.elevation;
        best = { lat: samples[i].lat, lng: samples[i].lng, elevation: r.elevation };
      }
    });
    return best;
  } catch {
    return { lat: center.lat, lng: center.lng, elevation: null };
  }
}

// ─── Map re-centerer ──────────────────────────────────────────────────────────
function MapRecenterer({ lat, lng, zoom }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], zoom); }, [lat, lng, zoom, map]);
  return null;
}

// ─── Progress bar component ───────────────────────────────────────────────────
function ProgressBar({ value }) {
  return (
    <div style={{ width: "100%", background: "#e3f2fd", borderRadius: 6, height: 8, overflow: "hidden", marginTop: 8 }}>
      <div style={{
        height: "100%", borderRadius: 6,
        background: "linear-gradient(90deg, #1565c0, #42a5f5)",
        width: `${value}%`,
        transition: "width 0.35s ease",
      }}/>
    </div>
  );
}

// ─── Legend data ──────────────────────────────────────────────────────────────
const LEGEND = [
  { color: "#00e676", label: "Strong Signal (≥ 85%)" },
  { color: "#ffee58", label: "Moderate Signal (65–84%)" },
  { color: "#ff9800", label: "Weak Signal (40–64%)" },
  { color: "#f44336", label: "Poor Signal (< 40%)" },
  { color: "#1a1a2e", label: "Dead Zone (elevation / peak shadow)" },
  { color: "#2e7d32", label: "Forest / Vegetation" },
  { color: "#1565c0", label: "Sea / Ocean (no land coverage)" },
  { color: "#42a5f5", label: "Inland Water (river / lake)" },
];

// ─── Main component ───────────────────────────────────────────────────────────
export default function CoverageAnalysis({ onBack }) {
  const [regions,          setRegions]          = useState([]);
  const [selIdx,           setSelIdx]           = useState(0);
  const [grid,             setGrid]             = useState([]);
  const [summary,          setSummary]          = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [progress,         setProgress]         = useState(0);
  const [progressLabel,    setProgressLabel]    = useState("");
  const [analysed,         setAnalysed]         = useState(false);
  const [filterType,       setFilterType]       = useState("all");
  const [suggestedStation, setSuggestedStation] = useState(null);
  const [suggesting,       setSuggesting]       = useState(false);
  const [suggestError,     setSuggestError]     = useState("");

  const abortRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem("token");
        const data = await getBaseStations(token);
        setRegions(data);
      } catch { setRegions([]); }
    })();
  }, []);

  // Cleanup on unmount
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
    // Cancel any previous run
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setGrid([]);
    setSummary(null);
    setAnalysed(false);
    setProgress(0);
    setProgressLabel("Starting analysis…");

    const baseLat = suggestedStation?.lat ?? region.latitude;
    const baseLng = suggestedStation?.lng ?? region.longitude;

    const result = await buildCoverageGrid(
      baseLat, baseLng, region.radius_meters,
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

    setGrid(result);
    setSummary(result.summary);
    setLoading(false);
    setAnalysed(true);
    abortRef.current = null;
  }, [region, suggestedStation]);

  const handleSuggestStation = useCallback(async () => {
    if (!region) return;
    setSuggesting(true);
    setSuggestedStation(null);
    setSuggestError("");
    try {
      const best = await getOptimalBaseStation(region);
      setSuggestedStation(best);
    } catch {
      setSuggestError("Suggestion failed. Check your network and try again.");
    }
    setSuggesting(false);
  }, [region]);

  const handleRegionChange = (e) => {
    cancelAnalysis();
    setSelIdx(Number(e.target.value));
    setGrid([]);
    setSummary(null);
    setAnalysed(false);
    setFilterType("all");
    setSuggestedStation(null);
    setSuggestError("");
  };

  const displayGrid = filterType === "all" ? grid : grid.filter((c) => c.type === filterType);

  const card = (bg, val, label, sub) => (
    <div style={{ background: bg, borderRadius: 10, padding: "14px 16px", textAlign: "center", flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "white" }}>{val}</div>
      <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.65)", marginTop: 1 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: "20px", fontFamily: "'Segoe UI', sans-serif", background: "#f4f6f9", minHeight: "100vh" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <button onClick={onBack}
          style={{ padding: "9px 18px", background: "#1565c0", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
          ← Back
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.4rem", color: "#1a237e" }}>📡 Coverage Analysis</h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#666" }}>
            Terrain-aware signal heatmap · elevation dead zones · sea &amp; inland water detection · auto-suggest station
          </p>
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{
        display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16,
        background: "white", padding: "16px 20px", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
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

        {analysed && (
          <div style={{ minWidth: 190 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#333", display: "block", marginBottom: 5 }}>Filter Layer</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
              style={{ width: "100%", padding: "9px 12px", border: "1px solid #ccc", borderRadius: 7, fontSize: 14 }}>
              <option value="all">All Layers</option>
              <option value="good">✅ Strong Signal Only</option>
              <option value="moderate">🟡 Moderate Only</option>
              <option value="weak">🟠 Weak Only</option>
              <option value="deadzone">⛰ Dead Zones Only</option>
              <option value="forest">🌲 Forest Only</option>
              <option value="sea">🌊 Sea / Ocean Only</option>
              <option value="water">💧 Inland Water Only</option>
            </select>
          </div>
        )}

        {/* Auto-suggest button */}
        <button
          onClick={handleSuggestStation}
          disabled={!region || suggesting || loading}
          title="Finds the highest-elevation point near region centroid — optimal for signal propagation"
          style={{
            padding: "10px 20px",
            background: suggesting ? "#90a4ae" : "#6a1b9a",
            color: "white", border: "none", borderRadius: 8,
            cursor: (!region || suggesting || loading) ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", alignSelf: "flex-end",
          }}>
          {suggesting ? "⏳ Finding Best Spot…" : "📍 Auto-Suggest Station"}
        </button>

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
              background: !region ? "#90a4ae" : "#1565c0",
              color: "white", border: "none", borderRadius: 8,
              cursor: !region ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", alignSelf: "flex-end",
            }}>
            🔍 Run Analysis
          </button>
        )}
      </div>

      {/* ── Suggest error ── */}
      {suggestError && (
        <div style={{
          background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8,
          padding: "10px 16px", marginBottom: 12, color: "#b71c1c", fontSize: 13,
        }}>
          ⚠️ {suggestError}
        </div>
      )}

      {/* ── Suggested station card ── */}
      {suggestedStation && (
        <div style={{
          background: "#f3e5f5", border: "2px solid #7b1fa2", borderRadius: 10,
          padding: "14px 20px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 2px 8px rgba(106,27,154,0.12)",
        }}>
          <div style={{ fontSize: 28 }}>📍</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, color: "#4a148c", fontSize: "1rem" }}>
              Suggested Optimal Base Station Location
            </div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
              <strong>Lat:</strong> {suggestedStation.lat.toFixed(6)}&nbsp;&nbsp;
              <strong>Lng:</strong> {suggestedStation.lng.toFixed(6)}&nbsp;&nbsp;
              {suggestedStation.elevation != null && (
                <><strong>Elevation:</strong> {suggestedStation.elevation} m</>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#777", marginTop: 3 }}>
              Highest-elevation point within 800 m of region centroid — optimal for signal propagation.
              Purple pin shown on map. Click <strong>Run Analysis</strong> to use this as the base.
            </div>
          </div>
          <button onClick={runAnalysis} disabled={loading}
            style={{
              padding: "9px 18px", background: loading ? "#90a4ae" : "#1565c0",
              color: "white", border: "none", borderRadius: 8,
              cursor: loading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
            }}>
            🔍 Analyse This Region
          </button>
        </div>
      )}

      {/* ── Summary cards ── */}
      {summary && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            background: summary.statusColor, color: "white", borderRadius: 10,
            padding: "12px 20px", fontSize: "1.05rem", fontWeight: 700, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            {summary.overallStatus}
            <span style={{ fontSize: "0.85rem", fontWeight: 400, opacity: 0.85 }}>
              — {region.name} · {(region.radius_meters / 1000).toFixed(1)} km radius · {summary.total} cells
              {summary.isCoastal && "  🌊 Coastal Region"}
              {suggestedStation && "  📍 Using Suggested Station"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {card("#00897b", summary.goodPct   + "%", "Strong Coverage",  "≥ 85% signal")}
            {card("#f9a825", summary.modPct    + "%", "Moderate",         "65–84% signal")}
            {card("#e64a19", summary.weakPct   + "%", "Weak Signal",      "40–64%")}
            {card("#212121", summary.deadPct   + "%", "Dead Zones",       "elevation / shadow")}
            {card("#2e7d32", summary.forestPct + "%", "Forest",           "vegetation loss")}
            {card("#1565c0", summary.seaPct    + "%", "Sea / Ocean",      "no land coverage")}
            {card("#42a5f5", summary.waterPct  + "%", "Inland Water",     "river / lake")}
            {card("#546e7a", summary.elevMin   + " m","Min Elevation",    "")}
            {card("#37474f", summary.elevMax   + " m","Max Elevation",    "")}
          </div>
        </div>
      )}

      {/* ── Map + Legend ── */}
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{
          flex: 1, borderRadius: 12, overflow: "hidden", border: "2px solid #ddd",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", position: "relative", height: 520,
        }}>
          {/* Loading overlay with real progress bar */}
          {loading && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
              background: "rgba(255,255,255,0.93)", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 10, padding: "0 48px",
            }}>
              <div style={{ fontSize: 42 }}>📡</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#1565c0" }}>
                Analysing Terrain &amp; Elevation…
              </div>
              <div style={{ fontSize: 13, color: "#555", textAlign: "center" }}>{progressLabel}</div>
              <div style={{ width: "100%", maxWidth: 340 }}>
                <ProgressBar value={progress} />
                <div style={{ textAlign: "center", fontSize: 12, color: "#888", marginTop: 5 }}>
                  {progress}% complete
                </div>
              </div>
              <button onClick={cancelAnalysis}
                style={{
                  marginTop: 6, padding: "7px 22px", background: "#c62828", color: "white",
                  border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13,
                }}>
                ✕ Cancel Analysis
              </button>
              <div style={{ fontSize: 11, color: "#aaa", textAlign: "center", maxWidth: 300, lineHeight: 1.5 }}>
                Elevation batches + Overpass run in parallel. Slow API batches time out after 8 s and fall back gracefully — the heatmap will always render.
              </div>
            </div>
          )}

          {/* Suggesting overlay */}
          {suggesting && !loading && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
              background: "rgba(255,255,255,0.93)", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 12,
            }}>
              <div style={{ fontSize: 42 }}>📍</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#6a1b9a" }}>
                Finding Optimal Station Location…
              </div>
              <div style={{ fontSize: 13, color: "#666" }}>
                Sampling 25 elevation points near region centroid
              </div>
            </div>
          )}

          {region ? (
            <MapContainer
              center={[region.latitude, region.longitude]}
              zoom={12}
              style={{ height: "100%", width: "100%" }}>
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

              {/* Region boundary circle */}
              <Circle
                center={
                  suggestedStation
                    ? [suggestedStation.lat, suggestedStation.lng]
                    : [region.latitude, region.longitude]
                }
                radius={region.radius_meters}
                pathOptions={{ color: "#1565c0", fillColor: "transparent", weight: 2, dashArray: "6,4" }}/>

              {/* Coverage heatmap rectangles */}
              {displayGrid.map((cell, idx) => (
                <Rectangle key={idx} bounds={cell.bounds}
                  pathOptions={{
                    color: cell.color, fillColor: cell.color,
                    fillOpacity: cell.type === "deadzone" ? 0.82 : cell.type === "sea" ? 0.72 : 0.62,
                    weight: 0.3, interactive: false,
                  }}/>
              ))}

              {/* Suggested station purple marker */}
              {suggestedStation && (
                <Marker position={[suggestedStation.lat, suggestedStation.lng]} icon={purpleIcon}>
                  <Popup>
                    <div style={{ minWidth: 160 }}>
                      <strong style={{ color: "#4a148c" }}>📍 Suggested Station</strong>
                      <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6 }}>
                        <div><strong>Lat:</strong> {suggestedStation.lat.toFixed(5)}</div>
                        <div><strong>Lng:</strong> {suggestedStation.lng.toFixed(5)}</div>
                        {suggestedStation.elevation != null && (
                          <div><strong>Elevation:</strong> {suggestedStation.elevation} m</div>
                        )}
                        <div style={{ marginTop: 4, color: "#777", fontSize: 11 }}>
                          Highest elevation within 800 m of centroid
                        </div>
                      </div>
                    </div>
                  </Popup>
                  <Tooltip permanent direction="top" offset={[0, -40]}>
                    📍 Suggested Station
                  </Tooltip>
                </Marker>
              )}
            </MapContainer>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#999" }}>
              No regions loaded. Deploy a base station first.
            </div>
          )}
        </div>

        {/* ── Legend panel ── */}
        <div style={{ width: 230, background: "white", borderRadius: 12, padding: 18,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)", height: "fit-content" }}>
          <h4 style={{ margin: "0 0 14px", color: "#1a237e", fontSize: "0.95rem" }}>🗺 Map Legend</h4>
          {LEGEND.map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: color, flexShrink: 0, border: "1px solid rgba(0,0,0,0.15)" }}/>
              <span style={{ fontSize: "0.82rem", color: "#333", lineHeight: 1.3 }}>{label}</span>
            </div>
          ))}

          {suggestedStation && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: "#7b1fa2", flexShrink: 0, border: "1px solid rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>📍</div>
              <span style={{ fontSize: "0.82rem", color: "#333", lineHeight: 1.3 }}>Suggested Station</span>
            </div>
          )}

          <div style={{ marginTop: 16, padding: "12px", background: "#e3f2fd", borderRadius: 8 }}>
            <div style={{ fontSize: "0.8rem", color: "#1565c0", fontWeight: 600, marginBottom: 6 }}>📌 Sea Detection</div>
            <div style={{ fontSize: "0.75rem", color: "#444", lineHeight: 1.5 }}>
              Sea cells = elevation ≤ 0m AND OSM coastline exists. Inland stations never show sea.
            </div>
          </div>

          <div style={{ marginTop: 12, padding: "12px", background: "#ede7f6", borderRadius: 8 }}>
            <div style={{ fontSize: "0.8rem", color: "#6a1b9a", fontWeight: 600, marginBottom: 6 }}>⚡ Performance</div>
            <div style={{ fontSize: "0.75rem", color: "#444", lineHeight: 1.5 }}>
              Elevation + terrain fetched in parallel. Each elevation batch times out after 8 s and falls back gracefully — heatmap always renders even on slow networks.
            </div>
          </div>

          {!analysed && region && !suggestedStation && (
            <div style={{ marginTop: 12, padding: "10px", background: "#fff3e0", borderRadius: 8,
              fontSize: "0.78rem", color: "#e65100", textAlign: "center" }}>
              ☝️ Click <strong>Run Analysis</strong> to generate heatmap, or <strong>Auto-Suggest</strong> to find the best tower spot.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
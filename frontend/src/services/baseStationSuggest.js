// src/services/baseStationSuggest.js

export function getCentroid(regionPolygon) {
  const n = regionPolygon.length;
  let lat = 0, lng = 0;
  regionPolygon.forEach((p) => { lat += p.lat; lng += p.lng; });
  return { lat: lat / n, lng: lng / n };
}

export function generateSamplePoints(center, count = 10, radius = 800) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const dx = (radius / 111320) * Math.cos(angle);
    const dy =
      (radius / ((40075000 * Math.cos((center.lat * Math.PI) / 180)) / 360)) *
      Math.sin(angle);
    points.push({ lat: center.lat + dx, lng: center.lng + dy });
  }
  points.push(center);
  return points;
}

export async function getOptimalBaseStation(regionPolygon) {
  const centroid = getCentroid(regionPolygon);
  const samples = generateSamplePoints(centroid, 10, 800);

  // ✅ Use POST with JSON body — same pattern as fetchElevationBatch in CoverageAnalysis
  let elevations = [];
  try {
    const resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: samples.map((p) => ({ latitude: p.lat, longitude: p.lng })),
      }),
    });
    if (!resp.ok) throw new Error("Elevation API error");
    const data = await resp.json();
    elevations = (data.results || []).map((r) => r.elevation ?? null);
  } catch {
    // Fallback: return centroid if API fails
    return { lat: centroid.lat, lng: centroid.lng, elevation: null };
  }

  let best = centroid;
  let maxElev = -Infinity;

  elevations.forEach((elev, i) => {
    if (elev !== null && elev > 0 && elev > maxElev) {
      maxElev = elev;
      best = { ...samples[i], elevation: elev };
    }
  });

  return best; // { lat, lng, elevation }
}
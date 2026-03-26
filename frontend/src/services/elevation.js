// Elevation API utility for CoverageAnalysis.jsx
// Uses Open-Elevation API (public, no key required, but rate-limited)
// https://api.open-elevation.com/api/v1/lookup?locations=LAT,LON

export async function getElevation(lat, lon) {
  try {
    const resp = await fetch(
      `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`,
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.results && data.results.length > 0) {
      return data.results[0].elevation;
    }
    return null;
  } catch (e) {
    return null;
  }
}
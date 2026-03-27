const COVERAGE_CACHE_KEY = "fecs_coverage_analysis_cache";

export function saveCoverageCache(stationId, payload) {
  if (!stationId || !payload) return;

  const cache = readAllCoverageCache();
  cache[String(stationId)] = {
    station_id: stationId,
    saved_at: Date.now(),
    ...payload,
  };
  sessionStorage.setItem(COVERAGE_CACHE_KEY, JSON.stringify(cache));
}

export function getCoverageCache(stationId) {
  if (!stationId) return null;
  const cache = readAllCoverageCache();
  return cache[String(stationId)] || null;
}

function readAllCoverageCache() {
  try {
    const raw = sessionStorage.getItem(COVERAGE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

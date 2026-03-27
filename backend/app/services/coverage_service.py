import json
import math
from typing import Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


R_EARTH = 6378137
ELEVATION_BATCH_SIZE = 80
ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
LOS_SAMPLE_STEPS = 6


def meters_to_lat_deg(meters: float) -> float:
    return (meters / R_EARTH) * (180 / math.pi)


def meters_to_lng_deg(meters: float, lat: float) -> float:
    cos_lat = math.cos((math.pi * lat) / 180)
    if abs(cos_lat) < 1e-12:
        return 0.0
    return (meters / (R_EARTH * cos_lat)) * (180 / math.pi)


def dist_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    d_lat = (lat1 - lat2) * (math.pi / 180) * R_EARTH
    d_lng = (lng1 - lng2) * (math.pi / 180) * R_EARTH * math.cos((lat2 * math.pi) / 180)
    return math.sqrt((d_lat * d_lat) + (d_lng * d_lng))


def in_bounds(bounds: Dict[str, float], lat: float, lng: float) -> bool:
    return (
        lat >= bounds["minLat"]
        and lat <= bounds["maxLat"]
        and lng >= bounds["minLng"]
        and lng <= bounds["maxLng"]
    )


def _post_json(url: str, payload: Dict, timeout: int) -> Optional[Dict]:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return None


def _post_text(url: str, body: str, timeout: int) -> Optional[Dict]:
    request = Request(
        url,
        data=body.encode("utf-8"),
        headers={"Content-Type": "text/plain;charset=UTF-8"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return None


def fetch_elevation_batch(points: List[Dict[str, float]]) -> List[Optional[float]]:
    payload = {
        "locations": [
            {"latitude": point["latitude"], "longitude": point["longitude"]}
            for point in points
        ]
    }
    data = _post_json(ELEVATION_URL, payload, timeout=8)
    if not data:
        return [None] * len(points)

    results = data.get("results") or []
    elevations: List[Optional[float]] = []
    for result in results:
        elevations.append(result.get("elevation"))

    if len(elevations) < len(points):
        elevations.extend([None] * (len(points) - len(elevations)))

    return elevations[: len(points)]


def fetch_overpass_terrain(south: float, west: float, north: float, east: float) -> Dict:
    query = f"""
    [out:json][timeout:20];
    (
      way["landuse"~"residential|commercial"]({south},{west},{north},{east});
      relation["landuse"~"residential|commercial"]({south},{west},{north},{east});
      way["landuse"~"forest|orchard"]({south},{west},{north},{east});
      way["natural"~"wood|scrub"]({south},{west},{north},{east});
      node["natural"~"peak|hill"]({south},{west},{north},{east});
      way["natural"~"cliff|ridge"]({south},{west},{north},{east});
      way["natural"="water"]({south},{west},{north},{east});
      relation["natural"="water"]({south},{west},{north},{east});
      way["waterway"~"river|canal|stream"]({south},{west},{north},{east});
      way["natural"="coastline"]({south},{west},{north},{east});
    );
    out bb center qt;
    """

    data = _post_text(OVERPASS_URL, query, timeout=25)
    if not data:
        return {
            "urban": [],
            "forest": [],
            "peaks": [],
            "cliffs": [],
            "inlandWater": [],
            "hasCoastline": False,
        }

    urban = []
    forest = []
    peaks = []
    cliffs = []
    inland_water = []
    has_coastline = False

    for element in data.get("elements") or []:
        tags = element.get("tags") or {}
        if tags.get("natural") == "coastline":
            has_coastline = True
            continue

        is_urban = tags.get("landuse") and any(
            key in tags["landuse"] for key in ("residential", "commercial")
        )
        is_forest = (
            tags.get("landuse") and any(key in tags["landuse"] for key in ("forest", "orchard"))
        ) or (
            tags.get("natural") and any(key in tags["natural"] for key in ("wood", "scrub"))
        )
        is_peak = tags.get("natural") and any(
            key in tags["natural"] for key in ("peak", "hill")
        )
        is_cliff = tags.get("natural") and any(
            key in tags["natural"] for key in ("cliff", "ridge")
        )
        is_inland_water = tags.get("natural") == "water" or (
            tags.get("waterway")
            and any(key in tags["waterway"] for key in ("river", "canal", "stream"))
        )

        if is_peak and element.get("lat") is not None and element.get("lon") is not None:
            peaks.append({"lat": element["lat"], "lng": element["lon"]})
            continue

        bounds = element.get("bounds")
        if not bounds:
            continue

        normalized_bounds = {
            "minLat": bounds["minlat"],
            "maxLat": bounds["maxlat"],
            "minLng": bounds["minlon"],
            "maxLng": bounds["maxlon"],
        }

        if is_urban:
            urban.append(normalized_bounds)
        elif is_forest:
            forest.append(normalized_bounds)
        elif is_cliff:
            cliffs.append(normalized_bounds)
        elif is_inland_water:
            inland_water.append(normalized_bounds)

    return {
        "urban": urban,
        "forest": forest,
        "peaks": peaks,
        "cliffs": cliffs,
        "inlandWater": inland_water,
        "hasCoastline": has_coastline,
    }


def _resolve_steps(radius: float) -> int:
    steps = 30
    if radius < 5000:
        steps = 20
    if radius > 25000:
        steps = 38
    return steps


def _get_cell_center(cell: Dict) -> Dict[str, float]:
    south_west, north_east = cell["bounds"]
    return {
        "lat": (south_west[0] + north_east[0]) / 2,
        "lng": (south_west[1] + north_east[1]) / 2,
    }


def _build_spatial_index(cells: List[Dict], steps: int) -> Dict[str, int]:
    index: Dict[str, int] = {}
    for cell_index, cell in enumerate(cells):
        index[f'{cell["gridI"]}:{cell["gridJ"]}'] = cell_index
    return index


def _lookup_elevation(
    cells: List[Dict],
    elevation_index: Dict[str, int],
    i: int,
    j: int,
) -> Optional[float]:
    cell_index = elevation_index.get(f"{i}:{j}")
    if cell_index is None:
        return None
    return cells[cell_index].get("elevation")


def _terrain_shadow_penalty(
    center_elevation: Optional[float],
    target_elevation: Optional[float],
    start_i: int,
    start_j: int,
    end_i: int,
    end_j: int,
    cells: List[Dict],
    elevation_index: Dict[str, int],
) -> float:
    if center_elevation is None or target_elevation is None:
        return 0.0

    dx = end_i - start_i
    dy = end_j - start_j
    if dx == 0 and dy == 0:
        return 0.0

    obstruction = 0.0
    for step in range(1, LOS_SAMPLE_STEPS):
        ratio = step / LOS_SAMPLE_STEPS
        sample_i = round(start_i + dx * ratio)
        sample_j = round(start_j + dy * ratio)
        sample_elevation = _lookup_elevation(cells, elevation_index, sample_i, sample_j)
        if sample_elevation is None:
            continue

        expected = center_elevation + (target_elevation - center_elevation) * ratio
        if sample_elevation <= expected:
            continue

        obstruction = max(obstruction, sample_elevation - expected)

    if obstruction >= 120:
        return 55.0
    if obstruction >= 70:
        return 35.0
    if obstruction >= 30:
        return 18.0
    return 0.0


def _base_signal(distance: float, radius: float) -> float:
    if radius <= 0:
        return 100.0
    normalized = min(1.0, max(0.0, distance / radius))
    return 100.0 - (normalized ** 1.35) * 58.0


def generate_coverage_grid(lat: float, lng: float, radius: float) -> List[Dict]:
    lat_off = meters_to_lat_deg(radius)
    lng_off = meters_to_lng_deg(radius, lat)
    south = lat - lat_off
    north = lat + lat_off
    west = lng - lng_off
    east = lng + lng_off

    steps = _resolve_steps(radius)
    step_lat = (north - south) / steps
    step_lng = (east - west) / steps

    cells = []
    for i in range(steps):
        for j in range(steps):
            cell_lat = south + i * step_lat + step_lat / 2
            cell_lng = west + j * step_lng + step_lng / 2
            distance = dist_meters(cell_lat, cell_lng, lat, lng)
            if distance <= radius:
                cells.append(
                    {
                        "cellLat": cell_lat,
                        "cellLng": cell_lng,
                        "dist": distance,
                        "gridI": i,
                        "gridJ": j,
                    }
                )

    all_elevations: List[Optional[float]] = []
    for index in range(0, len(cells), ELEVATION_BATCH_SIZE):
        batch = cells[index : index + ELEVATION_BATCH_SIZE]
        points = [
            {"latitude": cell["cellLat"], "longitude": cell["cellLng"]}
            for cell in batch
        ]
        all_elevations.extend(fetch_elevation_batch(points))

    terrain = fetch_overpass_terrain(south, west, north, east)
    urban = terrain["urban"]
    forest = terrain["forest"]
    peaks = terrain["peaks"]
    cliffs = terrain["cliffs"]
    inland_water = terrain["inlandWater"]
    has_coastline = terrain["hasCoastline"]

    for index, elevation in enumerate(all_elevations):
        cells[index]["elevation"] = elevation

    land_elevations = [value for value in all_elevations if value is not None and value > 1]
    min_elev = min(land_elevations) if land_elevations else 0
    max_elev = max(land_elevations) if land_elevations else 0
    center_elevation = fetch_elevation_batch([{"latitude": lat, "longitude": lng}])[0]
    if center_elevation is None and land_elevations:
        nearest_cell = min(cells, key=lambda cell: cell["dist"])
        center_elevation = nearest_cell.get("elevation")

    elevation_index = _build_spatial_index(cells, steps)

    grid = []
    for index, cell in enumerate(cells):
        cell_lat = cell["cellLat"]
        cell_lng = cell["cellLng"]
        distance = cell["dist"]
        elevation = all_elevations[index] if index < len(all_elevations) else None
        bounds = [
            [cell_lat - step_lat / 2, cell_lng - step_lng / 2],
            [cell_lat + step_lat / 2, cell_lng + step_lng / 2],
        ]

        is_sea_cell = has_coastline and elevation is not None and elevation <= 0
        if is_sea_cell:
            grid.append(
                {
                    "bounds": bounds,
                    "color": "#1565c0",
                    "type": "sea",
                    "signal": 0,
                    "elevation": elevation,
                }
            )
            continue

        is_inland_water = any(in_bounds(area, cell_lat, cell_lng) for area in inland_water)
        if is_inland_water:
            grid.append(
                {
                    "bounds": bounds,
                    "color": "#42a5f5",
                    "type": "water",
                    "signal": 0,
                    "elevation": elevation,
                }
            )
            continue

        signal = _base_signal(distance, radius)
        is_forest = any(in_bounds(area, cell_lat, cell_lng) for area in forest)
        is_urban = any(in_bounds(area, cell_lat, cell_lng) for area in urban)
        is_cliff = any(in_bounds(area, cell_lat, cell_lng) for area in cliffs)
        near_peak = any(
            dist_meters(cell_lat, cell_lng, peak["lat"], peak["lng"]) < 1500
            for peak in peaks
        )
        terrain_penalty = _terrain_shadow_penalty(
            center_elevation=center_elevation,
            target_elevation=elevation,
            start_i=round((lat - south) / step_lat - 0.5),
            start_j=round((lng - west) / step_lng - 0.5),
            end_i=cell["gridI"],
            end_j=cell["gridJ"],
            cells=cells,
            elevation_index=elevation_index,
        )

        if is_forest:
            signal -= 18
        elif is_urban:
            signal -= 8
        if is_cliff:
            signal -= 12
        if near_peak:
            signal -= 10
        signal -= terrain_penalty

        is_dead_zone = terrain_penalty >= 35 or (near_peak and signal < 25)

        if is_dead_zone:
            color = "#1a1a2e"
            cell_type = "deadzone"
        elif is_forest:
            color = "#2e7d32"
            cell_type = "forest"
        else:
            score = max(0, signal)
            if score >= 85:
                color = "#00e676"
                cell_type = "good"
            elif score >= 65:
                color = "#ffee58"
                cell_type = "moderate"
            elif score >= 40:
                color = "#ff9800"
                cell_type = "weak"
            else:
                color = "#f44336"
                cell_type = "poor"

        grid.append(
            {
                "bounds": bounds,
                "color": color,
                "type": cell_type,
                "signal": max(0, round(signal)),
                "elevation": elevation,
            }
        )

    return grid


def find_dead_cells(grid: List[Dict]) -> List[Dict]:
    return [cell for cell in grid if cell.get("type") in {"deadzone", "poor", "weak"}]


def cluster_cells(cells: List[Dict]) -> List[List[Dict]]:
    if not cells:
        return []

    sample = cells[0]
    south_west, north_east = sample["bounds"]
    cell_height = dist_meters(south_west[0], south_west[1], north_east[0], south_west[1])
    cell_width = dist_meters(south_west[0], south_west[1], south_west[0], north_east[1])
    threshold = max(cell_height, cell_width) * 1.5

    centers = [_get_cell_center(cell) for cell in cells]
    visited = set()
    clusters = []

    for index in range(len(cells)):
        if index in visited:
            continue

        queue = [index]
        visited.add(index)
        cluster = []

        while queue:
            current = queue.pop()
            cluster.append(cells[current])
            current_center = centers[current]

            for other_index, other_center in enumerate(centers):
                if other_index in visited:
                    continue
                if (
                    dist_meters(
                        current_center["lat"],
                        current_center["lng"],
                        other_center["lat"],
                        other_center["lng"],
                    )
                    <= threshold
                ):
                    visited.add(other_index)
                    queue.append(other_index)

        clusters.append(cluster)

    return clusters


def get_centroid(cluster: List[Dict]) -> Dict[str, float]:
    if not cluster:
        return {"lat": 0.0, "lng": 0.0}

    centers = [_get_cell_center(cell) for cell in cluster]
    return {
        "lat": round(sum(center["lat"] for center in centers) / len(centers), 6),
        "lng": round(sum(center["lng"] for center in centers) / len(centers), 6),
    }


def suggest_relays(grid: List[Dict]) -> List[Dict]:
    dead_cells = find_dead_cells(grid)
    clusters = cluster_cells(dead_cells)
    relays = []

    for cluster in clusters:
        centroid = get_centroid(cluster)
        relays.append(
            {
                "lat": centroid["lat"],
                "lng": centroid["lng"],
                "cell_count": len(cluster),
            }
        )

    return relays


def _classify_signal(score: float) -> Dict[str, str]:
    if score >= 85:
        return {"type": "good", "color": "#00e676"}
    if score >= 65:
        return {"type": "moderate", "color": "#ffee58"}
    if score >= 40:
        return {"type": "weak", "color": "#ff9800"}
    return {"type": "poor", "color": "#f44336"}


def _is_land_cell(cell: Dict) -> bool:
    return cell.get("type") not in {"sea", "water"}


def _threshold_for_target(target: str) -> int:
    return 85 if target == "strong" else 65


def _cells_below_target(grid: List[Dict], target: str) -> List[Dict]:
    threshold = _threshold_for_target(target)
    return [
        cell
        for cell in grid
        if _is_land_cell(cell) and float(cell.get("signal", 0)) < threshold
    ]


def _coverage_deficit(grid: List[Dict], target: str) -> float:
    threshold = _threshold_for_target(target)
    return sum(
        max(0.0, threshold - float(cell.get("signal", 0)))
        for cell in grid
        if _is_land_cell(cell)
    )


def _cluster_score(cluster: List[Dict], target: str) -> float:
    threshold = _threshold_for_target(target)
    total_gap = sum(max(0.0, threshold - float(cell.get("signal", 0))) for cell in cluster)
    return float(len(cluster)) * 100.0 + total_gap


def _distance_from_existing_relays(candidate: Dict[str, float], relays: List[Dict]) -> float:
    if not relays:
        return float("inf")
    return min(
        dist_meters(candidate["lat"], candidate["lng"], relay["lat"], relay["lng"])
        for relay in relays
    )


def _pick_next_relay(clustered_cells: List[List[Dict]], relays: List[Dict], radius: float, target: str) -> Optional[Dict]:
    if not clustered_cells:
        return None

    min_spacing = radius * 0.18
    ranked_clusters = sorted(
        clustered_cells,
        key=lambda cluster: _cluster_score(cluster, target),
        reverse=True,
    )

    for cluster in ranked_clusters:
        centroid = get_centroid(cluster)
        if _distance_from_existing_relays(centroid, relays) >= min_spacing:
            return {
                "lat": centroid["lat"],
                "lng": centroid["lng"],
                "cell_count": len(cluster),
            }

    cluster = ranked_clusters[0]
    centroid = get_centroid(cluster)
    return {
        "lat": centroid["lat"],
        "lng": centroid["lng"],
        "cell_count": len(cluster),
    }


def recalculate_coverage_with_relays(
    grid: List[Dict], relays: List[Dict], radius: float
) -> List[Dict]:
    if not relays:
        return list(grid)

    relay_radius = radius * 0.35
    if relay_radius <= 0:
        return list(grid)

    improved_grid = []
    for cell in grid:
        cell_type = cell.get("type")
        if cell_type in {"sea", "water"}:
            improved_grid.append(dict(cell))
            continue

        center = _get_cell_center(cell)
        best_signal = float(cell.get("signal", 0))

        for relay in relays:
            distance = dist_meters(center["lat"], center["lng"], relay["lat"], relay["lng"])
            if distance > relay_radius:
                continue

            relay_signal = _base_signal(distance, relay_radius) + 8
            if cell_type == "deadzone":
                relay_signal -= 10
            elif cell_type == "poor":
                relay_signal -= 4
            elif cell_type == "weak":
                relay_signal -= 1

            relay_signal = min(relay_signal, 96)
            if relay_signal > best_signal:
                best_signal = relay_signal

        best_signal = max(0, round(best_signal))
        classification = _classify_signal(best_signal)

        updated_cell = dict(cell)
        updated_cell["signal"] = best_signal

        if updated_cell.get("type") != "forest":
            updated_cell["type"] = classification["type"]
            updated_cell["color"] = classification["color"]
        elif best_signal < 40:
            updated_cell["type"] = "deadzone"
            updated_cell["color"] = "#1a1a2e"

        improved_grid.append(updated_cell)

    return improved_grid


def optimize_relays_for_target(
    grid: List[Dict],
    radius: float,
    target: str = "moderate",
    max_relays: int = 18,
) -> Dict:
    threshold = _threshold_for_target(target)
    optimized_grid = list(grid)
    relays: List[Dict] = []
    initial_uncovered = len(_cells_below_target(optimized_grid, target))
    previous_uncovered = initial_uncovered
    previous_deficit = _coverage_deficit(optimized_grid, target)

    if previous_uncovered == 0:
        return {
            "target": target,
            "threshold": threshold,
            "relays": relays,
            "grid": optimized_grid,
            "covered_cells": 0,
            "remaining_cells": 0,
            "target_met": True,
        }

    for _ in range(max_relays):
        failing_cells = _cells_below_target(optimized_grid, target)
        if not failing_cells:
            break

        clusters = cluster_cells(failing_cells)
        if not clusters:
            break

        next_relay = _pick_next_relay(clusters, relays, radius, target)
        if not next_relay:
            break

        relays.append(next_relay)

        optimized_grid = recalculate_coverage_with_relays(grid, relays, radius)
        remaining_uncovered = len(_cells_below_target(optimized_grid, target))
        deficit = _coverage_deficit(optimized_grid, target)

        if remaining_uncovered >= previous_uncovered and deficit >= previous_deficit:
            break

        previous_uncovered = remaining_uncovered
        previous_deficit = deficit

    remaining_cells = len(_cells_below_target(optimized_grid, target))
    return {
        "target": target,
        "threshold": threshold,
        "relays": relays,
        "grid": optimized_grid,
        "covered_cells": initial_uncovered - remaining_cells,
        "remaining_cells": remaining_cells,
        "target_met": remaining_cells == 0,
    }

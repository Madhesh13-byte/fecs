export const fetchTerrainGrid = async (centerLat, centerLng, radiusMeters) => {
  const R = 6378137; // Earth's radius in meters
  // Expand search area slightly beyond the circle
  const searchRadius = Number(radiusMeters);
  const latOffset = (searchRadius / R) * (180 / Math.PI);
  const lngOffset = (searchRadius / (R * Math.cos((Math.PI * centerLat) / 180))) * (180 / Math.PI);

  const s = centerLat - latOffset;
  const n = centerLat + latOffset;
  const w = centerLng - lngOffset;
  const e = centerLng + lngOffset;

  // Query Overpass API for features
  const query = `
    [out:json][timeout:15];
    (
      way["landuse"~"residential|commercial"](${s},${w},${n},${e});
      relation["landuse"~"residential|commercial"](${s},${w},${n},${e});
      
      way["landuse"~"forest|orchard"](${s},${w},${n},${e});
      way["natural"~"wood|scrub"](${s},${w},${n},${e});
      
      way["natural"~"water|bay|strait"](${s},${w},${n},${e});
      relation["natural"~"water|bay|strait"](${s},${w},${n},${e});
      way["waterway"](${s},${w},${n},${e});
      
      node["natural"~"peak|hill"](${s},${w},${n},${e});
    );
    out bb center qt;
  `;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    const data = await response.json();

    const urban = [];
    const forest = [];
    const water = [];
    const peaks = [];

    (data.elements || []).forEach(el => {
      const tags = el.tags || {};
      
      const isUrban = tags.landuse && /residential|commercial/.test(tags.landuse);
      const isForest = (tags.landuse && /forest|orchard/.test(tags.landuse)) || (tags.natural && /wood|scrub/.test(tags.natural));
      const isWater = (tags.natural && /water|bay|strait/.test(tags.natural)) || tags.waterway;
      const isPeak = tags.natural && /peak|hill/.test(tags.natural);

      if (isPeak) {
        peaks.push({ lat: el.lat, lng: el.lon });
      } else if (el.bounds) {
        const bbox = { minLat: el.bounds.minlat, maxLat: el.bounds.maxlat, minLng: el.bounds.minlon, maxLng: el.bounds.maxlon };
        if (isUrban) urban.push(bbox);
        else if (isForest) forest.push(bbox);
        else if (isWater) water.push(bbox);
      }
    });

    // Create the grid representation
    // Adjust resolution based on array size to prevent thousands of SVG elements
    let steps = 30; // Default resolution for a 15km radius (approx 750m squares)
    if (searchRadius < 5000) steps = 20; // Smaller radius needs fewer points to look good
    if (searchRadius > 25000) steps = 40;

    const stepLat = (n - s) / steps;
    const stepLng = (e - w) / steps;

    const grid = [];

    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const cellLat = s + (i * stepLat) + (stepLat / 2);
        const cellLng = w + (j * stepLng) + (stepLng / 2);

        // Filter points outside exact circle explicitly
        const dLat = (cellLat - centerLat) * (Math.PI / 180) * R;
        const dLng = (cellLng - centerLng) * (Math.PI / 180) * R * Math.cos((centerLat * Math.PI) / 180);
        const distToTower = Math.sqrt(dLat * dLat + dLng * dLng);

        if (distToTower > searchRadius) continue;

        // Signal baseline algorithm (Distance dropoff from 100 to 80 at edge)
        let signal = 100 - (distToTower / searchRadius) * 20;

        const inBounds = (bbox, lat, lng) => lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;

        const isWaterCell = water.some(b => inBounds(b, cellLat, cellLng));

        // Apply heaviest blockages layer by layer
        if (forest.some(b => inBounds(b, cellLat, cellLng))) { signal -= 25; }
        else if (isWaterCell) { signal -= 15; }
        else if (urban.some(b => inBounds(b, cellLat, cellLng))) { signal -= 10; }

        // Peak proximity (1.5km interference radius for mountains)
        const nearPeak = peaks.some(p => {
          const pdLat = (cellLat - p.lat) * (Math.PI / 180) * R;
          const pdLng = (cellLng - p.lng) * (Math.PI / 180) * R * Math.cos((p.lat * Math.PI) / 180);
          return Math.sqrt(pdLat * pdLat + pdLng * pdLng) < 1500;
        });

        if (nearPeak) { signal -= 40; }

        // Determine final chunk color
        let color = 'red';
        if (isWaterCell) {
          color = 'orange';
        } else {
          if (signal >= 85) color = 'green';
          else if (signal >= 60) color = 'yellow';
          else if (signal >= 30) color = 'orange';
        }

        grid.push({
          bounds: [
            [cellLat - stepLat / 2, cellLng - stepLng / 2],
            [cellLat + stepLat / 2, cellLng + stepLng / 2]
          ],
          color,
          signal: Math.max(0, Math.round(signal))
        });
      }
    }

    return grid;

  } catch (error) {
    console.error("Error fetching terrain data:", error);
    return [];
  }
};
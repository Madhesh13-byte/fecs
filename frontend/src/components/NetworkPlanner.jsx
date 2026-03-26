import React, { useState, useEffect } from 'react';
import { FaArrowLeft, FaSave, FaBroadcastTower } from 'react-icons/fa';
import { MapContainer, TileLayer, Circle, Popup, useMapEvents, LayersControl, useMap, Rectangle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getBaseStations, createBaseStation } from '../services/api';
import { fetchTerrainGrid } from '../services/terrainService';
import './AdminDashboard.css';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng);
    },
  });
  return null;
}

function MapFixer() {
  const map = useMap();
  useEffect(() => {
    // Leaflet often computes a size of 0x0 when placed in a dynamic flexbox.
    // This hook invalidates the size after the flex layout settles, fixing dragging.
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function NetworkPlanner({ onBack }) {
  const [stations, setStations] = useState([]);
  const [draftLocation, setDraftLocation] = useState(null);
  const [formData, setFormData] = useState({ name: '', radius_meters: 15000 });
  const [heatmapData, setHeatmapData] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [activeStationId, setActiveStationId] = useState(null);

  useEffect(() => {
    fetchStations();
  }, []);

  const fetchStations = async () => {
    try {
      const token = localStorage.getItem('token');
      const data = await getBaseStations(token);
      setStations(data);
    } catch (error) {
      console.error('Error fetching base stations', error);
    }
  };

  useEffect(() => {
    if (!draftLocation || activeStationId !== null) {
      if (!draftLocation && activeStationId === null) setHeatmapData([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsCalculating(true);
      const grid = await fetchTerrainGrid(draftLocation.lat, draftLocation.lng, formData.radius_meters);
      setHeatmapData(grid);
      setIsCalculating(false);
    }, 400); // Faster perceived response
    return () => clearTimeout(timer);
  }, [draftLocation, formData.radius_meters, activeStationId]);

  const handleMapClick = (latlng) => {
    setDraftLocation(latlng);
    setActiveStationId(null);
  };

  const handleStationClick = async (station) => {
    setDraftLocation(null);
    setActiveStationId(station.id);
    setHeatmapData([]); // Clear old heatmap while generating new
    setIsCalculating(true);
    const grid = await fetchTerrainGrid(station.latitude, station.longitude, station.radius_meters);
    setHeatmapData(grid);
    setIsCalculating(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!draftLocation) return;

    try {
      const token = localStorage.getItem('token');
      await createBaseStation({
        name: formData.name,
        latitude: draftLocation.lat,
        longitude: draftLocation.lng,
        radius_meters: Number(formData.radius_meters)
      }, token);

      setDraftLocation(null);
      setFormData({ name: '', radius_meters: 15000 });
      fetchStations();
      alert("Base Station Deployed Successfully!");
    } catch (error) {
      alert("Error deploying station. Name might be taken.");
    }
  };

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <button className="back-btn" onClick={onBack}>
          <FaArrowLeft /> Back to Dashboard
        </button>
        <h1>Network Infrastructure Planner</h1>
      </header>

      <div className="admin-content" style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 120px)' }}>

        {/* Sidebar */}
        <div style={{ width: '300px', backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', overflowY: 'auto' }}>
          <h2>Deployed Stations</h2>
          {stations.length === 0 ? <p>No stations deployed.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {stations.map(st => (
                <li key={st.id} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                  <strong><FaBroadcastTower /> {st.name}</strong><br />
                  <small>Radius: {st.radius_meters / 1000}km</small>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#e8f5e9', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#2e7d32' }}>How to Deploy</h3>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#1b5e20' }}>Click anywhere on the map to drop a new Base Station antenna coverage zone.</p>
          </div>
        </div>

        {/* Map Area */}
        <div style={{ flex: 1, position: 'relative', borderRadius: '10px', overflow: 'hidden', border: '2px solid #ddd' }}>
          <MapContainer
            center={[10.8050, 78.6856]}
            zoom={10}
            dragging={true}
            touchZoom={true}
            scrollWheelZoom={true}
            keyboard={true}
            style={{ height: '100%', width: '100%', minHeight: '400px' }}
          >
            <MapFixer />
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name="Standard (Road Map)">
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
                  attribution='Tiles &copy; Esri'
                />
              </LayersControl.BaseLayer>

              <LayersControl.BaseLayer name="Satellite (Aerial Imagery)">
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  attribution='Tiles &copy; Esri'
                />
              </LayersControl.BaseLayer>

              <LayersControl.BaseLayer name="Topographic / Terrain">
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
                  attribution='Tiles &copy; Esri'
                />
              </LayersControl.BaseLayer>
            </LayersControl>
            <MapClickHandler onLocationSelect={handleMapClick} />

            {/* Render existing stations */}
            {stations.map(st => (
              <Circle
                key={st.id}
                center={[st.latitude, st.longitude]}
                radius={st.radius_meters}
                pathOptions={{ 
                  color: activeStationId === st.id ? '#ffffff' : '#2196f3', 
                  fillColor: activeStationId === st.id ? 'transparent' : '#4caf50', 
                  fillOpacity: activeStationId === st.id ? 0 : 0.2, 
                  weight: activeStationId === st.id ? 2 : 1,
                  dashArray: activeStationId === st.id ? '4,4' : null,
                  interactive: true 
                }}
                eventHandlers={{ click: () => handleStationClick(st) }}
              >
                <Popup>
                  <strong>{st.name}</strong><br />
                  Coverage: {st.radius_meters / 1000}km<br />
                  <em>Click to evaluate Heatmap</em>
                </Popup>
              </Circle>
            ))}

            {/* Render the Heatmap chunks */}
            {heatmapData.map((cell, idx) => (
              <Rectangle
                key={`grid-${idx}`}
                bounds={cell.bounds}
                pathOptions={{ color: cell.color, fillColor: cell.color, fillOpacity: 0.65, weight: 0.5, interactive: false }}
              />
            ))}

            {/* Render draft station boundary */}
            {draftLocation && (
              <Circle
                center={[draftLocation.lat, draftLocation.lng]}
                radius={formData.radius_meters}
                pathOptions={{ color: '#ff9800', fillColor: 'transparent', weight: 2, dashArray: "5, 5", interactive: false }}
              />
            )}
          </MapContainer>

          {isCalculating && (
            <div style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'rgba(255,255,255,0.95)', padding: '10px 20px', borderRadius: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', fontWeight: 'bold', fontSize: '14px', color: '#333', border: '2px solid #2196f3' }}>
              📡 Processing Terrain Heatmap via API...
            </div>
          )}

          {/* Draft Form Modal overlaying the map */}
          {draftLocation && (
            <div style={{
              position: 'absolute', top: '20px', right: '20px', zIndex: 1000,
              backgroundColor: 'white', padding: '20px', borderRadius: '10px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)', width: '300px'
            }}>
              <h3 style={{ marginTop: 0 }}>Deploy New Station</h3>
              <form onSubmit={handleCreate}>
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>Station Name</label>
                  <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. North Ridge" style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: 'bold' }}>Radius (Meters)</label>
                  <input required type="number" step="1000" min="1000" value={formData.radius_meters} onChange={e => setFormData({ ...formData, radius_meters: e.target.value })} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="button" onClick={() => setDraftLocation(null)} style={{ flex: 1, padding: '10px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                  <button type="submit" style={{ flex: 1, padding: '10px', backgroundColor: '#4caf50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}><FaSave /> Save</button>
                </div>
              </form>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default NetworkPlanner;
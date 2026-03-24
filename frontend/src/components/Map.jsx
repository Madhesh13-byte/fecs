import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const getMarkerColor = (messageType) => {
  switch (messageType?.toLowerCase()) {
    case 'emergency': return '#d32f2f';
    case 'high': return '#f57c00';
    case 'normal': return '#388e3c';
    case 'automated': return '#7b1fa2';
    case 'cancel': return '#1976d2';
    default: return '#607d8b';
  }
};

const getUserInitials = (userName) => {
  if (!userName) return '?';
  const names = userName.trim().split(' ');
  if (names.length === 1) {
    return names[0].substring(0, 2).toUpperCase();
  }
  return (names[0][0] + names[names.length - 1][0]).toUpperCase();
};

const getDeviceNumber = (deviceId) => {
  // Extract number from device ID (e.g., DEV_301 -> 301)
  const match = deviceId.match(/\d+/);
  return match ? match[0] : deviceId.substring(0, 3);
};

const createCustomMarker = (alert, color, isOutOfBounds) => {
  const initials = getUserInitials(alert.user_name);
  const deviceNum = getDeviceNumber(alert.device_id);
  const label = `${initials}-${deviceNum}`;
  const bgColor = isOutOfBounds ? '#ffeb3b' : color;
  const typeLC = alert.message_type?.toLowerCase();
  const icon = typeLC === 'automated' ? ' 🤖' : typeLC === 'emergency' ? ' 🚨' : '';
  
  return L.divIcon({
    className: 'custom-marker-label',
    html: `
      <div style="
        background-color: ${bgColor};
        color: white;
        padding: 6px 10px;
        border-radius: 8px;
        font-weight: bold;
        font-size: 12px;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        white-space: nowrap;
        text-align: center;
        font-family: Arial, sans-serif;
      ">${label}${icon}</div>
    `,
    iconSize: [70, 30],
    iconAnchor: [35, 15],
  });
};

function FitBounds({ station }) {
  const map = useMap();
  useEffect(() => {
    // We only enforce strict operator bounds if they are assigned a station
    if (station && station.id) {
      const radiusKm = station.radius_meters / 1000;
      const latOffset = radiusKm / 111.32;
      const lngOffset = radiusKm / (111.32 * Math.cos(station.latitude * Math.PI / 180));
      
      const bounds = L.latLngBounds(
        [station.latitude - latOffset, station.longitude - lngOffset],
        [station.latitude + latOffset, station.longitude + lngOffset]
      );
      
      // 1. Initial framing
      map.fitBounds(bounds, { padding: [10, 10] });
      
      // 2. We used to hard lock the camera to these bounds here via map.setMaxBounds(bounds),
      // but this prevents operators from dragging/panning the map if their screen already fits the zone.
      // So we leave maxBounds null so they can freely move around.
      map.setMaxBounds(null);
    } else {
      // Remove constraints if no station is assigned (e.g., admin map view)
      map.setMaxBounds(null);
    }
  }, [station?.id, map]); 
  return null;
}

function MapFixer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function Map({ alerts, baseStation }) {
  // If no base station is assigned, default to looking at Trichy
  const center = baseStation 
    ? [baseStation.latitude, baseStation.longitude] 
    : (alerts.length > 0 ? [alerts[0].latitude, alerts[0].longitude] : [10.8050, 78.6856]);

  return (
    <MapContainer 
      center={center} 
      zoom={baseStation ? 13 : 10} 
      className="map"
      dragging={true}
      touchZoom={true}
      scrollWheelZoom={true}
      keyboard={true}
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
      
      <FitBounds station={baseStation} />
      
      {/* Draw the massive transparent green radio coverage area */}
      {baseStation && (
        <Circle
          center={[baseStation.latitude, baseStation.longitude]}
          radius={baseStation.radius_meters}
          pathOptions={{ color: '#2e7d32', fillColor: '#4caf50', fillOpacity: 0.15, weight: 3, interactive: false }}
        />
      )}
      
      {alerts.map((alert) => {
        // Check if the hardware is transmitting from completely outside our physical base station range
        const isOutOfBounds = baseStation 
          ? L.latLng(alert.latitude, alert.longitude).distanceTo(L.latLng(baseStation.latitude, baseStation.longitude)) > baseStation.radius_meters
          : false;

        const markerColor = getMarkerColor(alert.message_type);

        return (
          <Marker
            key={alert.id}
            position={[alert.latitude, alert.longitude]}
            icon={createCustomMarker(alert, markerColor, isOutOfBounds)}
          >
            <Popup>
              <div>
                {alert.user_name ? (
                  <>
                    <strong>{alert.user_name}</strong><br />
                    <span style={{ fontSize: '12px', color: '#666' }}>Device: {alert.device_id}</span><br />
                    {alert.user_phone && <span style={{ fontSize: '12px' }}>Phone: {alert.user_phone}</span>}<br />
                  </>
                ) : (
                  <>
                    <strong>Device: {alert.device_id}</strong><br />
                    <span style={{ fontSize: '12px', color: '#d32f2f' }}>⚠️ Unregistered Device</span><br />
                  </>
                )}
                Type: {alert.message_type}<br />
                Status: {alert.status}<br />
                Time: {new Date(alert.event_time).toLocaleString()}
                {isOutOfBounds && (
                  <div style={{ marginTop: '8px', color: '#d32f2f', fontWeight: 'bold', fontSize: '13px' }}>
                    <span role="img" aria-label="warning">⚠️</span> SENSOR OUT OF BOUNDS
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

export default Map;

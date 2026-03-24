import React, { useState, useEffect } from 'react';
import { FaTree, FaSignOutAlt, FaMapMarkedAlt, FaBell, FaMobileAlt, FaArrowLeft } from 'react-icons/fa';
import { FiMapPin, FiUser } from 'react-icons/fi';
import axios from 'axios';
import Map from './Map';
import UserList from './UserList';
import ReadOnlyAlertList from './ReadOnlyAlertList';
import DeviceRegistration from './DeviceRegistration';
import { getAlerts, getCurrentUser, getBaseStations } from '../services/api';
import { connectWebSocket } from '../services/websocket';
import './OperatorDashboard.css';

const OperatorDashboard = ({ onLogout }) => {
  const [view, setView] = useState('home');
  const [alerts, setAlerts] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [operatorStation, setOperatorStation] = useState(null);
  const [stats, setStats] = useState({
    activeAlerts: 0,
    alertsToday: 0,
    registeredDevices: 0
  });
  const token = localStorage.getItem('token');

  useEffect(() => {
    fetchCurrentUser();
    loadAlerts();
    fetchStats();
    const connection = connectWebSocket(token, handleNewAlert);
    return () => connection.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchCurrentUser = async () => {
    try {
      const userData = await getCurrentUser(token);
      setCurrentUser(userData);
      
      // If the operator has a station name assigned, fetch it to get its GPS boundaries
      if (userData.assigned_station) {
        const stationsData = await getBaseStations(token);
        const myStation = stationsData.find(st => st.name === userData.assigned_station);
        if (myStation) setOperatorStation(myStation);
      }
      
    } catch (error) {
      console.error('Failed to fetch user:', error);
    }
  };

  const loadAlerts = async () => {
    try {
      const data = await getAlerts(token);
      setAlerts(data);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const alertData = await getAlerts(token);
      const devicesResponse = await axios.get('http://localhost:8000/api/device-registrations', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const today = new Date().toDateString();
      const alertsToday = alertData.filter(alert => 
        new Date(alert.received_at).toDateString() === today
      ).length;
      
      const activeAlerts = alertData.filter(alert => 
        alert.status === 'pending' || alert.status === 'acknowledged'
      ).length;

      setStats({
        activeAlerts,
        alertsToday,
        registeredDevices: devicesResponse.data.length
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleNewAlert = (alert) => {
    setAlerts(prev => [alert, ...prev]);
    fetchStats();
  };

  if (view === 'map') {
    return (
      <div className="operator-dashboard">
        <header className="operator-header">
          <div className="operator-title">
            <button className="back-btn" onClick={() => setView('home')}>
              <FaArrowLeft /> Back
            </button>
            <FaTree className="header-icon" />
            <h1>Map & Alerts</h1>
          </div>
          <div className="operator-user-info">
            {currentUser && currentUser.assigned_station && (
              <span className="station-badge">
                <FiMapPin /> {currentUser.assigned_station}
              </span>
            )}
            {currentUser && (
              <span className="operator-badge">
                <FiUser /> {currentUser.username} ({currentUser.employee_id || 'N/A'})
              </span>
            )}
            <button className="logout-btn" onClick={onLogout}>
              <FaSignOutAlt /> Logout
            </button>
          </div>
        </header>
        <div className="dashboard-split">
          <div className="map-container">
            <Map alerts={alerts} baseStation={operatorStation} />
          </div>
          <div className="user-list-container">
            <UserList alerts={alerts} />
          </div>
        </div>
      </div>
    );
  }

  if (view === 'alerts') {
    return (
      <div className="operator-dashboard">
        <header className="operator-header">
          <div className="operator-title">
            <button className="back-btn" onClick={() => setView('home')}>
              <FaArrowLeft /> Back
            </button>
            <FaTree className="header-icon" />
            <h1>Alert Logs</h1>
          </div>
          <div className="operator-user-info">
            {currentUser && currentUser.assigned_station && (
              <span className="station-badge">
                <FiMapPin /> {currentUser.assigned_station}
              </span>
            )}
            {currentUser && (
              <span className="operator-badge">
                <FiUser /> {currentUser.username} ({currentUser.employee_id || 'N/A'})
              </span>
            )}
            <button className="logout-btn" onClick={onLogout}>
              <FaSignOutAlt /> Logout
            </button>
          </div>
        </header>
        <div className="operator-content">
          <ReadOnlyAlertList alerts={alerts} token={token} />
        </div>
      </div>
    );
  }

  if (view === 'devices') {
    return (
      <div className="operator-dashboard">
        <header className="operator-header">
          <div className="operator-title">
            <button className="back-btn" onClick={() => setView('home')}>
              <FaArrowLeft /> Back
            </button>
            <FaTree className="header-icon" />
            <h1>Device Management</h1>
          </div>
          <div className="operator-user-info">
            {currentUser && currentUser.assigned_station && (
              <span className="station-badge">
                <FiMapPin /> {currentUser.assigned_station}
              </span>
            )}
            {currentUser && (
              <span className="operator-badge">
                <FiUser /> {currentUser.username} ({currentUser.employee_id || 'N/A'})
              </span>
            )}
            <button className="logout-btn" onClick={onLogout}>
              <FaSignOutAlt /> Logout
            </button>
          </div>
        </header>
        <div className="operator-content">
          <DeviceRegistration />
        </div>
      </div>
    );
  }

  return (
    <div className="operator-dashboard">
      <header className="operator-header">
        <div className="operator-title">
          <FaTree className="header-icon" />
          <h1>FECS - Operator Dashboard</h1>
        </div>
        <div className="operator-user-info">
          {currentUser && currentUser.assigned_station && (
            <span className="station-badge">
              <FiMapPin /> {currentUser.assigned_station}
            </span>
          )}
          {currentUser && (
            <span className="operator-badge">
              <FiUser /> {currentUser.username} ({currentUser.employee_id || 'N/A'})
            </span>
          )}
          <button className="logout-btn" onClick={onLogout}>
            <FaSignOutAlt /> Logout
          </button>
        </div>
      </header>

      <div className="operator-content">
        <div className="dashboard-cards">
          <div className="dashboard-card" onClick={() => setView('map')}>
            <div className="card-icon map-icon">
              <FaMapMarkedAlt />
            </div>
            <h2>MAP & ALERTS</h2>
            <p>Live monitoring & response</p>
            <div className="card-stat">{stats.activeAlerts} Active</div>
            <button className="card-btn">Open →</button>
          </div>

          <div className="dashboard-card" onClick={() => setView('alerts')}>
            <div className="card-icon alert-icon">
              <FaBell />
            </div>
            <h2>ALERT LOGS</h2>
            <p>View alert history</p>
            <div className="card-stat">{stats.alertsToday} Today</div>
            <button className="card-btn">Open →</button>
          </div>

          <div className="dashboard-card" onClick={() => setView('devices')}>
            <div className="card-icon device-icon">
              <FaMobileAlt />
            </div>
            <h2>DEVICE MANAGEMENT</h2>
            <p>Register & manage devices</p>
            <div className="card-stat">{stats.registeredDevices} Devices</div>
            <button className="card-btn">Open →</button>
          </div>
        </div>

        <div className="recent-alerts">
          <h3>Recent Alerts</h3>
          {alerts.length === 0 ? (
            <p className="no-alerts">No recent alerts</p>
          ) : (
            <div className="alert-preview-list">
              {alerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="alert-preview-item" onClick={() => setView('map')}>
                  <div className={`alert-type-badge ${alert.message_type?.toLowerCase()}`}>
                    {alert.message_type?.toLowerCase() === 'emergency' && '🚨'}
                    {alert.message_type?.toLowerCase() === 'high' && '⚠️'}
                    {alert.message_type?.toLowerCase() === 'normal' && 'ℹ️'}
                    {alert.message_type?.toLowerCase() === 'cancel' && '🔵'}
                    {alert.message_type?.toLowerCase() === 'automated' && '🤖'}
                  </div>
                  <div className="alert-preview-info">
                    <strong>{alert.message_type.toUpperCase()}</strong>
                    <span>{alert.device_id}</span>
                  </div>
                  <div className="alert-preview-time">
                    {new Date(alert.received_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OperatorDashboard;

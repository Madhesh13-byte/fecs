import React, { useState, useEffect } from 'react';
import { FaUsers, FaClipboardList, FaSignOutAlt, FaTree, FaArrowLeft, FaMapMarkedAlt } from 'react-icons/fa';
import axios from 'axios';

import UserManagement from './UserManagement';
import AlertLogs from './AlertLogs';
import BaseStationView from './BaseStationView';
import NetworkPlanner from './NetworkPlanner';
import CoverageAnalysis from './CoverageAnalysis'; // ✅ NEW
import RelayCoverageAnalysis from './RelayCoverageAnalysis';

import './AdminDashboard.css';

function AdminDashboard({ onLogout }) {
  const [view, setView] = useState('home');
  const [stats, setStats] = useState({
    totalOperators: 0,
    totalAlerts: 0,
    alertsToday: 0,
    pendingAlerts: 0
  });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('http://localhost:8000/api/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  // =========================
  // 🔥 VIEW SWITCHES
  // =========================

  if (view === 'users') {
    return <UserManagement onBack={() => setView('home')} onStatsUpdate={fetchStats} />;
  }

  if (view === 'logs') {
    return <AlertLogs onBack={() => setView('home')} />;
  }

  if (view === 'planner') {
    return <NetworkPlanner onBack={() => setView('home')} />;
  }

  if (view === 'coverage') {
    return <CoverageAnalysis onBack={() => setView('home')} />; // ✅ NEW
  }

  if (view === 'relay-coverage') {
    return <RelayCoverageAnalysis onBack={() => setView('home')} />;
  }

  if (view === 'stations') {
    return (
      <div className="admin-dashboard">
        <header className="admin-header">
          <div className="admin-title">
            <button className="back-btn" onClick={() => setView('home')}>
              <FaArrowLeft /> Back
            </button>
            <FaTree className="header-icon" />
            <h1>Base Station Management</h1>
          </div>
          <div className="admin-user-info">
            <span className="admin-badge">Admin</span>
            <button className="logout-btn" onClick={onLogout}>
              <FaSignOutAlt /> Logout
            </button>
          </div>
        </header>

        <div className="admin-content">
          <BaseStationView />
        </div>
      </div>
    );
  }

  // =========================
  // 🏠 HOME DASHBOARD
  // =========================

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <div className="admin-title">
          <FaTree className="header-icon" />
          <h1>FECS - Admin Portal</h1>
        </div>
        <div className="admin-user-info">
          <span className="admin-badge">Admin</span>
          <button className="logout-btn" onClick={onLogout}>
            <FaSignOutAlt /> Logout
          </button>
        </div>
      </header>

      <div className="admin-content">
        <div className="dashboard-cards">

          {/* USER MANAGEMENT */}
          <div className="dashboard-card" onClick={() => setView('users')}>
            <div className="card-icon user-icon">
              <FaUsers />
            </div>
            <h2>USER MANAGEMENT</h2>
            <p>Manage team accounts</p>
            <button className="card-btn">Open →</button>
          </div>

          {/* ALERT LOGS */}
          <div className="dashboard-card" onClick={() => setView('logs')}>
            <div className="card-icon logs-icon">
              <FaClipboardList />
            </div>
            <h2>ALERT LOGS</h2>
            <p>View history & audit trail</p>
            <button className="card-btn">Open →</button>
          </div>

          {/* BASE STATIONS */}
          <div className="dashboard-card" onClick={() => setView('stations')}>
            <div className="card-icon station-icon">
              <FaMapMarkedAlt />
            </div>
            <h2>BASE STATIONS</h2>
            <p>View devices by station</p>
            <button className="card-btn">Open →</button>
          </div>

          {/* NETWORK PLANNER */}
          <div className="dashboard-card" onClick={() => setView('planner')}>
            <div className="card-icon" style={{ backgroundColor: '#e3f2fd', color: '#1976d2' }}>
              <FaMapMarkedAlt />
            </div>
            <h2>NETWORK PLANNER</h2>
            <p>Geofence base stations</p>
            <button className="card-btn">Open →</button>
          </div>

          {/* 🔥 NEW: COVERAGE ANALYSIS */}
          <div className="dashboard-card" onClick={() => setView('coverage')}>
            <div className="card-icon" style={{ backgroundColor: '#fdecea', color: '#d32f2f' }}>
              <FaMapMarkedAlt />
            </div>
            <h2>COVERAGE ANALYSIS</h2>
            <p>Detect dead zones</p>
            <button className="card-btn">Open →</button>
          </div>

          <div className="dashboard-card" onClick={() => setView('relay-coverage')}>
            <div className="card-icon" style={{ backgroundColor: '#f3e5f5', color: '#6a1b9a' }}>
              <FaMapMarkedAlt />
            </div>
            <h2>RELAY PLANNER</h2>
            <p>Suggest relays and recalculate coverage</p>
            <button className="card-btn">Open →</button>
          </div>

        </div>

        {/* STATS */}
        <div className="quick-stats">
          <h3>Quick Stats</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Total Operators:</span>
              <span className="stat-value">{stats.totalOperators}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total Alerts:</span>
              <span className="stat-value">{stats.totalAlerts}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Alerts Today:</span>
              <span className="stat-value">{stats.alertsToday}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Pending Alerts:</span>
              <span className="stat-value">{stats.pendingAlerts}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default AdminDashboard;

import React, { useState, useEffect } from 'react';
import { FaArrowLeft, FaSearch, FaDownload } from 'react-icons/fa';
import axios from 'axios';

function AlertLogs({ onBack }) {
  const [alerts, setAlerts] = useState([]);
  const [filteredAlerts, setFilteredAlerts] = useState([]);
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    deviceId: '',
    messageType: '',
    status: ''
  });

  useEffect(() => {
    fetchAlerts();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [alerts, filters]);

  const fetchAlerts = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('http://localhost:8000/api/alerts', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(response.data);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  };

  const applyFilters = () => {
    let filtered = [...alerts];

    if (filters.dateFrom) {
      filtered = filtered.filter(a => new Date(a.event_time) >= new Date(filters.dateFrom));
    }
    if (filters.dateTo) {
      filtered = filtered.filter(a => new Date(a.event_time) <= new Date(filters.dateTo));
    }
    if (filters.deviceId) {
      filtered = filtered.filter(a => a.device_id.toLowerCase().includes(filters.deviceId.toLowerCase()));
    }
    if (filters.messageType) {
      filtered = filtered.filter(a => a.message_type === filters.messageType);
    }
    if (filters.status) {
      filtered = filtered.filter(a => a.status === filters.status);
    }

    setFilteredAlerts(filtered);
  };

  const exportToCSV = () => {
    const headers = ['Time', 'Device ID', 'Type', 'Signal', 'Status', 'Location', 'Notes'];
    const rows = filteredAlerts.map(a => [
      new Date(a.event_time).toLocaleString(),
      a.device_id,
      a.message_type,
      a.signal_type,
      a.status,
      `${a.latitude}, ${a.longitude}`,
      a.notes || ''
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alert_logs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#f57c00';
      case 'acknowledged': return '#1976d2';
      case 'resolved': return '#388e3c';
      default: return '#757575';
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'emergency': return '#c62828';
      case 'warning': return '#f57c00';
      case 'normal': return '#388e3c';
      default: return '#757575';
    }
  };

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <button className="back-btn" onClick={onBack}>
          <FaArrowLeft /> Back to Dashboard
        </button>
        <h1>Alert Logs</h1>
      </header>

      <div className="admin-content">
        <div className="filters-section">
          <div className="filters-grid">
            <div className="filter-item">
              <label>From Date</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>
            <div className="filter-item">
              <label>To Date</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>
            <div className="filter-item">
              <label>Device ID</label>
              <input
                type="text"
                placeholder="Search device..."
                value={filters.deviceId}
                onChange={(e) => setFilters({ ...filters, deviceId: e.target.value })}
              />
            </div>
            <div className="filter-item">
              <label>Type</label>
              <select
                value={filters.messageType}
                onChange={(e) => setFilters({ ...filters, messageType: e.target.value })}
              >
                <option value="">All Types</option>
                <option value="emergency">Emergency</option>
                <option value="warning">Warning</option>
                <option value="normal">Normal</option>
                <option value="cancel">Cancel</option>
              </select>
            </div>
            <div className="filter-item">
              <label>Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="filter-item">
              <button className="export-btn" onClick={exportToCSV}>
                <FaDownload /> Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className="logs-summary">
          <p>Showing {filteredAlerts.length} of {alerts.length} alerts</p>
        </div>

        <div className="alerts-table">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Device ID</th>
                <th>Type</th>
                <th>Signal</th>
                <th>Status</th>
                <th>Location</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr key={alert.id}>
                  <td>{new Date(alert.event_time).toLocaleString()}</td>
                  <td><strong>{alert.device_id}</strong></td>
                  <td>
                    <span
                      className="type-badge"
                      style={{ backgroundColor: getTypeColor(alert.message_type) }}
                    >
                      {alert.message_type}
                    </span>
                  </td>
                  <td>{alert.signal_type}</td>
                  <td>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(alert.status) }}
                    >
                      {alert.status}
                    </span>
                  </td>
                  <td>{alert.latitude.toFixed(4)}, {alert.longitude.toFixed(4)}</td>
                  <td className="notes-cell">{alert.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AlertLogs;
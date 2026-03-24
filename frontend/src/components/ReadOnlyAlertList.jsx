import React, { useState } from 'react';
import { MdExpandMore, MdExpandLess, MdHistory } from 'react-icons/md';
import { FaClipboardList } from 'react-icons/fa';
import './ReadOnlyAlertList.css';

function ReadOnlyAlertList({ alerts, token }) {
  const [expandedDevices, setExpandedDevices] = useState({});
  const [deviceHistory, setDeviceHistory] = useState({});
  const [loadingHistory, setLoadingHistory] = useState({});

  const toggleExpand = async (deviceId) => {
    const isExpanded = expandedDevices[deviceId];
    
    setExpandedDevices({
      ...expandedDevices,
      [deviceId]: !isExpanded
    });

    // Fetch history if expanding and not already loaded
    if (!isExpanded && !deviceHistory[deviceId]) {
      setLoadingHistory({ ...loadingHistory, [deviceId]: true });
      try {
        const response = await fetch(`http://localhost:8000/api/alerts/device/${deviceId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const history = await response.json();
        setDeviceHistory({ ...deviceHistory, [deviceId]: history });
      } catch (error) {
        console.error('Failed to fetch device history:', error);
      } finally {
        setLoadingHistory({ ...loadingHistory, [deviceId]: false });
      }
    }
  };

  const getAlertClass = (messageType) => {
    switch (messageType?.toLowerCase()) {
      case 'emergency': return 'readonly-alert-item emergency';
      case 'high': return 'readonly-alert-item high';
      case 'normal': return 'readonly-alert-item normal';
      case 'automated': return 'readonly-alert-item automated';
      case 'cancel': return 'readonly-alert-item cancel';
      default: return 'readonly-alert-item';
    }
  };

  const getAlertIcon = (messageType) => {
    switch (messageType?.toLowerCase()) {
      case 'emergency': return '🔴';
      case 'high': return '🟠';
      case 'normal': return '🟢';
      case 'cancel': return '🔵';
      case 'automated': return '🤖';
      default: return '⚪';
    }
  };

  const formatTimeAgo = (timestamp) => {
    const now = new Date();
    const alertTime = new Date(timestamp);
    const diffMs = now - alertTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  return (
    <div className="readonly-alert-list">
      <h2>
        <FaClipboardList className="alert-list-icon" />
        Alert History - Registered Personnel ({alerts.length})
      </h2>
      <p className="readonly-note">📋 Read-only view - For viewing alert history and audit trail</p>
      {alerts.length === 0 ? (
        <p className="no-alerts">No alerts to display</p>
      ) : (
        <div className="readonly-alert-cards">
          {alerts.map((alert) => {
            const isExpanded = expandedDevices[alert.device_id];
            const history = deviceHistory[alert.device_id] || [];
            const isLoading = loadingHistory[alert.device_id];

            return (
              <div key={alert.device_id} className="readonly-alert-card-wrapper">
                {/* Main Alert Card */}
                <div className={getAlertClass(alert.message_type)}>
                  <div className="readonly-alert-header" onClick={() => toggleExpand(alert.device_id)}>
                    <div className="readonly-alert-user-info">
                      <span className="alert-icon">{getAlertIcon(alert.message_type)}</span>
                      <div className="user-details">
                        <span className="user-name">
                          {alert.user_name || alert.device_id}
                          {!alert.user_name && (
                            <span className="unregistered-badge">⚠️ Unregistered</span>
                          )}
                        </span>
                        <span className="device-id-small">{alert.device_id}</span>
                      </div>
                    </div>
                    <div className="readonly-alert-meta">
                      <span className="alert-type">{alert.message_type}</span>
                      <span className="alert-time">{formatTimeAgo(alert.received_at)}</span>
                      <span className={`status-badge ${alert.status}`}>{alert.status}</span>
                      {isExpanded ? <MdExpandLess size={24} /> : <MdExpandMore size={24} />}
                    </div>
                  </div>

                  <div className="readonly-alert-body">
                    {alert.user_phone && <p><strong>Phone:</strong> {alert.user_phone}</p>}
                    <p><strong>Location:</strong> {alert.latitude.toFixed(6)}, {alert.longitude.toFixed(6)}</p>
                    <p><strong>Signal:</strong> {alert.signal_type}</p>
                    <p><strong>Time:</strong> {new Date(alert.event_time).toLocaleString()}</p>
                    {alert.notes && <p><strong>Notes:</strong> {alert.notes}</p>}
                  </div>
                </div>

                {/* Expanded History */}
                {isExpanded && (
                  <div className="readonly-alert-history">
                    <div className="history-header">
                      <MdHistory /> Complete Alert History ({history.length} total)
                    </div>
                    {isLoading ? (
                      <p className="loading">Loading history...</p>
                    ) : history.length > 0 ? (
                      <div className="history-timeline">
                        {history.map((histAlert, index) => (
                          <div key={histAlert.id} className={`history-item ${histAlert.message_type?.toLowerCase()}`}>
                            <div className="history-marker">
                              {index === 0 ? '📍' : '•'}
                            </div>
                            <div className="history-content">
                              <div className="history-title">
                                <span className={`hist-type ${histAlert.message_type?.toLowerCase()}`}>
                                  {histAlert.message_type.toUpperCase()}
                                </span>
                                <span className="hist-time">{formatTimeAgo(histAlert.received_at)}</span>
                                <span className={`hist-status ${histAlert.status}`}>{histAlert.status}</span>
                              </div>
                              <div className="history-details">
                                <span>📍 {histAlert.latitude.toFixed(6)}, {histAlert.longitude.toFixed(6)}</span>
                                <span>🕐 {new Date(histAlert.event_time).toLocaleString()}</span>
                                <span>📡 {histAlert.signal_type}</span>
                              </div>
                              {histAlert.notes && (
                                <div className="history-notes">💬 {histAlert.notes}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="no-history">No alert history available</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ReadOnlyAlertList;

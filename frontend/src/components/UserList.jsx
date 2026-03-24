import React from 'react';
import { FiUser, FiPhone, FiMapPin } from 'react-icons/fi';
import './UserList.css';

function UserList({ alerts }) {
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
    <div className="user-list">
      <div className="user-list-header">
        <h3>
          <FiUser /> Personnel Status ({alerts.length})
        </h3>
      </div>
      {alerts.length === 0 ? (
        <p className="no-users">No active personnel</p>
      ) : (
        <div className="user-items">
          {alerts.map((alert) => (
            <div key={alert.device_id} className={`user-item ${alert.message_type?.toLowerCase()}`}>
              <div className="user-item-header">
                <span className="alert-icon">{getAlertIcon(alert.message_type)}</span>
                <div className="user-info">
                  <div className="user-name">
                    {alert.user_name || alert.device_id}
                    {!alert.user_name && (
                      <span className="unregistered-tag">⚠️ Unregistered</span>
                    )}
                  </div>
                  <div className="user-device">{alert.device_id}</div>
                  {alert.user_phone && (
                    <div className="user-phone">
                      <FiPhone size={12} /> {alert.user_phone}
                    </div>
                  )}
                </div>
              </div>
              <div className="user-item-body">
                <div className="alert-info">
                  <span className={`alert-type-badge ${alert.message_type?.toLowerCase()}`}>
                    {alert.message_type.toUpperCase()}
                  </span>
                  <span className={`status-badge ${alert.status}`}>
                    {alert.status}
                  </span>
                </div>
                <div className="alert-time">
                  {formatTimeAgo(alert.received_at)}
                </div>
                <div className="alert-location">
                  <FiMapPin size={12} /> {alert.latitude.toFixed(4)}, {alert.longitude.toFixed(4)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default UserList;

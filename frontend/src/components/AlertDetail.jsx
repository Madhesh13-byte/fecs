import React, { useState } from 'react';
import { updateAlertStatus } from '../services/api';
import { FaCheckCircle, FaCheck } from 'react-icons/fa';
import './AlertDetail.css';

function AlertDetail({ alert, token, onUpdate }) {
  const [notes, setNotes] = useState(alert.notes || '');
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus) => {
    setIsUpdating(true);
    try {
      await updateAlertStatus(alert.id, newStatus, notes, token);
      onUpdate();
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const getAlertClass = () => {
    switch (alert.message_type?.toLowerCase()) {
      case 'emergency': return 'alert-card emergency';
      case 'high': return 'alert-card high';
      case 'normal': return 'alert-card normal';
      case 'automated': return 'alert-card automated';
      case 'cancel': return 'alert-card cancel';
      default: return 'alert-card';
    }
  };

  return (
    <div className={getAlertClass()}>
      <div className="alert-header">
        <span className="device-id">
          {alert.user_name ? (
            <>
              {alert.user_name}
              <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>({alert.device_id})</span>
            </>
          ) : (
            <>
              {alert.device_id}
              <span style={{ fontSize: '11px', color: '#d32f2f', marginLeft: '8px' }}>⚠️ Unregistered</span>
            </>
          )}
        </span>
        <span className={`status-badge ${alert.status}`}>{alert.status}</span>
      </div>
      <div className="alert-body">
        {alert.user_phone && <p><strong>Phone:</strong> {alert.user_phone}</p>}
        <p><strong>Type:</strong> {alert.message_type}</p>
        <p><strong>Signal:</strong> {alert.signal_type}</p>
        <p><strong>Location:</strong> {alert.latitude.toFixed(6)}, {alert.longitude.toFixed(6)}</p>
        <p><strong>Time:</strong> {new Date(alert.event_time).toLocaleString()}</p>
        {alert.notes && <p><strong>Notes:</strong> {alert.notes}</p>}
      </div>
      <div className="alert-actions">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes..."
          rows="2"
        />
        <div className="action-buttons">
          {alert.status === 'pending' && (
            <button
              onClick={() => handleStatusChange('acknowledged')}
              disabled={isUpdating}
              className="btn-acknowledge"
            >
              <FaCheck /> Acknowledge
            </button>
          )}
          {alert.status === 'acknowledged' && (
            <button
              onClick={() => handleStatusChange('resolved')}
              disabled={isUpdating}
              className="btn-resolve"
            >
              <FaCheckCircle /> Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AlertDetail;

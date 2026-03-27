import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

export const login = async (username, password) => {
  const formData = new URLSearchParams();
  formData.append('username', username);
  formData.append('password', password);
  
  const response = await axios.post(`${API_URL}/token`, formData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return response.data;
};

// Normalize alert fields to lowercase so frontend components work consistently
const normalizeAlert = (alert) => ({
  ...alert,
  message_type: alert.message_type ? alert.message_type.toLowerCase() : alert.message_type,
  status: alert.status ? alert.status.toLowerCase() : alert.status,
});

export const getAlerts = async (token) => {
  const response = await axios.get(`${API_URL}/alerts`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data.map(normalizeAlert);
};

export const updateAlertStatus = async (alertId, status, notes, token) => {
  const response = await axios.patch(
    `${API_URL}/alerts/${alertId}/status`,
    { status, notes },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data;
};

export const getCurrentUser = async (token) => {
  const response = await axios.get(`${API_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

// Device Registration APIs
export const getUnmappedDevices = async (token) => {
  const response = await axios.get(`${API_URL}/device-registrations/unmapped`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

export const registerDevice = async (deviceData, token) => {
  const response = await axios.post(`${API_URL}/device-registrations`, deviceData, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

export const getRegisteredDevices = async (token) => {
  const response = await axios.get(`${API_URL}/device-registrations`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

export const updateDeviceRegistration = async (deviceId, deviceData, token) => {
  const response = await axios.put(`${API_URL}/device-registrations/${deviceId}`, deviceData, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

export const deactivateDeviceRegistration = async (deviceId, token) => {
  const response = await axios.patch(`${API_URL}/device-registrations/${deviceId}/deactivate`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

// Base Station APIs
export const getBaseStations = async (token) => {
  const response = await axios.get(`${API_URL}/stations`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

export const createBaseStation = async (stationData, token) => {
  const response = await axios.post(`${API_URL}/stations`, stationData, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

export const getCoverageAnalysis = async (stationId, token, params = {}) => {
  const response = await axios.get(`${API_URL}/coverage/${stationId}`, {
    params,
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

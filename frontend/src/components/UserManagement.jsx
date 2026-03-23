import React, { useState, useEffect } from 'react';
import { FaArrowLeft, FaUserPlus } from 'react-icons/fa';
import axios from 'axios';

function UserManagement({ onBack, onStatsUpdate }) {
  const [users, setUsers] = useState([]);
  const [baseStations, setBaseStations] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [nextEmployeeId, setNextEmployeeId] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'operator',
    employee_id: '',
    assigned_station: ''
  });

  useEffect(() => {
    fetchUsers();
    fetchBaseStations();
  }, []);

  const fetchBaseStations = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('http://localhost:8000/api/stations', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBaseStations(response.data);
    } catch (error) {
      console.error('Error fetching base stations:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('http://localhost:8000/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchNextEmployeeId = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('http://localhost:8000/api/users/next-employee-id', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNextEmployeeId(response.data.next_employee_id);
    } catch (error) {
      console.error('Error fetching next employee ID:', error);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post('http://localhost:8000/api/users', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      alert(`Operator created successfully!\nEmployee ID: ${response.data.employee_id}`);
      
      setShowCreateForm(false);
      setFormData({ username: '', email: '', password: '', role: 'operator', employee_id: '', assigned_station: '' });
      fetchUsers();
      if (onStatsUpdate) onStatsUpdate();
    } catch (error) {
      console.error('Error creating user:', error);
      alert('Failed to create user');
    }
  };

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <button className="back-btn" onClick={onBack}>
          <FaArrowLeft /> Back to Dashboard
        </button>
        <h1>User Management</h1>
      </header>

      <div className="admin-content">
        <div className="section-header">
          <h2>Operators</h2>
          <button className="create-btn" onClick={() => {
            setShowCreateForm(true);
            fetchNextEmployeeId();
          }}>
            <FaUserPlus /> Create New Operator
          </button>
        </div>

        {showCreateForm && (
          <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Create New Operator</h3>
              <form onSubmit={handleCreateUser}>
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Employee ID</label>
                  <input
                    type="text"
                    value={nextEmployeeId}
                    readOnly
                    style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed', color: '#333', fontWeight: '600' }}
                  />
                  <small style={{ color: '#666', fontSize: '0.85rem', display: 'block', marginTop: '0.25rem' }}>
                    This Employee ID will be automatically assigned
                  </small>
                </div>
                <div className="form-group">
                  <label>Assigned Station</label>
                  <select
                    value={formData.assigned_station}
                    onChange={(e) => setFormData({ ...formData, assigned_station: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem', transition: 'border-color 0.2s', backgroundColor: 'white' }}
                  >
                    <option value="">-- Select a Base Station --</option>
                    {baseStations.map(station => (
                        <option key={station.id} value={station.name}>{station.name} (Radius: {station.radius_meters/1000}km)</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                  />
                </div>
                <div className="form-actions">
                  <button type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
                  <button type="submit" className="submit-btn">Create User</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="users-table">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Employee ID</th>
                <th>Station</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.filter(user => user.role !== 'admin').map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.email}</td>
                  <td>{user.employee_id || '-'}</td>
                  <td>{user.assigned_station || '-'}</td>
                  <td><span className={`role-badge ${user.role}`}>{user.role}</span></td>
                  <td>
                    <span className={`status-badge ${user.is_active === 1 ? 'active' : 'inactive'}`}>
                      {user.is_active === 1 ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{new Date(user.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default UserManagement;

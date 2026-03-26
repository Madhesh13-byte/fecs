import React, { useState, useEffect } from "react";
import "./App.css";
import Login from "./components/Login";
import AdminDashboard from "./components/AdminDashboard";
import OperatorDashboard from "./components/OperatorDashboard";
import { getCurrentUser } from "./services/api";

import { BrowserRouter } from "react-router-dom";

function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    if (token) {
      fetchUserRole();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchUserRole = async () => {
    try {
      const userData = await getCurrentUser(token);
      setUserRole(userData.role);
    } catch (error) {
      console.error("Failed to fetch user role:", error);
    }
  };

  const handleLogin = (newToken, userData) => {
    setToken(newToken);
    localStorage.setItem("token", newToken);
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem("token");
  };

  return (
    <BrowserRouter>
      {!token ? (
        <Login onLogin={handleLogin} />
      ) : userRole === "admin" ? (
        <AdminDashboard onLogout={handleLogout} />
      ) : (
        <OperatorDashboard onLogout={handleLogout} />
      )}
    </BrowserRouter>
  );
}

export default App;
from sqlalchemy import Column, Integer, String, Float, DateTime, Enum
from sqlalchemy.sql import func
from app.database import Base
import enum

class MessageType(str, enum.Enum):
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    EMERGENCY = "EMERGENCY"
    CANCEL = "CANCEL"
    AUTOMATED = "AUTOMATED"


class AlertStatus(str, enum.Enum):
    PENDING = "pending"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"

class AckType(str, enum.Enum):
    NONE       = "none"        # CANCEL — no ACK sent
    LED        = "led"         # Standard delivery ACK
    BUZZER_LED = "buzzer_led"  # Stationary AUTOMATED — Buzzer + LED

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    OPERATOR = "operator"

class Alert(Base):
    __tablename__ = "alerts"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    packet_id = Column(String, unique=True, index=True, nullable=False)
    device_id = Column(String, index=True, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    message_type = Column(Enum(MessageType), nullable=False)
    event_time = Column(DateTime, nullable=False)
    received_at = Column(DateTime, server_default=func.now(), nullable=False)
    status = Column(Enum(AlertStatus), default=AlertStatus.PENDING, nullable=False)
    notes = Column(String, nullable=True)
    ack_sent = Column(Enum(AckType), default=AckType.NONE, nullable=True)

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False)
    email = Column(String, nullable=True)
    employee_id = Column(String, unique=True, nullable=True)
    assigned_station = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class DeviceRegistration(Base):
    __tablename__ = "device_registrations"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    phone_number = Column(String, nullable=False)
    registered_by_emp_id = Column(String, nullable=False)
    registered_at = Column(DateTime, server_default=func.now(), nullable=False)
    is_active = Column(Integer, default=1, nullable=False)

class MonitoringStatus(Base):
    __tablename__ = "monitoring_status"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id = Column(String, unique=True, index=True, nullable=False)
    last_auto_alert_time = Column(DateTime, nullable=True)
    last_latitude = Column(Float, nullable=True)
    last_longitude = Column(Float, nullable=True)
    buzzer_sent_at = Column(DateTime, nullable=True)
    last_buzzer_eval_time = Column(DateTime, nullable=True)

class BaseStation(Base):
    __tablename__ = "base_stations"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String, unique=True, index=True, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    radius_meters = Column(Float, default=15000.0, nullable=False)
    is_active = Column(Integer, default=1, nullable=False)


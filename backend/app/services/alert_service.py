from sqlalchemy.orm import Session
from app.models import Alert, MessageType, SignalType, MonitoringStatus, DeviceRegistration
from app.schemas import IncomingAlert
from datetime import datetime, timedelta
from app.config import settings
import math

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two GPS coordinates in meters using Haversine formula"""
    R = 6371000  # Earth's radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c

def is_device_registered(db: Session, device_id: str) -> bool:
    """Check if device is registered"""
    registration = db.query(DeviceRegistration).filter(
        DeviceRegistration.device_id == device_id,
        DeviceRegistration.is_active == 1
    ).first()
    return registration is not None

def is_duplicate(db: Session, alert: IncomingAlert) -> bool:
    """Check if alert is duplicate based on time and distance thresholds"""
    time_threshold = timedelta(seconds=settings.DUPLICATE_TIME_THRESHOLD_SECONDS)
    distance_threshold = settings.DUPLICATE_DISTANCE_THRESHOLD_METERS
    
    # Query recent alerts from same device with same type and signal
    recent_alerts = db.query(Alert).filter(
        Alert.device_id == alert.device_id,
        Alert.message_type == alert.message_type,
        Alert.signal_type == alert.signal_type,
        Alert.event_time >= alert.event_time - time_threshold,
        Alert.event_time <= alert.event_time + time_threshold
    ).all()
    
    for existing_alert in recent_alerts:
        distance = calculate_distance(
            alert.latitude, alert.longitude,
            existing_alert.latitude, existing_alert.longitude
        )
        if distance <= distance_threshold:
            return True
    
    return False

def store_alert(db: Session, alert: IncomingAlert) -> Alert:
    """Store valid alert in database"""
    db_alert = Alert(
        packet_id=alert.packet_id,
        device_id=alert.device_id,
        latitude=alert.latitude,
        longitude=alert.longitude,
        message_type=alert.message_type,
        signal_type=alert.signal_type,
        event_time=alert.event_time,
        source=alert.source
    )
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)
    
    # --- Unconsciousness Tracking ---
    status = db.query(MonitoringStatus).filter(MonitoringStatus.device_id == alert.device_id).first()
    if not status:
        status = MonitoringStatus(device_id=alert.device_id)
        db.add(status)
    
    if alert.signal_type == SignalType.AUTO and alert.message_type == MessageType.NORMAL:
        status.last_auto_alert_time = alert.event_time
        status.last_latitude = alert.latitude
        status.last_longitude = alert.longitude
    elif alert.signal_type == SignalType.MANUAL and alert.message_type == MessageType.NORMAL:
        # User manually responded. Clear any active buzzer countdown.
        status.buzzer_sent_at = None
        
    db.commit()

    return db_alert

def should_send_ack(alert: IncomingAlert) -> bool:
    """Determine if ACK should be sent for this alert"""
    # ACK only for manual alerts (not auto, not cancel)
    if alert.signal_type != SignalType.MANUAL:
        return False
    if alert.message_type == MessageType.CANCEL:
        return False
    return True

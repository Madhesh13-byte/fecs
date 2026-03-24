from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import Alert, User, UserRole, AlertStatus, DeviceRegistration, MessageType
from app.schemas import (
    AlertResponse, UserCreate, UserResponse, Token, AlertStatusUpdate,
    DeviceRegistrationCreate, DeviceRegistrationResponse, UnmappedDevice,
    ManualMessageCreate
)
from app.services.auth_service import (
    verify_password, get_password_hash, create_access_token, verify_token
)

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Authentication dependency
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    token_data = verify_token(token)
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    user = db.query(User).filter(User.username == token_data.username).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

# Admin only dependency
async def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user

# Auth endpoints
@router.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # First, try to find user by employee_id
    user = db.query(User).filter(User.employee_id == form_data.username).first()
    
    # If not found by employee_id, try username (only for admins)
    if not user:
        user = db.query(User).filter(User.username == form_data.username).first()
        # If found by username but user is an operator, reject
        if user and user.role == UserRole.OPERATOR:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Operators must login with Employee ID, not username"
            )
    
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect employee ID or password"
        )
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# User endpoints
@router.post("/users", response_model=UserResponse)
async def create_user(
    user: UserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    existing_user = db.query(User).filter(User.username == user.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Auto-generate employee_id if not provided
    employee_id = user.employee_id
    if not employee_id:
        # Get the highest employee ID number
        last_user = db.query(User).filter(User.employee_id.isnot(None)).order_by(User.id.desc()).first()
        if last_user and last_user.employee_id:
            try:
                # Extract number from format like "EMP001"
                last_num = int(last_user.employee_id.replace('EMP', ''))
                employee_id = f"EMP{str(last_num + 1).zfill(3)}"
            except:
                employee_id = "EMP001"
        else:
            employee_id = "EMP001"
    
    db_user = User(
        username=user.username,
        password_hash=get_password_hash(user.password),
        role=user.role,
        email=user.email,
        employee_id=employee_id,
        assigned_station=user.assigned_station
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.get("/users", response_model=List[UserResponse])
async def get_users(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    return db.query(User).all()

@router.get("/users/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    return current_user

@router.get("/stats")
async def get_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    from datetime import date
    from sqlalchemy import func
    
    total_operators = db.query(User).filter(User.role == UserRole.OPERATOR).count()
    total_alerts = db.query(Alert).count()
    alerts_today = db.query(Alert).filter(
        func.date(Alert.received_at) == date.today()
    ).count()
    pending_alerts = db.query(Alert).filter(Alert.status == AlertStatus.PENDING).count()
    
    return {
        "totalOperators": total_operators,
        "totalAlerts": total_alerts,
        "alertsToday": alerts_today,
        "pendingAlerts": pending_alerts
    }

@router.get("/users/next-employee-id")
async def get_next_employee_id(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    # Get the highest employee ID number
    last_user = db.query(User).filter(User.employee_id.isnot(None)).order_by(User.id.desc()).first()
    if last_user and last_user.employee_id:
        try:
            # Extract number from format like "EMP001"
            last_num = int(last_user.employee_id.replace('EMP', ''))
            next_id = f"EMP{str(last_num + 1).zfill(3)}"
        except:
            next_id = "EMP001"
    else:
        next_id = "EMP001"
    
    return {"next_employee_id": next_id}

# Alert endpoints
@router.get("/alerts", response_model=List[AlertResponse])
async def get_alerts(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from sqlalchemy import outerjoin, func
    
    # For operators: Show only latest alert per registered device from their station
    if current_user.role == UserRole.OPERATOR and current_user.assigned_station:
        # Get all employee_ids from same station
        station_operators = db.query(User.employee_id).filter(
            User.assigned_station == current_user.assigned_station,
            User.employee_id.isnot(None)
        ).all()
        station_emp_ids = [op[0] for op in station_operators]
        
        if not station_emp_ids:
            return []
        
        # Get device_ids registered by operators from same station
        station_device_ids = db.query(DeviceRegistration.device_id).filter(
            DeviceRegistration.registered_by_emp_id.in_(station_emp_ids),
            DeviceRegistration.is_active == 1
        ).all()
        station_device_ids = [d[0] for d in station_device_ids]
        
        if not station_device_ids:
            return []
        
        # Get latest alert ID for each device
        subquery = db.query(
            Alert.device_id,
            func.max(Alert.id).label('max_id')
        ).filter(
            Alert.device_id.in_(station_device_ids)
        ).group_by(Alert.device_id).subquery()
        
        # Join to get full alert details with user info
        results = db.query(
            Alert,
            DeviceRegistration.name,
            DeviceRegistration.phone_number
        ).join(
            subquery,
            (Alert.device_id == subquery.c.device_id) & (Alert.id == subquery.c.max_id)
        ).outerjoin(
            DeviceRegistration,
            (Alert.device_id == DeviceRegistration.device_id) & (DeviceRegistration.is_active == 1)
        ).order_by(Alert.received_at.desc()).all()
    else:
        # For admins: Show all alerts (existing behavior)
        results = db.query(
            Alert,
            DeviceRegistration.name,
            DeviceRegistration.phone_number
        ).outerjoin(
            DeviceRegistration,
            (Alert.device_id == DeviceRegistration.device_id) & (DeviceRegistration.is_active == 1)
        ).order_by(Alert.received_at.desc()).offset(skip).limit(limit).all()
    
    # Build response with user info
    alerts = []
    for alert, user_name, user_phone in results:
        alert_dict = {
            "id": alert.id,
            "packet_id": alert.packet_id,
            "device_id": alert.device_id,
            "latitude": alert.latitude,
            "longitude": alert.longitude,
            "message_type": alert.message_type,
            "event_time": alert.event_time,
            "received_at": alert.received_at,
            "status": alert.status,
            "notes": alert.notes,
            "user_name": user_name,
            "user_phone": user_phone
        }
        alerts.append(alert_dict)
    
    return alerts

@router.get("/alerts/device/{device_id}", response_model=List[AlertResponse])
async def get_device_alert_history(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all alert history for a specific device"""
    from sqlalchemy import outerjoin
    
    # Get all alerts for this device with user info
    results = db.query(
        Alert,
        DeviceRegistration.name,
        DeviceRegistration.phone_number
    ).outerjoin(
        DeviceRegistration,
        (Alert.device_id == DeviceRegistration.device_id) & (DeviceRegistration.is_active == 1)
    ).filter(
        Alert.device_id == device_id
    ).order_by(Alert.received_at.desc()).all()
    
    # Build response
    alerts = []
    for alert, user_name, user_phone in results:
        alert_dict = {
            "id": alert.id,
            "packet_id": alert.packet_id,
            "device_id": alert.device_id,
            "latitude": alert.latitude,
            "longitude": alert.longitude,
            "message_type": alert.message_type,
            "event_time": alert.event_time,
            "received_at": alert.received_at,
            "status": alert.status,
            "notes": alert.notes,
            "user_name": user_name,
            "user_phone": user_phone
        }
        alerts.append(alert_dict)
    
    return alerts

@router.get("/alerts/{alert_id}", response_model=AlertResponse)
async def get_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Join with device_registrations to get user info
    result = db.query(
        Alert,
        DeviceRegistration.name,
        DeviceRegistration.phone_number
    ).outerjoin(
        DeviceRegistration,
        (Alert.device_id == DeviceRegistration.device_id) & (DeviceRegistration.is_active == 1)
    ).filter(Alert.id == alert_id).first()
    
    if not result:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert, user_name, user_phone = result
    
    return {
        "id": alert.id,
        "packet_id": alert.packet_id,
        "device_id": alert.device_id,
        "latitude": alert.latitude,
        "longitude": alert.longitude,
        "message_type": alert.message_type,
        "event_time": alert.event_time,
        "received_at": alert.received_at,
        "status": alert.status,
        "notes": alert.notes,
        "user_name": user_name,
        "user_phone": user_phone
    }

@router.patch("/alerts/{alert_id}/status")
async def update_alert_status(
    alert_id: int,
    status_update: AlertStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert.status = status_update.status
    if status_update.notes:
        alert.notes = status_update.notes
    
    db.commit()
    db.refresh(alert)
    return {"message": "Alert status updated", "alert": alert}

# Device Registration endpoints
@router.get("/device-registrations/unmapped", response_model=List[UnmappedDevice])
async def get_unmapped_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get devices that sent normal alerts but are not registered"""
    from sqlalchemy import func
    
    # Get all registered device IDs
    registered_ids = db.query(DeviceRegistration.device_id).filter(
        DeviceRegistration.is_active == 1
    ).all()
    registered_ids = [r[0] for r in registered_ids]
    
    # Get latest normal alert for each unregistered device
    subquery = db.query(
        Alert.device_id,
        func.max(Alert.id).label('max_id')
    ).filter(
        Alert.message_type == MessageType.NORMAL,
        ~Alert.device_id.in_(registered_ids) if registered_ids else True
    ).group_by(Alert.device_id).subquery()
    
    unmapped = db.query(Alert).join(
        subquery,
        (Alert.device_id == subquery.c.device_id) & (Alert.id == subquery.c.max_id)
    ).all()
    
    return [
        UnmappedDevice(
            device_id=alert.device_id,
            last_latitude=alert.latitude,
            last_longitude=alert.longitude,
            last_event_time=alert.event_time
        )
        for alert in unmapped
    ]

@router.post("/device-registrations", response_model=DeviceRegistrationResponse)
async def register_device(
    registration: DeviceRegistrationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Register a device to a user"""
    # Check if device already registered
    existing = db.query(DeviceRegistration).filter(
        DeviceRegistration.device_id == registration.device_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Device already registered")
    
    # Create registration
    db_registration = DeviceRegistration(
        device_id=registration.device_id,
        name=registration.name,
        phone_number=registration.phone_number,
        registered_by_emp_id=current_user.employee_id or current_user.username
    )
    db.add(db_registration)
    db.commit()
    db.refresh(db_registration)
    return db_registration

@router.get("/device-registrations", response_model=List[DeviceRegistrationResponse])
async def get_registered_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all registered devices (filtered by station for operators)"""
    query = db.query(DeviceRegistration).filter(
        DeviceRegistration.is_active == 1
    )
    
    # If operator, filter by their assigned station
    if current_user.role == UserRole.OPERATOR and current_user.assigned_station:
        # Get all employee_ids from same station
        station_operators = db.query(User.employee_id).filter(
            User.assigned_station == current_user.assigned_station,
            User.employee_id.isnot(None)
        ).all()
        station_emp_ids = [op[0] for op in station_operators]
        
        # Filter devices registered by operators from same station
        if station_emp_ids:
            query = query.filter(DeviceRegistration.registered_by_emp_id.in_(station_emp_ids))
        else:
            # No operators in this station, return empty
            return []
    
    return query.order_by(DeviceRegistration.registered_at.desc()).all()

@router.put("/device-registrations/{device_id}")
async def update_device_registration(
    device_id: str,
    registration: DeviceRegistrationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update device registration"""
    db_registration = db.query(DeviceRegistration).filter(
        DeviceRegistration.device_id == device_id
    ).first()
    if not db_registration:
        raise HTTPException(status_code=404, detail="Device registration not found")
    
    db_registration.name = registration.name
    db_registration.phone_number = registration.phone_number
    db.commit()
    db.refresh(db_registration)
    return {"message": "Device registration updated", "registration": db_registration}

@router.patch("/device-registrations/{device_id}/deactivate")
async def deactivate_device_registration(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Deactivate device registration"""
    db_registration = db.query(DeviceRegistration).filter(
        DeviceRegistration.device_id == device_id
    ).first()
    if not db_registration:
        raise HTTPException(status_code=404, detail="Device registration not found")
    
    db_registration.is_active = 0
    db.commit()
    return {"message": "Device registration deactivated"}

# Base Station Management endpoints
@router.get("/base-stations/devices")
async def get_devices_by_station(
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    """Get all devices grouped by base station"""
    # Join device_registrations with users to get assigned_station
    results = db.query(
        DeviceRegistration.device_id,
        DeviceRegistration.name,
        DeviceRegistration.phone_number,
        DeviceRegistration.registered_by_emp_id,
        DeviceRegistration.registered_at,
        User.assigned_station
    ).join(
        User,
        DeviceRegistration.registered_by_emp_id == User.employee_id
    ).filter(
        DeviceRegistration.is_active == 1
    ).all()
    
    # Group by station
    station_data = {}
    for result in results:
        station = result.assigned_station or "Unassigned"
        if station not in station_data:
            station_data[station] = []
        
        station_data[station].append({
            "device_id": result.device_id,
            "name": result.name,
            "phone_number": result.phone_number,
            "registered_by_emp_id": result.registered_by_emp_id,
            "registered_at": result.registered_at.isoformat()
        })
    
    return station_data

# Manual Message Sending endpoint
@router.post("/messages/send")
async def send_manual_message(
    message: ManualMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Send manual message (high, emergency, cancel) to a device"""
    from app.mqtt_handler import mqtt_handler
    from app.services.ack_service import publish_buzzer_ack
    from datetime import datetime
    import uuid
    
    # Validate device is registered
    device_reg = db.query(DeviceRegistration).filter(
        DeviceRegistration.device_id == message.device_id,
        DeviceRegistration.is_active == 1
    ).first()
    
    if not device_reg:
        raise HTTPException(status_code=404, detail="Device not registered")
    
    # Validate message type (only high, emergency, cancel allowed)
    if message.message_type == MessageType.NORMAL:
        raise HTTPException(status_code=400, detail="NORMAL messages are sent by hardware only")
    
    # Create alert record
    from app.models import Alert, AlertStatus
    packet_id = f"MAN_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:6]}"
    
    alert = Alert(
        packet_id=packet_id,
        device_id=message.device_id,
        latitude=message.latitude,
        longitude=message.longitude,
        message_type=message.message_type,
        event_time=datetime.utcnow(),
        status=AlertStatus.PENDING
    )
    
    db.add(alert)
    db.commit()
    db.refresh(alert)
    
    # Send buzzer ACK to device via MQTT
    if mqtt_handler.client:
        await publish_buzzer_ack(message.device_id, mqtt_handler.client)
    
    return {
        "message": "Manual message sent successfully",
        "alert_id": alert.id,
        "packet_id": packet_id
    }

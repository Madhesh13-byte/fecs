from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional, Union
from app.models import MessageType, AlertStatus, UserRole, AckType

class IncomingAlert(BaseModel):
    packet_id: str
    device_id: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    message_type: MessageType
    event_time: Union[datetime, str, int]
    
    @field_validator('device_id')
    def device_id_not_empty(cls, v):
        if not v or v.strip() == "":
            raise ValueError('device_id must not be empty')
        return v
    
    @field_validator('event_time')
    def parse_event_time(cls, v):
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            # Try Unix timestamp first
            try:
                return datetime.fromtimestamp(int(v))
            except (ValueError, OverflowError):
                # Try ISO format
                return datetime.fromisoformat(v.replace('Z', '+00:00'))
        if isinstance(v, int):
            return datetime.fromtimestamp(v)
        raise ValueError('Invalid event_time format')

class AlertResponse(BaseModel):
    id: int
    packet_id: str
    device_id: str
    latitude: float
    longitude: float
    message_type: MessageType
    event_time: datetime
    received_at: datetime
    status: AlertStatus
    notes: Optional[str] = None
    ack_sent: Optional[AckType] = None
    user_name: Optional[str] = None
    user_phone: Optional[str] = None
    
    class Config:
        from_attributes = True

class AckMessage(BaseModel):
    device_id: str
    ack_type: str = "delivery_ack"
    for_packet_id: str
    timestamp: datetime

class UserCreate(BaseModel):
    username: str
    password: str
    role: UserRole
    email: Optional[str] = None
    employee_id: Optional[str] = None
    assigned_station: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    role: UserRole
    email: Optional[str]
    employee_id: Optional[str]
    assigned_station: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class AlertStatusUpdate(BaseModel):
    status: AlertStatus
    notes: Optional[str] = None



class DeviceRegistrationCreate(BaseModel):
    device_id: str
    name: str
    phone_number: str

class DeviceRegistrationResponse(BaseModel):
    id: int
    device_id: str
    name: str
    phone_number: str
    registered_by_emp_id: str
    registered_at: datetime
    is_active: bool
    
    class Config:
        from_attributes = True

class UnmappedDevice(BaseModel):
    device_id: str
    last_latitude: float
    last_longitude: float
    last_event_time: datetime

class BaseStationCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    radius_meters: float

class BaseStationResponse(BaseModel):
    id: int
    name: str
    latitude: float
    longitude: float
    radius_meters: float
    is_active: bool
    
    class Config:
        from_attributes = True

class BaseStationUpdate(BaseModel):
    name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meters: Optional[float] = None
    is_active: Optional[bool] = None

class ManualMessageCreate(BaseModel):
    device_id: str
    message_type: MessageType
    latitude: float
    longitude: float

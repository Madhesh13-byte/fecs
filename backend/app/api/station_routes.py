from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models import BaseStation, User, UserRole
from app.schemas import BaseStationCreate, BaseStationResponse, BaseStationUpdate
from app.api.routes import get_current_user, get_admin_user

router = APIRouter(prefix="/stations", tags=["Base Stations"])

@router.post("", response_model=BaseStationResponse)
def create_base_station(
    station_in: BaseStationCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    
    existing = db.query(BaseStation).filter(BaseStation.name == station_in.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Station with this name already exists")
        
    new_station = BaseStation(
        name=station_in.name,
        latitude=station_in.latitude,
        longitude=station_in.longitude,
        radius_meters=station_in.radius_meters
    )
    db.add(new_station)
    db.commit()
    db.refresh(new_station)
    return new_station

@router.get("", response_model=List[BaseStationResponse])
def get_base_stations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Admins and Operators can see base stations (operators need it for map bounds)
    return db.query(BaseStation).filter(BaseStation.is_active == 1).all()

@router.get("/{station_id}", response_model=BaseStationResponse)
def get_base_station(
    station_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    station = db.query(BaseStation).filter(BaseStation.id == station_id).first()
    if not station:
        raise HTTPException(status_code=404, detail="Base station not found")
    return station

@router.patch("/{station_id}", response_model=BaseStationResponse)
def update_base_station(
    station_id: int,
    station_in: BaseStationUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user)
):
    
    station = db.query(BaseStation).filter(BaseStation.id == station_id).first()
    if not station:
        raise HTTPException(status_code=404, detail="Base station not found")
        
    update_data = station_in.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(station, key, value)
        
    db.commit()
    db.refresh(station)
    return station

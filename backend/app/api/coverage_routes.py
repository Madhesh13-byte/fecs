from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes import get_current_user
from app.database import get_db
from app.models import BaseStation, User
from app.services.coverage_service import (
    generate_coverage_grid,
    optimize_relays_for_target,
    recalculate_coverage_with_relays,
    suggest_relays,
)


coverage_router = APIRouter(prefix="/coverage", tags=["Coverage"])


@coverage_router.get("/{station_id}")
def get_station_coverage(
    station_id: int,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    relay_target: str = "moderate",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    station = (
        db.query(BaseStation)
        .filter(BaseStation.id == station_id, BaseStation.is_active == 1)
        .first()
    )
    if not station:
        raise HTTPException(status_code=404, detail="Base station not found")

    analysis_lat = lat if lat is not None else station.latitude
    analysis_lng = lng if lng is not None else station.longitude

    grid = generate_coverage_grid(
        lat=analysis_lat,
        lng=analysis_lng,
        radius=station.radius_meters,
    )
    relays = suggest_relays(grid)
    improved_grid = recalculate_coverage_with_relays(grid, relays, station.radius_meters)
    optimized_plan = optimize_relays_for_target(
        grid,
        station.radius_meters,
        target=relay_target if relay_target in {"moderate", "strong"} else "moderate",
    )

    return {
        "grid": grid,
        "relays": relays,
        "improved_grid": improved_grid,
        "optimized_relays": optimized_plan["relays"],
        "optimized_grid": optimized_plan["grid"],
        "relay_target": optimized_plan["target"],
        "relay_threshold": optimized_plan["threshold"],
        "relay_target_met": optimized_plan["target_met"],
        "relay_remaining_cells": optimized_plan["remaining_cells"],
        "analysis_center": {"lat": analysis_lat, "lng": analysis_lng},
    }

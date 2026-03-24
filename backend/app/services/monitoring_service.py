import asyncio
import logging
from datetime import datetime
from app.database import SessionLocal
from app.models import MonitoringStatus, Alert, MessageType
from app.services.ack_service import publish_buzzer_ack
from app.services.alert_service import calculate_distance, store_alert
from app.schemas import IncomingAlert
import json

logger = logging.getLogger(__name__)

class MonitoringService:
    def __init__(self):
        self.mqtt_handler = None
        self.websocket_manager = None

    def set_websocket_manager(self, manager):
        self.websocket_manager = manager

    def set_mqtt_handler(self, handler):
        self.mqtt_handler = handler

    async def run(self):
        """Background task running every 60 seconds"""
        while True:
            await asyncio.sleep(60)
            try:
                await self.check_unconsciousness()
            except Exception as e:
                logger.error(f"Monitoring logic error: {e}")

    async def check_unconsciousness(self):
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            
            # Step 1: Check for devices exceeding 60 secs after buzzer
            active_buzzer_statuses = db.query(MonitoringStatus).filter(
                MonitoringStatus.buzzer_sent_at.isnot(None)
            ).all()
            
            for status in active_buzzer_statuses:
                if (now - status.buzzer_sent_at).total_seconds() > 60:
                    logger.warning(f"Device {status.device_id} is unconscious. Triggering Emergency!")
                    
                    # Create internal emergency alert
                    packet_id = f"EMG_{int(now.timestamp())}"
                    emergency_data = {
                        "packet_id": packet_id,
                        "device_id": status.device_id,
                        "latitude": status.last_latitude or 0.0,
                        "longitude": status.last_longitude or 0.0,
                        "message_type": "emergency",
                        "event_time": now.isoformat()
                    }
                    alert_schema = IncomingAlert(**emergency_data)
                    new_alert = store_alert(db, alert_schema)
                    
                    # Clear buzzer tracking so we don't trigger it again
                    status.buzzer_sent_at = None
                    db.commit()
                    
                    # Push to WS
                    if self.websocket_manager:
                        await self.websocket_manager.broadcast(json.dumps({
                            "type": "new_alert",
                            "data": {
                                "id": new_alert.id,
                                "packet_id": new_alert.packet_id,
                                "device_id": new_alert.device_id,
                                "latitude": new_alert.latitude,
                                "longitude": new_alert.longitude,
                                "message_type": new_alert.message_type.value,
                                "event_time": new_alert.event_time.isoformat(),
                                "received_at": new_alert.received_at.isoformat(),
                                "status": new_alert.status.value
                            }
                        }))

            # Step 2: Sweep for stationary auto-alerts
            statuses = db.query(MonitoringStatus).filter(MonitoringStatus.buzzer_sent_at.is_(None)).all()
            for status in statuses:
                auto_alerts = db.query(Alert).filter(
                    Alert.device_id == status.device_id,
                    Alert.message_type == MessageType.NORMAL
                ).order_by(Alert.event_time.desc()).limit(2).all()
                
                if len(auto_alerts) == 2:
                    
                    # Prevent evaluating the same auto-alert twice (avoids infinite buzzer loops if user responds)
                    if status.last_buzzer_eval_time == auto_alerts[0].event_time:
                        continue
                        
                    dist = calculate_distance(
                        auto_alerts[0].latitude, auto_alerts[0].longitude,
                        auto_alerts[1].latitude, auto_alerts[1].longitude
                    )
                    time_diff = abs((auto_alerts[0].event_time - auto_alerts[1].event_time).total_seconds())
                    
                    # If roughly 2 hours (~7100s to allow drift) and dist < 10m
                    if time_diff >= 7100 and dist < 10.0:
                        logger.info(f"Triggering buzzer for {status.device_id} (Stationary)")
                        if self.mqtt_handler and self.mqtt_handler.client:
                            await publish_buzzer_ack(status.device_id, self.mqtt_handler.client)
                            
                        status.buzzer_sent_at = now
                        status.last_buzzer_eval_time = auto_alerts[0].event_time
                        db.commit()

        finally:
            db.close()

monitoring_service = MonitoringService()

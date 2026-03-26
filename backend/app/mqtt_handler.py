import asyncio
import aiomqtt
import json
import logging
from app.config import settings
from app.schemas import IncomingAlert
from app.models import MessageType, AckType
from app.database import SessionLocal
from app.services.alert_service import is_duplicate, store_alert, is_device_registered, check_automated_stationarity
from app.services.ack_service import publish_ack, publish_buzzer_ack

logger = logging.getLogger(__name__)

class MQTTHandler:
    def __init__(self):
        self.client = None
        self.websocket_manager = None
    
    def set_websocket_manager(self, manager):
        self.websocket_manager = manager
    
    async def process_incoming_alert(self, message: str):
        """Process incoming alert from MQTT"""
        try:
            # Parse pipe-delimited format: packet_id|device_id|lat|lon|msg_type|timestamp|checksum
            # Hardware devices send location pings with message types
            message = message.strip()
            if not (message.startswith('<') and message.endswith('>')):
                logger.warning(f"Rejected unframed message: {message}")
                return
            message = message[1:-1]
            parts = message.split('|')
            
            if len(parts) < 6:
                logger.error(f"Invalid message format: {message}")
                return
            
            msg_type_map = {'N': 'NORMAL', 'H': 'HIGH', 'E': 'EMERGENCY', 'C': 'CANCEL', 'A': 'AUTOMATED'}
            
            data = {
                'packet_id': parts[0],
                'device_id': parts[1],
                'latitude': float(parts[2]),
                'longitude': float(parts[3]),
                'message_type': msg_type_map.get(parts[4], 'normal'),
                'event_time': parts[5],    # Unix timestamp
            }
            
            alert = IncomingAlert(**data)
            logger.info(
                f"[INCOMING] packet_id={alert.packet_id} device={alert.device_id} "
                f"type={alert.message_type.value} lat={alert.latitude} lon={alert.longitude}"
            )

            db = SessionLocal()
            try:
                # Security check: Only accept NORMAL alerts from unregistered devices
                from app.services.alert_service import is_device_registered
                is_registered = is_device_registered(db, alert.device_id)
                
                if not is_registered and alert.message_type != 'NORMAL':
                    logger.warning(
                        f"Rejected {alert.message_type} alert from unregistered device: {alert.device_id}. "
                        f"Only NORMAL alerts accepted from unregistered devices."
                    )
                    return
                
                # Check for duplicate
                if is_duplicate(db, alert):
                    logger.info(f"Duplicate alert discarded: {alert.packet_id}")
                    return
                
                # Store alert
                stored_alert = store_alert(db, alert)
                logger.info(f"Alert stored: {stored_alert.id}")

                # AUTOMATED stationarity check: two AUTOMATED alerts within 2h, moved < 10m → Buzzer ACK
                ack_sent = AckType.NONE
                if alert.message_type != MessageType.CANCEL and is_registered:
                    buzzer_fired = False
                    if alert.message_type == MessageType.AUTOMATED:
                        if check_automated_stationarity(db, alert) and self.client:
                            await publish_buzzer_ack(alert.device_id, self.client)
                            buzzer_fired = True
                            logger.info(
                                f"Buzzer ACK sent: device {alert.device_id} stationary "
                                f"(< 10m movement in last 2h)"
                            )

                    # LED ACK for all registered non-cancel types
                    if self.client:
                        await publish_ack(alert, self.client)
                        logger.info(f"Automatic delivery ACK sent for registered device: {alert.device_id}")

                    ack_sent = AckType.BUZZER_LED if buzzer_fired else AckType.LED

                # Persist ack_sent to the alert row
                stored_alert.ack_sent = ack_sent
                db.commit()
                db.refresh(stored_alert)
                
                # Get user info if device is registered
                from app.models import DeviceRegistration
                device_reg = db.query(DeviceRegistration).filter(
                    DeviceRegistration.device_id == alert.device_id,
                    DeviceRegistration.is_active == 1
                ).first()
                
                user_name = device_reg.name if device_reg else None
                user_phone = device_reg.phone_number if device_reg else None
                

                
                # Push to WebSocket clients
                if self.websocket_manager:
                    await self.websocket_manager.broadcast(json.dumps({
                        "type": "new_alert",
                        "data": {
                            "id": stored_alert.id,
                            "packet_id": stored_alert.packet_id,
                            "device_id": stored_alert.device_id,
                            "latitude": stored_alert.latitude,
                            "longitude": stored_alert.longitude,
                            "message_type": stored_alert.message_type.value,
                            "event_time": stored_alert.event_time.isoformat(),
                            "received_at": stored_alert.received_at.isoformat(),
                            "status": stored_alert.status.value,
                            "user_name": user_name,
                            "user_phone": user_phone
                        }
                    }))
                
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"Error processing alert: {e}")
    
    async def start(self):
        """Start MQTT subscriber"""
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=settings.MQTT_BROKER_HOST,
                    port=settings.MQTT_BROKER_PORT
                ) as client:
                    self.client = client
                    await client.subscribe(settings.MQTT_INCOMING_TOPIC)
                    logger.info(f"Subscribed to {settings.MQTT_INCOMING_TOPIC}")
                    
                    async for message in client.messages:
                        await self.process_incoming_alert(message.payload.decode())
                        
            except aiomqtt.MqttError as e:
                logger.error(f"MQTT connection error: {e}. Reconnecting in 5 seconds...")
                await asyncio.sleep(5)

mqtt_handler = MQTTHandler()

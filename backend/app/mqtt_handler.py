import asyncio
import aiomqtt
import json
import logging
from app.config import settings
from app.schemas import IncomingAlert
from app.database import SessionLocal
from app.services.alert_service import is_duplicate, store_alert, is_device_registered
from app.services.ack_service import publish_ack

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
            # Parse pipe-delimited format: packet_id|device_id|lat|lon|msg_type|sig_type|timestamp|source|checksum
            parts = message.strip().split('|')
            
            if len(parts) < 8:
                logger.error(f"Invalid message format: {message}")
                return
            
            # Map single-char codes to full values
            msg_type_map = {'N': 'normal', 'H': 'high', 'E': 'emergency', 'C': 'cancel'}
            sig_type_map = {'M': 'manual', 'A': 'auto'}
            source_map = {'1': 'hardware', '0': 'software'}
            
            data = {
                'packet_id': parts[0],
                'device_id': parts[1],
                'latitude': float(parts[2]),
                'longitude': float(parts[3]),
                'message_type': msg_type_map.get(parts[4], 'emergency'),
                'signal_type': sig_type_map.get(parts[5], 'manual'),
                'event_time': parts[6],  # Unix timestamp
                'source': source_map.get(parts[7], 'hardware')
            }
            
            alert = IncomingAlert(**data)
            
            db = SessionLocal()
            try:
                # Security check: Only accept NORMAL alerts from unregistered devices
                from app.services.alert_service import is_device_registered
                is_registered = is_device_registered(db, alert.device_id)
                
                if not is_registered and alert.message_type != 'normal':
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
                
                # Send automatic delivery ACK to base station for registered devices with manual signal type
                if is_registered and alert.signal_type == 'manual' and self.client:
                    await publish_ack(alert, self.client)
                    logger.info(f"Automatic delivery ACK sent for registered device: {alert.device_id}, signal: manual")
                
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
                            "signal_type": stored_alert.signal_type.value,
                            "event_time": stored_alert.event_time.isoformat(),
                            "received_at": stored_alert.received_at.isoformat(),
                            "status": stored_alert.status.value,
                            "source": stored_alert.source,
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

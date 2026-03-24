import aiomqtt
from app.schemas import AckMessage, IncomingAlert
from app.config import settings
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)

async def publish_ack(alert: IncomingAlert, mqtt_client: aiomqtt.Client):
    """Publish ACK message to MQTT broker (LED Blink)"""
    payload = f"{alert.packet_id}|{alert.device_id}|L"
    
    try:
        await mqtt_client.publish(
            settings.MQTT_ACK_TOPIC,
            payload=payload
        )
        logger.info(f"[LED ACK] Sent to device={alert.device_id} for packet_id={alert.packet_id}")
    except Exception as e:
        logger.error(f"Failed to publish ACK: {e}")

async def publish_buzzer_ack(device_id: str, mqtt_client: aiomqtt.Client):
    """Publish Buzzer ACK message to trigger alarm"""
    packet_id = f"ACK_{int(datetime.utcnow().timestamp())}"
    payload = f"{packet_id}|{device_id}|B"
    
    try:
        await mqtt_client.publish(
            settings.MQTT_ACK_TOPIC,
            payload=payload
        )
        logger.info(f"[BUZZER ACK] Sent to device={device_id} packet_id={packet_id}")
    except Exception as e:
        logger.error(f"Failed to publish Buzzer ACK: {e}")

import aiomqtt
from app.schemas import IncomingAlert
from app.config import settings
import logging

logger = logging.getLogger(__name__)

_led_counter = 0
_buzzer_counter = 0

def _led_packet_id() -> str:
    global _led_counter
    _led_counter += 1
    return f"L{_led_counter:05d}"

def _buzzer_packet_id() -> str:
    global _buzzer_counter
    _buzzer_counter += 1
    return f"B{_buzzer_counter:05d}"

async def publish_ack(alert: IncomingAlert, mqtt_client: aiomqtt.Client):
    packet_id = _led_packet_id()
    payload = f"<{packet_id}|{alert.device_id}|L>"
    try:
        await mqtt_client.publish(settings.MQTT_ACK_TOPIC, payload=payload)
        logger.info(f"[LED ACK] {payload}")
    except Exception as e:
        logger.error(f"Failed to publish LED ACK: {e}")

async def publish_buzzer_ack(device_id: str, mqtt_client: aiomqtt.Client):
    packet_id = _buzzer_packet_id()
    payload = f"<{packet_id}|{device_id}|B>"
    try:
        await mqtt_client.publish(settings.MQTT_ACK_TOPIC, payload=payload)
        logger.info(f"[BUZZER ACK] {payload}")
    except Exception as e:
        logger.error(f"Failed to publish Buzzer ACK: {e}")

# Forest Emergency Communication System (FECS)

The Forest Emergency Communication System is a full-stack platform designed to process, log, and respond to emergency signals from remote field hardware using MQTT, PostgreSQL, FastAPI, and React.

## MQTT Communication Protocol

The system communicates with field devices using the MQTT protocol. The backend subscribes to incoming alerts and automatically publishes hardware acknowledgments (ACKs) based on specific rules.

### 1. Receiving Alerts (Device to Server)
- **Topic:** `fecs/incoming`
- **Format:** Pipe-delimited (`|`) string.
- **Payload Structure:** 
  `packet_id|device_id|latitude|longitude|message_type|unix_timestamp|checksum`

**Message Types (`message_type` codes):**
| Code | Type | Description |
|---|---|---|
| `N` | **NORMAL** | Standard periodic location update or generic ping. |
| `H` | **HIGH** | Elevated alert requiring attention. |
| `E` | **EMERGENCY** | Critical SOS alert requiring immediate operator response. |
| `C` | **CANCEL** | Cancels a previous alert (no ACK is sent). |
| `A` | **AUTOMATED** | Hardware health check or automated state ping. |

*Example Payload:*
```text
EMG_001|DEV_401|10.9300|78.1200|E|1743000000|CHK1
```

### 2. Sending Acknowledgments (Server to Device)
Whenever the server successfully processes a valid alert (except `CANCEL`), it immediately publishes an ACK back to the hardware so the device knows the message was delivered.

- **Topic:** `fecs/ack`
- **Format:** Pipe-delimited (`|`) string.
- **Payload Structure:** 
  `packet_id|device_id|ack_type`

**ACK Types (`ack_type` codes):**
| Code | Type | Description |
|---|---|---|
| `L` | **LED ACK** | Standard delivery confirmation. Tells the device to blink its LED. |
| `B` | **BUZZER ACK** | Actionable confirmation. Triggered specifically when the server detects that the device is stationary (has sent two `AUTOMATED` alerts within 2 hours while moving less than 10 meters). Tells the device to sound its buzzer. |

*Example Payloads:*
```text
# Standard LED ACK responding to an EMERGENCY alert:
EMG_001|DEV_401|L

# Automated Buzzer ACK indicating stationarity:
ACK_1743001234|DEV_401|B
```

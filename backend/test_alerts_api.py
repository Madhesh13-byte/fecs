"""
Test the /api/alerts endpoint to verify it returns user info
Run this from backend directory: python test_alerts_api.py
"""
import sys
sys.path.append('.')

from app.database import SessionLocal
from app.models import Alert, DeviceRegistration

db = SessionLocal()

print("=" * 60)
print("TESTING ALERTS API QUERY")
print("=" * 60)
print()

# Simulate the exact query from routes.py
results = db.query(
    Alert,
    DeviceRegistration.name,
    DeviceRegistration.phone_number
).outerjoin(
    DeviceRegistration,
    (Alert.device_id == DeviceRegistration.device_id) & (DeviceRegistration.is_active == 1)
).order_by(Alert.received_at.desc()).limit(10).all()

print(f"Found {len(results)} alerts")
print()

for alert, user_name, user_phone in results:
    print(f"Alert ID: {alert.id}")
    print(f"  Device ID: {alert.device_id}")
    print(f"  User Name: {user_name if user_name else '❌ None'}")
    print(f"  User Phone: {user_phone if user_phone else '❌ None'}")
    print(f"  Message Type: {alert.message_type.value}")
    print(f"  Time: {alert.received_at}")
    print()

db.close()

print("=" * 60)
print("If user_name shows '❌ None' for registered devices,")
print("there's a problem with the JOIN query.")
print("=" * 60)

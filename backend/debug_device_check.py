"""
Debug script to check device registrations
Run this from backend directory: python debug_device_check.py
"""
import sys
sys.path.append('.')

from app.database import SessionLocal
from app.models import DeviceRegistration, Alert

db = SessionLocal()

print("=" * 60)
print("DEVICE REGISTRATION DEBUG")
print("=" * 60)
print()

# Check all device registrations
print("📋 ALL DEVICE REGISTRATIONS:")
print("-" * 60)
registrations = db.query(DeviceRegistration).all()
if registrations:
    for reg in registrations:
        print(f"Device ID: '{reg.device_id}'")
        print(f"  Name: {reg.name}")
        print(f"  Phone: {reg.phone_number}")
        print(f"  Active: {reg.is_active}")
        print(f"  Registered by: {reg.registered_by_emp_id}")
        print(f"  Device ID length: {len(reg.device_id)} chars")
        print(f"  Device ID repr: {repr(reg.device_id)}")
        print()
else:
    print("❌ No device registrations found!")
    print()

# Check recent alerts
print("📡 RECENT ALERTS (last 10):")
print("-" * 60)
alerts = db.query(Alert).order_by(Alert.received_at.desc()).limit(10).all()
if alerts:
    for alert in alerts:
        # Check if device is registered
        reg = db.query(DeviceRegistration).filter(
            DeviceRegistration.device_id == alert.device_id,
            DeviceRegistration.is_active == 1
        ).first()
        
        status = "✅ REGISTERED" if reg else "❌ UNREGISTERED"
        print(f"Device ID: '{alert.device_id}' - {status}")
        print(f"  Alert ID: {alert.id}")
        print(f"  Type: {alert.message_type.value}")
        print(f"  Time: {alert.received_at}")
        print(f"  Device ID length: {len(alert.device_id)} chars")
        print(f"  Device ID repr: {repr(alert.device_id)}")
        if reg:
            print(f"  ✅ Matched with: {reg.name} ({reg.phone_number})")
        print()
else:
    print("❌ No alerts found!")
    print()

# Check for case sensitivity issues
print("🔍 CHECKING FOR CASE SENSITIVITY ISSUES:")
print("-" * 60)
alert_device_ids = db.query(Alert.device_id).distinct().all()
reg_device_ids = db.query(DeviceRegistration.device_id).all()

alert_ids = [a[0] for a in alert_device_ids]
reg_ids = [r[0] for r in reg_device_ids]

for alert_id in alert_ids:
    for reg_id in reg_ids:
        if alert_id.lower() == reg_id.lower() and alert_id != reg_id:
            print(f"⚠️  CASE MISMATCH FOUND:")
            print(f"   Alert has: '{alert_id}'")
            print(f"   Registration has: '{reg_id}'")
            print()

db.close()
print("=" * 60)
print("Debug complete!")
print("=" * 60)

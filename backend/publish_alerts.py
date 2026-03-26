import random
import time
import subprocess
import requests

API = "http://localhost:8000"
BROKER = "localhost"
PORT = "1883"
TOPIC = "test/incoming"
MQTT_PUB = r"C:\Program Files\Mosquitto\mosquitto_pub.exe"

# Login
username = input("Enter employee ID or username: ")
password = input("Enter password: ")

res = requests.post(f"{API}/token", data={"username": username, "password": password})
if res.status_code != 200:
    print("Login failed:", res.text)
    exit(1)
token = res.json()["access_token"]

# Fetch base stations
stations = requests.get(f"{API}/api/stations", headers={"Authorization": f"Bearer {token}"}).json()
if not stations:
    print("No base stations found. Deploy one first.")
    exit(1)

print("\nAvailable Base Stations:")
for i, s in enumerate(stations):
    print(f"  [{i+1}] {s['name']}  ({s['latitude']}, {s['longitude']})  radius={s['radius_meters']/1000}km")

choice = int(input("\nPick a station number: ")) - 1
station = stations[choice]

# Random device ID and coordinates within station radius
device_id = f"DEV_{random.randint(100, 999)}"
radius_deg = (station["radius_meters"] / 1000) / 111  # ~111km per degree
lat = round(station["latitude"] + random.uniform(-radius_deg, radius_deg), 6)
lon = round(station["longitude"] + random.uniform(-radius_deg, radius_deg), 6)
ts = int(time.time())

packet_id = f"PKT_{ts}_{random.randint(1000,9999)}"
payload = f"{packet_id}|{device_id}|{lat}|{lon}|N|{ts}|CHK0"

print(f"\nPublishing NORMAL alert:")
print(f"  Device ID : {device_id}")
print(f"  Location  : {lat}, {lon}")
print(f"  Station   : {station['name']}")
print(f"  Payload   : {payload}\n")

result = subprocess.run([MQTT_PUB, "-h", BROKER, "-p", PORT, "-t", TOPIC, "-m", payload])
if result.returncode == 0:
    print(f"Published! Device '{device_id}' will now appear in unmapped devices for registration.")
else:
    print("Failed to publish. Is Mosquitto running?")

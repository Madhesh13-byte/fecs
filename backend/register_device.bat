@echo off
setlocal

set API=http://localhost:8000
set MQTT_PUB="C:\Program Files\Mosquitto\mosquitto_pub.exe"
set BROKER=localhost
set PORT=1883
set TOPIC=test/incoming

echo ============================================
echo   FECS Device Registration Tool
echo ============================================
echo.

set /p USERNAME=Enter your username or employee ID: 
set /p PASSWORD=Enter your password: 
echo.

echo [1/4] Authenticating...
for /f "delims=" %%T in ('curl -s -X POST "%API%/token" -H "Content-Type: application/x-www-form-urlencoded" -d "username=%USERNAME%&password=%PASSWORD%" ^| python -c "import sys,json; d=json.load(sys.stdin); print(d.get(\"access_token\",\"\"))"') do set TOKEN=%%T

if "%TOKEN%"=="" (
    echo ERROR: Login failed. Check your credentials.
    pause & exit /b 1
)
echo Login successful.
echo.

set /p DEVICE_ID=Enter Device ID (e.g. DEV_401): 
set /p NAME=Enter operator name: 
set /p PHONE=Enter phone number: 
set /p LAT=Enter latitude (e.g. 10.9300): 
set /p LON=Enter longitude (e.g. 78.1200): 
echo.

set TIMESTAMP=%TIME: =0%
set PACKET_ID=REG_%RANDOM%

echo [2/4] Publishing NORMAL alert via MQTT to make device visible...
%MQTT_PUB% -h %BROKER% -p %PORT% -t %TOPIC% -m "<%PACKET_ID%|%DEVICE_ID%|%LAT%|%LON%|N|1743000000|CHK0>"
if errorlevel 1 (
    echo ERROR: Failed to publish MQTT message. Is the broker running?
    pause & exit /b 1
)
echo MQTT alert published.
echo.

echo [3/4] Registering device via API...
for /f "delims=" %%R in ('curl -s -o NUL -w "%%{http_code}" -X POST "%API%/device-registrations" -H "Authorization: Bearer %TOKEN%" -H "Content-Type: application/json" -d "{\"device_id\":\"%DEVICE_ID%\",\"name\":\"%NAME%\",\"phone_number\":\"%PHONE%\"}"') do set HTTP_CODE=%%R

if "%HTTP_CODE%"=="200" (
    echo [4/4] Device registered successfully!
) else if "%HTTP_CODE%"=="400" (
    echo WARNING: Device already registered ^(HTTP 400^).
) else (
    echo ERROR: Registration failed with HTTP %HTTP_CODE%.
    pause & exit /b 1
)

echo.
echo ============================================
echo  Device ID : %DEVICE_ID%
echo  Name      : %NAME%
echo  Phone     : %PHONE%
echo ============================================
echo.
pause
endlocal

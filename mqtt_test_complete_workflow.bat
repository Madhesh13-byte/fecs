@echo off
echo ========================================
echo FECS - Complete End-to-End Test
echo User Registration and Alert Workflow
echo ========================================
echo.
echo This test simulates a complete user journey:
echo 1. New device sends Normal alert (registration)
echo 2. Operator registers device
echo 3. Device sends various alerts
echo 4. System sends ACK for manual alerts
echo 5. Verify everything works
echo.
echo SETUP REQUIRED:
echo ========================================
echo.
echo Terminal 1: Backend server running
echo Terminal 2: Frontend running
echo Terminal 3: Run this script
echo Terminal 4: mosquitto_sub -h localhost -t fecs/ack -v
echo.
pause
echo.

echo ========================================
echo PHASE 1: Device Registration
echo ========================================
echo.
echo Scenario: New forest worker "Alex Kumar" gets device DEV_401
echo Device sends first Normal alert to register itself
echo.
pause
echo.

echo [1] DEV_401 sends NORMAL alert (First contact - Unregistered)
mosquitto_pub -h localhost -t fecs/incoming -m "e2e001|DEV_401|10.9300|78.1200|N|M|1705315800|1|A1B1"
echo.
echo Expected:
echo   - Alert stored in database
echo   - NO ACK sent (device not registered yet)
echo   - DEV_401 appears in "Unmapped Devices" list
echo.
echo ACTION REQUIRED:
echo ========================================
echo Go to your dashboard:
echo 1. Click "Device Management"
echo 2. Find DEV_401 in unmapped devices
echo 3. Register with:
echo    - Name: Alex Kumar
echo    - Phone: 9876543210
echo 4. Click "Register Device"
echo.
echo Press any key AFTER you have registered DEV_401...
pause
echo.

echo ========================================
echo PHASE 2: Post-Registration Alerts
echo ========================================
echo.
echo Now DEV_401 is registered to "Alex Kumar"
echo Testing various alert types with ACK verification
echo.
pause
echo.

echo [2] Alex Kumar sends MANUAL NORMAL alert (Routine check-in)
mosquitto_pub -h localhost -t fecs/incoming -m "e2e002|DEV_401|10.9310|78.1210|N|M|1705315810|1|A2B2"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - ACK SENT: e2e002^|DEV_401^|L
echo   - Map shows: AK-401 (Green marker)
echo.

echo [3] Alex Kumar sends AUTO NORMAL alert (Automatic check-in)
mosquitto_pub -h localhost -t fecs/incoming -m "e2e003|DEV_401|10.9320|78.1220|N|A|1705315820|1|A3B3"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - NO ACK sent (auto signal)
echo   - Map updates position
echo.

echo [4] Alex Kumar sends MANUAL HIGH alert (Warning situation)
mosquitto_pub -h localhost -t fecs/incoming -m "e2e004|DEV_401|10.9330|78.1230|H|M|1705315830|1|A4B4"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - ACK SENT: e2e004^|DEV_401^|L
echo   - Map shows: AK-401 (Orange marker)
echo.

echo [5] Alex Kumar sends MANUAL EMERGENCY alert (Critical situation!)
mosquitto_pub -h localhost -t fecs/incoming -m "e2e005|DEV_401|10.9340|78.1240|E|M|1705315840|1|A5B5"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - ACK SENT: e2e005^|DEV_401^|L
echo   - Map shows: AK-401 (Red marker)
echo   - Operator should respond immediately!
echo.

echo [6] Alex Kumar sends AUTO EMERGENCY alert (Device detected fall)
mosquitto_pub -h localhost -t fecs/incoming -m "e2e006|DEV_401|10.9350|78.1250|E|A|1705315850|1|A6B6"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - NO ACK sent (auto signal)
echo   - Map shows: AK-401 (Red marker)
echo.

echo [7] Alex Kumar sends MANUAL NORMAL alert (Situation resolved)
mosquitto_pub -h localhost -t fecs/incoming -m "e2e007|DEV_401|10.9360|78.1260|N|M|1705315860|1|A7B7"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - ACK SENT: e2e007^|DEV_401^|L
echo   - Map shows: AK-401 (Green marker - back to normal)
echo.

echo ========================================
echo PHASE 3: Testing with Another User
echo ========================================
echo.
echo Testing with already registered device DEV_301
echo.
pause
echo.

echo [8] DEV_301 sends MANUAL EMERGENCY alert
mosquitto_pub -h localhost -t fecs/incoming -m "e2e008|DEV_301|10.9370|78.1270|E|M|1705315870|1|A8B8"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - ACK SENT: e2e008^|DEV_301^|L
echo   - Map shows: [Initials]-301 (Red marker)
echo.

echo [9] DEV_301 sends AUTO NORMAL alert
mosquitto_pub -h localhost -t fecs/incoming -m "e2e009|DEV_301|10.9380|78.1280|N|A|1705315880|1|A9B9"
timeout /t 2 /nobreak >nul
echo.
echo Expected:
echo   - Alert stored
echo   - NO ACK sent (auto signal)
echo   - Map updates position
echo.

echo ========================================
echo Test Complete!
echo ========================================
echo.
echo VERIFICATION CHECKLIST:
echo ========================================
echo.
echo 1. MQTT ACK SUBSCRIBER (Terminal 4):
echo    Should show 4 ACK messages:
echo    ✅ fecs/ack e2e002^|DEV_401^|L
echo    ✅ fecs/ack e2e004^|DEV_401^|L
echo    ✅ fecs/ack e2e005^|DEV_401^|L
echo    ✅ fecs/ack e2e007^|DEV_401^|L
echo    ✅ fecs/ack e2e008^|DEV_301^|L
echo.
echo 2. BACKEND LOGS:
echo    ✅ 9 alerts stored (e2e001 to e2e009)
echo    ✅ 5 ACK sent messages (for manual alerts only)
echo    ✅ No errors
echo.
echo 3. FRONTEND MAP:
echo    ✅ Shows AK-401 marker (Alex Kumar)
echo    ✅ Shows [Initials]-301 marker
echo    ✅ Latest position for each user
echo    ✅ Correct colors (Green for both after last alerts)
echo.
echo 4. USER LIST (Right side):
echo    ✅ Shows "Alex Kumar" with DEV_401
echo    ✅ Shows latest alert info
echo    ✅ Phone number: 9876543210
echo.
echo 5. ALERT LOGS:
echo    ✅ Click "Alex Kumar" card
echo    ✅ Expand to see 7 alerts (e2e001 to e2e007)
echo    ✅ Timeline shows progression:
echo       Normal → Normal → Auto Normal → High → Emergency → Auto Emergency → Normal
echo.
echo 6. DATABASE:
echo    ✅ DEV_401 registered in device_registrations table
echo    ✅ All 9 alerts in alerts table
echo    ✅ User info linked correctly
echo.
echo ========================================
echo SUMMARY OF ACK BEHAVIOR:
echo ========================================
echo.
echo ACK SENT (5 total):
echo   ✅ e2e002 - Manual Normal (registered)
echo   ✅ e2e004 - Manual High (registered)
echo   ✅ e2e005 - Manual Emergency (registered)
echo   ✅ e2e007 - Manual Normal (registered)
echo   ✅ e2e008 - Manual Emergency (registered)
echo.
echo NO ACK SENT (4 total):
echo   ❌ e2e001 - Manual Normal (NOT registered yet)
echo   ❌ e2e003 - Auto Normal (auto signal)
echo   ❌ e2e006 - Auto Emergency (auto signal)
echo   ❌ e2e009 - Auto Normal (auto signal)
echo.
echo ========================================
echo KEY LEARNINGS:
echo ========================================
echo.
echo 1. Unregistered devices can send Normal alerts
echo 2. After registration, device can send any alert type
echo 3. ACK only sent for MANUAL alerts from REGISTERED devices
echo 4. Auto signals never get ACK (they're automatic check-ins)
echo 5. Map shows latest position with user name
echo 6. Alert history preserved for audit trail
echo.
pause

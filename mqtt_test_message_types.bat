@echo off
echo ========================================
echo FECS - Message Type Test
echo Tests all 5 message types via MQTT
echo ========================================
echo.
echo Format: packet_id^|device_id^|lat^|lon^|type^|timestamp^|checksum
echo.
echo Make sure:
echo   - Backend is running (uvicorn)
echo   - mosquitto_pub is available in PATH
echo.
pause

echo.
echo [1] NORMAL (N) - Routine location ping
mosquitto_pub -h localhost -t fecs/incoming -m "TEST001|DEV_401|10.9300|78.1200|N|1742868000|CHK1"
timeout /t 1 /nobreak >nul
echo     Sent: TEST001 - NORMAL
echo.

echo [2] HIGH (H) - Warning situation
mosquitto_pub -h localhost -t fecs/incoming -m "TEST002|DEV_401|10.9310|78.1210|H|1742868010|CHK2"
timeout /t 1 /nobreak >nul
echo     Sent: TEST002 - HIGH
echo.

echo [3] EMERGENCY (E) - Critical situation
mosquitto_pub -h localhost -t fecs/incoming -m "TEST003|DEV_401|10.9320|78.1220|E|1742868020|CHK3"
timeout /t 1 /nobreak >nul
echo     Sent: TEST003 - EMERGENCY
echo.

echo [4] CANCEL (C) - Situation resolved
mosquitto_pub -h localhost -t fecs/incoming -m "TEST004|DEV_401|10.9330|78.1230|C|1742868030|CHK4"
timeout /t 1 /nobreak >nul
echo     Sent: TEST004 - CANCEL
echo.

echo [5] AUTOMATED (A) - System auto-generated
mosquitto_pub -h localhost -t fecs/incoming -m "TEST005|DEV_401|10.9340|78.1240|A|1742868040|CHK5"
timeout /t 1 /nobreak >nul
echo     Sent: TEST005 - AUTOMATED
echo.

echo ========================================
echo All 5 message types sent!
echo ========================================
echo.
echo Check your backend logs for:
echo   "Alert stored:" for each message
echo.
echo Check the dashboard for:
echo   - Normal    (green  marker, no icon)
echo   - High      (orange marker)
echo   - Emergency (red    marker)
echo   - Cancel    (blue   marker)
echo   - Automated (purple marker, robot icon)
echo.
pause

@echo off
echo ========================================
echo FECS MQTT ACK Subscriber
echo Monitoring fecs/ack topic
echo ========================================
echo.
echo Listening for ACK messages on topic: fecs/ack
echo Press Ctrl+C to stop
echo.
echo ACK Message Format: packet_id^|device_id^|ack_type
echo   L = LED Blink (delivery confirmation)
echo   B = Buzzer Alert (unconsciousness detection)
echo.
echo ----------------------------------------
mosquitto_sub -h localhost -t fecs/ack -v

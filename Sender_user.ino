#include <SPI.h>
#include <LoRa.h>

// ---------------- BUTTON ----------------
const int buttonPin = 4;

// ---------------- LED ----------------
const int ledPin = 25;

// ---------------- BUZZER ----------------
const int buzzerPin = 26;

// ---------------- LORA PINS ----------------
#define SS    5
#define RST   14
#define DIO0  2

// ---------------- BASE LOCATION ----------------
const float baseLat = 12.9692;
const float baseLon = 79.1559;

// ---------------- MESSAGE DATA ----------------
String deviceId = "DEV_101";
String latitude = "12.9692";
String longitude = "79.1559";

// ---------------- PACKET ID ----------------
int packetCounter = 1;
String lastSentPacketId = "";

// ---------------- TIMESTAMP ----------------
unsigned long timestampCounter = 1743000000;
const unsigned long timestampStep = 7200;   // 2 hours

// ---------------- AUTO SEND ----------------
unsigned long lastAutoSendTime = 0;
const unsigned long autoSendInterval = 10000;

// ---------------- NEW LOGIC ----------------
int sendCycleCount = 0;
float fixedLat = baseLat;
float fixedLon = baseLon;

// ---------------- BUTTON TIMING ----------------
unsigned long pressStartTime = 0;
unsigned long lastReleaseTime = 0;

bool buttonPressed = false;
bool holdTriggered = false;

int clickCount = 0;

const unsigned long debounceDelay = 50;
const unsigned long multiClickDelay = 500;
const unsigned long holdTime = 3000;

unsigned long lastDebounceTime = 0;
int lastButtonReading = HIGH;
int stableButtonState = HIGH;

// =====================================================

void setup() {
  Serial.begin(115200);

  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  pinMode(buzzerPin, OUTPUT);

  digitalWrite(ledPin, LOW);
  digitalWrite(buzzerPin, LOW);

  LoRa.setPins(SS, RST, DIO0);

  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa init failed!");
    while (true);
  }

  randomSeed(analogRead(34));

  Serial.println("LoRa ready");
}

// =====================================================

void loop() {
  handleButton();
  checkAcknowledgment();
  handleAutoSend();

  if (clickCount > 0 && (millis() - lastReleaseTime > multiClickDelay)) {
    if (clickCount == 1) sendMessage('N');
    else if (clickCount == 2) sendMessage('H');
    else if (clickCount == 3) sendMessage('E');

    clickCount = 0;
  }
}

// =====================================================

void handleAutoSend() {
  if (millis() - lastAutoSendTime >= autoSendInterval) {
    lastAutoSendTime = millis();
    sendMessage('A');
  }
}

// =====================================================

void handleButton() {
  int reading = digitalRead(buttonPin);

  if (reading != lastButtonReading) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != stableButtonState) {
      stableButtonState = reading;

      if (stableButtonState == LOW) {
        pressStartTime = millis();
        buttonPressed = true;
        holdTriggered = false;
      }
      else if (stableButtonState == HIGH && buttonPressed) {
        buttonPressed = false;

        if (!holdTriggered) {
          clickCount++;
          lastReleaseTime = millis();
        }
      }
    }
  }

  lastButtonReading = reading;

  if (buttonPressed && !holdTriggered) {
    if (millis() - pressStartTime >= holdTime) {
      sendMessage('C');
      holdTriggered = true;
      clickCount = 0;
    }
  }
}

// =====================================================

void sendMessage(char statusChar) {
  updateLocationPattern();   // 🔥 updated logic

  String msg = buildMessage(statusChar);

  Serial.print("Sending: ");
  Serial.println(msg);

  LoRa.beginPacket();
  LoRa.print(msg);
  LoRa.endPacket();

  packetCounter++;
  if (packetCounter > 999) packetCounter = 1;

  timestampCounter += timestampStep;
}

// =====================================================

void updateLocationPattern() {

  if (sendCycleCount < 4) {
    // RANDOM MOVEMENT
    long latRand = random(-50, 51);
    long lonRand = random(-50, 51);

    float latValue = baseLat + (latRand / 10000.0);
    float lonValue = baseLon + (lonRand / 10000.0);

    latitude = String(latValue, 4);
    longitude = String(lonValue, 4);

    // Save 4th point
    if (sendCycleCount == 3) {
      fixedLat = latValue;
      fixedLon = lonValue;
    }

    Serial.println("RANDOM LOCATION");

  } else {
    // FIXED LOCATION (simulate unconscious)
    latitude = String(fixedLat, 4);
    longitude = String(fixedLon, 4);

    Serial.println("FIXED LOCATION (Stationary)");
  }

  sendCycleCount++;

  if (sendCycleCount > 4) {
    sendCycleCount = 0;
  }

  Serial.print("Cycle: ");
  Serial.println(sendCycleCount);
}

// =====================================================

String buildMessage(char statusChar) {
  String packetId = "PKT_";

  if (packetCounter < 10) packetId += "00";
  else if (packetCounter < 100) packetId += "0";

  packetId += String(packetCounter);
  lastSentPacketId = packetId;

  String msg = "<";
  msg += packetId + "|" + deviceId + "|";
  msg += latitude + "|" + longitude + "|";
  msg += String(statusChar) + "|";
  msg += String(getTimestamp()) + "|CHK0>";
  
  return msg;
}

// =====================================================

unsigned long getTimestamp() {
  return timestampCounter;
}

// =====================================================

void checkAcknowledgment() {
  int packetSize = LoRa.parsePacket();

  if (packetSize) {
    String ackMsg = "";

    while (LoRa.available()) {
      ackMsg += (char)LoRa.read();
    }

    ackMsg.trim();

    Serial.print("Received ACK: ");
    Serial.println(ackMsg);

    processAck(ackMsg);
  }
}

// =====================================================

void processAck(String ackMsg) {
  if (ackMsg.startsWith("<") && ackMsg.endsWith(">")) {
    ackMsg = ackMsg.substring(1, ackMsg.length() - 1);
  } else {
    Serial.println("Invalid ACK format");
    return;
  }

  int firstSep = ackMsg.indexOf('|');
  int secondSep = ackMsg.indexOf('|', firstSep + 1);

  if (firstSep == -1 || secondSep == -1) {
    Serial.println("Invalid ACK format");
    return;
  }

  String ackDeviceId = ackMsg.substring(firstSep + 1, secondSep);
  String ackType = ackMsg.substring(secondSep + 1);

  if (ackDeviceId != deviceId) {
    Serial.println("Wrong device ACK");
    return;
  }

  if (ackType == "L") {
    Serial.println("LED ACK");
    blinkLed(2, 200);
  }
  else if (ackType == "B") {
    Serial.println("BUZZER ACK");
    beepBuzzer(2, 150);
  }
}

// =====================================================

void blinkLed(int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(ledPin, HIGH);
    delay(delayMs);
    digitalWrite(ledPin, LOW);
    delay(delayMs);
  }
}

void beepBuzzer(int times, int delayMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(buzzerPin, HIGH);
    delay(delayMs);
    digitalWrite(buzzerPin, LOW);
    delay(delayMs);
  }
}
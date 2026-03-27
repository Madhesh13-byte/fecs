#include <WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <LoRa.h>

// ===== WiFi =====
const char* WIFI_SSID = "Mahi's";
const char* WIFI_PASS = "8122978383";

// ===== MQTT =====
const char* MQTT_BROKER    = "10.187.85.40";
const int   MQTT_PORT      = 1883;
const char* MQTT_TOPIC_IN  = "fecs/incoming";
const char* MQTT_TOPIC_ACK = "fecs/ack";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// ===== LoRa Pins =====
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 26

#define LORA_FREQ 433E6

void mqttCallback(char* topic, byte* payload, unsigned int length);

// ================= WIFI =================
void connectWiFi() {
  Serial.printf("[WIFI] Connecting to %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n[WIFI] Connected");
  Serial.println(WiFi.localIP());
}

// ================= MQTT =================
void connectMQTT() {
  while (!mqttClient.connected()) {
    String clientId = "ESP32_LORA_RX_" + String((uint32_t)ESP.getEfuseMac(), HEX);

    Serial.printf("[MQTT] Connecting...\n");

    if (mqttClient.connect(clientId.c_str())) {
      Serial.println("[MQTT] Connected");

      mqttClient.subscribe(MQTT_TOPIC_ACK);
    } else {
      Serial.printf("[MQTT] Failed rc=%d\n", mqttClient.state());
      delay(2000);
    }
  }
}

// ===== MQTT → LoRa (ACK send) =====
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";

  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }

  Serial.println("[MQTT] ACK Received: " + msg);

  if (String(topic) == MQTT_TOPIC_ACK) {
    LoRa.beginPacket();
    LoRa.print(msg);
    LoRa.endPacket();

    Serial.println("[LORA] ACK Sent");
  }
}

// ================= LORA =================
void setupLoRa() {
  Serial.println("[LORA] Initializing...");

  // ❌ REMOVED SPI.begin(...) (this was your bug)

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("[LORA] Failed!");
    while (1);
  }

  // ✅ Match sender config
  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);

  Serial.println("[LORA] Ready");
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n[BOOT] Receiver Ready");

  connectWiFi();

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  connectMQTT();

  setupLoRa();
}

// ================= LOOP =================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    connectMQTT();
  }

  mqttClient.loop();

  // ===== RECEIVE LORA =====
  int packetSize = LoRa.parsePacket();

  if (packetSize) {
    String received = "";

    while (LoRa.available()) {
      received += (char)LoRa.read();
    }

    received.trim();

    Serial.println("[LORA] RX: " + received);

    // ===== ACCEPT ONLY <...> FORMAT =====
    if (!(received.startsWith("<") && received.endsWith(">"))) {
      Serial.println("[LORA] Invalid packet format, ignored");
      return;
    }

    // ===== SEND TO MQTT =====
    if (mqttClient.publish(MQTT_TOPIC_IN, received.c_str())) {
      Serial.println("[MQTT] Publish OK");
    } else {
      Serial.println("[MQTT] Publish FAIL");
    }
  }
}
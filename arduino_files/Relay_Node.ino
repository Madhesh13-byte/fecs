#include <SPI.h>
#include <LoRa.h>

#define SS   5
#define RST  14
#define DIO0 26

String lastPacket = "";

void setup() {
  Serial.begin(115200);

  LoRa.setPins(SS, RST, DIO0);

  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa init failed!");
    while (1);
  }

  Serial.println("Relay Node Ready...");
}

void loop() {

  int packetSize = LoRa.parsePacket();

  if (packetSize) {

    String received = "";

    while (LoRa.available()) {
      received += (char)LoRa.read();
    }

    received.trim();

    Serial.println("\n[RELAY] RX RAW: " + received);

    // ===== VALIDATE FRAME =====
    if (!(received.startsWith("<") && received.endsWith(">"))) {
      Serial.println("[RELAY] Invalid format → ignored");
      return;
    }

    // Remove < >
    String packet = received.substring(1, received.length() - 1);

    // ===== DUPLICATE CHECK =====
    if (packet == lastPacket) {
      Serial.println("[RELAY] Duplicate → ignored");
      return;
    }

    lastPacket = packet;

    // ===== IDENTIFY TYPE =====
    bool isData = packet.startsWith("PKT_");
    bool isAck  = packet.startsWith("L") || packet.startsWith("B");

    if (!isData && !isAck) {
      Serial.println("[RELAY] Unknown packet → ignored");
      return;
    }

    // ===== EXTRA VALIDATION =====
    if (!validatePacket(packet)) {
      Serial.println("[RELAY] Format error → ignored");
      return;
    }

    // ===== FORWARD =====
    forwardPacket(packet);
  }
}

// ================= VALIDATION =================
bool validatePacket(String pkt) {

  int count = 0;
  for (int i = 0; i < pkt.length(); i++) {
    if (pkt[i] == '|') count++;
  }

  // Data packet should have 6 separators
  if (pkt.startsWith("PKT_") && count == 6) {
    return true;
  }

  // ACK should have 2 separators
  if ((pkt.startsWith("L") || pkt.startsWith("B")) && count == 2) {
    return true;
  }

  return false;
}

// ================= FORWARD =================
void forwardPacket(String msg) {

  String framed = "<" + msg + ">";

  Serial.println("[RELAY] Forwarding: " + framed);

  LoRa.beginPacket();
  LoRa.print(framed);
  LoRa.endPacket();

  delay(50);
}
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <time.h>

// === CONFIGURATION ===
const char* ssid = "Gihanga";
const char* password = "muribo01";
const uint32_t WIFI_TIMEOUT_MS = 30000;

// === MQTT CONFIGURATION ===
const char* mqtt_server = "157.173.101.159";
const uint16_t MQTT_PORT = 1883;
const char* team_id = "the_rock";

// === MQTT TOPICS ===
String topic_status = "rfid/" + String(team_id) + "/card/status";
String topic_balance = "rfid/" + String(team_id) + "/card/balance";
String topic_topup = "rfid/" + String(team_id) + "/card/topup";
String topic_pay = "rfid/" + String(team_id) + "/card/pay";

#define RST_PIN D1
#define SS_PIN D2

MFRC522 mfrc522(SS_PIN, RST_PIN);
WiFiClient espClient;
PubSubClient client(espClient);

// --- Time Functions ---
void sync_time() {
  Serial.print("[DEBUG] Syncing time...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  time_t now = time(nullptr);
  while (now < 8 * 3600 * 2) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println("\n[DEBUG] Time synchronized");
}

unsigned long get_unix_time() {
  return (unsigned long)time(nullptr);
}

// --- WiFi Setup ---
void setup_wifi() {
  delay(10);
  Serial.print("\n[DEBUG] Connecting to ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  unsigned long start_attempt_ms = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start_attempt_ms > WIFI_TIMEOUT_MS) {
      Serial.println("\n[ERROR] WiFi timeout! Restarting...");
      ESP.restart();
    }
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n[DEBUG] WiFi connected");
  Serial.print("[DEBUG] IP: ");
  Serial.println(WiFi.localIP());
}

// --- MQTT Callback ---
void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("[MQTT] Message arrived [");
  Serial.print(topic);
  Serial.println("]");

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.println("[ERROR] Failed to parse JSON");
    return;
  }

  const char* uid = doc["uid"] | doc["card_uid"];
  float newBalance = doc["newBalance"] | 0;

  // Acknowledge the update
  StaticJsonDocument<200> responseDoc;
  responseDoc["uid"] = uid;
  responseDoc["new_balance"] = newBalance;
  responseDoc["status"] = "success";
  responseDoc["ts"] = get_unix_time();

  char buffer[200];
  serializeJson(responseDoc, buffer);
  client.publish(topic_balance.c_str(), buffer);

  Serial.println("[DEBUG] Balance updated for " + String(uid) + " to " + String(newBalance));
}

// --- MQTT Reconnect ---
void reconnect() {
  while (!client.connected()) {
    Serial.print("[MQTT] Attempting connection...");
    String clientId = "EmeraldHub_" + String(ESP.getChipId(), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");
      client.subscribe(topic_topup.c_str());
      client.subscribe(topic_pay.c_str());
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5s");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  SPI.begin();
  mfrc522.PCD_Init();

  setup_wifi();
  sync_time();

  client.setServer(mqtt_server, MQTT_PORT);
  client.setCallback(callback);

  Serial.println("✓ Emerald Hub System Ready");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) setup_wifi();
  if (!client.connected()) reconnect();
  client.loop();

  if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
    String uid = "";
    for (byte i = 0; i < mfrc522.uid.size; i++) {
      if (mfrc522.uid.uidByte[i] < 0x10) uid += "0";
      uid += String(mfrc522.uid.uidByte[i], HEX);
    }
    uid.toUpperCase();

    Serial.println("[SCAN] Card detected: " + uid);

    StaticJsonDocument<255> doc;
    doc["uid"] = uid;
    doc["status"] = "detected";
    doc["ts"] = get_unix_time();

    char buffer[255];
    serializeJson(doc, buffer);
    client.publish(topic_status.c_str(), buffer);

    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    delay(2000);
  }
}

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>
#include <string.h>

// Isi Wi-Fi sebelum firmware diunggah. Gunakan anon/publishable key,
// jangan pernah memakai service-role key di firmware perangkat.
const char* WIFI_SSID = "GANTI_NAMA_WIFI";
const char* WIFI_PASS = "GANTI_PASSWORD_WIFI";
const char* SUPABASE_URL = "GANTI_URL_SUPABASE";
const char* SUPABASE_KEY = "GANTI_ANON_PUBLISHABLE_KEY";
const char* DEVICE_ID = "WM-001";

const byte PIN_FLOW = D5;
const byte PIN_RELAY = D7;
const byte PIN_BUTTON = D6;
const unsigned long UPDATE_INTERVAL_MS = 3000;
const float FLOW_SENSOR_HZ_PER_LPM = 7.5;
const uint8_t MAX_GET_ATTEMPTS = 3;
const uint8_t MAX_PATCH_ATTEMPTS = 2;
const uint16_t HTTP_TIMEOUT_MS = 15000;

LiquidCrystal_I2C lcd(0x27, 16, 2);

volatile unsigned long pulseCount = 0;
float flowRate = 0.0;
float sisaLiter = 0.0;
bool statusKatup = false;
unsigned long lastUpdate = 0;

void ICACHE_RAM_ATTR pulseCounter() {
  pulseCount++;
}

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.printf("Menghubungkan ke Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("Wi-Fi gagal, status=%d\n", WiFi.status());
    return false;
  }

  Serial.print("Wi-Fi terhubung, IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool getIsoTimestamp(char* output, size_t outputSize) {
  const time_t now = time(nullptr);
  if (now < 1700000000) return false;

  struct tm utcTime;
  gmtime_r(&now, &utcTime);
  return strftime(output, outputSize, "%Y-%m-%dT%H:%M:%SZ", &utcTime) > 0;
}

String deviceUrl() {
  return String(SUPABASE_URL) + "/rest/v1/devices?device_id=eq." + DEVICE_ID;
}

void addSupabaseHeaders(HTTPClient& http) {
  http.addHeader("apikey", SUPABASE_KEY);
  if (strncmp(SUPABASE_KEY, "sb_publishable_", 15) != 0) {
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  }
}

void showConnectionFailure(const char* title, const char* detail) {
  digitalWrite(PIN_RELAY, LOW);
  statusKatup = false;
  flowRate = 0.0;

  lcd.setCursor(0, 0);
  lcd.print("                ");
  lcd.setCursor(0, 0);
  lcd.print(title);
  lcd.setCursor(0, 1);
  lcd.print("                ");
  lcd.setCursor(0, 1);
  lcd.print(detail);
}

bool getSisaKuotaFromSupabase(float* quota) {
  char lcdDetail[17] = "Read Timeout";

  for (uint8_t attempt = 1; attempt <= MAX_GET_ATTEMPTS; attempt++) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("GET dibatalkan: Wi-Fi tidak tersambung.");
      snprintf(lcdDetail, sizeof(lcdDetail), "Wi-Fi putus");
      break;
    }

    WiFiClientSecure client;
    client.setInsecure(); // Untuk prototipe; gunakan validasi sertifikat TLS untuk deployment.
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    if (!http.begin(client, deviceUrl() + "&select=sisa_liter")) {
      Serial.printf("Supabase GET gagal dimulai (percobaan %u/%u).\n",
                    attempt, MAX_GET_ATTEMPTS);
      snprintf(lcdDetail, sizeof(lcdDetail), "HTTP begin gagal");
      http.end();
    } else {
      addSupabaseHeaders(http);
      const int httpCode = http.GET();

      if (httpCode == HTTP_CODE_OK) {
        const String payload = http.getString();
        http.end();

        DynamicJsonDocument response(1024);
        const DeserializationError jsonError = deserializeJson(response, payload);
        if (jsonError) {
          Serial.printf("JSON kuota tidak valid: %s\n", jsonError.c_str());
          showConnectionFailure("Respons invalid", "JSON Supabase");
          return false;
        }
        if (!response.is<JsonArray>() || response.as<JsonArray>().size() == 0) {
          Serial.printf("Perangkat %s tidak ditemukan atau diblokir RLS (SELECT) di tabel devices.\n",
                        DEVICE_ID);
          showConnectionFailure("Device / RLS?", DEVICE_ID);
          return false;
        }
        if (response[0]["sisa_liter"].isNull()) {
          Serial.println("Kolom sisa_liter kosong atau tidak tersedia.");
          showConnectionFailure("Kolom kosong", "sisa_liter");
          return false;
        }

        *quota = response[0]["sisa_liter"].as<float>();
        return true;
      }

      const String errorText = httpCode < 0
        ? http.errorToString(httpCode)
        : http.getString();
      Serial.printf("Supabase GET gagal (percobaan %u/%u): HTTP %d, %s\n",
                    attempt, MAX_GET_ATTEMPTS, httpCode, errorText.c_str());

      if (httpCode < 0) {
        const String shortError = http.errorToString(httpCode);
        snprintf(lcdDetail, sizeof(lcdDetail), "%.16s", shortError.c_str());
      } else {
        snprintf(lcdDetail, sizeof(lcdDetail), "HTTP %d", httpCode);
      }
      http.end();

      if (httpCode >= 400 && httpCode < 500 && httpCode != 429) break;
    }

    if (attempt < MAX_GET_ATTEMPTS) {
      delay(500 * attempt);
    }
  }

  showConnectionFailure("GET gagal", lcdDetail);
  return false;
}

bool sendTelemetryToSupabase(float quota, float flow, bool valveOpen) {
  char timestamp[25];
  if (!getIsoTimestamp(timestamp, sizeof(timestamp))) {
    Serial.println("Waktu NTP belum tersedia; telemetri tidak dikirim.");
    showConnectionFailure("NTP belum siap", "cek Wi-Fi/time");
    return false;
  }

  StaticJsonDocument<256> request;
  request["sisa_liter"] = quota;
  request["debit_realtime"] = flow;
  request["status_katup"] = valveOpen;
  request["status_alat"] = true;
  request["last_ping"] = timestamp;

  String body;
  serializeJson(request, body);

  for (uint8_t attempt = 1; attempt <= MAX_PATCH_ATTEMPTS; attempt++) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("PATCH dibatalkan: Wi-Fi tidak tersambung.");
      showConnectionFailure("Wi-Fi terputus", "reconnect...");
      return false;
    }

    WiFiClientSecure client;
    client.setInsecure(); // Untuk prototipe; gunakan validasi sertifikat TLS untuk deployment.
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    if (!http.begin(client, deviceUrl())) {
      Serial.printf("Supabase PATCH gagal dimulai (percobaan %u/%u).\n",
                    attempt, MAX_PATCH_ATTEMPTS);
      showConnectionFailure("PATCH gagal", "cek URL");
      http.end();
    } else {
      addSupabaseHeaders(http);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Prefer", "return=minimal");

      const int httpCode = http.PATCH(body);
      if (httpCode >= 200 && httpCode < 300) {
        http.end();
        Serial.printf("Telemetri terkirim: %s, sisa=%.1f L, debit=%.2f L/menit\n",
                      timestamp, quota, flow);
        return true;
      }

      const String errorText = httpCode < 0
        ? http.errorToString(httpCode)
        : http.getString();
      Serial.printf("Supabase PATCH gagal (percobaan %u/%u): HTTP %d, %s\n",
                    attempt, MAX_PATCH_ATTEMPTS, httpCode, errorText.c_str());

      char lcdDetail[17];
      if (httpCode < 0) {
        const String shortError = http.errorToString(httpCode);
        snprintf(lcdDetail, sizeof(lcdDetail), "%.16s", shortError.c_str());
      } else {
        snprintf(lcdDetail, sizeof(lcdDetail), "HTTP %d", httpCode);
      }
      showConnectionFailure("PATCH gagal", lcdDetail);
      http.end();

      if (httpCode >= 400 && httpCode < 500 && httpCode != 429) return false;
    }

    if (attempt < MAX_PATCH_ATTEMPTS) {
      delay(500 * attempt);
    }
  }

  return false;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT_OPEN_DRAIN);
  digitalWrite(PIN_RELAY, LOW);
  pinMode(PIN_FLOW, INPUT_PULLUP);
  pinMode(PIN_BUTTON, INPUT_PULLUP);

  Wire.begin(D2, D1);
  lcd.init();
  lcd.backlight();
  lcd.print("Connecting WiFi");

  if (connectWiFi()) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    attachInterrupt(digitalPinToInterrupt(PIN_FLOW), pulseCounter, RISING);
    lcd.clear();
    lcd.print("WTP Smart Meter");
  } else {
    showConnectionFailure("Wi-Fi gagal", "cek SSID/pass");
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    showConnectionFailure("Wi-Fi terputus", "reconnect...");
    connectWiFi();
    delay(500);
    return;
  }

  if (millis() - lastUpdate < UPDATE_INTERVAL_MS) return;
  lastUpdate = millis();

  noInterrupts();
  const unsigned long pulses = pulseCount;
  pulseCount = 0;
  interrupts();

  const float elapsedSeconds = UPDATE_INTERVAL_MS / 1000.0;
  flowRate = (pulses / elapsedSeconds) * 60.0 / FLOW_SENSOR_HZ_PER_LPM;
  const float usedLiter = (flowRate / 60.0) * elapsedSeconds;

  float latestQuota = sisaLiter;
  if (!getSisaKuotaFromSupabase(&latestQuota)) {
    return;
  }

  sisaLiter = latestQuota;
  if (usedLiter > 0.0) {
    sisaLiter = max(0.0f, sisaLiter - usedLiter);
  }

  if (sisaLiter > 0.05) {
    digitalWrite(PIN_RELAY, HIGH);
    statusKatup = true;
  } else {
    digitalWrite(PIN_RELAY, LOW);
    statusKatup = false;
    sisaLiter = 0.0;
  }

  if (!sendTelemetryToSupabase(sisaLiter, flowRate, statusKatup)) {
    Serial.println("Telemetri gagal dikirim; periksa log HTTP di atas.");
    return;
  }

  lcd.setCursor(0, 0);
  lcd.print("Kuota: ");
  lcd.print(sisaLiter, 1);
  lcd.print("L   ");
  lcd.setCursor(0, 1);
  lcd.print("Flow : ");
  lcd.print(flowRate, 1);
  lcd.print("L/m ");
}

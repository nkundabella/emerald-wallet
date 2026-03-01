# Emerald Wallet | RFID Ecosystem (v2.0 Production)

This project is a high-performance RFID card top-up and payment ecosystem. It features an ESP8266 Emerald Hub, a Node.js Backend with MongoDB persistence, and a real-time Web Dashboard.

## 🚀 Live Production URL
**Dashboard:** [http://157.173.101.159:9259/emerald_wallet.html](http://157.173.101.159:9259/emerald_wallet.html)

## System Architecture

1.  **Emerald Hub (NodeMCU ESP8266):** Scans RFID cards. Communicates via **MQTT** using the broker `157.173.101.159`.
2.  **Backend Bridge (Node.js):** Hosted on a remote server. Bridges MQTT to the Web Dashboard via **Native WebSockets** and provides a REST API.
3.  **Database (MongoDB Atlas):** Stores cardholder data, balances, and a persistent transaction ledger.
4.  **Web Dashboard:** Dual-mode UI (Admin/Cashier) built with Tailwind CSS.

## Project Structure

-   `firmware/`: C++ Arduino code for the ESP8266 Hub.
-   `server.js`: Node.js backend logic with MongoDB sessions for safe updates.
-   `emerald_wallet.html`: Dual-interface frontend dashboard.
-   `.env`: Configuration for DB URI and MQTT.

## Technical Specifications

-   **MQTT Broker:** `157.173.101.159` on Port `1883`.
-   **Team Identifier:** `the_rock` (Strict topic isolation).
-   **Safe Wallet Update:** Atomic transactions ensuring balance and ledger updates happen together.
-   **Real-time Updates:** Push-based notifications via Native WebSockets.

## Hardware Wiring (NodeMCU to MFRC522)

| RC522 Pin | NodeMCU Pin |
| :--- | :--- |
| SDA (SS) | D2 |
| SCK | D5 |
| MOSI | D7 |
| MISO | D6 |
| RST | D1 |
| 3.3V | 3V3 |

## Deployment Guide

### Backend Setup
1.  Navigate to `emerald-wallet/`.
2.  Run `npm install`.
3.  Create a `.env` file from `.env.example` and add your **MONGODB_URI**.
4.  Start the server: `npm run dev`.

### Hardware Setup
1.  Open `firmware/firmware.ino` in Arduino IDE.
2.  Install `PubSubClient`, `MFRC522`, and `ArduinoJson` libraries.
3.  Upload to your NodeMCU ESP8266.

## Admin vs Cashier Interface
-   **Admin**: Scanning a card identifies it and allows for balance top-ups.
-   **Cashier**: Allows selecting products and deducting balance from the scanned card.

## Features
-   ✅ Atomic Transaction Ledger (Top-up & Payment).
-   ✅ Persistent MongoDB Storage.
-   ✅ Strict Topic Isolation (`rfid/the_rock/`).
-   ✅ Premium Glassmorphism UI with dual tabs.
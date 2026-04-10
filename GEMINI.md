# GEMINI.md: Frigorifico_IoT Cloud Functions

This document provides a comprehensive overview of the Firebase Cloud Functions backend for the IoT Refrigerator Monitoring project.

## Project Overview

This is a serverless backend built on **Node.js** and **Google Cloud Functions for Firebase**. Its primary purpose is to receive, process, and monitor data from IoT devices installed in refrigerators, and to alert users of important events like temperature anomalies or device disconnections.

### Core Architecture

The system is composed of three main types of functions:

1.  **Gatekeeper (HTTP-triggered):** The `iotReceiver` function is a public HTTP endpoint that serves as the single entry point for data coming from the IoT devices (likely SIMCOM modules). It is responsible for:
    *   Authenticating the user/device via email and password.
    *   Authorizing that the authenticated user owns the device.
    *   Receiving sensor data (temperatures, door status, etc.).
    *   Updating the device's latest state in the Firestore database.

2.  **The Brain (Firestore-triggered):** The `onDeviceUpdate` function is the core of the system's logic. It automatically runs whenever a device's document is updated in Firestore. Its responsibilities include:
    *   **Archiving:** Saving the incoming sensor data to a historical `readings` subcollection.
    *   **Alarm Engine:** Comparing the new sensor data against the device's configured thresholds (e.g., `tempCam1Max`, `doorCam1AlarmEnabled`).
    *   **State Management:** Updating an `activeAlarms` map in the device's document to reflect the current alarm status.
    *   **Notifications:** Sending **Firebase Cloud Messaging (FCM)** push notifications to the device's owner and registered viewers if a new alarm is triggered or an existing one is resolved.
    *   **Logging:** Recording all alarm events and configuration changes into separate subcollections for auditing.

3.  **The Watchdog (Scheduled):** The `checkOfflineDevices` function is a cron job that runs every 5 minutes. It scans all devices to ensure they are regularly sending data. If a device has not reported in over 15 minutes, this function:
    *   Marks the device as `isOnline: false`.
    *   Triggers a `deviceOffline` alarm.
    *   Sends a push notification to alert users that the device has lost connection.

### Firestore Data Model

*   `/devices/{macAddress}`: The main collection. Each document represents one IoT device. It stores the device name, its owner/viewers, its configuration (`config`), its current state (`currentReadings`), and its alarm status (`activeAlarms`).
*   `/devices/{macAddress}/readings`: A subcollection containing a time-series log of all historical sensor data.
*   `/devices/{macAddress}/alarmLogs`: A subcollection that audits every alarm event (e.g., "High Temperature Detected").
*   `/devices/{macAddress}/configLogs`: A subcollection that audits any changes made to a device's settings.
*   `/users/{userId}`: Stores user profiles, and most importantly, the `fcmTokens` array required to send them push notifications.

## Building and Running

### Prerequisites

*   Node.js (v20 as specified in `package.json`)
*   Firebase CLI (`npm install -g firebase-tools`)
*   Authentication with the Firebase CLI (`firebase login`)
*   Project setup (`firebase use <your-project-id>`)

### Key Commands

The following commands can be run from the `functions` directory.

*   **Install Dependencies:**
    ```bash
    npm install
    ```

*   **Run Locally with Emulators:** To test functions locally without deploying.
    ```bash
    npm run serve
    # Equivalent to: firebase emulators:start --only functions
    ```

*   **Deploy to Firebase:**
    ```bash
    npm run deploy
    # Equivalent to: firebase deploy --only functions
    ```

*   **View Logs:** To see real-time logs from the deployed functions.
    ```bash
    npm run logs
    # Equivalent to: firebase functions:log
    ```

## Development Conventions

*   **Modular Structure:** Logic is separated by trigger type into `src/gatekeeper`, `src/triggers`, and `src/scheduled`.
*   **Central Entry Point:** `index.js` initializes Firebase and exports all functions from their respective modules.
*   **Constants:** Shared, static values like alarm type strings are stored in `src/utils/constants.js`.
*   **Environment Variables:** The functions expect a `WEB_API_KEY` environment variable, used for authenticating users. This should be set in the Firebase environment configuration:
    ```bash
    firebase functions:secrets:set WEB_API_KEY
    ```

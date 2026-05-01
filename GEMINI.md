# GEMINI.md: Cloud Functions para Frigorifico_IoT

Este documento proporciona una visión general completa del backend de Firebase Cloud Functions para el proyecto de Monitoreo de Frigoríficos IoT.

## Descripción General del Proyecto

Este es un backend serverless construido con **Node.js** y **Google Cloud Functions para Firebase**. Su propósito principal es recibir, procesar y monitorear los datos de los dispositivos IoT instalados en los frigoríficos, y alertar a los usuarios sobre eventos importantes como anomalías de temperatura o desconexiones de los dispositivos.

### Arquitectura Principal

El sistema está compuesto por tres tipos principales de funciones:

1.  **Gatekeeper (Activado por HTTP):** La función `iotReceiver` es un endpoint HTTP público que sirve como el único punto de entrada para los datos provenientes de los dispositivos IoT (módulos SIMCOM/ESP32). Es responsable de:
    *   Autenticar al usuario/dispositivo mediante email y contraseña.
    *   Autorizar que el usuario autenticado sea el dueño del dispositivo.
    *   Recibir datos de sensores (temperaturas, estado de puertas, conectividad `lteOk`, etc.).
    *   Actualizar el estado más reciente del dispositivo en la base de datos Firestore utilizando el modelo centralizado.

2.  **El Cerebro (Activado por Firestore):** La función `onDeviceUpdate` es el núcleo de la lógica del sistema. Se ejecuta automáticamente cada vez que se actualiza el documento de un dispositivo en Firestore. Sus responsabilidades incluyen:
    *   **Archivado:** Guardar los datos entrantes de los sensores en una subcolección histórica de `readings`.
    *   **Motor de Alarmas:** Comparar los nuevos datos de los sensores con los umbrales configurados del dispositivo (ej. `tempCam1Max`, `doorCam1AlarmEnabled`) y monitorear el estado del hardware (ej. conectividad LTE).
    *   **Gestión de Estados:** Actualizar un mapa de `activeAlarms` en el documento del dispositivo para reflejar el estado actual de las alarmas.
    *   **Notificaciones:** Enviar notificaciones push a través de **Firebase Cloud Messaging (FCM)** al dueño, observadores (`viewers`) y editores si se activa una nueva alarma o se resuelve una existente.
    *   **Registro (Logging):** Registrar todos los eventos de alarma y cambios de configuración en subcolecciones separadas para auditoría.

3.  **El Watchdog (Programado):** La función `checkOfflineDevices` es una tarea programada (cron job) que se ejecuta cada 5 minutos. Escanea todos los dispositivos para asegurar que están enviando datos regularmente. Si un dispositivo no ha reportado en más de 15 minutos:
    *   Marca el dispositivo como `isOnline: false`.
    *   Activa una alarma de `deviceOffline`.
    *   Envía una notificación push para alertar a los usuarios (Dueño, Viewers y Editores) que el dispositivo ha perdido la conexión.

### Modelo de Datos de Firestore

*   `/devices/{macAddress}`: La colección principal. Cada documento representa un dispositivo IoT. Almacena el nombre del dispositivo, su dueño/observadores/editores, su configuración (`config`), su estado actual (`currentReadings`) y su estado de alarmas (`activeAlarms`).
*   `/devices/{macAddress}/readings`: Una subcolección que contiene un registro histórico de todos los datos de los sensores.
*   `/devices/{macAddress}/alarmLogs`: Una subcolección que audita cada evento de alarma.
*   `/devices/{macAddress}/configLogs`: Una subcolección que audita cualquier cambio realizado en los ajustes del dispositivo.
*   `/users/{userId}`: Almacena perfiles de usuario y los tokens `fcmTokens` necesarios para enviar notificaciones push.

## Compilación y Ejecución

### Prerrequisitos

*   Node.js (v24 según `package.json`)
*   Firebase CLI (`npm install -g firebase-tools`)
*   Autenticación con Firebase CLI (`firebase login`)
*   Configuración del proyecto (`firebase use <tu-id-de-proyecto>`)

### Comandos Clave

Los siguientes comandos pueden ejecutarse desde el directorio `functions`.

*   **Instalar Dependencias:**
    ```bash
    npm install
    ```

*   **Ejecutar Localmente con Emuladores:** Para probar las funciones localmente sin desplegar.
    ```bash
    npm run serve
    ```

*   **Desplegar en Firebase:**
    ```bash
    npm run deploy
    ```

*   **Ver Logs:** Para ver los logs en tiempo real de las funciones desplegadas.
    ```bash
    npm run logs
    ```

## Convenciones de Desarrollo

*   **Estructura Modular:** La lógica está separada por tipo de activador en `src/gatekeeper`, `src/triggers` y `src/scheduled`.
*   **Modelo Único de Verdad:** Se utiliza `src/models/device.js` para centralizar los valores por defecto y el mapeo de datos de los dispositivos.
*   **Punto de Entrada Central:** `index.js` inicializa Firebase y exporta todas las funciones desde sus respectivos módulos.
*   **Constantes:** Los valores estáticos compartidos, como los tipos de alarma, se almacenan en `src/utils/constants.js`.
*   **Variables de Entorno:** Las funciones esperan una variable de entorno `WEB_API_KEY`, utilizada para autenticar usuarios. Debe configurarse en Firebase:
    ```bash
    firebase functions:secrets:set WEB_API_KEY
    ```

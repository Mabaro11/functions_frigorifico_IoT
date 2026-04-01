const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { ALARM_TYPES } = require("../utils/constants");

exports.onDeviceUpdate = onDocumentUpdated("devices/{deviceId}", async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();
    const deviceId = event.params.deviceId;

    const current = newData.currentReadings;
    const config = newData.config;

    if (!current || !config) return;

    // ==========================================
    // 1. DETECTAR QUÉ CAMBIÓ EXACTAMENTE
    // ==========================================
    const readingsChanged = JSON.stringify(current) !== JSON.stringify(oldData.currentReadings);
    const configChanged = JSON.stringify(config) !== JSON.stringify(oldData.config);

    // Si no cambió ni la telemetría ni la configuración (ej. solo cambiaron el nombre), abortamos
    if (!readingsChanged && !configChanged) {
        return;
    }

    const db = admin.firestore();
    const deviceRef = event.data.after.ref;

    try {
        const batch = db.batch();

        // ==========================================
        // 2. LOG DE CONFIGURACIONES
        // Se ejecuta SOLO si configChanged es true
        // ==========================================
        if (configChanged) {
            const oldConfig = oldData.config || {};
            let detallesCambio = [];
            
            for (const key in config) {
                if (config[key] !== oldConfig[key]) {
                    detallesCambio.push(`'${key}' cambió a ${config[key]}`);
                }
            }

            if (detallesCambio.length > 0) {
                const configLogRef = deviceRef.collection("configLogs").doc();
                const modificador = newData.lastModifiedBy || "Desconocido";

                batch.set(configLogRef, {
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    changedBy: modificador,
                    action: "Modificación de Ajustes",
                    details: detallesCambio.join(" | ")
                });
            }
        }

        // ==========================================
        // 3. TELEMETRÍA Y ALARMAS
        // Se ejecuta SOLO si readingsChanged es true
        // ==========================================
        if (readingsChanged) {
            // TAREA A: GUARDAR HISTÓRICO (Archivado)
            const historyRef = deviceRef.collection("readings").doc();
            batch.set(historyRef, current);

            // TAREA B: VERIFICAR ALARMAS
            let newAlarms = {
                tempCam1High: false, tempCam1Low: false, doorCam1Open: false,
                tempCam2High: false, tempCam2Low: false, doorCam2Open: false,
                deviceOffline: false,
                batLow: false, volLow: false, wifiLow: false
            };

            // Cámara 1
            if (current.tempCam1 > config.tempCam1Max) newAlarms.tempCam1High = true;
            if (current.tempCam1 < config.tempCam1Min) newAlarms.tempCam1Low = true;
            if (current.doorCam1Open && config.doorCam1AlarmEnabled !== false) newAlarms.doorCam1Open = true;

            // Cámara 2
            if (current.tempCam2 > config.tempCam2Max) newAlarms.tempCam2High = true;
            if (current.tempCam2 < config.tempCam2Min) newAlarms.tempCam2Low = true;
            if (current.doorCam2Open && config.doorCam2AlarmEnabled !== false) newAlarms.doorCam2Open = true;

            // Hardware
            const minBat = config.batMinThreshold !== undefined ? config.batMinThreshold : 20;
            const minVol = config.volMinThreshold !== undefined ? config.volMinThreshold : 100;
            const minWifi = config.wifiMinThreshold !== undefined ? config.wifiMinThreshold : -85;

            if (current.bat < minBat && config.batAlarmEnabled !== false) newAlarms.batLow = true;
            if (current.vol < minVol && config.volAlarmEnabled !== false) newAlarms.volLow = true;
            if (current.wifiRssi < minWifi && config.wifiAlarmEnabled === true) newAlarms.wifiLow = true;

            const currentAlarms = newData.activeAlarms || {};
            const alarmsChanged = JSON.stringify(newAlarms) !== JSON.stringify(currentAlarms);

            if (alarmsChanged || newData.isOnline === false) { 
                batch.update(deviceRef, { 
                    "activeAlarms": newAlarms,
                    "isOnline": true 
                });

                // TAREA C: ENVIAR NOTIFICACIONES PUSH INDEPENDIENTES Y LOGS
                const uidsToNotify = [];
                if (newData.owner) uidsToNotify.push(newData.owner);
                if (newData.viewers && Array.isArray(newData.viewers)) uidsToNotify.push(...newData.viewers);

                const validUids = uidsToNotify.filter(uid => typeof uid === 'string' && uid.trim() !== '');

                let allTokens = [];
                for (const uid of validUids) {
                    const userSnap = await db.collection("users").doc(uid).get();
                    if (userSnap.exists) {
                        const userData = userSnap.data();
                        if (userData.fcmTokens && Array.isArray(userData.fcmTokens)) {
                            allTokens = allTokens.concat(userData.fcmTokens);
                        }
                    }
                }

                if (allTokens.length > 0) {
                    const notificationsToSend = [];
                    const logsToWrite = []; 
                    const deviceName = newData.name || 'Dispositivo';

                    // -- Alertas Térmicas y Puertas --
                    if (newAlarms.tempCam1High && !currentAlarms.tempCam1High) {
                        notificationsToSend.push({ title: "🌡️ Alta Temperatura", body: `Cámara 1 en ${deviceName} superó el máximo de ${config.tempCam1Max}°C.` });
                        logsToWrite.push({ 
                            type: ALARM_TYPES.TEMP_HIGH, 
                            camera: 1, 
                            message: `Temperatura (${current.tempCam1}°C) superó el umbral máximo (${config.tempCam1Max}°C)` 
                        });
                    }
                    if (newAlarms.tempCam1Low && !currentAlarms.tempCam1Low) {
                        notificationsToSend.push({ title: "❄️ Baja Temperatura", body: `Cámara 1 en ${deviceName} perforó el mínimo de ${config.tempCam1Min}°C.` });
                        logsToWrite.push({ 
                            type: ALARM_TYPES.TEMP_LOW, 
                            camera: 1, 
                            message: `Temperatura (${current.tempCam1}°C) cayó debajo del mínimo (${config.tempCam1Min}°C)` 
                        });
                    }
                    if (newAlarms.doorCam1Open && !currentAlarms.doorCam1Open) {
                        notificationsToSend.push({ title: "🚪 Puerta Abierta", body: `Puerta de Cámara 1 en ${deviceName} abierta.` });
                        logsToWrite.push({ type: ALARM_TYPES.DOOR_OPEN, camera: 1, message: "Puerta detectada abierta" });
                    }
                    
                    if (newAlarms.tempCam2High && !currentAlarms.tempCam2High) {
                        notificationsToSend.push({ title: "🌡️ Alta Temperatura", body: `Cámara 2 en ${deviceName} superó el máximo de ${config.tempCam2Max}°C.` });
                        logsToWrite.push({ 
                            type: ALARM_TYPES.TEMP_HIGH, 
                            camera: 2, 
                            message: `Temperatura (${current.tempCam2}°C) superó el umbral máximo (${config.tempCam2Max}°C)` 
                        });
                    }
                    if (newAlarms.tempCam2Low && !currentAlarms.tempCam2Low) {
                        notificationsToSend.push({ title: "❄️ Baja Temperatura", body: `Cámara 2 en ${deviceName} perforó el mínimo de ${config.tempCam2Min}°C.` });
                        logsToWrite.push({ 
                            type: ALARM_TYPES.TEMP_LOW, 
                            camera: 2, 
                            message: `Temperatura (${current.tempCam2}°C) cayó debajo del mínimo (${config.tempCam2Min}°C)` 
                        });
                    }
                    if (newAlarms.doorCam2Open && !currentAlarms.doorCam2Open) {
                        notificationsToSend.push({ title: "🚪 Puerta Abierta", body: `Puerta de Cámara 2 en ${deviceName} abierta.` });
                        logsToWrite.push({ type: ALARM_TYPES.DOOR_OPEN, camera: 2, message: "Puerta detectada abierta" });
                    }


                    // -- Alertas de Hardware --
                    if (newAlarms.batLow && !currentAlarms.batLow) {
                        notificationsToSend.push({ title: "🔋 Batería Baja", body: `El dispositivo ${deviceName} tiene menos del ${minBat} de batería.` });
                        logsToWrite.push({ type: ALARM_TYPES.BAT_LOW, camera: 0, message: `Batería crítica (Menor a ${minBat}%)` });
                    }
                    if (newAlarms.volLow && !currentAlarms.volLow) {
                        notificationsToSend.push({ title: "⚡ Corte de Energía", body: `El dispositivo ${deviceName} perdió la conexión a la red eléctrica.` });
                        logsToWrite.push({ type: ALARM_TYPES.VOL_LOW, camera: 0, message: "Corte de suministro eléctrico" });
                    }
                    if (newAlarms.wifiLow && !currentAlarms.wifiLow) {
                        notificationsToSend.push({ title: "📡 Señal Débil", body: `El WiFi de ${deviceName} está en nivel crítico.` });
                        logsToWrite.push({ type: ALARM_TYPES.WIFI_LOW, camera: 0, message: "Nivel de señal WiFi crítico" });
                    }
                    
                    // -- RECUPERACIÓN DE CONEXIÓN --
                    if (oldData.isOnline === false && config.connectionRecoveryEnabled !== false) {
                        notificationsToSend.push({ title: "✅ Conexión Recuperada", body: `El equipo ${deviceName} volvió a estar en línea y reportando.` });
                        logsToWrite.push({ type: ALARM_TYPES.INFO_ONLINE, camera: 0, message: "Conexión con el servidor restablecida" });
                    }

                    logsToWrite.forEach(log => {
                        const logRef = deviceRef.collection("alarmLogs").doc();
                        batch.set(logRef, {
                            ...log,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        });
                    });

                    if (notificationsToSend.length > 0) {
                        const pushPromises = notificationsToSend.map(notif => {
                            return admin.messaging().sendEachForMulticast({
                                notification: { title: notif.title, body: notif.body },
                                android: { priority: 'high' },
                                tokens: allTokens
                            });
                        });

                        try {
                            await Promise.all(pushPromises);
                        } catch (msgError) {
                            console.error("Error enviando FCM:", msgError);
                        }
                    }
                }
            }
        }

        // Ejecutamos todos los cambios (Configuraciones + Historico + Alarmas) en un solo viaje
        await batch.commit();

    } catch (error) {
        console.error(`Error en onDeviceUpdate para ${deviceId}:`, error);
    }
});
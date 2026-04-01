const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { ALARM_TYPES } = require("../utils/constants"); // <-- IMPORTAMOS EL ENUM

exports.onDeviceUpdate = onDocumentUpdated("devices/{deviceId}", async (event) => {
    // 1. OBTENER DATOS
    const newData = event.data.after.data();
    const oldData = event.data.before.data();
    const deviceId = event.params.deviceId;

    
    // 2. VALIDAR SI CAMBIARON LAS LECTURAS
    // Si currentReadings es igual, significa que cambió otra cosa (ej: nombre), salimos.
    // Usamos JSON.stringify para una comparación rápida de objetos.
    if (JSON.stringify(newData.currentReadings) === JSON.stringify(oldData.currentReadings)) {
        return;
    }

    const current = newData.currentReadings;
    const config = newData.config;

    // Si no hay lecturas o no hay configuración, no hacemos nada
    if (!current || !config) return;

    const db = admin.firestore();
    const deviceRef = event.data.after.ref;

    try {
        const batch = db.batch();

// ==========================================
        // NUEVO: LOG DE CONFIGURACIONES (Optimizado)
        // ==========================================
        const oldConfig = oldData.config || {};
        const newConfig = config; 

        if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
            let detallesCambio = [];
            for (const key in newConfig) {
                if (newConfig[key] !== oldConfig[key]) {
                    detallesCambio.push(`'${key}' cambió a ${newConfig[key]}`);
                }
            }

            if (detallesCambio.length > 0) {
                const configLogRef = deviceRef.collection("configLogs").doc();
                
                // Atrapamos quién hizo el cambio. Si Android no lo mandó, ponemos "Desconocido"
                const modificador = newData.lastModifiedBy || "Desconocido";

                batch.set(configLogRef, {
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    changedBy: modificador, // ¡Aquí agregamos al usuario!
                    action: "Modificación de Ajustes",
                    details: detallesCambio.join(" | ")
                });
            }
        }

        // ==========================================
        // TAREA A: GUARDAR HISTÓRICO (Archivado)
        // ==========================================
        // Copiamos la lectura actual a la subcolección para tener historial de gráficos
        const historyRef = deviceRef.collection("readings").doc();
        batch.set(historyRef, current);

        // ==========================================
        // TAREA B: VERIFICAR ALARMAS
        // ==========================================

        // Definimos el estado ideal (todo false)
        let newAlarms = {
            // Cámara 1
            tempCam1High: false, tempCam1Low: false, doorCam1Open: false,
            // Cámara 2
            tempCam2High: false, tempCam2Low: false, doorCam2Open: false,
            // General
            deviceOffline: false,
            batLow: false, volLow: false, wifiLow: false
        };

        // Lógica de Comparación

        // Cámara 1
        if (current.tempCam1 > config.tempCam1Max) newAlarms.tempCam1High = true;
        if (current.tempCam1 < config.tempCam1Min) newAlarms.tempCam1Low = true;
        // NUEVO: Verificamos que el switch de alarma no esté apagado (false)
        if (current.doorCam1Open && config.doorCam1AlarmEnabled !== false) newAlarms.doorCam1Open = true;

        // Cámara 2
        if (current.tempCam2 > config.tempCam2Max) newAlarms.tempCam2High = true;
        if (current.tempCam2 < config.tempCam2Min) newAlarms.tempCam2Low = true;
        // NUEVO: Verificamos que el switch de alarma no esté apagado (false)
        if (current.doorCam2Open && config.doorCam2AlarmEnabled !== false) newAlarms.doorCam2Open = true;

        // Lógica de Comparación - Hardware
        // Leemos los umbrales configurados o usamos un fallback seguro por si el dispositivo es viejo
        const minBat = config.batMinThreshold !== undefined ? config.batMinThreshold : 20;
        const minVol = config.volMinThreshold !== undefined ? config.volMinThreshold : 100;
        const minWifi = config.wifiMinThreshold !== undefined ? config.wifiMinThreshold : -85;

        if (current.bat < minBat && config.batAlarmEnabled !== false) newAlarms.batLow = true;
        if (current.vol < minVol && config.volAlarmEnabled !== false) newAlarms.volLow = true;
        if (current.wifiRssi < minWifi && config.wifiAlarmEnabled === true) newAlarms.wifiLow = true;

        // Detectar si las alarmas cambiaron respecto a lo que ya está en la DB
        const currentAlarms = newData.activeAlarms || {};
        const alarmsChanged = JSON.stringify(newAlarms) !== JSON.stringify(currentAlarms);

        // Si las alarmas cambiaron O si el dispositivo figuraba como offline, actualizamos
        if (alarmsChanged || newData.isOnline === false) { 
            batch.update(deviceRef, { 
                "activeAlarms": newAlarms,
                "isOnline": true // Como acaba de reportar, forzamos que vuelva a estar online
            });

            // ==========================================
            // TAREA C: ENVIAR NOTIFICACIONES PUSH INDEPENDIENTES
            // ==========================================
            
            // --- INICIO DEL CAMBIO DE SEGURIDAD PARA UIDs ---
            // 1. Recolectar UIDs (Dueño + Viewers) de forma segura
            const uidsToNotify = [];
            if (newData.owner) {
                uidsToNotify.push(newData.owner);
            }
            if (newData.viewers && Array.isArray(newData.viewers)) {
                uidsToNotify.push(...newData.viewers);
            }

            // Limpiamos la lista para asegurarnos de que no haya undefined, null o vacíos
            const validUids = uidsToNotify.filter(uid => typeof uid === 'string' && uid.trim() !== '');

            // 2. Buscar todos los tokens FCM usando solo los UIDs válidos
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
            // --- FIN DEL CAMBIO ---

            // Si nadie tiene la app instalada/logueada, no hacemos nada
            if (allTokens.length > 0) {

                /****************************************************/
                const notificationsToSend = [];
                // NUEVO: Array para agrupar los logs que vamos a guardar
                const logsToWrite = []; 
                const deviceName = newData.name || 'Dispositivo';

                // -- Alertas Térmicas y Puertas --
                if (newAlarms.tempCam1High && !currentAlarms.tempCam1High) {
                    notificationsToSend.push({ title: "🌡️ Alta Temperatura", body: `Cámara 1 en ${deviceName} superó el máximo.` });
                    logsToWrite.push({ type: ALARM_TYPES.TEMP_HIGH , camera: 1, message: "Temperatura superó el umbral máximo" });
                }
                if (newAlarms.tempCam1Low && !currentAlarms.tempCam1Low) {
                    notificationsToSend.push({ title: "❄️ Baja Temperatura", body: `Cámara 1 en ${deviceName} perforó el mínimo.` });
                    logsToWrite.push({ type: ALARM_TYPES.TEMP_LOW , camera: 1, message: "Temperatura cayó debajo del mínimo" });
                }
                if (newAlarms.doorCam1Open && !currentAlarms.doorCam1Open) {
                    notificationsToSend.push({ title: "🚪 Puerta Abierta", body: `Puerta de Cámara 1 en ${deviceName} abierta.` });
                    logsToWrite.push({ type: ALARM_TYPES.DOOR_OPEN , camera: 1, message: "Puerta detectada abierta" });
                }
                
                if (newAlarms.tempCam2High && !currentAlarms.tempCam2High) {
                    notificationsToSend.push({ title: "🌡️ Alta Temperatura", body: `Cámara 2 en ${deviceName} superó el máximo.` });
                    logsToWrite.push({ type: ALARM_TYPES.TEMP_HIGH , camera: 2, message: "Temperatura superó el umbral máximo" });
                }
                if (newAlarms.tempCam2Low && !currentAlarms.tempCam2Low) {
                    notificationsToSend.push({ title: "❄️ Baja Temperatura", body: `Cámara 2 en ${deviceName} perforó el mínimo.` });
                    logsToWrite.push({ type: ALARM_TYPES.TEMP_LOW , camera: 2, message: "Temperatura cayó debajo del mínimo" });
                }
                if (newAlarms.doorCam2Open && !currentAlarms.doorCam2Open) {
                    notificationsToSend.push({ title: "🚪 Puerta Abierta", body: `Puerta de Cámara 2 en ${deviceName} abierta.` });
                    logsToWrite.push({ type: ALARM_TYPES.DOOR_OPEN , camera: 2, message: "Puerta detectada abierta" });
                }

                // -- Alertas de Hardware --
                if (newAlarms.batLow && !currentAlarms.batLow) {
                    notificationsToSend.push({ title: "🔋 Batería Baja", body: `El dispositivo ${deviceName} tiene menos del ${minBat} de batería.` });
                    logsToWrite.push({ type: ALARM_TYPES.BAT_LOW , camera: 0, message: `Batería crítica (Menor a ${minBat}%)` });
                }
                if (newAlarms.volLow && !currentAlarms.volLow) {
                    notificationsToSend.push({ title: "⚡ Corte de Energía", body: `El dispositivo ${deviceName} perdió la conexión a la red eléctrica.` });
                    logsToWrite.push({ type: ALARM_TYPES.VOL_LOW , camera: 0, message: "Corte de suministro eléctrico" });
                }
                if (newAlarms.wifiLow && !currentAlarms.wifiLow) {
                    notificationsToSend.push({ title: "📡 Señal Débil", body: `El WiFi de ${deviceName} está en nivel crítico.` });
                    logsToWrite.push({ type: ALARM_TYPES.WIFI_LOW , camera: 0, message: "Nivel de señal WiFi crítico" });
                }
                
                // -- RECUPERACIÓN DE CONEXIÓN --
                // Si antes estaba offline (false) y ahora reportó, enviamos el aviso de recuperación
                if (oldData.isOnline === false && config.connectionRecoveryEnabled !== false) {
                    notificationsToSend.push({ title: "✅ Conexión Recuperada", body: `El equipo ${deviceName} volvió a estar en línea y reportando.` });
                    logsToWrite.push({ type: ALARM_TYPES.INFO_ONLINE , camera: 0, message: "Conexión con el servidor restablecida" });
                }

                // NUEVO: Añadir los logs detectados al Batch de escritura
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

        await batch.commit();

    } catch (error) {
        console.error(`Error en onDeviceUpdate para ${deviceId}:`, error);
    }
});
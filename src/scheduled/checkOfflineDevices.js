/**
 * THE WATCHDOG: checkOfflineDevices
 * Tarea programada (Cron Job) que se ejecuta cada 5 minutos.
 * Escanea todos los dispositivos para detectar aquellos que no han reportado en más de 15 minutos.
 * Si detecta un dispositivo desconectado, lo marca como offline, activa la alarma correspondiente
 * y envía una notificación push de advertencia a los usuarios asociados.
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

// Ejecutar cada 5 minutos
exports.checkOfflineDevices = onSchedule("every 5 minutes", async (event) => {
    const db = admin.firestore();
    const now = Date.now();
    
    // TIEMPO DE GRACIA: ¿Cuánto tiempo debe pasar sin reportar para considerarlo offline?
    // 15 minutos = 15 * 60 * 1000 milisegundos
    const offlineThresholdMs = 15 * 60 * 1000; 

    try {
        // Traemos todos los dispositivos
        const devicesSnap = await db.collection("devices").get();
        if (devicesSnap.empty) return;

        const batch = db.batch();
        const notificationsToSend = [];
        let devicesToUpdate = 0;

        // Revisamos cada dispositivo
        for (const doc of devicesSnap.docs) {
            const data = doc.data();
            
            // Si no tiene lastSeen o ya está marcado como offline explícitamente, lo saltamos
            if (!data.lastSeen) continue;
            
            // Verificamos si YA enviamos la alerta antes para no hacer spam
            const alreadyOffline = data.activeAlarms && data.activeAlarms.deviceOffline === true;

            const lastSeenMs = data.lastSeen.toDate().getTime();
            const timeSinceLastReport = now - lastSeenMs;

            // Si superó el tiempo límite y no estaba marcado como offline
            if (timeSinceLastReport > offlineThresholdMs && !alreadyOffline) {
                
                // 1. Preparamos la actualización en Firestore
                // Marcamos isOnline como false y encendemos la alarma deviceOffline
                batch.update(doc.ref, {
                    isOnline: false,
                    "activeAlarms.deviceOffline": true
                });
                devicesToUpdate++;

                // 2. Preparamos la notificación Push
                const deviceName = data.name || 'Dispositivo';
                
                // --- INICIO DEL CAMBIO DE SEGURIDAD PARA UIDs ---
                // Recolectamos UIDs (Dueño + Viewers) de forma segura
                const uidsToNotify = [];
                if (data.owner) {
                    uidsToNotify.push(data.owner);
                }
                if (data.viewers && Array.isArray(data.viewers)) {
                    uidsToNotify.push(...data.viewers);
                }
                if (data.editors && Array.isArray(data.editors)) {
                    uidsToNotify.push(...data.editors);
                }

                // Limpiamos la lista para asegurarnos de que no haya undefined, null o vacíos
                const validUids = uidsToNotify.filter(uid => typeof uid === 'string' && uid.trim() !== '');

                // Buscamos sus tokens FCM usando solo los UIDs válidos
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

                if (allTokens.length > 0) {
                    notificationsToSend.push({
                        tokens: allTokens,
                        notification: {
                            title: "⚠️ Dispositivo Desconectado",
                            body: `El equipo ${deviceName} lleva más de 15 minutos sin reportar datos. Revisa la conexión eléctrica o Wi-Fi.`
                        },
                        android: {
                            priority: 'high'
                        }
                    });
                }
            }
        }

        // Ejecutamos las actualizaciones en la base de datos
        if (devicesToUpdate > 0) {
            await batch.commit();
            console.log(`Se marcaron ${devicesToUpdate} dispositivos como OFFLINE.`);

            // Enviamos todas las notificaciones push recolectadas
            const pushPromises = notificationsToSend.map(payload => {
                return admin.messaging().sendEachForMulticast({
                    notification: payload.notification,
                    tokens: payload.tokens
                });
            });

            await Promise.all(pushPromises);
            console.log("Notificaciones de desconexión enviadas correctamente.");
        }

    } catch (error) {
        console.error("Error en la tarea programada checkOfflineDevices:", error);
    }
});
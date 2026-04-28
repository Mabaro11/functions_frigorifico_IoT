const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

exports.registerOrJoinDevice = onCall(async (request) => {
    // 1. Seguridad: Verificar que el usuario esté logueado
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión para usar esta función.');
    }

    const uid = request.auth.uid;
    const deviceId = request.data.deviceId;
    const pin = request.data.pin;
    const name = request.data.name; // Necesitamos el nombre por si hay que crearlo

    // Validamos que la app nos mande los datos completos
    if (!deviceId || !pin || !name) {
        throw new HttpsError('invalid-argument', 'Faltan datos obligatorios (ID, PIN o Nombre).');
    }

    try {
        const db = admin.firestore();
        const deviceRef = db.collection("devices").doc(deviceId);
        
        // Hacemos UNA SOLA lectura
        const doc = await deviceRef.get();

        if (doc.exists) {
            // ==========================================
            // ESCENARIO A: EL EQUIPO YA EXISTE (UNIRSE)
            // ==========================================
            const deviceData = doc.data();

            if (deviceData.securityPin !== pin) {
                throw new HttpsError('permission-denied', 'El PIN ingresado es incorrecto.');
            }

            // Evitar duplicados si el usuario ya estaba en alguna lista
            const isOwner = deviceData.owner === uid;
            const isViewer = deviceData.viewers && deviceData.viewers.includes(uid);
            const isEditor = deviceData.editors && deviceData.editors.includes(uid);

            if (isOwner || isViewer || isEditor) {
                return { success: true, message: 'Ya tienes acceso a este equipo.' };
            }

            // Agregamos al usuario como invitado (viewer)
            await deviceRef.update({
                viewers: admin.firestore.FieldValue.arrayUnion(uid)
            });

            return { success: true, message: '¡Te has unido al equipo como invitado!' };

        } else {
            // ==========================================
            // ESCENARIO B: EL EQUIPO NO EXISTE (CREAR)
            // ==========================================
            
            // Aquí armas el documento inicial exactamente como lo hacías en Kotlin
            const newDevice = {
                name: name,
                owner: uid,
                securityPin: pin,
                viewers: [],
                editors: [],
                config: {
                    tempCam1Min: 0.0,
                    tempCam1Max: 0.0,
                    tempCam2Min: 0.0,
                    tempCam2Max: 0.0,
                    reportInterval: 10,
                    doorCam1AlarmEnabled: true,
                    doorCam2AlarmEnabled: true,
                    doorAlarmTime: 60,
                    buzzerTime: 30,
                    wifiAlarmTime: 300,
                    acAlarmTime: 60,
                    batAlarmTime: 300,
                    phoneNumber: ""
                }
            };

            await deviceRef.set(newDevice);

            return { success: true, message: 'Equipo registrado exitosamente como Dueño.' };
        }

    } catch (error) {
        console.error("Error en registerOrJoinDevice:", error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', 'Ocurrió un error en el servidor al procesar el dispositivo.');
    }
});
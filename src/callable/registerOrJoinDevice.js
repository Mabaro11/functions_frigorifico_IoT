/**
 * APP INTERFACE: registerOrJoinDevice
 * Función Callable invocada desde la aplicación móvil.
 * Permite a un usuario registrar un equipo nuevo como 'Dueño' o unirse a uno existente como 'Invitado' (viewer)
 * utilizando el ID del dispositivo y un PIN de seguridad.
 * Inicializa la configuración por defecto si el equipo es nuevo.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { createInitialDevice } = require("../models/device");

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
            
            // Usamos el modelo para generar el documento completo con defaults
            const newDevice = createInitialDevice(name, uid, pin);

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
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { defineString } = require("firebase-functions/params");

// Definimos la variable de entorno para la API Key
const apiKeyParams = defineString("WEB_API_KEY");

const iotReceiverFunction = onRequest(async (req, res) => {
    // 1. Validar Método HTTP
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    const body = req.body;

    // 2. Validación básica de campos obligatorios
    if (!body || !body.email || !body.password || !body.macAddress || !body.data) {
        res.status(400).json({ error: "Faltan datos: email, password, macAddress o data" });
        return;
    }

    try {
        // ==========================================
        // PASO 1: AUTENTICACIÓN (Usuario Real)
        // ==========================================
        const apiKey = apiKeyParams.value();
        // Usamos la API REST de Google Identity Toolkit
        const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
        
        const authResponse = await fetch(authUrl, {
            method: "POST",
            body: JSON.stringify({
                email: body.email,
                password: body.password,
                returnSecureToken: true
            }),
            headers: { "Content-Type": "application/json" }
        });

        const authData = await authResponse.json();

        // Si la contraseña o email están mal, Google devuelve error
        if (!authResponse.ok) {
            console.warn(`Intento de login fallido para: ${body.email} - ${authData.error?.message}`);
            res.status(401).json({ error: "Credenciales inválidas" });
            return;
        }

        // ¡IMPORTANTE! Aquí obtenemos quién es el usuario autenticado
        const authenticatedUserId = authData.localId; 

        // ==========================================
        // PASO 2: BUSCAR EL DISPOSITIVO
        // ==========================================
        const db = admin.firestore();
        const deviceRef = db.collection("devices").doc(body.macAddress);
        const deviceSnap = await deviceRef.get();

        if (!deviceSnap.exists) {
            res.status(404).json({ error: "Dispositivo no encontrado" });
            return;
        }

        const deviceData = deviceSnap.data();

        // ==========================================
        // PASO 3: AUTORIZACIÓN (¿Es el dueño?)
        // ==========================================
        // Aquí arreglamos el agujero de seguridad.
        // Verificamos que el usuario que mandó la pass sea el mismo que figura como 'owner'.
        
        if (deviceData.owner !== authenticatedUserId) {
            console.warn(`Usuario ${body.email} intentó escribir en dispositivo ajeno ${body.macAddress}`);
            res.status(403).json({ error: "No tienes permiso para escribir en este dispositivo" });
            return;
        }

        // Validar si está aprovisionado (según tu lógica de negocio)
        if (deviceData.isProvisioned !== true) {
            res.status(403).json({ error: "Dispositivo no aprovisionado" });
            return;
        }

        // ==========================================
        // PASO 4: PREPARAR DATOS (Mapping)
        // ==========================================
        
        const incomingData = body.data;
        const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

        // Mapeo exacto según tu clase Kotlin 'DeviceReadings'
        const sensorReadings = {
            // Cámaras
            tempCam1: incomingData.tempCam1 || 0.0,
            doorCam1Open: incomingData.doorCam1Open || false,
            
            tempCam2: incomingData.tempCam2 || 0.0,
            doorCam2Open: incomingData.doorCam2Open || false,
            
            // Ambiente
            tempAmb: incomingData.tempAmb || 0.0,
            humAmb: incomingData.humAmb || 0.0,

            // Telemetría
            bat: incomingData.bat || 0.0,
            vol: incomingData.vol || 0.0,
            wifiRssi: incomingData.wifiRssi || 0, // 0 si es GSM/SIMCOM

            ts: serverTimestamp
        };

        // ==========================================
        // PASO 5: ACTUALIZAR FIRESTORE
        // ==========================================
        
        // Solo actualizamos el estado actual. 
        // El Trigger 'onDeviceUpdate' se encargará de guardar el historial y revisar alarmas.
        
        await deviceRef.update({
            lastSeen: serverTimestamp,
            lastReset: incomingData.lastReset || "",
            isOnline: true,
            currentReadings: {
                ...sensorReadings,
                // Usamos fecha JS para que la UI la muestre inmediatamente sin esperar sync
                ts: new Date() 
            }
        });

        // Respuesta exitosa
        res.status(200).send("OK");

    } catch (error) {
        console.error("Error crítico en Gatekeeper:", error);
        res.status(500).send("Internal Server Error");
    }
});

module.exports = { iotReceiverFunction };
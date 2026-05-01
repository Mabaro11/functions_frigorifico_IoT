/**
 * GATEKEEPER: getDeviceConfig
 * Endpoint HTTP (POST) que permite a los dispositivos IoT descargar su configuración desde Firestore.
 * Valida las credenciales del dispositivo y devuelve un JSON con los parámetros operativos.
 * Al ser consultado exitosamente, resetea la flag 'hasPendingConfig' a false.
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { defineString } = require("firebase-functions/params");
const { getSanitizedConfig } = require("../models/device");

// Reutilizamos tu variable de entorno
const apiKeyParams = defineString("WEB_API_KEY");

exports.getDeviceConfig = onRequest(async (req, res) => {
    // 1. Validar Método HTTP (Usamos POST para enviar las credenciales seguras en el body)
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    const body = req.body;

    // 2. Validación de credenciales del dispositivo
    if (!body || !body.email || !body.password || !body.macAddress) {
        res.status(400).json({ error: "Faltan datos: email, password o macAddress" });
        return;
    }

    try {
        // ==========================================
        // PASO 1: AUTENTICACIÓN (Igual que en iotReceiver)
        // ==========================================
        const apiKey = apiKeyParams.value();
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

        // Si la clave o el email están mal, cortamos acá
        if (!authResponse.ok) {
            res.status(401).json({ error: "Autenticación fallida", details: authData.error.message });
            return;
        }

        // ==========================================
        // PASO 2: BUSCAR LAS CONFIGURACIONES EN FIRESTORE
        // ==========================================
        // Asumiendo que tu colección raíz se llama 'devices'
        const db = admin.firestore();
        const deviceRef = db.collection("devices").doc(body.macAddress);
        const doc = await deviceRef.get();

        if (!doc.exists) {
            res.status(404).json({ error: "Dispositivo no encontrado en la base de datos" });
            return;
        }

        // ==========================================
        // PASO 3: RESPONDER Y RESETEAR FLAG
        // ==========================================
        const deviceData = doc.data();

        // Usamos el modelo para obtener la config sanitizada con valores por defecto
        const config = getSanitizedConfig(deviceData.config);

        // Devolvemos el JSON al módulo Simcom/ESP
        res.status(200).json(config);

    } catch (error) {
        console.error("Error crítico al obtener configuraciones:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});
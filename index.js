const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

// Importamos los módulos
const triggers = require("./src/triggers/onDeviceUpdate");
const gatekeeper = require("./src/gatekeeper/iotReceiver");
const getConfig = require("./src/gatekeeper/getDeviceConfig");
const scheduled = require("./src/scheduled/checkOfflineDevices");
// Exportamos las funciones
// 1. El Cerebro (Trigger de Firestore)
exports.onDeviceUpdate = triggers.onDeviceUpdate;

// 2. El Portero (Endpoints HTTP para SIMCOM)
exports.iotReceiver = gatekeeper.iotReceiverFunction;
exports.getDeviceConfig = getConfig.getDeviceConfig;

// ==========================================
// TAREAS PROGRAMADAS (CRON JOBS)
// ==========================================
// Agrega esta nueva línea apuntando a la carpeta donde guardaste el archivo
exports.checkOfflineDevices = scheduled.checkOfflineDevices;
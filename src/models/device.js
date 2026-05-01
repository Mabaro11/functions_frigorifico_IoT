/**
 * MODEL: Device
 * Define las estructuras, valores por defecto y funciones de mapeo para los dispositivos.
 * Centraliza la "forma" de los datos en Firestore para asegurar consistencia.
 * 
 * ESTRUCTURA DE REFERENCIA (Firestore Document):
 * {
 *   "deviceId": "",                                                       
 *   "owner": "",                                                          
 *   "viewers": [],                                                        
 *   "editors": [],                                                        
 *   "name": "",                                                           
 *   "securityPin": "",                                                    
 *   "isOnline": false,                                                    
 *   "isProvisioned": false,                                               
 *   "lastSeen": null,                                                     
 *   "hasPendingConfig": false,                                            
 *   "lastModifiedBy": null,    
 *   "config": {
 *     "tempCam1Min": 0.0,
 *     "tempCam1Max": 0.0,
 *     "tempCam2Min": 0.0,
 *     "tempCam2Max": 0.0,
 *     "reportInterval": 10,
 *     "doorCam1AlarmEnabled": true,
 *     "doorCam2AlarmEnabled": true,
 *     "batAlarmEnabled": true,
 *     "batMinThreshold": 20.0,
 *     "volAlarmEnabled": true,
 *     "volMinThreshold": 100.0,
 *     "wifiAlarmEnabled": false,
 *     "wifiMinThreshold": -85,
 *     "connectionRecoveryEnabled": true,
 *     "doorAlarmTime": 60,
 *     "buzzerTime": 30,
 *     "wifiAlarmTime": 300,
 *     "acAlarmTime": 60,
 *     "phoneNumber": ""
 *   },
 *   "currentReadings": {
 *     "tempCam1": 0.0,
 *     "doorCam1Open": false,
 *     "tempCam2": 0.0,
 *     "doorCam2Open": false,
 *     "tempAmb": 0.0,
 *     "humAmb": 0.0,
 *     "bat": 0.0,
 *     "vol": 0.0,
 *     "wifiRssi": 0,
 *     "lteOk": true,
 *     "ts": null
 *   },
 *   "activeAlarms": {
 *     "tempCam1High": false,
 *     "tempCam1Low": false,
 *     "doorCam1Open": false,
 *     "tempCam2High": false,
 *     "tempCam2Low": false,
 *     "doorCam2Open": false,
 *     "deviceOffline": false,
 *     "batLow": false,
 *     "volLow": false,
 *     "wifiLow": false,
 *     "wifiCut": false,
 *     "lteFail": false
 *   }
 * }
 */

const DEFAULT_CONFIG = Object.freeze({
    tempCam1Min: 0.0,
    tempCam1Max: 0.0,
    tempCam2Min: 0.0,
    tempCam2Max: 0.0,
    reportInterval: 10,
    doorCam1AlarmEnabled: true,
    doorCam2AlarmEnabled: true,
    batAlarmEnabled: true,
    batMinThreshold: 20.0,
    volAlarmEnabled: true,
    volMinThreshold: 100.0,
    wifiAlarmEnabled: false,
    wifiMinThreshold: -85,
    connectionRecoveryEnabled: true,
    doorAlarmTime: 60,
    buzzerTime: 30,
    wifiAlarmTime: 300,
    acAlarmTime: 60,
    phoneNumber: ""
});

const DEFAULT_READINGS = Object.freeze({
    tempCam1: 0.0,
    doorCam1Open: false,
    tempCam2: 0.0,
    doorCam2Open: false,
    tempAmb: 0.0,
    humAmb: 0.0,
    bat: 0.0,
    vol: 0.0,
    wifiRssi: 0,
    lteOk: true
});

const DEFAULT_ALARMS = Object.freeze({
    tempCam1High: false,
    tempCam1Low: false,
    doorCam1Open: false,
    tempCam2High: false,
    tempCam2Low: false,
    doorCam2Open: false,
    deviceOffline: false,
    batLow: false,
    volLow: false,
    wifiLow: false,
    wifiCut: false,
    lteFail: false
});

/**
 * Mapea los datos crudos que llegan desde el dispositivo (Postman/SIMCOM)
 * al formato estructurado 'currentReadings' de Firestore.
 */
const mapIncomingReadings = (incoming, serverTimestamp) => {
    return {
        tempCam1: incoming.tempCam1 ?? DEFAULT_READINGS.tempCam1,
        doorCam1Open: incoming.doorCam1Open ?? DEFAULT_READINGS.doorCam1Open,
        tempCam2: incoming.tempCam2 ?? DEFAULT_READINGS.tempCam2,
        doorCam2Open: incoming.doorCam2Open ?? DEFAULT_READINGS.doorCam2Open,
        tempAmb: incoming.tempAmb ?? DEFAULT_READINGS.tempAmb,
        humAmb: incoming.humAmb ?? DEFAULT_READINGS.humAmb,
        bat: incoming.bat ?? DEFAULT_READINGS.bat,
        vol: incoming.vol ?? DEFAULT_READINGS.vol,
        wifiRssi: incoming.wifiRssi ?? DEFAULT_READINGS.wifiRssi,
        lteOk: incoming.lteOk ?? DEFAULT_READINGS.lteOk,
        ts: serverTimestamp
    };
};

/**
 * Retorna un objeto con los valores de configuración, aplicando defaults
 * si algún campo no existe en el documento de Firestore.
 */
const getSanitizedConfig = (storedConfig) => {
    const config = storedConfig || {};
    const sanitized = {};
    
    for (const key in DEFAULT_CONFIG) {
        sanitized[key] = config[key] ?? DEFAULT_CONFIG[key];
    }
    
    return sanitized;
};

/**
 * Crea la estructura completa de un nuevo dispositivo para Firestore.
 * Se usa principalmente en el registro inicial (registerOrJoinDevice).
 */
const createInitialDevice = (name, ownerUid, securityPin) => {
    return {
        name: name || "",
        owner: ownerUid || "",
        viewers: [],
        editors: [],
        securityPin: securityPin || "",
        isOnline: false,
        isProvisioned: false,
        lastSeen: null,
        hasPendingConfig: false,
        lastModifiedBy: null,
        config: DEFAULT_CONFIG,
        currentReadings: {
            ...DEFAULT_READINGS,
            ts: null
        },
        activeAlarms: DEFAULT_ALARMS
    };
};

module.exports = {
    DEFAULT_CONFIG,
    DEFAULT_READINGS,
    DEFAULT_ALARMS,
    mapIncomingReadings,
    getSanitizedConfig,
    createInitialDevice
};
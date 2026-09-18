const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = 'https://bot-34-d4c4a-default-rtdb.firebaseio.com';
const CREDENTIAL_CANDIDATES = [
  path.join(__dirname, 'bot-34-d4c4a-firebase-adminsdk-fbsvc-ad20e9061a.json'),
  path.join(__dirname, 'firebase-service-account.json'),
  path.join(__dirname, 'serviceAccountKey.json')
];

const serviceAccountPath = CREDENTIAL_CANDIDATES.find(file => fs.existsSync(file));
const appConfig = { databaseURL: DATABASE_URL };

if (serviceAccountPath) {
  appConfig.credential = admin.credential.cert(serviceAccountPath);
} else {
  try {
    appConfig.credential = admin.credential.applicationDefault();
  } catch (e) {
    console.warn('⚠️ Firebase: sem credenciais locais; o bot continuará em modo local.');
  }
}

if (!admin.apps.length) {
  admin.initializeApp(appConfig);
}

const db = admin.database();

const Backup = {
  async salvarTudo(obj) {
    const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
    await db.ref('backup').set(payload);
    return true;
  },

  async carregarTudo() {
    const snapshot = await db.ref('backup').once('value');
    const value = snapshot.val();
    if (value === null || value === undefined || value === '') return {};
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) || {};
      } catch (e) {
        return {};
      }
    }
    return value;
  }
};

const Stats = {
  async set(path, value) {
    if (!path) return false;
    await db.ref('stats').child(String(path)).set(value);
    return true;
  },

  async getAllStats() {
    const snapshot = await db.ref('stats').once('value');
    return snapshot.val() || {};
  }
};

module.exports = { admin, db, Backup, Stats };

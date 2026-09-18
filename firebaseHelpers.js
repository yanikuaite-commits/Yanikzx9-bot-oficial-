const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = 'https://bot-34-d4c4a-default-rtdb.firebaseio.com';
const CREDENTIAL_CANDIDATES = [
  path.join(__dirname, 'bot-34-d4c4a-firebase-adminsdk-fbsvc-ad20e9061a.json'),
  path.join(__dirname, 'firebase-service-account.json'),
  path.join(__dirname, 'serviceAccountKey.json')
];

function resolveServiceAccount() {
  const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  const fromProject = CREDENTIAL_CANDIDATES.find(file => fs.existsSync(file));
  if (fromProject) return fromProject;

  return null;
}

let db = null;
let initialized = false;

try {
  const serviceAccountPath = resolveServiceAccount();
  const appConfig = { databaseURL: DATABASE_URL };

  if (serviceAccountPath) {
    appConfig.credential = admin.credential.cert(serviceAccountPath);
  }

  if (!admin.apps.length && (serviceAccountPath || process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)) {
    admin.initializeApp(appConfig);
    initialized = true;
  }

  if (initialized) {
    db = admin.database();
  }
} catch (e) {
  console.warn('⚠️ Firebase: falha de autenticação. A bot continuará em modo local sem sincronização cloud.', e && e.message ? e.message : e);
}

if (!initialized && !db) {
  console.warn('⚠️ Firebase: sem credenciais válidas em runtime; modo local ativo e backup cloud desativado.');
}

const Backup = {
  async salvarTudo(obj) {
    if (!db) return false;
    const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
    await db.ref('backup').set(payload);
    return true;
  },

  async carregarTudo() {
    if (!db) return {};
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
    if (!db || !path) return false;
    await db.ref('stats').child(String(path)).set(value);
    return true;
  },

  async getAllStats() {
    if (!db) return {};
    const snapshot = await db.ref('stats').once('value');
    return snapshot.val() || {};
  }
};

module.exports = { admin, db, Backup, Stats, initialized };

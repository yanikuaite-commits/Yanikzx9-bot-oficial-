const admin = require('firebase-admin');
const serviceAccount = require('./bot-34-d4c4a-firebase-adminsdk-fbsvc-ad20e9061a.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://bot-34-d4c4a-default-rtdb.firebaseio.com'
  });
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

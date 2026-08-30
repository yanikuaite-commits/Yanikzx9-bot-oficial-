const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
require('dotenv').config();
const Groq = require('groq-sdk');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const readline = require('readline');
const sharp = require('sharp');
sharp.cache(false);
sharp.concurrency(1);
const axios = require('axios');
const translate = require('translate-google');
const moment = require('moment');
const { Image: WebpImage } = require('node-webpmux');

// =================== CONFIGURAÇÃO DO BOT ===================
const CONFIG = {
  botName: "Nano Bot 🤖",
  creator: "Yanik Uaite",
  ownerId: "27538103889241",
  ownerNumber: "834788141",
  botNumber: "258850421617",
  prefix: ".",
  dataFile: path.join(__dirname, 'data', 'bot_data.json'),
  historicoFile: path.join(__dirname, 'data', 'historico.json')
};

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "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"
});

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<h1>💚 ${CONFIG.botName}</h1><p>Criado por ${CONFIG.creator}</p><p>🟢 Online</p>`);
});
server.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor HTTP na porta ${process.env.PORT || 3000}`);
});

// =================== BASE DE DADOS DO BOT ===================
const db = {
  gruposVIP: new Map(),
  grupoDono: new Map(),
  historicoIA: new Map(),
  historicoIAUltimoUso: new Map(),
  statusDono: null,
  historicoGrupos: new Map(),
  atalhos: new Map(),
  lembretes: [],
  ultimoCartaoPV: new Map(),
  usersVIP: new Map(),
  grupos: {
    antiLink: new Map(),
    palavrasBanidas: new Map(),
    banidos: new Map(),
    boasvindas: new Map(),
    regras: new Map(),
    iaAtivo: new Set(),
    transacoes: new Map(),
    desligados: new Set(),
    comandosDesativados: new Map(),
    audioGatilhos: new Map(),
    midiaGatilhos: new Map(),
    midiaComandos: new Map()
  },
  ignorados: new Set(),
  whitelist: new Map(),
  autoDelete: new Map(),
  indicadores: new Map(),
  stats: new Map(),
  notifications: new Map(),
  cache: new Map(),
  rateLimit: new Map(),
};

const cacheMetadata = new Map();
async function getMetadataCached(sock, groupId) {
  const agora = Date.now();
  const cached = cacheMetadata.get(groupId);
  if (cached && cached.expiraEm > agora) return cached.data;
  const meta = await sock.groupMetadata(groupId);
  cacheMetadata.set(groupId, { data: meta, expiraEm: agora + 30000 });
  return meta;
}
setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of cacheMetadata) if (v.expiraEm < agora) cacheMetadata.delete(k);
}, 5 * 60 * 1000);

// =================== GENDOWNLOAD (GRÁTIS, SEM CHAVE) ===================
async function extrairGenDownload(url) {
  const r = await axios.post('https://gendownload.com/api/extract', { url }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 45000
  });
  return r.data;
}
function escolherFormatoGen(dados, tipo) {
  const formatos = dados?.formats || [];
  if (tipo === 'audio') {
    return formatos.filter(f => f.type === 'audio')
      .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0] || null;
  }
  const videos = formatos.filter(f => f.type === 'video');
  if (!videos.length) return null;
  const leve = videos.find(f => f.ext === 'mp4' && /360|480/.test(f.label || ''));
  return leve || videos.find(f => f.ext === 'mp4') || videos[0];
}
async function baixarBufferGen(formato, maxBytes = 64 * 1024 * 1024) {
  if (!formato?.url) return null;
  if (formato.filesize && formato.filesize > maxBytes) return null;
  const r = await axios.get(formato.url, { responseType: 'arraybuffer', timeout: 180000 });
  if (!r.data || r.data.length < 10000 || r.data.length > maxBytes) return null;
  return Buffer.from(r.data);
}
function extrairVideoId(link) {
  const m = link.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// =================== RATE LIMITS ===================
const RATE_LIMIT_MAX = 4;
const RATE_LIMIT_JANELA_MS = 3 * 60 * 1000;
const RATE_LIMIT_EXCLUIR = new Set(['dlt', 'info']);
function verificarRateLimit(senderId, cmd) {
  if (RATE_LIMIT_EXCLUIR.has(cmd)) return { permitido: true };
  const chave = `${senderId}|${cmd}`;
  const agora = Date.now();
  let usos = db.rateLimit.get(chave);
  if (!usos) { usos = [agora]; db.rateLimit.set(chave, usos); return { permitido: true }; }
  let i = 0;
  while (i < usos.length) {
    if (agora - usos[i] >= RATE_LIMIT_JANELA_MS) usos.splice(i, 1);
    else i++;
  }
  if (usos.length >= RATE_LIMIT_MAX) {
    const esperarMs = RATE_LIMIT_JANELA_MS - (agora - usos[0]);
    return { permitido: false, esperarMs };
  }
  usos.push(agora);
  return { permitido: true };
}

const CHAT_LIMITE_MAX = 5;
const CHAT_LIMITE_JANELA_MS = 5 * 60 * 1000;
function verificarLimiteConversaIA(senderId) {
  const chave = `chat|${senderId}`;
  const agora = Date.now();
  let usos = db.rateLimit.get(chave);
  if (!usos) { usos = [agora]; db.rateLimit.set(chave, usos); return { permitido: true }; }
  let i = 0;
  while (i < usos.length) {
    if (agora - usos[i] >= CHAT_LIMITE_JANELA_MS) usos.splice(i, 1);
    else i++;
  }
  if (usos.length >= CHAT_LIMITE_MAX) {
    const esperarMs = CHAT_LIMITE_JANELA_MS - (agora - usos[0]);
    return { permitido: false, esperarMs };
  }
  usos.push(agora);
  return { permitido: true };
}

const MENU_LIMITE_MAX = 2;
const MENU_LIMITE_JANELA_MS = 3 * 60 * 1000;
class PermissaoNegada extends Error {}
const MENU_COMANDOS = new Set(['menu', 'menubtn', 'h', 'help', 'cgeral', 'cadmin', 'cprot', 'cmidia', 'cstick', 'cdono']);

const COMANDO_EMOJIS = {
  menu: '📜', menubtn: '📜', cgeral: '🌐', cadmin: '👮', cprot: '🛡️', cmidia: '📲', cstick: '🖼️', cdono: '👑',
  ping: '🏓', hora: '', info: '💚', alug: '', stg: '💎', comandos: '📋', ranking: '🏆', pontos: '🔢', indicar: '📨',
  ban: '🔨', kick: '👢', up: '⬆️', down: '⬇️', all: '📢', rj: '🚫', hist: '📜', tconta: '',
  close: '🔒', open: '🔓', link: '', tid: '🆔', dlt: '🗑️',
  antil: '🔗', banw: '📵', unbanw: '✅', rg: '', ia: '🧠', auto: '🤖', vrg: '📃', listw: '📃',
  fig: '🎨', sticker: '🎨', stext: '✏️', stinfo: 'ℹ️', modelo: '🖼️',
  tr: '🌍', traduzir: '🌍', t: '🌍', grcb: '💬',
  ativ: '💎', rmvip: '🚫', lsg: '📋', bemv: '', at: '⚡', rmat: '🗑️', lsat: '',
  stats: '📊', relatorio: '🧾', hisr: '📜', prefix: '⚙️', backup: '💾', restore: '♻️',
  l: '⏰', ls: '⏰', ap: '🗑️', limpar: '🧹', wrnvp: '📢',
  offbot: '🔴', onbot: '🟢', ignorar: '🔇', designorar: '🔊', ignorados: '🔇',
  act: '✅', pend: '', notificar: '🔔', estats: '📊',
  tk: '', ig: '📸', yt: '🎬', ytd: '🎵', ytv: '🎥',
  sta: '🎵', stm: '📸', dst: '🚫', listad: '📃', actcmd: '✅',
  vp: '👑', meuvip: '💎', id: '🆔'
};

function verificarLimiteMenu(senderId, cmd) {
  const chave = `menu|${senderId}|${cmd}`;
  const agora = Date.now();
  let usos = db.rateLimit.get(chave);
  if (!usos) { usos = [agora]; db.rateLimit.set(chave, usos); return { permitido: true }; }
  let i = 0;
  while (i < usos.length) {
    if (agora - usos[i] >= MENU_LIMITE_JANELA_MS) usos.splice(i, 1);
    else i++;
  }
  if (usos.length >= MENU_LIMITE_MAX) {
    const esperarMs = MENU_LIMITE_JANELA_MS - (agora - usos[0]);
    return { permitido: false, esperarMs };
  }
  usos.push(agora);
  return { permitido: true };
}

const NIVEIS_VIP = {
  ouro:     { nome: 'Ouro 🥇',     maxDias: 7,  admin: true,  ban: true,  promote: false, rules: false, anti: false, boasvindas: false, sticker: false },
  diamante: { nome: 'Diamante 💎', maxDias: 30, admin: true,  ban: true,  promote: true,  rules: true,  anti: true,  boasvindas: true,  sticker: true  },
  lenda:    { nome: 'Lenda 👑',    maxDias: 60, admin: true,  ban: true,  promote: true,  rules: true,  anti: true,  boasvindas: true,  sticker: true  }
};
const RANK_VIP = { ouro: 1, diamante: 2, lenda: 3 };

const NIVEIS_VIP_USER = {
  ouro:     { nome: 'Ouro 🥇',     maxDias: 7,  cmds: ['tk'] },
  diamante: { nome: 'Diamante 💎', maxDias: 30, cmds: ['tk', 'ig'] },
  lenda:    { nome: 'Lenda 👑',    maxDias: 60, cmds: ['tk', 'ig', 'yt', 'ytd', 'ytv'] }
};

// =================== PERSISTÊNCIA DO BOT ===================
function carregarDados() {
  try {
    const dir = path.dirname(CONFIG.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(CONFIG.dataFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
      if (data.gruposVIP)       for (const [k, v] of Object.entries(data.gruposVIP))       db.gruposVIP.set(k, v);
      if (data.grupoDono)       for (const [k, v] of Object.entries(data.grupoDono))       db.grupoDono.set(k, v);
      if (data.atalhos)         for (const [k, v] of Object.entries(data.atalhos))         db.atalhos.set(k, v);
      if (data.antiLink)        for (const [k, v] of Object.entries(data.antiLink))        db.grupos.antiLink.set(k, v);
      if (data.palavrasBanidas) for (const [k, v] of Object.entries(data.palavrasBanidas)) db.grupos.palavrasBanidas.set(k, v);
      if (data.boasvindas)      for (const [k, v] of Object.entries(data.boasvindas))      db.grupos.boasvindas.set(k, v);
      if (data.regras)          for (const [k, v] of Object.entries(data.regras))          db.grupos.regras.set(k, v);
      if (data.banidos)         for (const [k, v] of Object.entries(data.banidos))         db.grupos.banidos.set(k, v);
      if (data.iaAtivo)         for (const id of data.iaAtivo)                              db.grupos.iaAtivo.add(id);
      if (data.desligados)      for (const id of data.desligados)                           db.grupos.desligados.add(id);
      if (data.ignorados)       for (const id of data.ignorados)                            db.ignorados.add(id);
      if (data.transacoes)      for (const [k, v] of Object.entries(data.transacoes))      db.grupos.transacoes.set(k, v);
      if (data.whitelist)       for (const [k, v] of Object.entries(data.whitelist))       db.whitelist.set(k, new Set(v));
      if (data.autoDelete)      for (const [k, v] of Object.entries(data.autoDelete))      db.autoDelete.set(k, v);
      if (data.indicadores)     for (const [k, v] of Object.entries(data.indicadores))     db.indicadores.set(k, v);
      if (data.stats)           for (const [k, v] of Object.entries(data.stats))           db.stats.set(k, v);
      if (data.notifications)   for (const [k, v] of Object.entries(data.notifications))   db.notifications.set(k, v);
      if (Array.isArray(data.lembretes)) db.lembretes = data.lembretes;
      if (data.prefixo)         CONFIG.prefix = data.prefixo;
      if (data.usersVIP) for (const [k, v] of Object.entries(data.usersVIP)) db.usersVIP.set(k, v);
      if (data.comandosDesativados) for (const [k, v] of Object.entries(data.comandosDesativados)) db.grupos.comandosDesativados.set(k, new Set(v));
      if (data.audioGatilhos) for (const [k, v] of Object.entries(data.audioGatilhos)) db.grupos.audioGatilhos.set(k, new Map(Object.entries(v).map(([key, val]) => [key, Buffer.from(val, 'base64')])));
      if (data.midiaGatilhos) for (const [k, v] of Object.entries(data.midiaGatilhos)) db.grupos.midiaGatilhos.set(k, new Map(Object.entries(v).map(([key, {buffer, tipo}]) => [key, {buffer: Buffer.from(buffer, 'base64'), tipo}])));
      if (data.midiaComandos) for (const [k, v] of Object.entries(data.midiaComandos)) db.grupos.midiaComandos.set(k, new Map(Object.entries(v).map(([key, {buffer, tipo}]) => [key, {buffer: Buffer.from(buffer, 'base64'), tipo}])));
    }
    if (fs.existsSync(CONFIG.historicoFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.historicoFile, 'utf8'));
      for (const [k, v] of Object.entries(data)) db.historicoGrupos.set(k, v);
    }
  } catch (e) { console.error('Erro ao carregar dados:', e.message); }
}

function salvarDados() {
  try {
    const data = {
      gruposVIP:       Object.fromEntries(db.gruposVIP),
      grupoDono:       Object.fromEntries(db.grupoDono),
      atalhos:         Object.fromEntries(db.atalhos),
      antiLink:        Object.fromEntries(db.grupos.antiLink),
      palavrasBanidas: Object.fromEntries(db.grupos.palavrasBanidas),
      boasvindas:      Object.fromEntries(db.grupos.boasvindas),
      regras:          Object.fromEntries(db.grupos.regras),
      banidos:         Object.fromEntries(db.grupos.banidos),
      iaAtivo:         [...db.grupos.iaAtivo],
      desligados:      [...db.grupos.desligados],
      ignorados:       [...db.ignorados],
      transacoes:      Object.fromEntries(db.grupos.transacoes),
      whitelist:       Object.fromEntries([...db.whitelist].map(([k, s]) => [k, [...s]])),
      autoDelete:      Object.fromEntries(db.autoDelete),
      indicadores:     Object.fromEntries(db.indicadores),
      stats:           Object.fromEntries(db.stats),
      notifications:   Object.fromEntries(db.notifications),
      lembretes:       db.lembretes,
      prefixo:         CONFIG.prefix,
      usersVIP:        Object.fromEntries(db.usersVIP),
      comandosDesativados: Object.fromEntries([...db.grupos.comandosDesativados].map(([k, v]) => [k, [...v]])),
      audioGatilhos:   Object.fromEntries([...db.grupos.audioGatilhos].map(([k, v]) => [k, Object.fromEntries([...v].map(([key, buf]) => [key, buf.toString('base64')]))])),
      midiaGatilhos:   Object.fromEntries([...db.grupos.midiaGatilhos].map(([k, v]) => [k, Object.fromEntries([...v].map(([key, {buffer, tipo}]) => [key, {buffer: buffer.toString('base64'), tipo}]))])),
      midiaComandos:   Object.fromEntries([...db.grupos.midiaComandos].map(([k, v]) => [k, Object.fromEntries([...v].map(([key, {buffer, tipo}]) => [key, {buffer: buffer.toString('base64'), tipo}]))]))
    };
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), 'utf8');
    const historico = Object.fromEntries(db.historicoGrupos);
    fs.writeFileSync(CONFIG.historicoFile, JSON.stringify(historico, null, 2), 'utf8');
    if (global.gc) { try { global.gc(); } catch {} }
  } catch (e) { console.error('Erro ao guardar dados:', e.message); }
}

function registrarAcao(grupo, acao) {
  if (!db.historicoGrupos.has(grupo)) db.historicoGrupos.set(grupo, []);
  const historico = db.historicoGrupos.get(grupo);
  historico.push({ acao, data: new Date().toISOString() });
  if (historico.length > 15) historico.shift();
  salvarDados();
}
carregarDados();

// =================== UTILITÁRIOS ===================
const utils = {
  extractIdNumber: (id) => { try { return id.replace(/[^0-9]/g, ''); } catch { return ''; } },
  isOwner: (id) => {
    const n = utils.extractIdNumber(id);
    if (!n) return false;
    if (cacheDonoLid.has(id)) return true;
    return n === CONFIG.ownerId || n.endsWith(CONFIG.ownerNumber);
  },
  escapeXml: (str) => String(str).replace(/[<>&'"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', "'":'&#39;', '"':'&quot;' }[c])),
  isGroupSubscribed: (groupId) => {
    const sub = db.gruposVIP.get(groupId);
    if (!sub) return false;
    if (sub.expiraEm < Date.now()) {
      db.gruposVIP.delete(groupId);
      db.grupoDono.delete(groupId);
      salvarDados();
      return false;
    }
    return true;
  },
  getGroupSubscription: (groupId) => db.gruposVIP.get(groupId) || null,
  isSenderGroupAdmin: async (sock, groupId, senderId) => {
    try {
      const metadata = await getMetadataCached(sock, groupId);
      const senderNum = utils.extractIdNumber(senderId);
      const p = metadata.participants.find(part => {
        if (part.id === senderId) return true;
        return Object.values(part).some(v => typeof v === 'string' && v.includes('@') && utils.extractIdNumber(v) === senderNum);
      });
      return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
    } catch { return false; }
  },
  isBotGroupAdmin: async (sock, groupId) => {
    try {
      const metadata = await getMetadataCached(sock, groupId);
      const botId = sock.user.id;
      const botNum = utils.extractIdNumber(botId);
      const p = metadata.participants.find(part => {
        if (part.id === botId || part.id.startsWith(botId.split(':')[0])) return true;
        return Object.values(part).some(v => typeof v === 'string' && v.includes('@') && utils.extractIdNumber(v) === botNum);
      });
      return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
    } catch { return false; }
  },
  hasGroupAdminRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    return utils.isSenderGroupAdmin(sock, groupId, senderId);
  },
  hasBanRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    if (!(await utils.isSenderGroupAdmin(sock, groupId, senderId))) return false;
    const sub = utils.getGroupSubscription(groupId);
    return sub ? NIVEIS_VIP[sub.nivel].ban : false;
  },
  hasPromoteRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    if (!(await utils.isSenderGroupAdmin(sock, groupId, senderId))) return false;
    const sub = utils.getGroupSubscription(groupId);
    return sub ? NIVEIS_VIP[sub.nivel].promote : false;
  },
  hasRulesRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    if (!(await utils.isSenderGroupAdmin(sock, groupId, senderId))) return false;
    const sub = utils.getGroupSubscription(groupId);
    return sub ? NIVEIS_VIP[sub.nivel].rules : false;
  },
  hasAntiRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    if (!(await utils.isSenderGroupAdmin(sock, groupId, senderId))) return false;
    const sub = utils.getGroupSubscription(groupId);
    return sub ? NIVEIS_VIP[sub.nivel].anti : false;
  },
  hasBoasvindasRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    if (!(await utils.isSenderGroupAdmin(sock, groupId, senderId))) return false;
    const sub = utils.getGroupSubscription(groupId);
    return sub ? NIVEIS_VIP[sub.nivel].boasvindas : false;
  },
  hasStickerRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    if (!(await utils.isSenderGroupAdmin(sock, groupId, senderId))) return false;
    const sub = utils.getGroupSubscription(groupId);
    return sub ? NIVEIS_VIP[sub.nivel].sticker : false;
  },
  extractText: (msg) => {
    try {
      const nativeFlow = msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage;
      if (nativeFlow?.paramsJson) {
        try { const params = JSON.parse(nativeFlow.paramsJson); if (params?.id) return params.id; } catch {}
      }
      const botaoId = msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.templateButtonReplyMessage?.selectedId;
      if (botaoId) return botaoId;
      const listaId = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
      if (listaId) return listaId;
      return msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || msg.message?.documentMessage?.caption || "";
    } catch { return ""; }
  },
  getQuotedMention: (msg) => { try { return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]; } catch { return null; } },
  getMentions: (msg) => { try { return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []; } catch { return []; } },
  mensagemSemVIP: () => `❌ *Acesso negado!*\n\nEste grupo não possui assinatura ativa.\n\n📞 Contacte: ${CONFIG.creator} - ${CONFIG.ownerNumber}`,
  checkGroupExpired: async (sock, groupId) => {
    const sub = db.gruposVIP.get(groupId);
    if (sub && sub.expiraEm < Date.now()) {
      db.gruposVIP.delete(groupId);
      db.grupoDono.delete(groupId);
      salvarDados();
      try {
        const metadata = await sock.groupMetadata(groupId);
        const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
        await sock.sendMessage(groupId, { text: `⚠️ Assinatura do grupo *${metadata.subject}* expirou!\nContacte ${CONFIG.creator}: ${CONFIG.ownerNumber}`, mentions: admins });
      } catch {}
      return true;
    }
    return false;
  },
  tempoRestante: (ms) => {
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  },
  reagir: async (sock, msg, emoji) => {
    try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }); } catch {}
  },
  adicionarMetadadosSticker: async (buffer, packname, author) => {
    try {
      const img = new WebpImage();
      await img.load(buffer);
      const exifJson = { 'sticker-pack-id': `nanobot-${Date.now()}`, 'sticker-pack-name': packname, 'sticker-pack-publisher': author, emojis: ['🤖'] };
      const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
      const jsonBuffer = Buffer.from(JSON.stringify(exifJson), 'utf-8');
      const exif = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);
      img.exif = exif;
      const resultado = await img.save(null);
      const pareceWebpValido = Buffer.isBuffer(resultado) && resultado.length > 12 && resultado.subarray(0, 4).toString('ascii') === 'RIFF' && resultado.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!pareceWebpValido) return buffer;
      return resultado;
    } catch (e) { return buffer; }
  }
};

// ✅ FIX DONO: cache de LIDs já validados como sendo do dono
const cacheDonoLid = new Set();

async function resolverIdDono(sock, chatId, senderId) {
  if (utils.isOwner(senderId)) return senderId;
  if (!chatId?.endsWith('@g.us')) return senderId;
  try {
    const meta = await sock.groupMetadata(chatId);
    const p = (meta.participants || []).find(pt => pt.id === senderId);
    if (!p) return senderId;
    const campos = [p.phoneNumber, p.jid, p.lid, p.pn].filter(Boolean);
    if (campos.some(c => utils.extractIdNumber(c).endsWith(CONFIG.ownerNumber))) {
      cacheDonoLid.add(senderId);
      console.log(`✅ LID do dono reconhecido: ${senderId}`);
    }
  } catch {}
  return senderId;
}

function verificarVIPUser(senderId, cmd) {
  if (utils.isOwner(senderId)) return true;
  const vip = db.usersVIP.get(senderId);
  if (!vip) return false;
  if (vip.expiraEm < Date.now()) {
    db.usersVIP.delete(senderId);
    salvarDados();
    return false;
  }
  const nivel = NIVEIS_VIP_USER[vip.nivel];
  return nivel && nivel.cmds.includes(cmd);
}// =================== IA (com fallback automático de modelos) ===================
const GROQ_MODELOS_FALLBACK = [
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b'
];

async function askGroq(chatId, userText, isOwner = false, isGrupo = false) {
  const iaAtiva = db.grupos.iaAtivo.has(chatId);
  if (!isOwner && isGrupo && !iaAtiva) {
    const palavrasChave = ['grupo', 'vip', 'ativo', 'antilink', 'status', 'assinatura', 'bot', 'nano'];
    const temPalavraChave = palavrasChave.some(p => userText.toLowerCase().includes(p));
    if (!temPalavraChave) return null;
  }
  if (!db.historicoIA.has(chatId)) db.historicoIA.set(chatId, []);
  const history = db.historicoIA.get(chatId);
  history.push({ role: 'user', content: userText });
  if (history.length > 10) history.shift();
  db.historicoIAUltimoUso.set(chatId, Date.now());
  try {
    const totalVip = db.gruposVIP.size;
    let infoSistema = `ESTADO DO SISTEMA:\n- Grupos VIP activos: ${totalVip}\n`;
    if (db.grupos.antiLink.size > 0) infoSistema += `- Anti-link activo em ${db.grupos.antiLink.size} grupos\n`;
    else infoSistema += `- Anti-link: inactivo\n`;
    const totalPalavras = [...db.grupos.palavrasBanidas.values()].reduce((a, v) => a + v.length, 0);
    infoSistema += `- Palavras banidas: ${totalPalavras} palavras em ${db.grupos.palavrasBanidas.size} grupos\n`;
    infoSistema += `- IA activa em ${db.grupos.iaAtivo.size} grupos\n`;
    infoSistema += `- Uptime: ${Math.floor(process.uptime() / 60)} minutos\n`;
    let systemMsg;
    if (!isGrupo) {
      systemMsg = `Chamas-te ${CONFIG.botName}, és um assistente de WhatsApp criado por ${CONFIG.creator}.\nPERSONALIDADE:\nSimpático, directo e prestável\nFalas português de Moçambique\nRespondes de forma concisa e clara\nPodes responder a qualquer tipo de pergunta: curiosidades, traduções, cálculos, conselhos, receitas, etc.\nNunca inventas factos — se não souberes, dizes claramente\n${infoSistema}\nPrefixo de comandos: ${CONFIG.prefix}`;
      if (isOwner) systemMsg += `\n\nO DONO está a falar contigo — podes partilhar detalhes do sistema.`;
    } else {
      systemMsg = `Chamas-te ${CONFIG.botName}, és um assistente de WhatsApp criado por ${CONFIG.creator}.\nPERSONALIDADE:\nSimpático, directo e útil\nFalas português de Moçambique\nRespondes de forma concisa (máx. 3 frases)\nNunca inventas informações\n${iaAtiva ? 'IA LIVRE ACTIVADA: responde a qualquer pergunta de forma útil e amigável.' : 'MODO RESTRITO: só responde sobre o sistema do bot.'}\n${infoSistema}\nPrefixo de comandos: ${CONFIG.prefix}`;
      if (isOwner) systemMsg += `\n\nO DONO está a falar contigo — podes dar informações mais detalhadas.`;
    }
    const modelos = [CONFIG.groq_model, process.env.GROQ_MODEL, ...GROQ_MODELOS_FALLBACK]
      .filter((m, i, arr) => m && arr.indexOf(m) === i);
    let resposta = null;
    let ultimoErro = null;
    for (const modelo of modelos) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'system', content: systemMsg }, ...history],
          model: modelo,
          temperature: 0.5,
          max_tokens: 250
        });
        resposta = completion.choices[0]?.message?.content?.trim();
        CONFIG.groq_model = modelo;
        break;
      } catch (e) {
        ultimoErro = e;
        console.warn(`⚠️ Modelo Groq "${modelo}" falhou: ${String(e.message).substring(0, 140)}`);
      }
    }
    if (!resposta) {
      if (ultimoErro?.message?.includes('rate')) return '⏳ Muitas perguntas! Aguarda um momento.';
      if (ultimoErro?.message?.includes('auth') || ultimoErro?.message?.includes('key')) return '❌ Chave Groq inválida.';
      return ' Erro ao processar. Tenta novamente.';
    }
    history.push({ role: 'assistant', content: resposta });
    return resposta;
  } catch (err) {
    return '❌ Erro ao processar. Tenta novamente.';
  }
}

// =================== CARTÃO DE BOAS-VINDAS ===================
async function gerarCartaoBoasVindas(sock, participant, groupName) {
  try {
    const caminhoBanner = path.join(__dirname, 'data', 'banners', 'boas_vindas.png');
    if (!fs.existsSync(caminhoBanner)) return null;
    let base = fs.readFileSync(caminhoBanner);
    try {
      const ppUrl = await sock.profilePictureUrl(participant, 'image');
      if (ppUrl) {
        const resp = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 5000 });
        const maskSvg = `<svg width="120" height="120"><circle cx="60" cy="60" r="60" fill="white"/></svg>`;
        const avatar = await sharp(Buffer.from(resp.data))
          .resize(120, 120, { fit: 'cover' })
          .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
          .png().toBuffer();
        base = await sharp(base).composite([{ input: avatar, top: 180, left: 340 }]).png().toBuffer();
      }
    } catch {}
    return base;
  } catch (e) { return null; }
}

// =================== SISTEMA DE TRANSAÇÕES ===================
function getTransacoesGrupo(groupId) {
  if (!db.grupos.transacoes.has(groupId)) {
    db.grupos.transacoes.set(groupId, { ativo: false, contador: 0, pedidos: {}, contas: [] });
  }
  const dados = db.grupos.transacoes.get(groupId);
  if (!dados.contas) dados.contas = [];
  return dados;
}

function detectarComprovativo(texto) {
  if (!texto) return null;
  let m = texto.match(REGEX_EMOLA);
  if (m) return { tipo: 'E-Mola', idTransacao: m[1], valor: m[2].replace(',', '.'), contaDestino: m[3], nomeDestino: m[4]?.trim() };
  m = texto.match(REGEX_MPESA);
  if (m) return { tipo: 'M-Pesa', idTransacao: m[1], valor: m[2].replace(',', '.'), contaDestino: m[3] };
  return null;
}

async function localizarPedidoPendente(sock, senderId, numero) {
  const isOwner = utils.isOwner(senderId);
  const candidatos = [];
  for (const [groupId, dados] of db.grupos.transacoes.entries()) {
    const pedido = dados.pedidos?.[numero];
    if (!pedido || pedido.status !== 'pendente') continue;
    if (isOwner) { candidatos.push(groupId); continue; }
    const sub = utils.getGroupSubscription(groupId);
    if (!sub || (RANK_VIP[sub.nivel] || 0) < 2) continue;
    const ehAdmin = await utils.isSenderGroupAdmin(sock, groupId, senderId);
    if (ehAdmin) candidatos.push(groupId);
  }
  return candidatos;
}

async function listarGruposGeriveis(sock, senderId) {
  const isOwner = utils.isOwner(senderId);
  const grupos = [];
  for (const [groupId] of db.grupos.transacoes.entries()) {
    if (isOwner) { grupos.push(groupId); continue; }
    const sub = utils.getGroupSubscription(groupId);
    if (!sub || (RANK_VIP[sub.nivel] || 0) < 2) continue;
    const ehAdmin = await utils.isSenderGroupAdmin(sock, groupId, senderId);
    if (ehAdmin) grupos.push(groupId);
  }
  return grupos;
}

async function gerarBlocosRelatorio(sock) {
  const gruposInfo = await sock.groupFetchAllParticipating();
  const grupoIds = Object.keys(gruposInfo);
  if (!grupoIds.length) return ['O bot não está em nenhum grupo no momento.'];
  const blocos = [];
  for (const groupId of grupoIds) {
    const nome = gruposInfo[groupId]?.subject || groupId;
    const sub = db.gruposVIP.get(groupId);
    let vipTexto = '🚫 Sem assinatura';
    if (sub) {
      const restante = sub.expiraEm - Date.now();
      vipTexto = restante > 0 ? `${NIVEIS_VIP[sub.nivel]?.nome || sub.nivel} — expira em ${utils.tempoRestante(restante)}` : '⌛ Expirado';
    }
    const antiLinkModo = db.grupos.antiLink.get(groupId);
    const palavras = db.grupos.palavrasBanidas.get(groupId) || [];
    const transacoes = db.grupos.transacoes.get(groupId);
    const banidos = db.grupos.banidos.get(groupId) || [];
    const autoDel = db.autoDelete.get(groupId);
    blocos.push(
`━━━━━━━━━━━━━━━━━━━
🏷️ *${nome}*
💎 VIP: ${vipTexto}
🔗 Anti-link: ${antiLinkModo ? `✅ (${antiLinkModo})` : ''}
🤖 IA livre: ${db.grupos.iaAtivo.has(groupId) ? '✅' : '❌'}
🚫 Palavras banidas: ${palavras.length}
👋 Boas-vindas: ${db.grupos.boasvindas.has(groupId) ? '✅' : '❌'}
📜 Regras definidas: ${db.grupos.regras.has(groupId) ? '✅' : '❌'}
💰 Transações: ${transacoes?.ativo ? `✅ (${transacoes.contador} pedido(s), ${transacoes.contas?.length || 0} conta(s))` : '❌'}
🗑️ Auto-delete: ${autoDel ? `✅ (${autoDel}ms)` : ''}
⛔ Banidos registados: ${banidos.length}`
    );
  }
  return [`📊 *RELATÓRIO COMPLETO* — ${grupoIds.length} grupo(s)\n`, ...blocos];
}

async function enviarRelatorioCompleto(sock, chatId) {
  const partes = await gerarBlocosRelatorio(sock);
  const porMensagem = 3;
  for (let i = 1; i < partes.length; i += porMensagem) {
    const texto = (i === 1 ? partes[0] : '') + partes.slice(i, i + porMensagem).join('\n');
    await sock.sendMessage(chatId, { text: texto });
  }
  if (partes.length === 1) await sock.sendMessage(chatId, { text: partes[0] });
}

function pareceIntentoRelatorio(texto) {
  const t = texto.toLowerCase();
  return /grupo/.test(t) && /status|relat[oó]rio|resumo|situa[cç][aã]o|geri[rs]|administr/.test(t);
}
function pareceIntentoSairGrupo(texto) {
  const t = texto.toLowerCase();
  return /\b(sai|saia|sair|retira-?te|vai\sembora|desliga-?te)\b.\b(grupo|daqui)\b/.test(t) || /\b(sai|saia|pode\sir)\sembora\b/.test(t);
}
function pareceIntentoBanir(texto) {
  const t = texto.toLowerCase();
  return /\b(bane|banir|expulsa|expulsar|remove|tira|silencia|silenciar|cala)\b/.test(t);
}
function pareceIntentoFecharGrupo(texto) { const t = texto.toLowerCase(); return /\bfecha(r)?\b.*\bgrupo\b/.test(t); }
function pareceIntentoAbrirGrupo(texto) { const t = texto.toLowerCase(); return /\b(abre|abrir)\b.*\bgrupo\b/.test(t); }
function pareceIntentoApagarMensagem(texto) { const t = texto.toLowerCase(); return /\b(apaga|apagar|deleta|deletar|remove)\b/.test(t); }
function pareceIntentoQuemDono(texto) {
  const t = texto.toLowerCase();
  return /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\sdono/.test(t) || /quem\s+te\s+criou/.test(t) || /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\scriador/.test(t);
}

// =================== SISTEMA DE LEMBRETES ===================
function interpretarDataHora(args) {
  const agora = new Date();
  const juntar = (n) => args.slice(0, n).join(' ');
  let m = juntar(2).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const [, dia, mes, ano, h, min] = m;
    const anoFinal = ano ? (ano.length === 2 ? 2000 + parseInt(ano) : parseInt(ano)) : agora.getFullYear();
    const data = new Date(anoFinal, parseInt(mes) - 1, parseInt(dia), parseInt(h), parseInt(min), 0, 0);
    if (!ano && data < agora) data.setFullYear(data.getFullYear() + 1);
    return { data, consumidos: 2 };
  }
  m = juntar(2).match(/^amanh[ãa]\s+(\d{1,2}):(\d{2})$/i);
  if (m) {
    const data = new Date(agora);
    data.setDate(data.getDate() + 1);
    data.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
    return { data, consumidos: 2 };
  }
  m = juntar(2).match(/^(\d+)\s*(minutos?|mins?)$/i);
  if (m) return { data: new Date(agora.getTime() + parseInt(m[1]) * 60000), consumidos: 2 };
  m = juntar(2).match(/^(\d+)\s*(horas?|hs?)$/i);
  if (m) return { data: new Date(agora.getTime() + parseInt(m[1]) * 3600000), consumidos: 2 };
  m = juntar(2).match(/^(\d+)\s*(dias?|d)$/i);
  if (m) return { data: new Date(agora.getTime() + parseInt(m[1]) * 86400000), consumidos: 2 };
  m = juntar(1).match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const data = new Date(agora);
    data.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
    if (data <= agora) data.setDate(data.getDate() + 1);
    return { data, consumidos: 1 };
  }
  return null;
}

function gerarCartaoApresentacao() {
  return `╔══════════════════════════════╗
║ 💚 NANO BOT 🤖 
║ Criado por Yanik Uaite 
╚══════════════════════════════╝

📌 *SOBRE MIM:*
Sou um assistente pessoal criado para auxiliar em tarefas diárias, estudos e organização.

✨ *O QUE EU FAÇO:*
├─ Gestão e proteção de grupos
├─ Assinaturas VIP para grupos
├─ Sistema de pagamentos E-Mola/M-Pesa
├─ Downloads (TikTok, Instagram, YouTube)
├─ Tradutor de texto
└─ Loja Yanikzx9 Store

 *CONTACTO DO CRIADOR:*
✆ 834788141
 yanikuaite@gmail.com

💚 Obrigado por entrar em contato!

╔══════════════════════════════╗
║ 💚 NANO BOT 🤖 2026 ║
══════════════════════════════╝`;
}

function gerarCartaoVipAtivo(sub) {
  const dias = Math.max(0, Math.ceil((sub.expiraEm - Date.now()) / 86400000));
  const nivel = NIVEIS_VIP[sub.nivel]?.nome || sub.nivel;
  return `╔══════════════════════════════╗
 N A N O B O T 🤖 
╚══════════════════════════════╝

💎 *STATUS VIP DESTE GRUPO*
─────────────────────────────

✅ Este grupo tem o plano *${nivel}* activo!
 Dias restantes: *${dias}*

Para renovar, contacta o dono:
✆ 834788141
 yanikuaite@gmail.com

◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈
💚 Obrigado por confiares no Nano Bot!
◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
}

function gerarCartaoVipConvite() {
  return `╔══════════════════════════════╗
◈ N A N O B O T 🤖 
╚══════════════════════════════╝

💎 *ACTIVA O VIP NESTE GRUPO!*
─────────────────────────────

Este grupo ainda não tem uma assinatura VIP activa.

Com o VIP desbloqueias:
├─ Administração automática
├─ Anti-link e protecção
─ Boas-vindas personalizadas
├─ Auto-replies e regras
└─ Sistema de pagamentos

Fala com o dono para activares:
✆ 834788141
📧 yanikuaite@gmail.com

◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈
 Desbloqueia todo o potencial!
◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
}

// =================== MENUS ===================
async function enviarMenuComBotoes(sock, jid, senderId) {
  const isGroup = jid.endsWith('@g.us');
  const ctxFallback = { chatId: jid, args: [], senderId, isGroup };
  await commands['menu'](sock, ctxFallback);
}

async function enviarSubmenuBotoes(sock, jid, { corpo }) {
  await sock.sendMessage(jid, { text: corpo });
}

const commands = {
  _getPerms: async (sock, ctx) => {
    const isOwner = utils.isOwner(ctx.senderId);
    const isGroupAdmin = ctx.isGroup ? await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId) : false;
    const sub = ctx.isGroup ? utils.getGroupSubscription(ctx.chatId) : null;
    const vip = sub ? NIVEIS_VIP[sub.nivel] : null;
    return {
      isOwner, isGroupAdmin, vip, sub,
      nivelNome: vip ? vip.nome : null,
      pAdmin: isOwner || (isGroupAdmin && !!vip?.admin),
      pBan: isOwner || (isGroupAdmin && !!vip?.ban),
      pPromote: isOwner || (isGroupAdmin && !!vip?.promote),
      pAnti: isOwner || (isGroupAdmin && !!vip?.anti),
      pRules: isOwner || (isGroupAdmin && !!vip?.rules),
      pBemv: isOwner || (isGroupAdmin && !!vip?.boasvindas),
      pSticker: isOwner || (isGroupAdmin && !!vip?.sticker),
      pTransacoes: isOwner || (isGroupAdmin && !!sub && (RANK_VIP[sub.nivel] || 0) >= 2),
    };
  },

  'menubtn': async (sock, ctx) => { await enviarMenuComBotoes(sock, ctx.chatId, ctx.senderId); },

  'menu': async (sock, ctx) => {
    const nome = ctx.senderId.split('@')[0];
    const p = await commands._getPerms(sock, ctx);
    const cats = [];
    cats.push(`▸ .cgeral — 🌐 Geral`);
    if (p.pAdmin || p.pBan || p.pPromote) cats.push(`▸ .cadmin — 👮 Administração`);
    if (p.pAnti || p.pRules || p.pBemv) cats.push(`▸ .cprot — 🛡️ Proteção`);
    cats.push(`▸ .cmidia — 📲 Mídia & Utilitários`);
    if (p.pSticker) cats.push(`▸ .cstick — 🎨 Stickers`);
    if (p.isOwner) cats.push(`▸ .cdono — 👑 Dono`);
    if (cats.length) cats[cats.length - 1] = cats[cats.length - 1].replace('▸', '╚▸');
    const nivelLinha = p.nivelNome ? `\n Grupo: ${p.nivelNome}` : (ctx.isGroup ? '\n✦ Grupo sem assinatura' : '');
    const menu = `╔══════════════════════════════╗
 N A N O B O T 🤖 
✦ by ${CONFIG.creator} ✦
╚══════════════════════════════╝

👤 Olá, @${nome}!${nivelLinha}

⬡ ─── ESCOLHE UMA CATEGORIA ─── ⬡
${cats.join('\n')}

◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈
✦ ${CONFIG.botName} | Prefixo: ${CONFIG.prefix}
📱 Suporte: ${CONFIG.ownerNumber}
◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await sock.sendMessage(ctx.chatId, { text: menu, mentions: [ctx.senderId] });
  },

  'h': async (sock, ctx) => commands['menu'](sock, ctx),
  'help': async (sock, ctx) => commands['menu'](sock, ctx),

  'cgeral': async (sock, ctx) => {
    const corpo = `╔══════════════════════════════╗
◈ N A N O B O T 🤖 ◈
╚══════════════════════════════╝

➤ *COMANDOS GERAIS*
─────────────────────────────

▸ .menu ─ Menu principal
▸ .help └─ Menus do bot
▸ .info └─ Estado do bot
▸ .ping ─ Latência
▸ .hora └─ Hora Maputo
▸ .alug └─ Alugar bot
▸ .stg └─ Estado assinatura
▸ .comandos └─ Lista de comandos
▸ .indicar └─ Ganhar pontos
▸ .ranking └─ Top indicadores
╚▸ .pontos └─ Meus pontos

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: ' Geral', corpo, comandos: [] });
  },

  'cadmin': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAdmin && !p.pBan && !p.pPromote && !p.pTransacoes) throw new PermissaoNegada();
    let texto = `╔══════════════════════════════╗
◈ N A N O B O T 🤖 ◈
╚══════════════════════════════╝

➤ 👮 *ADMINISTRAÇÃO*
─────────────────────────────
`;
    const botoes = [];
    if (p.pAdmin) {
      texto += `\n▸ .all [msg] └─ Marcar todos\n▸ .close └─ Fechar grupo\n▸ .open └─ Abrir grupo\n▸ .link └─ Link convite\n▸ .tid └─ ID do grupo\n▸ .dlt └─ Apagar msg\n`;
      botoes.push({ id: '.close', texto: '🔒 Fechar' }, { id: '.open', texto: '🔓 Abrir' }, { id: '.link', texto: ' Link' }, { id: '.tid', texto: '🆔 ID' });
    }
    if (p.pBan) {
      texto += `\n▸ .ban @user └─ Banir\n▸ .kick @user └─ Expulsar\n▸ .listb └─ Ver banidos\n`;
      botoes.push({ id: '.listb', texto: '📵 Banidos' });
    }
    if (p.pPromote) {
      texto += `\n▸ .up @user └─ Promover\n▸ .down @user └─ Rebaixar\n`;
    }
    if (p.pTransacoes) {
      texto += `\n▸ .t on/off └─ Sistema pagamentos\n▸ .tconta └─ Contas destino\n▸ .act [nº] └─ Aprovar pedido\n▸ .rj [nº] └─ Rejeitar pedido\n▸ .pend └─ Ver pendentes\n▸ .hist @u └─ Histórico\n`;
      botoes.push({ id: '.pend', texto: '⏳ Pendentes' });
    }
    texto += `\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: '👮 Admin', corpo: texto, comandos: botoes });
  },

  'cprot': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAnti && !p.pRules && !p.pBemv) throw new PermissaoNegada();
    let texto = `══════════════════════════════╗
 N A N O B O T 🤖 
╚══════════════════════════════╝

➤ 🛡️ *PROTECÇÃO*
─────────────────────────────
`;
    if (p.pAnti) texto += `\n▸ .antil [modo/off]\n▸ .auto [tempo|off]\n▸ .banw [palavra]\n▸ .unbanw [palavra]\n▸ .listw\n`;
    if (p.pRules) texto += `\n▸ .rg [regras]\n▸ .vrg\n`;
    if (p.pAnti || p.pRules) texto += `\n▸ .ia on/off\n`;
    texto += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: '🛡️ Proteção', corpo: texto, comandos: [] });
  },

  'cmidia': async (sock, ctx) => {
    const corpo = `╔══════════════════════════════╗
◈ N A N O B O T 🤖 ◈
╚══════════════════════════════╝

 📲 *MÍDIA & UTILITÁRIOS*
─────────────────────────────

 .traduzir [texto]
▸ .tr [texto]
▸ .tk [link] └─ TikTok
▸ .ig [link] └─ Instagram
▸ .yt [pesquisa] └─ YouTube
▸ .ytd [link] └─ YT áudio
▸ .ytv [link] └─ YT vídeo
▸ .grcb [nível] [dias] [nº]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: ' Mídia', corpo, comandos: [] });
  },

  'cstick': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pSticker) throw new PermissaoNegada();
    const corpo = `╔══════════════════════════════╗
◈ N A N O B O T 🤖 ◈
╚══════════════════════════════╝

 *STICKERS*
─────────────────────────────

▸ .fig
▸ .stext [texto]
▸ .stinfo
╚▸ .sticker

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: '🎨 Stickers', corpo, comandos: [] });
  },

  'cdono': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const corpo = `══════════════════════════════╗
 N A N O B O T 🤖 
╚══════════════════════════════╝

👑 *PAINEL DO DONO*
─────────────────────────────

▸ .ativ [nível] [dias]
▸ .rmvip
▸ .lsg
▸ .bemv [texto/off]
▸ .at [nome] [texto]
▸ .rmat [nome]
▸ .lsat
▸ .stats
▸ .relatorio
▸ .hisr
▸ .prefix [novo]
▸ .backup / .restore
▸ .l [hora] [texto]
▸ .ls / .ap / .limpar
▸ .wrnvp all
▸ .offbot / .onbot
▸ .ignorar / .designorar
 .vp @user [nivel] [dias]
╚▸ .ignorados

◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: '👑 Dono', corpo, comandos: [] });
  },

  'ping': async (sock, ctx) => {
    const inicio = Date.now();
    await sock.sendMessage(ctx.chatId, { text: '🏓 *Pong!*' });
    const latencia = Date.now() - inicio;
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🏓 *PING*\n┃\n┃ ⚡ Latência: ${latencia}ms\n┃ 🟢 Bot online\n━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  'hora': async (sock, ctx) => {
    const agora = new Date();
    const hora = agora.toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const data = agora.toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    await sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🕐 *HORA ACTUAL*\n┃\n┃ ⏰ ${hora}\n 📅 ${data}\n┃ 🌍 Maputo (CAT)\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  'tid': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━\n┃ 🆔 *ID DO CHAT*\n┃\n┃ \`${ctx.chatId}\`\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  'id': async (sock, ctx) => {
    const botId = sock.user?.id || 'Desconhecido';
    const botNumber = botId.split('@')[0];
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🆔 *INFORMAÇÃO DE IDs*\n┃\n┃ 🤖 Bot:\n┃ JID: \`${botId}\`\n┃ Número: ${botNumber}\n┃\n 👑 Dono (CONFIG):\n┃ ownerId: \`${CONFIG.ownerId}\`\n ownerNumber: \`${CONFIG.ownerNumber}\`\n┃\n┃ 👤 Tu (quem pediu):\n┃ Teu ID: \`${ctx.senderId}\`\n┃ É dono? ${utils.isOwner(ctx.senderId) ? '✅ SIM' : '❌ NÃO'}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  'info': async (sock, ctx) => {
    const totalVip = db.gruposVIP.size;
    const antiLinkAtivo = db.grupos.antiLink.size;
    const uptime = utils.tempoRestante(process.uptime() * 1000);
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━\n┃ 💚 *${CONFIG.botName}*\n┃ 👤 ${CONFIG.creator}\n┃ 📱 ${CONFIG.ownerNumber}\n ⚡ Prefixo: ${CONFIG.prefix}\n┃ 🤖 Status: 🟢 Online\n┃ ⏱️ Uptime: ${uptime}\n┃\n┃ 📊 *SISTEMA*\n┃ ├─ VIPs activos: ${totalVip}\n┃ ├─ Anti-link: ${antiLinkAtivo > 0 ? `✅ ${antiLinkAtivo} grupos` : '❌ Inactivo'}\n┃ ├─ IA activa: ${db.grupos.iaAtivo.size} grupos\n┃ └─ Palavras banidas: ${db.grupos.palavrasBanidas.size} grupos\n━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  'alug': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━\n┃ 💰 *ALUGUER DO BOT*\n┃\n┃ 📦 *Planos:*\n┃ ├─  Ouro - 7 dias\n┃ ├─  Diamante - 30 dias\n┃ ─ 👑 Lenda - 60 dias\n┃\n┃ 📞 ${CONFIG.creator}\n┃ 📱 ${CONFIG.ownerNumber}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  'stg': async (sock, ctx) => {
    const sub = db.gruposVIP.get(ctx.chatId);
    if (!sub || sub.expiraEm < Date.now()) {
      return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📝 *SEM ASSINATURA*\n┃\n┃ Contacte: ${CONFIG.creator}\n┃ 📱 ${CONFIG.ownerNumber}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    const restante = Math.max(0, sub.expiraEm - Date.now());
    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const nivel = NIVEIS_VIP[sub.nivel];
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💚 *STATUS DA ASSINATURA*\n┃\n┃ 💎 Nível: ${nivel.nome}\n┃ ⏳ Restante: ${d}d ${h}h\n\n┃ 🔑 *Permissões:*\n┃ ├─ Ban: ${nivel.ban ? '✅' : '❌'}\n ├─ Promover: ${nivel.promote ? '✅' : '❌'}\n┃ ├─ Regras: ${nivel.rules ? '✅' : '❌'}\n┃ ├─ Protecção: ${nivel.anti ? '✅' : ''}\n┃ ├─ Boas-vindas: ${nivel.boasvindas ? '✅' : '❌'}\n┃ └─ Stickers: ${nivel.sticker ? '✅' : '❌'}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  'auto': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const mode = ctx.args[0]?.toLowerCase();
    if (!mode) return sock.sendMessage(ctx.chatId, { text: 'Uso: .auto [tempo|off]. Ex: .auto 10s, .auto 5m, .auto off' });
    if (mode === 'off') { db.autoDelete.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⏱️ Auto-delete desativado' }); }
    const parse = (v) => {
      const m = v.match(/^(\d+)(s|m|h)?$/i);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      const u = (m[2] || 's').toLowerCase();
      if (u === 's') return n * 1000;
      if (u === 'm') return n * 60000;
      return n * 3600000;
    };
    const ms = parse(mode);
    if (!ms) return sock.sendMessage(ctx.chatId, { text: 'Formato inválido. Ex: 10s, 5m, 1h' });
    db.autoDelete.set(ctx.chatId, ms);
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `⏱️ Auto-delete ativado: ${mode}` });
  },

  'indicar': async (sock, ctx) => {
    const numero = ctx.args[0];
    if (!numero) return sock.sendMessage(ctx.chatId, { text: 'Uso: .indicar [numero]' });
    const cur = db.indicadores.get(ctx.senderId) || 0;
    db.indicadores.set(ctx.senderId, cur + 1);
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Indicação registada. Pontos: ${cur + 1}` });
  },

  'ranking': async (sock, ctx) => {
    const arr = [...db.indicadores.entries()];
    if (!arr.length) return sock.sendMessage(ctx.chatId, { text: 'Nenhuma indicação registada.' });
    arr.sort((a, b) => b[1] - a[1]);
    const top = arr.slice(0, 10).map((r, i) => `${i + 1}. @${r[0].split('@')[0]} — ${r[1]} pontos`).join('\n');
    await sock.sendMessage(ctx.chatId, { text: `🏆 Ranking:\n${top}`, mentions: arr.slice(0, 10).map(r => r[0]) });
  },

  'pontos': async (sock, ctx) => {
    const pontos = db.indicadores.get(ctx.senderId) || 0;
    await sock.sendMessage(ctx.chatId, { text: ` Tens ${pontos} pontos.` });
  },

  'traduzir': async (sock, ctx) => {
    const all = ctx.args.join(' ');
    if (!all) return sock.sendMessage(ctx.chatId, { text: 'Uso: .traduzir [texto] ou .traduzir [idioma] [texto]' });
    let target = 'pt';
    let text = all;
    const maybe = ctx.args[0];
    if (maybe && maybe.length <= 3 && ctx.args.length > 1) { target = maybe; text = ctx.args.slice(1).join(' '); }
    try {
      const res = await translate(text, { to: target });
      await sock.sendMessage(ctx.chatId, { text: `🌐 Tradução (${target}):\n${res}` });
    } catch (e) { await sock.sendMessage(ctx.chatId, { text: 'Erro na tradução.' }); }
  },

  'tr': async (sock, ctx) => commands['traduzir'](sock, ctx),// ─── LEMBRETES (SÓ DONO) ────────────────────────────────────────────────
  'l': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!ctx.args.length) return sock.sendMessage(ctx.chatId, { text: 'Uso: .l [hora] [texto]\nEx: .l 15:30 Revisar matéria' });
    const resultado = interpretarDataHora(ctx.args);
    if (!resultado) return sock.sendMessage(ctx.chatId, { text: '❌ Não entendi a hora.' });
    const texto = ctx.args.slice(resultado.consumidos).join(' ').trim();
    if (!texto) return sock.sendMessage(ctx.chatId, { text: 'Falta o texto do lembrete.' });
    const id = (db.lembretes.length ? Math.max(...db.lembretes.map(l => l.id)) : 0) + 1;
    db.lembretes.push({ id, texto, dataHora: resultado.data.getTime(), criadoEm: Date.now() });
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `⏰ Lembrete #${id} criado para ${resultado.data.toLocaleString('pt-PT')}\n📝 ${texto}` });
  },
  'ls': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const pendentes = [...db.lembretes].sort((a, b) => a.dataHora - b.dataHora);
    if (!pendentes.length) return sock.sendMessage(ctx.chatId, { text: '📭 Sem lembretes.' });
    const linhas = pendentes.map(l => `#${l.id} — ${new Date(l.dataHora).toLocaleString('pt-PT')}\n📝 ${l.texto}`);
    await sock.sendMessage(ctx.chatId, { text: ` LEMBRETES PENDENTES\n\n${linhas.join('\n\n')}` });
  },
  'ap': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const id = parseInt(ctx.args[0]);
    if (!id) return sock.sendMessage(ctx.chatId, { text: 'Uso: .ap [número]' });
    const antes = db.lembretes.length;
    db.lembretes = db.lembretes.filter(l => l.id !== id);
    if (db.lembretes.length === antes) return sock.sendMessage(ctx.chatId, { text: `❌ Lembrete #${id} não encontrado.` });
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🗑️ Lembrete #${id} apagado.` });
  },
  'limpar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const n = db.lembretes.length;
    db.lembretes = [];
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🧹 ${n} lembrete(s) apagado(s).` });
  },

  // ─── COMANDOS DE DONO ───────────────────────────────────────────────────
  'wrnvp': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if ((ctx.args[0] || '').toLowerCase() !== 'all') return sock.sendMessage(ctx.chatId, { text: 'Uso: .wrnvp all' });
    let gruposInfo;
    try { gruposInfo = await sock.groupFetchAllParticipating(); } catch (e) { return sock.sendMessage(ctx.chatId, { text: `Erro: ${e.message}` }); }
    const grupoIds = Object.keys(gruposInfo);
    if (!grupoIds.length) return sock.sendMessage(ctx.chatId, { text: 'O bot não está em nenhum grupo.' });
    await sock.sendMessage(ctx.chatId, { text: `📣 A avisar ${grupoIds.length} grupo(s)...` });
    let enviados = 0, falhas = 0;
    for (const groupId of grupoIds) {
      const sub = db.gruposVIP.get(groupId);
      const texto = (sub && sub.expiraEm > Date.now()) ? gerarCartaoVipAtivo(sub) : gerarCartaoVipConvite();
      try { await sock.sendMessage(groupId, { text: texto }); enviados++; } catch { falhas++; }
      await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1000)));
    }
    await sock.sendMessage(ctx.chatId, { text: `✅ Enviado a ${enviados} grupo(s)${falhas ? `, ${falhas} falha(s)` : ''}.` });
  },
  'grcb': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const plano = (ctx.args[0] || '').toLowerCase();
    const dias = ctx.args[1];
    const numero = ctx.args[2];
    const valor = ctx.args[3] || null;
    if (!NIVEIS_VIP[plano] || !dias || !numero) return sock.sendMessage(ctx.chatId, { text: 'Uso: .grcb [ouro/diamante/lenda] [dias] [número] [valor?]' });
    const TEMAS = {
      ouro: { cor1: '#7a5c00', cor2: '#ffd700', nome: 'OURO 🥇' },
      diamante: { cor1: '#0d3b66', cor2: '#4fc3f7', nome: 'DIAMANTE 💎' },
      lenda: { cor1: '#3a0d66', cor2: '#ffd700', nome: 'LENDA 👑' }
    };
    const tema = TEMAS[plano];
    const agora = new Date();
    const dataStr = agora.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaStr = agora.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const idRecibo = 'YNK' + Date.now().toString().slice(-8);
    const linhaValor = valor ? `\n    <text x="90" y="700" font-size="24" font-family="Arial" fill="#999999">Valor</text>\n    <text x="90" y="738" font-size="32" font-family="Arial" font-weight="bold" fill="#ffffff">${utils.escapeXml(valor)} MT</text>` : '';
    const yData = valor ? 800 : 700;
    const svg = `<svg width="900" height="1150" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${tema.cor1}"/><stop offset="100%" stop-color="${tema.cor2}"/></linearGradient></defs>
  <rect width="900" height="1150" fill="#0e0e10"/>
  <rect x="40" y="40" width="820" height="1070" rx="28" fill="url(#bg)" opacity="0.14"/>
  <rect x="40" y="40" width="820" height="1070" rx="28" fill="none" stroke="url(#bg)" stroke-width="4"/>
  <text x="450" y="140" font-size="40" font-family="Arial" font-weight="bold" fill="#ffffff" text-anchor="middle">YANIKZX9 STORE</text>
  <text x="450" y="176" font-size="20" font-family="Arial" fill="#bbbbbb" text-anchor="middle">Comprovativo de Pagamento</text>
  <line x1="90" y1="210" x2="810" y2="210" stroke="#444" stroke-width="2"/>
  <text x="450" y="310" font-size="56" font-family="Arial" font-weight="bold" fill="url(#bg)" text-anchor="middle">${tema.nome}</text>
  <text x="90" y="420" font-size="24" font-family="Arial" fill="#999999">Número do cliente</text>
  <text x="90" y="458" font-size="32" font-family="Arial" font-weight="bold" fill="#ffffff">${utils.escapeXml(numero)}</text>
  <text x="90" y="560" font-size="24" font-family="Arial" fill="#999999">Duração do plano</text>
  <text x="90" y="598" font-size="32" font-family="Arial" font-weight="bold" fill="#ffffff">${utils.escapeXml(dias)} dias</text>
  ${linhaValor}
  <text x="90" y="${yData}" font-size="24" font-family="Arial" fill="#999999">Data e hora</text>
  <text x="90" y="${yData + 38}" font-size="28" font-family="Arial" font-weight="bold" fill="#ffffff">${dataStr} às ${horaStr}</text>
  <text x="90" y="${yData + 90}" font-size="18" font-family="Arial" fill="#666666">ID: ${idRecibo}</text>
  <g transform="translate(650,${yData + 60}) rotate(-16)">
    <rect x="-125" y="-46" width="250" height="92" rx="14" fill="none" stroke="#2ecc71" stroke-width="5" opacity="0.9"/>
    <text x="0" y="-4" font-size="24" font-family="Arial" font-weight="bold" fill="#2ecc71" text-anchor="middle" opacity="0.9">YANIKZX9</text>
    <text x="0" y="26" font-size="16" font-family="Arial" fill="#2ecc71" text-anchor="middle" opacity="0.9">VERIFICADO ✔</text>
  </g>
  <text x="450" y="1080" font-size="16" font-family="Arial" fill="#666" text-anchor="middle">Obrigado pela preferência</text>
</svg>`;
    try {
      const buf = await sharp(Buffer.from(svg)).png().toBuffer();
      await sock.sendMessage(ctx.chatId, { image: buf, caption: `🧾 Comprovativo — ${tema.nome}` });
    } catch (e) { await sock.sendMessage(ctx.chatId, { text: 'Erro ao gerar comprovativo.' }); }
  },
  't': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: 'Uso dentro do grupo: .t on / .t off / .t status' });
    const p = await commands._getPerms(sock, ctx);
    if (!p.pTransacoes) throw new PermissaoNegada();
    const acao = (ctx.args[0] || '').toLowerCase();
    const dados = getTransacoesGrupo(ctx.chatId);
    if (acao === 'on') { dados.ativo = true; salvarDados(); return sock.sendMessage(ctx.chatId, { text: '✅ Sistema de transações ACTIVADO.' }); }
    if (acao === 'off') { dados.ativo = false; salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔕 Sistema DESACTIVADO.' }); }
    return sock.sendMessage(ctx.chatId, { text: `📊 Sistema: ${dados.ativo ? 'ACTIVO ✅' : 'INACTIVO 🔕'}\nTotal: ${dados.contador}` });
  },
  'act': async (sock, ctx) => {
    const numero = ctx.args[0];
    if (!numero || !/^\d+$/.test(numero)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .act [número]' });
    let groupId = ctx.isGroup ? ctx.chatId : null;
    if (groupId) { const p = await commands._getPerms(sock, ctx); if (!p.pTransacoes) throw new PermissaoNegada(); }
    else { const c = await localizarPedidoPendente(sock, ctx.senderId, numero); if (!c.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum pedido encontrado.' }); groupId = c[0]; }
    const dados = getTransacoesGrupo(groupId);
    const pedido = dados.pedidos[numero];
    if (!pedido) return sock.sendMessage(ctx.chatId, { text: `❌ Pedido #${numero} não encontrado.` });
    if (pedido.status !== 'pendente') return sock.sendMessage(ctx.chatId, { text: `⚠️ Pedido #${numero} já foi ${pedido.status}.` });
    pedido.status = 'aprovado'; pedido.aprovadoPor = ctx.senderId; pedido.dataResolucao = new Date().toISOString();
    salvarDados(); registrarAcao(groupId, `Pedido #${numero} aprovado`);
    await sock.sendMessage(pedido.usuario, { text: `✅ PEDIDO #${numero} APROVADO!\n💰 ${pedido.valor} MT confirmados.` }).catch(() => {});
    await sock.sendMessage(groupId, { text: `✅ @${pedido.usuario.split('@')[0]} - Pagamento confirmado!`, mentions: [pedido.usuario] });
  },
  'rj': async (sock, ctx) => {
    const numero = ctx.args[0];
    const motivo = ctx.args.slice(1).join(' ').replace(/^"|"$/g, '').trim() || 'Não especificado';
    if (!numero || !/^\d+$/.test(numero)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .rj [número] [motivo]' });
    let groupId = ctx.isGroup ? ctx.chatId : null;
    if (groupId) { const p = await commands._getPerms(sock, ctx); if (!p.pTransacoes) throw new PermissaoNegada(); }
    else { const c = await localizarPedidoPendente(sock, ctx.senderId, numero); if (!c.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum pedido encontrado.' }); groupId = c[0]; }
    const dados = getTransacoesGrupo(groupId);
    const pedido = dados.pedidos[numero];
    if (!pedido) return sock.sendMessage(ctx.chatId, { text: `❌ Pedido #${numero} não encontrado.` });
    if (pedido.status !== 'pendente') return sock.sendMessage(ctx.chatId, { text: `⚠️ Pedido #${numero} já foi ${pedido.status}.` });
    pedido.status = 'rejeitado'; pedido.motivo = motivo; pedido.aprovadoPor = ctx.senderId; pedido.dataResolucao = new Date().toISOString();
    salvarDados(); registrarAcao(groupId, `Pedido #${numero} rejeitado (${motivo})`);
    await sock.sendMessage(pedido.usuario, { text: `❌ PEDIDO #${numero} REJEITADO\nMotivo: ${motivo}` }).catch(() => {});
  },
  'pend': async (sock, ctx) => {
    let grupos = [];
    if (ctx.isGroup) { const p = await commands._getPerms(sock, ctx); if (!p.pTransacoes) throw new PermissaoNegada(); grupos = [ctx.chatId]; }
    else grupos = await listarGruposGeriveis(sock, ctx.senderId);
    const linhas = []; const mentions = [];
    for (const groupId of grupos) {
      const dados = getTransacoesGrupo(groupId);
      for (const [n, pedido] of Object.entries(dados.pedidos)) {
        if (pedido.status === 'pendente') { linhas.push(`#${n} - @${pedido.usuario.split('@')[0]} - ${pedido.valor} MT`); mentions.push(pedido.usuario); }
      }
    }
    if (!linhas.length) return sock.sendMessage(ctx.chatId, { text: '✅ Sem pedidos pendentes.' });
    await sock.sendMessage(ctx.chatId, { text: ` PEDIDOS PENDENTES\n\n${linhas.join('\n')}`, mentions });
  },
  'hist': async (sock, ctx) => {
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target && ctx.args[0]) target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    if (!target) return sock.sendMessage(ctx.chatId, { text: 'Uso: .hist @usuario' });
    let grupos = [];
    if (ctx.isGroup) { const p = await commands._getPerms(sock, ctx); if (!p.pTransacoes) throw new PermissaoNegada(); grupos = [ctx.chatId]; }
    else grupos = await listarGruposGeriveis(sock, ctx.senderId);
    const linhas = [];
    for (const groupId of grupos) {
      const dados = getTransacoesGrupo(groupId);
      for (const [n, pedido] of Object.entries(dados.pedidos)) {
        if (pedido.usuario === target) {
          const emoji = pedido.status === 'aprovado' ? '✅' : pedido.status === 'rejeitado' ? '❌' : '⏳';
          linhas.push(`${emoji} #${n} - ${pedido.valor} MT - ${pedido.idTransacao}`);
        }
      }
    }
    if (!linhas.length) return sock.sendMessage(ctx.chatId, { text: 'Sem histórico.' });
    await sock.sendMessage(ctx.chatId, { text: `📜 HISTÓRICO — @${target.split('@')[0]}\n\n${linhas.join('\n')}`, mentions: [target] });
  },
  'tconta': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tconta add/rm/list [número]' });
    const p = await commands._getPerms(sock, ctx);
    if (!p.pTransacoes) throw new PermissaoNegada();
    const dados = getTransacoesGrupo(ctx.chatId);
    const acao = (ctx.args[0] || '').toLowerCase();
    const numero = (ctx.args[1] || '').replace(/\D/g, '');
    if (acao === 'add') {
      if (!numero) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tconta add [número]' });
      if (!dados.contas.includes(numero)) dados.contas.push(numero);
      salvarDados(); return sock.sendMessage(ctx.chatId, { text: `✅ Conta ${numero} adicionada.` });
    }
    if (acao === 'rm' || acao === 'remove') {
      if (!numero) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tconta rm [número]' });
      dados.contas = dados.contas.filter(c => c !== numero);
      salvarDados(); return sock.sendMessage(ctx.chatId, { text: `🗑️ Conta ${numero} removida.` });
    }
    if (!dados.contas.length) return sock.sendMessage(ctx.chatId, { text: '📭 Sem contas configuradas.' });
    return sock.sendMessage(ctx.chatId, { text: `📒 Contas aceites:\n${dados.contas.map(c => `• ${c}`).join('\n')}` });
  },
  'modelo': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const model = ctx.args[0];
    if (!model) return sock.sendMessage(ctx.chatId, { text: `Modelo atual: ${CONFIG.groq_model || 'llama-3.3-70b-versatile'}` });
    CONFIG.groq_model = model; salvarDados(); await sock.sendMessage(ctx.chatId, { text: `✔️ Modelo definido: ${model}` });
  },
  'backup': async (sock, ctx) => {
    if (!ctx.isGroup) throw new PermissaoNegada();
    const dir = path.join(__dirname, 'data', 'backups'); fse.ensureDirSync(dir);
    const out = path.join(dir, `${ctx.chatId.replace(/[^a-z0-9]/gi, '_')}.json`);
    const cfg = { antiLink: db.grupos.antiLink.get(ctx.chatId), palavrasBanidas: db.grupos.palavrasBanidas.get(ctx.chatId) || [], boasvindas: db.grupos.boasvindas.get(ctx.chatId) || null, regras: db.grupos.regras.get(ctx.chatId) || null };
    fs.writeFileSync(out, JSON.stringify(cfg, null, 2));
    await sock.sendMessage(ctx.chatId, { text: `📦 Backup criado: ${out}` });
  },
  'restore': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const file = ctx.args[0]; if (!file) return sock.sendMessage(ctx.chatId, { text: 'Uso: .restore [backup-file]' });
    const fp = path.join(__dirname, 'data', 'backups', file);
    if (!fs.existsSync(fp)) return sock.sendMessage(ctx.chatId, { text: 'Backup não encontrado.' });
    const cfg = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (cfg.antiLink) db.grupos.antiLink.set(ctx.chatId, cfg.antiLink);
    if (cfg.palavrasBanidas) db.grupos.palavrasBanidas.set(ctx.chatId, cfg.palavrasBanidas);
    if (cfg.boasvindas) db.grupos.boasvindas.set(ctx.chatId, cfg.boasvindas);
    if (cfg.regras) db.grupos.regras.set(ctx.chatId, cfg.regras);
    salvarDados(); await sock.sendMessage(ctx.chatId, { text: '✅ Restore concluído.' });
  },
  'estats': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const entries = [...db.stats.entries()].sort((a, b) => b[1] - a[1]);
    if (!entries.length) return sock.sendMessage(ctx.chatId, { text: 'Sem estatísticas.' });
    await sock.sendMessage(ctx.chatId, { text: `📊 Estatísticas:\n${entries.map(e => `${e[0]} → ${e[1]}`).join('\n')}` });
  },
  'comandos': async (sock, ctx) => { await sock.sendMessage(ctx.chatId, { text: `🔎 Comandos: ${Object.keys(commands).join(', ')}` }); },
  'notificar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBoasvindasRights(sock, ctx.chatId, ctx.senderId))) return;
    const a = ctx.args[0]?.toLowerCase();
    if (a === 'on') { db.notifications.set(ctx.chatId, true); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔔 Notificações ON' }); }
    if (a === 'off') { db.notifications.set(ctx.chatId, false); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔕 Notificações OFF' }); }
    await sock.sendMessage(ctx.chatId, { text: ` Notificações: ${db.notifications.get(ctx.chatId) ? 'ON' : 'OFF'}` });
  },
  'stats': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const memoria = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const uptime = utils.tempoRestante(process.uptime() * 1000);
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📊 *ESTATÍSTICAS*\n┃\n┃ 🤖 Grupos VIP: ${db.gruposVIP.size}\n┃ 📝 Comandos: ${Object.keys(commands).length}\n┃ 🔗 Atalhos: ${db.atalhos.size}\n┃ 💾 Memória: ${memoria} MB\n┃ ⏰ Online: ${uptime}\n┃ ⚡ Prefixo: ${CONFIG.prefix}\n┃\n 🛡️ *PROTECÇÃO*\n┃ ├─ Anti-link: ${db.grupos.antiLink.size}\n┃ ├─ Palavras banidas: ${db.grupos.palavrasBanidas.size}\n┃ └─ IA activa: ${db.grupos.iaAtivo.size}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },
  'relatorio': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    try { await enviarRelatorioCompleto(sock, ctx.chatId); } catch (e) { await sock.sendMessage(ctx.chatId, { text: `Erro: ${e.message}` }); }
  },
  'hisr': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const historico = db.historicoGrupos.get(ctx.chatId) || [];
    if (!historico.length) return sock.sendMessage(ctx.chatId, { text: '📝 Sem histórico.' });
    let texto = `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *HISTÓRICO* (últimas ${Math.min(historico.length, 10)})\n┃\n`;
    for (const h of historico.slice(-10).reverse()) { const data = new Date(h.data).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' }); texto += `┃ • ${h.acao}\n┃   ${data}\n`; }
    texto += `╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
    await sock.sendMessage(ctx.chatId, { text: texto });
  },
  'prefix': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const novoPrefixo = ctx.args[0];
    if (!novoPrefixo) return sock.sendMessage(ctx.chatId, { text: ` Prefixo actual: ${CONFIG.prefix}` });
    CONFIG.prefix = novoPrefixo; salvarDados(); await sock.sendMessage(ctx.chatId, { text: `✅ Novo prefixo: *${novoPrefixo}*` });
  },
  'ativ': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const nivel = ctx.args[0]?.toLowerCase();
    if (!nivel || !NIVEIS_VIP[nivel]) return sock.sendMessage(ctx.chatId, { text: '❌ Uso: .ativ [ouro/diamante/lenda] [dias]' });
    let dias = parseInt(ctx.args[1]) || NIVEIS_VIP[nivel].maxDias;
    dias = Math.min(dias, NIVEIS_VIP[nivel].maxDias);
    db.gruposVIP.set(ctx.chatId, { nivel, expiraEm: Date.now() + (dias * 86400000), diasTotal: dias, ativadoPor: ctx.senderId, ativadoEm: Date.now() });
    salvarDados(); registrarAcao(ctx.chatId, `VIP activado: ${NIVEIS_VIP[nivel].nome} por ${dias} dias`);
    await sock.sendMessage(ctx.chatId, { text: `✅ *VIP ACTIVADO*\n💎 ${NIVEIS_VIP[nivel].nome} | ${dias} dias`, mentions: [ctx.senderId] });
  },
  'rmvip': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    db.gruposVIP.delete(ctx.chatId); salvarDados(); registrarAcao(ctx.chatId, 'VIP removido pelo dono');
    await sock.sendMessage(ctx.chatId, { text: '✅ *VIP REMOVIDO*' });
  },
  'offbot': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    db.grupos.desligados.add(ctx.chatId); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '🔴 *BOT DESLIGADO AQUI*' });
  },
  'onbot': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    db.grupos.desligados.delete(ctx.chatId); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '🟢 *BOT LIGADO AQUI*' });
  },
  'ignorar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target && ctx.args[0]) target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    if (!target) return sock.sendMessage(ctx.chatId, { text: ' Uso: .ignorar [@pessoa|número]' });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: '❌ Não posso ignorar o dono.' });
    if (db.usersVIP.has(target) && db.usersVIP.get(target).expiraEm > Date.now()) { return sock.sendMessage(ctx.chatId, { text: '❌ Não posso ignorar este utilizador, pois ele possui um plano VIP activo.', mentions: [target] }); }
    db.ignorados.add(target); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🔇 *A IGNORAR*\n@${target.split('@')[0]}`, mentions: [target] });
  },
  'designorar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target && ctx.args[0]) target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Uso: .designorar [@pessoa|número]' });
    db.ignorados.delete(target); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🔊 *DEIXEI DE IGNORAR*\n@${target.split('@')[0]}`, mentions: [target] });
  },
  'ignorados': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!db.ignorados.size) return sock.sendMessage(ctx.chatId, { text: '📝 Sem ignorados.' });
    const lista = [...db.ignorados].map(id => `┃ 🔇 @${id.split('@')[0]}`).join('\n');
    await sock.sendMessage(ctx.chatId, { text: ` *IGNORADOS*\n${lista}`, mentions: [...db.ignorados] });
  },
  'lsg': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!db.gruposVIP.size) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum grupo activo.' });
    let lista = "╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💚 *GRUPOS ACTIVOS*\n┃\n";
    for (const [g, s] of db.gruposVIP) { const d = Math.floor(Math.max(0, s.expiraEm - Date.now()) / 86400000); lista += `┃ 📞 ${g.split('@')[0]}\n┃    ${NIVEIS_VIP[s.nivel].nome} • ${d}d\n┃\n`; }
    lista += "╰━━━━━━━━━━━━━━━━━━━━━━━╯";
    await sock.sendMessage(ctx.chatId, { text: lista });
  },

  // ─── STICKERS ───────────────────────────────────────────────────────────
  'sticker': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    let buffer = null; let processado = null;
    try {
      const msg = ctx.msg;
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const mediaMsg = quotedMsg ? { message: quotedMsg } : msg;
      if (mediaMsg.message?.imageMessage) buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
      else if (mediaMsg.message?.videoMessage) {
        if (mediaMsg.message.videoMessage.seconds > 10) return sock.sendMessage(ctx.chatId, { text: '❌ Máximo 10 segundos!' });
        buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
      } else return sock.sendMessage(ctx.chatId, { text: '❌ Envie imagem/vídeo com .fig' });
      processado = await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85, effort: 4 }).toBuffer();
      buffer = null;
      const final = await utils.adicionarMetadadosSticker(processado, CONFIG.botName, CONFIG.creator);
      await sock.sendMessage(ctx.chatId, { sticker: final });
      await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao criar sticker' }); }
    finally { buffer = null; processado = null; }
  },
  'fig': async (sock, ctx) => commands['sticker'](sock, ctx),
  'stext': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    const texto = ctx.args.join(' ');
    if (!texto) return sock.sendMessage(ctx.chatId, { text: 'Uso: .stext [texto]' });
    try {
      const buffer = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 128, g: 0, b: 128, alpha: 1 } } })
        .composite([{ input: Buffer.from(`<svg width="512" height="512"><style>text { fill: white; font-size: 40px; font-family: Arial, sans-serif; text-anchor: middle; dominant-baseline: central; font-weight: bold; }</style><text x="256" y="256">${texto.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text></svg>`), top: 0, left: 0 }])
        .webp({ quality: 90 }).toBuffer();
      const final = await utils.adicionarMetadadosSticker(buffer, CONFIG.botName, CONFIG.creator);
      await sock.sendMessage(ctx.chatId, { sticker: final });
      await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao criar sticker' }); }
  },
  'stinfo': async (sock, ctx) => {
    const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg?.stickerMessage) return sock.sendMessage(ctx.chatId, { text: '❌ Responde a um sticker' });
    const s = quotedMsg.stickerMessage;
    await sock.sendMessage(ctx.chatId, { text: `📋 *INFO DO STICKER*\n┃ 📦 Pacote: ${s.stickerPack || '—'}\n┃ ✏️ Autor: ${s.stickerAuthor || '—'}\n┃ 📛 Nome: ${s.stickerName || '—'}\n┃ 📏 Tamanho: ${s.fileLength ? (s.fileLength / 1024).toFixed(1) + ' KB' : 'N/A'}\n┃ 🎞️ Animado: ${s.isAnimated ? '✅' : '❌'}` });
  },
  'at': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const atalho = ctx.args[0]?.toLowerCase();
    const info = ctx.args.slice(1).join(' ');
    if (!atalho || !info) return sock.sendMessage(ctx.chatId, { text: '❌ Uso: .at [nome] [texto]' });
    let grupoNome = 'PV';
    if (ctx.isGroup) { try { grupoNome = (await sock.groupMetadata(ctx.chatId)).subject; } catch { grupoNome = 'Grupo'; } }
    db.atalhos.set(atalho, { texto: info, grupoId: ctx.chatId, grupoNome }); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Atalho *${atalho}* criado` });
  },
  'rmat': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const atalho = ctx.args[0]?.toLowerCase();
    if (!atalho) return;
    if (db.atalhos.delete(atalho)) { salvarDados(); await sock.sendMessage(ctx.chatId, { text: `✅ Atalho *${atalho}* removido` }); }
  },
  'lsat': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!db.atalhos.size) return sock.sendMessage(ctx.chatId, { text: ' Sem atalhos.' });
    let lista = "📋 *ATALHOS*\n\n";
    for (const [a, v] of db.atalhos) {
      if (typeof v === 'string') lista += `🔹 *${a}* → ${v}\n`;
      else lista += `🔹 *${a}* → ${v.texto} (${v.grupoNome})\n`;
    }
    await sock.sendMessage(ctx.chatId, { text: lista });
  },

  // ─── ADMINISTRAÇÃO DE GRUPO ────────────────────────────────────────────
  'bemv': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBoasvindasRights(sock, ctx.chatId, ctx.senderId))) return;
    const texto = ctx.args.join(' ');
    if (texto === 'off') { db.grupos.boasvindas.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔕 Boas-vindas OFF' }); }
    if (!texto) return sock.sendMessage(ctx.chatId, { text: 'Uso: .bemv [mensagem] / .bemv off\nVariáveis: @nome, @grupo' });
    db.grupos.boasvindas.set(ctx.chatId, texto); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '✅ Boas-vindas configuradas', mentions: [ctx.senderId] });
  },
  'ban': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: ' Não é possível banir o dono.' });
    try {
      await sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove');
      if (!db.grupos.banidos.has(ctx.chatId)) db.grupos.banidos.set(ctx.chatId, []);
      db.grupos.banidos.get(ctx.chatId).push({ id: target, data: new Date().toLocaleDateString('pt-PT') });
      salvarDados(); registrarAcao(ctx.chatId, `Ban: @${target.split('@')[0]}`);
      await sock.sendMessage(ctx.chatId, { text: `🚫 @${target.split('@')[0]} banido!`, mentions: [target] });
    } catch { await sock.sendMessage(ctx.chatId, { text: ' Erro ao banir.' }); }
  },
  'kick': async (sock, ctx) => commands['ban'](sock, ctx),
  'all': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const meta = await getMetadataCached(sock, ctx.chatId);
    const mensagem = ctx.args.join(' ') || 'Atenção!';
    await sock.sendMessage(ctx.chatId, { text: `📢 *AVISO GERAL*\n\n${mensagem}`, mentions: meta.participants.map(p => p.id) });
  },
  'close': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'announcement'); registrarAcao(ctx.chatId, 'Grupo fechado');
    await sock.sendMessage(ctx.chatId, { text: '🔒 Grupo fechado' });
  },
  'open': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'not_announcement'); registrarAcao(ctx.chatId, 'Grupo aberto');
    await sock.sendMessage(ctx.chatId, { text: '🔓 Grupo aberto' });
  },
  'up': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    try { await sock.groupParticipantsUpdate(ctx.chatId, [target], 'promote'); await sock.sendMessage(ctx.chatId, { text: `👑 @${target.split('@')[0]} promovido`, mentions: [target] }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao promover.' }); }
  },
  'down': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    try { await sock.groupParticipantsUpdate(ctx.chatId, [target], 'demote'); await sock.sendMessage(ctx.chatId, { text: `⬇️ @${target.split('@')[0]} rebaixado`, mentions: [target] }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao rebaixar.' }); }
  },
  'link': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    try { const code = await sock.groupInviteCode(ctx.chatId); await sock.sendMessage(ctx.chatId, { text: `🔗 https://chat.whatsapp.com/${code}` }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao obter link.' }); }
  },
  'dlt': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo;
    if (!quoted?.stanzaId) return sock.sendMessage(ctx.chatId, { text: '❌ Responde a uma mensagem.' });
    try { await sock.sendMessage(ctx.chatId, { delete: { remoteJid: ctx.chatId, id: quoted.stanzaId, participant: quoted.participant } }); await utils.reagir(sock, ctx.msg, '✅'); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui apagar.' }); }
  },
  'rg': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasRulesRights(sock, ctx.chatId, ctx.senderId))) return;
    const regras = ctx.args.join(' ');
    if (!regras) return sock.sendMessage(ctx.chatId, { text: '❌ Uso: .rg [regras]' });
    db.grupos.regras.set(ctx.chatId, regras); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '✅ Regras actualizadas' });
  },
  'vrg': async (sock, ctx) => {
    const regras = db.grupos.regras.get(ctx.chatId);
    if (!regras) return sock.sendMessage(ctx.chatId, { text: '📝 Sem regras definidas.' });
    await sock.sendMessage(ctx.chatId, { text: `📋 *REGRAS*\n\n${regras}` });
  },
  'antil': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const sub = ctx.args[0]?.toLowerCase();
    if (!sub) return sock.sendMessage(ctx.chatId, { text: 'Uso: .antil [ban|kick|delete|warn|off]\n.antil add [dominio]\n.antil remove [dominio]\n.antil ls' });
    if (sub === 'off') { db.grupos.antiLink.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔗 Anti-link OFF' }); }
    if (sub === 'add') {
      const d = ctx.args[1]; if (!d) return;
      const host = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (!db.whitelist.has(ctx.chatId)) db.whitelist.set(ctx.chatId, new Set());
      db.whitelist.get(ctx.chatId).add(host); salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `✅ ${host} adicionado` });
    }
    if (sub === 'remove') {
      const d = ctx.args[1]; if (!d) return;
      const host = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const s = db.whitelist.get(ctx.chatId);
      if (s && s.has(host)) { s.delete(host); salvarDados(); return sock.sendMessage(ctx.chatId, { text: `✅ ${host} removido` }); }
      return sock.sendMessage(ctx.chatId, { text: '️ Não estava na whitelist' });
    }
    if (sub === 'ls' || sub === 'list') {
      const s = db.whitelist.get(ctx.chatId) || new Set();
      if (!s.size) return sock.sendMessage(ctx.chatId, { text: '📝 Whitelist vazia.' });
      return sock.sendMessage(ctx.chatId, { text: `Whitelist:\n${[...s].join('\n')}` });
    }
    if (['ban', 'kick', 'delete', 'warn'].includes(sub)) {
      db.grupos.antiLink.set(ctx.chatId, sub); salvarDados();
      return sock.sendMessage(ctx.chatId, { text: ` Anti-link: ${sub}` });
    }
    return sock.sendMessage(ctx.chatId, { text: 'Uso inválido de .antil' });
  },
  'ia': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const acao = ctx.args[0]?.toLowerCase();
    if (acao === 'on') { db.grupos.iaAtivo.add(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🤖 IA ACTIVADA' }); }
    if (acao === 'off') { db.grupos.iaAtivo.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🤖 IA DESACTIVADA' }); }
    await sock.sendMessage(ctx.chatId, { text: `🤖 IA: ${db.grupos.iaAtivo.has(ctx.chatId) ? '✅ Activa' : '❌ Inactiva'}` });
  },
  'banw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return sock.sendMessage(ctx.chatId, { text: '❌ Uso: .banw [palavra]' });
    if (!db.grupos.palavrasBanidas.has(ctx.chatId)) db.grupos.palavrasBanidas.set(ctx.chatId, []);
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId);
    if (lista.includes(palavra)) return sock.sendMessage(ctx.chatId, { text: '⚠️ Já está banida.' });
    lista.push(palavra); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🚫 Palavra banida: "${palavra}"` });
  },
  'unbanw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return;
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    const idx = lista.indexOf(palavra);
    if (idx === -1) return sock.sendMessage(ctx.chatId, { text: '⚠️ Não está na lista.' });
    lista.splice(idx, 1); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Palavra removida: "${palavra}"` });
  },
  'listw': async (sock, ctx) => {
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    if (!lista.length) return sock.sendMessage(ctx.chatId, { text: ' Sem palavras banidas.' });
    await sock.sendMessage(ctx.chatId, { text: `🚫 *PALAVRAS BANIDAS*\n${lista.join('\n')}` });
  },
  'listb': async (sock, ctx) => {
    const lista = db.grupos.banidos.get(ctx.chatId) || [];
    if (!lista.length) return sock.sendMessage(ctx.chatId, { text: '📝 Sem banidos.' });
    await sock.sendMessage(ctx.chatId, { text: `🚫 *BANIDOS*\n${lista.map(b => `@${b.id.split('@')[0]} - ${b.data}`).join('\n')}`, mentions: lista.map(b => b.id) });
  },// ─── DOWNLOADS (VIP DE UTILIZADOR) ─────────────────────────────────────
  'tk': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'tk')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ *Acesso negado!*\n\nO teu plano VIP não inclui o comando .tk.\n\n📦 *Planos:*\n🥇 Ouro: .tk\n💎 Diamante: .tk, .ig\n👑 Lenda: Todos os downloads\n\n📞 Contacta o dono: ${CONFIG.ownerNumber}` });
    }
    const link = ctx.args[0];
    if (!link || !/tiktok\.com|vm\.tiktok|vt\.tiktok/.test(link)) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .tk [link do TikTok]' });
    }
    await sock.sendMessage(ctx.chatId, { text: '⏳ A processar TikTok...' });
    try {
      const dados = await extrairGenDownload(link);
      const fmt = escolherFormatoGen(dados, 'video');
      const buf = await baixarBufferGen(fmt);
      if (buf) {
        return await sock.sendMessage(ctx.chatId, { video: buf, caption: `🎵 *${dados.title || 'Vídeo'}*\n👤 ${dados.author || ''}\n💚 Nano Bot 🤖`, mimetype: 'video/mp4' });
      }
    } catch (e) { console.warn('tk (gendownload):', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui baixar do TikTok.' });
  },
  'ig': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'ig')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ O teu plano VIP não inclui o comando .ig.\nFaz .meuvip para ver o teu estado.` });
    }
    const link = ctx.args[0];
    if (!link || !link.includes('instagram.com')) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .ig [link do Instagram]' });
    }
    await sock.sendMessage(ctx.chatId, { text: '⏳ A processar Instagram...' });
    try {
      const dados = await extrairGenDownload(link);
      const formatos = dados?.formats || [];
      const videos = formatos.filter(f => f.type === 'video');
      const imagens = formatos.filter(f => f.type === 'image' || /jpe?g|png|webp/.test(f.ext || ''));
      if (videos.length) {
        const buf = await baixarBufferGen(videos[0]);
        if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: `📸 Instagram — ${dados.author || ''}`, mimetype: 'video/mp4' });
      } else if (imagens.length) {
        let i = 0;
        for (const img of imagens.slice(0, 4)) {
          const buf = await baixarBufferGen(img, 32 * 1024 * 1024);
          if (buf) {
            await sock.sendMessage(ctx.chatId, { image: buf, caption: `📸 Instagram (${i + 1}/${Math.min(imagens.length, 4)})` });
            i++;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        if (i > 0) return;
      }
    } catch (e) { console.warn('ig (gendownload):', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui baixar do Instagram.' });
  },
  'yt': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'yt')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ O teu plano VIP não inclui pesquisa de YouTube.\nFaz .meuvip para ver o teu estado.` });
    }
    const pesquisa = ctx.args.join(' ');
    if (!pesquisa) return sock.sendMessage(ctx.chatId, { text: 'Uso: .yt [pesquisa]' });
    try {
      await sock.sendMessage(ctx.chatId, { text: '🔍 A pesquisar...' });
      const yts = require('yt-search');
      const resultados = await yts(pesquisa);
      const videos = resultados.videos.slice(0, 5);
      if (!videos.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum resultado.' });
      let texto = `🎬 *RESULTADOS YOUTUBE*\n\n`;
      videos.forEach((vid, i) => {
        const duracao = vid.timestamp || `${Math.floor(vid.duration.seconds / 60)}:${String(vid.duration.seconds % 60).padStart(2, '0')}`;
        texto += `${i + 1}. ${vid.title.substring(0, 50)}\n   ⏱️ ${duracao} | ${vid.url}\n\n`;
      });
      texto += `💡 Usa .ytd [link] para áudio\n💡 Usa .ytv [link] para vídeo`;
      const thumbnail = videos[0]?.image || videos[0]?.thumbnail;
      if (thumbnail) await sock.sendMessage(ctx.chatId, { image: { url: thumbnail }, caption: texto });
      else await sock.sendMessage(ctx.chatId, { text: texto });
    } catch (e) { await sock.sendMessage(ctx.chatId, { text: '❌ Erro na pesquisa.' }); }
  },
  'ytd': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'ytd')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ O teu plano VIP não inclui downloads de YouTube.\nFaz .meuvip para ver o teu estado.` });
    }
    const link = ctx.args[0];
    if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .ytd [link do YouTube]' });
    }
    await sock.sendMessage(ctx.chatId, { text: '⏳ A processar áudio YouTube...' });
    try {
      const dados = await extrairGenDownload(link);
      const fmt = escolherFormatoGen(dados, 'audio');
      const buf = await baixarBufferGen(fmt, 32 * 1024 * 1024);
      if (buf) {
        const ehMp3 = (fmt.ext || '') === 'mp3';
        const videoId = extrairVideoId(link);
        const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
        return await sock.sendMessage(ctx.chatId, {
          audio: buf,
          mimetype: ehMp3 ? 'audio/mpeg' : 'audio/mp4',
          fileName: `${(dados.title || 'audio').replace(/[^a-z0-9]/gi, ' ').substring(0, 50)}.${ehMp3 ? 'mp3' : 'm4a'}`,
          ptt: false,
          contextInfo: thumbnail ? { externalAdReply: { title: dados.title || 'Áudio', body: dados.author || '', thumbnailUrl: thumbnail, mediaType: 2, renderLargerThumbnail: true } } : undefined
        });
      }
    } catch (e) { console.warn('ytd (gendownload):', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui baixar áudio do YouTube.' });
  },
  'ytv': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'ytv')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ O teu plano VIP não inclui downloads de vídeo do YouTube.\nFaz .meuvip para ver o teu estado.` });
    }
    const link = ctx.args[0];
    if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .ytv [link do YouTube]' });
    }
    await sock.sendMessage(ctx.chatId, { text: '⏳ A processar vídeo YouTube...' });
    try {
      const dados = await extrairGenDownload(link);
      if ((dados.duration || 0) > 600) return sock.sendMessage(ctx.chatId, { text: '❌ Vídeos > 10 min não suportados.' });
      const fmt = escolherFormatoGen(dados, 'video');
      const buf = await baixarBufferGen(fmt);
      if (buf) {
        const videoId = extrairVideoId(link);
        const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
        return await sock.sendMessage(ctx.chatId, {
          video: buf,
          mimetype: 'video/mp4',
          caption: `🎬 *${(dados.title || 'Vídeo').substring(0, 60)}*\n👤 ${dados.author || ''}\n💚 Nano Bot `,
          contextInfo: thumbnail ? { externalAdReply: { title: dados.title || 'Vídeo', body: dados.author || '', thumbnailUrl: thumbnail, mediaType: 2, renderLargerThumbnail: true } } : undefined
        });
      }
    } catch (e) { console.warn('ytv (gendownload):', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui baixar vídeo do YouTube.' });
  },

  // ─── VIP DE UTILIZADORES ──────────────────────────────────────────────
  'vp': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target && ctx.args[0]) target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    const nivel = (ctx.args[1] || '').toLowerCase();
    const dias = parseInt(ctx.args[2]);
    if (!target || !NIVEIS_VIP_USER[nivel] || !dias) {
      return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 👑 *ACTIVAR VIP DE USUÁRIO*\n┃\n Uso: .vp @user [nivel] [dias]\n┃ Níveis: ouro | diamante | lenda\n┃\n Ex: .vp @user diamante 30\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    const maxDias = NIVEIS_VIP_USER[nivel].maxDias;
    const diasFinais = Math.min(dias, maxDias);
    db.usersVIP.set(target, { nivel, expiraEm: Date.now() + (diasFinais * 86400000), ativadoEm: Date.now() });
    salvarDados();
    const cmdsPermitidos = NIVEIS_VIP_USER[nivel].cmds.map(c => `.${c}`).join(', ');
    const dataExpiracao = new Date(Date.now() + (diasFinais * 86400000)).toLocaleDateString('pt-PT');
    await sock.sendMessage(ctx.chatId, {
      text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *VIP DE USUÁRIO ACTIVADO*\n┃\n┃ 👤 @${target.split('@')[0]}\n┃ 💎 Nível: ${NIVEIS_VIP_USER[nivel].nome}\n┃ 📅 Duração: ${diasFinais} dias\n┃ ⏳ Expira em: ${dataExpiracao}\n┃ 🔓 Comandos: ${cmdsPermitidos}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`,
      mentions: [target]
    });
  },
  'meuvip': async (sock, ctx) => {
    const vip = db.usersVIP.get(ctx.senderId);
    if (!vip || vip.expiraEm < Date.now()) {
      if (vip) { db.usersVIP.delete(ctx.senderId); salvarDados(); }
      return sock.sendMessage(ctx.chatId, { text: `📝 Não tens VIP activo.\n\n📦 *Planos:*\n🥇 Ouro: .tk\n💎 Diamante: .tk, .ig\n👑 Lenda: Todos os downloads\n\n📞 Contacta: ${CONFIG.ownerNumber}` });
    }
    const restante = Math.max(0, vip.expiraEm - Date.now());
    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const nivel = NIVEIS_VIP_USER[vip.nivel];
    const cmds = nivel.cmds.map(c => `.${c}`).join(', ');
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💎 *O TEU VIP*\n┃\n Nível: ${nivel.nome}\n┃ ⏳ Restante: ${d}d ${h}h\n┃ 🔓 Comandos: ${cmds}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
  },

  // ─── STA (Salvar Áudio) ──────────────────────────────────────────────
  'sta': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Apenas admins podem usar este comando.' });
    }
    const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg?.audioMessage && !quotedMsg?.documentMessage) {
      return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🎵 *STA - SALVAR ÁUDIO*\n┃\n┃ Responde a um áudio com:\n┃ .sta [palavra-chave]\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return sock.sendMessage(ctx.chatId, { text: '❌ Deves indicar uma palavra-chave.\nEx: .sta menu' });
    try {
      const mediaMsg = { message: quotedMsg };
      const audioBuffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
      if (!db.grupos.audioGatilhos.has(ctx.chatId)) db.grupos.audioGatilhos.set(ctx.chatId, new Map());
      db.grupos.audioGatilhos.get(ctx.chatId).set(palavra, audioBuffer);
      salvarDados();
      await sock.sendMessage(ctx.chatId, { text: `✅ *Áudio salvo!*\n\n🔑 Chave: *${palavra}*\n💾 Tamanho: ${(audioBuffer.length / 1024).toFixed(1)} KB` });
    } catch (e) { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao salvar áudio.' }); }
  },

  // ─── STM (Salvar Mídia) ─────────────────────────────────────────────
  'stm': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Apenas admins podem usar este comando.' });
    }
    const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg?.imageMessage && !quotedMsg?.videoMessage && !quotedMsg?.documentMessage) {
      return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📸 *STM - SALVAR MÍDIA*\n┃\n┃ Responde a uma foto/vídeo com:\n┃ .stm [palavra-chave]\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return sock.sendMessage(ctx.chatId, { text: '❌ Deves indicar uma palavra-chave.\nEx: .stm backrooms\nEx: .stm .menu' });
    try {
      const mediaMsg = { message: quotedMsg };
      let buffer, tipo;
      if (quotedMsg.imageMessage) { buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}); tipo = 'image'; }
      else if (quotedMsg.videoMessage) { buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}); tipo = 'video'; }
      else { buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}); tipo = 'document'; }
      if (palavra.startsWith('.')) {
        if (!db.grupos.midiaComandos.has(ctx.chatId)) db.grupos.midiaComandos.set(ctx.chatId, new Map());
        db.grupos.midiaComandos.get(ctx.chatId).set(palavra, { buffer, tipo });
        salvarDados();
        await sock.sendMessage(ctx.chatId, { text: `✅ *Imagem do comando salva!*\n\n🔑 Comando: *${palavra}*\n📁 Tipo: ${tipo}` });
      } else {
        if (!db.grupos.midiaGatilhos.has(ctx.chatId)) db.grupos.midiaGatilhos.set(ctx.chatId, new Map());
        db.grupos.midiaGatilhos.get(ctx.chatId).set(palavra, { buffer, tipo });
        salvarDados();
        await sock.sendMessage(ctx.chatId, { text: `✅ *Mídia salva!*\n\n🔑 Chave: *${palavra}*\n📁 Tipo: ${tipo}` });
      }
    } catch (e) { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao salvar mídia.' }); }
  },

  // ─── DST (Desativar Comando) ─────────────────────────────────────────
  'dst': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Apenas admins podem usar este comando.' });
    }
    const comando = ctx.args[0]?.toLowerCase();
    if (!comando || !comando.startsWith('.')) {
      return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *DST - DESATIVAR COMANDO*\n┃\n┃ Uso: .dst [comando]\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    const cmdLimpo = comando.replace('.', '');
    if (!commands[cmdLimpo]) return sock.sendMessage(ctx.chatId, { text: `❌ Comando ".${cmdLimpo}" não existe.` });
    if (!db.grupos.comandosDesativados.has(ctx.chatId)) db.grupos.comandosDesativados.set(ctx.chatId, new Set());
    db.grupos.comandosDesativados.get(ctx.chatId).add(cmdLimpo);
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ *Comando desativado!*\n\n🚫 ".${cmdLimpo}" está desativado neste grupo.\n\nPara reativar: .actcmd .${cmdLimpo}` });
  },

  // ─── ACTCMD (Ativar Comando) ─────────────────────────────────────────
  'actcmd': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Apenas admins podem usar este comando.' });
    }
    const comando = ctx.args[0]?.toLowerCase();
    if (!comando || !comando.startsWith('.')) {
      return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *ACTCMD - ATIVAR COMANDO*\n┃\n┃ Uso: .actcmd [comando]\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    const cmdLimpo = comando.replace('.', '');
    const cmdsDesativados = db.grupos.comandosDesativados.get(ctx.chatId);
    if (!cmdsDesativados || !cmdsDesativados.has(cmdLimpo)) {
      return sock.sendMessage(ctx.chatId, { text: `⚠️ O comando ".${cmdLimpo}" já está ativo.` });
    }
    cmdsDesativados.delete(cmdLimpo);
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ *Comando ativado!*\n\n✅ ".${cmdLimpo}" está ativo neste grupo.` });
  },

  // ─── LISTAD (Listar Comandos Desativados) ────────────────────────────
  'listad': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const cmds = db.grupos.comandosDesativados.get(ctx.chatId);
    if (!cmds || cmds.size === 0) return sock.sendMessage(ctx.chatId, { text: '✅ Todos os comandos estão ativos neste grupo.' });
    const lista = [...cmds].map(c => `🚫 .${c}`).join('\n');
    await sock.sendMessage(ctx.chatId, { text: `🚫 *COMANDOS DESATIVADOS*\n\n${lista}\n\nUse .actcmd [comando] para reativar.` });
  }
};// =================== MODERAÇÃO AUTOMÁTICA ===================
async function executarAntiLink(sock, chatId, msg, senderId, modo) {
  try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
  if (modo === 'warn') {
    await sock.sendMessage(chatId, { text: `⚠️ *AVISO: LINK DETECTADO*\n@${senderId.split('@')[0]}, links não são permitidos!`, mentions: [senderId] });
  } else if (modo === 'delete') {
    await sock.sendMessage(chatId, { text: `🔗 *LINK REMOVIDO*\n@${senderId.split('@')[')[0]}`, mentions: [senderId] });
  } else if (modo === 'kick' || modo === 'ban') {
    try {
      await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
      registrarAcao(chatId, `Anti-link (${modo}): @${senderId.split('@')[0]}`);
      await sock.sendMessage(chatId, { text: `🚫 *REMOVIDO POR LINK*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
    } catch {
      await sock.sendMessage(chatId, { text: `⚠️ Não consegui remover @${senderId.split('@')[0]}.`, mentions: [senderId] });
    }
  }
}

// =================== CONTROLO VIA TERMINAL ===================
let pausado = false;
let geracaoAtual = 0;
let sockAtual = null;
let ultimasMensagensIds = [];
let mensagensIgnoradas = new Set();

const rlTerminal = readline.createInterface({ input: process.stdin });
rlTerminal.on('line', (linha) => {
  const cmd = linha.trim().toLowerCase();
  if (cmd === 'parar' || cmd === '.parar') {
    geracaoAtual++;
    pausado = true;
    console.log('🛑 PARADO — digita "continuar" para retomar.');
  } else if (cmd === 'continuar' || cmd === '.continuar') {
    pausado = false;
    console.log('▶️ RETOMADO');
  } else if (cmd === 'reiniciar' || cmd === '.reiniciar') {
    mensagensIgnoradas = new Set(ultimasMensagensIds);
    console.log(`🔄 A reiniciar — ${ultimasMensagensIds.length} mensagens serão ignoradas.`);
    try { sockAtual?.end(new Error('Reinício manual')); } catch {}
  } else if (cmd === 'status' || cmd === '.statuscmd') {
    console.log(`Estado: ${pausado ? '🛑 PAUSADO' : '✅ ATIVO'} | Geração: ${geracaoAtual}`);
  }
});

function gerarCodigoPersonalizado() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return codigo;
}

function exibirCodigoPareamento(codigo) {
  const largura = 44;
  const cyan = '\x1b[36m', reset = '\x1b[0m', bold = '\x1b[1m', verde = '\x1b[32m';
  const centrar = (texto) => {
    const visivel = texto.replace(/\x1b\[[0-9;]*m/g, '');
    const espaco = Math.max(largura - visivel.length, 0);
    const esq = Math.floor(espaco / 2);
    const dir = espaco - esq;
    return `${cyan}║${reset}${' '.repeat(esq)}${texto}${' '.repeat(dir)}${cyan}║${reset}`;
  };
  console.log(`\n${cyan}╔${'═'.repeat(largura)}╗${reset}`);
  console.log(centrar(''));
  console.log(centrar(`${bold}📲 CÓDIGO DE EMPARELHAMENTO${reset}`));
  console.log(centrar(''));
  console.log(centrar(`${bold}${verde}${codigo}${reset}`));
  console.log(centrar(''));
  console.log(centrar('WhatsApp > Dispositivos ligados'));
  console.log(centrar('> Ligar com número de telefone'));
  console.log(centrar(''));
  console.log(`${cyan}╚${'═'.repeat(largura)}╝${reset}\n`);
}

// =================== LIMPEZA DE HISTÓRICOS IA ===================
setInterval(() => {
  try {
    const AGORA = Date.now();
    const TEMPO_MORTO = 2 * 60 * 60 * 1000;
    let limpos = 0;
    for (const [chatId, ultimoUso] of db.historicoIAUltimoUso) {
      if (AGORA - ultimoUso > TEMPO_MORTO) {
        db.historicoIA.delete(chatId);
        db.historicoIAUltimoUso.delete(chatId);
        limpos++;
      }
    }
    if (limpos > 0) console.log(`🧹 IA: limpos ${limpos} histórico(s)`);
  } catch {}
}, 30 * 60 * 1000);

// =================== INICIALIZAÇÃO ===================
let reconnectAttempts = 0;

async function startBot() {
  let sock;
  try {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_nano');
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      logger: pino({ level: 'fatal' }),
      syncFullHistory: false,
      markOnlineOnConnect: true
    });
    sockAtual = sock;

    if (!sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const meuCodigo = gerarCodigoPersonalizado();
          let code = await sock.requestPairingCode(CONFIG.botNumber, meuCodigo);
          code = code?.match(/.{1,4}/g)?.join('-') || code;
          exibirCodigoPareamento(code);
        } catch (error) { console.log('❌ Erro ao gerar código:', error.message); }
      }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    // Lembretes (1 min)
    setInterval(async () => {
      try {
        const agora = Date.now();
        const prontos = db.lembretes.filter(l => l.dataHora <= agora);
        if (!prontos.length) return;
        db.lembretes = db.lembretes.filter(l => l.dataHora > agora);
        salvarDados();
        for (const l of prontos) {
          try { await sock.sendMessage(`${CONFIG.ownerId}@s.whatsapp.net`, { text: `⏰ *LEMBRETE*\n\n📝 ${l.texto}` }); } catch {}
        }
      } catch {}
    }, 60000);

    // Limpeza de rate limits (15 min)
    setInterval(() => {
      const agora = Date.now();
      const maiorJanela = Math.max(RATE_LIMIT_JANELA_MS, CHAT_LIMITE_JANELA_MS, MENU_LIMITE_JANELA_MS);
      for (const [chave, usos] of db.rateLimit) {
        const validos = usos.filter(t => agora - t < maiorJanela);
        if (validos.length === 0) db.rateLimit.delete(chave);
        else if (validos.length !== usos.length) db.rateLimit.set(chave, validos);
      }
    }, 15 * 60 * 1000);

    // Participantes do grupo
    sock.ev.on('group-participants.update', async (event) => {
      const { id: groupId, participants, action } = event;
      cacheMetadata.delete(groupId);
      const botJid = sock.user.id;
      if (action === 'add') {
        const boasVindasMsg = db.grupos.boasvindas.get(groupId);
        if (boasVindasMsg) {
          try {
            const metadata = await getMetadataCached(sock, groupId);
            for (const participant of participants) {
              if (participant !== botJid) {
                const nome = `@${participant.split('@')[0]}`;
                const textoFinal = boasVindasMsg.replace(/@nome/g, nome).replace(/@grupo/g, metadata.subject);
                const cartao = await gerarCartaoBoasVindas(sock, participant, metadata.subject);
                if (cartao) await sock.sendMessage(groupId, { image: cartao, caption: textoFinal, mentions: [participant] });
                else await sock.sendMessage(groupId, { text: textoFinal, mentions: [participant] });
              }
            }
          } catch {}
        }
        if (participants.includes(botJid)) {
          if (!utils.isGroupSubscribed(groupId)) {
            await sock.sendMessage(groupId, { text: `❌ Este grupo não possui assinatura activa.\n📞 Contacte ${CONFIG.creator}: ${CONFIG.ownerNumber}` });
            setTimeout(() => sock.groupLeave(groupId), 3000);
          }
        }
      }
    });

    // Mensagens
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try {
        if (type !== 'notify') return;
        if (pausado) return;
        const minhaGeracao = geracaoAtual;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.id && mensagensIgnoradas.has(msg.key.id)) { mensagensIgnoradas.delete(msg.key.id); return; }

        const chatId = msg.key.remoteJid;
        if (chatId === 'status@broadcast' || chatId?.endsWith('@broadcast')) return;
        const msgTime = msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now();
        if (Date.now() - msgTime > 60000) return;

        const isGroup = chatId.endsWith('@g.us');
        let senderId = isGroup ? msg.key.participant : chatId;
        const fullText = utils.extractText(msg);

        if (msg.key.id) { ultimasMensagensIds.push(msg.key.id); if (ultimasMensagensIds.length > 4) ultimasMensagensIds.shift(); }
        if (!isGroup) console.log(`📩 Privado de ${senderId.split('@')[0]}: "${fullText}"`);

        try { await sock.readMessages([msg.key]); } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));
        if (pausado || minhaGeracao !== geracaoAtual) return;

        senderId = await resolverIdDono(sock, chatId, senderId);

        if (db.ignorados.has(senderId) && !utils.isOwner(senderId)) return;
        if (isGroup && db.grupos.desligados.has(chatId) && !utils.isOwner(senderId)) return;

        // PV: só dono ou VIP activo interage livremente
        if (!isGroup && !utils.isOwner(senderId)) {
          const vip = db.usersVIP.get(senderId);
          const isVipActivo = vip && vip.expiraEm > Date.now();
          if (!isVipActivo) {
            const ultimoEnvio = db.ultimoCartaoPV.get(senderId) || 0;
            if (Date.now() - ultimoEnvio < 10 * 60 * 1000) return;
            db.ultimoCartaoPV.set(senderId, Date.now());
            await sock.sendMessage(chatId, { text: gerarCartaoApresentacao() });
            return;
          }
        }

        // Auto-delete
        try {
          if (isGroup && db.autoDelete.has(chatId)) {
            const ms = db.autoDelete.get(chatId);
            setTimeout(async () => { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {} }, ms);
          }
        } catch {}

        if (isGroup) await utils.checkGroupExpired(sock, chatId);

        if (isGroup && fullText) {
          const isAdmin = await utils.isSenderGroupAdmin(sock, chatId, senderId);
          const isOwner = utils.isOwner(senderId);

          // Transações E-Mola/M-Pesa
          const dadosTransacoes = db.grupos.transacoes.get(chatId);
          if (dadosTransacoes?.ativo) {
            const comprovativo = detectarComprovativo(fullText);
            if (comprovativo) {
              const contasConfiguradas = dadosTransacoes.contas || [];
              const contaValida = !contasConfiguradas.length || contasConfiguradas.includes(comprovativo.contaDestino);
              if (contaValida) {
                dadosTransacoes.contador += 1;
                const numero = dadosTransacoes.contador;
                dadosTransacoes.pedidos[numero] = {
                  id: numero, usuario: senderId, valor: comprovativo.valor,
                  data: new Date().toISOString(), status: 'pendente',
                  idTransacao: comprovativo.idTransacao, tipo: comprovativo.tipo
                };
                salvarDados();
                registrarAcao(chatId, `Pedido #${numero} registado (${comprovativo.tipo}) por @${senderId.split('@')[0]}`);
                await sock.sendMessage(chatId, {
                  text: `🔄 PEDIDO #${numero} REGISTADO\n⏳ Aguarde revisão\n📱 ${comprovativo.idTransacao} | 💰 ${comprovativo.valor} MT\n👤 @${senderId.split('@')[0]}`,
                  mentions: [senderId]
                });
                try {
                  const metadata = await getMetadataCached(sock, chatId);
                  const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
                  for (const adminId of [...admins, `${CONFIG.ownerId}@s.whatsapp.net`]) {
                    await sock.sendMessage(adminId, {
                      text: `🔔 NOVO PEDIDO #${numero}\n👤 @${senderId.split('@')[0]} | 💰 ${comprovativo.valor} MT\n✅ .act ${numero} | ❌ .rj ${numero}`,
                      mentions: [senderId]
                    }).catch(() => {});
                  }
                } catch (e) { console.warn('Erro ao notificar admins:', e.message); }
                return;
              }
            }
          }

          // Anti-link + palavras banidas
          if (!isAdmin && !isOwner) {
            const antiLinkMode = db.grupos.antiLink.get(chatId);
            if (antiLinkMode) {
              const links = [...(fullText.match(REGEX_URL) || [])];
              const hasLink = links.length > 0 || /wa\.me\//.test(fullText) || /chat\.whatsapp\.com/.test(fullText);
              if (hasLink) {
                let ignore = false;
                const whitelist = db.whitelist.get(chatId) || new Set();
                for (const link of links) {
                  try {
                    const u = new URL(link.startsWith('http') ? link : 'http://' + link);
                    if (whitelist.has(u.hostname.replace(/^www\./, ''))) { ignore = true; break; }
                  } catch {}
                }
                if (!ignore) { await executarAntiLink(sock, chatId, msg, senderId, antiLinkMode); return; }
              }
            }
            const palavrasBanidas = db.grupos.palavrasBanidas.get(chatId) || [];
            for (const palavra of palavrasBanidas) {
              if (fullText.toLowerCase().includes(palavra)) {
                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                await sock.sendMessage(chatId, { text: `🚫 *PALAVRA PROIBIDA*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
                return;
              }
            }
          }

          if (!fullText.startsWith(CONFIG.prefix)) {
            // Gatilhos de áudio
            if (db.grupos.audioGatilhos.has(chatId)) {
              for (const [palavra, audioBuffer] of db.grupos.audioGatilhos.get(chatId)) {
                if (fullText.toLowerCase().includes(palavra)) {
                  await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: true });
                  return;
                }
              }
            }
            // Gatilhos de mídia
            if (db.grupos.midiaGatilhos.has(chatId)) {
              for (const [palavra, { buffer, tipo }] of db.grupos.midiaGatilhos.get(chatId)) {
                if (fullText.toLowerCase().includes(palavra)) {
                  if (tipo === 'image') await sock.sendMessage(chatId, { image: buffer, caption: `📸 ${palavra}` });
                  else if (tipo === 'video') await sock.sendMessage(chatId, { video: buffer, mimetype: 'video/mp4', caption: `🎬 ${palavra}` });
                  else await sock.sendMessage(chatId, { document: buffer, mimetype: 'application/octet-stream', fileName: `${palavra}.bin` });
                  return;
                }
              }
            }
            // Atalhos
            if (db.atalhos.has(fullText.toLowerCase().trim())) {
              const dadosAtalho = db.atalhos.get(fullText.toLowerCase().trim());
              return sock.sendMessage(chatId, { text: typeof dadosAtalho === 'string' ? dadosAtalho : dadosAtalho.texto });
            }

            const textoLower = fullText.toLowerCase();
            if (textoLower.includes('nano') || textoLower.includes('bot') || textoLower.includes('@' + CONFIG.botNumber)) {
              const soChamouOBot = /^(nano|bot)[!?. ]*$/i.test(fullText.trim());
              if (soChamouOBot) {
                const limiteMenu = verificarLimiteMenu(senderId, 'menu');
                if (!limiteMenu.permitido) {
                  const seg = Math.ceil(limiteMenu.esperarMs / 1000);
                  const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
                  await sock.sendMessage(chatId, { text: `⏳ Calma! Aguarda ${tempo}.` });
                  return;
                }
                await enviarMenuComBotoes(sock, chatId, senderId);
                return;
              }
              if (utils.isOwner(senderId) && isGroup && pareceIntentoSairGrupo(fullText)) {
                await sock.sendMessage(chatId, { text: '👋 Ok, já saio. Até já!' });
                setTimeout(() => sock.groupLeave(chatId), 2000);
                return;
              }
              if (isGroup && pareceIntentoQuemDono(fullText)) {
                await sock.sendMessage(chatId, { text: `👤 Fui criado por *${CONFIG.creator}*.\n📞 ${CONFIG.ownerNumber}` });
                return;
              }
              const ctxAtalho = { chatId, senderId, isGroup, msg, args: [] };
              const temAlvo = !!(utils.getQuotedMention(msg) || utils.getMentions(msg).length);
              if (isGroup && temAlvo && pareceIntentoBanir(fullText)) { await commands['ban'](sock, ctxAtalho); return; }
              if (isGroup && pareceIntentoFecharGrupo(fullText)) { await commands['close'](sock, ctxAtalho); return; }
              if (isGroup && pareceIntentoAbrirGrupo(fullText)) { await commands['open'](sock, ctxAtalho); return; }
              const temCitacao = !!msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
              if (isGroup && temCitacao && pareceIntentoApagarMensagem(fullText)) { await commands['dlt'](sock, ctxAtalho); return; }
              if (utils.isOwner(senderId) && pareceIntentoRelatorio(fullText)) { await enviarRelatorioCompleto(sock, chatId); return; }
              const limiteChat = verificarLimiteConversaIA(senderId);
              if (!limiteChat.permitido) {
                const seg = Math.ceil(limiteChat.esperarMs / 1000);
                const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
                await sock.sendMessage(chatId, { text: `⏳ Calma! Aguarda ${tempo}.` });
                return;
              }
              const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), true);
              if (resposta) await sock.sendMessage(chatId, { text: `💚 ${resposta}` });
              return;
            }

            if (db.grupos.iaAtivo.has(chatId) && fullText.length > 2) {
              const limiteChatLivre = verificarLimiteConversaIA(senderId);
              if (!limiteChatLivre.permitido) {
                const seg = Math.ceil(limiteChatLivre.esperarMs / 1000);
                const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
                await sock.sendMessage(chatId, { text: `⏳ Calma! Aguarda ${tempo}.`, quoted: msg });
                return;
              }
              const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), true);
              if (resposta) await sock.sendMessage(chatId, { text: `💚 ${resposta}`, quoted: msg });
              return;
            }

            if (textoLower === 'bom dia') await utils.reagir(sock, msg, '☀️');
            else if (textoLower === 'boa tarde') await utils.reagir(sock, msg, '🌇');
            else if (textoLower === 'boa noite') await utils.reagir(sock, msg, '🌙');
            else if (textoLower.includes('obrigado') || textoLower.includes('obrigada') || textoLower.includes('valeu')) await utils.reagir(sock, msg, '💚');
          }
        }

        // PV (dono/VIP) — IA
        if (!isGroup && fullText && !fullText.startsWith(CONFIG.prefix)) {
          if (utils.isOwner(senderId) && pareceIntentoRelatorio(fullText)) { await enviarRelatorioCompleto(sock, chatId); return; }
          const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), false);
          if (resposta) await sock.sendMessage(chatId, { text: `💚 ${resposta}` });
          return;
        }

        // Comandos com prefixo
        if (fullText?.startsWith(CONFIG.prefix)) {
          const args = fullText.slice(CONFIG.prefix.length).trim().split(/ +/);
          const cmd = args.shift()?.toLowerCase();
          if (cmd && commands[cmd]) {
            const cmdsDesativados = db.grupos.comandosDesativados.get(chatId);
            if (cmdsDesativados && cmdsDesativados.has(cmd) && !utils.isOwner(senderId)) {
              await utils.reagir(sock, msg, '🚫');
              return;
            }
            if (MENU_COMANDOS.has(cmd)) {
              const limiteMenu = verificarLimiteMenu(senderId, cmd);
              if (!limiteMenu.permitido) {
                const seg = Math.ceil(limiteMenu.esperarMs / 1000);
                const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
                return await sock.sendMessage(chatId, { text: `⏳ Calma! Aguarda ${tempo}.` });
              }
            }
            const rl = verificarRateLimit(senderId, cmd);
            if (!rl.permitido) {
              const seg = Math.ceil(rl.esperarMs / 1000);
              const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
              return await sock.sendMessage(chatId, { text: `⏳ Calma! Já usaste *.${cmd}* demais. Aguarda ${tempo}.` });
            }
            try { const cur = db.stats.get(cmd) || 0; db.stats.set(cmd, cur + 1); salvarDados(); } catch {}
            try {
              const midiaComando = db.grupos.midiaComandos.get(chatId)?.get(`.${cmd}`);
              if (midiaComando) {
                if (midiaComando.tipo === 'image') await sock.sendMessage(chatId, { image: midiaComando.buffer }).catch(() => {});
                else if (midiaComando.tipo === 'video') await sock.sendMessage(chatId, { video: midiaComando.buffer, mimetype: 'video/mp4' }).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
              }
              await commands[cmd](sock, { chatId, senderId, isGroup: !!isGroup, msg, args });
              await utils.reagir(sock, msg, COMANDO_EMOJIS[cmd] || '✅');
            } catch (erro) {
              if (!(erro instanceof PermissaoNegada)) console.error(`Erro ao executar .${cmd}:`, erro);
              await utils.reagir(sock, msg, '❌');
            }
            return;
          }
        }
      } catch (e) { console.error('Erro ao processar mensagem:', e.message); }
    });

    // Conexão
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          console.log('🚪 Bot desconectado (logout). Reinicia manualmente.');
          return;
        }
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 60000);
        console.log(`🔄 Reconectando em ${delay / 1000}s... (tentativa ${reconnectAttempts})`);
        setTimeout(startBot, delay);
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        console.log('✅ NANO BOT CONECTADO!');
        console.log(`📱 Número: ${sock.user.id}`);
        console.log(`⚡ Prefixo: ${CONFIG.prefix}`);
        console.log(`💚 Criado por: ${CONFIG.creator}`);
      }
    });
  } catch (err) {
    console.error('❌ Erro ao iniciar:', err);
    reconnectAttempts++;
    setTimeout(startBot, Math.min(10000 * reconnectAttempts, 60000));
  }
}

// =================== INICIAR ===================
if (!process.env.GROQ_API_KEY) {
  console.warn('⚠️ GROQ_API_KEY não definida no .env — a chave embutida será usada.');
}
console.log(`🚀 Iniciando ${CONFIG.botName}...`);
console.log(`👤 Criado por: ${CONFIG.creator}`);
startBot().catch(console.error);

module.exports = { CONFIG, db, commands, utils, startBot };
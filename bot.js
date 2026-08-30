const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadMediaMessage } = require('@whiskeysockets/baileys');
require('dotenv').config();
const Groq = require('groq-sdk');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const os = require('os');
const readline = require('readline');
const sharp = require('sharp');
sharp.cache(false); sharp.concurrency(1);
const axios = require('axios');
const translate = require('translate-google');
const { Image: WebpImage } = require('node-webpmux');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const CONFIG = {
  botName: "Nano Bot 🤖",
  creator: "Yanik Uaite",
  ownerId: "275381038891241",
  ownerNumber: "834788141",
  botNumber: "258850421617",
  prefix: ".",
  dataFile: path.join(__dirname, 'data', 'bot_data.json'),
  historicoFile: path.join(__dirname, 'data', 'historico.json')
};

const GROQ_API_KEY_DIRETA = process.env.GROQ_API_KEY_DIRETA || "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";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || GROQ_API_KEY_DIRETA });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<h1>💚 ${CONFIG.botName}</h1><p>Criado por ${CONFIG.creator}</p><p>🟢 Online</p>`);
});

server.on('error', (err) => {
  console.error('❌ Erro no servidor HTTP:', err.message);
});

server.listen(process.env.PORT || 3000, () => console.log(`🌐 HTTP na porta ${process.env.PORT || 3000}`));

const db = {
  gruposVIP: new Map(),
  grupoDono: new Map(),
  historicoIA: new Map(),
  historicoIAUltimoUso: new Map(),
  statusDono: null,
  historicoGrupos: new Map(),
  atalhos: new Map(),
  ultimoCartaoPV: new Map(),
  usersVIP: new Map(),
  grupos: {
    antiLink: new Map(),
    palavrasBanidas: new Map(),
    banidos: new Map(),
    boasvindas: new Map(),
    regras: new Map(),
    iaAtivo: new Set(),
    desligados: new Set(),
    comandosDesativados: new Map()
  },
  ignorados: new Set(),
  whitelist: new Map(),
  autoDelete: new Map(),
  indicadores: new Map(),
  stats: new Map(),
  notifications: new Map(),
  cache: new Map(),
  rateLimit: new Map()
};

const cacheMetadata = new Map();

async function getMetadataCached(sock, groupId) {
  const agora = Date.now();
  const c = cacheMetadata.get(groupId);
  if (c && c.expiraEm > agora) return c.data;
  const meta = await sock.groupMetadata(groupId);
  cacheMetadata.set(groupId, { data: meta, expiraEm: agora + 30000 });
  return meta;
}

setInterval(() => {
  const a = Date.now();
  for (const [k, v] of cacheMetadata) {
    if (v.expiraEm < a) cacheMetadata.delete(k);
  }
}, 300000);

const REGEX_URL = /(https?:\/\/[^\s]+)/g;
const cacheDonoLid = new Set();

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
    return formatos
      .filter(f => f.type === 'audio')
      .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0] || null;
  }

  const videos = formatos.filter(f => f.type === 'video');
  if (!videos.length) return null;

  return videos.find(f => f.ext === 'mp4' && /360|480/.test(f.label || '')) ||
         videos.find(f => f.ext === 'mp4') ||
         videos[0];
}

async function baixarBufferGen(formato, maxBytes = 64 * 1024 * 1024) {
  if (!formato?.url) return null;
  if (formato.filesize && formato.filesize > maxBytes) return null;

  const r = await axios.get(formato.url, {
    responseType: 'arraybuffer',
    timeout: 180000
  });

  if (!r.data || r.data.length === 0 || r.data.length > maxBytes) return null;
  return Buffer.from(r.data);
}

function extrairVideoId(link) {
  const m = link.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function converterVideoParaStickerAnimado(buffer, segundos = 6) {
  const tmpIn = path.join(os.tmpdir(), `nano_in_${Date.now()}.mp4`);
  const tmpOut = path.join(os.tmpdir(), `nano_out_${Date.now()}.webp`);

  fs.writeFileSync(tmpIn, buffer);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(tmpIn)
        .noAudio()
        .outputOptions([
          `-t ${segundos}`,
          '-vf scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=12',
          '-vcodec libwebp',
          '-lossless 0',
          '-compression_level 6',
          '-quality 45',
          '-loop 0',
          '-preset default',
          '-vsync 0'
        ])
        .save(tmpOut)
        .on('end', () => resolve())
        .on('error', (e) => reject(e));
    });

    return fs.readFileSync(tmpOut);
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

const RATE_LIMIT_MAX = 4;
const RATE_LIMIT_JANELA_MS = 180000;
const RATE_LIMIT_EXCLUIR = new Set(['dlt', 'info']);

function verificarRateLimit(senderId, cmd) {
  if (RATE_LIMIT_EXCLUIR.has(cmd)) return { permitido: true };

  const chave = `${senderId}|${cmd}`;
  const agora = Date.now();
  let usos = db.rateLimit.get(chave);

  if (!usos) {
    usos = [agora];
    db.rateLimit.set(chave, usos);
    return { permitido: true };
  }

  let i = 0;
  while (i < usos.length) {
    if (agora - usos[i] >= RATE_LIMIT_JANELA_MS) usos.splice(i, 1);
    else i++;
  }

  if (usos.length >= RATE_LIMIT_MAX) {
    return { permitido: false, esperarMs: RATE_LIMIT_JANELA_MS - (agora - usos[0]) };
  }

  usos.push(agora);
  return { permitido: true };
}

const CHAT_LIMITE_MAX = 5;
const CHAT_LIMITE_JANELA_MS = 300000;

function verificarLimiteConversaIA(senderId) {
  const chave = `chat|${senderId}`;
  const agora = Date.now();
  let usos = db.rateLimit.get(chave);

  if (!usos) {
    usos = [agora];
    db.rateLimit.set(chave, usos);
    return { permitido: true };
  }

  let i = 0;
  while (i < usos.length) {
    if (agora - usos[i] >= CHAT_LIMITE_JANELA_MS) usos.splice(i, 1);
    else i++;
  }

  if (usos.length >= CHAT_LIMITE_MAX) {
    return { permitido: false, esperarMs: CHAT_LIMITE_JANELA_MS - (agora - usos[0]) };
  }

  usos.push(agora);
  return { permitido: true };
}

const MENU_LIMITE_MAX = 2;
const MENU_LIMITE_JANELA_MS = 180000;

class PermissaoNegada extends Error {}

const MENU_COMANDOS = new Set(['menu', 'menubtn', 'h', 'help', 'cgeral', 'cadmin', 'cprot', 'cmidia', 'cstick', 'cdono']);

function verificarLimiteMenu(senderId, cmd) {
  const chave = `menu|${senderId}|${cmd}`;
  const agora = Date.now();
  let usos = db.rateLimit.get(chave);

  if (!usos) {
    usos = [agora];
    db.rateLimit.set(chave, usos);
    return { permitido: true };
  }

  let i = 0;
  while (i < usos.length) {
    if (agora - usos[i] >= MENU_LIMITE_JANELA_MS) usos.splice(i, 1);
    else i++;
  }

  if (usos.length >= MENU_LIMITE_MAX) {
    return { permitido: false, esperarMs: MENU_LIMITE_JANELA_MS - (agora - usos[0]) };
  }

  usos.push(agora);
  return { permitido: true };
}

const COMANDO_EMOJIS = {
  menu: '📜',
  menubtn: '📜',
  cgeral: '🌐',
  cadmin: '👮',
  cprot: '🛡️',
  cmidia: '📲',
  cstick: '🖼️',
  cdono: '👑',
  ping: '🏓',
  hora: '🕒',
  info: '💚',
  alug: '💰',
  stg: '💎',
  comandos: '📋',
  ranking: '🏆',
  pontos: '🔢',
  indicar: '📨',
  ban: '🔨',
  kick: '👢',
  up: '⬆️',
  down: '⬇️',
  all: '📢',
  hisr: '📜',
  close: '🔒',
  open: '🔓',
  link: '🔗',
  tid: '🆔',
  dlt: '🗑️',
  antil: '🔗',
  banw: '📵',
  unbanw: '✅',
  rg: '📜',
  ia: '🧠',
  auto: '🤖',
  vrg: '📃',
  listw: '📃',
  fig: '🎨',
  sticker: '🎨',
  stext: '✏️',
  stinfo: 'ℹ️',
  modelo: '🖼️',
  tr: '🌍',
  traduzir: '🌍',
  grcb: '🧾',
  ativ: '💎',
  rmvip: '🚫',
  lsg: '📋',
  bemv: '👋',
  at: '⚡',
  rmat: '🗑️',
  lsat: '⚡',
  stats: '📊',
  relatorio: '🧾',
  prefix: '⚙️',
  backup: '💾',
  restore: '♻️',
  wrnvp: '📢',
  offbot: '🔴',
  onbot: '🟢',
  ignorar: '🔇',
  designorar: '🔊',
  ignorados: '🔇',
  notificar: '🔔',
  estats: '📊',
  tk: '🎵',
  ig: '📸',
  yt: '🎬',
  ytd: '🎵',
  ytv: '🎥',
  dl: '🌐',
  fb: '📘',
  vinfo: '📊',
  canal: '📡',
  zip: '📦',
  dst: '🚫',
  listad: '📃',
  actcmd: '✅',
  vp: '👑',
  meuvip: '💎',
  id: '🆔',
  anime: '🧧',
  animes: '🧧',
  ani: '🧧',
  bili: '📺',
  save: '💾'
};

const NIVEIS_VIP = {
  ouro: { nome: 'Ouro 🥇', maxDias: 7, admin: true, ban: true, promote: false, rules: false, anti: false, boasvindas: false, sticker: false },
  diamante: { nome: 'Diamante 💎', maxDias: 30, admin: true, ban: true, promote: true, rules: true, anti: true, boasvindas: true, sticker: true },
  lenda: { nome: 'Lenda 👑', maxDias: 60, admin: true, ban: true, promote: true, rules: true, anti: true, boasvindas: true, sticker: true }
};

const RANK_VIP = { ouro: 1, diamante: 2, lenda: 3 };

const NIVEIS_VIP_USER = {
  ouro: { nome: 'Ouro 🥇', maxDias: 7, cmds: ['tk'] },
  diamante: { nome: 'Diamante 💎', maxDias: 30, cmds: ['tk', 'ig', 'fb', 'dl', 'vinfo'] },
  lenda: { nome: 'Lenda 👑', maxDias: 60, cmds: ['tk', 'ig', 'fb', 'dl', 'vinfo', 'yt', 'ytd', 'ytv', 'canal', 'zip'] }
};

function carregarDados() {
  try {
    const dir = path.dirname(CONFIG.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(CONFIG.dataFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));

      if (data.gruposVIP) for (const [k, v] of Object.entries(data.gruposVIP)) db.gruposVIP.set(k, v);
      if (data.grupoDono) for (const [k, v] of Object.entries(data.grupoDono)) db.grupoDono.set(k, v);
      if (data.atalhos) for (const [k, v] of Object.entries(data.atalhos)) db.atalhos.set(k, v);
      if (data.antiLink) for (const [k, v] of Object.entries(data.antiLink)) db.grupos.antiLink.set(k, v);
      if (data.palavrasBanidas) for (const [k, v] of Object.entries(data.palavrasBanidas)) db.grupos.palavrasBanidas.set(k, v);
      if (data.boasvindas) for (const [k, v] of Object.entries(data.boasvindas)) db.grupos.boasvindas.set(k, v);
      if (data.regras) for (const [k, v] of Object.entries(data.regras)) db.grupos.regras.set(k, v);
      if (data.banidos) for (const [k, v] of Object.entries(data.banidos)) db.grupos.banidos.set(k, v);
      if (data.iaAtivo) for (const id of data.iaAtivo) db.grupos.iaAtivo.add(id);
      if (data.desligados) for (const id of data.desligados) db.grupos.desligados.add(id);
      if (data.ignorados) for (const id of data.ignorados) db.ignorados.add(id);
      if (data.whitelist) for (const [k, v] of Object.entries(data.whitelist)) db.whitelist.set(k, new Set(v));
      if (data.autoDelete) for (const [k, v] of Object.entries(data.autoDelete)) db.autoDelete.set(k, v);
      if (data.indicadores) for (const [k, v] of Object.entries(data.indicadores)) db.indicadores.set(k, v);
      if (data.stats) for (const [k, v] of Object.entries(data.stats)) db.stats.set(k, v);
      if (data.notifications) for (const [k, v] of Object.entries(data.notifications)) db.notifications.set(k, v);
      if (data.prefixo) CONFIG.prefix = data.prefixo;
      if (data.usersVIP) for (const [k, v] of Object.entries(data.usersVIP)) db.usersVIP.set(k, v);
      if (data.comandosDesativados) for (const [k, v] of Object.entries(data.comandosDesativados)) db.grupos.comandosDesativados.set(k, new Set(v));
    }

    if (fs.existsSync(CONFIG.historicoFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.historicoFile, 'utf8'));
      for (const [k, v] of Object.entries(data)) db.historicoGrupos.set(k, v);
    }
  } catch (e) {
    console.error('Erro ao carregar dados:', e.message);
  }
}

function salvarDados() {
  try {
    const data = {
      gruposVIP: Object.fromEntries(db.gruposVIP),
      grupoDono: Object.fromEntries(db.grupoDono),
      atalhos: Object.fromEntries(db.atalhos),
      antiLink: Object.fromEntries(db.grupos.antiLink),
      palavrasBanidas: Object.fromEntries(db.grupos.palavrasBanidas),
      boasvindas: Object.fromEntries(db.grupos.boasvindas),
      regras: Object.fromEntries(db.grupos.regras),
      banidos: Object.fromEntries(db.grupos.banidos),
      iaAtivo: [...db.grupos.iaAtivo],
      desligados: [...db.grupos.desligados],
      ignorados: [...db.ignorados],
      whitelist: Object.fromEntries([...db.whitelist].map(([k, s]) => [k, [...s]])),
      autoDelete: Object.fromEntries(db.autoDelete),
      indicadores: Object.fromEntries(db.indicadores),
      stats: Object.fromEntries(db.stats),
      notifications: Object.fromEntries(db.notifications),
      prefixo: CONFIG.prefix,
      usersVIP: Object.fromEntries(db.usersVIP),
      comandosDesativados: Object.fromEntries([...db.grupos.comandosDesativados].map(([k, v]) => [k, [...v]]))
    };

    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), 'utf8');
    fs.writeFileSync(CONFIG.historicoFile, JSON.stringify(Object.fromEntries(db.historicoGrupos), null, 2), 'utf8');

    if (global.gc) {
      try { global.gc(); } catch {}
    }
  } catch (e) {
    console.error('Erro ao guardar dados:', e.message);
  }
}

function registrarAcao(grupo, acao) {
  if (!db.historicoGrupos.has(grupo)) db.historicoGrupos.set(grupo, []);
  const h = db.historicoGrupos.get(grupo);
  h.push({ acao, data: new Date().toISOString() });
  if (h.length > 15) h.shift();
  salvarDados();
}

carregarDados();

const utils = {
  extractIdNumber: (id) => {
    try {
      return id.replace(/[^0-9]/g, '');
    } catch {
      return '';
    }
  },

  isOwner: (id) => {
    const n = utils.extractIdNumber(id);
    if (!n) return false;
    if (cacheDonoLid.has(id)) return true;
    return n === CONFIG.ownerId || n.endsWith(CONFIG.ownerNumber);
  },

  escapeXml: (str) => String(str).replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[c])),

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
    } catch {
      return false;
    }
  },

  hasGroupAdminRights: async (sock, groupId, senderId) => {
    if (utils.isOwner(senderId)) return true;
    if (!utils.isGroupSubscribed(groupId)) return false;
    return await utils.isSenderGroupAdmin(sock, groupId, senderId);
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
        try {
          const p = JSON.parse(nativeFlow.paramsJson);
          if (p?.id) return p.id;
        } catch {}
      }

      const botaoId = msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.templateButtonReplyMessage?.selectedId;
      if (botaoId) return botaoId;

      const listaId = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;
      if (listaId) return listaId;

      return msg.message?.conversation ||
             msg.message?.extendedTextMessage?.text ||
             msg.message?.imageMessage?.caption ||
             msg.message?.videoMessage?.caption ||
             msg.message?.documentMessage?.caption ||
             " ";
    } catch {
      return " ";
    }
  },

  getQuotedMention: (msg) => {
    try {
      return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    } catch {
      return null;
    }
  },

  getMentions: (msg) => {
    try {
      return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    } catch {
      return [];
    }
  },

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
        await sock.sendMessage(groupId, {
          text: `⚠️ Assinatura do grupo *${metadata.subject}* expirou!\nContacte ${CONFIG.creator}: ${CONFIG.ownerNumber}`,
          mentions: admins
        });
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
    try {
      await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
    } catch {}
  },

  adicionarMetadadosSticker: async (buffer) => {
    try {
      const img = new WebpImage();
      await img.load(buffer);

      const exifJson = {
        'sticker-pack-id': `nanobot-${Date.now()}`,
        'sticker-pack-name': 'Nano Bot 🤖',
        'sticker-pack-publisher': 'Yanik Uaite • 834788141',
        'android-app-store-link': 'https://wa.me/258834788141',
        'ios-app-store-link': 'https://wa.me/258834788141',
        emojis: ['🤖', '💚']
      };

      const exifAttr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
        0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00,
        0x00, 0x00
      ]);

      const jsonBuffer = Buffer.from(JSON.stringify(exifJson), 'utf-8');
      const exif = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);

      img.exif = exif;
      const resultado = await img.save(null);

      const ok = Buffer.isBuffer(resultado) &&
                 resultado.length > 12 &&
                 resultado.subarray(0, 4).toString('ascii') === 'RIFF' &&
                 resultado.subarray(8, 12).toString('ascii') === 'WEBP';

      return ok ? resultado : buffer;
    } catch (e) {
      return buffer;
    }
  }
};

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
}

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
    if (!palavrasChave.some(p => userText.toLowerCase().includes(p))) return null;
  }

  if (!db.historicoIA.has(chatId)) db.historicoIA.set(chatId, []);
  const history = db.historicoIA.get(chatId);

  history.push({ role: 'user', content: userText });
  if (history.length > 10) history.shift();

  db.historicoIAUltimoUso.set(chatId, Date.now());

  try {
    let infoSistema = `ESTADO DO SISTEMA:\n- Grupos VIP: ${db.gruposVIP.size}\n- Anti-link: ${db.grupos.antiLink.size > 0 ? ` activo em ${db.grupos.antiLink.size} grupos` : 'inactivo'}\n- IA activa em ${db.grupos.iaAtivo.size} grupos\n- Uptime: ${Math.floor(process.uptime() / 60)} minutos\n`;

    let systemMsg;

    if (!isGrupo) {
      systemMsg = `Chamas-te ${CONFIG.botName}, assistente de WhatsApp criado por ${CONFIG.creator}.\nSimpático, directo, prestável. Português de Moçambique.\nRespondes a qualquer pergunta. Nunca inventas factos.\n${infoSistema}Prefixo: ${CONFIG.prefix}`;
      if (isOwner) systemMsg += `\n\nO DONO está a falar — podes partilhar detalhes do sistema.`;
    } else {
      systemMsg = `Chamas-te ${CONFIG.botName}, assistente de WhatsApp criado por ${CONFIG.creator}.\nSimpático, directo. Português de Moçambique. Máx. 3 frases.\n${iaAtiva ? 'IA LIVRE: responde a qualquer pergunta.' : 'MODO RESTRITO: só sobre o sistema do bot.'}\n${infoSistema}Prefixo: ${CONFIG.prefix}`;
      if (isOwner) systemMsg += `\n\nO DONO está a falar — dá informações detalhadas.`;
    }

    const modelos = [CONFIG.groq_model, process.env.GROQ_MODEL, ...GROQ_MODELOS_FALLBACK].filter((m, i, arr) => m && arr.indexOf(m) === i);

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
        console.warn(`⚠️ Modelo "${modelo}" falhou: ${String(e.message).substring(0, 140)}`);
      }
    }

    if (!resposta) {
      if (ultimoErro?.message?.includes('rate')) return "⏳ Muitas perguntas! Aguarda um momento.";
      if (ultimoErro?.message?.includes('auth') || ultimoErro?.message?.includes('key')) return "❌ Chave Groq inválida.";
      return "❌ Erro ao processar. Tenta novamente.";
    }

    history.push({ role: 'assistant', content: resposta });
    return resposta;
  } catch {
    return "❌ Erro ao processar. Tenta novamente.";
  }
}

async function gerarCartaoBoasVindas(sock, participant) {
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
          .png()
          .toBuffer();

        base = await sharp(base)
          .composite([{ input: avatar, top: 180, left: 340 }])
          .png()
          .toBuffer();
      }
    } catch {}

    return base;
  } catch {
    return null;
  }
}

async function gerarBlocosRelatorio(sock) {
  const gruposInfo = await sock.groupFetchAllParticipating();
  const grupoIds = Object.keys(gruposInfo);

  if (!grupoIds.length) return ['O bot não está em nenhum grupo.'];

  const blocos = [];

  for (const groupId of grupoIds) {
    const nome = gruposInfo[groupId]?.subject || groupId;
    const sub = db.gruposVIP.get(groupId);

    let vipTexto = '🚫 Sem assinatura';
    if (sub) {
      const r = sub.expiraEm - Date.now();
      vipTexto = r > 0 ? `${NIVEIS_VIP[sub.nivel]?.nome || sub.nivel} — expira em ${utils.tempoRestante(r)}` : '⌛ Expirado';
    }

    blocos.push(
      `━━━━━━━━━━━━━━━━━━━\n🏷️ *${nome}*\n💎 VIP: ${vipTexto}\n🔗 Anti-link: ${db.grupos.antiLink.get(groupId) ? `✅ (${db.grupos.antiLink.get(groupId)})` : '❌'}\n🤖 IA: ${db.grupos.iaAtivo.has(groupId) ? '✅' : '❌'}\n🚫 Palavras: ${(db.grupos.palavrasBanidas.get(groupId) || []).length}\n👋 Boas-vindas: ${db.grupos.boasvindas.has(groupId) ? '✅' : '❌'}\n📜 Regras: ${db.grupos.regras.has(groupId) ? '✅' : '❌'}\n🗑️ Auto-del: ${db.autoDelete.get(groupId) ? `✅ (${db.autoDelete.get(groupId)}ms)` : '❌'}\n⛔ Banidos: ${(db.grupos.banidos.get(groupId) || []).length}`
    );
  }

  return [`📊 *RELATÓRIO* — ${grupoIds.length} grupo(s)\n`, ...blocos];
}

async function enviarRelatorioCompleto(sock, chatId) {
  const partes = await gerarBlocosRelatorio(sock);

  if (partes.length === 1) {
    await sock.sendMessage(chatId, { text: partes[0] });
    return;
  }

  for (let i = 1; i < partes.length; i += 3) {
    await sock.sendMessage(chatId, {
      text: (i === 1 ? partes[0] : '') + partes.slice(i, i + 3).join('\n')
    });
  }
}

function pareceIntentoRelatorio(t) {
  const x = t.toLowerCase();
  return /grupo/.test(x) && /status|relat[oó]rio|resumo|situa[cç][aã]o|geri[rs]|administr/.test(x);
}

function pareceIntentoSairGrupo(t) {
  const x = t.toLowerCase();
  return /\b(sai|saia|sair|retira-?te|vai-te embora|desliga-?te)\b.*\b(grupo|daqui)\b/.test(x) ||
         /\b(sai|saia|pode\s+ir)\s+embora\b/.test(x);
}

function pareceIntentoBanir(t) {
  return /\b(bane|banir|expulsa|expulsar|remove|tira|silencia|silenciar|cala)\b/.test(t.toLowerCase());
}

function pareceIntentoFecharGrupo(t) {
  return /\bfecha(r)?\b.*\bgrupo\b/.test(t.toLowerCase());
}

function pareceIntentoAbrirGrupo(t) {
  return /\b(abre|abrir)\b.*\bgrupo\b/.test(t.toLowerCase());
}

function pareceIntentoApagarMensagem(t) {
  return /\b(apaga|apagar|deleta|deletar|remove)\b/.test(t.toLowerCase());
}

function pareceIntentoQuemDono(t) {
  const x = t.toLowerCase();
  return /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\sdono/.test(x) ||
         /quem\s+te\s+criou/.test(x) ||
         /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\scriador/.test(x);
}

function gerarCartaoApresentacao() {
  const saudacoes = [
    '👋 Olá! Prazer em conhecer-te!',
    '🤗 Ei! Bem-vindo(a) ao meu PV!',
    '👋 Hey! Que bom que vieste falar comigo!',
    '✨ Olá! Sou o Nano Bot!'
  ];

  const s = saudacoes[Math.floor(Math.random() * saudacoes.length)];

  return `💚 *NANO BOT* 🤖\n_Assistente Inteligente_\n\n${s}\n\n📌 *QUEM SOU:*\nAssistente pessoal criado por *${CONFIG.creator}*!\n\n✨ *O QUE FAÇO:*\n┃ 🛡️ Protejo e gerencio grupos\n┃ 💎 Sistema VIP exclusivo\n┃ 🎵 Downloads (TikTok, IG, YT, +1600 sites)\n┃ 🌍 Tradutor de idiomas\n┃ 🧠 Inteligência Artificial\n┃ 🎨 Stickers (estáticos e animados)\n\n📞 *SABER MAIS:*\n✆ ${CONFIG.ownerNumber}\n📧 yanikuaite@gmail.com\n\n💬 _"Tecnologia ao serviço da tua comunidade!"_`;
}

function gerarCartaoVipAtivo(sub) {
  const dias = Math.max(0, Math.ceil((sub.expiraEm - Date.now()) / 86400000));
  return `💎 *STATUS VIP*\n━━━━━━━━━━━━━━\n\n✅ Plano *${NIVEIS_VIP[sub.nivel]?.nome || sub.nivel}* activo!\n⏳ Dias restantes: *${dias}*\n\nPara renovar: ✆ ${CONFIG.ownerNumber}\n💚 Obrigado!`;
}

function gerarCartaoVipConvite() {
  return `💎 *ACTIVA O VIP!*\n━━━━━━━━━━━━━━\n\nEste grupo ainda não tem VIP.\n\nCom o VIP desbloqueias:\n├─ Administração automática\n├─ Anti-link e protecção\n├─ Boas-vindas personalizadas\n└─ Regras e auto-replies\n\nFala com o dono: ✆ ${CONFIG.ownerNumber}`;
}

async function enviarMenuComBotoes(sock, jid, senderId) {
  await commands['menu'](sock, { chatId: jid, args: [], senderId, isGroup: jid.endsWith('@g.us') });
}

async function enviarSubmenuBotoes(sock, jid, { corpo }) {
  await sock.sendMessage(jid, { text: corpo });
}

async function executarDownloadUniversal(sock, ctx, link) {
  const dados = await extrairGenDownload(link);
  const fonte = (dados.source || 'desconhecida').toUpperCase();
  const formatos = dados.formats || [];

  const video = escolherFormatoGen(dados, 'video');
  const imagens = formatos.filter(f => f.type === 'image' || /jpe?g|png|webp/.test(f.ext || ''));
  const audio = escolherFormatoGen(dados, 'audio');

  if (video) {
    const buf = await baixarBufferGen(video);
    if (buf) {
      return await sock.sendMessage(ctx.chatId, {
        video: buf,
        caption: `🌐 *${(dados.title || 'Vídeo').substring(0, 60)}*\n📡 Fonte: ${fonte}\n👤 ${dados.author || ''}\n💚 Nano Bot`,
        mimetype: 'video/mp4'
      });
    }
  }

  if (imagens.length) {
    let i = 0;

    for (const img of imagens.slice(0, 4)) {
      const buf = await baixarBufferGen(img, 32 * 1024 * 1024);
      if (buf) {
        await sock.sendMessage(ctx.chatId, {
          image: buf,
          caption: `🌐 ${fonte} (${i + 1}/${Math.min(imagens.length, 4)})`
        });
        i++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (i > 0) return;
  }

  if (audio) {
    const buf = await baixarBufferGen(audio, 32 * 1024 * 1024);
    if (buf) {
      return await sock.sendMessage(ctx.chatId, {
        audio: buf,
        mimetype: 'audio/mpeg',
        fileName: `${(dados.title || 'audio').replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.mp3`,
        ptt: false
      });
    }
  }

  return sock.sendMessage(ctx.chatId, {
    text: `😔 A plataforma *${fonte}* não devolveu mídia baixável.`
  });
}

const commands = {
  _getPerms: async (sock, ctx) => {
    const isOwner = utils.isOwner(ctx.senderId);
    const isGroupAdmin = ctx.isGroup ? await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId) : false;
    const sub = ctx.isGroup ? utils.getGroupSubscription(ctx.chatId) : null;
    const vip = sub ? NIVEIS_VIP[sub.nivel] : null;

    return {
      isOwner,
      isGroupAdmin,
      vip,
      sub,
      nivelNome: vip ? vip.nome : null,
      pAdmin: isOwner || (isGroupAdmin && !!vip?.admin),
      pBan: isOwner || (isGroupAdmin && !!vip?.ban),
      pPromote: isOwner || (isGroupAdmin && !!vip?.promote),
      pAnti: isOwner || (isGroupAdmin && !!vip?.anti),
      pRules: isOwner || (isGroupAdmin && !!vip?.rules),
      pBemv: isOwner || (isGroupAdmin && !!vip?.boasvindas),
      pSticker: isOwner || (isGroupAdmin && !!vip?.sticker)
    };
  },

  'menubtn': async (sock, ctx) => {
    await enviarMenuComBotoes(sock, ctx.chatId, ctx.senderId);
  },

  'menu': async (sock, ctx) => {
    const nome = ctx.senderId.split('@')[0];
    const p = await commands._getPerms(sock, ctx);

    const linhas = [`🌐 *Geral* → .cgeral`];

    if (p.pAdmin || p.pBan || p.pPromote) linhas.push(`👮 *Admin* → .cadmin`);
    if (p.pAnti || p.pRules || p.pBemv) linhas.push(`🛡️ *Proteção* → .cprot`);

    linhas.push(`📲 *Mídia* → .cmidia`);

    if (p.pSticker) linhas.push(`🎨 *Stickers* → .cstick`);
    if (p.isOwner) linhas.push(`👑 *Dono* → .cdono`);

    const nivelLinha = p.nivelNome ? `💎 Grupo: ${p.nivelNome}` : (ctx.isGroup ? '📎 Grupo sem assinatura' : '👤 Modo privado');

    await sock.sendMessage(ctx.chatId, {
      text: `💚 *NANO BOT* 🤖\n━━━━━━━━━━━━━━\n\n👤 Olá, @${nome}!\n${nivelLinha}\n\n📂 *CATEGORIAS:*\n\n${linhas.join('\n')}\n\n━━━━━━━━━━━━━━\n⚡ Prefixo: *${CONFIG.prefix}*\n📞 Suporte: ${CONFIG.ownerNumber}\n💬 _Escreve o comando da categoria_`,
      mentions: [ctx.senderId]
    });
  },

  'h': async (sock, ctx) => commands['menu'](sock, ctx),
  'help': async (sock, ctx) => commands['menu'](sock, ctx),

  'cgeral': async (sock, ctx) => {
    await enviarSubmenuBotoes(sock, ctx.chatId, {
      corpo: `🌐 *GERAL*\n━━━━━━━━━━━━━━\n\n📌 *BÁSICO*\n.menu → categorias\n.info → estado do bot\n.ping → velocidade\n.hora → hora de Maputo\n.id → IDs do sistema\n\n💰 *ASSINATURA*\n.alug → ver planos\n.stg → estado deste grupo\n\n🏆 *INDICAÇÕES*\n.indicar [nº] → +1 ponto\n.ranking → top 10\n.pontos → meus pontos\n\n🌍 *UTILITÁRIOS*\n.tr [texto] → traduzir\n.anime [nome] → buscar anime\n.bili [termo] → pesquisa Bilibili\n\n━━━━━━━━━━━━━━\n💡 Dica: usa *.cmidia* para downloads`
    });
  },

  'cadmin': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAdmin && !p.pBan && !p.pPromote) throw new PermissaoNegada();

    let texto = `👮 *ADMINISTRAÇÃO*\n━━━━━━━━━━━━━━\n`;

    if (p.pAdmin) {
      texto += `\n🏟️ *GRUPO*\n.all [msg] → marcar todos\n.close → só admins falam\n.open → todos falam\n.link → link de convite\n.tid → ID do grupo\n.dlt → apagar (responde)\n`;
    }

    if (p.pBan) {
      texto += `\n🔨 *MODERAÇÃO*\n.ban @user → banir\n.kick @user → expulsar\n.listb → ver banidos\n`;
    }

    if (p.pPromote) {
      texto += `\n👑 *CARGOS*\n.up @user → promover\n.down @user → rebaixar\n`;
    }

    texto += `\n🚫 *COMANDOS DO GRUPO*\n.dst .cmd → desativar aqui\n.actcmd .cmd → reativar\n.listad → ver desativados\n\n━━━━━━━━━━━━━━\n💡 Requer grupo VIP + admin`;

    await enviarSubmenuBotoes(sock, ctx.chatId, { corpo: texto });
  },

  'cprot': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAnti && !p.pRules && !p.pBemv) throw new PermissaoNegada();

    let texto = `🛡️ *PROTEÇÃO*\n━━━━━━━━━━━━━━\n`;

    if (p.pAnti) {
      texto += `\n🔗 *ANTI-LINK*\n.antil warn → avisar + apagar\n.antil delete → só apagar\n.antil kick → expulsar\n.antil ban → banir\n.antil off → desligar\n.antil add [site] → permitir\n\n⏱️ *AUTO-DELETE*\n.auto 10s → apagar msgs\n.auto off → desligar\n\n🚫 *PALAVRAS*\n.banw [palavra] → proibir\n.unbanw [palavra] → liberar\n.listw → ver lista\n`;
    }

    if (p.pRules) {
      texto += `\n📜 *REGRAS*\n.rg [texto] → definir\n.vrg → ler regras\n`;
    }

    texto += `\n🤖 *IA*\n.ia on/off → IA livre no grupo\n\n━━━━━━━━━━━━━━\n💡 Protege o grupo 24/7`;

    await enviarSubmenuBotoes(sock, ctx.chatId, { corpo: texto });
  },

  'cmidia': async (sock, ctx) => {
    await enviarSubmenuBotoes(sock, ctx.chatId, {
      corpo: `📲 *MÍDIA & DOWNLOADS*\n━━━━━━━━━━━━━━\n\n🎵 *REDES SOCIAIS*\n.tk [link] → TikTok\n.ig [link] → Instagram\n.fb [link] → Facebook\n.dl [link] → universal (1600+ sites)\n\n🎬 *YOUTUBE*\n.yt [pesquisa] → pesquisar\n.ytv [link] → vídeo (até 30min)\n.ytd [link] → áudio\n\n🧧 *ANIME & BUSCAS*\n.anime [nome] → buscar anime\n.bili [termo] → pesquisa Bilibili\n.save → guardar mídia citada\n\n📊 *EXTRAS*\n.vinfo [link] → ficha da mídia\n.canal [url] → listar vídeos\n.zip [links] → empacotar ZIP\n\n🌍 *OUTROS*\n.tr [texto] → traduzir\n.grcb [plano] [dias] [nº] [valor]\n\n━━━━━━━━━━━━━━\n💎 Alguns comandos requerem VIP de utilizador\n🔎 Vê o teu: *.meuvip*`
    });
  },

  'cstick': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pSticker) throw new PermissaoNegada();

    await enviarSubmenuBotoes(sock, ctx.chatId, {
      corpo: `🎨 *STICKERS*\n━━━━━━━━━━━━━━\n\n🖼️ *CRIAR*\n.fig → foto = sticker\n.fig → vídeo/GIF = animado 🎞️\n.stext [texto] → sticker de texto\n\nℹ️ *INFO*\n.stinfo → detalhes (responde)\n\n━━━━━━━━━━━━━━\n✍️ Assinatura: Nano Bot • Yanik Uaite • 834788141`
    });
  },

  'cdono': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    await enviarSubmenuBotoes(sock, ctx.chatId, {
      corpo: `👑 *PAINEL DO DONO*\n━━━━━━━━━━━━━━\n\n💎 *VIPs DE GRUPO*\n.ativ [nível] [dias] → ativar\n.rmvip → remover\n.lsg → listar grupos\n.wrnvp all → avisar todos\n\n👤 *VIPs DE USUÁRIO*\n.vp @user [nível] [dias]\n.meuvip → ver estado\n\n🛠️ *SISTEMA*\n.stats → estatísticas\n.relatorio → tudo dos grupos\n.hisr → histórico do grupo\n.prefix [novo] → mudar prefixo\n.backup / .restore\n.modelo [nome] → trocar IA\n\n🔇 *CONTROLO*\n.offbot / .onbot\n.ignorar @user\n.designorar @user\n.ignorados\n.dst / .actcmd / .listad\n\n🧾 *LOJA*\n.grcb [plano] [dias] [nº] [valor]\n\n🆔 *SISTEMA*\n.id → IDs do bot\n\n━━━━━━━━━━━━━━\n⚡ Acesso total do dono`
    });
  },

  'ping': async (sock, ctx) => {
    const inicio = Date.now();
    const latencia = Date.now() - inicio;
    const status = latencia < 100 ? '🟢 Excelente' : latencia < 300 ? '🟡 Normal' : '🔴 Lento';
    const barra = latencia < 100 ? '█████████░' : latencia < 300 ? '██████░░░░' : '███░░░░░░░';

    const frases = [
      '🏓 Pooong! Estou mais rápido que um raio! ⚡',
      '🏓 Pong! Acordado e pronto pra ação! 💪',
      '🏓 Pong! Nano Bot na velocidade da luz! 🚀',
      '🏓 Pong! Tô vivo e a todo vapor! 🔥'
    ];

    const frase = frases[Math.floor(Math.random() * frases.length)];

    await sock.sendMessage(ctx.chatId, {
      text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ${frase}\n┃\n┃ ⚡ Latência: *${latencia}ms*\n┃ 📶 Sinal: ${barra}\n┃ ${status}\n┃ ⏱️ Uptime: ${utils.tempoRestante(process.uptime() * 1000)}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
  },

  'hora': async (sock, ctx) => {
    const agora = new Date();

    const hora = agora.toLocaleTimeString('pt-PT', {
      timeZone: 'Africa/Maputo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const data = agora.toLocaleDateString('pt-PT', {
      timeZone: 'Africa/Maputo',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const h = parseInt(agora.toLocaleTimeString('pt-PT', {
      timeZone: 'Africa/Maputo',
      hour: '2-digit',
      hour12: false
    }));

    let periodo, emoji;

    if (h >= 5 && h < 12) {
      periodo = 'Bom dia! ☀️';
      emoji = '🌅';
    } else if (h >= 12 && h < 18) {
      periodo = 'Boa tarde! 🌤️';
      emoji = '☀️';
    } else if (h >= 18 && h < 21) {
      periodo = 'Boa noite! 🌆';
      emoji = '🌇';
    } else {
      periodo = 'Boa madrugada! 🌙';
      emoji = '🌙';
    }

    await sock.sendMessage(ctx.chatId, {
      text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ${emoji} *${periodo}*\n┃\n┃ ⏰ São exatamente *${hora}*\n┃ 📅 ${data}\n┃ 🌍 Fuso: Maputo (CAT)\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
  },

  'tid': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;

    await sock.sendMessage(ctx.chatId, {
      text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🆔 *ID DO CHAT*\n┃\n┃ ${ctx.chatId}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
  },

  'id': async (sock, ctx) => {
    const botId = sock.user?.id || 'Desconhecido';
    const botNumber = botId.split('@')[0];

    await sock.sendMessage(ctx.chatId, {
      text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🆔 IDs\n┃\n┃ 🤖 Bot: ${botId}\n┃ Número: ${botNumber}\n┃\n┃ 👑 Dono CONFIG: ${CONFIG.ownerId}\n┃ Owner: ${CONFIG.ownerNumber}\n┃\n┃ 👤 Tu: ${ctx.senderId}\n┃ É dono? ${utils.isOwner(ctx.senderId) ? '✅' : '❌'}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
  },

  'info': async (sock, ctx) => {
    const totalVip = db.gruposVIP.size;
    const totalVipUsers = db.usersVIP.size;
    const antiLinkAtivo = db.grupos.antiLink.size;
    const uptime = utils.tempoRestante(process.uptime() * 1000);
    const memoria = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const totalCmds = Object.keys(commands).length;

    const frases = [
      '_"A servir com dedicação, 24/7!"_ 💪',
      '_"Sempre online, sempre pronto!"_ 🚀',
      '_"O teu assistente de confiança!"_ 🤖'
    ];

    await sock.sendMessage(ctx.chatId, {
      text: `💚 NANO BOT 🤖\n━━━━━━━━━━━━━━\n\n👨‍💻 Criador: ${CONFIG.creator}\n📱 Contacto: ${CONFIG.ownerNumber}\n⚡ Prefixo: ${CONFIG.prefix}\n🟢 Status: Online\n⏱️ Online há: ${uptime}\n💾 Memória: ${memoria} MB\n\n📊 ─── NÚMEROS ───\n├─ 💎 Grupos VIP: ${totalVip}\n├─ 👑 Users VIP: ${totalVipUsers}\n├─ 🔗 Anti-link: ${antiLinkAtivo} grupos\n├─ 🧠 IA activa: ${db.grupos.iaAtivo.size} grupos\n├─ ⚡ Atalhos: ${db.atalhos.size}\n└─ 🔧 Comandos: ${totalCmds}\n\n${frases[Math.floor(Math.random() * frases.length)]}`
    });
  },

  'alug': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, {
      text: `💰 ALUGUER DO BOT\n━━━━━━━━━━━━━━\n\n📦 Planos:\n├─ 🥇 Ouro - 7 dias\n├─ 💎 Diamante - 30 dias\n└─ 👑 Lenda - 60 dias\n\n📞 ${CONFIG.creator}\n📱 ${CONFIG.ownerNumber}`
    });
  },

  'stg': async (sock, ctx) => {
    const sub = db.gruposVIP.get(ctx.chatId);

    if (!sub || sub.expiraEm < Date.now()) {
      return sock.sendMessage(ctx.chatId, {
        text: `📝 SEM ASSINATURA\n\nContacte: ${CONFIG.creator}\n📱 ${CONFIG.ownerNumber}`
      });
    }

    const restante = Math.max(0, sub.expiraEm - Date.now());
    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const nivel = NIVEIS_VIP[sub.nivel];

    await sock.sendMessage(ctx.chatId, {
      text: `💚 STATUS DA ASSINATURA\n━━━━━━━━━━━━━━\n\n💎 Nível: ${nivel.nome}\n⏳ Restante: ${d}d ${h}h\n\n🔑 Permissões:\n├─ Ban: ${nivel.ban ? '✅' : '❌'}\n├─ Promover: ${nivel.promote ? '✅' : '❌'}\n├─ Regras: ${nivel.rules ? '✅' : '❌'}\n├─ Protecção: ${nivel.anti ? '✅' : '❌'}\n├─ Boas-vindas: ${nivel.boasvindas ? '✅' : '❌'}\n└─ Stickers: ${nivel.sticker ? '✅' : '❌'}`
    });
  },

  'auto': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;

    const mode = ctx.args[0]?.toLowerCase();

    if (!mode) {
      return sock.sendMessage(ctx.chatId, {
        text: 'Uso: .auto [tempo|off]. Ex: .auto 10s, .auto 5m, .auto off'
      });
    }

    if (mode === 'off') {
      db.autoDelete.delete(ctx.chatId);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: '⏱️ Auto-delete desativado' });
    }

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

    if (!ms) {
      return sock.sendMessage(ctx.chatId, { text: 'Formato inválido. Ex: 10s, 5m, 1h' });
    }

    db.autoDelete.set(ctx.chatId, ms);
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `⏱️ Auto-delete ativado: ${mode}` });
  },

  'indicar': async (sock, ctx) => {
    const numero = ctx.args[0];

    if (!numero) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .indicar [numero]' });
    }

    const cur = db.indicadores.get(ctx.senderId) || 0;
    db.indicadores.set(ctx.senderId, cur + 1);
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `✅ Indicação registada. Pontos: ${cur + 1}` });
  },

  'ranking': async (sock, ctx) => {
    const arr = [...db.indicadores.entries()];

    if (!arr.length) {
      return sock.sendMessage(ctx.chatId, { text: 'Nenhuma indicação registada.' });
    }

    arr.sort((a, b) => b[1] - a[1]);

    const top = arr.slice(0, 10).map((r, i) => `${i + 1}. @${r[0].split('@')[0]} — ${r[1]} pontos`).join('\n');

    await sock.sendMessage(ctx.chatId, {
      text: `🏆 Ranking:\n${top}`,
      mentions: arr.slice(0, 10).map(r => r[0])
    });
  },

  'pontos': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, {
      text: `🔢 Tens ${db.indicadores.get(ctx.senderId) || 0} pontos.`
    });
  },

  'traduzir': async (sock, ctx) => {
    const all = ctx.args.join(' ');

    if (!all) {
      return sock.sendMessage(ctx.chatId, {
        text: 'Uso: .traduzir [texto] ou .traduzir [idioma] [texto]'
      });
    }

    let target = 'pt';
    let text = all;

    const maybe = ctx.args[0];
    if (maybe && maybe.length <= 3 && ctx.args.length > 1) {
      target = maybe;
      text = ctx.args.slice(1).join(' ');
    }

    try {
      const res = await translate(text, { to: target });
      await sock.sendMessage(ctx.chatId, { text: `🌐 Tradução (${target}):\n${res}` });
    } catch (e) {
      await sock.sendMessage(ctx.chatId, { text: 'Erro na tradução.' });
    }
  },

  'tr': async (sock, ctx) => commands['traduzir'](sock, ctx),

  'wrnvp': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    if ((ctx.args[0] || '').toLowerCase() !== 'all') {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .wrnvp all' });
    }

    let gruposInfo;

    try {
      gruposInfo = await sock.groupFetchAllParticipating();
    } catch (e) {
      return sock.sendMessage(ctx.chatId, { text: `Erro: ${e.message}` });
    }

    const grupoIds = Object.keys(gruposInfo);

    if (!grupoIds.length) {
      return sock.sendMessage(ctx.chatId, { text: 'O bot não está em nenhum grupo.' });
    }

    await sock.sendMessage(ctx.chatId, { text: `📣 A avisar ${grupoIds.length} grupo(s)...` });

    let enviados = 0;
    let falhas = 0;

    for (const groupId of grupoIds) {
      const sub = db.gruposVIP.get(groupId);
      const texto = (sub && sub.expiraEm > Date.now()) ? gerarCartaoVipAtivo(sub) : gerarCartaoVipConvite();

      try {
        await sock.sendMessage(groupId, { text: texto });
        enviados++;
      } catch {
        falhas++;
      }

      await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1000)));
    }

    await sock.sendMessage(ctx.chatId, {
      text: `✅ Enviado a ${enviados} grupo(s)${falhas ? `, ${falhas} falha(s)` : ''}.`
    });
  },

  'grcb': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const plano = (ctx.args[0] || '').toLowerCase();
    const dias = ctx.args[1];
    const numero = ctx.args[2];
    const valor = ctx.args[3] || null;

    if (!NIVEIS_VIP[plano] || !dias || !numero) {
      return sock.sendMessage(ctx.chatId, {
        text: 'Uso: .grcb [ouro/diamante/lenda] [dias] [número] [valor?]'
      });
    }

    const TEMAS = {
      ouro: { cor1: '#7a5c00', cor2: '#ffd700', nome: 'OURO 🥇' },
      diamante: { cor1: '#0d3b66', cor2: '#4fc3f7', nome: 'DIAMANTE 💎' },
      lenda: { cor1: '#3a0d66', cor2: '#ffd700', nome: 'LENDA 👑' }
    };

    const tema = TEMAS[plano];
    const agora = new Date();

    const dataStr = agora.toLocaleDateString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const horaStr = agora.toLocaleTimeString('pt-PT', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const idRecibo = 'YNK' + Date.now().toString().slice(-8);

    const linhaValor = valor ? `
    <text x="90" y="700" font-size="24" font-family="Arial" fill="#999999">Valor</text>
    <text x="90" y="738" font-size="32" font-family="Arial" font-weight="bold" fill="#ffffff">${utils.escapeXml(valor)} MT</text>` : '';

    const yData = valor ? 800 : 700;

    const svg = `<svg width="900" height="1150" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${tema.cor1}"/>
      <stop offset="100%" stop-color="${tema.cor2}"/>
    </linearGradient>
  </defs>
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
      await sock.sendMessage(ctx.chatId, {
        image: buf,
        caption: `🧾 Comprovativo — ${tema.nome}`
      });
    } catch (e) {
      await sock.sendMessage(ctx.chatId, { text: 'Erro ao gerar comprovativo.' });
    }
  },

  'modelo': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const model = ctx.args[0];

    if (!model) {
      return sock.sendMessage(ctx.chatId, {
        text: `Modelo atual: ${CONFIG.groq_model || 'llama-3.3-70b-versatile'}`
      });
    }

    CONFIG.groq_model = model;
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `✔️ Modelo definido: ${model}` });
  },

  'backup': async (sock, ctx) => {
    if (!ctx.isGroup) throw new PermissaoNegada();
    if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) throw new PermissaoNegada();

    const dir = path.join(__dirname, 'data', 'backups');
    fse.ensureDirSync(dir);

    const out = path.join(dir, `${ctx.chatId.replace(/[^a-z0-9]/gi, '_')}.json`);

    const cfg = {
      antiLink: db.grupos.antiLink.get(ctx.chatId),
      palavrasBanidas: db.grupos.palavrasBanidas.get(ctx.chatId) || [],
      boasvindas: db.grupos.boasvindas.get(ctx.chatId) || null,
      regras: db.grupos.regras.get(ctx.chatId) || null
    };

    fs.writeFileSync(out, JSON.stringify(cfg, null, 2));

    await sock.sendMessage(ctx.chatId, { text: `📦 Backup criado: ${out}` });
  },

  'restore': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const rawFile = ctx.args[0] || '';

    if (!rawFile || rawFile.includes('/') || rawFile.includes('\\') || rawFile.includes('..')) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Nome de backup inválido.' });
    }

    const file = path.basename(rawFile);
    const fp = path.join(__dirname, 'data', 'backups', file);

    if (!fs.existsSync(fp)) {
      return sock.sendMessage(ctx.chatId, { text: 'Backup não encontrado.' });
    }

    const cfg = JSON.parse(fs.readFileSync(fp, 'utf8'));

    if (cfg.antiLink) db.grupos.antiLink.set(ctx.chatId, cfg.antiLink);
    if (cfg.palavrasBanidas) db.grupos.palavrasBanidas.set(ctx.chatId, cfg.palavrasBanidas);
    if (cfg.boasvindas) db.grupos.boasvindas.set(ctx.chatId, cfg.boasvindas);
    if (cfg.regras) db.grupos.regras.set(ctx.chatId, cfg.regras);

    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: '✅ Restore concluído.' });
  },

  'estats': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const entries = [...db.stats.entries()].sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      return sock.sendMessage(ctx.chatId, { text: 'Sem estatísticas.' });
    }

    await sock.sendMessage(ctx.chatId, {
      text: `📊 Estatísticas:\n${entries.map(e => `${e[0]} → ${e[1]}`).join('\n')}`
    });
  },

  'comandos': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, {
      text: `🔎 Comandos: ${Object.keys(commands).join(', ')}`
    });
  },

  'notificar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBoasvindasRights(sock, ctx.chatId, ctx.senderId))) return;

    const a = ctx.args[0]?.toLowerCase();

    if (a === 'on') {
      db.notifications.set(ctx.chatId, true);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: '🔔 Notificações ON' });
    }

    if (a === 'off') {
      db.notifications.set(ctx.chatId, false);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: '🔕 Notificações OFF' });
    }

    await sock.sendMessage(ctx.chatId, {
      text: `🔔 Notificações: ${db.notifications.get(ctx.chatId) ? 'ON' : 'OFF'}`
    });
  },

  'stats': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const memoria = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const uptime = utils.tempoRestante(process.uptime() * 1000);

    await sock.sendMessage(ctx.chatId, {
      text: `📊 ESTATÍSTICAS\n━━━━━━━━━━━━━━\n\n🤖 Grupos VIP: ${db.gruposVIP.size}\n📝 Comandos: ${Object.keys(commands).length}\n🔗 Atalhos: ${db.atalhos.size}\n💾 Memória: ${memoria} MB\n⏰ Online: ${uptime}\n⚡ Prefixo: ${CONFIG.prefix}\n\n🛡️ PROTECÇÃO\n├─ Anti-link: ${db.grupos.antiLink.size}\n├─ Palavras banidas: ${db.grupos.palavrasBanidas.size}\n└─ IA activa: ${db.grupos.iaAtivo.size}`
    });
  },

  'relatorio': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    try {
      await enviarRelatorioCompleto(sock, ctx.chatId);
    } catch (e) {
      await sock.sendMessage(ctx.chatId, { text: `Erro: ${e.message}` });
    }
  },

  'hisr': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const historico = db.historicoGrupos.get(ctx.chatId) || [];

    if (!historico.length) {
      return sock.sendMessage(ctx.chatId, { text: '📝 Sem histórico.' });
    }

    let texto = `📋 HISTÓRICO (últimas ${Math.min(historico.length, 10)})\n━━━━━━━━━━━━━━\n`;

    for (const h of historico.slice(-10).reverse()) {
      const data = new Date(h.data).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
      texto += `• ${h.acao}\n  ${data}\n`;
    }

    await sock.sendMessage(ctx.chatId, { text: texto });
  },

  'prefix': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const novoPrefixo = ctx.args[0];

    if (!novoPrefixo) {
      return sock.sendMessage(ctx.chatId, { text: `⚡ Prefixo actual: ${CONFIG.prefix}` });
    }

    CONFIG.prefix = novoPrefixo;
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `✅ Novo prefixo: ${novoPrefixo}` });
  },

  'ativ': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const nivel = ctx.args[0]?.toLowerCase();

    if (!nivel || !NIVEIS_VIP[nivel]) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .ativ [ouro/diamante/lenda] [dias]` });
    }

    let dias = parseInt(ctx.args[1]) || NIVEIS_VIP[nivel].maxDias;
    dias = Math.min(dias, NIVEIS_VIP[nivel].maxDias);

    db.gruposVIP.set(ctx.chatId, {
      nivel,
      expiraEm: Date.now() + (dias * 86400000),
      diasTotal: dias,
      ativadoPor: ctx.senderId,
      ativadoEm: Date.now()
    });

    salvarDados();
    registrarAcao(ctx.chatId, `VIP activado: ${NIVEIS_VIP[nivel].nome} por ${dias} dias`);

    await sock.sendMessage(ctx.chatId, {
      text: `🎉 PARABÉNS!\n━━━━━━━━━━━━━━\n\n✅ VIP activado com sucesso!\n\n💎 Nível: ${NIVEIS_VIP[nivel].nome}\n📅 Duração: ${dias} dias\n👤 Por: @${ctx.senderId.split('@')[0]}\n\n🔓 Todas as funcionalidades deste nível estão desbloqueadas!\n\n💬 Aproveita ao máximo! 🚀`,
      mentions: [ctx.senderId]
    });
  },

  'rmvip': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    db.gruposVIP.delete(ctx.chatId);
    salvarDados();
    registrarAcao(ctx.chatId, 'VIP removido pelo dono');

    await sock.sendMessage(ctx.chatId, { text: `✅ VIP REMOVIDO` });
  },

  'offbot': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    db.grupos.desligados.add(ctx.chatId);
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `🔴 BOT DESLIGADO AQUI` });
  },

  'onbot': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    db.grupos.desligados.delete(ctx.chatId);
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `🟢 BOT LIGADO AQUI` });
  },

  'ignorar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];

    if (!target && ctx.args[0]) {
      target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    }

    if (!target) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .ignorar [@pessoa|número]` });
    }

    if (utils.isOwner(target)) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Não posso ignorar o dono.` });
    }

    if (db.usersVIP.has(target) && db.usersVIP.get(target).expiraEm > Date.now()) {
      return sock.sendMessage(ctx.chatId, {
        text: `❌ Não posso ignorar este utilizador, pois ele possui um plano VIP activo.`,
        mentions: [target]
      });
    }

    db.ignorados.add(target);
    salvarDados();

    await sock.sendMessage(ctx.chatId, {
      text: `🔇 A IGNORAR\n@${target.split('@')[0]}`,
      mentions: [target]
    });
  },

  'designorar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];

    if (!target && ctx.args[0]) {
      target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    }

    if (!target) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .designorar [@pessoa|número]` });
    }

    db.ignorados.delete(target);
    salvarDados();

    await sock.sendMessage(ctx.chatId, {
      text: `🔊 DEIXEI DE IGNORAR\n@${target.split('@')[0]}`,
      mentions: [target]
    });
  },

  'ignorados': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    if (!db.ignorados.size) {
      return sock.sendMessage(ctx.chatId, { text: '📝 Sem ignorados.' });
    }

    const lista = [...db.ignorados].map(id => `🔇 @${id.split('@')[0]}`).join('\n');

    await sock.sendMessage(ctx.chatId, {
      text: `🔇 IGNORADOS\n\n${lista}`,
      mentions: [...db.ignorados]
    });
  },

  'lsg': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    if (!db.gruposVIP.size) {
      return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum grupo activo.' });
    }

    let lista = `💚 GRUPOS ACTIVOS\n━━━━━━━━━━━━━━\n\n`;

    for (const [g, s] of db.gruposVIP) {
      const d = Math.floor(Math.max(0, s.expiraEm - Date.now()) / 86400000);
      lista += `📞 ${g.split('@')[0]}\n   ${NIVEIS_VIP[s.nivel].nome} • ${d}d\n\n`;
    }

    await sock.sendMessage(ctx.chatId, { text: lista });
  },

  'sticker': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    }

    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;

    let buffer = null;
    let processado = null;

    try {
      const msg = ctx.msg;
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const mediaMsg = quotedMsg ? { message: quotedMsg } : msg;

      if (mediaMsg.message?.imageMessage) {
        buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});

        processado = await sharp(buffer)
          .resize(512, 512, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .webp({ quality: 85, effort: 4 })
          .toBuffer();

        buffer = null;
      } else if (mediaMsg.message?.videoMessage) {
        const segundos = mediaMsg.message.videoMessage.seconds || 0;

        if (segundos > 10) {
          return sock.sendMessage(ctx.chatId, {
            text: '❌ Máximo 10 segundos para sticker animado!'
          });
        }

        await utils.reagir(sock, ctx.msg, '⏳');

        await sock.sendMessage(ctx.chatId, {
          text: '🎞️ *A criar sticker ANIMADO...*\n⏳ Isto pode levar uns segundos...'
        });

        buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
        processado = await converterVideoParaStickerAnimado(buffer, Math.min(segundos || 6, 6));
        buffer = null;

        if (processado.length > 1024 * 1024) {
          return sock.sendMessage(ctx.chatId, {
            text: '❌ O sticker animado ficou pesado demais (>1MB).\n💡 Usa um vídeo mais curto ou com menos movimento.'
          });
        }
      } else {
        return sock.sendMessage(ctx.chatId, { text: '❌ Envie imagem ou vídeo com .fig' });
      }

      const final = await utils.adicionarMetadadosSticker(processado);

      await sock.sendMessage(ctx.chatId, { sticker: final });
      await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) {
      console.error('sticker erro:', e.message);
      await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao criar sticker' });
    } finally {
      buffer = null;
      processado = null;
    }
  },

  'fig': async (sock, ctx) => commands['sticker'](sock, ctx),

  'stext': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    }

    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;

    const texto = ctx.args.join(' ');

    if (!texto) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .stext [texto]' });
    }

    try {
      const textoSafe = utils.escapeXml(texto);

      const buffer = await sharp({
        create: {
          width: 512,
          height: 512,
          channels: 4,
          background: { r: 128, g: 0, b: 128, alpha: 1 }
        }
      })
      .composite([{
        input: Buffer.from(`<svg width="512" height="512"><style>text { fill: white; font-size: 40px; font-family: Arial, sans-serif; text-anchor: middle; dominant-baseline: central; font-weight: bold; }</style><text x="256" y="256">${textoSafe}</text></svg>`),
        top: 0,
        left: 0
      }])
      .webp({ quality: 90 })
      .toBuffer();

      const final = await utils.adicionarMetadadosSticker(buffer);

      await sock.sendMessage(ctx.chatId, { sticker: final });
      await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) {
      await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao criar sticker' });
    }
  },

  'stinfo': async (sock, ctx) => {
    const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!quotedMsg?.stickerMessage) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Responde a um sticker' });
    }

    const s = quotedMsg.stickerMessage;

    await sock.sendMessage(ctx.chatId, {
      text: `📋 INFO DO STICKER\n┃ 📦 Pacote: ${s.stickerPack || '—'}\n┃ ✏️ Autor: ${s.stickerAuthor || '—'}\n┃ 📛 Nome: ${s.stickerName || '—'}\n┃ 📏 Tamanho: ${s.fileLength ? (s.fileLength / 1024).toFixed(1) + ' KB' : 'N/A'}\n┃ 🎞️ Animado: ${s.isAnimated ? '✅' : '❌'}`
    });
  },

  'at': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const atalho = ctx.args[0]?.toLowerCase();
    const info = ctx.args.slice(1).join(' ');

    if (!atalho || !info) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .at [nome] [texto]` });
    }

    let grupoNome = 'PV';

    if (ctx.isGroup) {
      try {
        grupoNome = (await sock.groupMetadata(ctx.chatId)).subject;
      } catch {
        grupoNome = 'Grupo';
      }
    }

    db.atalhos.set(atalho, { texto: info, grupoId: ctx.chatId, grupoNome });
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `✅ Atalho ${atalho} criado` });
  },

  'rmat': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const atalho = ctx.args[0]?.toLowerCase();

    if (!atalho) return;

    if (db.atalhos.delete(atalho)) {
      salvarDados();
      await sock.sendMessage(ctx.chatId, { text: `✅ Atalho ${atalho} removido` });
    }
  },

  'lsat': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    if (!db.atalhos.size) {
      return sock.sendMessage(ctx.chatId, { text: '📝 Sem atalhos.' });
    }

    let lista = `📋 ATALHOS\n━━━━━━━━━━━━━━\n\n`;

    for (const [a, v] of db.atalhos) {
      if (typeof v === 'string') lista += `🔹 ${a} → ${v}\n`;
      else lista += `🔹 ${a} → ${v.texto} (${v.grupoNome})\n`;
    }

    await sock.sendMessage(ctx.chatId, { text: lista });
  },

  'bemv': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBoasvindasRights(sock, ctx.chatId, ctx.senderId))) return;

    const texto = ctx.args.join(' ');

    if (texto === 'off') {
      db.grupos.boasvindas.delete(ctx.chatId);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: '🔕 Boas-vindas OFF' });
    }

    if (!texto) {
      return sock.sendMessage(ctx.chatId, {
        text: 'Uso: .bemv [mensagem] / .bemv off\nVariáveis: @nome, @grupo'
      });
    }

    db.grupos.boasvindas.set(ctx.chatId, texto);
    salvarDados();

    await sock.sendMessage(ctx.chatId, {
      text: `✅ Boas-vindas configuradas`,
      mentions: [ctx.senderId]
    });
  },

  'ban': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;

    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];

    if (!target) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Menciona alguém.` });
    }

    if (utils.isOwner(target)) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Não é possível banir o dono.` });
    }

    try {
      await sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove');

      if (!db.grupos.banidos.has(ctx.chatId)) db.grupos.banidos.set(ctx.chatId, []);

      db.grupos.banidos.get(ctx.chatId).push({
        id: target,
        data: new Date().toLocaleDateString('pt-PT')
      });

      salvarDados();
      registrarAcao(ctx.chatId, `Ban: @${target.split('@')[0]}`);

      await sock.sendMessage(ctx.chatId, {
        text: `🔨 BANIDO!\n━━━━━━━━━━━━━━\n\n👤 @${target.split('@')[0]}\n📅 ${new Date().toLocaleDateString('pt-PT')}\n👮 Por: @${ctx.senderId.split('@')[0]}\n\n⚠️ Quem não cumpre as regras, não fica no grupo!`,
        mentions: [target, ctx.senderId]
      });
    } catch {
      await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao banir.` });
    }
  },

  'kick': async (sock, ctx) => commands['ban'](sock, ctx),

  'all': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;

    const meta = await getMetadataCached(sock, ctx.chatId);
    const mensagem = ctx.args.join(' ') || 'Atenção!';

    await sock.sendMessage(ctx.chatId, {
      text: `📢 AVISO GERAL\n\n${mensagem}`,
      mentions: meta.participants.map(p => p.id)
    });
  },

  'close': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;

    await sock.groupSettingUpdate(ctx.chatId, 'announcement');
    registrarAcao(ctx.chatId, 'Grupo fechado');

    await sock.sendMessage(ctx.chatId, {
      text: `🔒 GRUPO FECHADO\n━━━━━━━━━━━━━━\n\n⚠️ Apenas admins podem enviar mensagens agora.\n👮 Fechado por: @${ctx.senderId.split('@')[0]}\n\n💬 Silêncio é ouro! 🤫`,
      mentions: [ctx.senderId]
    });
  },

  'open': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;

    await sock.groupSettingUpdate(ctx.chatId, 'not_announcement');
    registrarAcao(ctx.chatId, 'Grupo aberto');

    await sock.sendMessage(ctx.chatId, {
      text: `🔓 GRUPO ABERTO\n━━━━━━━━━━━━━━\n\n✅ Todos podem enviar mensagens novamente!\n🎉 Aberto por: @${ctx.senderId.split('@')[0]}\n\n💬 Podem falar à vontade! 🗣️`,
      mentions: [ctx.senderId]
    });
  },

  'up': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;

    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];

    if (!target) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Menciona alguém.` });
    }

    try {
      await sock.groupParticipantsUpdate(ctx.chatId, [target], 'promote');

      await sock.sendMessage(ctx.chatId, {
        text: `👑 NOVO ADMIN!\n━━━━━━━━━━━━━━\n\n🎉 Parabéns @${target.split('@')[0]}!\n⬆️ Foi promovido a administrador!\n\n💬 Use o poder com sabedoria! 😎`,
        mentions: [target]
      });
    } catch {
      await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao promover.` });
    }
  },

  'down': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;

    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];

    if (!target) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Menciona alguém.` });
    }

    try {
      await sock.groupParticipantsUpdate(ctx.chatId, [target], 'demote');

      await sock.sendMessage(ctx.chatId, {
        text: `⬇️ REBAIXADO\n━━━━━━━━━━━━━━\n\n👤 @${target.split('@')[0]}\n📉 Já não é mais administrador.\n\n💬 Decisão tomada!`,
        mentions: [target]
      });
    } catch {
      await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao rebaixar.` });
    }
  },

  'link': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;

    try {
      const code = await sock.groupInviteCode(ctx.chatId);
      await sock.sendMessage(ctx.chatId, { text: `🔗 https://chat.whatsapp.com/${code}` });
    } catch {
      await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao obter link.` });
    }
  },

  'dlt': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;

    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo;

    if (!quoted?.stanzaId) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Responde a uma mensagem.` });
    }

    try {
      await sock.sendMessage(ctx.chatId, {
        delete: {
          remoteJid: ctx.chatId,
          id: quoted.stanzaId,
          participant: quoted.participant
        }
      });

      await utils.reagir(sock, ctx.msg, '✅');
    } catch {
      await sock.sendMessage(ctx.chatId, { text: `❌ Não consegui apagar.` });
    }
  },

  'rg': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasRulesRights(sock, ctx.chatId, ctx.senderId))) return;

    const regras = ctx.args.join(' ');

    if (!regras) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .rg [regras]` });
    }

    db.grupos.regras.set(ctx.chatId, regras);
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `✅ Regras actualizadas` });
  },

  'vrg': async (sock, ctx) => {
    const regras = db.grupos.regras.get(ctx.chatId);

    if (!regras) {
      return sock.sendMessage(ctx.chatId, { text: '📝 Sem regras definidas.' });
    }

    await sock.sendMessage(ctx.chatId, { text: `📋 REGRAS\n\n${regras}` });
  },

  'antil': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;

    const sub = ctx.args[0]?.toLowerCase();

    if (!sub) {
      return sock.sendMessage(ctx.chatId, {
        text: `Uso: .antil [ban|kick|delete|warn|off]\n.antil add [dominio]\n.antil remove [dominio]\n.antil ls`
      });
    }

    if (sub === 'off') {
      db.grupos.antiLink.delete(ctx.chatId);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `🔗 Anti-link OFF` });
    }

    if (sub === 'add') {
      const d = ctx.args[1];
      if (!d) return;

      const host = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

      if (!db.whitelist.has(ctx.chatId)) db.whitelist.set(ctx.chatId, new Set());

      db.whitelist.get(ctx.chatId).add(host);
      salvarDados();

      return sock.sendMessage(ctx.chatId, { text: `✅ ${host} adicionado` });
    }

    if (sub === 'remove') {
      const d = ctx.args[1];
      if (!d) return;

      const host = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const s = db.whitelist.get(ctx.chatId);

      if (s && s.has(host)) {
        s.delete(host);
        salvarDados();
        return sock.sendMessage(ctx.chatId, { text: `✅ ${host} removido` });
      }

      return sock.sendMessage(ctx.chatId, { text: `⚠️ Não estava na whitelist` });
    }

    if (sub === 'ls' || sub === 'list') {
      const s = db.whitelist.get(ctx.chatId) || new Set();

      if (!s.size) {
        return sock.sendMessage(ctx.chatId, { text: '📝 Whitelist vazia.' });
      }

      return sock.sendMessage(ctx.chatId, { text: `Whitelist:\n${[...s].join('\n')}` });
    }

    if (['ban', 'kick', 'delete', 'warn'].includes(sub)) {
      db.grupos.antiLink.set(ctx.chatId, sub);
      salvarDados();

      const modos = {
        ban: '🔨 Banir quem enviar',
        kick: '👢 Expulsar quem enviar',
        delete: '🗑️ Apagar o link silenciosamente',
        warn: '⚠️ Avisar e apagar'
      };

      return sock.sendMessage(ctx.chatId, {
        text: `🛡️ ANTI-LINK ACTIVADO!\n━━━━━━━━━━━━━━\n\n📋 Modo: ${sub.toUpperCase()}\n${modos[sub]}\n\n⚠️ Links não autorizados serão tratados!`
      });
    }

    return sock.sendMessage(ctx.chatId, { text: 'Uso inválido de .antil' });
  },

  'ia': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    const acao = ctx.args[0]?.toLowerCase();

    if (acao === 'on') {
      db.grupos.iaAtivo.add(ctx.chatId);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `🤖 IA ACTIVADA` });
    }

    if (acao === 'off') {
      db.grupos.iaAtivo.delete(ctx.chatId);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `🤖 IA DESACTIVADA` });
    }

    await sock.sendMessage(ctx.chatId, {
      text: `🤖 IA: ${db.grupos.iaAtivo.has(ctx.chatId) ? '✅ Activa' : '❌ Inactiva'}`
    });
  },

  'banw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;

    const palavra = ctx.args.join(' ').toLowerCase().trim();

    if (!palavra) {
      return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .banw [palavra]` });
    }

    if (!db.grupos.palavrasBanidas.has(ctx.chatId)) db.grupos.palavrasBanidas.set(ctx.chatId, []);

    const lista = db.grupos.palavrasBanidas.get(ctx.chatId);

    if (lista.includes(palavra)) {
      return sock.sendMessage(ctx.chatId, { text: `⚠️ Já está banida.` });
    }

    lista.push(palavra);
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `🚫 Palavra banida: "${palavra}"` });
  },

  'unbanw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;

    const palavra = ctx.args.join(' ').toLowerCase().trim();

    if (!palavra) return;

    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    const idx = lista.indexOf(palavra);

    if (idx === -1) {
      return sock.sendMessage(ctx.chatId, { text: `⚠️ Não está na lista.` });
    }

    lista.splice(idx, 1);
    salvarDados();

    await sock.sendMessage(ctx.chatId, { text: `✅ Palavra removida: "${palavra}"` });
  },

  'listw': async (sock, ctx) => {
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];

    if (!lista.length) {
      return sock.sendMessage(ctx.chatId, { text: '📝 Sem palavras banidas.' });
    }

    await sock.sendMessage(ctx.chatId, {
      text: `🚫 PALAVRAS BANIDAS\n${lista.join('\n')}`
    });
  },

  'listb': async (sock, ctx) => {
    const lista = db.grupos.banidos.get(ctx.chatId) || [];

    if (!lista.length) {
      return sock.sendMessage(ctx.chatId, { text: '📝 Sem banidos.' });
    }

    await sock.sendMessage(ctx.chatId, {
      text: `🚫 BANIDOS\n${lista.map(b => `@${b.id.split('@')[0]} - ${b.data}`).join('\n')}`,
      mentions: lista.map(b => b.id)
    });
  },

  'tk': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'tk')) {
      return sock.sendMessage(ctx.chatId, {
        text: `❌ Acesso negado!\n\nO teu plano VIP não inclui .tk.\n\n📦 Planos:\n🥇 Ouro: .tk\n💎 Diamante: .tk, .ig, .fb, .dl\n👑 Lenda: todos\n\n📞 Contacta: ${CONFIG.ownerNumber}`
      });
    }

    const link = ctx.args[0];

    if (!link || !/tiktok\.com|vm\.tiktok|vt\.tiktok/.test(link)) {
      return sock.sendMessage(ctx.chatId, { text: `Uso: .tk [link do TikTok]` });
    }

    await sock.sendMessage(ctx.chatId, {
      text: '🎵 *TikTok Download*\n\n⏳ Aguarda um momentinho...\n🔍 A encontrar o vídeo...'
    });

    try {
      const dados = await extrairGenDownload(link);
      const fmt = escolherFormatoGen(dados, 'video');
      const buf = await baixarBufferGen(fmt);

      if (buf) {
        return await sock.sendMessage(ctx.chatId, {
          video: buf,
          caption: `🎵 ${dados.title || 'Vídeo'}\n👤 ${dados.author || ''}\n💚 Nano Bot`,
          mimetype: 'video/mp4'
        });
      }
    } catch (e) {
      console.warn('tk:', e.message);
    }

    await sock.sendMessage(ctx.chatId, {
      text: '😔 *Ops!*\n\n❌ Não consegui baixar este TikTok.\n💡 Verifica o link e tenta de novo.'
    });
  },

  'ig': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'ig')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Diamante ou superior requerido.` });
    }

    const link = ctx.args[0];

    if (!link || !link.includes('instagram.com')) {
      return sock.sendMessage(ctx.chatId, { text: `Uso: .ig [link do Instagram]` });
    }

    await sock.sendMessage(ctx.chatId, { text: '📸 *Instagram Download*\n\n⏳ Só um instante...' });

    try {
      const dados = await extrairGenDownload(link);
      const formatos = dados?.formats || [];

      const videos = formatos.filter(f => f.type === 'video');
      const imagens = formatos.filter(f => f.type === 'image' || /jpe?g|png|webp/.test(f.ext || ''));

      if (videos.length) {
        const buf = await baixarBufferGen(videos[0]);

        if (buf) {
          return await sock.sendMessage(ctx.chatId, {
            video: buf,
            caption: `📸 Instagram — ${dados.author || ''}`,
            mimetype: 'video/mp4'
          });
        }
      } else if (imagens.length) {
        let i = 0;

        for (const img of imagens.slice(0, 4)) {
          const buf = await baixarBufferGen(img, 32 * 1024 * 1024);

          if (buf) {
            await sock.sendMessage(ctx.chatId, {
              image: buf,
              caption: `📸 Instagram (${i + 1}/${Math.min(imagens.length, 4)})`
            });

            i++;
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (i > 0) return;
      }
    } catch (e) {
      console.warn('ig:', e.message);
    }

    await sock.sendMessage(ctx.chatId, {
      text: '😔 *Ops!*\n\n❌ Não consegui baixar do Instagram.\n💡 O perfil pode ser privado.'
    });
  },

  'fb': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'fb')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Diamante ou superior requerido.` });
    }

    const link = ctx.args[0];

    if (!link || !/(facebook\.com|fb\.watch|fb\.com)/i.test(link)) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .fb [link do Facebook]' });
    }

    await sock.sendMessage(ctx.chatId, { text: '📘 *Facebook Download*\n\n⏳ A capturar o vídeo...' });

    try {
      await executarDownloadUniversal(sock, ctx, link);
    } catch (e) {
      console.warn('fb:', e.message);
      await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar do Facebook.' });
    }
  },

  'dl': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'dl')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Diamante ou superior requerido.` });
    }

    const link = ctx.args[0];

    if (!link || !/^https?:\/\//i.test(link)) {
      return sock.sendMessage(ctx.chatId, {
        text: `🌐 DOWNLOAD UNIVERSAL\n\nUso: .dl [link]\n\n📡 Funciona com 1600+ sites:\n├─ Facebook / Instagram\n├─ X (Twitter) / Reddit\n├─ Kwai / Pinterest / Vimeo\n├─ Snapchat / Dailymotion\n└─ E muito mais!`
      });
    }

    await sock.sendMessage(ctx.chatId, { text: '🌐 *Download Universal*\n\n⏳ A analisar o link...' });

    try {
      await executarDownloadUniversal(sock, ctx, link);
    } catch (e) {
      console.warn('dl:', e.message);
      await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui extrair mídia deste link.' });
    }
  },

  'vinfo': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'vinfo')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Diamante ou superior requerido.` });
    }

    const link = ctx.args[0];

    if (!link || !/^https?:\/\//i.test(link)) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .vinfo [link]' });
    }

    try {
      const dados = await extrairGenDownload(link);

      const dur = dados.duration
        ? `${Math.floor(dados.duration / 60)}:${String(dados.duration % 60).padStart(2, '0')}`
        : '—';

      const formatos = (dados.formats || [])
        .map(f => `• ${f.label || f.ext} (${f.type})${f.filesize ? ` — ${(f.filesize / 1048576).toFixed(1)} MB` : ''}`)
        .join('\n');

      const texto = `📊 FICHA DA MÍDIA\n━━━━━━━━━━━━━━\n\n🌐 Plataforma: ${(dados.source || '—').toUpperCase()}\n🎬 Título: ${dados.title || '—'}\n👤 Autor: ${dados.author || '—'}\n⏱️ Duração: ${dur}\n👁️ Views: ${dados.views ? Number(dados.views).toLocaleString('pt-PT') : '—'}\n\n📦 Formatos:\n${formatos || '(nenhum)'}\n\n💡 Usa .dl [link] para baixar!`;

      if (dados.thumbnail) {
        await sock.sendMessage(ctx.chatId, {
          image: { url: dados.thumbnail },
          caption: texto
        });
      } else {
        await sock.sendMessage(ctx.chatId, { text: texto });
      }
    } catch {
      await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui ler este link.' });
    }
  },

  'canal': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'canal')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Lenda requerido.` });
    }

    const link = ctx.args[0];

    if (!link) {
      return sock.sendMessage(ctx.chatId, {
        text: 'Uso: .canal [link do canal/playlist/perfil]'
      });
    }

    await sock.sendMessage(ctx.chatId, { text: '📡 A listar vídeos do canal/playlist...' });

    try {
      const r = await axios.post('https://gendownload.com/api/channel', {
        url: link,
        limit: 10
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      const itens = r.data?.items || [];

      if (!itens.length) {
        return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum vídeo encontrado.' });
      }

      let texto = `📡 VÍDEOS ENCONTRADOS\n\n`;

      itens.slice(0, 10).forEach((v, i) => {
        texto += `${i + 1}. ${(v.title || 'Sem título').substring(0, 45)}\n   🔗 ${v.url}\n\n`;
      });

      texto += `💡 Usa .dl [link] para baixar qualquer um!`;

      await sock.sendMessage(ctx.chatId, { text: texto });
    } catch {
      await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui listar este canal/playlist.' });
    }
  },

  'zip': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'zip')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Lenda requerido.` });
    }

    const links = ctx.args.filter(a => /^https?:\/\//i.test(a));

    if (links.length < 2) {
      return sock.sendMessage(ctx.chatId, {
        text: 'Uso: .zip [link1] [link2] ...\n📦 Empacota vários vídeos num ZIP.'
      });
    }

    await sock.sendMessage(ctx.chatId, {
      text: `📦 A empacotar ${links.length} vídeos...\n⏳ Pode demorar...`
    });

    try {
      const r = await axios.post('https://gendownload.com/api/zip', {
        urls: links,
        quality: '480'
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      if (r.data?.url) {
        return await sock.sendMessage(ctx.chatId, {
          text: `📦 ZIP PRONTO!\n\n🔗 Baixa aqui: ${r.data.url}\n\n⚠️ O link é temporário — baixa já!`
        });
      }

      throw new Error('sem url');
    } catch {
      await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui criar o ZIP.' });
    }
  },

  'yt': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'yt')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Lenda requerido.` });
    }

    const pesquisa = ctx.args.join(' ');

    if (!pesquisa) {
      return sock.sendMessage(ctx.chatId, { text: `Uso: .yt [pesquisa]` });
    }

    try {
      await sock.sendMessage(ctx.chatId, { text: '🔍 A pesquisar...' });

      const yts = require('yt-search');
      const resultados = await yts(pesquisa);
      const videos = resultados.videos.slice(0, 5);

      if (!videos.length) {
        return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum resultado.' });
      }

      let texto = `🎬 RESULTADOS YOUTUBE\n\n`;

      videos.forEach((vid, i) => {
        const duracao = vid.timestamp || `${Math.floor(vid.duration.seconds / 60)}:${String(vid.duration.seconds % 60).padStart(2, '0')}`;
        texto += `${i + 1}. ${vid.title.substring(0, 50)}\n   ⏱️ ${duracao} | 🔗 ${vid.url}\n\n`;
      });

      texto += `💡 Usa .ytd [link] para áudio\n💡 Usa .ytv [link] para vídeo (até 30min)`;

      const thumbnail = videos[0]?.image || videos[0]?.thumbnail;

      if (thumbnail) {
        await sock.sendMessage(ctx.chatId, {
          image: { url: thumbnail },
          caption: texto
        });
      } else {
        await sock.sendMessage(ctx.chatId, { text: texto });
      }
    } catch (e) {
      await sock.sendMessage(ctx.chatId, { text: '❌ Erro na pesquisa.' });
    }
  },

  'ytd': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'ytd')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Lenda requerido.` });
    }

    const link = ctx.args[0];

    if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) {
      return sock.sendMessage(ctx.chatId, { text: `Uso: .ytd [link do YouTube]` });
    }

    await sock.sendMessage(ctx.chatId, { text: '🎵 *YouTube Áudio*\n\n⏳ A extrair o som...' });

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
          contextInfo: thumbnail ? {
            externalAdReply: {
              title: dados.title || 'Áudio',
              body: dados.author || '',
              thumbnailUrl: thumbnail,
              mediaType: 2,
              renderLargerThumbnail: true
            }
          } : undefined
        });
      }
    } catch (e) {
      console.warn('ytd:', e.message);
    }

    await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar o áudio.' });
  },

  'ytv': async (sock, ctx) => {
    if (!verificarVIPUser(ctx.senderId, 'ytv')) {
      return sock.sendMessage(ctx.chatId, { text: `❌ VIP Lenda requerido.` });
    }

    const link = ctx.args[0];

    if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) {
      return sock.sendMessage(ctx.chatId, { text: `Uso: .ytv [link do YouTube]` });
    }

    await sock.sendMessage(ctx.chatId, {
      text: '🎬 *YouTube Vídeo*\n\n⏳ A descarregar o vídeo...\n📥 Quase lá...'
    });

    try {
      const dados = await extrairGenDownload(link);

      if ((dados.duration || 0) > 1800) {
        return sock.sendMessage(ctx.chatId, {
          text: '❌ Vídeos maiores que 30 min não são suportados.'
        });
      }

      const fmt = escolherFormatoGen(dados, 'video');
      const buf = await baixarBufferGen(fmt);

      if (buf) {
        const videoId = extrairVideoId(link);
        const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;

        return await sock.sendMessage(ctx.chatId, {
          video: buf,
          mimetype: 'video/mp4',
          caption: `🎬 ${(dados.title || 'Vídeo').substring(0, 60)}\n👤 ${dados.author || ''}\n💚 Nano Bot`,
          contextInfo: thumbnail ? {
            externalAdReply: {
              title: dados.title || 'Vídeo',
              body: dados.author || '',
              thumbnailUrl: thumbnail,
              mediaType: 2,
              renderLargerThumbnail: true
            }
          } : undefined
        });
      }
    } catch (e) {
      console.warn('ytv:', e.message);
    }

    await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar o vídeo.' });
  },

  'vp': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();

    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];

    if (!target && ctx.args[0]) {
      target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    }

    const nivel = (ctx.args[1] || '').toLowerCase();
    const dias = parseInt(ctx.args[2]);

    if (!target || !NIVEIS_VIP_USER[nivel] || !dias) {
      return sock.sendMessage(ctx.chatId, {
        text: `👑 ACTIVAR VIP DE USUÁRIO\n━━━━━━━━━━━━━━\n\nUso: .vp @user [nivel] [dias]\nNíveis: ouro | diamante | lenda\n\nEx: .vp @user diamante 30\n     .vp 834788141 ouro 7`
      });
    }

    const diasFinais = Math.min(dias, NIVEIS_VIP_USER[nivel].maxDias);

    db.usersVIP.set(target, {
      nivel,
      expiraEm: Date.now() + (diasFinais * 86400000),
      ativadoEm: Date.now()
    });

    salvarDados();

    const cmdsPermitidos = NIVEIS_VIP_USER[nivel].cmds.map(c => `.${c}`).join(', ');
    const dataExpiracao = new Date(Date.now() + (diasFinais * 86400000)).toLocaleDateString('pt-PT');

    await sock.sendMessage(ctx.chatId, {
      text: `✅ VIP DE USUÁRIO ACTIVADO\n━━━━━━━━━━━━━━\n\n👤 @${target.split('@')[0]}\n💎 Nível: ${NIVEIS_VIP_USER[nivel].nome}\n📅 Duração: ${diasFinais} dias\n⏳ Expira em: ${dataExpiracao}\n🔓 Comandos: ${cmdsPermitidos}`,
      mentions: [target]
    });
  },

  'meuvip': async (sock, ctx) => {
    const vip = db.usersVIP.get(ctx.senderId);

    if (!vip || vip.expiraEm < Date.now()) {
      if (vip) {
        db.usersVIP.delete(ctx.senderId);
        salvarDados();
      }

      return sock.sendMessage(ctx.chatId, {
        text: `❌ Não tens VIP activo.\n\n📦 Planos:\n🥇 Ouro: .tk\n💎 Diamante: .tk, .ig, .fb, .dl, .vinfo\n👑 Lenda: todos os downloads\n\n📞 Contacta: ${CONFIG.ownerNumber}`
      });
    }

    const restante = Math.max(0, vip.expiraEm - Date.now());
    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const nivel = NIVEIS_VIP_USER[vip.nivel];
    const cmds = nivel.cmds.map(c => `.${c}`).join(', ');

    await sock.sendMessage(ctx.chatId, {
      text: `💎 O TEU VIP\n━━━━━━━━━━━━━━\n\nNível: ${nivel.nome}\n⏳ Restante: ${d}d ${h}h\n🔓 Comandos: ${cmds}`
    });
  },

  'anime': async (sock, ctx) => {
    const q = ctx.args.join(' ').trim();

    if (!q) {
      return sock.sendMessage(ctx.chatId, {
        text: `🧧 *BUSCA DE ANIME*\n━━━━━━━━━━━━━━\n\nUso: .anime [nome]\n\nExemplos:\n.anime Frieren\n.anime One Piece\n.anime Jujutsu Kaisen\n\n⚠️ Só deves baixar/usar conteúdos com permissão/licença.`
      });
    }

    try {
      await utils.reagir(sock, ctx.msg, '🔎');

      const { data } = await axios.get('https://api.jikan.moe/v4/anime', {
        params: { q, limit: 5, sfw: true },
        timeout: 15000
      });

      const lista = data?.data || [];

      if (!lista.length) {
        return sock.sendMessage(ctx.chatId, {
          text: `❌ Nenhum anime encontrado para:\n"${q}"`
        });
      }

      let texto = `🧧 *RESULTADOS DE ANIME*\n━━━━━━━━━━━━━━\n\n`;

      lista.slice(0, 5).forEach((a, i) => {
        const titulo = a.title || a.title_english || a.title_japanese || 'Sem título';
        const ano = a.year || a.aired?.prop?.from?.year || '?';
        const score = a.score ?? '?';
        const tipo = a.type || '?';
        const episodios = a.episodes || '?';

        texto += `${i + 1}. *${titulo}*\n`;
        texto += `   📅 Ano: ${ano}\n`;
        texto += `   📺 Tipo: ${tipo}\n`;
        texto += `   🎞️ Episódios: ${episodios}\n`;
        texto += `   ⭐ Score: ${score}\n`;
        texto += `   🔗 MAL: ${a.url}\n`;

        if (a.trailer?.youtube_url) {
          texto += `   ▶️ Trailer: ${a.trailer.youtube_url}\n`;
        }

        texto += `\n`;
      });

      texto += `💡 Podes usar:\n.yt [nome do anime] para pesquisar vídeos no YouTube.\n.dl [link] apenas para conteúdos autorizados/licenciados.\n\n⚠️ Não uses isto para baixar conteúdo protegido sem permissão.`;

      const thumb = lista[0]?.images?.jpg?.image_url;

      if (thumb) {
        await sock.sendMessage(ctx.chatId, {
          image: { url: thumb },
          caption: texto
        });
      } else {
        await sock.sendMessage(ctx.chatId, { text: texto });
      }
    } catch (e) {
      console.warn('Erro no comando anime:', e.message);
      await sock.sendMessage(ctx.chatId, {
        text: `❌ Erro ao pesquisar anime.\nTenta novamente daqui a pouco.`
      });
    }
  },

  'animes': async (sock, ctx) => commands['anime'](sock, ctx),
  'ani': async (sock, ctx) => commands['anime'](sock, ctx),

  'bili': async (sock, ctx) => {
    const q = ctx.args.join(' ').trim();

    if (!q) {
      return sock.sendMessage(ctx.chatId, {
        text: `📺 *PESQUISA BILIBILI*\n━━━━━━━━━━━━━━\n\nUso: .bili [termo]\n\nExemplo:\n.bili anime trailer\n.bili one piece official\n\n⚠️ Não faço scraping/download automático do Bilibili.\nUsa apenas conteúdo oficial/autorizado.`
      });
    }

    const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`;

    await sock.sendMessage(ctx.chatId, {
      text: `📺 *PESQUISA BILIBILI*\n━━━━━━━━━━━━━━\n\n🔎 Termo: ${q}\n\n🔗 Link da pesquisa:\n${url}\n\n⚠️ Aviso:\nO Bilibili tem termos de uso e protecção de conteúdo.\nNão devo implementar extração/download automático de conteúdo protegido sem permissão.`
    });
  },

  'save': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Apenas admins ou o dono podem usar .save.' });
    }

    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;

    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    const media =
      quoted?.videoMessage ||
      quoted?.documentMessage ||
      quoted?.audioMessage ||
      quoted?.imageMessage;

    if (!media) {
      return sock.sendMessage(ctx.chatId, {
        text: `💾 *SAVE*\n━━━━━━━━━━━━━━\n\nResponde a uma mídia com:\n.save\n\nFunciona com:\n• vídeo\n• documento\n• áudio\n• imagem\n\n⚠️ Usa apenas para ficheiros que tens permissão de guardar.`
      });
    }

    try {
      const tamanho = Number(media.fileLength || 0);
      const MAX = 64 * 1024 * 1024;

      if (tamanho > MAX) {
        return sock.sendMessage(ctx.chatId, {
          text: `❌ Ficheiro demasiado grande.\nLimite: 64MB.`
        });
      }

      await utils.reagir(sock, ctx.msg, '⏳');

      const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {});

      if (quoted.videoMessage) {
        await sock.sendMessage(ctx.chatId, {
          video: buffer,
          mimetype: quoted.videoMessage.mimetype || 'video/mp4',
          caption: `💾 Vídeo guardado/reenviado.`
        });
      } else if (quoted.documentMessage) {
        await sock.sendMessage(ctx.chatId, {
          document: buffer,
          mimetype: quoted.documentMessage.mimetype || 'application/octet-stream',
          fileName: quoted.documentMessage.fileName || `ficheiro_${Date.now()}.bin`,
          caption: `💾 Documento guardado/reenviado.`
        });
      } else if (quoted.audioMessage) {
        await sock.sendMessage(ctx.chatId, {
          audio: buffer,
          mimetype: quoted.audioMessage.mimetype || 'audio/mp4',
          ptt: !!quoted.audioMessage.ptt
        });
      } else if (quoted.imageMessage) {
        await sock.sendMessage(ctx.chatId, {
          image: buffer,
          caption: `💾 Imagem guardada/reenviada.`
        });
      }

      await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) {
      console.warn('Erro no comando save:', e.message);
      await sock.sendMessage(ctx.chatId, {
        text: `❌ Não consegui guardar/reenviar esta mídia.`
      });
    }
  },

  'dst': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Apenas admins.' });
    }

    const comando = ctx.args[0]?.toLowerCase();

    if (!comando || !comando.startsWith('.')) {
      return sock.sendMessage(ctx.chatId, {
        text: `🚫 DST - DESATIVAR COMANDO\n━━━━━━━━━━━━━━\n\nUso: .dst [comando]\n\nEx: .dst .ig\n     .dst .tiktok\n     .dst .menu`
      });
    }

    const cmdLimpo = comando.replace('.', '');

    if (!commands[cmdLimpo]) {
      return sock.sendMessage(ctx.chatId, {
        text: `❌ Comando ".${cmdLimpo}" não existe.`
      });
    }

    const criticos = new Set(['dst', 'actcmd', 'listad', 'menu', 'cgeral', 'cadmin', 'cprot', 'cmidia', 'cstick', 'cdono']);

    if (criticos.has(cmdLimpo) && !utils.isOwner(ctx.senderId)) {
      return sock.sendMessage(ctx.chatId, {
        text: `❌ Este comando é crítico e não pode ser desativado.`
      });
    }

    if (!db.grupos.comandosDesativados.has(ctx.chatId)) {
      db.grupos.comandosDesativados.set(ctx.chatId, new Set());
    }

    db.grupos.comandosDesativados.get(ctx.chatId).add(cmdLimpo);
    salvarDados();

    await sock.sendMessage(ctx.chatId, {
      text: `✅ Comando desativado!\n\n🚫 ".${cmdLimpo}" está desativado neste grupo.\n\nPara reativar: .actcmd .${cmdLimpo}`
    });
  },

  'actcmd': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) {
      return sock.sendMessage(ctx.chatId, { text: '❌ Apenas admins.' });
    }

    const comando = ctx.args[0]?.toLowerCase();

    if (!comando || !comando.startsWith('.')) {
      return sock.sendMessage(ctx.chatId, {
        text: `✅ ACTCMD - ATIVAR COMANDO\n━━━━━━━━━━━━━━\n\nUso: .actcmd [comando]\n\nEx: .actcmd .ig\n     .actcmd .tiktok`
      });
    }

    const cmdLimpo = comando.replace('.', '');
    const cmdsDesativados = db.grupos.comandosDesativados.get(ctx.chatId);

    if (!cmdsDesativados || !cmdsDesativados.has(cmdLimpo)) {
      return sock.sendMessage(ctx.chatId, {
        text: `⚠️ O comando ".${cmdLimpo}" já está ativo.`
      });
    }

    cmdsDesativados.delete(cmdLimpo);
    salvarDados();

    await sock.sendMessage(ctx.chatId, {
      text: `✅ Comando ativado!\n\n✅ ".${cmdLimpo}" está ativo neste grupo.`
    });
  },

  'listad': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;

    const cmds = db.grupos.comandosDesativados.get(ctx.chatId);

    if (!cmds || cmds.size === 0) {
      return sock.sendMessage(ctx.chatId, {
        text: '✅ Todos os comandos estão ativos neste grupo.'
      });
    }

    const lista = [...cmds].map(c => `🚫 .${c}`).join('\n');

    await sock.sendMessage(ctx.chatId, {
      text: `🚫 COMANDOS DESATIVADOS\n\n${lista}\n\nUse .actcmd [comando] para reativar.`
    });
  }
};

async function executarAntiLink(sock, chatId, msg, senderId, modo) {
  try {
    await sock.sendMessage(chatId, { delete: msg.key });
  } catch {}

  if (modo === 'warn') {
    await sock.sendMessage(chatId, {
      text: `⚠️ *AVISO: LINK DETECTADO*\n@${senderId.split('@')[0]}, links não são permitidos!`,
      mentions: [senderId]
    });
  } else if (modo === 'delete') {
    await sock.sendMessage(chatId, {
      text: `🔗 *LINK REMOVIDO*\n@${senderId.split('@')[0]}`,
      mentions: [senderId]
    });
  } else if (modo === 'kick' || modo === 'ban') {
    try {
      await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
      registrarAcao(chatId, `Anti-link (${modo}): @${senderId.split('@')[0]}`);

      await sock.sendMessage(chatId, {
        text: `🚫 *REMOVIDO POR LINK*\n@${senderId.split('@')[0]}`,
        mentions: [senderId]
      });
    } catch {
      await sock.sendMessage(chatId, {
        text: `⚠️ Não consegui remover @${senderId.split('@')[0]}.`,
        mentions: [senderId]
      });
    }
  }
}

async function processarMensagem(sock, msg) {
  const minhaGeracao = geracaoAtual;

  if (!msg.message || msg.key.fromMe) return;

  if (msg.key.id && mensagensIgnoradas.has(msg.key.id)) {
    mensagensIgnoradas.delete(msg.key.id);
    return;
  }

  const chatId = msg.key.remoteJid;
  if (chatId === 'status@broadcast' || chatId?.endsWith('@broadcast')) return;

  let ts = msg.messageTimestamp;
  if (ts && typeof ts === 'object' && typeof ts.toNumber === 'function') ts = ts.toNumber();
  const msgTime = ts ? Number(ts) * 1000 : Date.now();

  if (Date.now() - msgTime > 60000) return;

  const isGroup = chatId.endsWith('@g.us');

  let senderId = isGroup ? msg.key.participant : chatId;
  senderId = await resolverIdDono(sock, chatId, senderId);

  const fullText = utils.extractText(msg);

  if (msg.key.id) {
    ultimasMensagensIds.push(msg.key.id);
    if (ultimasMensagensIds.length > 4) ultimasMensagensIds.shift();
  }

  if (!isGroup) console.log(`📩 PV de ${senderId.split('@')[0]}: "${fullText}"`);

  try {
    await sock.readMessages([msg.key]);
  } catch {}

  await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));

  if (pausado || minhaGeracao !== geracaoAtual) return;
  if (db.ignorados.has(senderId) && !utils.isOwner(senderId)) return;
  if (isGroup && db.grupos.desligados.has(chatId) && !utils.isOwner(senderId)) return;

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

  try {
    if (isGroup && db.autoDelete.has(chatId)) {
      const ms = db.autoDelete.get(chatId);
      setTimeout(async () => {
        try {
          await sock.sendMessage(chatId, { delete: msg.key });
        } catch {}
      }, ms);
    }
  } catch {}

  if (isGroup) await utils.checkGroupExpired(sock, chatId);

  if (isGroup && fullText) {
    const isAdmin = await utils.isSenderGroupAdmin(sock, chatId, senderId);
    const isOwner = utils.isOwner(senderId);

    if (!isAdmin && !isOwner) {
      const antiLinkMode = db.grupos.antiLink.get(chatId);

      if (antiLinkMode) {
        const links = [...(fullText.match(REGEX_URL) || [])];
        const lowerText = fullText.toLowerCase();

        const hasLink =
          links.length > 0 ||
          lowerText.includes('wa.me/') ||
          lowerText.includes('chat.whatsapp.com');

        if (hasLink) {
          let ignore = false;
          const whitelist = db.whitelist.get(chatId) || new Set();

          for (const link of links) {
            try {
              const u = new URL(link.startsWith('http') ? link : 'http://' + link);
              if (whitelist.has(u.hostname.replace(/^www\./, ''))) {
                ignore = true;
                break;
              }
            } catch {}
          }

          if (!ignore) {
            await executarAntiLink(sock, chatId, msg, senderId, antiLinkMode);
            return;
          }
        }
      }

      const palavrasBanidas = db.grupos.palavrasBanidas.get(chatId) || [];

      for (const palavra of palavrasBanidas) {
        if (fullText.toLowerCase().includes(palavra)) {
          try {
            await sock.sendMessage(chatId, { delete: msg.key });
          } catch {}

          await sock.sendMessage(chatId, {
            text: `🚫 *PALAVRA PROIBIDA*\n@${senderId.split('@')[0]}`,
            mentions: [senderId]
          });

          return;
        }
      }
    }

    if (!fullText.startsWith(CONFIG.prefix)) {
      if (db.atalhos.has(fullText.toLowerCase().trim())) {
        const dadosAtalho = db.atalhos.get(fullText.toLowerCase().trim());
        const textoAtalho = typeof dadosAtalho === 'string' ? dadosAtalho : dadosAtalho.texto;
        return sock.sendMessage(chatId, { text: textoAtalho });
      }

      const textoLower = fullText.toLowerCase();

      if (textoLower.includes('nano') || textoLower.includes('bot') || textoLower.includes('@' + CONFIG.botNumber)) {
        const soChamouOBot = /^(nano|bot)[!?. ]*$/i.test(fullText.trim());

        if (soChamouOBot) {
          const limiteMenu = verificarLimiteMenu(senderId, 'menu');

          if (!limiteMenu.permitido) {
            const seg = Math.ceil(limiteMenu.esperarMs / 1000);
            const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
            await sock.sendMessage(chatId, { text: `⏳ Aguarda ${tempo}` });
            return;
          }

          await enviarMenuComBotoes(sock, chatId, senderId);
          return;
        }

        if (utils.isOwner(senderId) && isGroup && pareceIntentoSairGrupo(fullText)) {
          await sock.sendMessage(chatId, { text: '👋 Até já!' });
          setTimeout(() => sock.groupLeave(chatId), 2000);
          return;
        }

        if (isGroup && pareceIntentoQuemDono(fullText)) {
          await sock.sendMessage(chatId, {
            text: `👤 Fui criado por *${CONFIG.creator}*.\n📞 ${CONFIG.ownerNumber}`
          });
          return;
        }

        const ctxAtalho = { chatId, senderId, isGroup, msg, args: [] };
        const temAlvo = !!(utils.getQuotedMention(msg) || utils.getMentions(msg).length);

        if (isGroup && temAlvo && pareceIntentoBanir(fullText)) {
          await commands['ban'](sock, ctxAtalho);
          return;
        }

        if (isGroup && pareceIntentoFecharGrupo(fullText)) {
          await commands['close'](sock, ctxAtalho);
          return;
        }

        if (isGroup && pareceIntentoAbrirGrupo(fullText)) {
          await commands['open'](sock, ctxAtalho);
          return;
        }

        const temCitacao = !!msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

        if (isGroup && temCitacao && pareceIntentoApagarMensagem(fullText)) {
          await commands['dlt'](sock, ctxAtalho);
          return;
        }

        if (utils.isOwner(senderId) && pareceIntentoRelatorio(fullText)) {
          await enviarRelatorioCompleto(sock, chatId);
          return;
        }

        const limiteChat = verificarLimiteConversaIA(senderId);

        if (!limiteChat.permitido) {
          const seg = Math.ceil(limiteChat.esperarMs / 1000);
          const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
          await sock.sendMessage(chatId, { text: `⏳ Aguarda ${tempo}` });
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
          await sock.sendMessage(chatId, { text: `⏳ Aguarda ${tempo}`, quoted: msg });
          return;
        }

        const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), true);

        if (resposta) await sock.sendMessage(chatId, { text: `💚 ${resposta}`, quoted: msg });
        return;
      }

      if (textoLower === 'bom dia') {
        await utils.reagir(sock, msg, '☀️');
        const respostas = [
          'Bom dia! Que o dia seja incrível! ☀️',
          'Bom diaaa! 🌅 Energia positiva pra ti!',
          'Bom dia, craque! Vamos nessa! 💪'
        ];
        await sock.sendMessage(chatId, { text: respostas[Math.floor(Math.random() * respostas.length)] });
      } else if (textoLower === 'boa tarde') {
        await utils.reagir(sock, msg, '🌇');
        const respostas = [
          'Boa tarde! Tá correndo tudo bem? 😊',
          'Boa tarde! Meio do dia e a energia não para! 🔥',
          'Boa tarde, chefe! 🌤️'
        ];
        await sock.sendMessage(chatId, { text: respostas[Math.floor(Math.random() * respostas.length)] });
      } else if (textoLower === 'boa noite') {
        await utils.reagir(sock, msg, '🌙');
        const respostas = [
          'Boa noite! Descansa bem! 🌙',
          'Boa noite! Bons sonhos! ✨',
          'Boa noite! Amanhã é outro dia! 😴'
        ];
        await sock.sendMessage(chatId, { text: respostas[Math.floor(Math.random() * respostas.length)] });
      } else if (textoLower.includes('obrigado') || textoLower.includes('obrigada') || textoLower.includes('valeu')) {
        await utils.reagir(sock, msg, '💚');
        const respostas = [
          'De nada! Tô aqui pra isso! 😊',
          'Sempre às ordens! 💚',
          'Por nada, chefe! Precisando é só chamar! 🤝'
        ];
        await sock.sendMessage(chatId, { text: respostas[Math.floor(Math.random() * respostas.length)] });
      }
    }
  }

  if (!isGroup && fullText && !fullText.startsWith(CONFIG.prefix)) {
    if (utils.isOwner(senderId) && pareceIntentoRelatorio(fullText)) {
      await enviarRelatorioCompleto(sock, chatId);
      return;
    }

    const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), false);

    if (resposta) await sock.sendMessage(chatId, { text: `💚 ${resposta}` });
    return;
  }

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
          return await sock.sendMessage(chatId, { text: `⏳ Aguarda ${tempo}` });
        }
      }

      const rl = verificarRateLimit(senderId, cmd);

      if (!rl.permitido) {
        const seg = Math.ceil(rl.esperarMs / 1000);
        const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
        return await sock.sendMessage(chatId, { text: `⏳ Aguarda ${tempo}` });
      }

      try {
        const cur = db.stats.get(cmd) || 0;
        db.stats.set(cmd, cur + 1);
        salvarDados();
      } catch {}

      try {
        await commands[cmd](sock, { chatId, senderId, isGroup: !!isGroup, msg, args });
        await utils.reagir(sock, msg, COMANDO_EMOJIS[cmd] || '✅');
      } catch (erro) {
        if (!(erro instanceof PermissaoNegada)) console.error(`Erro .${cmd}:`, erro);
        await utils.reagir(sock, msg, '❌');
      }

      return;
    }
  }
}

let reconnectAttempts = 0;
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
    console.log('🛑 PARADO');
  } else if (cmd === 'continuar' || cmd === '.continuar') {
    pausado = false;
    console.log('▶️ RETOMADO');
  } else if (cmd === 'reiniciar' || cmd === '.reiniciar') {
    mensagensIgnoradas = new Set(ultimasMensagensIds);
    console.log(`🔄 A reiniciar — ${ultimasMensagensIds.length} mensagens serão ignoradas.`);

    try {
      sockAtual?.end(new Error('Reinício manual'));
    } catch {}
  } else if (cmd === 'status' || cmd === '.statuscmd') {
    console.log(`Estado: ${pausado ? '🛑 PAUSADO' : '✅ ATIVO'} | Geração: ${geracaoAtual}`);
  }
});

function gerarCodigoPersonalizado() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';

  for (let i = 0; i < 8; i++) {
    codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }

  return codigo;
}

function exibirCodigoPareamento(codigo) {
  const largura = 44;
  const cyan = '\x1b[36m';
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const verde = '\x1b[32m';

  const centrar = (texto) => {
    const visivel = texto.replace(/\x1b\[[0-9;]*m/g, '');
    const espaco = Math.max(largura - visivel.length, 0);
    const esq = Math.floor(espaco / 2);

    return `${cyan}║${reset}${' '.repeat(esq)}${texto}${' '.repeat(espaco - esq)}${cyan}║${reset}`;
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

async function startBot() {
  let sock;

  try {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_nano');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
      },
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
        } catch (error) {
          console.log('❌ Erro ao gerar código:', error.message);
        }
      }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

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

    setInterval(() => {
      const agora = Date.now();
      const maiorJanela = Math.max(RATE_LIMIT_JANELA_MS, CHAT_LIMITE_JANELA_MS, MENU_LIMITE_JANELA_MS);

      for (const [chave, usos] of db.rateLimit) {
        const aindaValidos = usos.filter(t => agora - t < maiorJanela);

        if (aindaValidos.length === 0) db.rateLimit.delete(chave);
        else if (aindaValidos.length !== usos.length) db.rateLimit.set(chave, aindaValidos);
      }
    }, 15 * 60 * 1000);

    sock.ev.on('group-participants.update', async (event) => {
      const { id: groupId, participants, action } = event;

      cacheMetadata.delete(groupId);

      const rawBotJid = sock.user?.id || '';
      const botJid = rawBotJid.includes(':') ? `${rawBotJid.split(':')[0]}@s.whatsapp.net` : rawBotJid;

      if (action === 'add') {
        const boasVindasMsg = db.grupos.boasvindas.get(groupId);

        if (boasVindasMsg) {
          try {
            const metadata = await getMetadataCached(sock, groupId);

            for (const participant of participants) {
              if (participant !== botJid) {
                const nome = `@${participant.split('@')[0]}`;
                const textoFinal = boasVindasMsg.replace(/@nome/g, nome).replace(/@grupo/g, metadata.subject);

                const cartao = await gerarCartaoBoasVindas(sock, participant);

                if (cartao) {
                  await sock.sendMessage(groupId, {
                    image: cartao,
                    caption: textoFinal,
                    mentions: [participant]
                  });
                } else {
                  await sock.sendMessage(groupId, {
                    text: textoFinal,
                    mentions: [participant]
                  });
                }
              }
            }
          } catch {}
        }

        if (participants.includes(botJid)) {
          if (!utils.isGroupSubscribed(groupId)) {
            await sock.sendMessage(groupId, {
              text: `❌ Este grupo não possui assinatura activa.\n📞 Contacte ${CONFIG.creator}: ${CONFIG.ownerNumber}`
            });

            setTimeout(() => sock.groupLeave(groupId), 3000);
          }
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      if (pausado) return;

      for (const msg of messages) {
        try {
          await processarMensagem(sock, msg);
        } catch (e) {
          console.error('Erro ao processar mensagem:', e.message);
        }
      }
    });

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

        console.log(`🔄 Reconectando em ${delay / 1000}s... (${reconnectAttempts})`);
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

if (!process.env.GROQ_API_KEY && GROQ_API_KEY_DIRETA === "COLE_AQUI_A_TUA_CHAVE") {
  console.warn('⚠️ Nenhuma chave Groq definida (nem .env, nem no código)!');
}

console.log(`🚀 Iniciando ${CONFIG.botName}...`);
console.log(`👤 Criado por: ${CONFIG.creator}`);

startBot().catch(console.error);

module.exports = { CONFIG, db, commands, utils, startBot };
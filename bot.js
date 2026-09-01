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
const crypto = require('crypto');
const sharp = require('sharp');
sharp.cache(false); sharp.concurrency(1);
const axios = require('axios');
const translate = require('translate-google');
const { Image: WebpImage } = require('node-webpmux');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

// ══════════════════════════════════════════════════════════
// CONFIGURAÇÃO CENTRAL — IMAGENS DOS MENUS
// ══════════════════════════════════════════════════════════
const CONFIG = {
  botName: "Kortex ⚡",
  creator: "Yanik Uaite",
  ownerId: "275381038891241",
  ownerNumber: "834788141",
  botNumber: "258850421617",
  prefix: ".",
  omdbKey: "8053b257",
  dataFile: path.join(__dirname, 'data', 'bot_data.json'),
  historicoFile: path.join(__dirname, 'data', 'historico.json'),
  // Pasta central de imagens dos menus
  mediaDir: path.join(__dirname, 'media', 'kortex'),
  imagens: {
    principal: path.join(__dirname, 'media', 'kortex', 'principal.jpg'),
    geral: path.join(__dirname, 'media', 'kortex', 'geral.jpg'),
    utilitarios: path.join(__dirname, 'media', 'kortex', 'utilitarios.jpg'),
    texto: path.join(__dirname, 'media', 'kortex', 'texto.jpg'),
    informacao: path.join(__dirname, 'media', 'kortex', 'informacao.jpg'),
    diversao: path.join(__dirname, 'media', 'kortex', 'diversao.jpg'),
    imagem: path.join(__dirname, 'media', 'kortex', 'imagem.jpg'),
    midia: path.join(__dirname, 'media', 'kortex', 'midia.jpg'),
    stickers: path.join(__dirname, 'media', 'kortex', 'stickers.jpg'),
    protecao: path.join(__dirname, 'media', 'kortex', 'protecao.jpg'),
    administracao: path.join(__dirname, 'media', 'kortex', 'administracao.jpg'),
    dono: path.join(__dirname, 'media', 'kortex', 'dono.jpg'),
    games: path.join(__dirname, 'media', 'kortex', 'games.jpg')
  }
};

// ══════════════════════════════════════════════════════════
// GROQ — suporta até 9 chaves. Se uma falhar, tenta a próxima.
// ══════════════════════════════════════════════════════════
const GROQ_API_KEYS = [
  "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",
  "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",
  "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",
  "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",
  "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",
  "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",
  "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",
  "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",
  "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",
].filter(k => k && !k.startsWith('COLE_AQUI'));

const groqClients = GROQ_API_KEYS.map(key => new Groq({ apiKey: key }));
const groq = groqClients[0];
let groqIndiceAtual = 0;

async function comFallbackGroq(fn) {
  let ultimoErro = null;
  for (let i = 0; i < groqClients.length; i++) {
    const idx = (groqIndiceAtual + i) % groqClients.length;
    try {
      const resultado = await fn(groqClients[idx]);
      groqIndiceAtual = idx;
      return resultado;
    } catch (e) {
      ultimoErro = e;
      console.warn(`⚠️ Chave Groq #${idx + 1}/${groqClients.length} falhou: ${String(e.message).substring(0, 120)}`);
    }
  }
  throw ultimoErro || new Error('Todas as chaves Groq falharam.');
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<h1>⚡ ${CONFIG.botName}</h1><p>Criado por ${CONFIG.creator}</p><p>🟢 Online</p>`);
});
server.on('error', (e) => console.error('❌ Erro HTTP:', e.message));
server.listen(process.env.PORT || 3000, () => console.log(`🌐 HTTP na porta ${process.env.PORT || 3000}`));

// ══════════════════════════════════════════════════════════
// BANCO DE DADOS
// ══════════════════════════════════════════════════════════
const db = {
  gruposVIP: new Map(), grupoDono: new Map(), historicoIA: new Map(), historicoIAUltimoUso: new Map(),
  statusDono: null, historicoGrupos: new Map(), atalhos: new Map(), ultimoCartaoPV: new Map(), usersVIP: new Map(),
  warns: new Map(), mutados: new Map(),
  grupos: {
    antiLink: new Map(), palavrasBanidas: new Map(), banidos: new Map(), boasvindas: new Map(), regras: new Map(),
    iaAtivo: new Set(), desligados: new Set(), comandosDesativados: new Map(), semPrefixo: new Set(), antiMidia: new Map()
  },
  ignorados: new Set(), whitelist: new Map(), autoDelete: new Map(), indicadores: new Map(),
  stats: new Map(), notifications: new Map(), cache: new Map(), rateLimit: new Map()
};

const jogosVelha = new Map();
const agendamentos = new Map();
const cacheMetadata = new Map();
const cacheDonoLid = new Set();

// ══════════════════════════════════════════════════════════
// DESAFIOS DE JOGO DA VELHA (NOVO)
// ══════════════════════════════════════════════════════════
const desafiosVelha = new Map(); // desafios pendentes
const TEMPO_EXPIRACAO_DESAFIO = 60000; // 60 segundos

// ══════════════════════════════════════════════════════════
// SISTEMA DE APROVAÇÃO (NOVO)
// ══════════════════════════════════════════════════════════
const solicitacoesPendentes = new Map();
let solicitacaoIdCounter = 1;
const TEMPO_EXPIRACAO_APROVACAO = 60000; // 60 segundos

// Limpar solicitações e desafios expirados
setInterval(() => {
  const agora = Date.now();
  for (const [id, sol] of solicitacoesPendentes) {
    if (agora > sol.expiraEm) solicitacoesPendentes.delete(id);
  }
  for (const [id, des] of desafiosVelha) {
    if (agora > des.expiraEm) desafiosVelha.delete(id);
  }
}, 30000);

const REGEX_URL = /(https?:\/\/[^\s]+)/g;

async function getMetadataCached(sock, groupId) {
  const agora = Date.now();
  const c = cacheMetadata.get(groupId);
  if (c && c.expiraEm > agora) return c.data;
  const meta = await sock.groupMetadata(groupId);
  cacheMetadata.set(groupId, { data: meta, expiraEm: agora + 30000 });
  return meta;
}
setInterval(() => { const a = Date.now(); for (const [k, v] of cacheMetadata) if (v.expiraEm < a) cacheMetadata.delete(k); }, 300000);

async function getJSON(url, timeout = 15000) {
  try { const r = await axios.get(url, { timeout }); return r.data; } catch { return null; }
}

async function extrairGenDownload(url) {
  const r = await axios.post('https://gendownload.com/api/extract', { url }, { headers: { 'Content-Type': 'application/json' }, timeout: 45000 });
  return r.data;
}

function escolherFormatoGen(dados, tipo) {
  const formatos = dados?.formats || [];
  if (tipo === 'audio') return formatos.filter(f => f.type === 'audio').sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0] || null;
  const videos = formatos.filter(f => f.type === 'video');
  if (!videos.length) return null;
  return videos.find(f => f.ext === 'mp4' && /360|480/.test(f.label || '')) || videos.find(f => f.ext === 'mp4') || videos[0];
}

async function baixarBufferGen(formato, maxBytes = 64 * 1024 * 1024) {
  if (!formato?.url) return null;
  if (formato.filesize && formato.filesize > maxBytes) return null;
  const r = await axios.get(formato.url, { responseType: 'arraybuffer', timeout: 180000 });
  if (!r.data || r.data.length === 0 || r.data.length > maxBytes) return null;
  return Buffer.from(r.data);
}

function extrairVideoId(link) { const m = link.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : null; }

async function converterVideoParaStickerAnimado(buffer, segundos = 6) {
  const tmpIn = path.join(os.tmpdir(), `kortex_in_${Date.now()}.mp4`);
  const tmpOut = path.join(os.tmpdir(), `kortex_out_${Date.now()}.webp`);
  fs.writeFileSync(tmpIn, buffer);
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(tmpIn).noAudio().outputOptions([`-t ${segundos}`, '-vf scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=12', '-vcodec libwebp', '-lossless 0', '-compression_level 6', '-quality 45', '-loop 0', '-preset default', '-vsync 0']).save(tmpOut).on('end', () => resolve()).on('error', (e) => reject(e));
    });
    return fs.readFileSync(tmpOut);
  } finally { try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {} }
}

function avaliarExpressao(expr) {
  const limpa = expr.replace(/\s/g, '').replace(/x/gi, '*').replace(/÷/g, '/').replace(/,/g, '.');
  const tokens = limpa.match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens || tokens.join('') !== limpa) throw new Error('expr');
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  const out = [], ops = []; let prev = null;
  for (const t of tokens) {
    if (/^\d/.test(t)) out.push(parseFloat(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); if (!ops.length) throw new Error('expr'); ops.pop(); }
    else {
      if (t === '-' && (prev === null || prec[prev] || prev === '(')) out.push(0);
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t] && t !== '^') out.push(ops.pop());
      ops.push(t);
    }
    prev = t;
  }
  while (ops.length) { const o = ops.pop(); if (o === '(') throw new Error('expr'); out.push(o); }
  const st = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else { const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) throw new Error('expr'); st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : t === '%' ? a % b : Math.pow(a, b)); }
  }
  if (st.length !== 1 || !isFinite(st[0])) throw new Error('expr');
  return st[0];
}

function velhaRender(b) {
  const m = b.map((v, i) => v === 'X' ? '❌' : v === 'O' ? '⭕' : ` ${i + 1} `);
  return `${m[0]}│${m[1]}│${m[2]}\n───┼───┼───\n${m[3]}│${m[4]}│${m[5]}\n───┼───┼───\n${m[6]}│${m[7]}│${m[8]}`;
}

function velhaVencedor(b) {
  const L = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, c, d] of L) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  return b.every(x => x) ? 'empate' : null;
}

const RATE_LIMIT_MAX = 4, RATE_LIMIT_JANELA_MS = 180000, RATE_LIMIT_EXCLUIR = new Set(['apagar', 'info']);

function verificarRateLimit(senderId, cmd) {
  if (RATE_LIMIT_EXCLUIR.has(cmd)) return { permitido: true };
  const chave = `${senderId}|${cmd}`, agora = Date.now();
  let usos = db.rateLimit.get(chave);
  if (!usos) { usos = [agora]; db.rateLimit.set(chave, usos); return { permitido: true }; }
  let i = 0; while (i < usos.length) { if (agora - usos[i] >= RATE_LIMIT_JANELA_MS) usos.splice(i, 1); else i++; }
  if (usos.length >= RATE_LIMIT_MAX) return { permitido: false, esperarMs: RATE_LIMIT_JANELA_MS - (agora - usos[0]) };
  usos.push(agora); return { permitido: true };
}

const CHAT_LIMITE_MAX = 5, CHAT_LIMITE_JANELA_MS = 300000;

function verificarLimiteConversaIA(senderId) {
  const chave = `chat|${senderId}`, agora = Date.now();
  let usos = db.rateLimit.get(chave);
  if (!usos) { usos = [agora]; db.rateLimit.set(chave, usos); return { permitido: true }; }
  let i = 0; while (i < usos.length) { if (agora - usos[i] >= CHAT_LIMITE_JANELA_MS) usos.splice(i, 1); else i++; }
  if (usos.length >= CHAT_LIMITE_MAX) return { permitido: false, esperarMs: CHAT_LIMITE_JANELA_MS - (agora - usos[0]) };
  usos.push(agora); return { permitido: true };
}

const MENU_LIMITE_MAX = 2, MENU_LIMITE_JANELA_MS = 180000;

class PermissaoNegada extends Error {}

const MENU_COMANDOS = new Set(['menu', 'menubtn', 'ajuda', 'cgeral', 'cadmin', 'cprot', 'cmidia', 'cstick', 'cdono', 'cutil', 'ctexto', 'cinfo', 'cdiv', 'cimg']);

function verificarLimiteMenu(senderId, cmd) {
  const chave = `menu|${senderId}|${cmd}`, agora = Date.now();
  let usos = db.rateLimit.get(chave);
  if (!usos) { usos = [agora]; db.rateLimit.set(chave, usos); return { permitido: true }; }
  let i = 0; while (i < usos.length) { if (agora - usos[i] >= MENU_LIMITE_JANELA_MS) usos.splice(i, 1); else i++; }
  if (usos.length >= MENU_LIMITE_MAX) return { permitido: false, esperarMs: MENU_LIMITE_JANELA_MS - (agora - usos[0]) };
  usos.push(agora); return { permitido: true };
}

const SEM_PREFIXO_SEGUROS = new Set(['menu','menubtn','ajuda','comandos','cgeral','cutil','ctexto','cinfo','cdiv','cimg','cmidia','cstick','cadmin','cprot','cdono','guiamidia','info','ping','hora','calcular','moeda','senha','pin','aleatorio','idade','tabuada','porcentagem','contar','sortear','caraoucoroa','romanos','significado','sinonimo','antonimo','leet','vaporwave','gerarnome','wiki','pais','capital','hoje','noticias','filme','serie','manga','personagem','musica','dolar','euro','ouro','futebol','tabela','charada','frase','traduzir','ranking','pontos','jogodavelha','transcrever','aprovar','recusar']);

// ══════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DE COMANDOS — SEM PREFIXO + APROVAÇÃO (NOVO)
// ══════════════════════════════════════════════════════════
const COMANDOS_SENSIVEIS = new Set([
  'banir','promover','rebaixar','fechar','abrir','apagar',
  'antilink','proibirpalavra','desbanirpalavra','regras','boasvindas',
  'ativarvip','removervip','desativarcomando','ativarcomando',
  'ignorar','designorar','desligarbot','ligarbot',
  'nome','foto','criargrupo','silenciar','dessilenciar',
  'advertir','removeradvertencia','antimidia','autodelete',
  'notificar','ia','entrar','atalho','removeratalho',
  'prefixo','backup','restaurar','modelo','marcartodos','agendar'
]);

const COMANDO_EMOJIS = {
  menu: '📜', menubtn: '📜', ajuda: '📜', cgeral: '🌐', cadmin: '👮', cprot: '🛡️', cmidia: '📲', cstick: '🖼️', cdono: '👑',
  cutil: '🧰', ctexto: '🔤', cinfo: '🌍', cdiv: '😄', cimg: '🖼️',
  ping: '🏓', hora: '🕒', info: '⚡', planos: '💰', statusgrupo: '💎', comandos: '📋', ranking: '🏆', pontos: '🔢', indicar: '📨',
  banir: '', promover: '⬆️', rebaixar: '⬇️', marcartodos: '📢', historico: '📜', fechar: '🔒', abrir: '🔓', link: '', idgrupo: '🆔', apagar: '🗑️',
  antilink: '🔗', proibirpalavra: '📵', desbanirpalavra: '✅', regras: '📜', ia: '🧠', autodelete: '🤖', verregras: '📃', listarpalavras: '📃', boasvindas: '👋',
  figurinha: '🎨', stickertexto: '️', infosticker: 'ℹ️', modelo: '🖼️', traduzir: '🌍', recibo: '🧾',
  ativarvip: '💎', removervip: '🚫', listargrupos: '📋', avisartodos: '', atalho: '⚡', removeratalho: '🗑️', listaratalhos: '⚡',
  estatisticas: '📊', relatorio: '', prefixo: '⚙️', backup: '💾', restaurar: '♻️', desligarbot: '🔴', ligarbot: '🟢',
  ignorar: '🔇', designorar: '', ignorados: '🔇', notificar: '🔔', usocomandos: '📊',
  tiktok: '', instagram: '📸', youtube: '🎬', youtubeaudio: '🎵', youtubevideo: '🎥', baixar: '🌐', facebook: '📘',
  fichamidia: '📊', canal: '📡', zip: '📦', desativarcomando: '🚫', listardesativados: '📃', ativarcomando: '✅',
  vipuser: '👑', meuvip: '💎', meuid: '🆔', entrar: '📥', sair: '📤', semprefixo: '⚡',
  calcular: '🧮', moeda: '', senha: '🔐', pin: '🔢', aleatorio: '🎲', idade: '🎂', tabuada: '️', porcentagem: '％', contar: '🔤', sortear: '🎯', caraoucoroa: '🪙',
  romanos: '🏛️', significado: '📖', sinonimo: '📖', antonimo: '📖', leet: '👾', vaporwave: '🌸', gerarnome: '✍️',
  wiki: '📚', pais: '️', capital: '🏛️', hoje: '📅', noticias: '📰', filme: '🎬', serie: '', manga: '📖', personagem: '🎭', musica: '🎵',
  dolar: '💵', euro: '', ouro: '🥇', futebol: '⚽', tabela: '🏆',
  charada: '🧩', frase: '💬', jogodavelha: '',
  converterimagem: '🖼️', roubarsticker: '🥷', circular: '⭕',
  advertir: '⚠️', advertencias: '', removeradvertencia: '✅', silenciar: '🔇', dessilenciar: '🔊',
  nome: '🏷️', foto: '📸', criargrupo: '🏟️', listarbanidos: '🚫', transcrever: '🎙️',
  antimidia: '🛡️', agendar: '📅', revelar: '👻', pinterest: '', tiktokaudio: '🎶',
  aprovar: '✅', recusar: ''
};

const NIVEIS_VIP = {
  ouro: { nome: 'Ouro ', maxDias: 7, admin: true, ban: true, promote: false, rules: false, anti: false, boasvindas: false, sticker: false },
  diamante: { nome: 'Diamante 💎', maxDias: 30, admin: true, ban: true, promote: true, rules: true, anti: true, boasvindas: true, sticker: true },
  lenda: { nome: 'Lenda 👑', maxDias: 60, admin: true, ban: true, promote: true, rules: true, anti: true, boasvindas: true, sticker: true }
};
const RANK_VIP = { ouro: 1, diamante: 2, lenda: 3 };

const NIVEIS_VIP_USER = {
  ouro: { nome: 'Ouro 🥇', maxDias: 7, cmds: ['tiktok', 'tiktokaudio'] },
  diamante: { nome: 'Diamante 💎', maxDias: 30, cmds: ['tiktok', 'tiktokaudio', 'instagram', 'facebook', 'baixar', 'fichamidia', 'pinterest'] },
  lenda: { nome: 'Lenda 👑', maxDias: 60, cmds: ['tiktok', 'tiktokaudio', 'instagram', 'facebook', 'baixar', 'fichamidia', 'pinterest', 'youtube', 'youtubeaudio', 'youtubevideo', 'canal', 'zip'] }
};

const NIVEIS_VIP_GRUPO_MIDIA = {
  ouro: ['tiktok', 'tiktokaudio', 'instagram'],
  diamante: ['tiktok', 'tiktokaudio', 'instagram', 'facebook', 'baixar', 'fichamidia', 'pinterest'],
  lenda: ['tiktok', 'tiktokaudio', 'instagram', 'facebook', 'baixar', 'fichamidia', 'pinterest', 'youtube', 'youtubeaudio', 'youtubevideo', 'canal', 'zip']
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
      if (data.warns) for (const [k, v] of Object.entries(data.warns)) db.warns.set(k, new Map(Object.entries(v)));
      if (data.mutados) for (const [k, v] of Object.entries(data.mutados)) db.mutados.set(k, new Map(Object.entries(v)));
      if (data.semPrefixo) for (const id of data.semPrefixo) db.grupos.semPrefixo.add(id);
      if (data.antiMidia) for (const [k, v] of Object.entries(data.antiMidia)) db.grupos.antiMidia.set(k, new Set(v));
      if (data.agendamentos) for (const [k, v] of Object.entries(data.agendamentos)) agendamentos.set(k, v);
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
      gruposVIP: Object.fromEntries(db.gruposVIP), grupoDono: Object.fromEntries(db.grupoDono),
      atalhos: Object.fromEntries(db.atalhos), antiLink: Object.fromEntries(db.grupos.antiLink),
      palavrasBanidas: Object.fromEntries(db.grupos.palavrasBanidas), boasvindas: Object.fromEntries(db.grupos.boasvindas),
      regras: Object.fromEntries(db.grupos.regras), banidos: Object.fromEntries(db.grupos.banidos),
      iaAtivo: [...db.grupos.iaAtivo], desligados: [...db.grupos.desligados], ignorados: [...db.ignorados],
      whitelist: Object.fromEntries([...db.whitelist].map(([k, s]) => [k, [...s]])),
      autoDelete: Object.fromEntries(db.autoDelete), indicadores: Object.fromEntries(db.indicadores),
      stats: Object.fromEntries(db.stats), notifications: Object.fromEntries(db.notifications),
      prefixo: CONFIG.prefix, usersVIP: Object.fromEntries(db.usersVIP),
      comandosDesativados: Object.fromEntries([...db.grupos.comandosDesativados].map(([k, v]) => [k, [...v]])),
      warns: Object.fromEntries([...db.warns].map(([k, v]) => [k, Object.fromEntries(v)])),
      mutados: Object.fromEntries([...db.mutados].map(([k, v]) => [k, Object.fromEntries(v)])),
      semPrefixo: [...db.grupos.semPrefixo],
      antiMidia: Object.fromEntries([...db.grupos.antiMidia].map(([k, v]) => [k, [...v]])),
      agendamentos: Object.fromEntries(agendamentos)
    };
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), 'utf8');
    fs.writeFileSync(CONFIG.historicoFile, JSON.stringify(Object.fromEntries(db.historicoGrupos), null, 2), 'utf8');
    if (global.gc) { try { global.gc(); } catch {} }
  } catch (e) { console.error('Erro ao guardar dados:', e.message); }
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
  extractIdNumber: (id) => { try { return id.replace(/[^0-9]/g, ''); } catch { return ''; } },
  isOwner: (id) => {
    const n = utils.extractIdNumber(id);
    if (!n) return false;
    if (cacheDonoLid.has(id)) return true;
    return n === CONFIG.ownerId || n.endsWith(CONFIG.ownerNumber);
  },
  escapeXml: (str) => String(str).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])),
  isGroupSubscribed: (groupId) => {
    const sub = db.gruposVIP.get(groupId);
    if (!sub) return false;
    if (sub.expiraEm < Date.now()) { db.gruposVIP.delete(groupId); db.grupoDono.delete(groupId); salvarDados(); return false; }
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
      if (nativeFlow?.paramsJson) { try { const p = JSON.parse(nativeFlow.paramsJson); if (p?.id) return p.id; } catch {} }
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
      db.gruposVIP.delete(groupId); db.grupoDono.delete(groupId); salvarDados();
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
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  },
  reagir: async (sock, msg, emoji) => { try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }); } catch {} },
  adicionarMetadadosSticker: async (buffer) => {
    try {
      const img = new WebpImage();
      await img.load(buffer);
      const exifJson = {
        'sticker-pack-id': `kortex-${Date.now()}`,
        'sticker-pack-name': 'Kortex ',
        'sticker-pack-publisher': 'Yanik Uaite • 834788141',
        'android-app-store-link': 'https://wa.me/258834788141',
        'ios-app-store-link': 'https://wa.me/258834788141',
        emojis: ['⚡']
      };
      const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
      const jsonBuffer = Buffer.from(JSON.stringify(exifJson), 'utf-8');
      const exif = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);
      img.exif = exif;
      const resultado = await img.save(null);
      const ok = Buffer.isBuffer(resultado) && resultado.length > 12 && resultado.subarray(0, 4).toString('ascii') === 'RIFF' && resultado.subarray(8, 12).toString('ascii') === 'WEBP';
      return ok ? resultado : buffer;
    } catch (e) { return buffer; }
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
  if (vip.expiraEm < Date.now()) { db.usersVIP.delete(senderId); salvarDados(); return false; }
  const nivel = NIVEIS_VIP_USER[vip.nivel];
  return nivel && nivel.cmds.includes(cmd);
}

function verificarVIPGrupoMidia(ctx, cmd) {
  if (!ctx.isGroup || !utils.isGroupSubscribed(ctx.chatId)) return false;
  const sub = utils.getGroupSubscription(ctx.chatId);
  if (!sub) return false;
  const cmds = NIVEIS_VIP_GRUPO_MIDIA[sub.nivel];
  return !!(cmds && cmds.includes(cmd));
}

function verificarAcessoMidia(ctx, cmd) {
  if (utils.isOwner(ctx.senderId)) return true;
  if (verificarVIPUser(ctx.senderId, cmd)) return true;
  return verificarVIPGrupoMidia(ctx, cmd);
}

function mensagemGuiaMidia(ctx) {
  const subGrupo = ctx.isGroup ? utils.getGroupSubscription(ctx.chatId) : null;
  const vipUser = db.usersVIP.get(ctx.senderId);
  const vipUserAtivo = vipUser && vipUser.expiraEm > Date.now();
  let texto = `📖 *GUIA — ACESSO A MÍDIA*\n━━━━━━━━━━━━━━\n\nExistem 2 formas de desbloquear:\n\n`;
  texto += `🏢 *1. VIP DE GRUPO* (libera para TODOS no grupo)\n`;
  texto += `🥇 Ouro → .tiktok .tiktokaudio .instagram\n`;
  texto += `💎 Diamante → + .facebook .baixar .fichamidia .pinterest\n`;
  texto += `👑 Lenda → + .youtube .youtubeaudio .youtubevideo .canal .zip\n`;
  texto += `Activa com: .ativarvip [nível] [dias] (dono)\n\n`;
  texto += ` *2. VIP INDIVIDUAL* (libera só para a pessoa)\n`;
  texto += `🥇 Ouro → .tiktok .tiktokaudio\n`;
  texto += `💎 Diamante → + .instagram .facebook .baixar .fichamidia .pinterest\n`;
  texto += `👑 Lenda → + .youtube .youtubeaudio .youtubevideo .canal .zip\n`;
  texto += `Activa com: .vipuser @pessoa [nível] [dias] (dono)\n\n`;
  texto += `━━━━━━━━━━━━━━\n📊 *O TEU ESTADO ACTUAL*\n`;
  texto += ctx.isGroup
    ? `🏢 Grupo: ${subGrupo ? `${NIVEIS_VIP[subGrupo.nivel]?.nome || subGrupo.nivel} (${utils.tempoRestante(subGrupo.expiraEm - Date.now())} restantes)` : 'sem VIP de grupo'}\n`
    : `🏢 Grupo: — (estás em PV)\n`;
  texto += ` Pessoal: ${vipUserAtivo ? `${NIVEIS_VIP_USER[vipUser.nivel]?.nome || vipUser.nivel} (${utils.tempoRestante(vipUser.expiraEm - Date.now())} restantes)` : 'sem VIP individual'}\n`;
  texto += `\n💡 Qualquer um dos dois já é suficiente para desbloquear.`;
  return texto;
}

const GROQ_MODELOS_FALLBACK = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];

async function perguntarGroq(prompt) {
  const modelos = [CONFIG.groq_model, ...GROQ_MODELOS_FALLBACK].filter((m, i, a) => m && a.indexOf(m) === i);
  for (const modelo of modelos) {
    try {
      const c = await comFallbackGroq(client => client.chat.completions.create({ messages: [{ role: 'user', content: prompt }], model: modelo, temperature: 0.5, max_tokens: 120 }));
      return c.choices[0]?.message?.content?.trim();
    } catch {}
  }
  return null;
}

async function askGroq(chatId, userText, isOwner = false, isGrupo = false) {
  const iaAtiva = db.grupos.iaAtivo.has(chatId);
  if (!isOwner && isGrupo && !iaAtiva) {
    const palavrasChave = ['grupo', 'vip', 'ativo', 'antilink', 'status', 'assinatura', 'bot', 'kortex'];
    if (!palavrasChave.some(p => userText.toLowerCase().includes(p))) return null;
  }
  if (!db.historicoIA.has(chatId)) db.historicoIA.set(chatId, []);
  const history = db.historicoIA.get(chatId);
  history.push({ role: 'user', content: userText });
  if (history.length > 10) history.shift();
  db.historicoIAUltimoUso.set(chatId, Date.now());
  try {
    let infoSistema = `ESTADO DO SISTEMA:\n- Grupos VIP: ${db.gruposVIP.size}\n- Anti-link: ${db.grupos.antiLink.size > 0 ? `activo em ${db.grupos.antiLink.size} grupos` : 'inactivo'}\n- IA activa em ${db.grupos.iaAtivo.size} grupos\n- Uptime: ${Math.floor(process.uptime() / 60)} minutos\n`;
    let systemMsg;
    if (!isGrupo) {
      systemMsg = `Chamas-te ${CONFIG.botName}, assistente de WhatsApp criado por ${CONFIG.creator}.\nSimpático, directo, prestável. Português de Moçambique.\nRespondes a qualquer pergunta. Nunca inventas factos.\n${infoSistema}Prefixo: ${CONFIG.prefix}`;
      if (isOwner) systemMsg += `\n\nO DONO está a falar — podes partilhar detalhes do sistema.`;
    } else {
      systemMsg = `Chamas-te ${CONFIG.botName}, assistente de WhatsApp criado por ${CONFIG.creator}.\nSimpático, directo. Português de Moçambique. Máx. 3 frases.\n${iaAtiva ? 'IA LIVRE: responde a qualquer pergunta.' : 'MODO RESTRITO: só sobre o sistema do bot.'}\n${infoSistema}Prefixo: ${CONFIG.prefix}`;
      if (isOwner) systemMsg += `\n\nO DONO está a falar — dá informações detalhadas.`;
    }
    const modelos = [CONFIG.groq_model, process.env.GROQ_MODEL, ...GROQ_MODELOS_FALLBACK].filter((m, i, arr) => m && arr.indexOf(m) === i);
    let resposta = null, ultimoErro = null;
    for (const modelo of modelos) {
      try {
        const completion = await comFallbackGroq(client => client.chat.completions.create({ messages: [{ role: 'system', content: systemMsg }, ...history], model: modelo, temperature: 0.5, max_tokens: 250 }));
        resposta = completion.choices[0]?.message?.content?.trim();
        CONFIG.groq_model = modelo;
        break;
      } catch (e) { ultimoErro = e; console.warn(`️ Modelo "${modelo}" falhou: ${String(e.message).substring(0, 140)}`); }
    }
    if (!resposta) {
      if (ultimoErro?.message?.includes('rate')) return "⏳ Muitas perguntas! Aguarda um momento.";
      if (ultimoErro?.message?.includes('auth') || ultimoErro?.message?.includes('key')) return "❌ Chave Groq inválida.";
      return "❌ Erro ao processar. Tenta novamente.";
    }
    history.push({ role: 'assistant', content: resposta });
    return resposta;
  } catch { return "❌ Erro ao processar. Tenta novamente."; }
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
        const avatar = await sharp(Buffer.from(resp.data)).resize(120, 120, { fit: 'cover' }).composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }]).png().toBuffer();
        base = await sharp(base).composite([{ input: avatar, top: 180, left: 340 }]).png().toBuffer();
      }
    } catch {}
    return base;
  } catch { return null; }
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
    if (sub) { const r = sub.expiraEm - Date.now(); vipTexto = r > 0 ? `${NIVEIS_VIP[sub.nivel]?.nome || sub.nivel} — expira em ${utils.tempoRestante(r)}` : '⌛ Expirado'; }
    blocos.push(`━━━━━━━━━━━━━━━━━━━\n🏷️ *${nome}*\n💎 VIP: ${vipTexto}\n Anti-link: ${db.grupos.antiLink.get(groupId) ? `✅ (${db.grupos.antiLink.get(groupId)})` : '❌'}\n🤖 IA: ${db.grupos.iaAtivo.has(groupId) ? '✅' : '❌'}\n🚫 Palavras: ${(db.grupos.palavrasBanidas.get(groupId) || []).length}\n👋 Boas-vindas: ${db.grupos.boasvindas.has(groupId) ? '✅' : '❌'}\n Regras: ${db.grupos.regras.has(groupId) ? '✅' : '❌'}\n🗑️ Auto-del: ${db.autoDelete.get(groupId) ? `✅ (${db.autoDelete.get(groupId)}ms)` : '❌'}\n Banidos: ${(db.grupos.banidos.get(groupId) || []).length}`);
  }
  return [`📊 *RELATÓRIO* — ${grupoIds.length} grupo(s)\n`, ...blocos];
}

async function enviarRelatorioCompleto(sock, chatId) {
  const partes = await gerarBlocosRelatorio(sock);
  if (partes.length === 1) return await sock.sendMessage(chatId, { text: partes[0] });
  for (let i = 1; i < partes.length; i += 3) await sock.sendMessage(chatId, { text: (i === 1 ? partes[0] : '') + partes.slice(i, i + 3).join('\n') });
}

function pareceIntentoRelatorio(t) { const x = t.toLowerCase(); return /grupo/.test(x) && /status|relat[oó]rio|resumo|situa[cç][aã]o|geri[rs]|administr/.test(x); }
function pareceIntentoSairGrupo(t) { const x = t.toLowerCase(); return /\b(sai|saia|sair|retira-?te|vai-te embora|desliga-?te)\b.*\b(grupo|daqui)\b/.test(x) || /\b(sai|saia|pode\s+ir)\s+embora\b/.test(x); }
function pareceIntentoBanir(t) { return /\b(bane|banir|expulsa|expulsar|remove|tira|silencia|silenciar|cala)\b/.test(t.toLowerCase()); }
function pareceIntentoFecharGrupo(t) { return /\bfecha(r)?\b.*\bgrupo\b/.test(t.toLowerCase()); }
function pareceIntentoAbrirGrupo(t) { return /\b(abre|abrir)\b.*\bgrupo\b/.test(t.toLowerCase()); }
function pareceIntentoApagarMensagem(t) { return /\b(apaga|apagar|deleta|deletar|remove)\b/.test(t.toLowerCase()); }
function pareceIntentoQuemDono(t) { const x = t.toLowerCase(); return /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\sdono/.test(x) || /quem\s+te\s+criou/.test(x) || /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\scriador/.test(x); }

function gerarCartaoApresentacao() {
  const saudacoes = ['👋 Olá! Prazer em conhecer-te!', '🤗 Ei! Bem-vindo(a) ao meu PV!', '👋 Hey! Que bom que vieste falar comigo!', '✨ Olá! Sou o Kortex!'];
  const s = saudacoes[Math.floor(Math.random() * saudacoes.length)];
  return `⚡ *KORTEX* ⚡\n_Assistente Inteligente_\n\n${s}\n\n📌 *QUEM SOU:*\nAssistente pessoal criado por *${CONFIG.creator}*!\n\n✨ *O QUE FAÇO:*\n┃ 🛡️ Protejo e gerencio grupos\n┃ 💎 Sistema VIP exclusivo\n┃ 🎵 Downloads (TikTok, IG, YT, +1600 sites)\n┃ 🌍 Tradutor, notícias, filmes e mais\n┃ 🧠 Inteligência Artificial\n┃ 🎨 Stickers (estáticos e animados)\n┃ 🎙️ Transcrição de áudio\n\n📞 *SABER MAIS:*\n✆ ${CONFIG.ownerNumber}\n📧 yanikuaite@gmail.com\n\n💬 _"Kortex: a inteligência no centro do teu grupo!"_`;
}

function gerarCartaoVipAtivo(sub) {
  const dias = Math.max(0, Math.ceil((sub.expiraEm - Date.now()) / 86400000));
  return `💎 *STATUS VIP*\n━━━━━━━━━━━━━━\n\n✅ Plano *${NIVEIS_VIP[sub.nivel]?.nome || sub.nivel}* activo!\n⏳ Dias restantes: *${dias}*\n\nPara renovar: ✆ ${CONFIG.ownerNumber}\n Obrigado!`;
}

function gerarCartaoVipConvite() {
  return `💎 *ACTIVA O VIP!*\n━━━━━━━━━━━━━━\n\nEste grupo ainda não tem VIP.\n\nCom o VIP desbloqueias:\n├─ Administração automática\n├─ Anti-link e protecção\n─ Boas-vindas personalizadas\n└─ Regras e auto-replies\n\nFala com o dono: ✆ ${CONFIG.ownerNumber}`;
}// ══════════════════════════════════════════════════════════
// FUNÇÃO CENTRAL — ENVIAR MENU COM IMAGEM OFICIAL (NOVO)
// ═════════════════════════════════════════════════════════
async function enviarMenuKortex(sock, ctx, { titulo, conteudo, imagemChave, rodape = '⚡ KORTEX CORE' }) {
  const nome = ctx.senderId.split('@')[0];
  const imagemPath = CONFIG.imagens[imagemChave] || CONFIG.imagens.principal;
  
  let imagemBuffer = null;
  if (fs.existsSync(imagemPath)) {
    try { imagemBuffer = fs.readFileSync(imagemPath); } catch {}
  }
  
  const nivelGrupo = ctx.isGroup ? (() => {
    const sub = db.gruposVIP.get(ctx.chatId);
    if (!sub) return 'SEM VIP';
    if (sub.expiraEm < Date.now()) return 'EXPIRADO';
    return (NIVEIS_VIP[sub.nivel]?.nome || sub.nivel).toUpperCase();
  })() : 'PV';
  
  const legenda = `╔══════════════════════════╗
║      ⚡ K O R T E X       ║
║       N Ú C L E O         ║
══════════════════════════╣
║ 👤 SOLICITADO POR: @${nome}  ║
╠══════════════════════════╣
║ 🟢 STATUS   : ONLINE      ║
║ ⚙️ SISTEMA  : OPERACIONAL ║
║ 💎 GRUPO    : ${nivelGrupo.padEnd(11)}║
╠══════════════════════════╣
║                          ║
║ ${titulo.padEnd(24)}║
║                          ║
${conteudo}
║                          
╠══════════════════════════╣
║ ${rodape.padEnd(24)}║
╚══════════════════════════╝`;

  if (imagemBuffer) {
    await sock.sendMessage(ctx.chatId, {
      image: imagemBuffer,
      caption: legenda,
      mentions: [ctx.senderId]
    });
  } else {
    await sock.sendMessage(ctx.chatId, {
      text: legenda,
      mentions: [ctx.senderId]
    });
  }
}

// ══════════════════════════════════════════════════════════
// DETECÇÃO INTELIGENTE DE COMANDO SEM PREFIXO (NOVO)
// ══════════════════════════════════════════════════════════
function detectarComandoSemPrefixo(texto) {
  if (!texto || texto.length > 200) return null;
  const trimmed = texto.trim();
  if (/^[.,!?;:🔥❤️😂👍👏]/.test(trimmed)) return null;
  const partes = trimmed.split(/\s+/);
  const primeiraPalavra = partes[0].toLowerCase().replace(/[.!?,;:]$/, '');
  if (!commands[primeiraPalavra]) return null;
  if (COMANDOS_SENSIVEIS.has(primeiraPalavra)) {
    if (trimmed.length > 80) return null;
    if (/^(eu |pode |por favor |queria |gostaria |vc |você )/i.test(trimmed)) return null;
  }
  return {
    comando: primeiraPalavra,
    args: partes.slice(1),
    textoCompleto: trimmed
  };
}

// ══════════════════════════════════════════════════════════
// SISTEMA DE APROVAÇÃO (NOVO)
// ══════════════════════════════════════════════════════════
async function solicitarAprovacao(sock, ctx, comandoDetectado) {
  const id = solicitacaoIdCounter++;
  const solicitante = ctx.senderId;
  const alvo = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0] || ctx.args[0] || '—';
  
  const solicitacao = {
    id,
    grupoId: ctx.chatId,
    solicitante,
    comando: comandoDetectado.comando,
    args: comandoDetectado.args,
    alvo,
    criadoEm: Date.now(),
    expiraEm: Date.now() + TEMPO_EXPIRACAO_APROVACAO,
    estado: 'pendente'
  };
  
  solicitacoesPendentes.set(id, solicitacao);
  
  const nomeSolicitante = solicitante.split('@')[0];
  const nomeAlvo = typeof alvo === 'string' && alvo.includes('@') ? alvo.split('@')[0] : String(alvo).substring(0, 30);
  
  const texto = `🛡️ *KORTEX SECURITY*\n\n🚨 AÇÃO SENSÍVEL DETECTADA\n\n👤 Solicitado por: @${nomeSolicitante}\n⚙️ Ação: .${comandoDetectado.comando} ${comandoDetectado.args.join(' ')}\n🎯 Alvo: @${nomeAlvo}\n\n🔐 Esta ação necessita de aprovação.\n\n👮 Administradores do grupo ou 👑 Dono\npodem aprovar esta operação.\n\n✅ Aprovar: .aprovar ${id}\n Recusar: .recusar ${id}\n\n⏳ Solicitação expira em 60 segundos.\n🆔 ID: #${id}`;
  
  await sock.sendMessage(ctx.chatId, {
    text: texto,
    mentions: [solicitante, typeof alvo === 'string' && alvo.includes('@') ? alvo : null].filter(Boolean)
  });
  
  setTimeout(() => {
    const sol = solicitacoesPendentes.get(id);
    if (sol && sol.estado === 'pendente') {
      sol.estado = 'expirada';
      solicitacoesPendentes.delete(id);
      sock.sendMessage(ctx.chatId, {
        text: `⏳ *KORTEX SECURITY*\n\nSolicitação #${id} expirada.\n\n🔒 Nenhuma ação foi executada.`
      }).catch(() => {});
    }
  }, TEMPO_EXPIRACAO_APROVACAO);
}

async function processarAprovacao(sock, ctx, idStr, aprovar) {
  const id = parseInt(idStr);
  const solicitacao = solicitacoesPendentes.get(id);
  
  if (!solicitacao) {
    return await sock.sendMessage(ctx.chatId, { text: `❌ Solicitação #${id} não encontrada ou já expirada.` });
  }
  
  if (solicitacao.estado !== 'pendente') {
    return await sock.sendMessage(ctx.chatId, { text: `⚠️ Solicitação #${id} já foi ${solicitacao.estado}.` });
  }
  
  if (Date.now() > solicitacao.expiraEm) {
    solicitacao.estado = 'expirada';
    solicitacoesPendentes.delete(id);
    return await sock.sendMessage(ctx.chatId, { text: `⏳ Solicitação #${id} expirada.` });
  }
  
  const aprovador = ctx.senderId;
  const isDonoBot = utils.isOwner(aprovador);
  const isAdminGrupo = ctx.isGroup ? await utils.isSenderGroupAdmin(sock, ctx.chatId, aprovador) : false;
  
  if (!isDonoBot && !isAdminGrupo) {
    return await sock.sendMessage(ctx.chatId, { text: `🚫 Apenas administradores do grupo ou o dono do bot podem aprovar.` });
  }
  
  if (solicitacao.solicitante === aprovador && !isDonoBot) {
    return await sock.sendMessage(ctx.chatId, { text: `🚫 Não podes aprovar a tua própria solicitação.` });
  }
  
  if (solicitacao.alvo && typeof solicitacao.alvo === 'string' && solicitacao.alvo.includes('@') && solicitacao.alvo === aprovador && !isDonoBot) {
    return await sock.sendMessage(ctx.chatId, { text: ` Não podes aprovar uma ação contra ti mesmo.` });
  }
  
  const nomeSolicitante = solicitacao.solicitante.split('@')[0];
  const nomeAprovador = aprovador.split('@')[0];
  
  if (aprovar) {
    solicitacao.estado = 'aprovada';
    solicitacoesPendentes.delete(id);
    
    await sock.sendMessage(ctx.chatId, {
      text: `⚡ *KORTEX SECURITY*\n\n✅ AÇÃO APROVADA\n\n Solicitado por: @${nomeSolicitante}\n👮 Aprovado por: @${nomeAprovador}\n⚙️ Ação: .${solicitacao.comando}\n\n🔄 Executando...`,
      mentions: [solicitacao.solicitante, aprovador]
    });
    
    try {
      const ctxExecucao = {
        chatId: solicitacao.grupoId,
        senderId: solicitacao.solicitante,
        isGroup: ctx.isGroup,
        msg: ctx.msg,
        args: solicitacao.args,
        _aprovado: true,
        _aprovadoPor: aprovador
      };
      
      if (commands[solicitacao.comando]) {
        await commands[solicitacao.comando](sock, ctxExecucao);
        await sock.sendMessage(ctx.chatId, {
          text: `✅ *AÇÃO CONCLUÍDA*\n\n⚡ KORTEX SECURITY CORE`
        });
      }
    } catch (e) {
      await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao executar ação aprovada: ${e.message}` });
    }
  } else {
    solicitacao.estado = 'recusada';
    solicitacoesPendentes.delete(id);
    
    await sock.sendMessage(ctx.chatId, {
      text: `🛡️ *KORTEX SECURITY*\n\n❌ AÇÃO RECUSADA\n\n Solicitado por: @${nomeSolicitante}\n👮 Recusado por: @${nomeAprovador}`,
      mentions: [solicitacao.solicitante, aprovador]
    });
  }
}

// ══════════════════════════════════════════════════════════
// COMANDOS
// ══════════════════════════════════════════════════════════
const commands = {
  _getPerms: async (sock, ctx) => {
    const isOwner = utils.isOwner(ctx.senderId);
    const isGroupAdmin = ctx.isGroup ? await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId) : false;
    const sub = ctx.isGroup ? utils.getGroupSubscription(ctx.chatId) : null;
    const vip = sub ? NIVEIS_VIP[sub.nivel] : null;
    return {
      isOwner, isGroupAdmin, vip, sub, nivelNome: vip ? vip.nome : null,
      pAdmin: isOwner || (isGroupAdmin && !!vip?.admin), pBan: isOwner || (isGroupAdmin && !!vip?.ban),
      pPromote: isOwner || (isGroupAdmin && !!vip?.promote), pAnti: isOwner || (isGroupAdmin && !!vip?.anti),
      pRules: isOwner || (isGroupAdmin && !!vip?.rules), pBemv: isOwner || (isGroupAdmin && !!vip?.boasvindas),
      pSticker: isOwner || (isGroupAdmin && !!vip?.sticker)
    };
  },
  
  'menubtn': async (sock, ctx) => { await commands['menu'](sock, ctx); },
  
  'menu': async (sock, ctx) => {
    const nome = ctx.senderId.split('@')[0];
    const p = await commands._getPerms(sock, ctx);
    
    const linhas = [];
    linhas.push(`║ 🌐 GERAL                 \n║ 🧰 UTILITÁRIOS           ║\n║ 🔤 TEXTO                 ║\n║ 🌍 INFORMAÇÃO            \n║ 😄 DIVERSÃO              ║\n║ 🖼️ IMAGEM                ║\n║ 📲 MÍDIA                 ║`);
    
    if (p.pAdmin || p.pBan || p.pPromote) linhas.push(`║ 🛡️ PROTEÇÃO              \n║ 👮 ADMINISTRAÇÃO         ║`);
    if (p.pSticker) linhas.push(`║ 🎨 STICKERS              ║`);
    if (p.isOwner) linhas.push(`║ 👑 DONO                  ║`);
    
    const conteudo = linhas.join('\n');
    
    await enviarMenuKortex(sock, ctx, {
      titulo: 'MÓDULO PRINCIPAL',
      conteudo: conteudo,
      imagemChave: 'principal',
      rodape: `⚡ KORTEX CORE\n║ Prefixo: ${CONFIG.prefix}`
    });
  },
  
  'ajuda': async (sock, ctx) => { await commands['menu'](sock, ctx); },
  
  'cgeral': async (sock, ctx) => {
    const conteudo = `║ 🌐 MÓDULO GERAL          
║                          ║
║ 📌 BÁSICO                ║
║ .menu → categorias       ║
║ .ajuda → categorias      ║
║ .info → estado do bot    ║
║ .ping → velocidade       ║
║ .hora → hora de Maputo   ║
║ .meuid → IDs do sistema  ║
║                          ║
║ 💎 ASSINATURA            ║
║ .planos → ver planos     ║
║ .statusgrupo → estado    ║
║                          ║
║ 🏆 INDICAÇÕES            ║
║ .indicar [nº] → +1 ponto ║
║ .ranking → top 10        ║
║ .pontos → meus pontos    ║
║                          ║
║ 🌍 UTILITÁRIOS           ║
║ .traduzir [texto]        ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO GERAL', conteudo, imagemChave: 'geral' });
  },
  
  'cutil': async (sock, ctx) => {
    const conteudo = `║ 🧰 MÓDULO UTILITÁRIOS    ║
║                          
║ 🧮 CÁLCULOS              ║
║ .calcular [expr]         ║
║ .porcentagem [v] [%]     ║
║ .tabuada [n]             ║
║                          ║
║  GERADORES             ║
║ .senha [tamanho]         ║
║ .pin [tamanho]           ║
║ .aleatorio [min] [max]   ║
║ .caraoucoroa             ║
║ .sortear [a|b|c]         ║
║                          ║
║ 📏 CONVERSÕES            
║ .moeda [v] [de] [para]   ║
║ .idade [dd/mm/aaaa]      ║
║ .contar [texto]          ║
║                          ║
║ 🎙️ ÁUDIO                 ║
║ .transcrever (responde)  ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO UTILITÁRIOS', conteudo, imagemChave: 'utilitarios' });
  },
  
  'calcular': async (sock, ctx) => {
    const expr = ctx.args.join(' ');
    if (!expr) return sock.sendMessage(ctx.chatId, { text: 'Uso: .calcular [expressão]\nEx: .calcular 12*8+4' });
    try {
      const r = avaliarExpressao(expr);
      await sock.sendMessage(ctx.chatId, { text: `🧮 *${expr}*\n\n✅ Resultado: *${Math.round(r * 10000) / 10000}*` });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Expressão inválida.\nEx: .calcular (10+5)*2' }); }
  },
  
  'moeda': async (sock, ctx) => {
    const valor = parseFloat(ctx.args[0]) || 1;
    const de = (ctx.args[1] || 'USD').toUpperCase();
    const para = (ctx.args[2] || 'MZN').toUpperCase();
    const d = await getJSON(`https://open.er-api.com/v6/latest/${de}`);
    if (!d?.rates?.[para]) return sock.sendMessage(ctx.chatId, { text: `❌ Moeda não encontrada (${de}/${para}).` });
    const r = valor * d.rates[para];
    await sock.sendMessage(ctx.chatId, { text: ` *CONVERSÃO*\n\n${valor} ${de} = *${r.toFixed(2)} ${para}*\n📅 ${d.time_last_update_utc || ''}` });
  },
  
  'senha': async (sock, ctx) => {
    const n = Math.min(Math.max(parseInt(ctx.args[0]) || 12, 6), 64);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&';
    let s = ''; const b = crypto.randomBytes(n);
    for (let i = 0; i < n; i++) s += chars[b[i] % chars.length];
    await sock.sendMessage(ctx.chatId, { text: `🔐 *Senha gerada:*\n\n${s}\n\n⚠️ Guarda-a em segurança!` });
  },
  
  'pin': async (sock, ctx) => {
    const n = Math.min(Math.max(parseInt(ctx.args[0]) || 4, 4), 10);
    let s = ''; const b = crypto.randomBytes(n);
    for (let i = 0; i < n; i++) s += b[i] % 10;
    await sock.sendMessage(ctx.chatId, { text: `🔢 *PIN gerado:* ${s}` });
  },
  
  'aleatorio': async (sock, ctx) => {
    const min = parseInt(ctx.args[0]) || 1, max = parseInt(ctx.args[1]) || 100;
    const r = Math.floor(Math.random() * (max - min + 1)) + min;
    await sock.sendMessage(ctx.chatId, { text: `🎲 Número aleatório (${min}–${max}): *${r}*` });
  },
  
  'idade': async (sock, ctx) => {
    const m = (ctx.args[0] || '').match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!m) return sock.sendMessage(ctx.chatId, { text: 'Uso: .idade [dd/mm/aaaa]' });
    const nasc = new Date(+m[3], +m[2] - 1, +m[1]);
    const hoje = new Date();
    let anos = hoje.getFullYear() - nasc.getFullYear();
    const dif = new Date(hoje - nasc);
    if (dif.getUTCMonth() < 0 || (dif.getUTCMonth() === 0 && dif.getUTCDate() < 0)) anos--;
    const dias = Math.floor((hoje - nasc) / 86400000);
    await sock.sendMessage(ctx.chatId, { text: `🎂 *Idade:* ${anos} anos\n📅 (${dias.toLocaleString('pt-PT')} dias vividos)` });
  },
  
  'tabuada': async (sock, ctx) => {
    const n = parseInt(ctx.args[0]) || 1;
    let t = `✖️ *TABUADA DO ${n}*\n\n`;
    for (let i = 1; i <= 10; i++) t += `${n} x ${i} = ${n * i}\n`;
    await sock.sendMessage(ctx.chatId, { text: t });
  },
  
  'porcentagem': async (sock, ctx) => {
    const v = parseFloat(ctx.args[0]), p = parseFloat(ctx.args[1]);
    if (isNaN(v) || isNaN(p)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .porcentagem [valor] [percentagem]' });
    await sock.sendMessage(ctx.chatId, { text: `％ ${p}% de ${v} = *${(v * p / 100).toFixed(2)}*` });
  },
  
  'contar': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .contar [texto]' });
    await sock.sendMessage(ctx.chatId, { text: ` *Contagem*\n┃ Letras: ${t.replace(/\s/g, '').length}\n┃ Palavras: ${t.trim().split(/\s+/).length}\n┃ Linhas: ${t.split('\n').length}` });
  },
  
  'sortear': async (sock, ctx) => {
    const opts = ctx.args.join(' ').split('|').map(s => s.trim()).filter(Boolean);
    if (opts.length < 2) return sock.sendMessage(ctx.chatId, { text: 'Uso: .sortear [opção1|opção2|...]' });
    const r = opts[Math.floor(Math.random() * opts.length)];
    await sock.sendMessage(ctx.chatId, { text: `🎯 *Sorteio:*\n\n🥇 ${r}` });
  },
  
  'caraoucoroa': async (sock, ctx) => {
    const r = Math.random() < 0.5 ? 'CARA ' : 'COROA 👑';
    await sock.sendMessage(ctx.chatId, { text: ` A moeda girou... e deu:\n\n*${r}*` });
  },
  
  'transcrever': async (sock, ctx) => {
    const q = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!q?.audioMessage) return sock.sendMessage(ctx.chatId, { text: '🎙️ Responde a um áudio/nota de voz com .transcrever' });
    try {
      await utils.reagir(sock, ctx.msg, '⏳');
      const buf = await downloadMediaMessage({ message: q }, 'buffer', {});
      if (buf.length > 25 * 1024 * 1024) return sock.sendMessage(ctx.chatId, { text: '❌ Áudio demasiado grande (máx. 25MB).' });
      const tmpIn = path.join(os.tmpdir(), `kortex_tr_${Date.now()}.bin`);
      const tmpOut = path.join(os.tmpdir(), `kortex_tr_${Date.now()}.mp3`);
      fs.writeFileSync(tmpIn, buf);
      await new Promise((res, rej) => ffmpeg(tmpIn).toFormat('mp3').save(tmpOut).on('end', res).on('error', rej));
      const r = await comFallbackGroq(client => client.audio.transcriptions.create({ file: fs.createReadStream(tmpOut), model: 'whisper-large-v3' }));
      try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {}
      await sock.sendMessage(ctx.chatId, { text: `🎙️ *Transcrição:*\n\n"${r.text || '…'}"` });
    } catch (e) { console.warn('transcrever:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui transcrever este áudio.' }); }
  },
  
  'ctexto': async (sock, ctx) => {
    const conteudo = `║ 🔤 MÓDULO TEXTO          ║
║                          ║
║ 🏛️ .romanos [número]     ║
║  .significado [palavra]║
║ 📖 .sinonimo [palavra]   ║
║ 📖 .antonimo [palavra]   ║
║ 👾 .leet [texto]         ║
║ 🌸 .vaporwave [texto]    ║
║ ✍️ .gerarnome            ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO TEXTO', conteudo, imagemChave: 'texto' });
  },
  
  'romanos': async (sock, ctx) => {
    let n = parseInt(ctx.args[0]);
    if (isNaN(n) || n < 1 || n > 3999) return sock.sendMessage(ctx.chatId, { text: 'Uso: .romanos [1-3999]' });
    const T = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
    let r = '';
    for (const [v, s] of T) while (n >= v) { r += s; n -= v; }
    await sock.sendMessage(ctx.chatId, { text: `🏛️ ${ctx.args[0]} = *${r}*` });
  },
  
  'significado': async (sock, ctx) => {
    const w = ctx.args.join(' ').trim();
    if (!w) return sock.sendMessage(ctx.chatId, { text: 'Uso: .significado [palavra]' });
    const d = await getJSON(`https://api.dicionarioaberto.net/word/${encodeURIComponent(w)}`);
    if (!d?.length) return sock.sendMessage(ctx.chatId, { text: `❌ Palavra não encontrada: "${w}"` });
    const texto = (d[0].text || '').replace(/<[^>]+>/g, '').substring(0, 600);
    await sock.sendMessage(ctx.chatId, { text: `📖 *${w}*\n\n${texto || 'Sem definição.'}` });
  },
  
  'sinonimo': async (sock, ctx) => {
    const w = ctx.args.join(' ').trim();
    if (!w) return sock.sendMessage(ctx.chatId, { text: 'Uso: .sinonimo [palavra]' });
    const r = await perguntarGroq(`Dá 5 sinónimos da palavra "${w}" em português, separados por vírgulas, sem explicações.`);
    await sock.sendMessage(ctx.chatId, { text: r ? `📖 *Sinónimos de ${w}:*\n${r}` : '❌ Erro ao buscar sinónimos.' });
  },
  
  'antonimo': async (sock, ctx) => {
    const w = ctx.args.join(' ').trim();
    if (!w) return sock.sendMessage(ctx.chatId, { text: 'Uso: .antonimo [palavra]' });
    const r = await perguntarGroq(`Dá 5 antónimos da palavra "${w}" em português, separados por vírgulas, sem explicações.`);
    await sock.sendMessage(ctx.chatId, { text: r ? `📖 *Antónimos de ${w}:*\n${r}` : '❌ Erro ao buscar antónimos.' });
  },
  
  'leet': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .leet [texto]' });
    const M = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', g: '9', b: '8' };
    await sock.sendMessage(ctx.chatId, { text: `👾 ${t.toLowerCase().split('').map(c => M[c] || c).join('')}` });
  },
  
  'vaporwave': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .vaporwave [texto]' });
    await sock.sendMessage(ctx.chatId, { text: `🌸 ${t.split('').map(c => c === ' ' ? '\u3000' : (c.charCodeAt(0) > 32 && c.charCodeAt(0) < 127 ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c)).join('')}` });
  },
  
  'gerarnome': async (sock, ctx) => {
    const A = ['Sha', 'Ka', 'Zu', 'Ni', 'Ra', 'Lu', 'Tha', 'Ve', 'Mo', 'Xi'], B = ['dir', 'mir', 'zon', 'kel', 'ris', 'nan', 'tor', 'vil', 'zan', 'qui'];
    const n = A[Math.floor(Math.random() * A.length)] + B[Math.floor(Math.random() * B.length)] + B[Math.floor(Math.random() * B.length)];
    await sock.sendMessage(ctx.chatId, { text: `✍️ *Nome gerado:* ${n}` });
  },
  
  'cinfo': async (sock, ctx) => {
    const conteudo = `║ 🌍 MÓDULO INFORMAÇÃO     ║
║                          ║
║ 📚 .wiki [tema]          ║
║ 🗺️ .pais [país]          ║
║ 🏛️ .capital [país]       ║
║  .hoje                 ║
║  .noticias [tema]      ║
║ 🎬 .filme [título]       ║
║ 📺 .serie [título]       ║
║ 📖 .manga [título]       ║
║ 🎭 .personagem [nome]    ║
║  .musica [nome]        ║
║                          ║
║ 💰 COTAÇÕES              ║
║ .dolar / .euro / .ouro   ║
║ .moeda [v] [de] [para]   ║
║                          ║
║ ⚽ FUTEBOL                
║ .futebol [equipa]        
║ .tabela [campeonato]     `;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO INFORMAÇÃO', conteudo, imagemChave: 'informacao' });
  },
  
  'wiki': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .wiki [tema]' });
    const d = await getJSON(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`);
    if (!d?.extract) return sock.sendMessage(ctx.chatId, { text: '❌ Nada encontrado na Wikipédia.' });
    await sock.sendMessage(ctx.chatId, { text: `📚 *${d.title}*\n\n${d.extract}\n\n🔗 ${d.content_urls?.desktop?.page || ''}` });
  },
  
  'pais': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .pais [país]' });
    const d = await getJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(t)}?fields=name,capital,population,currencies,flags,region`);
    if (!d?.length) return sock.sendMessage(ctx.chatId, { text: '❌ País não encontrado.' });
    const p = d[0];
    const moedas = Object.values(p.currencies || {}).map(c => `${c.name} (${c.symbol || ''})`).join(', ');
    await sock.sendMessage(ctx.chatId, { image: { url: p.flags?.png }, caption: `🗺️ *${p.name?.common}*\n🏛️ Capital: ${p.capital?.[0] || '—'}\n👥 População: ${(p.population || 0).toLocaleString('pt-PT')}\n Região: ${p.region || '—'}\n💱 Moeda: ${moedas || '—'}` });
  },
  
  'capital': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .capital [país]' });
    const d = await getJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(t)}?fields=name,capital`);
    if (!d?.length) return sock.sendMessage(ctx.chatId, { text: ' País não encontrado.' });
    await sock.sendMessage(ctx.chatId, { text: `🏛️ Capital de *${d[0].name?.common}*: *${d[0].capital?.[0] || '—'}*` });
  },
  
  'hoje': async (sock, ctx) => {
    const agora = new Date();
    const mm = String(agora.getMonth() + 1).padStart(2, '0'), dd = String(agora.getDate()).padStart(2, '0');
    const d = await getJSON(`https://pt.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
    if (!d?.events?.length) return sock.sendMessage(ctx.chatId, { text: ' Sem eventos hoje.' });
    let t = `📅 *ACONTECEU NESTE DIA*\n\n`;
    d.events.slice(0, 3).forEach(e => { t += `• *${e.year}* — ${e.text}\n\n`; });
    await sock.sendMessage(ctx.chatId, { text: t });
  },
  
  'noticias': async (sock, ctx) => {
    const q = ctx.args.join(' ');
    const url = q ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-PT&gl=MZ&ceid=MZ:pt-PT` : `https://news.google.com/rss?hl=pt-PT&gl=MZ&ceid=MZ:pt-PT`;
    let xml = null;
    try { xml = (await axios.get(url, { timeout: 15000 })).data; } catch {}
    if (!xml) return sock.sendMessage(ctx.chatId, { text: '❌ Erro ao buscar notícias.' });
    const itens = [...xml.matchAll(/<item>\s*<title>([^<]+)<\/title>\s*<link>([^<]+)<\/link>/g)].slice(0, 5);
    if (!itens.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhuma notícia encontrada.' });
    let t = `📰 *NOTÍCIAS*${q ? ` — ${q}` : ''}\n\n`;
    itens.forEach((m, i) => { t += `${i + 1}. ${m[1]}\n🔗 ${m[2]}\n\n`; });
    await sock.sendMessage(ctx.chatId, { text: t });
  },
  
  'filme': async (sock, ctx) => { await omdbBusca(sock, ctx, 'movie'); },
  'serie': async (sock, ctx) => { await omdbBusca(sock, ctx, 'series'); },
  
  'manga': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .manga [título]' });
    const d = await getJSON(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(t)}&limit=1`);
    const m = d?.data?.[0];
    if (!m) return sock.sendMessage(ctx.chatId, { text: '❌ Manga não encontrado.' });
    await sock.sendMessage(ctx.chatId, { image: { url: m.images?.jpg?.image_url }, caption: `📖 *${m.title}*\n✍️ ${m.authors?.[0]?.name || '—'}\n📚 Capítulos: ${m.chapters || '?'}\n⭐ ${m.score || '?'}\n${m.status || '—'}\n\n${(m.synopsis || '').substring(0, 300)}...` });
  },
  
  'personagem': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .personagem [nome]' });
    const d = await getJSON(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(t)}&limit=1`);
    const c = d?.data?.[0];
    if (!c) return sock.sendMessage(ctx.chatId, { text: '❌ Personagem não encontrada.' });
    await sock.sendMessage(ctx.chatId, { image: { url: c.images?.jpg?.image_url }, caption: `🎭 *${c.name}*\n❤️ ${c.favorites || 0} fãs\n🔗 ${c.url}` });
  },
  
  'musica': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .musica [nome]' });
    const d = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(t)}&media=music&limit=1`);
    const m = d?.results?.[0];
    if (!m) return sock.sendMessage(ctx.chatId, { text: '❌ Música não encontrada.' });
    const dur = m.trackTimeMillis ? `${Math.floor(m.trackTimeMillis / 60000)}:${String(Math.floor(m.trackTimeMillis / 1000) % 60).padStart(2, '0')}` : '—';
    await sock.sendMessage(ctx.chatId, { image: { url: m.artworkUrl100 }, caption: `🎵 *${m.trackName}*\n👤 ${m.artistName}\n💿 ${m.collectionName || '—'}\n📅 ${(m.releaseDate || '').substring(0, 4)}\n️ ${dur}\n🔗 ${m.trackViewUrl || ''}` });
  },
  
  'ouro': async (sock, ctx) => {
    const d = await getJSON('https://api.gold-api.com/price/XAU');
    if (!d?.price) return sock.sendMessage(ctx.chatId, { text: '❌ Não consegui obter o preço do ouro.' });
    await sock.sendMessage(ctx.chatId, { text: `🥇 *Ouro (XAU)*\n💰 ${Number(d.price).toFixed(2)} USD/oz` });
  },
  
  'futebol': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .futebol [equipa]' });
    const d = await getJSON(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(t)}`);
    const team = d?.teams?.[0];
    if (!team) return sock.sendMessage(ctx.chatId, { text: '❌ Equipa não encontrada.' });
    const ev = await getJSON(`https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${team.idTeam}`);
    let txt = `⚽ *${team.strTeam}*\n\n`;
    (ev?.events || []).slice(0, 3).forEach(e => { txt += `🆚 ${e.strHomeTeam} x ${e.strAwayTeam}\n📅 ${e.dateEvent || '—'}\n\n`; });
    if (!(ev?.events || []).length) txt += 'Sem próximos jogos registados.';
    await sock.sendMessage(ctx.chatId, { text: txt });
  },
  
  'tabela': async (sock, ctx) => {
    const t = ctx.args.join(' ');
    if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tabela [campeonato]\nEx: .tabela Premier League' });
    const d = await getJSON(`https://www.thesportsdb.com/api/v1/json/3/search_all_leagues.php?l=${encodeURIComponent(t)}`);
    const lg = d?.leagues?.[0];
    if (!lg) return sock.sendMessage(ctx.chatId, { text: '❌ Campeonato não encontrado.' });
    const season = ctx.args[ctx.args.length - 1]?.match(/^\d{4}-\d{4}$/)?.[0] || '2025-2026';
    const tb = await getJSON(`https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${lg.idLeague}&s=${season}`);
    if (!tb?.table?.length) return sock.sendMessage(ctx.chatId, { text: `❌ Sem tabela para ${lg.strLeague} (${season}).` });
    let txt = `🏆 *${lg.strLeague}* (${season})\n\n`;
    tb.table.slice(0, 10).forEach(r => { txt += `${r.intRank}. ${r.strTeam} — ${r.intPoints} pts\n`; });
    await sock.sendMessage(ctx.chatId, { text: txt });
  },'cdiv': async (sock, ctx) => {
    const conteudo = `║ 😄 MÓDULO DIVERSÃO       ║
║                          ║
║  .charada              ║
║ 💬 .frase                ║
║ ⭕ .jogodavelha @user    ║
║   .jogodavelha [1-9]     ║
║   .jogodavelha off       ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO DIVERSÃO', conteudo, imagemChave: 'diversao' });
  },
  
  'charada': async (sock, ctx) => {
    const CHARADAS = [
      { p: 'O que é que tem cabeça e dente mas não morde?', r: 'O alho' },
      { p: 'Quanto mais tira, maior fica. O que é?', r: 'O buraco' },
      { p: 'O que é que corre mas não anda?', r: 'A água' },
      { p: 'Tem asas mas não voa, tem bico mas não belisca?', r: 'O bule' },
      { p: 'O que é que enche uma casa mas não enche uma mão?', r: 'O botão' },
      { p: 'Surdo e mudo, mas conta tudo?', r: 'O livro' },
      { p: 'O que é que tem dentes mas não come?', r: 'O pente' },
      { p: 'Passa diante do sol e não faz sombra?', r: 'O vento' }
    ];
    const c = CHARADAS[Math.floor(Math.random() * CHARADAS.length)];
    await sock.sendMessage(ctx.chatId, { text: `🧩 *CHARADA*\n\n${c.p}\n\n🤔 _(resposta: ${c.r})_` });
  },
  
  'frase': async (sock, ctx) => {
    const FRASES = [
      'A disciplina é a ponte entre metas e resultados. 🌉',
      'Não espere por motivação; comece e ela aparece. 💪',
      'O sucesso é a soma de pequenos esforços repetidos dia após dia. 🔁',
      'Quem quer fazer algo encontra um meio; quem não quer encontra uma desculpa. 🎯',
      'A melhor maneira de prever o futuro é criá-lo. ',
      'Cair é permitido; levantar é obrigatório. 🧗',
      'O conhecimento é o único tesouro que ninguém te rouba. ',
      'Fé é dar o primeiro passo mesmo sem ver a escada toda. '
    ];
    await sock.sendMessage(ctx.chatId, { text: `💬 ${FRASES[Math.floor(Math.random() * FRASES.length)]}` });
  },
  
  'jogodavelha': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Joga num grupo.' });
    const arg = ctx.args[0] || '';
    const g = jogosVelha.get(ctx.chatId);
    
    if (arg === 'off') {
      if (!g) return sock.sendMessage(ctx.chatId, { text: 'Sem jogo activo.' });
      jogosVelha.delete(ctx.chatId);
      return sock.sendMessage(ctx.chatId, { text: '🛑 Jogo da velha cancelado.' });
    }
    
    if (!g) {
      const alvo = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
      if (!alvo) return sock.sendMessage(ctx.chatId, { text: '⭕ *JOGO DA VELHA*\n\nUso:\n.jogodavelha @user → desafiar\n.jogodavelha [1-9] → jogada\n.jogodavelha off → cancelar' });
      if (alvo === ctx.senderId) return sock.sendMessage(ctx.chatId, { text: '❌ Não podes jogar contigo mesmo.' });
      
      const desafioId = `dv_${ctx.chatId}_${Date.now()}`;
      desafiosVelha.set(desafioId, {
        desafiante: ctx.senderId,
        desafiado: alvo,
        chatId: ctx.chatId,
        criadoEm: Date.now(),
        expiraEm: Date.now() + TEMPO_EXPIRACAO_DESAFIO,
        estado: 'pendente'
      });
      
      await sock.sendMessage(ctx.chatId, {
        text: `🎮 *DESAFIO — JOGO DA VELHA*\n\n Kortex está preparando o desafio...\n\n@${ctx.senderId.split('@')[0]} desafiou @${alvo.split('@')[0]}!\n\n${velhaRender(Array(9).fill(null))}\n\n✅ Aceitar: .aceitardesafio\n Recusar: .recusardesafio\n\n⏳ Expira em 60 segundos.`,
        mentions: [ctx.senderId, alvo]
      });
      return;
    }
    
    if (Date.now() - g.ts > 5 * 60000) { jogosVelha.delete(ctx.chatId); return sock.sendMessage(ctx.chatId, { text: ' Jogo expirado por inactividade.' }); }
    const pos = parseInt(arg);
    if (!pos || pos < 1 || pos > 9) return sock.sendMessage(ctx.chatId, { text: 'Usa .jogodavelha [1-9]' });
    if (!g.players.includes(ctx.senderId)) return sock.sendMessage(ctx.chatId, { text: '❌ Não estás neste jogo.' });
    if (g.players[g.vez] !== ctx.senderId) return sock.sendMessage(ctx.chatId, { text: ` Não é a tua vez! Vez de @${g.players[g.vez].split('@')[0]}`, mentions: [g.players[g.vez]] });
    if (g.board[pos - 1]) return sock.sendMessage(ctx.chatId, { text: '❌ Casa ocupada!' });
    
    g.board[pos - 1] = g.vez === 0 ? 'X' : 'O';
    g.vez = 1 - g.vez; g.ts = Date.now();
    const res = velhaVencedor(g.board);
    
    if (res) {
      jogosVelha.delete(ctx.chatId);
      const msg = res === 'empate' ? ' EMPATE! Bom jogo!' : `🏆 *VITÓRIA de ${res === 'X' ? '❌' : '⭕'} @${g.players[res === 'X' ? 0 : 1].split('@')[0]}!*`;
      return sock.sendMessage(ctx.chatId, { text: `⭕ *FIM DE JOGO*\n\n${velhaRender(g.board)}\n\n${msg}\n\n⚡ KORTEX SECURITY CORE`, mentions: g.players });
    }
    
    await sock.sendMessage(ctx.chatId, { text: `⭕ *JOGO DA VELHA*\n\n${velhaRender(g.board)}\n\nVez de ${g.vez === 0 ? '❌' : '⭕'} @${g.players[g.vez].split('@')[0]}`, mentions: [g.players[g.vez]] });
  },
  
  'aceitardesafio': async (sock, ctx) => {
    if (!ctx.isGroup) return;
    for (const [id, des] of desafiosVelha) {
      if (des.desafiado === ctx.senderId && des.estado === 'pendente' && Date.now() < des.expiraEm) {
        des.estado = 'aceite';
        jogosVelha.set(des.chatId, {
          board: Array(9).fill(null),
          players: [des.desafiante, des.desafiado],
          vez: 0,
          ts: Date.now()
        });
        desafiosVelha.delete(id);
        await sock.sendMessage(ctx.chatId, {
          text: ` *DESAFIO ACEITE!*\n\n@${des.desafiante.split('@')[0]} vs @${des.desafiado.split('@')[0]}\n\n${velhaRender(Array(9).fill(null))}\n\nVez de ❌ @${des.desafiante.split('@')[0]} — usa jogodavelha [1-9]`,
          mentions: [des.desafiante, des.desafiado]
        });
        return;
      }
    }
    await sock.sendMessage(ctx.chatId, { text: ' Nenhum desafio pendente para ti.' });
  },
  
  'recusardesafio': async (sock, ctx) => {
    if (!ctx.isGroup) return;
    for (const [id, des] of desafiosVelha) {
      if (des.desafiado === ctx.senderId && des.estado === 'pendente') {
        des.estado = 'recusado';
        desafiosVelha.delete(id);
        await sock.sendMessage(ctx.chatId, {
          text: `❌ @${ctx.senderId.split('@')[0]} recusou o desafio de @${des.desafiante.split('@')[0]}.`,
          mentions: [ctx.senderId, des.desafiante]
        });
        return;
      }
    }
    await sock.sendMessage(ctx.chatId, { text: '❌ Nenhum desafio pendente para ti.' });
  },
  
  'cimg': async (sock, ctx) => {
    const conteudo = `║ 🖼️ MÓDULO IMAGEM         ║
║                          ║
║ 🖼️ .converterimagem      ║
║ 🥷 .roubarsticker        ║
║ ⭕ .circular             ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO IMAGEM', conteudo, imagemChave: 'imagem' });
  },
  
  'converterimagem': async (sock, ctx) => {
    const q = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!q?.stickerMessage) return sock.sendMessage(ctx.chatId, { text: '❌ Responde a um sticker com .converterimagem' });
    try {
      const buf = await downloadMediaMessage({ message: q }, 'buffer', {});
      const png = await sharp(buf).png().toBuffer();
      await sock.sendMessage(ctx.chatId, { image: png, caption: '🖼️ Sticker → imagem' });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro na conversão.' }); }
  },
  
  'roubarsticker': async (sock, ctx) => {
    const q = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!q?.stickerMessage) return sock.sendMessage(ctx.chatId, { text: '❌ Responde a um sticker com .roubarsticker' });
    try {
      const buf = await downloadMediaMessage({ message: q }, 'buffer', {});
      const final = await utils.adicionarMetadadosSticker(buf);
      await sock.sendMessage(ctx.chatId, { sticker: final });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao roubar sticker.' }); }
  },
  
  'circular': async (sock, ctx) => {
    const q = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const media = q?.imageMessage || q?.stickerMessage || ctx.msg.message?.imageMessage;
    if (!media) return sock.sendMessage(ctx.chatId, { text: '❌ Responde a uma imagem/sticker com .circular' });
    try {
      const mediaMsg = q ? { message: q } : ctx.msg;
      const buf = await downloadMediaMessage(mediaMsg, 'buffer', {});
      const mask = Buffer.from(`<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>`);
      const img = await sharp(buf).resize(512, 512, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
      await sock.sendMessage(ctx.chatId, { image: img, caption: '⭕ Recorte circular' });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro no recorte.' }); }
  },
  
  'cadmin': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAdmin && !p.pBan && !p.pPromote) throw new PermissaoNegada();
    
    let conteudo = `║ 👮 MÓDULO ADMINISTRAÇÃO  ║
║                          ║`;
    
    if (p.pAdmin) {
      conteudo += `
║ 🏟️ GRUPO                 ║
║ .marcartodos [msg]       ║
║ .fechar / .abrir         ║
║ .link / .idgrupo         ║
║ .apagar (responde)       ║
║ .nome [novo nome]        ║
║ .foto (responde img)     ║
║ .criargrupo [nome]       ║
║                          ║
║ 📅 AGENDAMENTO           ║
║ .agendar HH:MM [msg]     ║
║ .agendar ls              ║
║ .agendar del [id]        ║`;
    }
    
    if (p.pBan) {
      conteudo += `
║ 🔨 MODERAÇÃO             ║
║ .banir @user             ║
║ .listarbanidos           ║
║ ⚠️ .advertir @user       ║
║ ⚠️ .advertencias @user   ║
║ ✅ .removeradvertencia   ║
║ 🔇 .silenciar @user [min]║
║ 🔊 .dessilenciar @user   ║`;
    }
    
    if (p.pPromote) {
      conteudo += `
║ 👑 CARGOS                ║
║ .promover @user          ║
║ .rebaixar @user          ║`;
    }
    
    conteudo += `
║                          ║
║ 🚫 COMANDOS DO GRUPO     ║
║ .desativarcomando .cmd   ║
║ .ativarcomando .cmd      ║
║ .listardesativados       ║`;
    
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO ADMINISTRAÇÃO', conteudo, imagemChave: 'administracao' });
  },
  
  'marcartodos': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const meta = await getMetadataCached(sock, ctx.chatId);
    await sock.sendMessage(ctx.chatId, { text: ` AVISO GERAL\n\n${ctx.args.join(' ') || 'Atenção!'}`, mentions: meta.participants.map(p => p.id) });
  },
  
  'fechar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'announcement');
    registrarAcao(ctx.chatId, 'Grupo fechado');
    await sock.sendMessage(ctx.chatId, { text: ` GRUPO FECHADO\nSó admins falam. 👮 @${ctx.senderId.split('@')[0]}`, mentions: [ctx.senderId] });
  },
  
  'abrir': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'not_announcement');
    registrarAcao(ctx.chatId, 'Grupo aberto');
    await sock.sendMessage(ctx.chatId, { text: `🔓 GRUPO ABERTO\nTodos podem falar! 🗣️` });
  },
  
  'link': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    try { const code = await sock.groupInviteCode(ctx.chatId); await sock.sendMessage(ctx.chatId, { text: `🔗 https://chat.whatsapp.com/${code}` }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao obter link.' }); }
  },
  
  'idgrupo': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.sendMessage(ctx.chatId, { text: ` ID DO GRUPO\n\n${ctx.chatId}` });
  },
  
  'apagar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo;
    if (!quoted?.stanzaId) return sock.sendMessage(ctx.chatId, { text: '❌ Responde a uma mensagem com .apagar' });
    try { await sock.sendMessage(ctx.chatId, { delete: { remoteJid: ctx.chatId, id: quoted.stanzaId, participant: quoted.participant } }); await utils.reagir(sock, ctx.msg, '✅'); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui apagar.' }); }
  },
  
  'banir': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: '❌ Não é possível banir o dono.' });
    try {
      await sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove');
      if (!db.grupos.banidos.has(ctx.chatId)) db.grupos.banidos.set(ctx.chatId, []);
      db.grupos.banidos.get(ctx.chatId).push({ id: target, data: new Date().toLocaleDateString('pt-PT') });
      salvarDados();
      registrarAcao(ctx.chatId, `Ban: @${target.split('@')[0]}`);
      await sock.sendMessage(ctx.chatId, { text: ` BANIDO!\n👤 @${target.split('@')[0]}\n👮 Por: @${ctx.senderId.split('@')[0]}`, mentions: [target, ctx.senderId] });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao banir.' }); }
  },
  
  'listarbanidos': async (sock, ctx) => {
    const lista = db.grupos.banidos.get(ctx.chatId) || [];
    if (!lista.length) return sock.sendMessage(ctx.chatId, { text: '📝 Sem banidos.' });
    await sock.sendMessage(ctx.chatId, { text: `🚫 BANIDOS\n${lista.map(b => `@${b.id.split('@')[0]} - ${b.data}`).join('\n')}`, mentions: lista.map(b => b.id) });
  },
  
  'promover': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    try { await sock.groupParticipantsUpdate(ctx.chatId, [target], 'promote'); await sock.sendMessage(ctx.chatId, { text: `👑 @${target.split('@')[0]} agora é admin!`, mentions: [target] }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao promover.' }); }
  },
  
  'rebaixar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    try { await sock.groupParticipantsUpdate(ctx.chatId, [target], 'demote'); await sock.sendMessage(ctx.chatId, { text: `⬇️ @${target.split('@')[0]} deixou de ser admin.`, mentions: [target] }); }
    catch { await sock.sendMessage(ctx.chatId, { text: ' Erro ao rebaixar.' }); }
  },
  
  'advertir': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: ' Menciona alguém.' });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: '❌ Não posso advertir o dono.' });
    if (!db.warns.has(ctx.chatId)) db.warns.set(ctx.chatId, new Map());
    const w = db.warns.get(ctx.chatId);
    const n = (w.get(target) || 0) + 1;
    w.set(target, n); salvarDados();
    if (n >= 3) {
      w.delete(target); salvarDados();
      try { await sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove'); await sock.sendMessage(ctx.chatId, { text: `🔨 @${target.split('@')[0]} atingiu 3 advertências e foi removido.`, mentions: [target] }); }
      catch { await sock.sendMessage(ctx.chatId, { text: `⚠️ 3 advertências! Não consegui remover @${target.split('@')[0]}.`, mentions: [target] }); }
      return;
    }
    await sock.sendMessage(ctx.chatId, { text: `⚠️ ADVERTÊNCIA ${n}/3\n@${target.split('@')[0]}`, mentions: [target] });
  },
  
  'advertencias': async (sock, ctx) => {
    if (!ctx.isGroup) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0] || ctx.senderId;
    const n = db.warns.get(ctx.chatId)?.get(target) || 0;
    await sock.sendMessage(ctx.chatId, { text: `📋 @${target.split('@')[0]} tem *${n}/3* advertências.`, mentions: [target] });
  },
  
  'removeradvertencia': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    const w = db.warns.get(ctx.chatId);
    if (!w || !w.has(target)) return sock.sendMessage(ctx.chatId, { text: '⚠️ Sem advertências.' });
    w.delete(target); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Advertências de @${target.split('@')[0]} limpas.`, mentions: [target] });
  },
  
  'silenciar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: '❌ Não posso silenciar o dono.' });
    const ultimo = ctx.args[ctx.args.length - 1];
    const min = /^\d+$/.test(ultimo || '') ? parseInt(ultimo) : 10;
    if (!db.mutados.has(ctx.chatId)) db.mutados.set(ctx.chatId, new Map());
    db.mutados.get(ctx.chatId).set(target, Date.now() + min * 60000);
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: ` @${target.split('@')[0]} silenciado por ${min} min.\n(as mensagens dele serão apagadas)`, mentions: [target] });
  },
  
  'dessilenciar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
    db.mutados.get(ctx.chatId)?.delete(target); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🔊 @${target.split('@')[0]} dessilenciado.`, mentions: [target] });
  },
  
  'nome': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const novo = ctx.args.join(' ');
    if (!novo) return sock.sendMessage(ctx.chatId, { text: 'Uso: .nome [novo nome do grupo]' });
    try { await sock.groupUpdateSubject(ctx.chatId, novo); await sock.sendMessage(ctx.chatId, { text: `✅ Nome do grupo: *${novo}*` }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao mudar o nome.' }); }
  },
  
  'foto': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const q = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const mediaMsg = q?.imageMessage ? { message: q } : (ctx.msg.message?.imageMessage ? ctx.msg : null);
    if (!mediaMsg) return sock.sendMessage(ctx.chatId, { text: '❌ Envia ou responde a uma imagem com .foto' });
    try {
      const buf = await downloadMediaMessage(mediaMsg, 'buffer', {});
      await sock.updateProfilePicture(ctx.chatId, buf);
      await sock.sendMessage(ctx.chatId, { text: '✅ Foto do grupo actualizada!' });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao mudar a foto.' }); }
  },
  
  'criargrupo': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    const nome = ctx.args.join(' ') || 'Grupo Kortex';
    try {
      let g;
      try { g = await sock.groupCreate(nome, [ctx.senderId]); } catch { g = await sock.groupCreate(nome, { participants: [ctx.senderId] }); }
      const code = await sock.groupInviteCode(g.id);
      await sock.sendMessage(ctx.chatId, { text: `🏟️ Grupo *${nome}* criado!\n🔗 https://chat.whatsapp.com/${code}` });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao criar grupo.' }); }
  },
  
  'agendar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    if (ctx.args.length < 1) return sock.sendMessage(ctx.chatId, { text: '📅 Uso: .agendar HH:MM [mensagem]\nEx: .agendar 14:30 Reunião em 5 minutos!\n.agendar ls → listar\n.agendar del [id] → remover' });
    const sub = ctx.args[0]?.toLowerCase();
    if (sub === 'ls' || sub === 'list') {
      const ags = agendamentos.get(ctx.chatId) || [];
      if (!ags.length) return sock.sendMessage(ctx.chatId, { text: '📅 Sem agendamentos.' });
      let t = `📅 *AGENDAMENTOS*\n\n`;
      ags.forEach(a => { t += `#${a.id} — ${a.hora}\n${a.texto.substring(0, 60)}\n\n`; });
      return sock.sendMessage(ctx.chatId, { text: t });
    }
    if (sub === 'del' || sub === 'remover') {
      const id = parseInt(ctx.args[1]);
      const ags = agendamentos.get(ctx.chatId) || [];
      const idx = ags.findIndex(a => a.id === id);
      if (idx === -1) return sock.sendMessage(ctx.chatId, { text: '❌ ID não encontrado.' });
      ags.splice(idx, 1); salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `✅ Agendamento #${id} removido.` });
    }
    const m = ctx.args[0].match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return sock.sendMessage(ctx.chatId, { text: '❌ Formato de hora inválido. Use HH:MM (ex: 14:30)' });
    const h = parseInt(m[1]), min = parseInt(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return sock.sendMessage(ctx.chatId, { text: '❌ Hora inválida.' });
    const texto = ctx.args.slice(1).join(' ');
    if (!texto) return sock.sendMessage(ctx.chatId, { text: '❌ Indica a mensagem a enviar.' });
    if (!agendamentos.has(ctx.chatId)) agendamentos.set(ctx.chatId, []);
    const ags = agendamentos.get(ctx.chatId);
    const id = Date.now() % 100000;
    ags.push({ id, hora: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, texto, criador: ctx.senderId });
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `📅 *AGENDADO!*\n\n Hora: ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}\n💬 ${texto.substring(0, 100)}\n\n #${id}\nVer: .agendar ls` });
  },
  
  'desativarcomando': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const comando = ctx.args[0]?.toLowerCase();
    if (!comando || !comando.startsWith('.')) return sock.sendMessage(ctx.chatId, { text: 'Uso: .desativarcomando [.cmd]' });
    const cmdLimpo = comando.replace('.', '');
    if (!commands[cmdLimpo]) return sock.sendMessage(ctx.chatId, { text: ` Comando ".${cmdLimpo}" não existe.` });
    if (!db.grupos.comandosDesativados.has(ctx.chatId)) db.grupos.comandosDesativados.set(ctx.chatId, new Set());
    db.grupos.comandosDesativados.get(ctx.chatId).add(cmdLimpo); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🚫 ".${cmdLimpo}" desativado aqui.\nReativar: .ativarcomando .${cmdLimpo}` });
  },
  
  'ativarcomando': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const comando = ctx.args[0]?.toLowerCase();
    if (!comando || !comando.startsWith('.')) return sock.sendMessage(ctx.chatId, { text: 'Uso: .ativarcomando [.cmd]' });
    const cmdLimpo = comando.replace('.', '');
    const cmds = db.grupos.comandosDesativados.get(ctx.chatId);
    if (!cmds || !cmds.has(cmdLimpo)) return sock.sendMessage(ctx.chatId, { text: `⚠️ ".${cmdLimpo}" já está ativo.` });
    cmds.delete(cmdLimpo); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ ".${cmdLimpo}" reativado.` });
  },
  
  'listardesativados': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const cmds = db.grupos.comandosDesativados.get(ctx.chatId);
    if (!cmds || !cmds.size) return sock.sendMessage(ctx.chatId, { text: '✅ Todos os comandos ativos.' });
    await sock.sendMessage(ctx.chatId, { text: `🚫 DESATIVADOS\n${[...cmds].map(c => `.${c}`).join('\n')}` });
  },'cprot': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAnti && !p.pRules && !p.pBemv) throw new PermissaoNegada();
    
    let conteudo = `║ 🛡️ MÓDULO PROTEÇÃO       ║
║                          ║`;
    
    if (p.pAnti) {
      conteudo += `
║ 🔗 ANTI-LINK             ║
║ .antilink [modo]         ║
║ .antilink add [site]     ║
║ .antilink remove [site]  ║
║ .antilink ls             ║
║                          ║
║ 🛡️ ANTI-MÍDIA            ║
║ .antimidia [tipo] on/off ║
║ .antimidia ls            ║
║                          ║
║ ⏱️ AUTO-DELETE           ║
║ .autodelete [tempo]      ║
║                          ║
║  PALAVRAS              ║
║ .proibirpalavra [p]      ║
║ .desbanirpalavra [p]     ║
║ .listarpalavras          ║`;
    }
    
    if (p.pRules) {
      conteudo += `
║ 📜 REGRAS                ║
║ .regras [texto]          ║
║ .verregras               `;
    }
    
    conteudo += `
║                          ║
║ 👋 .boasvindas [msg]/off ║
║  .notificar on/off     ║
║ 🤖 .ia on/off            ║`;
    
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO PROTEÇÃO', conteudo, imagemChave: 'protecao' });
  },
  
  'antimidia': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const sub = ctx.args[0]?.toLowerCase();
    const TIPOS = ['audio', 'video', 'imagem', 'documento', 'sticker', 'ligacao', 'pagamento', 'produto'];
    if (!sub || sub === 'ls' || sub === 'list') {
      const s = db.grupos.antiMidia.get(ctx.chatId) || new Set();
      if (sub === 'ls' || sub === 'list') return sock.sendMessage(ctx.chatId, { text: s.size ? `🛡️ *Anti-mídia activo:*\n${[...s].map(t => `✅ ${t}`).join('\n')}` : '📝 Nenhum bloqueio de mídia activo.' });
      return sock.sendMessage(ctx.chatId, { text: `🛡️ *ANTI-MÍDIA*\n━━━━━━━━━━━━━━\n\nUso: .antimidia [tipo] on/off\n\nTipos:\n${TIPOS.map(t => `• ${t}`).join('\n')}\n\nEx: .antimidia audio on\nEx: .antimidia ligacao off\n\nListar: .antimidia ls` });
    }
    if (!TIPOS.includes(sub)) return sock.sendMessage(ctx.chatId, { text: '❌ Tipo inválido. Usa .antimidia para ver a lista.' });
    const acao = ctx.args[1]?.toLowerCase();
    if (acao !== 'on' && acao !== 'off') return sock.sendMessage(ctx.chatId, { text: 'Uso: .antimidia [tipo] on/off' });
    if (!db.grupos.antiMidia.has(ctx.chatId)) db.grupos.antiMidia.set(ctx.chatId, new Set());
    const s = db.grupos.antiMidia.get(ctx.chatId);
    if (acao === 'on') { s.add(sub); salvarDados(); return sock.sendMessage(ctx.chatId, { text: `🛡️ Bloqueio de *${sub}* ACTIVADO` }); }
    else { s.delete(sub); salvarDados(); return sock.sendMessage(ctx.chatId, { text: `✅ Bloqueio de *${sub}* desactivado` }); }
  },
  
  'antilink': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const sub = ctx.args[0]?.toLowerCase();
    if (!sub) return sock.sendMessage(ctx.chatId, { text: 'Uso: .antilink [ban|kick|delete|warn|off]\n.antilink add [dominio]\n.antilink remove [dominio]\n.antilink ls' });
    if (sub === 'off') { db.grupos.antiLink.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔗 Anti-link OFF' }); }
    if (sub === 'add') {
      const d = ctx.args[1]; if (!d) return;
      const host = d.replace(/^https?:\/\//, '').replace(/^www./, '').split('/')[0];
      if (!db.whitelist.has(ctx.chatId)) db.whitelist.set(ctx.chatId, new Set());
      db.whitelist.get(ctx.chatId).add(host); salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `✅ ${host} permitido` });
    }
    if (sub === 'remove') {
      const d = ctx.args[1]; if (!d) return;
      const host = d.replace(/^https?:\/\//, '').replace(/^www./, '').split('/')[0];
      const s = db.whitelist.get(ctx.chatId);
      if (s && s.has(host)) { s.delete(host); salvarDados(); return sock.sendMessage(ctx.chatId, { text: `✅ ${host} removido` }); }
      return sock.sendMessage(ctx.chatId, { text: '⚠️ Não estava na whitelist' });
    }
    if (sub === 'ls' || sub === 'list') {
      const s = db.whitelist.get(ctx.chatId) || new Set();
      return sock.sendMessage(ctx.chatId, { text: s.size ? `Whitelist:\n${[...s].join('\n')}` : '📝 Whitelist vazia.' });
    }
    if (['ban', 'kick', 'delete', 'warn'].includes(sub)) {
      db.grupos.antiLink.set(ctx.chatId, sub); salvarDados();
      const modos = { ban: '🔨 Banir quem enviar', kick: '👢 Expulsar quem enviar', delete: '🗑️ Apagar silenciosamente', warn: '️ Avisar e apagar' };
      return sock.sendMessage(ctx.chatId, { text: `️ ANTI-LINK ACTIVADO!\nModo: ${sub.toUpperCase()}\n${modos[sub]}` });
    }
    return sock.sendMessage(ctx.chatId, { text: 'Uso inválido de .antilink' });
  },
  
  'autodelete': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const mode = ctx.args[0]?.toLowerCase();
    if (!mode) return sock.sendMessage(ctx.chatId, { text: 'Uso: .autodelete [10s|5m|1h|off]' });
    if (mode === 'off') { db.autoDelete.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⏱️ Auto-delete OFF' }); }
    const m = mode.match(/^(\d+)(s|m|h)?$/i);
    if (!m) return sock.sendMessage(ctx.chatId, { text: 'Formato inválido.' });
    const n = parseInt(m[1], 10), u = (m[2] || 's').toLowerCase();
    const ms = u === 's' ? n * 1000 : u === 'm' ? n * 60000 : n * 3600000;
    db.autoDelete.set(ctx.chatId, ms); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `⏱️ Auto-delete: ${mode}` });
  },
  
  'proibirpalavra': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return sock.sendMessage(ctx.chatId, { text: 'Uso: .proibirpalavra [palavra]' });
    if (!db.grupos.palavrasBanidas.has(ctx.chatId)) db.grupos.palavrasBanidas.set(ctx.chatId, []);
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId);
    if (lista.includes(palavra)) return sock.sendMessage(ctx.chatId, { text: '⚠️ Já está banida.' });
    lista.push(palavra); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🚫 Palavra banida: "${palavra}"` });
  },
  
  'desbanirpalavra': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return;
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    const idx = lista.indexOf(palavra);
    if (idx === -1) return sock.sendMessage(ctx.chatId, { text: '⚠️ Não está na lista.' });
    lista.splice(idx, 1); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Palavra removida: "${palavra}"` });
  },
  
  'listarpalavras': async (sock, ctx) => {
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    await sock.sendMessage(ctx.chatId, { text: lista.length ? `🚫 PALAVRAS BANIDAS\n${lista.join('\n')}` : '📝 Sem palavras banidas.' });
  },
  
  'regras': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasRulesRights(sock, ctx.chatId, ctx.senderId))) return;
    const regras = ctx.args.join(' ');
    if (!regras) return sock.sendMessage(ctx.chatId, { text: 'Uso: .regras [texto]' });
    db.grupos.regras.set(ctx.chatId, regras); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '✅ Regras actualizadas' });
  },
  
  'verregras': async (sock, ctx) => {
    const regras = db.grupos.regras.get(ctx.chatId);
    await sock.sendMessage(ctx.chatId, { text: regras ? ` REGRAS\n\n${regras}` : '📝 Sem regras definidas.' });
  },
  
  'boasvindas': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBoasvindasRights(sock, ctx.chatId, ctx.senderId))) return;
    const texto = ctx.args.join(' ');
    if (texto === 'off') { db.grupos.boasvindas.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔕 Boas-vindas OFF' }); }
    if (!texto) return sock.sendMessage(ctx.chatId, { text: 'Uso: .boasvindas [mensagem] / off\nVariáveis: @nome, @grupo' });
    db.grupos.boasvindas.set(ctx.chatId, texto); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '✅ Boas-vindas configuradas', mentions: [ctx.senderId] });
  },
  
  'notificar': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBoasvindasRights(sock, ctx.chatId, ctx.senderId))) return;
    const a = ctx.args[0]?.toLowerCase();
    if (a === 'on') { db.notifications.set(ctx.chatId, true); salvarDados(); return sock.sendMessage(ctx.chatId, { text: ' Notificações ON' }); }
    if (a === 'off') { db.notifications.set(ctx.chatId, false); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔕 Notificações OFF' }); }
    await sock.sendMessage(ctx.chatId, { text: `🔔 Notificações: ${db.notifications.get(ctx.chatId) ? 'ON' : 'OFF'}` });
  },
  
  'ia': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const acao = ctx.args[0]?.toLowerCase();
    if (acao === 'on') { db.grupos.iaAtivo.add(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🤖 IA ACTIVADA' }); }
    if (acao === 'off') { db.grupos.iaAtivo.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🤖 IA DESACTIVADA' }); }
    await sock.sendMessage(ctx.chatId, { text: `🤖 IA: ${db.grupos.iaAtivo.has(ctx.chatId) ? '✅ Activa' : '❌ Inactiva'}` });
  },
  
  'cmidia': async (sock, ctx) => {
    const conteudo = `║ 📲 MÓDULO MÍDIA          ║
║                          ║
║ 🎵 REDES                 ║
║ .tiktok [link]           ║
║ .tiktokaudio [link]      ║
║ .instagram [link]        ║
║ .facebook [link]         ║
║ .pinterest [link]        ║
║ .baixar [link]           ║
║                          ║
║ 🎬 YOUTUBE               ║
║ .youtube [pesquisa]      ║
║ .youtubevideo [link]     ║
║ .youtubeaudio [link]     ║
║                          ║
║ 👻 EXTRAS                ║
║ .revelar                 ║
║ .fichamidia [link]       ║
║ .canal [url]             ║
║ .zip [links]             ║
║                          ║
║ 🌍 OUTROS                ║
║ .traduzir [texto]        ║
║ .recibo [plano] [dias]   ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO MÍDIA & DOWNLOADS', conteudo, imagemChave: 'midia' });
  },
  
  'guiamidia': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, { text: mensagemGuiaMidia(ctx) });
  },
  
  'tiktok': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'tiktok')) return sock.sendMessage(ctx.chatId, { text: `❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.\n📞 ${CONFIG.ownerNumber}` });
    const link = ctx.args[0];
    if (!link || !/tiktok.com|vm.tiktok|vt.tiktok/.test(link)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tiktok [link]' });
    await sock.sendMessage(ctx.chatId, { text: '🎵 ⚡ TikTok\n⏳ A buscar o vídeo...' });
    try {
      const dados = await extrairGenDownload(link);
      const fmt = escolherFormatoGen(dados, 'video');
      const buf = await baixarBufferGen(fmt);
      if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: `🎵 ${dados.title || 'Vídeo'}\n👤 ${dados.author || ''}\n⚡ Kortex`, mimetype: 'video/mp4' });
    } catch (e) { console.warn('tiktok:', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar este TikTok.' });
  },
  
  'tiktokaudio': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'tiktokaudio')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || !/tiktok.com|vm.tiktok|vt.tiktok/.test(link)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tiktokaudio [link]' });
    await sock.sendMessage(ctx.chatId, { text: '🎶 ⚡ TikTok Áudio\n⏳ A extrair a música...' });
    try {
      const dados = await extrairGenDownload(link);
      const fmt = escolherFormatoGen(dados, 'audio');
      if (!fmt) return sock.sendMessage(ctx.chatId, { text: '❌ Não foi possível extrair o áudio deste TikTok.' });
      const buf = await baixarBufferGen(fmt, 32 * 1024 * 1024);
      if (buf) return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', fileName: `${(dados.title || 'tiktok_audio').replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.mp3`, ptt: false });
    } catch (e) { console.warn('tiktokaudio:', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui extrair o áudio deste TikTok.' });
  },
  
  'instagram': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'instagram')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || !link.includes('instagram.com')) return sock.sendMessage(ctx.chatId, { text: 'Uso: .instagram [link]' });
    await sock.sendMessage(ctx.chatId, { text: ' ⚡ Instagram\n⏳ Só um instante...' });
    try {
      const dados = await extrairGenDownload(link);
      const formatos = dados?.formats || [];
      const videos = formatos.filter(f => f.type === 'video');
      const imagens = formatos.filter(f => f.type === 'image' || /jpe?g|png|webp/.test(f.ext || ''));
      if (videos.length) { const buf = await baixarBufferGen(videos[0]); if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: ` Instagram — ${dados.author || ''}`, mimetype: 'video/mp4' }); }
      else if (imagens.length) {
        let i = 0;
        for (const img of imagens.slice(0, 4)) { const buf = await baixarBufferGen(img, 32 * 1024 * 1024); if (buf) { await sock.sendMessage(ctx.chatId, { image: buf, caption: `📸 (${i + 1}/${Math.min(imagens.length, 4)})` }); i++; await new Promise(r => setTimeout(r, 1000)); } }
        if (i > 0) return;
      }
    } catch (e) { console.warn('instagram:', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar do Instagram.' });
  },
  
  'facebook': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'facebook')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || !/(facebook.com|fb.watch|fb.com)/i.test(link)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .facebook [link]' });
    await sock.sendMessage(ctx.chatId, { text: '📘  Facebook\n⏳ A capturar...' });
    try { await executarDownloadUniversal(sock, ctx, link); }
    catch (e) { console.warn('facebook:', e.message); await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar do Facebook.' }); }
  },
  
  'baixar': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'baixar')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || !/^https?:\/\//i.test(link)) return sock.sendMessage(ctx.chatId, { text: '🌐 Uso: .baixar [link]\nFunciona com 1600+ sites.' });
    await sock.sendMessage(ctx.chatId, { text: '🌐 ⚡ Download Universal\n⏳ A analisar...' });
    try { await executarDownloadUniversal(sock, ctx, link); }
    catch (e) { console.warn('baixar:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui extrair mídia.' }); }
  },
  
  'youtube': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'youtube')) return sock.sendMessage(ctx.chatId, { text: ' Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const pesquisa = ctx.args.join(' ');
    if (!pesquisa) return sock.sendMessage(ctx.chatId, { text: 'Uso: .youtube [pesquisa]' });
    try {
      await sock.sendMessage(ctx.chatId, { text: '🔍 A pesquisar...' });
      const yts = require('yt-search');
      const resultados = await yts(pesquisa);
      const videos = resultados.videos.slice(0, 5);
      if (!videos.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum resultado.' });
      let texto = `🎬 RESULTADOS\n\n`;
      videos.forEach((vid, i) => { texto += `${i + 1}. ${vid.title.substring(0, 50)}\n⏱️ ${vid.timestamp || ''} | 🔗 ${vid.url}\n\n`; });
      texto += `💡 .youtubeaudio [link] / .youtubevideo [link]`;
      const thumbnail = videos[0]?.image || videos[0]?.thumbnail;
      if (thumbnail) await sock.sendMessage(ctx.chatId, { image: { url: thumbnail }, caption: texto });
      else await sock.sendMessage(ctx.chatId, { text: texto });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro na pesquisa.' }); }
  },
  
  'youtubevideo': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'youtubevideo')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) return sock.sendMessage(ctx.chatId, { text: 'Uso: .youtubevideo [link]' });
    await sock.sendMessage(ctx.chatId, { text: '🎬 ⚡ YouTube Vídeo\n⏳ A descarregar...' });
    try {
      const dados = await extrairGenDownload(link);
      if ((dados.duration || 0) > 1800) return sock.sendMessage(ctx.chatId, { text: '❌ Vídeos > 30 min não suportados.' });
      const fmt = escolherFormatoGen(dados, 'video');
      const buf = await baixarBufferGen(fmt);
      if (buf) {
        const videoId = extrairVideoId(link);
        const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
        return await sock.sendMessage(ctx.chatId, { video: buf, mimetype: 'video/mp4', caption: ` ${(dados.title || 'Vídeo').substring(0, 60)}\n⚡ Kortex`, contextInfo: thumbnail ? { externalAdReply: { title: dados.title || 'Vídeo', body: dados.author || '', thumbnailUrl: thumbnail, mediaType: 2, renderLargerThumbnail: true } } : undefined });
      }
    } catch (e) { console.warn('youtubevideo:', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar o vídeo.' });
  },
  
  'youtubeaudio': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'youtubeaudio')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) return sock.sendMessage(ctx.chatId, { text: 'Uso: .youtubeaudio [link]' });
    await sock.sendMessage(ctx.chatId, { text: '🎵 ⚡ YouTube Áudio\n⏳ A extrair o som...' });
    try {
      const dados = await extrairGenDownload(link);
      const fmt = escolherFormatoGen(dados, 'audio');
      const buf = await baixarBufferGen(fmt, 32 * 1024 * 1024);
      if (buf) {
        const ehMp3 = (fmt.ext || '') === 'mp3';
        return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: ehMp3 ? 'audio/mpeg' : 'audio/mp4', fileName: `${(dados.title || 'audio').replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.${ehMp3 ? 'mp3' : 'm4a'}`, ptt: false });
      }
    } catch (e) { console.warn('youtubeaudio:', e.message); }
    await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar o áudio.' });
  },
  
  'pinterest': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'pinterest')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || !/pinterest.(com|ca|co.uk|fr|de|es)/i.test(link)) return sock.sendMessage(ctx.chatId, { text: '📌 Uso: .pinterest [link]' });
    await sock.sendMessage(ctx.chatId, { text: ' ⚡ Pinterest\n⏳ A extrair imagens...' });
    try {
      const dados = await extrairGenDownload(link);
      const imagens = (dados.formats || []).filter(f => f.type === 'image' || /jpe?g|png|webp/i.test(f.ext || ''));
      if (!imagens.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhuma imagem encontrada.' });
      let i = 0;
      for (const img of imagens.slice(0, 10)) {
        const buf = await baixarBufferGen(img, 32 * 1024 * 1024);
        if (buf) { await sock.sendMessage(ctx.chatId, { image: buf, caption: `📌 Pinterest (${i + 1}/${Math.min(imagens.length, 10)})` }); i++; await new Promise(r => setTimeout(r, 1000)); }
      }
      if (i === 0) await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui baixar as imagens.' });
    } catch (e) { console.warn('pinterest:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao baixar do Pinterest.' }); }
  },
  
  'revelar': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const viewOnce = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
    if (!viewOnce) return sock.sendMessage(ctx.chatId, { text: ' Responde a uma mensagem "visualização única" com .revelar' });
    try {
      if (viewOnce.imageMessage) { const buf = await downloadMediaMessage({ message: viewOnce }, 'buffer', {}); return await sock.sendMessage(ctx.chatId, { image: buf, caption: viewOnce.imageMessage.caption || '👻 Revelada' }); }
      if (viewOnce.videoMessage) { const buf = await downloadMediaMessage({ message: viewOnce }, 'buffer', {}); return await sock.sendMessage(ctx.chatId, { video: buf, caption: viewOnce.videoMessage.caption || '👻 Revelada', mimetype: 'video/mp4' }); }
      if (viewOnce.audioMessage) { const buf = await downloadMediaMessage({ message: viewOnce }, 'buffer', {}); return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', ptt: viewOnce.audioMessage.ptt || false }); }
      await sock.sendMessage(ctx.chatId, { text: '❌ Tipo de mensagem não suportado.' });
    } catch (e) { console.warn('revelar:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui revelar esta mensagem.' }); }
  },
  
  'fichamidia': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'fichamidia')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || !/^https?:\/\//i.test(link)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .fichamidia [link]' });
    try {
      const dados = await extrairGenDownload(link);
      const dur = dados.duration ? `${Math.floor(dados.duration / 60)}:${String(dados.duration % 60).padStart(2, '0')}` : '—';
      const formatos = (dados.formats || []).map(f => `• ${f.label || f.ext} (${f.type})${f.filesize ? ` — ${(f.filesize / 1048576).toFixed(1)} MB` : ''}`).join('\n');
      const texto = ` FICHA DA MÍDIA\n\n🌐 ${(dados.source || '—').toUpperCase()}\n🎬 ${dados.title || '—'}\n👤 ${dados.author || '—'}\n⏱️ ${dur}\n👁️ ${dados.views ? Number(dados.views).toLocaleString('pt-PT') : '—'}\n\n📦 Formatos:\n${formatos || '(nenhum)'}\n\n💡 Usa .baixar [link]`;
      if (dados.thumbnail) await sock.sendMessage(ctx.chatId, { image: { url: dados.thumbnail }, caption: texto });
      else await sock.sendMessage(ctx.chatId, { text: texto });
    } catch { await sock.sendMessage(ctx.chatId, { text: ' Não consegui ler este link.' }); }
  },
  
  'canal': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'canal')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link) return sock.sendMessage(ctx.chatId, { text: 'Uso: .canal [link]' });
    await sock.sendMessage(ctx.chatId, { text: '📡 A listar vídeos...' });
    try {
      const r = await axios.post('https://gendownload.com/api/channel', { url: link, limit: 10 }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
      const itens = r.data?.items || [];
      if (!itens.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum vídeo.' });
      let texto = `📡 VÍDEOS\n\n`;
      itens.slice(0, 10).forEach((v, i) => { texto += `${i + 1}. ${(v.title || 'Sem título').substring(0, 45)}\n🔗 ${v.url}\n\n`; });
      texto += `💡 Usa .baixar [link]`;
      await sock.sendMessage(ctx.chatId, { text: texto });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui listar.' }); }
  },
  
  'zip': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'zip')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const links = ctx.args.filter(a => /^https?:\/\//i.test(a));
    if (links.length < 2) return sock.sendMessage(ctx.chatId, { text: 'Uso: .zip [link1] [link2] ...' });
    await sock.sendMessage(ctx.chatId, { text: `📦 A empacotar ${links.length} vídeos...\n Pode demorar...` });
    try {
      const r = await axios.post('https://gendownload.com/api/zip', { urls: links, quality: '480' }, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
      if (r.data?.url) return await sock.sendMessage(ctx.chatId, { text: `📦 ZIP PRONTO!\n🔗 ${r.data.url}\n️ Link temporário!` });
      throw new Error('sem url');
    } catch { await sock.sendMessage(ctx.chatId, { text: ' Não consegui criar o ZIP.' }); }
  },
  
  'recibo': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const plano = (ctx.args[0] || '').toLowerCase();
    const dias = ctx.args[1], numero = ctx.args[2], valor = ctx.args[3] || null;
    if (!NIVEIS_VIP[plano] || !dias || !numero) return sock.sendMessage(ctx.chatId, { text: 'Uso: .recibo [ouro/diamante/lenda] [dias] [número] [valor?]' });
    const TEMAS = { ouro: { cor1: '#7a5c00', cor2: '#ffd700', nome: 'OURO 🥇' }, diamante: { cor1: '#0d3b66', cor2: '#4fc3f7', nome: 'DIAMANTE 💎' }, lenda: { cor1: '#3a0d66', cor2: '#ffd700', nome: 'LENDA 👑' } };
    const tema = TEMAS[plano];
    const agora = new Date();
    const dataStr = agora.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaStr = agora.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const idRecibo = 'YNK' + Date.now().toString().slice(-8);
    const linhaValor = valor ? `\n<text x="90" y="700" font-size="24" font-family="Arial" fill="#999999">Valor</text>\n<text x="90" y="738" font-size="32" font-family="Arial" font-weight="bold" fill="#ffffff">${utils.escapeXml(valor)} MT</text>` : '';
    const yData = valor ? 800 : 700;
    const svg = `<svg width="900" height="1150" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${tema.cor1}"/><stop offset="100%" stop-color="${tema.cor2}"/></linearGradient></defs><rect width="900" height="1150" fill="#0e0e10"/><rect x="40" y="40" width="820" height="1070" rx="28" fill="url(#bg)" opacity="0.14"/><rect x="40" y="40" width="820" height="1070" rx="28" fill="none" stroke="url(#bg)" stroke-width="4"/><text x="450" y="140" font-size="40" font-family="Arial" font-weight="bold" fill="#ffffff" text-anchor="middle">YANIKZX9 STORE</text><text x="450" y="176" font-size="20" font-family="Arial" fill="#bbbbbb" text-anchor="middle">Comprovativo de Pagamento</text><line x1="90" y1="210" x2="810" y2="210" stroke="#444" stroke-width="2"/><text x="450" y="310" font-size="56" font-family="Arial" font-weight="bold" fill="url(#bg)" text-anchor="middle">${tema.nome}</text><text x="90" y="420" font-size="24" font-family="Arial" fill="#999999">Número do cliente</text><text x="90" y="458" font-size="32" font-family="Arial" font-weight="bold" fill="#ffffff">${utils.escapeXml(numero)}</text><text x="90" y="560" font-size="24" font-family="Arial" fill="#999999">Duração do plano</text><text x="90" y="598" font-size="32" font-family="Arial" font-weight="bold" fill="#ffffff">${utils.escapeXml(dias)} dias</text>${linhaValor}<text x="90" y="${yData}" font-size="24" font-family="Arial" fill="#999999">Data e hora</text><text x="90" y="${yData + 38}" font-size="28" font-family="Arial" font-weight="bold" fill="#ffffff">${dataStr} às ${horaStr}</text><text x="90" y="${yData + 90}" font-size="18" font-family="Arial" fill="#666666">ID: ${idRecibo}</text><g transform="translate(650,${yData + 60}) rotate(-16)"><rect x="-125" y="-46" width="250" height="92" rx="14" fill="none" stroke="#2ecc71" stroke-width="5" opacity="0.9"/><text x="0" y="-4" font-size="24" font-family="Arial" font-weight="bold" fill="#2ecc71" text-anchor="middle" opacity="0.9">YANIKZX9</text><text x="0" y="26" font-size="16" font-family="Arial" fill="#2ecc71" text-anchor="middle" opacity="0.9">VERIFICADO ✔</text></g><text x="450" y="1080" font-size="16" font-family="Arial" fill="#666" text-anchor="middle">Obrigado pela preferência</text></svg>`;
    try {
      const buf = await sharp(Buffer.from(svg)).png().toBuffer();
      await sock.sendMessage(ctx.chatId, { image: buf, caption: `🧾 Comprovativo — ${tema.nome}` });
    } catch { await sock.sendMessage(ctx.chatId, { text: 'Erro ao gerar comprovativo.' }); }
  },
  
  'cstick': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pSticker) throw new PermissaoNegada();
    const conteudo = `║ 🎨 MÓDULO STICKERS       ║
║                          ║
║ 🖼️ .figurinha            
║ ✏️ .stickertexto [texto] ║
║ ℹ️ .infosticker          ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO STICKERS', conteudo, imagemChave: 'stickers' });
  },
  
  'figurinha': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    let buffer = null, processado = null;
    try {
      const msg = ctx.msg;
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const mediaMsg = quotedMsg ? { message: quotedMsg } : msg;
      if (mediaMsg.message?.imageMessage) {
        buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
        processado = await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85, effort: 4 }).toBuffer();
        buffer = null;
      } else if (mediaMsg.message?.videoMessage) {
        const segundos = mediaMsg.message.videoMessage.seconds || 0;
        if (segundos > 10) return sock.sendMessage(ctx.chatId, { text: '❌ Máximo 10 segundos!' });
        await utils.reagir(sock, ctx.msg, '');
        await sock.sendMessage(ctx.chatId, { text: '🎞️ ⚡ A criar sticker ANIMADO...' });
        buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
        processado = await converterVideoParaStickerAnimado(buffer, Math.min(segundos || 6, 6));
        buffer = null;
        if (processado.length > 1024 * 1024) return sock.sendMessage(ctx.chatId, { text: '❌ Sticker pesado demais (>1MB).' });
      } else return sock.sendMessage(ctx.chatId, { text: '❌ Envie imagem ou vídeo com .figurinha' });
      const final = await utils.adicionarMetadadosSticker(processado);
      await sock.sendMessage(ctx.chatId, { sticker: final });
      await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) { console.error('figurinha erro:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao criar sticker' }); }
    finally { buffer = null; processado = null; }
  },
  
  'stickertexto': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    const texto = ctx.args.join(' ');
    if (!texto) return sock.sendMessage(ctx.chatId, { text: 'Uso: .stickertexto [texto]' });
    try {
      const safe = utils.escapeXml(texto);
      const buffer = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 128, g: 0, b: 128, alpha: 1 } } })
        .composite([{ input: Buffer.from(`<svg width="512" height="512"><style>text { fill: white; font-size: 40px; font-family: Arial, sans-serif; text-anchor: middle; dominant-baseline: central; font-weight: bold; }</style><text x="256" y="256">${safe}</text></svg>`), top: 0, left: 0 }])
        .webp({ quality: 90 }).toBuffer();
      const final = await utils.adicionarMetadadosSticker(buffer);
      await sock.sendMessage(ctx.chatId, { sticker: final });
      await utils.reagir(sock, ctx.msg, '✅');
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao criar sticker' }); }
  },
  
  'infosticker': async (sock, ctx) => {
    const q = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!q?.stickerMessage) return sock.sendMessage(ctx.chatId, { text: '❌ Responde a um sticker' });
    const s = q.stickerMessage;
    await sock.sendMessage(ctx.chatId, { text: `📋 INFO DO STICKER\n┃ 📦 Pacote: ${s.stickerPack || '—'}\n┃ ✏️ Autor: ${s.stickerAuthor || '—'}\n┃ 📛 Nome: ${s.stickerName || '—'}\n┃ 📏 ${(s.fileLength ? (Number(s.fileLength) / 1024).toFixed(1) : 'N/A')} KB\n┃ 🎞️ Animado: ${s.isAnimated ? '✅' : ''}` });
  },
  
  'cdono': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const conteudo = `║ 👑 PAINEL DO DONO        ║
║                          ║
║ 💎 VIPs GRUPO            ║
║ .ativarvip [nível] [dias]║
║ .removervip              ║
║ .listargrupos            ║
║ .avisartodos all         
║                          ║
║ 👤 VIPs USER             ║
║ .vipuser @user [n] [d]   ║
║ .meuvip                  ║
║                          ║
║ 🛠️ SISTEMA               ║
║ .estatisticas            ║
║ .usocomandos             ║
║ .relatorio               ║
║ .historico               ║
║ .prefixo [novo]          ║
║ .backup / .restaurar     ║
║ .modelo [nome]           ║
║ ⚡ .semprefixo on/off    ║
║                          ║
║ 🔇 CONTROLO              ║
║ .desligarbot / .ligarbot ║
║ .ignorar / .designorar   ║
║ .ignorados               ║
║ .atalho / .removeratalho ║
║ .listaratalhos           ║
║ 📥 .entrar [link]        ║
║ 📤 .sair                 ║
║                          ║
║ 🧾 .recibo [p] [d] [n]   ║
║ 🆔 .meuid                ║`;
    await enviarMenuKortex(sock, ctx, { titulo: 'PAINEL DO DONO', conteudo, imagemChave: 'dono', rodape: '⚡ KORTEX CORE - ACESSO TOTAL' });
  },
  
  'ping': async (sock, ctx) => {
    const latencia = Date.now() - (ctx.msg.messageTimestamp ? Number(ctx.msg.messageTimestamp) * 1000 : Date.now());
    const l = Math.max(0, Math.min(latencia, 9999));
    const status = l < 100 ? '🟢 Excelente' : l < 300 ? '🟡 Normal' : '🔴 Lento';
    await sock.sendMessage(ctx.chatId, { text: `🏓 *PONG!*\n⚡ Latência: *${l}ms*\n${status}\n⏱️ Uptime: ${utils.tempoRestante(process.uptime() * 1000)}` });
  },
  
  'hora': async (sock, ctx) => {
    const agora = new Date();
    const hora = agora.toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const data = agora.toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    await sock.sendMessage(ctx.chatId, { text: ` *${hora}*\n📅 ${data}\n🌍 Maputo (CAT)` });
  },
  
  'info': async (sock, ctx) => {
    const memoria = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    await sock.sendMessage(ctx.chatId, { text: `⚡ KORTEX\n\n👤 ${CONFIG.creator}\n📱 ${CONFIG.ownerNumber}\n⚡ Prefixo: ${CONFIG.prefix}\n⏱️ Online: ${utils.tempoRestante(process.uptime() * 1000)}\n💾 ${memoria} MB\n\n💎 Grupos VIP: ${db.gruposVIP.size}\n👑 Users VIP: ${db.usersVIP.size}\n🔗 Anti-link: ${db.grupos.antiLink.size}\n IA: ${db.grupos.iaAtivo.size}\n⚡ Atalhos: ${db.atalhos.size}\n🔧 Comandos: ${Object.keys(commands).length}` });
  },
  
  'planos': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, { text: `💰 ALUGUER DO BOT\n\n🥇 Ouro - 7 dias\n💎 Diamante - 30 dias\n👑 Lenda - 60 dias\n\n📞 ${CONFIG.creator} — ${CONFIG.ownerNumber}` });
  },
  
  'statusgrupo': async (sock, ctx) => {
    const sub = db.gruposVIP.get(ctx.chatId);
    if (!sub || sub.expiraEm < Date.now()) return sock.sendMessage(ctx.chatId, { text: ` SEM ASSINATURA\nContacte: ${CONFIG.ownerNumber}` });
    const restante = Math.max(0, sub.expiraEm - Date.now());
    const nivel = NIVEIS_VIP[sub.nivel];
    await sock.sendMessage(ctx.chatId, { text: `💎 Nível: ${nivel.nome}\n ${utils.tempoRestante(restante)}\n\nBan: ${nivel.ban ? '✅' : '❌'}\nPromover: ${nivel.promote ? '✅' : '❌'}\nRegras: ${nivel.rules ? '✅' : '❌'}\nProtecção: ${nivel.anti ? '✅' : ''}\nBoas-vindas: ${nivel.boasvindas ? '✅' : '❌'}\nStickers: ${nivel.sticker ? '✅' : '❌'}` });
  },
  
  'meuid': async (sock, ctx) => {
    const botId = sock.user?.id || 'Desconhecido';
    await sock.sendMessage(ctx.chatId, { text: `🆔 IDs\n\n🤖 Bot: ${botId}\n👑 Dono: ${CONFIG.ownerId}\n👤 Tu: ${ctx.senderId}\nÉ dono? ${utils.isOwner(ctx.senderId) ? '✅' : '❌'}` });
  },
  
  'indicar': async (sock, ctx) => {
    if (!ctx.args[0]) return sock.sendMessage(ctx.chatId, { text: 'Uso: .indicar [numero]' });
    const cur = db.indicadores.get(ctx.senderId) || 0;
    db.indicadores.set(ctx.senderId, cur + 1); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Indicação registada. Pontos: ${cur + 1}` });
  },
  
  'ranking': async (sock, ctx) => {
    const arr = [...db.indicadores.entries()];
    if (!arr.length) return sock.sendMessage(ctx.chatId, { text: 'Nenhuma indicação.' });
    arr.sort((a, b) => b[1] - a[1]);
    await sock.sendMessage(ctx.chatId, { text: `🏆 RANKING\n${arr.slice(0, 10).map((r, i) => `${i + 1}. @${r[0].split('@')[0]} — ${r[1]}`).join('\n')}`, mentions: arr.slice(0, 10).map(r => r[0]) });
  },
  
  'pontos': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, { text: `🔢 Tens ${db.indicadores.get(ctx.senderId) || 0} pontos.` });
  },
  
  'traduzir': async (sock, ctx) => {
    const all = ctx.args.join(' ');
    if (!all) return sock.sendMessage(ctx.chatId, { text: 'Uso: .traduzir [texto] ou [idioma] [texto]' });
    let target = 'pt', text = all;
    if (ctx.args[0] && ctx.args[0].length <= 3 && ctx.args.length > 1) { target = ctx.args[0]; text = ctx.args.slice(1).join(' '); }
    try { const res = await translate(text, { to: target }); await sock.sendMessage(ctx.chatId, { text: `🌐 Tradução (${target}):\n${res}` }); }
    catch { await sock.sendMessage(ctx.chatId, { text: 'Erro na tradução.' }); }
  },
  
  'dolar': async (sock, ctx) => {
    const d = await getJSON('https://open.er-api.com/v6/latest/USD');
    if (!d?.rates?.MZN) return sock.sendMessage(ctx.chatId, { text: '❌ Cotação indisponível.' });
    await sock.sendMessage(ctx.chatId, { text: `💵 *Dólar*\n1 USD = *${d.rates.MZN.toFixed(2)} MZN*` });
  },
  
  'euro': async (sock, ctx) => {
    const d = await getJSON('https://open.er-api.com/v6/latest/EUR');
    if (!d?.rates?.MZN) return sock.sendMessage(ctx.chatId, { text: '❌ Cotação indisponível.' });
    await sock.sendMessage(ctx.chatId, { text: `💶 *Euro*\n1 EUR = *${d.rates.MZN.toFixed(2)} MZN*` });
  },
  
  'ativarvip': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const nivel = ctx.args[0]?.toLowerCase();
    if (!nivel || !NIVEIS_VIP[nivel]) return sock.sendMessage(ctx.chatId, { text: 'Uso: .ativarvip [ouro/diamante/lenda] [dias]' });
    let dias = parseInt(ctx.args[1]) || NIVEIS_VIP[nivel].maxDias;
    dias = Math.min(dias, NIVEIS_VIP[nivel].maxDias);
    db.gruposVIP.set(ctx.chatId, { nivel, expiraEm: Date.now() + (dias * 86400000), diasTotal: dias, ativadoPor: ctx.senderId, ativadoEm: Date.now() });
    salvarDados();
    registrarAcao(ctx.chatId, `VIP activado: ${NIVEIS_VIP[nivel].nome} por ${dias} dias`);
    await sock.sendMessage(ctx.chatId, { text: `🎉 VIP ACTIVADO!\n💎 ${NIVEIS_VIP[nivel].nome}\n ${dias} dias\n👤 @${ctx.senderId.split('@')[0]}`, mentions: [ctx.senderId] });
  },
  
  'removervip': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    db.gruposVIP.delete(ctx.chatId); salvarDados();
    registrarAcao(ctx.chatId, 'VIP removido pelo dono');
    await sock.sendMessage(ctx.chatId, { text: '✅ VIP REMOVIDO' });
  },
  
  'listargrupos': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!db.gruposVIP.size) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum grupo activo.' });
    let lista = `⚡ GRUPOS ACTIVOS\n\n`;
    for (const [g, s] of db.gruposVIP) lista += `📞 ${g.split('@')[0]}\n${NIVEIS_VIP[s.nivel].nome} • ${Math.floor(Math.max(0, s.expiraEm - Date.now()) / 86400000)}d\n\n`;
    await sock.sendMessage(ctx.chatId, { text: lista });
  },
  
  'avisartodos': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if ((ctx.args[0] || '').toLowerCase() !== 'all') return sock.sendMessage(ctx.chatId, { text: 'Uso: .avisartodos all' });
    let gruposInfo;
    try { gruposInfo = await sock.groupFetchAllParticipating(); } catch (e) { return sock.sendMessage(ctx.chatId, { text: `Erro: ${e.message}` }); }
    const grupoIds = Object.keys(gruposInfo);
    if (!grupoIds.length) return sock.sendMessage(ctx.chatId, { text: 'Sem grupos.' });
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
  
  'vipuser': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target && ctx.args[0]) target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    const nivel = (ctx.args[1] || '').toLowerCase();
    const dias = parseInt(ctx.args[2]);
    if (!target || !NIVEIS_VIP_USER[nivel] || !dias) return sock.sendMessage(ctx.chatId, { text: 'Uso: .vipuser @user [nivel] [dias]\nNíveis: ouro | diamante | lenda' });
    const diasFinais = Math.min(dias, NIVEIS_VIP_USER[nivel].maxDias);
    db.usersVIP.set(target, { nivel, expiraEm: Date.now() + (diasFinais * 86400000), ativadoEm: Date.now() });
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ VIP USER ACTIVADO\n👤 @${target.split('@')[0]}\n💎 ${NIVEIS_VIP_USER[nivel].nome}\n ${diasFinais} dias\n🔓 ${NIVEIS_VIP_USER[nivel].cmds.map(c => '.' + c).join(', ')}`, mentions: [target] });
  },
  
  'meuvip': async (sock, ctx) => {
    const vip = db.usersVIP.get(ctx.senderId);
    if (!vip || vip.expiraEm < Date.now()) {
      if (vip) { db.usersVIP.delete(ctx.senderId); salvarDados(); }
      return sock.sendMessage(ctx.chatId, { text: `❌ Sem VIP activo.\n\n🥇 Ouro: .tiktok .tiktokaudio\n💎 Diamante: + .instagram .facebook .baixar .fichamidia .pinterest\n👑 Lenda: todos\n\n📞 ${CONFIG.ownerNumber}` });
    }
    const nivel = NIVEIS_VIP_USER[vip.nivel];
    await sock.sendMessage(ctx.chatId, { text: ` O TEU VIP\nNível: ${nivel.nome}\n⏳ ${utils.tempoRestante(Math.max(0, vip.expiraEm - Date.now()))}\n🔓 ${nivel.cmds.map(c => '.' + c).join(', ')}` });
  },
  
  'estatisticas': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    await sock.sendMessage(ctx.chatId, { text: `📊 ESTATÍSTICAS\n\n🤖 Grupos VIP: ${db.gruposVIP.size}\n🔧 Comandos: ${Object.keys(commands).length}\n⚡ Atalhos: ${db.atalhos.size}\n ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n⏰ ${utils.tempoRestante(process.uptime() * 1000)}\n🔗 Anti-link: ${db.grupos.antiLink.size}\n🧠 IA: ${db.grupos.iaAtivo.size}` });
  },
  
  'usocomandos': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const entries = [...db.stats.entries()].sort((a, b) => b[1] - a[1]);
    if (!entries.length) return sock.sendMessage(ctx.chatId, { text: 'Sem estatísticas.' });
    await sock.sendMessage(ctx.chatId, { text: `📊 USO\n${entries.slice(0, 20).map(e => `${e[0]} → ${e[1]}`).join('\n')}` });
  },
  
  'relatorio': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    try { await enviarRelatorioCompleto(sock, ctx.chatId); } catch (e) { await sock.sendMessage(ctx.chatId, { text: `Erro: ${e.message}` }); }
  },
  
  'historico': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const historico = db.historicoGrupos.get(ctx.chatId) || [];
    if (!historico.length) return sock.sendMessage(ctx.chatId, { text: '📝 Sem histórico.' });
    let texto = `📋 HISTÓRICO\n`;
    for (const h of historico.slice(-10).reverse()) texto += `• ${h.acao}\n${new Date(h.data).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' })}\n`;
    await sock.sendMessage(ctx.chatId, { text: texto });
  },
  
  'prefixo': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const novo = ctx.args[0];
    if (!novo) return sock.sendMessage(ctx.chatId, { text: `⚡ Prefixo actual: ${CONFIG.prefix}` });
    CONFIG.prefix = novo; salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Novo prefixo: ${novo}` });
  },
  
  'backup': async (sock, ctx) => {
    if (!ctx.isGroup) throw new PermissaoNegada();
    if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) throw new PermissaoNegada();
    const dir = path.join(__dirname, 'data', 'backups');
    fse.ensureDirSync(dir);
    const out = path.join(dir, `${ctx.chatId.replace(/[^a-z0-9]/gi, '_')}.json`);
    const cfg = { antiLink: db.grupos.antiLink.get(ctx.chatId), palavrasBanidas: db.grupos.palavrasBanidas.get(ctx.chatId) || [], boasvindas: db.grupos.boasvindas.get(ctx.chatId) || null, regras: db.grupos.regras.get(ctx.chatId) || null };
    fs.writeFileSync(out, JSON.stringify(cfg, null, 2));
    await sock.sendMessage(ctx.chatId, { text: ` Backup criado: ${path.basename(out)}` });
  },
  
  'restaurar': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const rawFile = ctx.args[0] || '';
    if (!rawFile || rawFile.includes('/') || rawFile.includes('\\') || rawFile.includes('..')) return sock.sendMessage(ctx.chatId, { text: '❌ Nome de backup inválido.' });
    const fp = path.join(__dirname, 'data', 'backups', path.basename(rawFile));
    if (!fs.existsSync(fp)) return sock.sendMessage(ctx.chatId, { text: 'Backup não encontrado.' });
    const cfg = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (cfg.antiLink) db.grupos.antiLink.set(ctx.chatId, cfg.antiLink);
    if (cfg.palavrasBanidas) db.grupos.palavrasBanidas.set(ctx.chatId, cfg.palavrasBanidas);
    if (cfg.boasvindas) db.grupos.boasvindas.set(ctx.chatId, cfg.boasvindas);
    if (cfg.regras) db.grupos.regras.set(ctx.chatId, cfg.regras);
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '✅ Restore concluído.' });
  },
  
  'modelo': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const model = ctx.args[0];
    if (!model) return sock.sendMessage(ctx.chatId, { text: `Modelo actual: ${CONFIG.groq_model || 'llama-3.3-70b-versatile'}` });
    CONFIG.groq_model = model; salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✔️ Modelo: ${model}` });
  },
  
  'desligarbot': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    db.grupos.desligados.add(ctx.chatId); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '🔴 BOT DESLIGADO AQUI' });
  },
  
  'ligarbot': async (sock, ctx) => {
    if (!ctx.isGroup || !utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    db.grupos.desligados.delete(ctx.chatId); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: '🟢 BOT LIGADO AQUI' });
  },
  
  'ignorar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target && ctx.args[0]) target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    if (!target) return sock.sendMessage(ctx.chatId, { text: 'Uso: .ignorar [@pessoa|número]' });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: '❌ Não posso ignorar o dono.' });
    if (db.usersVIP.has(target) && db.usersVIP.get(target).expiraEm > Date.now()) return sock.sendMessage(ctx.chatId, { text: '❌ Utilizador com VIP activo.', mentions: [target] });
    db.ignorados.add(target); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🔇 A IGNORAR @${target.split('@')[0]}`, mentions: [target] });
  },
  
  'designorar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target && ctx.args[0]) target = `${ctx.args[0].replace(/\D/g, '')}@s.whatsapp.net`;
    if (!target) return sock.sendMessage(ctx.chatId, { text: 'Uso: .designorar [@pessoa|número]' });
    db.ignorados.delete(target); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `🔊 DEIXEI DE IGNORAR @${target.split('@')[0]}`, mentions: [target] });
  },
  
  'ignorados': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!db.ignorados.size) return sock.sendMessage(ctx.chatId, { text: '📝 Sem ignorados.' });
    await sock.sendMessage(ctx.chatId, { text: `🔇 IGNORADOS\n${[...db.ignorados].map(id => `@${id.split('@')[0]}`).join('\n')}`, mentions: [...db.ignorados] });
  },
  
  'atalho': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const a = ctx.args[0]?.toLowerCase();
    const info = ctx.args.slice(1).join(' ');
    if (!a || !info) return sock.sendMessage(ctx.chatId, { text: 'Uso: .atalho [nome] [texto]' });
    let grupoNome = 'PV';
    if (ctx.isGroup) { try { grupoNome = (await sock.groupMetadata(ctx.chatId)).subject; } catch { grupoNome = 'Grupo'; } }
    db.atalhos.set(a, { texto: info, grupoId: ctx.chatId, grupoNome }); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Atalho ${a} criado` });
  },
  
  'removeratalho': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const a = ctx.args[0]?.toLowerCase();
    if (!a) return;
    if (db.atalhos.delete(a)) { salvarDados(); await sock.sendMessage(ctx.chatId, { text: `✅ Atalho ${a} removido` }); }
  },
  
  'listaratalhos': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!db.atalhos.size) return sock.sendMessage(ctx.chatId, { text: '📝 Sem atalhos.' });
    let lista = `⚡ ATALHOS\n\n`;
    for (const [a, v] of db.atalhos) lista += `🔹 ${a} → ${typeof v === 'string' ? v : v.texto} (${typeof v === 'string' ? '—' : v.grupoNome})\n`;
    await sock.sendMessage(ctx.chatId, { text: lista });
  },
  
  'comandos': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, { text: `🔎 ${Object.keys(commands).length} comandos:\n${Object.keys(commands).filter(c => !c.startsWith('_')).map(c => '.' + c).join(', ')}` });
  },
  
  'aprovar': async (sock, ctx) => {
    const id = ctx.args[0];
    if (!id) return sock.sendMessage(ctx.chatId, { text: 'Uso: .aprovar [id]\nVeja o ID na solicitação pendente.' });
    await processarAprovacao(sock, ctx, id, true);
  },
  
  'recusar': async (sock, ctx) => {
    const id = ctx.args[0];
    if (!id) return sock.sendMessage(ctx.chatId, { text: 'Uso: .recusar [id]\nVeja o ID na solicitação pendente.' });
    await processarAprovacao(sock, ctx, id, false);
  },
  
  'entrar': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const m = (ctx.args[0] || '').match(/chat.whatsapp.com\/([A-Za-z0-9_-]+)/);
    if (!m) return sock.sendMessage(ctx.chatId, { text: 'Uso: .entrar [link do grupo]' });
    try { const g = await sock.groupAcceptInvite(m[1]); await sock.sendMessage(ctx.chatId, { text: `✅ Entrei no grupo ${g?.gid || ''}` }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Link inválido ou expirado.' }); }
  },
  
  'sair': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa num grupo.' });
    await sock.sendMessage(ctx.chatId, { text: '👋 Até já!' });
    setTimeout(() => sock.groupLeave(ctx.chatId), 1500);
  },
  
  'semprefixo': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const a = ctx.args[0]?.toLowerCase();
    if (a === 'on') { db.grupos.semPrefixo.add(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⚡ SEM PREFIXO ACTIVADO neste grupo.\n(comandos perigosos continuam a exigir prefixo)' }); }
    if (a === 'off') { db.grupos.semPrefixo.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⚡ Sem prefixo desativado.' }); }
    await sock.sendMessage(ctx.chatId, { text: ` Sem prefixo: ${db.grupos.semPrefixo.has(ctx.chatId) ? '✅ ON' : '❌ OFF'}\nUso: .semprefixo on/off` });
  }
};async function omdbBusca(sock, ctx, tipo) {
  const t = ctx.args.join(' ');
  if (!t) return sock.sendMessage(ctx.chatId, { text: `Uso: .${tipo === 'movie' ? 'filme' : 'serie'} [título]` });
  if (!CONFIG.omdbKey || CONFIG.omdbKey.includes('COLE_AQUI')) return sock.sendMessage(ctx.chatId, { text: '❌ Cola a tua chave OMDB gratuita em CONFIG.omdbKey (omdbapi.com/apikey.aspx).' });
  const d = await getJSON(`https://www.omdbapi.com/?apikey=${CONFIG.omdbKey}&t=${encodeURIComponent(t)}&type=${tipo}&plot=short`);
  if (!d || d.Response === 'False') return sock.sendMessage(ctx.chatId, { text: `❌ Não encontrado: "${t}"` });
  const txt = `🎬 *${d.Title}*\n📅 ${d.Year}\n⭐ ${d.imdbRating || '—'}\n️ ${d.Runtime || '—'}\n🎭 ${d.Genre || '—'}\n\n${d.Plot || ''}`;
  if (d.Poster && d.Poster !== 'N/A') await sock.sendMessage(ctx.chatId, { image: { url: d.Poster }, caption: txt });
  else await sock.sendMessage(ctx.chatId, { text: txt });
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
    if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: `🌐 *${(dados.title || 'Vídeo').substring(0, 60)}*\n📡 Fonte: ${fonte}\n ${dados.author || ''}\n⚡ Kortex`, mimetype: 'video/mp4' });
  }
  if (imagens.length) {
    let i = 0;
    for (const img of imagens.slice(0, 4)) {
      const buf = await baixarBufferGen(img, 32 * 1024 * 1024);
      if (buf) { await sock.sendMessage(ctx.chatId, { image: buf, caption: `🌐 ${fonte} (${i + 1}/${Math.min(imagens.length, 4)})` }); i++; await new Promise(r => setTimeout(r, 1000)); }
    }
    if (i > 0) return;
  }
  if (audio) {
    const buf = await baixarBufferGen(audio, 32 * 1024 * 1024);
    if (buf) return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', fileName: `${(dados.title || 'audio').replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.mp3`, ptt: false });
  }
  return sock.sendMessage(ctx.chatId, { text: `😔 A plataforma *${fonte}* não devolveu mídia baixável.` });
}

async function executarAntiLink(sock, chatId, msg, senderId, modo) {
  try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
  if (modo === 'warn') await sock.sendMessage(chatId, { text: `️ *AVISO: LINK DETECTADO*\n@${senderId.split('@')[0]}, links não são permitidos!`, mentions: [senderId] });
  else if (modo === 'delete') await sock.sendMessage(chatId, { text: `🔗 *LINK REMOVIDO*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
  else if (modo === 'kick' || modo === 'ban') {
    try {
      await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
      registrarAcao(chatId, `Anti-link (${modo}): @${senderId.split('@')[0]}`);
      await sock.sendMessage(chatId, { text: `🚫 *REMOVIDO POR LINK*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
    } catch { await sock.sendMessage(chatId, { text: `️ Não consegui remover @${senderId.split('@')[0]}.`, mentions: [senderId] }); }
  }
}

async function processarMensagem(sock, msg) {
  const minhaGeracao = geracaoAtual;
  if (!msg.message || msg.key.fromMe) return;
  if (msg.key.id && mensagensIgnoradas.has(msg.key.id)) { mensagensIgnoradas.delete(msg.key.id); return; }
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
  if (msg.key.id) { ultimasMensagensIds.push(msg.key.id); if (ultimasMensagensIds.length > 4) ultimasMensagensIds.shift(); }
  if (!isGroup) console.log(`📩 PV de ${senderId.split('@')[0]}: "${fullText}"`);
  try { await sock.readMessages([msg.key]); } catch {}
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
      setTimeout(async () => { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {} }, ms);
    }
  } catch {}
  if (isGroup) await utils.checkGroupExpired(sock, chatId);
  if (isGroup && fullText) {
    const isAdmin = await utils.isSenderGroupAdmin(sock, chatId, senderId);
    const isOwner = utils.isOwner(senderId);
    if (!isAdmin && !isOwner) {
      const mut = db.mutados.get(chatId)?.get(senderId);
      if (mut) {
        if (mut > Date.now()) { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {} return; }
        db.mutados.get(chatId).delete(senderId); salvarDados();
      }
      const antiLinkMode = db.grupos.antiLink.get(chatId);
      if (antiLinkMode) {
        const links = [...(fullText.match(REGEX_URL) || [])];
        const lowerText = fullText.toLowerCase();
        const hasLink = links.length > 0 || lowerText.includes('wa.me/') || lowerText.includes('chat.whatsapp.com');
        if (hasLink) {
          let ignore = false;
          const whitelist = db.whitelist.get(chatId) || new Set();
          for (const link of links) {
            try { const u = new URL(link.startsWith('http') ? link : 'http://' + link); if (whitelist.has(u.hostname.replace(/^www./, ''))) { ignore = true; break; } } catch {}
          }
          if (!ignore) { await executarAntiLink(sock, chatId, msg, senderId, antiLinkMode); return; }
        }
      }
      const palavrasBanidas = db.grupos.palavrasBanidas.get(chatId) || [];
      for (const palavra of palavrasBanidas) {
        if (fullText.toLowerCase().includes(palavra)) {
          try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
          await sock.sendMessage(chatId, { text: ` *PALAVRA PROIBIDA*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
          return;
        }
      }
      const bloqueios = db.grupos.antiMidia.get(chatId);
      if (bloqueios && bloqueios.size > 0) {
        const m = msg.message;
        let tipo = null;
        if (m?.audioMessage) tipo = 'audio';
        else if (m?.videoMessage) tipo = 'video';
        else if (m?.imageMessage) tipo = 'imagem';
        else if (m?.documentMessage) tipo = 'documento';
        else if (m?.stickerMessage) tipo = 'sticker';
        else if (m?.productMessage) tipo = 'produto';
        else if (m?.orderMessage || m?.paymentMessage) tipo = 'pagamento';
        if (tipo && bloqueios.has(tipo)) {
          try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
          await sock.sendMessage(chatId, { text: `🛡️ *${tipo.toUpperCase()} BLOQUEADO*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
          return;
        }
      }
    }
  }
  
  // ══════════════════════════════════════════════════════════
  // ROTEADOR CENTRAL — COMANDOS SEM PREFIXO (NOVO)
  // ══════════════════════════════════════════════════════════
  if (fullText && !fullText.startsWith(CONFIG.prefix)) {
    const detecao = detectarComandoSemPrefixo(fullText);
    
    if (detecao && commands[detecao.comando]) {
      const cmdsDes = db.grupos.comandosDesativados.get(chatId);
      if (!(cmdsDes && cmdsDes.has(detecao.comando) && !utils.isOwner(senderId))) {
        const rl = verificarRateLimit(senderId, detecao.comando);
        if (rl.permitido) {
          const ctxRoteado = {
            chatId,
            senderId,
            isGroup,
            msg,
            args: detecao.args,
            _semPrefixo: true
          };
          
          // Comandos seguros: executar diretamente
          if (SEM_PREFIXO_SEGUROS.has(detecao.comando)) {
            try {
              await commands[detecao.comando](sock, ctxRoteado);
              await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
            } catch (e) {
              if (!(e instanceof PermissaoNegada)) console.error(`Erro .${detecao.comando}:`, e.message);
              await utils.reagir(sock, msg, '');
            }
            return;
          }
          
          // Comandos sensíveis: exigir aprovação (exceto dono do bot)
          if (COMANDOS_SENSIVEIS.has(detecao.comando)) {
            if (utils.isOwner(senderId)) {
              try {
                await commands[detecao.comando](sock, ctxRoteado);
                await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
              } catch (e) {
                await utils.reagir(sock, msg, '❌');
              }
              return;
            }
            
            // Verificar permissão direta
            let temPermissaoDireta = false;
            
            if (detecao.comando === 'banir') temPermissaoDireta = await utils.hasBanRights(sock, chatId, senderId);
            else if (detecao.comando === 'promover' || detecao.comando === 'rebaixar') temPermissaoDireta = await utils.hasPromoteRights(sock, chatId, senderId);
            else if (['fechar','abrir','apagar','nome','foto','marcartodos','agendar'].includes(detecao.comando)) temPermissaoDireta = await utils.hasGroupAdminRights(sock, chatId, senderId);
            else if (['antilink','antimidia','autodelete','proibirpalavra','desbanirpalavra','notificar','ia'].includes(detecao.comando)) temPermissaoDireta = await utils.hasAntiRights(sock, chatId, senderId);
            else if (['regras','boasvindas'].includes(detecao.comando)) temPermissaoDireta = await utils.hasRulesRights(sock, chatId, senderId);
            else if (detecao.comando === 'silenciar' || detecao.comando === 'dessilenciar' || detecao.comando === 'advertir' || detecao.comando === 'removeradvertencia') temPermissaoDireta = await utils.hasBanRights(sock, chatId, senderId);
            else if (detecao.comando === 'desativarcomando' || detecao.comando === 'ativarcomando') temPermissaoDireta = await utils.hasGroupAdminRights(sock, chatId, senderId);
            else if (['ativarvip','removervip'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
            else if (['desligarbot','ligarbot','ignorar','designorar','prefixo','backup','restaurar','modelo','entrar','atalho','removeratalho'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
            
            if (temPermissaoDireta) {
              try {
                await commands[detecao.comando](sock, ctxRoteado);
                await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
              } catch (e) {
                await utils.reagir(sock, msg, '❌');
              }
            } else {
              await solicitarAprovacao(sock, ctxRoteado, detecao);
            }
            return;
          }
          
          // Comandos não classificados: tratar como seguro
          try {
            await commands[detecao.comando](sock, ctxRoteado);
            await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
          } catch (e) {
            await utils.reagir(sock, msg, '❌');
          }
          return;
        } else {
          const seg = Math.ceil(rl.esperarMs / 1000);
          await sock.sendMessage(chatId, { text: `⏳ Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}` });
          return;
        }
      }
    }
  }
  // ══════════════════════════════════════════════════════════
  // FIM DO ROTEADOR CENTRAL
  // ══════════════════════════════════════════════════════════
  
  if (!fullText.startsWith(CONFIG.prefix)) {
    if (db.atalhos.has(fullText.toLowerCase().trim())) {
      const dadosAtalho = db.atalhos.get(fullText.toLowerCase().trim());
      return sock.sendMessage(chatId, { text: typeof dadosAtalho === 'string' ? dadosAtalho : dadosAtalho.texto });
    }
    const semPrefixoAtivo = db.grupos.semPrefixo.has(chatId);
    if (semPrefixoAtivo) {
      const partes = fullText.trim().split(/ +/);
      const cand = (partes[0] || '').toLowerCase();
      if (cand && commands[cand] && SEM_PREFIXO_SEGUROS.has(cand)) {
        const cmdsDes = db.grupos.comandosDesativados.get(chatId);
        if (!(cmdsDes && cmdsDes.has(cand))) {
          const rl = verificarRateLimit(senderId, cand);
          if (rl.permitido) {
            try { await commands[cand](sock, { chatId, senderId, isGroup, msg, args: partes.slice(1) }); await utils.reagir(sock, msg, COMANDO_EMOJIS[cand] || '✅'); } catch { await utils.reagir(sock, msg, '❌'); }
            return;
          }
        }
      }
    }
    const textoLower = fullText.toLowerCase();
    if (textoLower.includes('kortex') || textoLower.includes('bot') || textoLower.includes('@' + CONFIG.botNumber)) {
      const soChamouOBot = /^(kortex|bot)[!?. ]*$/i.test(fullText.trim());
      if (soChamouOBot) {
        const limiteMenu = verificarLimiteMenu(senderId, 'menu');
        if (!limiteMenu.permitido) { const seg = Math.ceil(limiteMenu.esperarMs / 1000); await sock.sendMessage(chatId, { text: `⏳ Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}` }); return; }
        await commands['menu'](sock, { chatId, senderId, isGroup, msg, args: [] });
        return;
      }
      if (utils.isOwner(senderId) && pareceIntentoSairGrupo(fullText)) { await sock.sendMessage(chatId, { text: ' Até já!' }); setTimeout(() => sock.groupLeave(chatId), 2000); return; }
      if (pareceIntentoQuemDono(fullText)) { await sock.sendMessage(chatId, { text: `👤 Fui criado por *${CONFIG.creator}*.\n📞 ${CONFIG.ownerNumber}` }); return; }
      const ctxAtalho = { chatId, senderId, isGroup, msg, args: [] };
      const temAlvo = !!(utils.getQuotedMention(msg) || utils.getMentions(msg).length);
      if (temAlvo && pareceIntentoBanir(fullText)) { await commands['banir'](sock, ctxAtalho); return; }
      if (pareceIntentoFecharGrupo(fullText)) { await commands['fechar'](sock, ctxAtalho); return; }
      if (pareceIntentoAbrirGrupo(fullText)) { await commands['abrir'](sock, ctxAtalho); return; }
      const temCitacao = !!msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
      if (temCitacao && pareceIntentoApagarMensagem(fullText)) { await commands['apagar'](sock, ctxAtalho); return; }
      if (utils.isOwner(senderId) && pareceIntentoRelatorio(fullText)) { await enviarRelatorioCompleto(sock, chatId); return; }
      const limiteChat = verificarLimiteConversaIA(senderId);
      if (!limiteChat.permitido) { const seg = Math.ceil(limiteChat.esperarMs / 1000); await sock.sendMessage(chatId, { text: `⏳ Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}` }); return; }
      const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), true);
      if (resposta) await sock.sendMessage(chatId, { text: `⚡ ${resposta}` });
      return;
    }
    if (db.grupos.iaAtivo.has(chatId) && fullText.length > 2) {
      const limiteChatLivre = verificarLimiteConversaIA(senderId);
      if (!limiteChatLivre.permitido) { const seg = Math.ceil(limiteChatLivre.esperarMs / 1000); await sock.sendMessage(chatId, { text: ` Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}`, quoted: msg }); return; }
      const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), true);
      if (resposta) await sock.sendMessage(chatId, { text: `⚡ ${resposta}`, quoted: msg });
      return;
    }
    if (textoLower === 'bom dia') { await utils.reagir(sock, msg, '☀️'); await sock.sendMessage(chatId, { text: ['Bom dia! ☀️', 'Bom diaaa! 🌅', 'Bom dia, craque! 💪'][Math.floor(Math.random() * 3)] }); }
    else if (textoLower === 'boa tarde') { await utils.reagir(sock, msg, '🌇'); await sock.sendMessage(chatId, { text: ['Boa tarde! 😊', 'Boa tarde! ', 'Boa tarde, chefe! ️'][Math.floor(Math.random() * 3)] }); }
    else if (textoLower === 'boa noite') { await utils.reagir(sock, msg, '🌙'); await sock.sendMessage(chatId, { text: ['Boa noite! ', 'Bons sonhos! ', 'Boa noite! 😴'][Math.floor(Math.random() * 3)] }); }
    else if (textoLower.includes('obrigado') || textoLower.includes('obrigada') || textoLower.includes('valeu')) { await utils.reagir(sock, msg, '⚡'); await sock.sendMessage(chatId, { text: ['De nada! 😊', 'Sempre às ordens! ⚡', 'Por nada, chefe! 🤝'][Math.floor(Math.random() * 3)] }); }
  }
  
  if (!isGroup && fullText && !fullText.startsWith(CONFIG.prefix)) {
    const semPrefixoPV = fullText.trim().split(/ +/);
    const candPV = (semPrefixoPV[0] || '').toLowerCase();
    if (candPV && commands[candPV] && SEM_PREFIXO_SEGUROS.has(candPV)) {
      const rl = verificarRateLimit(senderId, candPV);
      if (rl.permitido) {
        try { await commands[candPV](sock, { chatId, senderId, isGroup, msg, args: semPrefixoPV.slice(1) }); await utils.reagir(sock, msg, COMANDO_EMOJIS[candPV] || '✅'); } catch { await utils.reagir(sock, msg, '❌'); }
        return;
      }
    }
    if (utils.isOwner(senderId) && pareceIntentoRelatorio(fullText)) { await enviarRelatorioCompleto(sock, chatId); return; }
    const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), false);
    if (resposta) await sock.sendMessage(chatId, { text: `⚡ ${resposta}` });
    return;
  }
  
  if (fullText?.startsWith(CONFIG.prefix)) {
    const args = fullText.slice(CONFIG.prefix.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();
    if (cmd && commands[cmd]) {
      const cmdsDesativados = db.grupos.comandosDesativados.get(chatId);
      if (cmdsDesativados && cmdsDesativados.has(cmd) && !utils.isOwner(senderId)) { await utils.reagir(sock, msg, '🚫'); return; }
      if (MENU_COMANDOS.has(cmd)) {
        const limiteMenu = verificarLimiteMenu(senderId, cmd);
        if (!limiteMenu.permitido) { const seg = Math.ceil(limiteMenu.esperarMs / 1000); return await sock.sendMessage(chatId, { text: ` Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}` }); }
      }
      const rl = verificarRateLimit(senderId, cmd);
      if (!rl.permitido) { const seg = Math.ceil(rl.esperarMs / 1000); return await sock.sendMessage(chatId, { text: `⏳ Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}` }); }
      try { const cur = db.stats.get(cmd) || 0; db.stats.set(cmd, cur + 1); salvarDados(); } catch {}
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

let reconnectAttempts = 0, pausado = false, geracaoAtual = 0, sockAtual = null;
let ultimasMensagensIds = [];
let mensagensIgnoradas = new Set();
const rlTerminal = readline.createInterface({ input: process.stdin });
rlTerminal.on('line', (linha) => {
  const cmd = linha.trim().toLowerCase();
  if (cmd === 'parar' || cmd === '.parar') { geracaoAtual++; pausado = true; console.log('🛑 PARADO'); }
  else if (cmd === 'continuar' || cmd === '.continuar') { pausado = false; console.log('▶️ RETOMADO'); }
  else if (cmd === 'reiniciar' || cmd === '.reiniciar') { mensagensIgnoradas = new Set(ultimasMensagensIds); console.log(`🔄 A reiniciar — ${ultimasMensagensIds.length} mensagens ignoradas.`); try { sockAtual?.end(new Error('Reinício manual')); } catch {} }
  else if (cmd === 'status' || cmd === '.statuscmd') { console.log(`Estado: ${pausado ? '🛑 PAUSADO' : '✅ ATIVO'} | Geração: ${geracaoAtual}`); }
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
    return `${cyan}║${reset}${' '.repeat(esq)}${texto}${' '.repeat(espaco - esq)}${cyan}║${reset}`;
  };
  console.log(`\n${cyan}╔${'═'.repeat(largura)}╗${reset}`);
  console.log(centrar(''));
  console.log(centrar(`${bold}📲 CÓDIGO DE EMPARELHAMENTO${reset}`));
  console.log(centrar(''));
  console.log(centrar(`${bold}${verde}${codigo}${reset}`));
  console.log(centrar(''));
  console.log(centrar('WhatsApp > Dispositivos ligados'));
  console.log(centrar(' > Ligar com número de telefone'));
  console.log(centrar(''));
  console.log(`${cyan}╚${'═'.repeat(largura)}╝${reset}\n`);
}

async function startBot() {
  let sock;
  try {
    const { state, saveCreds } = await useMultiFileAuthState('sessao_kortex');
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
      printQRInTerminal: false, browser: ['Ubuntu', 'Chrome', '20.0.04'],
      logger: pino({ level: 'fatal' }), syncFullHistory: false, markOnlineOnConnect: true
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
    setInterval(() => {
      try {
        const AGORA = Date.now(); const TEMPO_MORTO = 2 * 60 * 60 * 1000; let limpos = 0;
        for (const [chatId, ultimoUso] of db.historicoIAUltimoUso) {
          if (AGORA - ultimoUso > TEMPO_MORTO) { db.historicoIA.delete(chatId); db.historicoIAUltimoUso.delete(chatId); limpos++; }
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
    setInterval(() => {
      const agora = new Date();
      const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
      for (const [groupId, ags] of agendamentos) {
        const paraEnviar = ags.filter(a => a.hora === hhmm);
        if (paraEnviar.length) {
          for (const a of paraEnviar) sock.sendMessage(groupId, { text: `📅 *AGENDAMENTO*\n\n${a.texto}` }).catch(() => {});
          agendamentos.set(groupId, ags.filter(a => a.hora !== hhmm));
          salvarDados();
        }
      }
    }, 30000);
    sock.ws.on('CB:call', async (json) => {
      try {
        const from = json.content?.[0]?.attrs?.from || json.attrs?.from;
        if (!from) return;
        const bloqueios = db.grupos.antiMidia.get(from) || new Set();
        if (bloqueios.has('ligacao')) {
          await sock.rejectCall(json.content?.[0]?.attrs?.['call-id'] || json.attrs?.id, from);
          await sock.sendMessage(from, { text: ' Ligações não são permitidas neste grupo.' }).catch(() => {});
        }
      } catch {}
    });
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
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || pausado) return;
      for (const msg of messages) {
        try { await processarMensagem(sock, msg); } catch (e) { console.error('Erro ao processar mensagem:', e.message); }
      }
    });
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { console.log('🚪 Bot desconectado (logout). Reinicia manualmente.'); return; }
        reconnectAttempts++;
        const delay = Math.min(5000 * reconnectAttempts, 60000);
        console.log(`🔄 Reconectando em ${delay / 1000}s... (${reconnectAttempts})`);
        setTimeout(startBot, delay);
      } else if (connection === 'open') {
        reconnectAttempts = 0;
        console.log('✅ KORTEX CONECTADO!');
        console.log(`📱 Número: ${sock.user.id}`);
        console.log(`⚡ Prefixo: ${CONFIG.prefix}`);
        console.log(`⚡ Criado por: ${CONFIG.creator}`);
      }
    });
  } catch (err) {
    console.error('❌ Erro ao iniciar:', err);
    reconnectAttempts++;
    setTimeout(startBot, Math.min(10000 * reconnectAttempts, 60000));
  }
}

console.log(`🚀 Iniciando ${CONFIG.botName}...`);
console.log(`👤 Criado por: ${CONFIG.creator}`);
startBot().catch(console.error);

module.exports = { CONFIG, db, commands, utils, startBot };
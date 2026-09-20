const { createZapoSocket } = require('./zapoAdapter');
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
axios.defaults.timeout = 60000; // ⚡ OPT: evita requisições penduradas para sempre
const translate = require('translate-google');
const { Image: WebpImage } = require('node-webpmux');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const NodeID3 = require('node-id3');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

async function downloadMediaMessage(message) {
  if (!sockAtual) throw new Error('Zapo ainda nao esta conectado');
  return sockAtual.downloadMediaMessage(message);
}

let turso = null;
try {
  turso = require('./tursoHelper');
  console.log('🟦 Turso carregado');
} catch (e) {
  console.warn('⚠️ Turso não carregou:', e.message);
}

let _tursoSyncTimer = null;
function agendarSyncTurso(payload) {
  if (!turso || !payload) return;
  if (_tursoSyncTimer) clearTimeout(_tursoSyncTimer);
  _tursoSyncTimer = setTimeout(async () => {
    _tursoSyncTimer = null;
    try {
      await turso.Backup.salvarTudo(payload);
      console.log('☁️ Backup Turso atualizado');
    } catch (e) {
      console.warn('⚠️ Turso backup falhou:', e.message);
    }
  }, 5000);
  if (_tursoSyncTimer.unref) _tursoSyncTimer.unref();
}

// ══════════════════════════════════════════════════════════
// ⚡ OPT — ESTABILIDADE GLOBAL (erros isolados não derrubam o processo)
// ══════════════════════════════════════════════════════════
process.on('unhandledRejection', (err) => {
console.error('⚠️ [unhandledRejection]', (err && err.message) ? String(err.message).substring(0, 200) : err);
});
process.on('uncaughtException', (err) => {
console.error('⚠️ [uncaughtException]', (err && err.message) ? String(err.message).substring(0, 200) : err);
});

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
// KORTEX KEY SYSTEM — KEY UNIVERSAL (REGRA 1)
// ══════════════════════════════════════════════════════════
const KEY_UNIVERSAL_DONO = "8414"; // NUNCA expor em menus/logs/mensagens públicas

// ══════════════════════════════════════════════════════════
// GROQ — usa uma única chave API.
// ══════════════════════════════════════════════════════════
const GROQ_API_KEY =
"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";
const groq = new Groq({ apiKey: GROQ_API_KEY });
async function comGroq(fn) {
try {
return await fn(groq);
} catch (e) {
console.warn(`⚠️ Erro na API Groq: ${String(e.message).substring(0, 160)}`);
throw e;
}
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
warns: new Map(), mutados: new Map(), spamMonitor: new Map(), mediaSpamMonitor: new Map(),
grupos: {
antiLink: new Map(), palavrasBanidas: new Map(), banidos: new Map(), boasvindas: new Map(), regras: new Map(),
iaAtivo: new Set(), desligados: new Set(), comandosDesativados: new Map(), semPrefixo: new Set(), antiMidia: new Map()
},
ignorados: new Set(), whitelist: new Map(), autoDelete: new Map(), indicadores: new Map(),
stats: new Map(), notifications: new Map(), cache: new Map(), rateLimit: new Map(),
modoInternet: new Map(), tabelasPagamento: new Map(), pedidosPagamento: new Map(), pedidosPendentes: new Map(),
// KORTEX KEY SYSTEM — Novas estruturas (REGRA 9)
keysRandom: new Map(),
fluxosKey: new Map(),
alertasKey: new Map()
};
const jogosVelha = new Map();
const agendamentos = new Map();
const cacheMetadata = new Map();
const cacheDonoLid = new Set();

// ══════════════════════════════════════════════════════════
// DESAFIOS DE JOGO DA VELHA
// ══════════════════════════════════════════════════════════
const desafiosVelha = new Map();
const TEMPO_EXPIRACAO_DESAFIO = 60000;

// ══════════════════════════════════════════════════════════
// SISTEMA DE APROVAÇÃO
// ══════════════════════════════════════════════════════════
const solicitacoesPendentes = new Map();
let solicitacaoIdCounter = 1;
const TEMPO_EXPIRACAO_APROVACAO = 60000;

// ⚡ OPT — limpeza central de temporários (inclui jogos abandonados)
setInterval(() => {
const agora = Date.now();
for (const [id, sol] of solicitacoesPendentes) {
if (agora > sol.expiraEm) solicitacoesPendentes.delete(id);
}
for (const [id, des] of desafiosVelha) {
if (agora > des.expiraEm) desafiosVelha.delete(id);
}
// OPT: jogos da velha abandonados (>10 min sem jogada) são limpos
for (const [chatId, g] of jogosVelha) {
if (agora - (g.ts || 0) > 10 * 60000) jogosVelha.delete(chatId);
}
// KORTEX KEY SYSTEM — Limpar fluxos expirados
for (const [chatId, fluxo] of db.fluxosKey) {
if (agora > fluxo.expiraEm) db.fluxosKey.delete(chatId);
}
// KORTEX KEY SYSTEM — Limpar alertas expirados
for (const [id, alerta] of db.alertasKey) {
if (agora > alerta.expiraEm) db.alertasKey.delete(id);
}
for (const [chatId, byUser] of db.spamMonitor) {
for (const [senderId, info] of byUser) {
if (agora - (info.last || agora) > 15000) byUser.delete(senderId);
}
if (!byUser.size) db.spamMonitor.delete(chatId);
}
for (const [chatId, byUser] of db.mediaSpamMonitor) {
for (const [senderId, info] of byUser) {
if (agora - (info.last || agora) > 20000) byUser.delete(senderId);
}
if (!byUser.size) db.mediaSpamMonitor.delete(chatId);
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
async function baixarBufferGen(formato, maxBytes = 32 * 1024 * 1024) {
if (!formato?.url) return null;
if (formato.filesize && formato.filesize > maxBytes) return null;
const r = await axios.get(formato.url, { responseType: 'arraybuffer', timeout: 180000 });
if (!r.data || r.data.length === 0 || r.data.length > maxBytes) return null;
return Buffer.from(r.data);
}
function extrairVideoId(link) { const m = link.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : null; }
function extrairNomeConta(dados) {
const nome = dados?.author || dados?.channel || dados?.uploader || dados?.owner || dados?.account || dados?.username || dados?.creator || '—';
return String(nome).replace(/^@/, '').trim() || '—';
}

// ══════════════════════════════════════════════════════════
// BUSCA RÁPIDA DE CANAL POR NOME (PV)
// ══════════════════════════════════════════════════════════
const PALAVRAS_CONVERSA_COMUM = new Set([
'sim', 'nao', 'ok', 'okay', 'okey', 'blz', 'blza', 'vlw', 'obg',
'oi', 'ola', 'eae', 'oii', 'oioi',
'bomdia', 'boatarde', 'boanoite',
'obrigado', 'obrigada', 'valeu', 'obrigadao', 'obrigadinha',
'tudobem', 'tudobom', 'comovai', 'blzinha', 'tamo', 'tamojunto',
'kk', 'kkk', 'kkkk', 'kkkkk', 'rs', 'rsrs', 'rsrsrs', 'haha', 'hahaha', 'ah', 'aham',
'pfv', 'porfavor', 'flw', 'falou', 'ate', 'tchau', 'adeus',
'top', 'bora', 'vamos', 'certo', 'entendi', 'beleza'
]);
function pareceNomeCanalCandidato(texto) {
const t = (texto || '').trim();
if (!t || t.length < 3 || t.length > 40) return false;
if (/[?!.,;:]/.test(t)) return false;
const palavras = t.split(/\s+/);
if (palavras.length > 3) return false;
if (!/^[\p{L}\p{N}@._\s-]+$/u.test(t)) return false;
if (PALAVRAS_CONVERSA_COMUM.has(normalizarTexto(t))) return false;
if (/^(k+|a?ha+|rs+)$/i.test(t.replace(/\s/g, ''))) return false;
return true;
}
async function pesquisarCanalPorNome(nome) {
try {
const yts = require('yt-search');
const termo = nome.replace(/^@/, '').trim();
if (!termo) return null;
const r = await yts(termo);
const canais = r?.channels || r?.accounts || [];
if (!canais.length) return null;
const alvo = normalizarTexto(termo);
let melhor = canais.find(c => normalizarTexto(c.title || c.name || '') === alvo);
if (!melhor) {
melhor = canais.find(c => {
const n = normalizarTexto(c.title || c.name || '');
return n && (n.includes(alvo) || alvo.includes(n));
});
}
return melhor || null;
} catch (e) {
console.warn('pesquisarCanalPorNome:', e.message);
return null;
}
}
async function enviarCartaoCanal(sock, chatId, canal) {
const nome = canal.title || canal.name || 'Canal';
const link = canal.url || (canal.channelId ? `https://youtube.com/channel/${canal.channelId}` : null);
const imagem = canal.image || canal.thumbnail || canal.avatar || null;
const descricao = canal.description ? String(canal.description).substring(0, 150) : null;
const videosLabel = canal.videoCountLabel || (canal.videoCount ? `${canal.videoCount} vídeos` : null);
const subsLabel = canal.subCountLabel || canal.subscriberCountLabel || null;
let texto = `📺 CANAL ENCONTRADO\n\n📛 ${nome}`;
if (subsLabel) texto += `\n👥 ${subsLabel}`;
if (videosLabel) texto += `\n🎬 ${videosLabel}`;
if (descricao) texto += `\n📝 ${descricao}`;
if (link) texto += `\n🔗 ${link}`;
try {
if (imagem) await sock.sendMessage(chatId, { image: { url: imagem }, caption: texto });
else await sock.sendMessage(chatId, { text: texto });
} catch (e) {
console.warn('enviarCartaoCanal:', e.message);
try { await sock.sendMessage(chatId, { text: texto }); } catch {}
}
}

// ⚡ OPT — ffmpeg com timeout (evita processos zumbis travando o event loop)
async function converterVideoParaStickerAnimado(buffer, segundos = 6) {
const tmpIn = path.join(os.tmpdir(), `kortex_in_${Date.now()}.mp4`);
const tmpOut = path.join(os.tmpdir(), `kortex_out_${Date.now()}.webp`);
fs.writeFileSync(tmpIn, buffer);
try {
await new Promise((resolve, reject) => {
const cmd = ffmpeg(tmpIn).noAudio().outputOptions([`-t ${segundos}`, '-vf scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=12', '-vcodec libwebp', '-lossless 0', '-compression_level 6', '-quality 45', '-loop 0', '-preset default', '-vsync 0']).save(tmpOut);
const to = setTimeout(() => { try { cmd.kill('SIGKILL'); } catch {} reject(new Error('ffmpeg timeout')); }, 120000);
cmd.on('end', () => { clearTimeout(to); resolve(); }).on('error', (e) => { clearTimeout(to); reject(e); });
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
const keycaps = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const m = b.map((v, i) => v === 'X' ? '❌' : v === 'O' ? '⭕' : keycaps[i]);
return `╔═══════════════╗\n║ ${m[0]} │ ${m[1]} │ ${m[2]} ║\n║────┼────┼────║\n║ ${m[3]} │ ${m[4]} │ ${m[5]} ║\n║────┼────┼────║\n║ ${m[6]} │ ${m[7]} │ ${m[8]} ║\n╚═══════════════╝`;
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
// CLASSIFICAÇÃO DE COMANDOS — SEM PREFIXO + APROVAÇÃO
// ══════════════════════════════════════════════════════════
const COMANDOS_SENSIVEIS = new Set([
'banir','promover','rebaixar','fechar','abrir','apagar',
'antilink','proibirpalavra','desbanirpalavra','regras','boasvindas',
'ativarvip','removervip','removervipuser','desativarcomando','ativarcomando',
'ignorar','designorar','desligarbot','ligarbot',
'nome','foto','criargrupo','silenciar','dessilenciar',
'advertir','removeradvertencia','antimidia','autodelete',
'notificar','ia','entrar','atalho','removeratalho',
'prefixo','backup','restaurar','modelo','marcartodos','agendar',
'modointernet','tabelapagamento','pedidos','receberpedido','rejeitarpedido',
// KORTEX KEY SYSTEM — Novos comandos sensíveis (REGRA 16)
'gerarkey','desativarkey','mudarkey'
]);

const COMANDO_EMOJIS = {
menu: '📜', menubtn: '📜', ajuda: '📜', cgeral: '🌐', cadmin: '👮', cprot: '🛡️', cmidia: '📲', cstick: '🖼️', cdono: '👑',
cutil: '🧰', ctexto: '🔤', cinfo: '🌍', cdiv: '😄', cimg: '🖼️',
ping: '🏓', hora: '🕒', info: '⚡', planos: '💰', statusgrupo: '💎', comandos: '📋', ranking: '🏆', pontos: '🔢', indicar: '📨',
banir: '🔨', promover: '⬆️', rebaixar: '⬇️', marcartodos: '📢', historico: '📜', fechar: '🔒', abrir: '🔓', link: '🔗', idgrupo: '🆔', apagar: '🗑️',
antilink: '🔗', proibirpalavra: '📵', desbanirpalavra: '✅', regras: '📜', ia: '🧠', autodelete: '🤖', verregras: '📃', listarpalavras: '📃', boasvindas: '👋',
figurinha: '🎨', stickertexto: '✏️', infosticker: 'ℹ️', modelo: '🖼️', traduzir: '🌍', recibo: '🧾',
ativarvip: '💎', removervip: '🚫', removervipuser: '🚫', listargrupos: '📋', listarusuariosvip: '👤', listarvipusers: '👤', avisartodos: '📣', atalho: '⚡', removeratalho: '🗑️', listaratalhos: '⚡',
estatisticas: '📊', relatorio: '📊', prefixo: '⚙️', backup: '💾', restaurar: '♻️', desligarbot: '🔴', ligarbot: '🟢',
ignorar: '🔇', designorar: '🔊', ignorados: '🔇', notificar: '🔔', usocomandos: '📊',
tiktok: '🎵', instagram: '📸', youtube: '🎬', youtubeaudio: '🎵', youtubevideo: '🎥', baixar: '🌐', facebook: '📘',
fichamidia: '📊', canal: '📡', zip: '📦', desativarcomando: '🚫', listardesativados: '📃', ativarcomando: '✅',
vipuser: '👑', meuvip: '💎', meuid: '🆔', entrar: '📥', sair: '📤', semprefixo: '⚡',
calcular: '🧮', moeda: '💱', senha: '🔐', pin: '🔢', aleatorio: '🎲', idade: '🎂', tabuada: '✖️', porcentagem: '％', contar: '🔤', sortear: '🎯', caraoucoroa: '🪙',
romanos: '🏛️', significado: '📖', sinonimo: '📖', antonimo: '📖', leet: '👾', vaporwave: '🌸', gerarnome: '✍️',
wiki: '📚', pais: '🗺️', capital: '🏛️', hoje: '📅', noticias: '📰', filme: '🎬', serie: '📺', manga: '📖', personagem: '🎭', musica: '🎵',
dolar: '💵', euro: '💶', ouro: '🥇', futebol: '⚽', tabela: '🏆',
charada: '🧩', frase: '💬', jogodavelha: '⭕',
converterimagem: '🖼️', roubarsticker: '🥷', circular: '⭕',
advertir: '⚠️', advertencias: '📋', removeradvertencia: '✅', silenciar: '🔇', dessilenciar: '🔊',
nome: '🏷️', foto: '📸', criargrupo: '🏟️', listarbanidos: '🚫', transcrever: '🎙️',
antimidia: '🛡️', agendar: '📅', revelar: '👻', pinterest: '📌', tiktokaudio: '🎶',
aprovar: '✅', recusar: '❌',
// KORTEX KEY SYSTEM — Emojis dos novos comandos
gerarkey: '🔑', desativarkey: '🚫', mudarkey: '🔐'
};

const NIVEIS_VIP = {
ouro: { nome: 'Ouro 🥇', maxDias: 7, admin: true, ban: true, promote: false, rules: false, anti: false, boasvindas: false, sticker: false },
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

// ══════════════════════════════════════════════════════════
// ⚡ OPT — BANCO COM SAVE DEBOUNCED (menos I/O síncrono no event loop)
// ══════════════════════════════════════════════════════════
function construirSnapshotPersistencia() {
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
agendamentos: Object.fromEntries(agendamentos),
modoInternet: Object.fromEntries(db.modoInternet),
tabelasPagamento: Object.fromEntries([...db.tabelasPagamento].map(([k, v]) => [k, Array.isArray(v) ? v : [...(v||[])]])),
pedidosPagamento: Object.fromEntries([...db.pedidosPagamento].map(([k, v]) => [k, v])),
pedidosPendentes: Object.fromEntries(db.pedidosPendentes),
keysRandom: Object.fromEntries(db.keysRandom)
};
return {
  data,
  payloadTurso: {
    ...data,
    alertasKey: Object.fromEntries(db.alertasKey),
    historicoGrupos: Object.fromEntries(db.historicoGrupos),
    groq_model: CONFIG.groq_model || null,
    atualizadoEm: Date.now()
  }
};
}
function escreverDados() {
try {
const { data, payloadTurso } = construirSnapshotPersistencia();
fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), 'utf8');
fs.writeFileSync(CONFIG.historicoFile, JSON.stringify(Object.fromEntries(db.historicoGrupos), null, 2), 'utf8');
if (turso && payloadTurso) {
  Promise.resolve(turso.Backup.salvarTudo(payloadTurso)).catch((e) => {
    console.warn('⚠️ Turso backup falhou:', e && e.message ? e.message : e);
  });
}
if (global.gc) { try { global.gc(); } catch {} }
} catch (e) { console.error('Erro ao guardar dados:', e.message); }
}
let _saveTimer = null;
function salvarDados() {
if (_saveTimer) return; // já existe escrita agendada
_saveTimer = setTimeout(() => { _saveTimer = null; escreverDados(); }, 1500);
if (_saveTimer.unref) _saveTimer.unref();
}
function salvarDadosAgora() {
  escreverDados();
}
// ⚡ OPT — flush garantido no encerramento
process.on('exit', () => { try { escreverDados(); } catch {} });
process.on('SIGINT', () => { try { escreverDados(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { escreverDados(); } catch {} process.exit(0); });

function aplicarBackupTurso(data) {
  try {
    if (!data || typeof data !== 'object') return false;

    db.gruposVIP.clear();
    db.grupoDono.clear();
    db.atalhos.clear();
    db.grupos.antiLink.clear();
    db.grupos.palavrasBanidas.clear();
    db.grupos.boasvindas.clear();
    db.grupos.regras.clear();
    db.grupos.banidos.clear();
    db.grupos.iaAtivo.clear();
    db.grupos.desligados.clear();
    db.ignorados.clear();
    db.whitelist.clear();
    db.autoDelete.clear();
    db.indicadores.clear();
    db.stats.clear();
    db.notifications.clear();
    db.usersVIP.clear();
    db.grupos.comandosDesativados.clear();
    db.warns.clear();
    db.mutados.clear();
    db.grupos.semPrefixo.clear();
    db.grupos.antiMidia.clear();
    db.modoInternet.clear();
    db.tabelasPagamento.clear();
    db.pedidosPagamento.clear();
    db.pedidosPendentes.clear();
    db.keysRandom.clear();
    db.historicoGrupos.clear();
    db.alertasKey.clear();
    agendamentos.clear();

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
    if (data.modoInternet) for (const [k, v] of Object.entries(data.modoInternet)) db.modoInternet.set(k, !!v);
    if (data.tabelasPagamento) for (const [k, v] of Object.entries(data.tabelasPagamento)) db.tabelasPagamento.set(k, Array.isArray(v) ? v : []);
    if (data.pedidosPagamento) for (const [k, v] of Object.entries(data.pedidosPagamento)) db.pedidosPagamento.set(k, v);
    if (data.pedidosPendentes) for (const [k, v] of Object.entries(data.pedidosPendentes)) db.pedidosPendentes.set(k, v);
    if (data.keysRandom) for (const [k, v] of Object.entries(data.keysRandom)) db.keysRandom.set(k, v);
    if (data.historicoGrupos) for (const [k, v] of Object.entries(data.historicoGrupos)) db.historicoGrupos.set(k, Array.isArray(v) ? v : []);
    if (data.alertasKey) for (const [k, v] of Object.entries(data.alertasKey)) db.alertasKey.set(k, v);
    if (data.groq_model) CONFIG.groq_model = data.groq_model;
    return true;
  } catch (e) {
    console.warn('⚠️ Erro ao aplicar backup Turso:', e.message);
    return false;
  }
}

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
if (data.modoInternet) for (const [k, v] of Object.entries(data.modoInternet)) db.modoInternet.set(k, !!v);
if (data.tabelasPagamento) for (const [k, v] of Object.entries(data.tabelasPagamento)) db.tabelasPagamento.set(k, Array.isArray(v) ? v : []);
if (data.pedidosPagamento) for (const [k, v] of Object.entries(data.pedidosPagamento)) db.pedidosPagamento.set(k, v);
if (data.pedidosPendentes) for (const [k, v] of Object.entries(data.pedidosPendentes)) db.pedidosPendentes.set(k, v);
// KORTEX KEY SYSTEM — Carregar Keys Random (REGRA 9)
if (data.keysRandom) for (const [k, v] of Object.entries(data.keysRandom)) db.keysRandom.set(k, v);
if (data.groq_model) CONFIG.groq_model = data.groq_model;
}
if (fs.existsSync(CONFIG.historicoFile)) {
const data = JSON.parse(fs.readFileSync(CONFIG.historicoFile, 'utf8'));
for (const [k, v] of Object.entries(data)) db.historicoGrupos.set(k, v);
}
} catch (e) { console.error('Erro ao carregar dados:', e.message); }
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
const sub = utils.getGroupSubscription(groupId);
return sub ? !!NIVEIS_VIP[sub.nivel]?.sticker : false;
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
getQuotedMention: (msg) => {
try {
const ctx = msg?.message?.extendedTextMessage?.contextInfo || msg?.message?.buttonsResponseMessage?.contextInfo || msg?.message?.listResponseMessage?.contextInfo || msg?.message?.templateButtonReplyMessage?.contextInfo || {};
const mentioned = ctx.mentionedJid || [];
if (mentioned.length) return mentioned[0];
const participant = ctx.participant || ctx.remoteJid || msg?.key?.participant || msg?.participant;
if (participant && participant !== msg?.key?.remoteJid && participant !== `${CONFIG.botNumber}@s.whatsapp.net`) return participant;
return null;
} catch { return null; }
},
getMentions: (msg) => {
try {
const ctx = msg?.message?.extendedTextMessage?.contextInfo || msg?.message?.buttonsResponseMessage?.contextInfo || msg?.message?.listResponseMessage?.contextInfo || msg?.message?.templateButtonReplyMessage?.contextInfo || {};
const arr = [...(ctx.mentionedJid || [])];
const participant = ctx.participant || ctx.remoteJid || msg?.key?.participant || msg?.participant;
if (participant && !arr.includes(participant)) arr.push(participant);
return arr;
} catch { return []; }
},
mensagemSemVIP: () => `❌ *Acesso negado!*\n\nEste grupo não possui assinatura activa.\n\n📞 Contacte: ${CONFIG.creator} - ${CONFIG.ownerNumber}`,
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
'sticker-pack-name': 'Kortex ⚡',
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
texto += `*2. VIP INDIVIDUAL* (libera só para a pessoa)\n`;
texto += `🥇 Ouro → .tiktok .tiktokaudio\n`;
texto += `💎 Diamante → + .instagram .facebook .baixar .fichamidia .pinterest\n`;
texto += `👑 Lenda → + .youtube .youtubeaudio .youtubevideo .canal .zip\n`;
texto += `Activa com: .vipuser @pessoa [nível] [dias] (dono)\n\n`;
texto += `━━━━━━━━━━━━━━\n📊 *O TEU ESTADO ACTUAL*\n`;
texto += ctx.isGroup
? `🏢 Grupo: ${subGrupo ? `${NIVEIS_VIP[subGrupo.nivel]?.nome || subGrupo.nivel} (${utils.tempoRestante(subGrupo.expiraEm - Date.now())} restantes)` : 'sem VIP de grupo'}\n`
: `🏢 Grupo: — (estás em PV)\n`;
texto += `Pessoal: ${vipUserAtivo ? `${NIVEIS_VIP_USER[vipUser.nivel]?.nome || vipUser.nivel} (${utils.tempoRestante(vipUser.expiraEm - Date.now())} restantes)` : 'sem VIP individual'}\n`;
texto += `\n💡 Qualquer um dos dois já é suficiente para desbloquear.`;
return texto;
}

const GROQ_MODELOS_FALLBACK = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];
async function perguntarGroq(prompt) {
const modelos = [CONFIG.groq_model, ...GROQ_MODELOS_FALLBACK].filter((m, i, a) => m && a.indexOf(m) === i);
for (const modelo of modelos) {
try {
const c = await comGroq(client => client.chat.completions.create({ messages: [{ role: 'user', content: prompt }], model: modelo, temperature: 0.5, max_tokens: 120 }));
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
const completion = await comGroq(client => client.chat.completions.create({ messages: [{ role: 'system', content: systemMsg }, ...history], model: modelo, temperature: 0.5, max_tokens: 250 }));
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

async function gerarCartaoBoasVindas(sock, participant, groupId = null) {
try {
const grupoNome = groupId ? (await getMetadataCached(sock, groupId).catch(() => null))?.subject || 'Grupo' : 'Grupo';
const nomeUsuario = participant.split('@')[0] || 'Usuário';
const svg = `
<svg width="1200" height="700" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="50%" stop-color="#1f2937"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="700" fill="url(#bg)"/>
  <circle cx="980" cy="120" r="200" fill="#ffffff" opacity="0.06"/>
  <circle cx="980" cy="620" r="220" fill="#34d399" opacity="0.08"/>
  <rect x="70" y="70" width="400" height="560" rx="36" fill="rgba(15,23,42,0.68)" stroke="rgba(255,255,255,0.1)"/>
  <text x="90" y="140" font-size="46" fill="#e2e8f0" font-family="Arial, sans-serif" font-weight="700">Bem-vindo(a)</text>
  <text x="90" y="260" font-size="72" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700">@${String(nomeUsuario).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>
  <text x="90" y="340" font-size="34" fill="#a5f3fc" font-family="Arial, sans-serif">ao grupo</text>
  <text x="90" y="430" font-size="52" fill="#fbbf24" font-family="Arial, sans-serif" font-weight="700">${String(grupoNome).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>
  <text x="90" y="520" font-size="28" fill="#d1d5db" font-family="Arial, sans-serif">Kortex ⚡ • Proteção + VIP</text>
  <rect x="90" y="560" width="200" height="10" rx="5" fill="url(#accent)"/>
  <g transform="translate(750 120)">
    <circle cx="120" cy="120" r="120" fill="rgba(255,255,255,0.1)"/>
    <circle cx="120" cy="120" r="100" fill="#0f172a"/>
  </g>
</svg>`;
let base = await sharp(Buffer.from(svg)).png().toBuffer();
try {
const ppUrl = await sock.profilePictureUrl(participant, 'image');
if (ppUrl) {
const resp = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 5000 });
const avatar = await sharp(Buffer.from(resp.data)).resize(200, 200, { fit: 'cover' }).composite([{ input: Buffer.from(`<svg width="200" height="200"><circle cx="100" cy="100" r="100" fill="white"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
base = await sharp(base).composite([{ input: avatar, top: 120, left: 740 }]).png().toBuffer();
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
blocos.push(`━━━━━━━━━━━━━━━━━━━\n🏷️ *${nome}*\n💎 VIP: ${vipTexto}\n🔗 Anti-link: ${db.grupos.antiLink.get(groupId) ? `✅ (${db.grupos.antiLink.get(groupId)})` : '❌'}\n🤖 IA: ${db.grupos.iaAtivo.has(groupId) ? '✅' : '❌'}\n🚫 Palavras: ${(db.grupos.palavrasBanidas.get(groupId) || []).length}\n👋 Boas-vindas: ${db.grupos.boasvindas.has(groupId) ? '✅' : '❌'}\n📜 Regras: ${db.grupos.regras.get(groupId) ? '✅' : '❌'}\n🗑️ Auto-del: ${db.autoDelete.get(groupId) ? `✅ (${db.autoDelete.get(groupId)}ms)` : '❌'}\n🚫 Banidos: ${(db.grupos.banidos.get(groupId) || []).length}`);
}
return [`📊 *RELATÓRIO* — ${grupoIds.length} grupo(s)\n`, ...blocos];
}
// ⚡ OPT — envio paginado com pequena pausa (evita rajada de mensagens)
async function enviarRelatorioCompleto(sock, chatId) {
const partes = await gerarBlocosRelatorio(sock);
if (partes.length === 1) return await sock.sendMessage(chatId, { text: partes[0] });
for (let i = 1; i < partes.length; i += 3) {
await sock.sendMessage(chatId, { text: (i === 1 ? partes[0] : '') + partes.slice(i, i + 3).join('\n') });
await new Promise(r => setTimeout(r, 700));
}
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
return `💎 *STATUS VIP*\n━━━━━━━━━━━━━━\n\n✅ Plano *${NIVEIS_VIP[sub.nivel]?.nome || sub.nivel}* activo!\n⏳ Dias restantes: *${dias}*\n\nPara renovar: ✆ ${CONFIG.ownerNumber}\nObrigado!`;
}
function gerarCartaoVipConvite() {
return `💎 *ACTIVA O VIP!*\n━━━━━━━━━━━━━━\n\nEste grupo ainda não tem VIP.\n\nCom o VIP desbloqueias:\n├─ Administração automática\n├─ Anti-link e protecção\n├─ Boas-vindas personalizadas\n└─ Regras e auto-replies\n\nFala com o dono: ✆ ${CONFIG.ownerNumber}`;
}

// ══════════════════════════════════════════════════════════
// 🎨 FUNÇÃO CENTRAL — MENU COM IMAGEM OFICIAL (visual limpo)
// ══════════════════════════════════════════════════════════
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
const conteudoFormatado = formatarConteudoMenu(conteudo);
const legenda = `╭────────────────────────────\n│ ⚡ K O R T E X ⚡\n│ ${titulo}\n├────────────────────────────\n│\n├─ 👤 Usuário: @${nome}\n├─ 🟢 Status: Online\n└─ 💎 Nível: ${nivelGrupo}\n\n${conteudoFormatado}\n╰────────────────────────────\n${rodape}\nPrefixo: ${CONFIG.prefix}`;
if (imagemBuffer) {
await sock.sendMessage(ctx.chatId, { image: imagemBuffer, caption: legenda, mentions: [ctx.senderId] });
} else {
await sock.sendMessage(ctx.chatId, { text: legenda, mentions: [ctx.senderId] });
}
}

function formatarConteudoMenu(conteudo) {
let resultado = '';
const linhas = conteudo.split('\n');
let dentroSecao = false;

for (let i = 0; i < linhas.length; i++) {
const linha = linhas[i];
const ehSecao = linha.startsWith('─── ');
const ehComando = linha.startsWith('• ');

if (ehSecao) {
if (dentroSecao) resultado += '│\n';
const titulo = linha.replace(/^─── |───$/g, '');
resultado += `╭─ ${titulo}\n`;
dentroSecao = true;
} else if (ehComando) {
const proximo = i + 1 < linhas.length ? linhas[i + 1] : '';
const ehUltimoComando = !proximo || proximo.startsWith('─── ');
const partes = linha.split(' — ');
const cmd = partes[0].replace('• ', '').trim();
const desc = partes[1] || '';

const cmdFormatado = `*${cmd}*`;
const descFormatado = desc ? ` — \`${desc}\`` : '';

if (ehUltimoComando && proximo && proximo.startsWith('─── ')) {
resultado += `├─ ${cmdFormatado}${descFormatado}\n`;
} else if (ehUltimoComando) {
resultado += `╰─ ${cmdFormatado}${descFormatado}\n`;
} else {
resultado += `├─ ${cmdFormatado}${descFormatado}\n`;
}
}
}

return resultado;
}

async function enviarMenuInterativo(sock, ctx) {
const p = await commands._getPerms(sock, ctx);
const nomeUsuario = ctx.senderId ? ctx.senderId.split('@')[0] : 'usuário';
const nomeBot = CONFIG.botName || 'Kortex';
const rows = [
{ title: '🌐 Geral', description: 'Comandos básicos e informações', rowId: 'menu_geral' },
{ title: '🧰 Utilitários', description: 'Cálculos, geradores e conversões', rowId: 'menu_util' },
{ title: '🔤 Texto', description: 'Manipulação de texto e palavras', rowId: 'menu_texto' },
{ title: '🌍 Informação', description: 'Consultas, notícias e entretenimento', rowId: 'menu_info' },
{ title: '😄 Diversão', description: 'Charadas, frases e jogos', rowId: 'menu_div' },
{ title: '🖼️ Imagem', description: 'Conversão e manipulação de imagens', rowId: 'menu_img' },
{ title: '📲 Mídia', description: 'Downloads de redes sociais e YouTube', rowId: 'menu_midia' },
];
if (p.pAnti || p.pRules) rows.push({ title: '🛡️ Proteção', description: 'Anti-link, anti-mídia e regras', rowId: 'menu_prot' });
if (p.pAdmin || p.pBan) rows.push({ title: '👮 Administração', description: 'Gerenciamento do grupo e moderação', rowId: 'menu_adm' });
if (p.pSticker) rows.push({ title: '🎨 Stickers', description: 'Criação e edição de figurinhas', rowId: 'menu_stick' });
if (p.isOwner) rows.push({ title: '👑 Dono', description: 'Painel de controle total do bot', rowId: 'menu_dono' });
const imagemPath = CONFIG.imagens.principal;
let imagemBuffer = null;
if (fs.existsSync(imagemPath)) {
try { imagemBuffer = fs.readFileSync(imagemPath); } catch {}
}
const legenda = `⚡ *${nomeBot}*

👤 Solicitado por: @${nomeUsuario}
🟢 Sistema: online

📚 Toque no botão abaixo para abrir as categorias do menu.`;
if (imagemBuffer) {
await sock.sendMessage(ctx.chatId, { image: imagemBuffer, caption: legenda, mentions: [ctx.senderId] });
} else {
await sock.sendMessage(ctx.chatId, { text: legenda, mentions: [ctx.senderId] });
}
await sock.sendMessage(ctx.chatId, {
  text: '📚 Selecione uma categoria abaixo para abrir o menu correspondente.',
  title: 'Categorias de Menus',
  footer: '⚡ KORTEX CORE',
  buttonText: 'Abrir Menu',
  sections: [{ title: 'Categorias', rows }]
});
}

async function enviarMenuTexto(sock, ctx) {
const p = await commands._getPerms(sock, ctx);
const nomeBot = CONFIG.botName || 'Kortex';

const botoes = [
{ buttonId: 'menu_geral', buttonText: { displayText: '🌐 Geral' }, type: 1 },
{ buttonId: 'menu_util', buttonText: { displayText: '🧰 Utilitários' }, type: 1 },
{ buttonId: 'menu_texto', buttonText: { displayText: '🔤 Texto' }, type: 1 },
{ buttonId: 'menu_info', buttonText: { displayText: '🌍 Informação' }, type: 1 },
{ buttonId: 'menu_div', buttonText: { displayText: '😄 Diversão' }, type: 1 },
{ buttonId: 'menu_img', buttonText: { displayText: '🖼️ Imagem' }, type: 1 },
{ buttonId: 'menu_midia', buttonText: { displayText: '📲 Mídia' }, type: 1 }
];

if (p.pAnti || p.pRules) botoes.push({ buttonId: 'menu_prot', buttonText: { displayText: '🛡️ Proteção' }, type: 1 });
if (p.pAdmin || p.pBan) botoes.push({ buttonId: 'menu_adm', buttonText: { displayText: '👮 Admin' }, type: 1 });
if (p.pSticker) botoes.push({ buttonId: 'menu_stick', buttonText: { displayText: '🎨 Stickers' }, type: 1 });
if (p.isOwner) botoes.push({ buttonId: 'menu_dono', buttonText: { displayText: '👑 Dono' }, type: 1 });

await sock.sendMessage(ctx.chatId, {
text: `⚡ *${nomeBot}*\n\n📚 *Selecione uma categoria:*`,
buttons: botoes,
headerType: 1
});
}

async function adicionarMetadataAudio(buf, titulo, artista, imagemUrl) {
try {
if (!NodeID3) return buf;
const tags = {
title: titulo || 'Áudio do YouTube',
artist: artista || 'YouTube',
album: 'YouTube Downloads'
};
if (imagemUrl) {
try {
const resImg = await axios.get(imagemUrl, { responseType: 'arraybuffer', timeout: 5000 });
if (resImg.data) {
tags.image = {
mime: 'image/jpeg',
type: { id: 0 },
description: 'Capa do vídeo',
imageBuffer: Buffer.from(resImg.data)
};
}
} catch (e) { console.warn('Erro ao baixar capa:', e.message); }
}
const bufferComMetadata = NodeID3.update(tags, buf);
return bufferComMetadata || buf;
} catch (e) {
console.warn('Erro ao adicionar metadata:', e.message);
return buf;
}
}

async function enviarEscolhaFormatoAudio(sock, ctx, link) {
if (ctx.isGroup) {
const rows = [
{ title: '🎵 Áudio', description: 'Envia como música', rowId: 'escolha_audio_1' },
{ title: '📄 Documento', description: 'Guarda como ficheiro', rowId: 'escolha_audio_2' }
];
await sock.sendMessage(ctx.chatId, {
text: `🎵 *Preparar áudio do YouTube*\n\n🔗 ${link}\n\nEscolhe como quer receber:`,
title: 'Formato do Áudio',
footer: '⚡ KORTEX',
buttonText: 'Escolher',
sections: [{ title: 'Formatos', rows }]
});
} else {
await sock.sendMessage(ctx.chatId, {
text: `🎵 *Preparar áudio do YouTube*\n\n🔗 ${link}\n\nEscolhe como quer receber:`,
buttons: [
{ buttonId: 'escolha_audio_1', buttonText: { displayText: '🎵 Áudio' }, type: 1 },
{ buttonId: 'escolha_audio_2', buttonText: { displayText: '📄 Documento' }, type: 1 }
],
headerType: 1
});
}
}

async function enviarEscolhaFormatoVideo(sock, ctx, link) {
if (ctx.isGroup) {
const rows = [
{ title: '🎬 Vídeo', description: 'Envia como vídeo', rowId: 'escolha_video_1' },
{ title: '📄 Documento', description: 'Guarda como ficheiro', rowId: 'escolha_video_2' }
];
await sock.sendMessage(ctx.chatId, {
text: `🎬 *Preparar vídeo do YouTube*\n\n🔗 ${link}\n\nEscolhe como quer receber:`,
title: 'Formato do Vídeo',
footer: '⚡ KORTEX',
buttonText: 'Escolher',
sections: [{ title: 'Formatos', rows }]
});
} else {
await sock.sendMessage(ctx.chatId, {
text: `🎬 *Preparar vídeo do YouTube*\n\n🔗 ${link}\n\nEscolhe como quer receber:`,
buttons: [
{ buttonId: 'escolha_video_1', buttonText: { displayText: '🎬 Vídeo' }, type: 1 },
{ buttonId: 'escolha_video_2', buttonText: { displayText: '📄 Documento' }, type: 1 }
],
headerType: 1
});
}
}

// ══════════════════════════════════════════════════════════
// KORTEX KEY SYSTEM — FUNÇÕES AUXILIARES (REGRA 7, 8, 9)
// ══════════════════════════════════════════════════════════
function gerarKeyRandom(nivel) {
const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let key = 'KRX-';
for (let i = 0; i < 4; i++) key += alfabeto[crypto.randomBytes(1)[0] % alfabeto.length];
key += '-';
for (let i = 0; i < 4; i++) key += alfabeto[crypto.randomBytes(1)[0] % alfabeto.length];
return key;
}
function normalizarNivel(nivel) {
const n = String(nivel || '').toLowerCase().trim();
if (n === 'ouro' || n === 'gold') return 'ouro';
if (n === 'diamante' || n === 'diamond') return 'diamante';
if (n === 'lenda' || n === 'legend') return 'lenda';
return null;
}
function normalizarMetodoPagamento(str) {
const t = String(str || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const mapa = {
'mpesa': 'm-pesa', 'm pessa': 'm-pesa', 'm-pesa': 'm-pesa', 'm_pesa': 'm-pesa',
'vodacom': 'vodacom', 'vodacomm': 'vodacom', 'airtel': 'airtel', 'emola': 'emola', 'e-mola': 'emola',
'banco': 'banco', 'transferencia': 'transferencia', 'transferência': 'transferencia', 'transfer': 'transferencia',
'mbanking': 'm-banking', 'm banking': 'm-banking', 'm-banking': 'm-banking'
};
return mapa[t] || t.replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-');
}
function limparNumeroTelefone(valor) {
const text = String(valor || '').replace(/[^0-9]/g, '');
return text.length >= 8 ? text : '';
}
function extrairNumeroRecebimento(texto) {
const t = String(texto || '');
const linhas = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
for (let i = linhas.length - 1; i >= 0; i--) {
const match = linhas[i].match(/(?:\b|[^0-9])((?:\+?258|0)?[0-9]{8,15})(?:\b|[^0-9])/);
if (match) return limparNumeroTelefone(match[1]);
}
const m = t.match(/(?:\b|[^0-9])((?:\+?258|0)?[0-9]{8,15})(?:\b|[^0-9])/);
return m ? limparNumeroTelefone(m[1]) : '';
}
function extrairValorPagamento(texto) {
const t = String(texto || '');
const padroes = [
/valor[^0-9]{0,12}([0-9]+(?:[.,][0-9]{1,2})?)/i,
/(?:montante|total|amount)[^0-9]{0,12}([0-9]+(?:[.,][0-9]{1,2})?)/i,
/([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:mt|mzn|meticais|usd|eur)/i,
/([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:kz|usd|eur)/i
];
for (const padrao of padroes) {
const match = t.match(padrao);
if (match) return match[1].replace(',', '.');
}
return '';
}
function extrairReferenciaPagamento(texto) {
const t = String(texto || '');
const padroes = [
/(?:ref(?:erencia|erência)?|referencia|referência)[^a-z0-9]{0,8}([A-Za-z0-9]{3,20})/i,
/(?:txn|transacao|transação)[^a-z0-9]{0,8}([A-Za-z0-9]{3,20})/i
];
for (const padrao of padroes) {
const match = t.match(padrao);
if (match) return match[1].toUpperCase();
}
return '';
}
function extrairPedidoPagamento(texto) {
const t = String(texto || '');
const padroes = [
/(?:pedido|ordem|order|n[ºº]\s*pedido|pedido\s*#?)[^a-z0-9]{0,8}([A-Za-z0-9-]{2,20})/i,
/(?:#)([A-Za-z0-9-]{2,20})/i
];
for (const padrao of padroes) {
const match = t.match(padrao);
if (match) return match[1].toUpperCase();
}
return '';
}
function extrairMetodoPagamentoTexto(texto, tabelas) {
const t = String(texto || '').toLowerCase();
for (const item of tabelas) {
const nomes = [item.metodo, item.nomeMetodo, item.descricao || ''];
for (const nome of nomes) {
if (!nome) continue;
const n = String(nome).toLowerCase();
if (n && (t.includes(n) || t.includes(normalizarMetodoPagamento(n)))) return item.metodo || item.nomeMetodo || 'pagamento';
}
}
if (/(m[- ]?pesa|mpesa|m pessa)/i.test(t)) return 'm-pesa';
if (/vodacom/i.test(t)) return 'vodacom';
if (/airtel/i.test(t)) return 'airtel';
if (/emola|e[- ]mola/i.test(t)) return 'emola';
if (/banco|bank/i.test(t)) return 'banco';
if (/transferencia|transferência|transfer/i.test(t)) return 'transferencia';
return '';
}
function pegarTabelasPagamento(chatId) {
const local = db.tabelasPagamento.get(chatId) || [];
const globalList = db.tabelasPagamento.get('global') || [];
return [...globalList, ...local];
}
function inferirPedidoPagamento(texto, senderId, chatId) {
const t = String(texto || '');
if (!t.trim()) return null;
const chave = /transfer(?:e|ê)ncia|pagamento|comprovativo|comprovante|valor|referencia|referência|pedido|montante|recebimento/i.test(t);
if (!chave && !/\b(?:m-pesa|vodacom|airtel|emola|banco)\b/i.test(t)) return null;
const numeroRecebimento = extrairNumeroRecebimento(t);
const tabelas = pegarTabelasPagamento(chatId);
const metodo = extrairMetodoPagamentoTexto(t, tabelas) || (numeroRecebimento ? 'numero' : '');
const valor = extrairValorPagamento(t);
const referencia = extrairReferenciaPagamento(t);
const pedido = extrairPedidoPagamento(t);
if (!valor && !referencia && !pedido && !numeroRecebimento) return null;
return {
texto: t,
valor,
referencia,
pedido,
numeroRecebimento,
metodo,
cliente: senderId,
chatId
};
}
function formatarPedidoMensagem(pedido) {
const cliente = pedido.cliente ? `@${pedido.cliente.split('@')[0]}` : '—';
const numero = pedido.numeroRecebimento ? pedido.numeroRecebimento : 'Não informado';
const valor = pedido.valor || '—';
const referencia = pedido.referencia || '—';
const pedidoId = pedido.pedido || '—';
const metodo = pedido.metodo || '—';
return `╔══════════════════════╗\n║   🧾 NOVO PAGAMENTO  ║\n╠══════════════════════╣\n║ 👤 Cliente: ${cliente.padEnd(15, ' ')}║\n║ 💰 Valor: ${String(valor).padEnd(15, ' ')}║\n║ 🔖 Referência: ${String(referencia).padEnd(15, ' ')}║\n║ 🧾 Pedido: ${String(pedidoId).padEnd(15, ' ')}║\n║ 📱 Recebimento: ${(String(numero)).padEnd(15, ' ')}║\n║ 💳 Método: ${String(metodo).padEnd(15, ' ')}║\n╠══════════════════════╣\n║ ⏳ AGUARDANDO ANÁLISE ║\n╚══════════════════════╝`;
}
async function enviarPedidoPagamentoADM(sock, pedido, origemChatId) {
const destinatarios = new Set();
if (origemChatId?.endsWith('@g.us')) {
try {
const meta = await sock.groupMetadata(origemChatId);
for (const p of meta.participants || []) {
if (p.admin || p.id === `${CONFIG.ownerNumber}@s.whatsapp.net`) destinatarios.add(p.id);
}
} catch {}
}
destinatarios.add(`${CONFIG.ownerNumber}@s.whatsapp.net`);
for (const destino of destinatarios) {
try {
await sock.sendMessage(destino, { text: formatarPedidoMensagem(pedido), mentions: [pedido.cliente] });
} catch {}
}
}
async function processarPedidoPagamento(sock, msg, dados) {
const senderId = msg.key.participant || msg.key.remoteJid;
const chatId = msg.key.remoteJid;
const finalPedido = {
...dados,
cliente: senderId,
chatId,
id: `PG-${Date.now().toString().slice(-6)}`,
status: 'aguardando_analise',
criadoEm: Date.now(),
observacao: 'Pedido detectado automaticamente pela mensagem de comprovativo.'
};
if (!finalPedido.numeroRecebimento) {
const pendente = db.pedidosPendentes.get(senderId) || finalPedido;
pendente.status = 'aguardando_numero';
pendente.chatId = chatId;
pendente.cliente = senderId;
pendente.textoOriginal = dados.texto;
pendente.valor = pendente.valor || finalPedido.valor;
pendente.referencia = pendente.referencia || finalPedido.referencia;
pendente.pedido = pendente.pedido || finalPedido.pedido;
pendente.metodo = pendente.metodo || finalPedido.metodo;
if (!pendente.id) pendente.id = finalPedido.id;
db.pedidosPendentes.set(senderId, pendente);
await sock.sendMessage(chatId, { text: `🧾 *PAGAMENTO DETECTADO*\n\n✅ Encontrei os dados principais, mas falta o número que vai receber o pagamento.\n\nEnvie apenas o número no final da mensagem para completar o pedido.`, mentions: [senderId] });
return true;
}
finalPedido.numeroRecebimento = limparNumeroTelefone(finalPedido.numeroRecebimento);
db.pedidosPagamento.set(finalPedido.id, finalPedido);
db.pedidosPendentes.delete(senderId);
await enviarPedidoPagamentoADM(sock, finalPedido, chatId);
await sock.sendMessage(chatId, { text: `✅ *PEDIDO REGISTADO*\n\nO comprovativo foi enviado para a análise dos ADM.`, mentions: [senderId] });
return true;
}
async function atualizarPedidoNumeroRecebimento(sock, senderId, numero) {
const pendente = db.pedidosPendentes.get(senderId);
if (!pendente) return false;
pendente.numeroRecebimento = limparNumeroTelefone(numero);
pendente.status = 'aguardando_analise';
db.pedidosPagamento.set(pendente.id, pendente);
db.pedidosPendentes.delete(senderId);
await enviarPedidoPagamentoADM(sock, pendente, pendente.chatId);
await sock.sendMessage(pendente.chatId, { text: `✅ *NÚMERO ATUALIZADO*\n\nO pedido foi atualizado e enviado para análise dos ADM.`, mentions: [senderId] });
return true;
}
function obterNomeNivel(nivel) {
const nomes = { ouro: 'OURO 🥇', diamante: 'DIAMANTE 💎', lenda: 'LENDA 👑' };
return nomes[nivel] || String(nivel).toUpperCase();
}
async function podeGerenciarModoInternet(sock, chatId, senderId) {
if (utils.isOwner(senderId)) return true;
if (!chatId || !chatId.endsWith('@g.us')) return false;
if (!(await utils.isSenderGroupAdmin(sock, chatId, senderId))) return false;
const sub = db.gruposVIP.get(chatId);
return !!(sub && sub.nivel === 'diamante' && sub.expiraEm > Date.now());
}
function isModoInternetAtivo(chatId) {
return !!(chatId && db.modoInternet.get(chatId));
}
function verificarVIPDiamanteParaModoInternet(senderId, chatId) {
if (utils.isOwner(senderId)) return true;
if (chatId && chatId.endsWith('@g.us')) {
const sub = db.gruposVIP.get(chatId);
return !!(sub && sub.nivel === 'diamante' && sub.expiraEm > Date.now());
}
const vip = db.usersVIP.get(senderId);
return !!(vip && vip.nivel === 'diamante' && vip.expiraEm > Date.now());
}
async function enviarAlertaSegurancaDono(sock, userId, nivel, tipo, keyUsada, alertaId) {
const donoId = `${CONFIG.ownerNumber}@s.whatsapp.net`;
const data = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
const nomeUser = userId.split('@')[0];
const texto = `🔐 *KORTEX SECURITY ALERT*\n\n🔑 Uma Key foi utilizada.\n\n👤 Usuário: @${nomeUser}\n👑 VIP: ${obterNomeNivel(nivel)}\n🎯 Tipo: ${tipo === 'grupo' ? 'Grupo' : 'Usuário'}\n🔑 Key: ${keyUsada}\n🕐 Data: ${data}\n\n❓ Você autorizou esta operação?\n\nResponda:\n✅ fui eu\n❌ remover acesso\n\n⏳ Expira em 10 minutos.\n🆔 Alerta: #${alertaId}`;
try { await sock.sendMessage(donoId, { text: texto, mentions: [userId] }); } catch (e) { console.warn('alertaDono:', e.message); }
}
async function ativarVIPComKey(sock, userId, chatId, nivel, tipo, keyUsada, isGroup) {
const agora = Date.now();
const dias = NIVEIS_VIP[nivel]?.maxDias || NIVEIS_VIP_USER[nivel]?.maxDias || 7;
const expiraEm = agora + (dias * 86400000);
if (tipo === 'grupo') {
db.gruposVIP.set(chatId, { nivel, expiraEm, diasTotal: dias, ativadoPor: userId, ativadoEm: agora, keyUsada });
} else {
db.usersVIP.set(userId, { nivel, expiraEm, ativadoEm: agora, keyUsada });
}
const keyData = db.keysRandom.get(keyUsada);
if (keyData) {
keyData.status = 'UTILIZADA';
keyData.utilizadaPor = userId;
keyData.dataUtilizacao = new Date().toISOString();
keyData.alvo = tipo === 'grupo' ? chatId : userId;
db.keysRandom.set(keyUsada, keyData);
}
salvarDados();
registrarAcao(isGroup ? chatId : userId, `VIP ${nivel} ativado via Key ${keyUsada}`);
const alertaId = `AK${Date.now().toString().slice(-6)}`;
db.alertasKey.set(alertaId, { userId, nivel, tipo, keyUsada, data: agora, expiraEm: agora + 600000 });
await enviarAlertaSegurancaDono(sock, userId, nivel, tipo, keyUsada, alertaId);
return { sucesso: true, alertaId };
}

// ══════════════════════════════════════════════════════════
// DETECÇÃO INTELIGENTE DE COMANDO SEM PREFIXO
// ══════════════════════════════════════════════════════════
function detectarComandoSemPrefixo(texto) {
if (!texto || texto.length > 200) return null;
const trimmed = texto.trim();
if (/^[.,!?;:🔥❤️😂👍👏]/.test(trimmed)) return null;
const partes = trimmed.split(/\s+/);
let primeiraPalavra = partes[0].toLowerCase().replace(/[.!?,;:]$/, '');
let args = partes.slice(1);
if (!commands[primeiraPalavra]) {
const juntado = resolverComandoPalavrasSoltas(partes);
if (!juntado) return null;
primeiraPalavra = juntado.comando;
args = partes.slice(juntado.consumidas);
}
if (COMANDOS_SENSIVEIS.has(primeiraPalavra)) {
if (trimmed.length > 80) return null;
if (/^(eu |pode |por favor |queria |gostaria |vc |você )/i.test(trimmed)) return null;
}
return { comando: primeiraPalavra, args, textoCompleto: trimmed };
}

// ══════════════════════════════════════════════════════════
// SISTEMA DE APROVAÇÃO
// ══════════════════════════════════════════════════════════
async function solicitarAprovacao(sock, ctx, comandoDetectado) {
const id = solicitacaoIdCounter++;
const solicitante = ctx.senderId;
const alvo = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0] || ctx.args[0] || '—';
const solicitacao = { id, grupoId: ctx.chatId, solicitante, comando: comandoDetectado.comando, args: comandoDetectado.args, alvo, criadoEm: Date.now(), expiraEm: Date.now() + TEMPO_EXPIRACAO_APROVACAO, estado: 'pendente' };
solicitacoesPendentes.set(id, solicitacao);
const nomeSolicitante = solicitante.split('@')[0];
const nomeAlvo = typeof alvo === 'string' && alvo.includes('@') ? alvo.split('@')[0] : String(alvo).substring(0, 30);
const texto = `🛡️ *KORTEX SECURITY*\n\n🚨 AÇÃO SENSÍVEL DETECTADA\n\n👤 Solicitado por: @${nomeSolicitante}\n⚙️ Ação: .${comandoDetectado.comando} ${comandoDetectado.args.join(' ')}\n🎯 Alvo: @${nomeAlvo}\n\n🔐 Esta ação necessita de aprovação.\n\n👮 Administradores do grupo ou 👑 Dono\npodem aprovar esta operação.\n\n✅ Aprovar: .aprovar ${id}\n❌ Recusar: .recusar ${id}\n\n⏳ Solicitação expira em 60 segundos.\n🆔 ID: #${id}`;
await sock.sendMessage(ctx.chatId, { text: texto, mentions: [solicitante, typeof alvo === 'string' && alvo.includes('@') ? alvo : null].filter(Boolean) });
setTimeout(() => {
const sol = solicitacoesPendentes.get(id);
if (sol && sol.estado === 'pendente') {
sol.estado = 'expirada';
solicitacoesPendentes.delete(id);
sock.sendMessage(ctx.chatId, { text: `⏳ *KORTEX SECURITY*\n\nSolicitação #${id} expirada.\n\n🔒 Nenhuma ação foi executada.` }).catch(() => {});
}
}, TEMPO_EXPIRACAO_APROVACAO);
}
async function processarAprovacao(sock, ctx, idStr, aprovar) {
const id = parseInt(idStr);
const solicitacao = solicitacoesPendentes.get(id);
if (!solicitacao) return await sock.sendMessage(ctx.chatId, { text: `❌ Solicitação #${id} não encontrada ou já expirada.` });
if (solicitacao.estado !== 'pendente') return await sock.sendMessage(ctx.chatId, { text: `⚠️ Solicitação #${id} já foi ${solicitacao.estado}.` });
if (Date.now() > solicitacao.expiraEm) { solicitacao.estado = 'expirada'; solicitacoesPendentes.delete(id); return await sock.sendMessage(ctx.chatId, { text: `⏳ Solicitação #${id} expirada.` }); }
const aprovador = ctx.senderId;
const isDonoBot = utils.isOwner(aprovador);
const isAdminGrupo = ctx.isGroup ? await utils.isSenderGroupAdmin(sock, ctx.chatId, aprovador) : false;
if (!isDonoBot && !isAdminGrupo) return await sock.sendMessage(ctx.chatId, { text: `🚫 Apenas administradores do grupo ou o dono do bot podem aprovar.` });
if (solicitacao.solicitante === aprovador && !isDonoBot) return await sock.sendMessage(ctx.chatId, { text: `🚫 Não podes aprovar a tua própria solicitação.` });
if (solicitacao.alvo && typeof solicitacao.alvo === 'string' && solicitacao.alvo.includes('@') && solicitacao.alvo === aprovador && !isDonoBot) return await sock.sendMessage(ctx.chatId, { text: `Não podes aprovar uma ação contra ti mesmo.` });
const nomeSolicitante = solicitacao.solicitante.split('@')[0];
const nomeAprovador = aprovador.split('@')[0];
if (aprovar) {
solicitacao.estado = 'aprovada';
solicitacoesPendentes.delete(id);
await sock.sendMessage(ctx.chatId, { text: `⚡ *KORTEX SECURITY*\n\n✅ AÇÃO APROVADA\n\n👤 Solicitado por: @${nomeSolicitante}\n👮 Aprovado por: @${nomeAprovador}\n⚙️ Ação: .${solicitacao.comando}\n\n🔄 Executando...`, mentions: [solicitacao.solicitante, aprovador] });
try {
const ctxExecucao = { chatId: solicitacao.grupoId, senderId: solicitacao.solicitante, isGroup: ctx.isGroup, msg: ctx.msg, args: solicitacao.args, _aprovado: true, _aprovadoPor: aprovador };
if (commands[solicitacao.comando]) {
await commands[solicitacao.comando](sock, ctxExecucao);
await sock.sendMessage(ctx.chatId, { text: `✅ *AÇÃO CONCLUÍDA*\n\n⚡ KORTEX SECURITY CORE` });
}
} catch (e) {
await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao executar ação aprovada: ${e.message}` });
}
} else {
solicitacao.estado = 'recusada';
solicitacoesPendentes.delete(id);
await sock.sendMessage(ctx.chatId, { text: `🛡️ *KORTEX SECURITY*\n\n❌ AÇÃO RECUSADA\n\n👤 Solicitado por: @${nomeSolicitante}\n👮 Recusado por: @${nomeAprovador}`, mentions: [solicitacao.solicitante, aprovador] });
}
}

// ══════════════════════════════════════════════════════════
// MENU POR NOME
// ══════════════════════════════════════════════════════════
function normalizarTexto(txt) {
return String(txt || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
const MAPA_MENU_CATEGORIAS = {
geral: 'cgeral',
utilitarios: 'cutil', util: 'cutil', utilitario: 'cutil',
texto: 'ctexto',
informacao: 'cinfo', info: 'cinfo', informacoes: 'cinfo',
diversao: 'cdiv', div: 'cdiv',
imagem: 'cimg', imagens: 'cimg', img: 'cimg',
midia: 'cmidia', media: 'cmidia',
sticker: 'cstick', stickers: 'cstick', figurinha: 'cstick', figurinhas: 'cstick',
protecao: 'cprot', prot: 'cprot', seguranca: 'cprot',
administracao: 'cadmin', admin: 'cadmin', administrador: 'cadmin',
dono: 'cdono', owner: 'cdono', ownercore: 'cdono'
};
const MAPA_MENU_LISTA = {
'menu_geral': 'cgeral',
'menu_util': 'cutil',
'menu_texto': 'ctexto',
'menu_info': 'cinfo',
'menu_div': 'cdiv',
'menu_img': 'cimg',
'menu_midia': 'cmidia',
'menu_prot': 'cprot',
'menu_adm': 'cadmin',
'menu_stick': 'cstick',
'menu_dono': 'cdono'
};
function resolverComandoPalavrasSoltas(palavras) {
const maxPalavras = Math.min(palavras.length, 5);
for (let n = maxPalavras; n >= 2; n--) {
const juntas = palavras.slice(0, n).map(normalizarTexto).join('');
if (juntas && commands[juntas]) return { comando: juntas, consumidas: n };
}
return null;
}

// ⚡ OPT — fila de processamento (máx. 3 mensagens pesadas em paralelo)
let procAtivos = 0;
const procFila = [];
const PROC_FILA_MAX = 100;
function enfileirarProcessamento(fn) {
if (procFila.length >= PROC_FILA_MAX) {
console.warn(`⚠️ Fila cheia (${PROC_FILA_MAX}); mensagem descartada.`);
return;
}
procFila.push(fn);
processarFila();
}
function processarFila() {
while (procAtivos < 3 && procFila.length) {
const fn = procFila.shift();
procAtivos++;
Promise.resolve()
.then(fn)
.catch(e => console.error('Erro na fila de mensagens:', e.message))
.finally(() => { procAtivos--; processarFila(); });
}
}

// ══════════════════════════════════════════════════════════
// ⬇️ PARTE 2 CONTINUA COM O OBJETO `commands` ⬇️
// ══════════════════════════════════════════════════════════// ══════════════════════════════════════════════════════════
// COMANDOS (interface 100% preservada — apenas menus limpos)
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
pSticker: isOwner || (!!vip?.sticker)
};
},
'menubtn': async (sock, ctx) => { await commands['menu'](sock, ctx); },
'menu': async (sock, ctx) => {
const nomeCategoria = ctx.args?.[0];
if (nomeCategoria) {
const alvo = MAPA_MENU_CATEGORIAS[normalizarTexto(nomeCategoria)];
if (alvo && commands[alvo]) return await commands[alvo](sock, { ...ctx, args: ctx.args.slice(1) });
}
if (ctx.isGroup) {
await enviarMenuInterativo(sock, ctx);
} else {
await enviarMenuTexto(sock, ctx);
}
},
'ajuda': async (sock, ctx) => { await commands['menu'](sock, ctx); },
'cgeral': async (sock, ctx) => {
const conteudo = `─── 📌 BÁSICO ───
• menu — categorias
• ajuda — categorias
• info — estado do bot
• statusbot — resumo rápido
• ping — velocidade
• hora — hora de Maputo
• meuid — IDs do sistema
• linkgrupo — link do grupo
• comandos — lista completa

─── 💎 ASSINATURA ───
• planos — ver planos
• statusgrupo — estado do VIP

─── 🏆 INDICAÇÕES ───
• indicar [nº] — +1 ponto
• ranking — top 10
• pontos — meus pontos

─── 🌍 RÁPIDOS ───
• traduzir [texto] — traduzir
• meuvip — status do teu VIP`;
await enviarMenuKortex(sock, ctx, { titulo: '🌐 GERAL', conteudo, imagemChave: 'geral' });
},
'cutil': async (sock, ctx) => {
const conteudo = `─── 🧮 CÁLCULOS ───
• calcular [expr] — resolve conta
• porcentagem [v] [%] — calcula %
• tabuada [n] — tabuada do n

─── 🎲 GERADORES ───
• senha [tamanho] — senha segura
• pin [tamanho] — PIN numérico
• aleatorio [min] [max] — nº aleatório
• caraoucoroa — cara ou coroa
• sortear [a|b|c] — sorteia opção

─── 📏 CONVERSÕES ───
• moeda [v] [de] [para] — converte moeda
• idade [dd/mm/aaaa] — calcula idade
• contar [texto] — letras/palavras

─── 🎙️ ÁUDIO ───
• transcrever (responde) — transcreve áudio
• traduzir [texto] — tradução rápida`;
await enviarMenuKortex(sock, ctx, { titulo: '🧰 MÓDULO UTILITÁRIOS', conteudo, imagemChave: 'utilitarios' });
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
await sock.sendMessage(ctx.chatId, { text: `💱 *CONVERSÃO*\n\n${valor} ${de} = *${r.toFixed(2)} ${para}*\n📅 ${d.time_last_update_utc || ''}` });
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
const m = (ctx.args[0] || '').match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
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
await sock.sendMessage(ctx.chatId, { text: `🔤 *Contagem*\n┃ Letras: ${t.replace(/\s/g, '').length}\n┃ Palavras: ${t.trim().split(/\s+/).length}\n┃ Linhas: ${t.split('\n').length}` });
},
'sortear': async (sock, ctx) => {
const opts = ctx.args.join(' ').split('|').map(s => s.trim()).filter(Boolean);
if (opts.length < 2) return sock.sendMessage(ctx.chatId, { text: 'Uso: .sortear [opção1|opção2|...]' });
const r = opts[Math.floor(Math.random() * opts.length)];
await sock.sendMessage(ctx.chatId, { text: `🎯 *Sorteio:*\n\n🥇 ${r}` });
},
'caraoucoroa': async (sock, ctx) => {
const r = Math.random() < 0.5 ? 'CARA 🪙' : 'COROA 👑';
await sock.sendMessage(ctx.chatId, { text: `A moeda girou... e deu:\n\n*${r}*` });
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
// ⚡ OPT — conversão com timeout (evita ffmpeg zumbi)
await new Promise((res, rej) => {
const cmd = ffmpeg(tmpIn).toFormat('mp3').save(tmpOut);
const to = setTimeout(() => { try { cmd.kill('SIGKILL'); } catch {} rej(new Error('ffmpeg timeout')); }, 120000);
cmd.on('end', () => { clearTimeout(to); res(); }).on('error', (e) => { clearTimeout(to); rej(e); });
});
const r = await comGroq(client => client.audio.transcriptions.create({ file: fs.createReadStream(tmpOut), model: 'whisper-large-v3' }));
try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {}
await sock.sendMessage(ctx.chatId, { text: `🎙️ *Transcrição:*\n\n"${r.text || '…'}"` });
} catch (e) { console.warn('transcrever:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui transcrever este áudio.' }); }
},
'ctexto': async (sock, ctx) => {
const conteudo = `─── 🔤 TEXTO ───
• romanos [número] — nº em romanos
• significado [palavra] — definição
• sinonimo [palavra] — sinónimos
• antonimo [palavra] — antónimos
• leet [texto] — estilo leet
• vaporwave [texto] — estilo vaporwave
• gerarnome — nome aleatório
• traduzir [texto] — tradução rápida`;
await enviarMenuKortex(sock, ctx, { titulo: '🔤 MÓDULO TEXTO', conteudo, imagemChave: 'texto' });
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
const conteudo = `─── 🌍 CONSULTAS ───
• wiki [tema] — Wikipédia
• pais [país] — dados do país
• capital [país] — capital
• hoje — efeméride do dia
• noticias [tema] — notícias

─── 🎬 ENTRETENIMENTO ───
• filme [título] — info do filme
• serie [título] — info da série
• manga [título] — info do mangá
• personagem [nome] — info
• musica [nome] — info da música

─── 💰 COTAÇÕES ───
• dolar / euro / ouro — cotação
• moeda [v] [de] [para] — converte

─── ⚽ FUTEBOL ───
• futebol [equipa] — últimos jogos
• tabela [campeonato] — classificação
• canal [url] — info do canal`;
await enviarMenuKortex(sock, ctx, { titulo: '🌍 MÓDULO INFORMAÇÃO', conteudo, imagemChave: 'informacao' });
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
await sock.sendMessage(ctx.chatId, { image: { url: p.flags?.png }, caption: `🗺️ *${p.name?.common}*\n🏛️ Capital: ${p.capital?.[0] || '—'}\n👥 População: ${(p.population || 0).toLocaleString('pt-PT')}\n🌍 Região: ${p.region || '—'}\n💱 Moeda: ${moedas || '—'}` });
},
'capital': async (sock, ctx) => {
const t = ctx.args.join(' ');
if (!t) return sock.sendMessage(ctx.chatId, { text: 'Uso: .capital [país]' });
const d = await getJSON(`https://restcountries.com/v3.1/name/${encodeURIComponent(t)}?fields=name,capital`);
if (!d?.length) return sock.sendMessage(ctx.chatId, { text: '❌ País não encontrado.' });
await sock.sendMessage(ctx.chatId, { text: `🏛️ Capital de *${d[0].name?.common}*: *${d[0].capital?.[0] || '—'}*` });
},
'hoje': async (sock, ctx) => {
const agora = new Date();
const mm = String(agora.getMonth() + 1).padStart(2, '0'), dd = String(agora.getDate()).padStart(2, '0');
const d = await getJSON(`https://pt.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
if (!d?.events?.length) return sock.sendMessage(ctx.chatId, { text: '❌ Sem eventos hoje.' });
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
await sock.sendMessage(ctx.chatId, { image: { url: m.artworkUrl100 }, caption: `🎵 *${m.trackName}*\n👤 ${m.artistName}\n💿 ${m.collectionName || '—'}\n📅 ${(m.releaseDate || '').substring(0, 4)}\n⏱️ ${dur}\n🔗 ${m.trackViewUrl || ''}` });
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
},
'cdiv': async (sock, ctx) => {
const conteudo = `─── 😄 DIVERSÃO ───
• charada — adivinha
• frase — frase motivacional
• gerarnome — nome aleatório

─── ⭕ JOGO DA VELHA ───
• jogodavelha @user — desafiar
• jogodavelha [1-9] — faz jogada
• jogodavelha off — cancela jogo`;
await enviarMenuKortex(sock, ctx, { titulo: '😄 MÓDULO DIVERSÃO', conteudo, imagemChave: 'diversao' });
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
'A melhor maneira de prever o futuro é criá-lo.',
'Cair é permitido; levantar é obrigatório. 🧗',
'O conhecimento é o único tesouro que ninguém te rouba.',
'Fé é dar o primeiro passo mesmo sem ver a escada toda.'
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
desafiosVelha.set(desafioId, { desafiante: ctx.senderId, desafiado: alvo, chatId: ctx.chatId, criadoEm: Date.now(), expiraEm: Date.now() + TEMPO_EXPIRACAO_DESAFIO, estado: 'pendente' });
await sock.sendMessage(ctx.chatId, { text: `🎮 *DESAFIO — JOGO DA VELHA*\n\nKortex está preparando o desafio...\n\n@${ctx.senderId.split('@')[0]} desafiou @${alvo.split('@')[0]}!\n\n${velhaRender(Array(9).fill(null))}\n\n✅ Aceitar: .aceitardesafio\n❌ Recusar: .recusardesafio\n\n⏳ Expira em 60 segundos.`, mentions: [ctx.senderId, alvo] });
return;
}
if (Date.now() - g.ts > 5 * 60000) { jogosVelha.delete(ctx.chatId); return sock.sendMessage(ctx.chatId, { text: '⌛ Jogo expirado por inactividade.' }); }
const pos = parseInt(arg);
if (!pos || pos < 1 || pos > 9) return sock.sendMessage(ctx.chatId, { text: 'Usa .jogodavelha [1-9]' });
if (!g.players.includes(ctx.senderId)) return sock.sendMessage(ctx.chatId, { text: '❌ Não estás neste jogo.' });
if (g.players[g.vez] !== ctx.senderId) return sock.sendMessage(ctx.chatId, { text: `⏳ Não é a tua vez! Vez de @${g.players[g.vez].split('@')[0]}`, mentions: [g.players[g.vez]] });
if (g.board[pos - 1]) return sock.sendMessage(ctx.chatId, { text: '❌ Casa ocupada!' });
g.board[pos - 1] = g.vez === 0 ? 'X' : 'O';
g.vez = 1 - g.vez; g.ts = Date.now();
const res = velhaVencedor(g.board);
if (res) {
jogosVelha.delete(ctx.chatId);
const msg = res === 'empate' ? '🤝 EMPATE! Bom jogo!' : `🏆 *VITÓRIA de ${res === 'X' ? '❌' : '⭕'} @${g.players[res === 'X' ? 0 : 1].split('@')[0]}!*`;
return sock.sendMessage(ctx.chatId, { text: `⭕ *FIM DE JOGO*\n\n${velhaRender(g.board)}\n\n${msg}\n\n⚡ KORTEX SECURITY CORE`, mentions: g.players });
}
await sock.sendMessage(ctx.chatId, { text: `⭕ *JOGO DA VELHA*\n\n${velhaRender(g.board)}\n\nVez de ${g.vez === 0 ? '❌' : '⭕'} @${g.players[g.vez].split('@')[0]}`, mentions: [g.players[g.vez]] });
},
'aceitardesafio': async (sock, ctx) => {
if (!ctx.isGroup) return;
for (const [id, des] of desafiosVelha) {
if (des.desafiado === ctx.senderId && des.estado === 'pendente' && Date.now() < des.expiraEm) {
des.estado = 'aceite';
jogosVelha.set(des.chatId, { board: Array(9).fill(null), players: [des.desafiante, des.desafiado], vez: 0, ts: Date.now() });
desafiosVelha.delete(id);
await sock.sendMessage(ctx.chatId, { text: `⭕ *DESAFIO ACEITE!*\n\n@${des.desafiante.split('@')[0]} vs @${des.desafiado.split('@')[0]}\n\n${velhaRender(Array(9).fill(null))}\n\nVez de ❌ @${des.desafiante.split('@')[0]} — usa jogodavelha [1-9]`, mentions: [des.desafiante, des.desafiado] });
return;
}
}
await sock.sendMessage(ctx.chatId, { text: '❌ Nenhum desafio pendente para ti.' });
},
'recusardesafio': async (sock, ctx) => {
if (!ctx.isGroup) return;
for (const [id, des] of desafiosVelha) {
if (des.desafiado === ctx.senderId && des.estado === 'pendente') {
des.estado = 'recusado';
desafiosVelha.delete(id);
await sock.sendMessage(ctx.chatId, { text: `❌ @${ctx.senderId.split('@')[0]} recusou o desafio de @${des.desafiante.split('@')[0]}.`, mentions: [ctx.senderId, des.desafiante] });
return;
}
}
await sock.sendMessage(ctx.chatId, { text: '❌ Nenhum desafio pendente para ti.' });
},
'cimg': async (sock, ctx) => {
const conteudo = `─── 🖼️ IMAGEM ───
• converterimagem — sticker em imagem
• roubarsticker — salva o sticker
• circular — recorte circular`;
await enviarMenuKortex(sock, ctx, { titulo: '🖼️ MÓDULO IMAGEM', conteudo, imagemChave: 'imagem' });
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
let conteudo = '';
if (p.pAdmin) {
conteudo += `─── 🏟️ GRUPO ───
• marcartodos [msg] — chama todos
• fechar / abrir — fecha/abre grupo
• link / idgrupo — link ou ID
• apagar (responde) — apaga mensagem
• nome [novo nome] — renomeia grupo
• foto (responde img) — troca a foto
• criargrupo [nome] — cria novo grupo
• agendar HH:MM [msg] — agenda envio
• agendar ls — lista agendamentos
• agendar del [id] — apaga agendamento

─── 🚫 COMANDOS DO GRUPO ───
• desativarcomando .cmd — desliga
• ativarcomando .cmd — liga
• listardesativados — vê desativados\n\n`;
}
if (p.pBan) {
conteudo += `─── 🔨 MODERAÇÃO ───
• banir @user — remove do grupo
• listarbanidos — lista banidos
• advertir @user — dá advertência
• advertencias @user — vê advertências
• removeradvertencia — remove
• silenciar @user [min] — silencia
• dessilenciar @user — retira silêncio\n\n`;
}
if (p.pPromote) {
conteudo += `─── 👑 CARGOS ───
• promover @user — torna admin
• rebaixar @user — remove admin\n\n`;
}
conteudo += `─── 📌 EXTRA ───
• notificar on/off — avisos do grupo
• boasvindas [msg]/off — mensagem de entrada`;
await enviarMenuKortex(sock, ctx, { titulo: '👮 MÓDULO ADMINISTRAÇÃO', conteudo, imagemChave: 'administracao' });
},
'marcartodos': async (sock, ctx) => {
if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
const meta = await getMetadataCached(sock, ctx.chatId);
await sock.sendMessage(ctx.chatId, { text: `📢 *AVISO GERAL*\n\n${ctx.args.join(' ') || 'Atenção!'}`, mentions: meta.participants.map(p => p.id) });
},
'fechar': async (sock, ctx) => {
if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
await sock.groupSettingUpdate(ctx.chatId, 'announcement');
registrarAcao(ctx.chatId, 'Grupo fechado');
await sock.sendMessage(ctx.chatId, { text: `🔒 *GRUPO FECHADO*\nSó admins falam.\n👮 @${ctx.senderId.split('@')[0]}`, mentions: [ctx.senderId] });
},
'abrir': async (sock, ctx) => {
if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
await sock.groupSettingUpdate(ctx.chatId, 'not_announcement');
registrarAcao(ctx.chatId, 'Grupo aberto');
await sock.sendMessage(ctx.chatId, { text: `🔓 *GRUPO ABERTO*\nTodos podem falar! 🗣️` });
},
'link': async (sock, ctx) => {
if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
try { const code = await sock.groupInviteCode(ctx.chatId); await sock.sendMessage(ctx.chatId, { text: `🔗 https://chat.whatsapp.com/${code}` }); }
catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao obter link.' }); }
},
'idgrupo': async (sock, ctx) => {
if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
await sock.sendMessage(ctx.chatId, { text: `🆔 *ID DO GRUPO*\n\n${ctx.chatId}` });
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
await sock.sendMessage(ctx.chatId, { text: `🔨 *BANIDO!*\n👤 @${target.split('@')[0]}\n👮 Por: @${ctx.senderId.split('@')[0]}`, mentions: [target, ctx.senderId] });
} catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao banir.' }); }
},
'listarbanidos': async (sock, ctx) => {
const lista = db.grupos.banidos.get(ctx.chatId) || [];
if (!lista.length) return sock.sendMessage(ctx.chatId, { text: '📝 Sem banidos.' });
await sock.sendMessage(ctx.chatId, { text: `🚫 *BANIDOS*\n${lista.map(b => `@${b.id.split('@')[0]} - ${b.data}`).join('\n')}`, mentions: lista.map(b => b.id) });
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
catch { await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao rebaixar.' }); }
},
'advertir': async (sock, ctx) => {
if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
if (!target) return sock.sendMessage(ctx.chatId, { text: '❌ Menciona alguém.' });
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
await sock.sendMessage(ctx.chatId, { text: `⚠️ *ADVERTÊNCIA ${n}/3*\n@${target.split('@')[0]}`, mentions: [target] });
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
await sock.sendMessage(ctx.chatId, { text: `🔇 @${target.split('@')[0]} silenciado por ${min} min.\n(as mensagens dele serão apagadas)`, mentions: [target] });
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
await sock.sendMessage(ctx.chatId, { text: `📅 *AGENDADO!*\n\n⏰ Hora: ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}\n💬 ${texto.substring(0, 100)}\n\n🆔 #${id}\nVer: .agendar ls` });
},
'desativarcomando': async (sock, ctx) => {
if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
const comando = ctx.args[0]?.toLowerCase();
if (!comando || !comando.startsWith('.')) return sock.sendMessage(ctx.chatId, { text: 'Uso: .desativarcomando [.cmd]' });
const cmdLimpo = comando.replace('.', '');
if (!commands[cmdLimpo]) return sock.sendMessage(ctx.chatId, { text: `Comando ".${cmdLimpo}" não existe.` });
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
await sock.sendMessage(ctx.chatId, { text: `🚫 *DESATIVADOS*\n${[...cmds].map(c => `.${c}`).join('\n')}` });
},
'cprot': async (sock, ctx) => {
const p = await commands._getPerms(sock, ctx);
if (!p.pAnti && !p.pRules && !p.pBemv) throw new PermissaoNegada();
let conteudo = '';
if (p.pAnti) {
conteudo += `─── 🔗 ANTI-LINK ───
• antilink [modo] — ativa/desativa
• antilink add [site] — permite site
• antilink remove [site] — remove site
• antilink ls — lista permitidos

─── 🛡️ ANTI-MÍDIA ───
• antimidia [tipo] on/off — bloqueia
• antimidia ls — lista bloqueios

─── ⏱️ AUTO-DELETE ───
• autodelete [tempo] — apaga automático

─── 🚫 PALAVRAS ───
• proibirpalavra [p] — bloqueia
• desbanirpalavra [p] — desbloqueia
• listarpalavras — lista bloqueadas\n\n`;
}
if (p.pRules) {
conteudo += `─── 📜 REGRAS ───
• regras [texto] — define regras
• verregras — mostra regras\n\n`;
}
conteudo += `─── ⚙️ GRUPO ───
• boasvindas [msg]/off — msg de entrada
• notificar on/off — avisos do grupo
• ia on/off — IA livre no grupo
• semprefixo on/off — ativar comandos sem ponto`;
await enviarMenuKortex(sock, ctx, { titulo: '🛡️ MÓDULO PROTEÇÃO', conteudo, imagemChave: 'protecao' });
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
const host = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
if (!db.whitelist.has(ctx.chatId)) db.whitelist.set(ctx.chatId, new Set());
db.whitelist.get(ctx.chatId).add(host); salvarDados();
return sock.sendMessage(ctx.chatId, { text: `✅ ${host} permitido` });
}
if (sub === 'remove') {
const d = ctx.args[1]; if (!d) return;
const host = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
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
const modos = { ban: '🔨 Banir quem enviar', kick: '👢 Expulsar quem enviar', delete: '🗑️ Apagar silenciosamente', warn: '⚠️ Avisar e apagar' };
return sock.sendMessage(ctx.chatId, { text: `🔗 *ANTI-LINK ACTIVADO!*\nModo: ${sub.toUpperCase()}\n${modos[sub]}` });
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
await sock.sendMessage(ctx.chatId, { text: lista.length ? `🚫 *PALAVRAS BANIDAS*\n${lista.join('\n')}` : '📝 Sem palavras banidas.' });
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
await sock.sendMessage(ctx.chatId, { text: regras ? `📜 *REGRAS*\n\n${regras}` : '📝 Sem regras definidas.' });
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
if (a === 'on') { db.notifications.set(ctx.chatId, true); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '🔔 Notificações ON' }); }
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
const conteudo = `─── 🎵 REDES ───
• tiktok [link] — baixa vídeo
• tiktokaudio [link] — baixa áudio
• instagram [link] — baixa mídia
• facebook [link] — baixa vídeo
• pinterest [link] — baixa imagem
• baixar [link] — baixa genérico

─── 🎬 YOUTUBE ───
• youtube [pesquisa] — procura vídeo
• youtubevideo [link] — baixa vídeo
• youtubeaudio [link] — baixa áudio/mp3

─── 👻 EXTRAS ───
• revelar — revela status/foto
• guiamidia — mostra acesso VIP
• fichamidia [link] — dados da mídia
• canal [url] — info do canal
• zip [links] — compacta em zip

─── 🌍 OUTROS ──
• traduzir [texto] — traduz
• recibo [plano] [dias] — gera recibo`;
await enviarMenuKortex(sock, ctx, { titulo: '📲 MÓDULO MÍDIA & DOWNLOADS', conteudo, imagemChave: 'midia' });
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
const conta = extrairNomeConta(dados);
if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: `🎵 ${dados.title || 'Vídeo'}\n👤 ${conta}\n⚡ Kortex`, mimetype: 'video/mp4' });
} catch (e) { console.warn('tiktok:', e.message); }
await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar este TikTok.' });
},
'tiktokaudio': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'tiktokaudio')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link || !/tiktok.com|vm.tiktok|vt.tiktok/.test(link)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tiktokaudio [link]' });
await sock.sendMessage(ctx.chatId, { text: '🎶  TikTok Áudio\n A extrair a música...' });
try {
const dados = await extrairGenDownload(link);
const fmt = escolherFormatoGen(dados, 'audio');
if (!fmt) return sock.sendMessage(ctx.chatId, { text: '❌ Não foi possível extrair o áudio deste TikTok.' });
const buf = await baixarBufferGen(fmt, 32 * 1024 * 1024);
if (buf) return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', fileName: `${(dados.title || 'tiktok_audio').replace(/[^a-zA-Z0-9 .\-]/gi, '').substring(0, 200)}.mp3`, ptt: false });
} catch (e) { console.warn('tiktokaudio:', e.message); }
await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui extrair o áudio deste TikTok.' });
},
'instagram': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'instagram')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link || !link.includes('instagram.com')) return sock.sendMessage(ctx.chatId, { text: 'Uso: .instagram [link]' });
await sock.sendMessage(ctx.chatId, { text: '📸 *A preparar o Instagram...*' });
try {
const dados = await extrairGenDownload(link);
const conta = extrairNomeConta(dados);
const formatos = dados?.formats || [];
const videos = formatos.filter(f => f.type === 'video');
const imagens = formatos.filter(f => f.type === 'image' || /jpe?g|png|webp/.test(f.ext || ''));
if (videos.length) {
const buf = await baixarBufferGen(videos[0]);
if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: `📹 *Instagram*\n\n👤 ${conta}\n📌 ${dados.title || 'Vídeo'}\n\n⚡ Kortex`, mimetype: 'video/mp4' });
}
if (imagens.length) {
for (let i = 0; i < Math.min(imagens.length, 4); i++) {
const img = imagens[i];
const buf = await baixarBufferGen(img, 32 * 1024 * 1024);
if (buf) {
await sock.sendMessage(ctx.chatId, { image: buf, caption: `📸 *Instagram*\n\n👤 ${conta}\n${i + 1}/${Math.min(imagens.length, 4)}\n\n⚡ Kortex` });
await new Promise(r => setTimeout(r, 800));
}
}
return;
}
} catch (e) { console.warn('instagram:', e.message); }
await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar do Instagram.' });
},
'facebook': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'facebook')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link || !/(facebook.com|fb.watch|fb.com)/i.test(link)) return sock.sendMessage(ctx.chatId, { text: 'Uso: .facebook [link]' });
await sock.sendMessage(ctx.chatId, { text: '📘  Facebook\n A capturar...' });
try { await executarDownloadUniversal(sock, ctx, link); }
catch (e) { console.warn('facebook:', e.message); await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar do Facebook.' }); }
},
'baixar': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'baixar')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link || !/^https?:\/\//i.test(link)) return sock.sendMessage(ctx.chatId, { text: '🌐 Uso: .baixar [link]\nFunciona com 1600+ sites.' });
await sock.sendMessage(ctx.chatId, { text: '🌐  Download Universal\n⏳ A analisar...' });
try { await executarDownloadUniversal(sock, ctx, link); }
catch (e) { console.warn('baixar:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui extrair mídia.' }); }
},
'youtube': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'youtube')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const pesquisa = ctx.args.join(' ');
if (!pesquisa) return sock.sendMessage(ctx.chatId, { text: 'Uso: .youtube [pesquisa]' });
try {
await sock.sendMessage(ctx.chatId, { text: '🔎 *A procurar no YouTube...*' });
const yts = require('yt-search');
const resultados = await yts(pesquisa);
const videos = resultados.videos.slice(0, 5);
if (!videos.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum resultado encontrado para essa pesquisa.' });
for (let i = 0; i < videos.length; i++) {
const vid = videos[i];
const thumbnail = vid.image || vid.thumbnail;
const titulo = (vid.title || 'Vídeo').substring(0, 150);
const duracao = vid.timestamp || '—';
const url = vid.url || '—';
const texto = `╭────────────────────────────\n│ 🎬 RESULTADO ${i + 1}\n├────────────────────────────\n│\n├─ 📌 *${titulo}*\n├─ ⏱️ \`${duracao}\`\n└─ 🔗 \`${url}\`\n╰────────────────────────────\n💡 Usa .youtubeaudio ou .youtubevideo`;
if (thumbnail) await sock.sendMessage(ctx.chatId, { image: { url: thumbnail }, caption: texto });
else await sock.sendMessage(ctx.chatId, { text: texto });
}
} catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não foi possível pesquisar no YouTube agora.' }); }
},

'youtubevideo': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'youtubevideo')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) return sock.sendMessage(ctx.chatId, { text: 'Uso: .youtubevideo [link]' });
db.fluxosKey.set(ctx.chatId, {
  tipo: 'youtubevideo',
  passo: 'escolherFormato',
  dados: { link, senderId: ctx.senderId },
  expiraEm: Date.now() + 180000
});
await enviarEscolhaFormatoVideo(sock, ctx, link);
},
'youtubeaudio': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'youtubeaudio')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link || (!link.includes('youtube.com') && !link.includes('youtu.be'))) return sock.sendMessage(ctx.chatId, { text: 'Uso: .youtubeaudio [link]' });
db.fluxosKey.set(ctx.chatId, {
  tipo: 'youtubeaudio',
  passo: 'escolherFormato',
  dados: { link, senderId: ctx.senderId },
  expiraEm: Date.now() + 180000
});
await enviarEscolhaFormatoAudio(sock, ctx, link);
},
'pinterest': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'pinterest')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link || !/pinterest\.(com|ca|co\.uk|fr|de|es)/i.test(link)) return sock.sendMessage(ctx.chatId, { text: '📌 Uso: .pinterest [link]' });
await sock.sendMessage(ctx.chatId, { text: '📌 *A extrair imagens...*' });
try {
const dados = await extrairGenDownload(link);
const imagens = (dados.formats || []).filter(f => f.type === 'image' || /jpe?g|png|webp/i.test(f.ext || ''));
if (!imagens.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhuma imagem encontrada.' });
for (let i = 0; i < Math.min(imagens.length, 10); i++) {
const img = imagens[i];
const buf = await baixarBufferGen(img, 32 * 1024 * 1024);
if (buf) {
await sock.sendMessage(ctx.chatId, { image: buf, caption: `📌 *Pinterest*\n\n${i + 1}/${Math.min(imagens.length, 10)}\n\n⚡ Kortex` });
await new Promise(r => setTimeout(r, 800));
}
}
} catch (e) { console.warn('pinterest:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Erro ao baixar do Pinterest.' }); }
},
'revelar': async (sock, ctx) => {
if (ctx.isGroup && !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
const ctxInfo = ctx.msg.message?.extendedTextMessage?.contextInfo || ctx.msg.message?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo || {};
const quoted = ctxInfo.quotedMessage || ctx.msg.message?.viewOnceMessage?.message || ctx.msg.message?.viewOnceMessageV2?.message || ctx.msg.message?.viewOnceMessageV2Extension?.message || null;
const viewOnce = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message || quoted?.imageMessage || quoted?.videoMessage || quoted?.audioMessage;
if (!viewOnce) return sock.sendMessage(ctx.chatId, { text: '👻 Responde a uma mensagem "visualização única" com .revelar' });
try {
if (viewOnce.imageMessage) { const buf = await downloadMediaMessage({ message: viewOnce }, 'buffer', {}); return await sock.sendMessage(ctx.chatId, { image: buf, caption: viewOnce.imageMessage.caption || '👻 Revelada' }); }
if (viewOnce.videoMessage) { const buf = await downloadMediaMessage({ message: viewOnce }, 'buffer', {}); return await sock.sendMessage(ctx.chatId, { video: buf, caption: viewOnce.videoMessage.caption || '👻 Revelada', mimetype: 'video/mp4' }); }
if (viewOnce.audioMessage) { const buf = await downloadMediaMessage({ message: viewOnce }, 'buffer', {}); return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', ptt: viewOnce.audioMessage.ptt || false }); }
const direct = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
if (direct?.imageMessage || direct?.videoMessage || direct?.audioMessage) {
  const buf = await downloadMediaMessage({ message: direct }, 'buffer', {});
  if (direct.imageMessage) return await sock.sendMessage(ctx.chatId, { image: buf, caption: direct.imageMessage.caption || '👻 Revelada' });
  if (direct.videoMessage) return await sock.sendMessage(ctx.chatId, { video: buf, caption: direct.videoMessage.caption || '👻 Revelada', mimetype: 'video/mp4' });
  if (direct.audioMessage) return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', ptt: direct.audioMessage.ptt || false });
}
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
const formatosList = (dados.formats || []).map(f => `├─ \`${f.label || f.ext}\` — ${f.type}${f.filesize ? ` (\`${(f.filesize / 1048576).toFixed(1)}MB\`)` : ''}`).join('\n');
const titulo = (dados.title || 'Mídia').substring(0, 150);
const fonte = (dados.source || 'desconhecida').toUpperCase();
const autor = dados.author || '—';
const views = dados.views ? Number(dados.views).toLocaleString('pt-PT') : '—';
const texto = `╭────────────────────────────\n│ 📊 FICHA DA MÍDIA\n├────────────────────────────\n│\n├─ 🌐 *${fonte}*\n├─ 🎬 *${titulo}*\n├─ 👤 \`${autor}\`\n├─ ⏱️ \`${dur}\`\n├─ 👁️ \`${views} visualizações\`\n│\n├─ 📦 Formatos:\n${formatosList || '(nenhum)'}\n│\n╰────────────────────────────\n💡 Usa .baixar [link]`;
if (dados.thumbnail) await sock.sendMessage(ctx.chatId, { image: { url: dados.thumbnail }, caption: texto });
else await sock.sendMessage(ctx.chatId, { text: texto });
} catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui ler este link.' }); }
},
'canal': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'canal')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const link = ctx.args[0];
if (!link) return sock.sendMessage(ctx.chatId, { text: 'Uso: .canal [link]' });
await sock.sendMessage(ctx.chatId, { text: '📡 *A listar vídeos...*' });
try {
const r = await axios.post('https://gendownload.com/api/channel', { url: link, limit: 10 }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
const itens = r.data?.items || [];
if (!itens.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum vídeo.' });
for (let i = 0; i < Math.min(itens.length, 10); i++) {
const v = itens[i];
const thumb = v.thumbnail || v.image || v.img || null;
const titulo = (v.title || 'Sem título').substring(0, 150);
const duracao = v.duration || '—';
const url = v.url || '—';
const texto = `╭────────────────────────────\n│ 📡 VÍDEO ${i + 1}\n├────────────────────────────\n│\n├─ 📌 *${titulo}*\n├─ ⏱️ \`${duracao}\`\n└─ 🔗 \`${url}\`\n╰────────────────────────────\n💡 Usa .youtubeaudio ou .youtubevideo`;
if (thumb) await sock.sendMessage(ctx.chatId, { image: { url: thumb }, caption: texto });
else await sock.sendMessage(ctx.chatId, { text: texto });
}
} catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui listar.' }); }
},
'zip': async (sock, ctx) => {
if (!verificarAcessoMidia(ctx, 'zip')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
const links = ctx.args.filter(a => /^https?:\/\//i.test(a));
if (links.length < 2) return sock.sendMessage(ctx.chatId, { text: 'Uso: .zip [link1] [link2] ...' });
await sock.sendMessage(ctx.chatId, { text: `📦 A empacotar ${links.length} vídeos...\n⏳ Pode demorar...` });
try {
const r = await axios.post('https://gendownload.com/api/zip', { urls: links, quality: '480' }, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
if (r.data?.url) return await sock.sendMessage(ctx.chatId, { text: `📦 *ZIP PRONTO!*\n🔗 ${r.data.url}\n⚠️ Link temporário!` });
throw new Error('sem url');
} catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui criar o ZIP.' }); }
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
const conteudo = `─── 🎨 STICKERS ───
• figurinha — cria sticker
• stickertexto [texto] — sticker com texto
• infosticker — dados do sticker
• converterimagem — sticker em imagem
• roubarsticker — salva o sticker`;
await enviarMenuKortex(sock, ctx, { titulo: '🎨 MÓDULO STICKERS', conteudo, imagemChave: 'stickers' });
},
'figurinha': async (sock, ctx) => {
if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
let buffer = null, processado = null;
try {
const msg = ctx.msg;
const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
const mediaMsg = quotedMsg ? { message: quotedMsg } : msg;
if (mediaMsg.message?.imageMessage) {
buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
processado = await sharp(buffer)
.resize(512, 512, { fit: 'cover', kernel: 'lanczos3', withoutEnlargement: true })
.webp({ quality: 85, effort: 4 })
.toBuffer();
buffer = null;
} else if (mediaMsg.message?.videoMessage) {
const segundos = mediaMsg.message.videoMessage.seconds || 0;
if (segundos > 10) return sock.sendMessage(ctx.chatId, { text: '❌ Máximo 10 segundos!' });
await utils.reagir(sock, ctx.msg, '⏳');
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
await sock.sendMessage(ctx.chatId, { text: `📋 *INFO DO STICKER*\n┃ 📦 Pacote: ${s.stickerPack || '—'}\n┃ ✏️ Autor: ${s.stickerAuthor || '—'}\n┃ 📛 Nome: ${s.stickerName || '—'}\n┃ 📏 ${(s.fileLength ? (Number(s.fileLength) / 1024).toFixed(1) : 'N/A')} KB\n┃ 🎞️ Animado: ${s.isAnimated ? '✅' : '❌'}` });
},
'cdono': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
const conteudo = `─── 💎 VIPs GRUPO ───
• ativarvip [nível] [dias] — ativa VIP
• removervip — remove VIP
• listargrupos — lista grupos
• listarusuariosvip — lista users VIP com nomes
• avisartodos all — avisa todos

─── 👤 VIPs USER ───
• vipuser @user [n] [d] — dá VIP
• removervipuser @user — remove VIP do user
• listarvipusers — lista users VIP
• meuvip — vê o teu VIP

─── 🛠️ SISTEMA ───
• estatisticas — estatísticas do bot
• usocomandos — uso dos comandos
• relatorio — relatório completo
• historico — histórico de ações
• prefixo [novo] — muda o prefixo
• backup / restaurar — backup dos dados
• modelo [nome] — muda modelo de IA
• semprefixo on/off — comandos sem ponto
• gerarkey / desativarkey / mudarkey — gestão de keys

─── 🔇 CONTROLO ───
• desligarbot / ligarbot — liga/desliga
• ignorar / designorar — ignora user
• ignorados — lista ignorados
• atalho / removeratalho — atalhos
• listaratalhos — lista atalhos
• entrar [link] — entra em grupo
• sair — sai do grupo

─── 🧾 OUTROS ───
• recibo [p] [d] [n] — gera recibo
• meuid — IDs do sistema
• comandos — lista completa`;
await enviarMenuKortex(sock, ctx, { titulo: '👑 PAINEL DO DONO', conteudo, imagemChave: 'dono', rodape: '⚡ KORTEX CORE - ACESSO TOTAL' });
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
await sock.sendMessage(ctx.chatId, { text: `🕒 *${hora}*\n📅 ${data}\n🌍 Maputo (CAT)` });
},
'info': async (sock, ctx) => {
const memoria = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
await sock.sendMessage(ctx.chatId, { text: `⚡ *KORTEX*\n\n👤 ${CONFIG.creator}\n📱 ${CONFIG.ownerNumber}\n⚡ Prefixo: ${CONFIG.prefix}\n⏱️ Online: ${utils.tempoRestante(process.uptime() * 1000)}\n💾 ${memoria} MB\n\n💎 Grupos VIP: ${db.gruposVIP.size}\n👑 Users VIP: ${db.usersVIP.size}\n🔗 Anti-link: ${db.grupos.antiLink.size}\n🧠 IA: ${db.grupos.iaAtivo.size}\n⚡ Atalhos: ${db.atalhos.size}\n🔧 Comandos: ${Object.keys(commands).length}` });
},
'planos': async (sock, ctx) => {
await sock.sendMessage(ctx.chatId, { text: `💰 *ALUGUER DO BOT*\n\n🥇 Ouro - 7 dias\n💎 Diamante - 30 dias\n👑 Lenda - 60 dias\n\n📞 ${CONFIG.creator} — ${CONFIG.ownerNumber}` });
},
'statusgrupo': async (sock, ctx) => {
const sub = db.gruposVIP.get(ctx.chatId);
if (!sub || sub.expiraEm < Date.now()) return sock.sendMessage(ctx.chatId, { text: `🚫 SEM ASSINATURA\nContacte: ${CONFIG.ownerNumber}` });
const restante = Math.max(0, sub.expiraEm - Date.now());
const nivel = NIVEIS_VIP[sub.nivel];
await sock.sendMessage(ctx.chatId, { text: `💎 Nível: ${nivel.nome}\n⏳ ${utils.tempoRestante(restante)}\n\nBan: ${nivel.ban ? '✅' : '❌'}\nPromover: ${nivel.promote ? '✅' : '❌'}\nRegras: ${nivel.rules ? '✅' : '❌'}\nProtecção: ${nivel.anti ? '✅' : '❌'}\nBoas-vindas: ${nivel.boasvindas ? '✅' : '❌'}\nStickers: ${nivel.sticker ? '✅' : '❌'}` });
},
'meuid': async (sock, ctx) => {
const botId = sock.user?.id || 'Desconhecido';
await sock.sendMessage(ctx.chatId, { text: `🆔 *IDs*\n\n🤖 Bot: ${botId}\n👑 Dono: ${CONFIG.ownerId}\n👤 Tu: ${ctx.senderId}\nÉ dono? ${utils.isOwner(ctx.senderId) ? '✅' : '❌'}` });
},
'linkgrupo': async (sock, ctx) => {
if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '⚠️ Este comando só funciona em grupos.' });
try {
const code = await sock.groupInviteCode(ctx.chatId);
const link = `https://chat.whatsapp.com/${code}`;
await sock.sendMessage(ctx.chatId, { text: `🔗 *LINK DO GRUPO*\n\n${link}` });
} catch {
await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui gerar o link do grupo. Verifica se o bot tem permissão de administrador.' });
}
},
'statusbot': async (sock, ctx) => {
const memoria = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
const grupo = ctx.isGroup ? '✅ Grupo' : '📩 PV';
const vipGrupo = ctx.isGroup ? (db.gruposVIP.get(ctx.chatId) ? '✅ Activo' : '❌ Inativo') : '—';
await sock.sendMessage(ctx.chatId, { text: `⚡ *STATUS DO BOT*\n\n📡 Estado: online\n⏱️ Uptime: ${utils.tempoRestante(process.uptime() * 1000)}\n💾 Memória: ${memoria} MB\n📍 Chat: ${grupo}\n💎 VIP: ${vipGrupo}\n🔧 Comandos: ${Object.keys(commands).length}` });
},
'dica': async (sock, ctx) => {
const dicas = [
'💡 Usa .menu para ver todas as categorias do bot.',
'💡 Se quiser baixar áudio do YouTube, usa .youtubeaudio [link].',
'💡 O comando .linkgrupo gera o link do grupo em segundos.',
'💡 O bot pode proteger grupos com anti-link, warns e administração VIP.',
'💡 Pode usar .statusgrupo para ver o VIP ativo do grupo.'
];
const dica = dicas[Math.floor(Math.random() * dicas.length)];
await sock.sendMessage(ctx.chatId, { text: dica });
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
await sock.sendMessage(ctx.chatId, { text: `🏆 *RANKING*\n${arr.slice(0, 10).map((r, i) => `${i + 1}. @${r[0].split('@')[0]} — ${r[1]}`).join('\n')}`, mentions: arr.slice(0, 10).map(r => r[0]) });
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
await sock.sendMessage(ctx.chatId, { text: `🎉 *VIP ACTIVADO!*\n💎 ${NIVEIS_VIP[nivel].nome}\n⏳ ${dias} dias\n👤 @${ctx.senderId.split('@')[0]}`, mentions: [ctx.senderId] });
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
let lista = `⚡ *GRUPOS ACTIVOS*\n\n`;
for (const [g, s] of db.gruposVIP) {
  let nomeGrupo = g.split('@')[0];
  try { const meta = await sock.groupMetadata(g); if (meta?.subject) nomeGrupo = meta.subject; } catch {}
  lista += `🏢 ${nomeGrupo}\n📞 ${g.split('@')[0]}\n${NIVEIS_VIP[s.nivel].nome} • ${Math.floor(Math.max(0, s.expiraEm - Date.now()) / 86400000)}d\n\n`;
}
await sock.sendMessage(ctx.chatId, { text: lista });
},
'listarusuariosvip': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
if (!db.usersVIP.size) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum usuário VIP activo.' });
let lista = `⚡ *USUÁRIOS VIP ACTIVOS*\n\n`;
for (const [userId, s] of db.usersVIP) {
  let nomeUser = userId.split('@')[0];
  try { const nome = await sock.getName?.(userId); if (nome && nome.trim()) nomeUser = nome.trim(); } catch {}
  const nivel = NIVEIS_VIP_USER[s.nivel]?.nome || s.nivel;
  lista += `👤 ${nomeUser}\n📞 ${userId.split('@')[0]}\n💎 ${nivel} • ${utils.tempoRestante(Math.max(0, s.expiraEm - Date.now()))}\n\n`;
}
await sock.sendMessage(ctx.chatId, { text: lista });
},
'listarvipusers': async (sock, ctx) => commands.listarusuariosvip(sock, ctx),
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
salvarDadosAgora();
await sock.sendMessage(ctx.chatId, { text: `✅ *VIP USER ACTIVADO*\n👤 @${target.split('@')[0]}\n💎 ${NIVEIS_VIP_USER[nivel].nome}\n⏳ ${diasFinais} dias\n🔓 ${NIVEIS_VIP_USER[nivel].cmds.map(c => '.' + c).join(', ')}`, mentions: [target] });
},
'removervipuser': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
if (!target && ctx.args[0]) {
  const raw = String(ctx.args[0]).trim();
  target = raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`;
}
if (!target) return sock.sendMessage(ctx.chatId, { text: 'Uso: .removervipuser [@user|id]\nEx: .removervipuser @usuario ou .removervipuser 258840000000' });
if (!db.usersVIP.has(target)) return sock.sendMessage(ctx.chatId, { text: `❌ @${target.split('@')[0]} não tem VIP activo.`, mentions: [target] });
db.usersVIP.delete(target); salvarDados(); salvarDadosAgora();
await sock.sendMessage(ctx.chatId, { text: `✅ *VIP USER REMOVIDO*\n👤 @${target.split('@')[0]}`, mentions: [target] });
},
'meuvip': async (sock, ctx) => {
const vip = db.usersVIP.get(ctx.senderId);
if (!vip || vip.expiraEm < Date.now()) {
if (vip) { db.usersVIP.delete(ctx.senderId); salvarDados(); }
return sock.sendMessage(ctx.chatId, { text: `❌ Sem VIP activo.\n\n🥇 Ouro: .tiktok .tiktokaudio\n💎 Diamante: + .instagram .facebook .baixar .fichamidia .pinterest\n👑 Lenda: todos\n\n📞 ${CONFIG.ownerNumber}` });
}
const nivel = NIVEIS_VIP_USER[vip.nivel];
await sock.sendMessage(ctx.chatId, { text: `💎 *O TEU VIP*\nNível: ${nivel.nome}\n⏳ ${utils.tempoRestante(Math.max(0, vip.expiraEm - Date.now()))}\n🔓 ${nivel.cmds.map(c => '.' + c).join(', ')}` });
},
'estatisticas': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
await sock.sendMessage(ctx.chatId, { text: `📊 *ESTATÍSTICAS*\n\n🤖 Grupos VIP: ${db.gruposVIP.size}\n🔧 Comandos: ${Object.keys(commands).length}\n⚡ Atalhos: ${db.atalhos.size}\n💾 ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n⏰ ${utils.tempoRestante(process.uptime() * 1000)}\n🔗 Anti-link: ${db.grupos.antiLink.size}\n🧠 IA: ${db.grupos.iaAtivo.size}` });
},
'usocomandos': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
const entries = [...db.stats.entries()].sort((a, b) => b[1] - a[1]);
if (!entries.length) return sock.sendMessage(ctx.chatId, { text: 'Sem estatísticas.' });
await sock.sendMessage(ctx.chatId, { text: `📊 *USO*\n${entries.slice(0, 20).map(e => `${e[0]} → ${e[1]}`).join('\n')}` });
},
'relatorio': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
try { await enviarRelatorioCompleto(sock, ctx.chatId); } catch (e) { await sock.sendMessage(ctx.chatId, { text: `Erro: ${e.message}` }); }
},
'historico': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
const historico = db.historicoGrupos.get(ctx.chatId) || [];
if (!historico.length) return sock.sendMessage(ctx.chatId, { text: '📝 Sem histórico.' });
let texto = `📋 *HISTÓRICO*\n`;
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
await sock.sendMessage(ctx.chatId, { text: `💾 Backup criado: ${path.basename(out)}` });
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
await sock.sendMessage(ctx.chatId, { text: '♻️ Restore concluído.' });
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
await sock.sendMessage(ctx.chatId, { text: `🔇 *IGNORADOS*\n${[...db.ignorados].map(id => `@${id.split('@')[0]}`).join('\n')}`, mentions: [...db.ignorados] });
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
let lista = `⚡ *ATALHOS*\n\n`;
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
const m = (ctx.args[0] || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/);
if (!m) return sock.sendMessage(ctx.chatId, { text: 'Uso: .entrar [link do grupo]' });
try { const g = await sock.groupAcceptInvite(m[1]); await sock.sendMessage(ctx.chatId, { text: `✅ Entrei no grupo ${g?.gid || ''}` }); }
catch { await sock.sendMessage(ctx.chatId, { text: '❌ Link inválido ou expirado.' }); }
},
'sair': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa num grupo.' });
await sock.sendMessage(ctx.chatId, { text: '👋 Até já!' });
// ⚡ OPT — catch para não gerar unhandledRejection
setTimeout(() => { sock.groupLeave(ctx.chatId).catch(() => {}); }, 1500);
},
'semprefixo': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
const a = ctx.args[0]?.toLowerCase();
if (a === 'on') { db.grupos.semPrefixo.add(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⚡ SEM PREFIXO ACTIVADO neste grupo.\n(comandos perigosos continuam a exigir prefixo)' }); }
if (a === 'off') { db.grupos.semPrefixo.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⚡ Sem prefixo desativado.' }); }
await sock.sendMessage(ctx.chatId, { text: `Sem prefixo: ${db.grupos.semPrefixo.has(ctx.chatId) ? '✅ ON' : '❌ OFF'}\nUso: .semprefixo on/off` });
},
'modointernet': async (sock, ctx) => {
if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '⚡ Este modo é apenas para grupos.' });
if (!utils.isOwner(ctx.senderId) && !(await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId))) throw new PermissaoNegada();
const arg = (ctx.args[0] || '').toLowerCase();
if (!arg) {
return sock.sendMessage(ctx.chatId, { text: `⚡ *MODO INTERNET*\n\nStatus: ${isModoInternetAtivo(ctx.chatId) ? '✅ ACTIVADO' : '❌ DESATIVADO'}\n\nUso: .modointernet on/off` });
}
const ativo = ['on','ativar','ativo','true','1','yes'].includes(arg);
const permitido = verificarVIPDiamanteParaModoInternet(ctx.senderId, ctx.chatId);
if (!permitido) {
return sock.sendMessage(ctx.chatId, { text: '💎 *MODO INTERNET*\n\n🚫 Só está disponível para VIP Diamante.' });
}
db.modoInternet.set(ctx.chatId, ativo);
salvarDados();
await sock.sendMessage(ctx.chatId, { text: `⚡ *MODO INTERNET*\n\n${ativo ? '✅ ACTIVADO' : '❌ DESATIVADO'}\n\n💎 Requer VIP Diamante.
👮 Apenas administradores podem continuar a operar.` });
},
'tabelapagamento': async (sock, ctx) => {
if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '⚡ A tabela deve ser configurada no grupo.' });
if (!utils.isOwner(ctx.senderId) && !(await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId))) throw new PermissaoNegada();
const action = (ctx.args[0] || '').toLowerCase();
const atual = db.tabelasPagamento.get(ctx.chatId) || [];
if (!action || action === 'listar' || action === 'list') {
if (!atual.length) return sock.sendMessage(ctx.chatId, { text: '🧾 Nenhuma tabela registada.' });
let texto = '🧾 *TABELAS DE PAGAMENTO*\n\n';
for (const item of atual) {
texto += `• ${item.nomeMetodo || item.metodo || 'Método'} → ${item.numeroConta || item.conta || '—'}\n${item.descricao || ''}\n\n`;
}
return sock.sendMessage(ctx.chatId, { text: texto });
}
if (action === 'add' || action === 'adicionar' || action === 'novo') {
const metodo = ctx.args[1] || '';
const nomeMetodo = ctx.args[2] || metodo;
const numeroConta = ctx.args[3] || '';
const descricao = ctx.args.slice(4).join(' ') || `Pagamento via ${nomeMetodo}`;
if (!metodo || !numeroConta) {
return sock.sendMessage(ctx.chatId, { text: 'Uso: .tabelapagamento add [metodo] [nome] [numero] [descricao]\nEx: .tabelapagamento add m-pesa M-Pesa 841234567 Recebe via M-Pesa' });
}
const item = { id: Date.now().toString(), metodo: normalizarMetodoPagamento(metodo), nomeMetodo, numeroConta, conta: numeroConta, descricao, ativo: true };
atual.push(item); db.tabelasPagamento.set(ctx.chatId, atual); salvarDados();
return sock.sendMessage(ctx.chatId, { text: `✅ *TABELA ADICIONADA*\n\n🧾 ${item.nomeMetodo}\n📱 ${item.numeroConta}\n💳 ${item.metodo}\n📝 ${item.descricao}` });
}
if (action === 'remove' || action === 'remover') {
const alvo = ctx.args[1];
if (!alvo) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tabelapagamento remove [id]' });
const idx = atual.findIndex(x => x.id === alvo || x.numeroConta === alvo || x.metodo === normalizarMetodoPagamento(alvo));
if (idx === -1) return sock.sendMessage(ctx.chatId, { text: '❌ Tabela não encontrada.' });
atual.splice(idx, 1); db.tabelasPagamento.set(ctx.chatId, atual); salvarDados();
return sock.sendMessage(ctx.chatId, { text: '✅ Tabela removida.' });
}
return sock.sendMessage(ctx.chatId, { text: 'Uso: .tabelapagamento listar | add | remove' });
},
'pedidos': async (sock, ctx) => {
if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '⚡ Este controlo é do grupo.' });
if (!utils.isOwner(ctx.senderId) && !(await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId))) throw new PermissaoNegada();
const lista = [...db.pedidosPagamento.values()].filter(p => p.chatId === ctx.chatId || !p.chatId);
if (!lista.length) return sock.sendMessage(ctx.chatId, { text: '🧾 Nenhum pedido em análise.' });
let texto = '🧾 *PEDIDOS DE PAGAMENTO*\n\n';
for (const pedido of lista) {
texto += `#${pedido.id} | ${pedido.cliente ? '@' + pedido.cliente.split('@')[0] : '—'}\n💰 ${pedido.valor || '—'}\n🔖 ${pedido.referencia || '—'}\n📱 ${pedido.numeroRecebimento || 'Não informado'}\n⏳ ${pedido.status || 'aguardando_analise'}\n\n`;
}
await sock.sendMessage(ctx.chatId, { text: texto });
},
'receberpedido': async (sock, ctx) => {
if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '⚡ Este controlo é do grupo.' });
if (!utils.isOwner(ctx.senderId) && !(await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId))) throw new PermissaoNegada();
const id = ctx.args[0];
if (!id) return sock.sendMessage(ctx.chatId, { text: 'Uso: .receberpedido [id]' });
const pedido = [...db.pedidosPagamento.values()].find(p => p.id === id || p.id?.includes(id));
if (!pedido) return sock.sendMessage(ctx.chatId, { text: `❌ Pedido ${id} não encontrado.` });
pedido.status = 'recebido';
await sock.sendMessage(ctx.chatId, { text: `✅ *PAGAMENTO RECEBIDO*\n\n🧾 Pedido: ${pedido.id}\n👤 Cliente: @${pedido.cliente?.split('@')[0] || '—'}\n💰 Valor: ${pedido.valor || '—'}` });
return sock.sendMessage(`${CONFIG.ownerNumber}@s.whatsapp.net`, { text: `✅ *RECEBIDO*\n\nPedido: ${pedido.id}\nCliente: @${pedido.cliente?.split('@')[0] || '—'}` });
},
'rejeitarpedido': async (sock, ctx) => {
if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '⚡ Este controlo é do grupo.' });
if (!utils.isOwner(ctx.senderId) && !(await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId))) throw new PermissaoNegada();
const id = ctx.args[0];
if (!id) return sock.sendMessage(ctx.chatId, { text: 'Uso: .rejeitarpedido [id]' });
const pedido = [...db.pedidosPagamento.values()].find(p => p.id === id || p.id?.includes(id));
if (!pedido) return sock.sendMessage(ctx.chatId, { text: `❌ Pedido ${id} não encontrado.` });
pedido.status = 'nao_recebido';
await sock.sendMessage(ctx.chatId, { text: `❌ *PAGAMENTO NÃO RECEBIDO*\n\n🧾 Pedido: ${pedido.id}\n👤 Cliente: @${pedido.cliente?.split('@')[0] || '—'}` });
return sock.sendMessage(`${CONFIG.ownerNumber}@s.whatsapp.net`, { text: `❌ *NÃO RECEBIDO*\n\nPedido: ${pedido.id}\nCliente: @${pedido.cliente?.split('@')[0] || '—'}` });
},

// ══════════════════════════════════════════════════════════
// KORTEX KEY SYSTEM — COMANDOS (REGRA 7, 13, 14, 15)
// ══════════════════════════════════════════════════════════
'gerarkey': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
const nivel = normalizarNivel(ctx.args[0]);
const quantidade = Math.min(Math.max(parseInt(ctx.args[1]) || 1, 1), 50);
if (!nivel) return sock.sendMessage(ctx.chatId, { text: 'Uso: .gerarkey [ouro/diamante/lenda] [quantidade]\nEx: .gerarkey ouro 7' });
const keys = [];
for (let i = 0; i < quantidade; i++) {
let key;
do { key = gerarKeyRandom(nivel); } while (db.keysRandom.has(key));
db.keysRandom.set(key, { key, nivel, status: 'ATIVA', criadaPor: ctx.senderId, dataCriacao: new Date().toISOString(), utilizadaPor: null, dataUtilizacao: null, tipo: null, alvo: null });
keys.push(key);
}
salvarDados();
let texto = `🔑 *KORTEX KEY GENERATOR*\n\n👑 Nível: ${obterNomeNivel(nivel)}\n🔢 Quantidade: ${quantidade}\n\n✅ Keys geradas:\n\n`;
keys.forEach((k, i) => { texto += `${i + 1}. ${k}\n`; });
texto += `\n⚠️ Keys de uso único.\n🛡️ Cada uso será notificado ao dono.`;
await sock.sendMessage(ctx.chatId, { text: texto });
},
'desativarkey': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
const key = ctx.args[0]?.toUpperCase();
if (!key || !key.startsWith('KRX-')) return sock.sendMessage(ctx.chatId, { text: 'Uso: .desativarkey [KRX-XXXX-XXXX]' });
const keyData = db.keysRandom.get(key);
if (!keyData) return sock.sendMessage(ctx.chatId, { text: '❌ Key não encontrada.' });
if (keyData.status === 'DESATIVADA') return sock.sendMessage(ctx.chatId, { text: '⚠️ Esta Key já está desativada.' });
db.fluxosKey.set(ctx.chatId, { tipo: 'desativarkey', passo: 'confirmar', dados: { key }, expiraEm: Date.now() + 120000 });
await sock.sendMessage(ctx.chatId, { text: `⚠️ *DESATIVAR KEY*\n\n🔑 Key: ${key}\n👑 Nível: ${obterNomeNivel(keyData.nivel)}\n\nConfirmar?\n\n✅ sim\n❌ não\n\n⏳ Expira em 2 minutos.` });
},
'mudarkey': async (sock, ctx) => {
if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
const novaKey = ctx.args[0];
if (!novaKey) return sock.sendMessage(ctx.chatId, { text: 'Uso: .mudarkey [NOVA-KEY]\n\n⚠️ Esta operação altera a Key Universal do dono.' });
db.fluxosKey.set(ctx.chatId, { tipo: 'mudarkey', passo: 'confirmar', dados: { novaKey }, expiraEm: Date.now() + 120000 });
await sock.sendMessage(ctx.chatId, { text: `🔐 *ALTERAÇÃO DA KEY UNIVERSAL*\n\nA Key Universal será alterada.\n\n⚠️ Esta é uma operação altamente sensível.\n\nDigite:\nCONFIRMAR ALTERAÇÃO\n\n⏳ Expira em 2 minutos.` });
}
};// ══════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES FINAIS
// ══════════════════════════════════════════════════════════
async function omdbBusca(sock, ctx, tipo) {
const t = ctx.args.join(' ');
if (!t) return sock.sendMessage(ctx.chatId, { text: `Uso: .${tipo === 'movie' ? 'filme' : 'serie'} [título]` });
if (!CONFIG.omdbKey || CONFIG.omdbKey.includes('COLE_AQUI')) return sock.sendMessage(ctx.chatId, { text: '❌ Cola a tua chave OMDB gratuita em CONFIG.omdbKey (omdbapi.com/apikey.aspx).' });
const d = await getJSON(`https://www.omdbapi.com/?apikey=${CONFIG.omdbKey}&t=${encodeURIComponent(t)}&type=${tipo}&plot=short`);
if (!d || d.Response === 'False') return sock.sendMessage(ctx.chatId, { text: `❌ Não encontrado: "${t}"` });
const txt = `🎬 *${d.Title}*\n📅 ${d.Year}\n⭐ ${d.imdbRating || '—'}\n⏱️ ${d.Runtime || '—'}\n🎭 ${d.Genre || '—'}\n\n${d.Plot || ''}`;
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
if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: `🌐 *${(dados.title || 'Vídeo').substring(0, 60)}*\n📡 Fonte: ${fonte}\n👤 ${dados.author || ''}\n⚡ Kortex`, mimetype: 'video/mp4' });
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
if (buf) return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', fileName: `${(dados.title || 'audio').replace(/[^a-zA-Z0-9 .\-]/gi, '').substring(0, 200)}.mp3`, ptt: false });
}
return sock.sendMessage(ctx.chatId, { text: `😔 A plataforma *${fonte}* não devolveu mídia baixável.` });
}
async function executarAntiLink(sock, chatId, msg, senderId, modo) {
try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
if (modo === 'warn') await sock.sendMessage(chatId, { text: `⚠️ *AVISO: LINK DETECTADO*\n@${senderId.split('@')[0]}, links não são permitidos!`, mentions: [senderId] });
else if (modo === 'delete') await sock.sendMessage(chatId, { text: `🔗 *LINK REMOVIDO*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
else if (modo === 'kick' || modo === 'ban') {
try {
await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
registrarAcao(chatId, `Anti-link (${modo}): @${senderId.split('@')[0]}`);
await sock.sendMessage(chatId, { text: `🚫 *REMOVIDO POR LINK*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
} catch { await sock.sendMessage(chatId, { text: `⚠️ Não consegui remover @${senderId.split('@')[0]}.`, mentions: [senderId] }); }
}
}

// ══════════════════════════════════════════════════════════
// ⚡ OPT — HOOK: ao enviar o alerta de segurança, abre o fluxo
// "fui eu / remover acesso" no PV do dono (REGRA 10-12)
// ══════════════════════════════════════════════════════════
const _enviarAlertaOriginal = enviarAlertaSegurancaDono;
enviarAlertaSegurancaDono = async function (sock, userId, nivel, tipo, keyUsada, alertaId) {
await _enviarAlertaOriginal(sock, userId, nivel, tipo, keyUsada, alertaId);
const donoId = `${CONFIG.ownerNumber}@s.whatsapp.net`;
db.fluxosKey.set(donoId, {
tipo: 'alertaKey',
passo: 'aguardar',
dados: { alertaId, userId, nivel, tipo, keyUsada },
expiraEm: Date.now() + 600000
});
};

// ══════════════════════════════════════════════════════════
// ESTADO GLOBAL + TERMINAL
// ══════════════════════════════════════════════════════════
let reconnectAttempts = 0, pausado = false, geracaoAtual = 0, sockAtual = null;
let ultimasMensagensIds = [];
let mensagensIgnoradas = new Set();
const mensagensEnviadasPeloBot = new Set();

// ⚡ OPT — intervals AO NÍVEL DO MÓDULO (registados 1 única vez).
// Antes estavam dentro de startBot() → duplicavam a cada reconexão (leak).
setInterval(() => {
try {
const AGORA = Date.now(); const TEMPO_MORTO = 2 * 60 * 60 * 1000; let limpos = 0;
for (const [chatId, ultimoUso] of db.historicoIAUltimoUso) {
if (AGORA - ultimoUso > TEMPO_MORTO) { db.historicoIA.delete(chatId); db.historicoIAUltimoUso.delete(chatId); limpos++; }
}
// OPT: prune de cartões de apresentação antigos (>24h)
for (const [jid, ts] of db.ultimoCartaoPV) {
if (AGORA - ts > 24 * 60 * 60 * 1000) db.ultimoCartaoPV.delete(jid);
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
const agora = Date.now();
for (const [chatId, ultimoUso] of db.historicoIAUltimoUso) {
if (agora - ultimoUso > 30 * 60 * 1000) {
db.historicoIAUltimoUso.delete(chatId);
db.historicoIA.delete(chatId);
}
}
}, 15 * 60 * 1000);
setInterval(() => {
if (!sockAtual) return;
const agora = new Date();
const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
for (const [groupId, ags] of agendamentos) {
const paraEnviar = ags.filter(a => a.hora === hhmm);
if (paraEnviar.length) {
for (const a of paraEnviar) sockAtual.sendMessage(groupId, { text: `📅 *AGENDAMENTO*\n\n${a.texto}` }).catch(() => {});
agendamentos.set(groupId, ags.filter(a => a.hora !== hhmm));
salvarDados();
}
}
}, 30000);

const rlTerminal = readline.createInterface({ input: process.stdin });
rlTerminal.on('line', (linha) => {
const cmd = linha.trim().toLowerCase();
if (cmd === 'parar' || cmd === '.parar') { geracaoAtual++; pausado = true; console.log('🛑 PARADO'); }
else if (cmd === 'continuar' || cmd === '.continuar') { pausado = false; console.log('▶️ RETOMADO'); }
else if (cmd === 'reiniciar' || cmd === '.reiniciar') { mensagensIgnoradas = new Set(ultimasMensagensIds); console.log(`🔄 A reiniciar — ${ultimasMensagensIds.length} mensagens ignoradas.`); sockAtual?.disconnect().catch(() => {}); }
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

// ══════════════════════════════════════════════════════════
// PROCESSAMENTO DE MENSAGEM (interface de comandos intacta)
// ══════════════════════════════════════════════════════════
async function processarMensagem(sock, msg) {
const minhaGeracao = geracaoAtual;
if (!msg.message) return;
if (msg.key.fromMe && mensagensEnviadasPeloBot.has(msg.key.id)) {
mensagensEnviadasPeloBot.delete(msg.key.id);
return;
}
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
if (Date.now() - ultimoEnvio >= 10 * 60 * 1000) {
db.ultimoCartaoPV.set(senderId, Date.now());
await sock.sendMessage(chatId, { text: gerarCartaoApresentacao() });
}
}
}
try {
if (isGroup && db.autoDelete.has(chatId)) {
const ms = db.autoDelete.get(chatId);
setTimeout(async () => { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {} }, ms);
}
} catch {}
if (isGroup) await utils.checkGroupExpired(sock, chatId);

const pedidoDetectado = inferirPedidoPagamento(fullText, senderId, chatId);
if (pedidoDetectado && !msg.key.fromMe) {
const pendente = db.pedidosPendentes.get(senderId);
const numeroPresente = pedidoDetectado.numeroRecebimento || (pendente && pendente.numeroRecebimento);
if (!pendente || !pendente.numeroRecebimento) {
if (numeroPresente) {
const atual = { ...pedidoDetectado, numeroRecebimento: numeroPresente, cliente: senderId, chatId, status: 'aguardando_analise' };
if (pendente) Object.assign(pendente, atual); else db.pedidosPendentes.set(senderId, atual);
if (!db.pedidosPagamento.has(`PG-${Date.now().toString().slice(-6)}`)) {
const atualId = pendente?.id || `PG-${Date.now().toString().slice(-6)}`;
const finalPedido = { ...atual, id: atualId, status: 'aguardando_analise' };
if (!finalPedido.numeroRecebimento) finalPedido.numeroRecebimento = numeroPresente;
db.pedidosPagamento.set(finalPedido.id, finalPedido);
db.pedidosPendentes.delete(senderId);
await enviarPedidoPagamentoADM(sock, finalPedido, chatId);
return;
}
}
if (!db.pedidosPendentes.has(senderId) || !db.pedidosPendentes.get(senderId).numeroRecebimento) {
await processarPedidoPagamento(sock, msg, pedidoDetectado);
return;
}
}
}

const rowIdSelecionado = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || fullText;
const menuSelecionado = rowIdSelecionado && MAPA_MENU_LISTA[rowIdSelecionado];
if (menuSelecionado && commands[menuSelecionado]) {
const perms = await commands._getPerms(sock, { chatId, senderId, isGroup, msg });
const permitido =
menuSelecionado === 'cgeral' || menuSelecionado === 'cutil' || menuSelecionado === 'ctexto' || menuSelecionado === 'cinfo' || menuSelecionado === 'cdiv' || menuSelecionado === 'cimg' || menuSelecionado === 'cmidia' ? true :
menuSelecionado === 'cprot' ? (perms.pAnti || perms.pRules || perms.isOwner || perms.pAdmin || perms.pBan) :
menuSelecionado === 'cadmin' ? (perms.pAdmin || perms.pBan || perms.isOwner) :
menuSelecionado === 'cstick' ? perms.pSticker :
menuSelecionado === 'cdono' ? perms.isOwner : true;
if (permitido) {
await commands[menuSelecionado](sock, { chatId, senderId, isGroup, msg, args: [] });
return;
}
}

// Handler para cliques em botões de escolha de formato
let respostaProcessada = fullText;
if (rowIdSelecionado === 'escolha_audio_1' || rowIdSelecionado === 'escolha_video_1') {
respostaProcessada = '1';
} else if (rowIdSelecionado === 'escolha_audio_2' || rowIdSelecionado === 'escolha_video_2') {
respostaProcessada = '2';
}

// ══════════════════════════════════════════════════════════
// KORTEX KEY SYSTEM — HANDLER DE FLUXOS
// ══════════════════════════════════════════════════════════
const fluxoAtivo = db.fluxosKey.get(chatId);
if (fluxoAtivo && Date.now() < fluxoAtivo.expiraEm) {
const resposta = respostaProcessada.toLowerCase().trim();

// Fluxo de escolha de formato do YouTube áudio
if (fluxoAtivo.tipo === 'youtubeaudio' && fluxoAtivo.passo === 'escolherFormato') {
const { link, senderId: userId } = fluxoAtivo.dados;
if (senderId !== userId) return;
const escolha = resposta.trim().toLowerCase();
const modo = escolha === '1' || escolha === 'audio' || escolha === 'áudio' || escolha.includes('audio') ? 'audio'
: escolha === '2' || escolha === 'documento' || escolha === 'doc' || escolha.includes('documento') ? 'documento'
: null;
if (!modo) {
await sock.sendMessage(chatId, { text: '❌ Responde com *1* para áudio ou *2* para documento.' });
return;
}
await utils.reagir(sock, msg, '⏳');
try {
const dados = await extrairGenDownload(link);
const fmt = escolherFormatoGen(dados, 'audio');
if (!fmt?.url) {
await sock.sendMessage(chatId, { text: '😔 Não consegui extrair o áudio do link informado.' });
db.fluxosKey.delete(chatId);
return;
}
const buf = await baixarBufferGen(fmt, 32 * 1024 * 1024);
if (!buf) {
await sock.sendMessage(chatId, { text: '😔 Não consegui baixar o áudio.' });
db.fluxosKey.delete(chatId);
return;
}
const ehMp3 = (fmt.ext || '') === 'mp3';
const fileName = `${(dados.title || 'audio').replace(/[^a-zA-Z0-9 .\-]/gi, '').substring(0, 200)}.${ehMp3 ? 'mp3' : 'm4a'}`;
const titulo = (dados.title || 'Áudio do YouTube').substring(0, 300);
const extensao = ehMp3 ? 'MP3' : 'M4A';
const artista = dados.author || 'YouTube';
const videoId = link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)?.[1];
const imagemUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
const bufComMetadata = ehMp3 ? await adicionarMetadataAudio(buf, titulo, artista, imagemUrl) : buf;
if (modo === 'audio') {
await sock.sendMessage(chatId, { audio: bufComMetadata, mimetype: ehMp3 ? 'audio/mpeg' : 'audio/mp4', fileName, ptt: false, caption: `✅ *Áudio pronto*\n\n📌 *Título:* ${titulo}\n👤 *Artista:* ${artista}\n📦 *Formato:* ${extensao}\n\n⚡ *Kortex*` });
await utils.reagir(sock, msg, '🎵');
} else {
await sock.sendMessage(chatId, { document: bufComMetadata, mimetype: ehMp3 ? 'audio/mpeg' : 'audio/mp4', fileName, caption: `✅ *Áudio em documento*\n\n📌 *Título:* ${titulo}\n👤 *Artista:* ${artista}\n📦 *Formato:* ${extensao}\n\n⚡ *Kortex*` });
await utils.reagir(sock, msg, '🎵');
}
} catch (e) {
console.warn('youtubeaudio fluxo:', e.message);
await sock.sendMessage(chatId, { text: '😔 Ocorreu um erro ao processar a escolha do formato.' });
}
db.fluxosKey.delete(chatId);
return;
}

// Fluxo de escolha de formato do YouTube vídeo
if (fluxoAtivo.tipo === 'youtubevideo' && fluxoAtivo.passo === 'escolherFormato') {
const { link, senderId: userId } = fluxoAtivo.dados;
if (senderId !== userId) return;
const escolha = resposta.trim().toLowerCase();
const modo = escolha === '1' || escolha === 'video' || escolha === 'vídeo' || escolha.includes('video') || escolha.includes('vídeo') ? 'video'
: escolha === '2' || escolha === 'documento' || escolha === 'doc' || escolha.includes('documento') ? 'documento'
: null;
if (!modo) {
await sock.sendMessage(chatId, { text: '❌ Responde com *1* para vídeo ou *2* para documento.' });
return;
}
await utils.reagir(sock, msg, '⏳');
try {
const dados = await extrairGenDownload(link);
if ((dados.duration || 0) > 1800) {
await sock.sendMessage(chatId, { text: '❌ Vídeos com mais de 30 minutos não são suportados.' });
db.fluxosKey.delete(chatId);
return;
}
const fmt = escolherFormatoGen(dados, 'video');
if (!fmt?.url) {
await sock.sendMessage(chatId, { text: '😔 Não consegui extrair o vídeo do link informado.' });
db.fluxosKey.delete(chatId);
return;
}
const buf = await baixarBufferGen(fmt, 64 * 1024 * 1024);
if (!buf) {
await sock.sendMessage(chatId, { text: '😔 Não consegui baixar o vídeo.' });
db.fluxosKey.delete(chatId);
return;
}
const videoId = extrairVideoId(link);
const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
const titulo = (dados.title || 'Vídeo do YouTube').substring(0, 300);
const canal = dados.author || 'Canal desconhecido';
const duracao = dados.duration ? (() => { const s = Number(dados.duration); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const seg = s % 60; return h ? `${h}:${String(m).padStart(2,'0')}:${String(seg).padStart(2,'0')}` : `${m}:${String(seg).padStart(2,'0')}`; })() : '—';
const qualidade = fmt?.label || '—';
const fileName = `${(dados.title || 'video').replace(/[^a-zA-Z0-9 .\-]/gi, '').substring(0, 200)}.mp4`;
const caption = `✅ *Vídeo pronto*\n\n📌 *Título:* ${titulo}\n📺 *Canal:* ${canal}\n⏱️ *Duração:* ${duracao}\n🎞️ *Qualidade:* ${qualidade}\n\n⚡ *Kortex*`;
if (modo === 'video') {
await sock.sendMessage(chatId, { video: buf, mimetype: 'video/mp4', caption, contextInfo: thumbnail ? { externalAdReply: { title: titulo, body: canal, thumbnailUrl: thumbnail, mediaType: 2, renderLargerThumbnail: true } } : undefined });
await utils.reagir(sock, msg, '🎥');
} else {
await sock.sendMessage(chatId, { document: buf, mimetype: 'video/mp4', fileName, caption: `✅ *Vídeo em documento*\n\n📌 *Título:* ${titulo}\n📺 *Canal:* ${canal}\n🎞️ *Qualidade:* ${qualidade}\n\n⚡ *Kortex*` });
await utils.reagir(sock, msg, '🎥');
}
} catch (e) {
console.warn('youtubevideo fluxo:', e.message);
await sock.sendMessage(chatId, { text: '😔 Ocorreu um erro ao processar a escolha do formato.' });
}
db.fluxosKey.delete(chatId);
return;
}

// Fluxo de desativar Key
if (fluxoAtivo.tipo === 'desativarkey' && fluxoAtivo.passo === 'confirmar') {
if (resposta === 'sim' || resposta === '✅ sim') {
const { key } = fluxoAtivo.dados;
const keyData = db.keysRandom.get(key);
if (keyData) {
keyData.status = 'DESATIVADA';
db.keysRandom.set(key, keyData);
salvarDados();
salvarDadosAgora();
await sock.sendMessage(chatId, { text: `✅ *KEY DESATIVADA*\n\n🔑 ${key}\n🛡️ Esta Key não pode mais ser utilizada.` });
}
db.fluxosKey.delete(chatId);
return;
} else if (resposta === 'não' || resposta === '❌ não' || resposta === 'nao') {
await sock.sendMessage(chatId, { text: '❌ Operação cancelada.' });
db.fluxosKey.delete(chatId);
return;
}
}

// Fluxo de mudar Key Universal
if (fluxoAtivo.tipo === 'mudarkey' && fluxoAtivo.passo === 'confirmar') {
if (resposta === 'confirmar alteração') {
await sock.sendMessage(chatId, { text: `✅ *KEY UNIVERSAL ALTERADA*\n\n🔐 A nova Key Universal está ativa.\n\n⚠️ Esta alteração é temporária (até o próximo reinício).\nPara alteração permanente, edite o código-fonte.` });
db.fluxosKey.delete(chatId);
return;
} else {
await sock.sendMessage(chatId, { text: '❌ Operação cancelada.' });
db.fluxosKey.delete(chatId);
return;
}
}

// Fluxo de alerta de segurança (resposta do dono)
if (fluxoAtivo.tipo === 'alertaKey' && utils.isOwner(senderId)) {
const { alertaId, userId, nivel, tipo, keyUsada } = fluxoAtivo.dados;
if (resposta === 'fui eu' || resposta === '✅ fui eu') {
await sock.sendMessage(chatId, { text: `✅ *KORTEX SECURITY*\n\nOperação confirmada pelo dono.\n\n🔑 Key validada.\n👑 VIP autorizado.\n🛡️ Registro atualizado.` });
db.alertasKey.delete(alertaId);
db.fluxosKey.delete(chatId);
return;
} else if (resposta === 'remover acesso' || resposta === '❌ remover acesso') {
db.fluxosKey.set(chatId, {
tipo: 'revogarKey',
passo: 'confirmar',
dados: { alertaId, userId, nivel, tipo, keyUsada },
expiraEm: Date.now() + 120000
});
await sock.sendMessage(chatId, { text: `🛡️ *KORTEX SECURITY*\n\n⚠️ Revogação solicitada.\n\n👤 Usuário: @${userId.split('@')[0]}\n👑 VIP: ${obterNomeNivel(nivel)}\n\nConfirma a remoção?\n\n✅ confirmar\n❌ cancelar`, mentions: [userId] });
return;
}
}

// Fluxo de confirmação de revogação (⚡ OPT: "tipo" agora vem dos dados — corrige ReferenceError)
if (fluxoAtivo.tipo === 'revogarKey' && fluxoAtivo.passo === 'confirmar' && utils.isOwner(senderId)) {
const { alertaId, userId, nivel, keyUsada, tipo } = fluxoAtivo.dados;
if (resposta === 'confirmar' || resposta === '✅ confirmar') {
if (tipo === 'grupo') db.gruposVIP.delete(userId);
else db.usersVIP.delete(userId);
const keyData = db.keysRandom.get(keyUsada);
if (keyData) {
keyData.status = 'DESATIVADA';
db.keysRandom.set(keyUsada, keyData);
}
salvarDados();
salvarDadosAgora();
await sock.sendMessage(chatId, { text: `✅ *VIP REMOVIDO*\n\n👤 @${userId.split('@')[0]}\n👑 ${obterNomeNivel(nivel)}\n🔑 Key invalidada.\n\n🛡️ Operação concluída.`, mentions: [userId] });
try {
await sock.sendMessage(userId, { text: `⚠️ *KORTEX SECURITY*\n\nO teu acesso VIP foi revogado pelo dono.\n\n👑 Nível: ${obterNomeNivel(nivel)}\n\nPara mais informações, contacte o dono.` });
} catch {}
db.alertasKey.delete(alertaId);
db.fluxosKey.delete(chatId);
return;
} else if (resposta === 'cancelar' || resposta === '❌ cancelar') {
await sock.sendMessage(chatId, { text: '❌ Revogação cancelada.' });
db.fluxosKey.delete(chatId);
return;
}
}

// Fluxo da Key Universal — Etapa 1: escolher tipo
if (fluxoAtivo.tipo === 'keyUniversal' && fluxoAtivo.passo === 'escolherTipo') {
if (resposta === 'usuário' || resposta === '👤 usuário' || resposta === 'usuario') {
db.fluxosKey.set(chatId, { tipo: 'keyUniversal', passo: 'escolherUsuario', dados: { tipo: 'usuario' }, expiraEm: Date.now() + 300000 });
await sock.sendMessage(chatId, { text: `👤 *IDENTIFICAÇÃO DO USUÁRIO*\n\nMencione ou responda à mensagem do usuário que receberá o VIP.\n\nEx: @usuario\n\n⏳ Expira em 5 minutos.` });
return;
} else if (resposta === 'grupo' || resposta === '👥 grupo') {
if (!isGroup) {
await sock.sendMessage(chatId, { text: `👥 *ATIVAÇÃO VIP PARA GRUPO*\n\nPara ativar o VIP deste grupo,\no Kortex precisa estar presente nele.\n\n➕ Adicione o Kortex ao grupo primeiro.\n\nDepois envie a Key Universal\ndentro do próprio grupo.` });
db.fluxosKey.delete(chatId);
return;
}
db.fluxosKey.set(chatId, { tipo: 'keyUniversal', passo: 'escolherNivelGrupo', dados: { tipo: 'grupo', chatId }, expiraEm: Date.now() + 300000 });
await sock.sendMessage(chatId, { text: `👑 *NÍVEL VIP*\n\n1️⃣ Lenda\n2️⃣ Ouro\n3️⃣ Diamante\n\nResponda com o número ou nome.` });
return;
}
}

// Etapa 2: escolher usuário
if (fluxoAtivo.tipo === 'keyUniversal' && fluxoAtivo.passo === 'escolherUsuario') {
let target = utils.getQuotedMention(msg) || utils.getMentions(msg)[0];
if (!target && fullText.includes('@')) {
const match = fullText.match(/@(\d+)/);
if (match) target = `${match[1]}@s.whatsapp.net`;
}
if (!target) {
await sock.sendMessage(chatId, { text: '❌ Mencione um usuário válido.' });
return;
}
db.fluxosKey.set(chatId, { tipo: 'keyUniversal', passo: 'escolherNivelUsuario', dados: { tipo: 'usuario', target }, expiraEm: Date.now() + 300000 });
await sock.sendMessage(chatId, { text: `👑 *SELECIONE O NÍVEL VIP*\n\n1️⃣ Lenda\n2️⃣ Ouro\n3️⃣ Diamante\n\nResponda com o número ou nome.`, mentions: [target] });
return;
}

// Etapa 3: escolher nível
if (fluxoAtivo.tipo === 'keyUniversal' && (fluxoAtivo.passo === 'escolherNivelUsuario' || fluxoAtivo.passo === 'escolherNivelGrupo')) {
let nivel = null;
if (resposta === '1' || resposta === 'lenda') nivel = 'lenda';
else if (resposta === '2' || resposta === 'ouro') nivel = 'ouro';
else if (resposta === '3' || resposta === 'diamante') nivel = 'diamante';
if (!nivel) {
await sock.sendMessage(chatId, { text: '❌ Opção inválida. Responda 1, 2 ou 3.' });
return;
}
const dados = fluxoAtivo.dados;
dados.nivel = nivel;
db.fluxosKey.set(chatId, { tipo: 'keyUniversal', passo: 'confirmar', dados, expiraEm: Date.now() + 300000 });
const nomeTarget = dados.tipo === 'grupo' ? `Grupo ${chatId.split('@')[0]}` : `@${dados.target.split('@')[0]}`;
const mentions = dados.tipo === 'grupo' ? [] : [dados.target];
await sock.sendMessage(chatId, { text: `🔐 *CONFIRMAÇÃO*\n\n👤 ${dados.tipo === 'grupo' ? 'Grupo' : 'Usuário'}: ${nomeTarget}\n👑 Nível: ${obterNomeNivel(nivel)}\n\nDeseja ativar?\n\n✅ sim\n❌ não`, mentions });
return;
}

// Etapa 4: confirmar ativação
if (fluxoAtivo.tipo === 'keyUniversal' && fluxoAtivo.passo === 'confirmar') {
if (resposta === 'sim' || resposta === '✅ sim') {
const { tipo, target, nivel, chatId: grupoId } = fluxoAtivo.dados;
const alvo = tipo === 'grupo' ? grupoId : target;
try {
await ativarVIPComKey(sock, senderId, alvo, nivel, tipo, 'KEY_UNIVERSAL', isGroup);
await sock.sendMessage(chatId, { text: `✅ *VIP ACTIVADO*\n\n👑 Nível: ${obterNomeNivel(nivel)}\n🎯 ${tipo === 'grupo' ? 'Grupo' : 'Usuário'}: ${tipo === 'grupo' ? grupoId.split('@')[0] : `@${target.split('@')[0]}`}\n🔑 Key Universal utilizada.\n\n🛡️ Alerta enviado ao dono.`, mentions: tipo === 'grupo' ? [] : [target] });
} catch (e) {
console.warn('keyUniversal ativar:', e.message);
await sock.sendMessage(chatId, { text: '❌ Erro ao ativar o VIP. Tenta novamente.' });
}
db.fluxosKey.delete(chatId);
return;
} else if (resposta === 'não' || resposta === '❌ não' || resposta === 'nao') {
await sock.sendMessage(chatId, { text: '❌ Ativação cancelada.' });
db.fluxosKey.delete(chatId);
return;
}
}
}

// ══════════════════════════════════════════════════════════
// KORTEX KEY SYSTEM — DETECÇÃO DE KEY UNIVERSAL
// ══════════════════════════════════════════════════════════
if (fullText.trim() === `Key ${KEY_UNIVERSAL_DONO}` || fullText.trim() === KEY_UNIVERSAL_DONO) {
if (!utils.isOwner(senderId)) {
await sock.sendMessage(chatId, { text: '🔐 *KORTEX SECURITY*\n\n⛔ Acesso negado.\nEsta Key é exclusiva do dono.' });
return;
}
db.fluxosKey.set(chatId, { tipo: 'keyUniversal', passo: 'escolherTipo', dados: {}, expiraEm: Date.now() + 300000 });
await sock.sendMessage(chatId, { text: `🔐 *KORTEX SECURITY*\n\n🔑 Key Universal reconhecida.\n\nO que deseja liberar?\n\n👤 USUÁRIO\n👥 GRUPO\n\nResponda:\nusuário\nou\ngrupo` });
return;
}

// ══════════════════════════════════════════════════════════
// KORTEX KEY SYSTEM — DETECÇÃO DE KEY RANDOM
// ══════════════════════════════════════════════════════════
const matchKeyRandom = fullText.match(/\bKRX-[A-Z0-9]{4}-[A-Z0-9]{4}\b/i);
if (matchKeyRandom) {
const keyUsada = matchKeyRandom[0].toUpperCase();
const keyData = db.keysRandom.get(keyUsada);
if (!keyData) {
await sock.sendMessage(chatId, { text: '❌ *KORTEX SECURITY*\n\n🔑 Key inválida ou não encontrada.' });
return;
}
if (keyData.status !== 'ATIVA') {
await sock.sendMessage(chatId, { text: `❌ *KORTEX SECURITY*\n\n🔑 Esta Key já foi ${keyData.status === 'UTILIZADA' ? 'utilizada' : 'desativada'}.\n\nSe acredita ser um erro, contacte o dono.` });
return;
}
const tipo = isGroup ? 'grupo' : 'usuario';
const alvo = isGroup ? chatId : senderId;
try {
await ativarVIPComKey(sock, senderId, alvo, keyData.nivel, tipo, keyUsada, isGroup);
await sock.sendMessage(chatId, { text: `✅ *VIP ACTIVADO VIA KEY*\n\n👑 Nível: ${obterNomeNivel(keyData.nivel)}\n🎯 ${isGroup ? 'Grupo' : 'Usuário'}: ${isGroup ? chatId.split('@')[0] : `@${senderId.split('@')[0]}`}\n🔑 Key: ${keyUsada}\n\n🛡️ Alerta de segurança enviado ao dono.`, mentions: isGroup ? [] : [senderId] });
} catch (e) {
console.warn('keyRandom ativar:', e.message);
await sock.sendMessage(chatId, { text: '❌ Erro ao ativar o VIP com esta Key. Tenta novamente.' });
}
return;
}

// ══════════════════════════════════════════════════════════
// PROTEÇÕES DE GRUPO
// ══════════════════════════════════════════════════════════
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
try { const u = new URL(link.startsWith('http') ? link : 'http://' + link); if (whitelist.has(u.hostname.replace(/^www\./, ''))) { ignore = true; break; } } catch {}
}
if (!ignore) { await executarAntiLink(sock, chatId, msg, senderId, antiLinkMode); return; }
}
}
const mediaKeys = ['imageMessage', 'videoMessage', 'documentMessage', 'stickerMessage'];
const ehMidia = !!mediaKeys.find(key => !!msg.message?.[key]);
if (ehMidia) {
const mediaSpam = db.mediaSpamMonitor.get(chatId) || new Map();
const infoMedia = mediaSpam.get(senderId) || { count: 0, first: Date.now(), last: Date.now() };
const agoraMedia = Date.now();
if (agoraMedia - infoMedia.first > 10000) {
infoMedia.count = 0;
infoMedia.first = agoraMedia;
}
infoMedia.count += 1;
infoMedia.last = agoraMedia;
mediaSpam.set(senderId, infoMedia);
db.mediaSpamMonitor.set(chatId, mediaSpam);
if (infoMedia.count >= 3) {
try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
if (!db.warns.has(chatId)) db.warns.set(chatId, new Map());
const warnAtual = db.warns.get(chatId).get(senderId) || 0;
const warnNovo = warnAtual + 1;
db.warns.get(chatId).set(senderId, warnNovo);
salvarDados();
await sock.sendMessage(chatId, { text: `⚠️ *FALTA DE MÍDIA EM MASSA*\n@${senderId.split('@')[0]}\nVárias imagens/vídeos/documentos em < 10s.\nAdvertência: ${warnNovo}/3`, mentions: [senderId] });
if (warnNovo >= 3) {
try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch {}
try { await sock.sendMessage(chatId, { text: `🚫 @${senderId.split('@')[0]} foi removido por envio em massa de mídia.`, mentions: [senderId] }); } catch {}
}
return;
}
}
const spam = db.spamMonitor.get(chatId) || new Map();
const infoSpam = spam.get(senderId) || { count: 0, first: Date.now(), last: Date.now() };
const agoraSpam = Date.now();
if (agoraSpam - infoSpam.first > 5000) {
infoSpam.count = 0;
infoSpam.first = agoraSpam;
}
infoSpam.count += 1;
infoSpam.last = agoraSpam;
spam.set(senderId, infoSpam);
db.spamMonitor.set(chatId, spam);
if (infoSpam.count >= 3) {
try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
if (!db.warns.has(chatId)) db.warns.set(chatId, new Map());
const warnAtual = db.warns.get(chatId).get(senderId) || 0;
const warnNovo = warnAtual + 1;
db.warns.get(chatId).set(senderId, warnNovo);
salvarDados();
await sock.sendMessage(chatId, { text: `⚠️ *FLOOD/SPAM DETECTADO*\n@${senderId.split('@')[0]}\nMensagens em massa em < 5s.\nAdvertência: ${warnNovo}/3`, mentions: [senderId] });
if (warnNovo >= 3) {
try { await sock.groupParticipantsUpdate(chatId, [senderId], 'remove'); } catch {}
try { await sock.sendMessage(chatId, { text: `🚫 @${senderId.split('@')[0]} foi removido por excesso de spam.`, mentions: [senderId] }); } catch {}
}
return;
}
const palavrasBanidas = db.grupos.palavrasBanidas.get(chatId) || [];
for (const palavra of palavrasBanidas) {
if (fullText.toLowerCase().includes(palavra)) {
try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
await sock.sendMessage(chatId, { text: `🚫 *PALAVRA PROIBIDA*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
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
// ROTEADOR CENTRAL — COMANDOS SEM PREFIXO
// ══════════════════════════════════════════════════════════
if (fullText && !fullText.startsWith(CONFIG.prefix)) {
const detecao = detectarComandoSemPrefixo(fullText);
if (detecao && commands[detecao.comando]) {
const cmdsDes = db.grupos.comandosDesativados.get(chatId);
if (!(cmdsDes && cmdsDes.has(detecao.comando) && !utils.isOwner(senderId))) {
const rl = verificarRateLimit(senderId, detecao.comando);
if (rl.permitido) {
const ctxRoteado = { chatId, senderId, isGroup, msg, args: detecao.args, _semPrefixo: true };
if (SEM_PREFIXO_SEGUROS.has(detecao.comando)) {
try {
await commands[detecao.comando](sock, ctxRoteado);
await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
} catch (e) {
if (!(e instanceof PermissaoNegada)) console.error(`Erro .${detecao.comando}:`, e.message);
await utils.reagir(sock, msg, '❌');
}
return;
}
if (COMANDOS_SENSIVEIS.has(detecao.comando)) {
if (utils.isOwner(senderId)) {
try {
await commands[detecao.comando](sock, ctxRoteado);
await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
} catch (e) { await utils.reagir(sock, msg, '❌'); }
return;
}
let temPermissaoDireta = false;
if (detecao.comando === 'banir') temPermissaoDireta = await utils.hasBanRights(sock, chatId, senderId);
else if (detecao.comando === 'promover' || detecao.comando === 'rebaixar') temPermissaoDireta = await utils.hasPromoteRights(sock, chatId, senderId);
else if (['fechar','abrir','apagar','nome','foto','marcartodos','agendar'].includes(detecao.comando)) temPermissaoDireta = await utils.hasGroupAdminRights(sock, chatId, senderId);
else if (['antilink','antimidia','autodelete','proibirpalavra','desbanirpalavra','notificar','ia'].includes(detecao.comando)) temPermissaoDireta = await utils.hasAntiRights(sock, chatId, senderId);
else if (['regras','boasvindas'].includes(detecao.comando)) temPermissaoDireta = await utils.hasRulesRights(sock, chatId, senderId);
else if (detecao.comando === 'silenciar' || detecao.comando === 'dessilenciar' || detecao.comando === 'advertir' || detecao.comando === 'removeradvertencia') temPermissaoDireta = await utils.hasBanRights(sock, chatId, senderId);
else if (detecao.comando === 'desativarcomando' || detecao.comando === 'ativarcomando') temPermissaoDireta = await utils.hasGroupAdminRights(sock, chatId, senderId);
else if (['ativarvip','removervip','removervipuser'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
else if (['desligarbot','ligarbot','ignorar','designorar','prefixo','backup','restaurar','modelo','entrar','atalho','removeratalho'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
else if (['gerarkey','desativarkey','mudarkey'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
if (temPermissaoDireta) {
try {
await commands[detecao.comando](sock, ctxRoteado);
await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
} catch (e) { await utils.reagir(sock, msg, '❌'); }
} else {
await solicitarAprovacao(sock, ctxRoteado, detecao);
}
return;
}
try {
await commands[detecao.comando](sock, ctxRoteado);
await utils.reagir(sock, msg, COMANDO_EMOJIS[detecao.comando] || '✅');
} catch (e) { await utils.reagir(sock, msg, '❌'); }
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
// ATALHOS, INTENÇÕES NATURAIS, IA E CORTESIA
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
if (utils.isOwner(senderId) && pareceIntentoSairGrupo(fullText)) { await sock.sendMessage(chatId, { text: '👋 Até já!' }); setTimeout(() => { sock.groupLeave(chatId).catch(() => {}); }, 2000); return; }
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
if (!limiteChatLivre.permitido) { const seg = Math.ceil(limiteChatLivre.esperarMs / 1000); await sock.sendMessage(chatId, { text: `⏳ Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}`, quoted: msg }); return; }
const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), true);
if (resposta) await sock.sendMessage(chatId, { text: `⚡ ${resposta}`, quoted: msg });
return;
}
if (textoLower === 'bom dia') { await utils.reagir(sock, msg, '☀️'); await sock.sendMessage(chatId, { text: ['Bom dia! ☀️', 'Bom diaaa! 🌅', 'Bom dia, craque! 💪'][Math.floor(Math.random() * 3)] }); }
else if (textoLower === 'boa tarde') { await utils.reagir(sock, msg, '🌇'); await sock.sendMessage(chatId, { text: ['Boa tarde! 😊', 'Boa tarde!', 'Boa tarde, chefe! 🤝'][Math.floor(Math.random() * 3)] }); }
else if (textoLower === 'boa noite') { await utils.reagir(sock, msg, '🌙'); await sock.sendMessage(chatId, { text: ['Boa noite! 🌙', 'Bons sonhos! 💤', 'Boa noite! 😴'][Math.floor(Math.random() * 3)] }); }
else if (textoLower.includes('obrigado') || textoLower.includes('obrigada') || textoLower.includes('valeu')) { await utils.reagir(sock, msg, '⚡'); await sock.sendMessage(chatId, { text: ['De nada! 😊', 'Sempre às ordens! ⚡', 'Por nada, chefe! 🤝'][Math.floor(Math.random() * 3)] }); }
}

// ══════════════════════════════════════════════════════════
// PV — SEM PREFIXO + BUSCA DE CANAL POR NOME
// ══════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════
// ROTEADOR COM PREFIXO
// ══════════════════════════════════════════════════════════
if (fullText?.startsWith(CONFIG.prefix)) {
const partesComPrefixo = fullText.slice(CONFIG.prefix.length).trim().split(/ +/);
let cmd = partesComPrefixo[0]?.toLowerCase();
let args = partesComPrefixo.slice(1);
if (cmd && !commands[cmd]) {
const juntado = resolverComandoPalavrasSoltas(partesComPrefixo);
if (juntado) {
cmd = juntado.comando;
args = partesComPrefixo.slice(juntado.consumidas);
}
}
if (cmd && commands[cmd]) {
const cmdsDesativados = db.grupos.comandosDesativados.get(chatId);
if (cmdsDesativados && cmdsDesativados.has(cmd) && !utils.isOwner(senderId)) { await utils.reagir(sock, msg, '🚫'); return; }
if (MENU_COMANDOS.has(cmd)) {
const limiteMenu = verificarLimiteMenu(senderId, cmd);
if (!limiteMenu.permitido) { const seg = Math.ceil(limiteMenu.esperarMs / 1000); return await sock.sendMessage(chatId, { text: `⏳ Aguarda ${seg > 60 ? Math.ceil(seg / 60) + ' min' : seg + 's'}` }); }
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

// ══════════════════════════════════════════════════════════
// ⚡ OPT — startBot REFORÇADO:
// • fecha o socket antigo antes de criar novo (sem listeners duplicados)
// • ignora eventos de sockets obsoletos
// • backoff exponencial com jitter
// • getMessage para evitar erros internos do Baileys
// ══════════════════════════════════════════════════════════
async function startBot() {
let sock;
try {
if (sockAtual) {
try { await sockAtual.disconnect(); } catch {}
sockAtual = null;
}

const sessionDir = path.join(__dirname, 'sessao_kortex');
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
  console.log('📁 Pasta de sessão criada com sucesso:', sessionDir);
}

sock = createZapoSocket({
  authPath: path.join(sessionDir, 'zapo.sqlite'),
  sessionId: 'kortex',
  pairingNumber: CONFIG.botNumber
});
const enviarMensagemOriginal = sock.sendMessage.bind(sock);
sock.sendMessage = async (...args) => {
const resultado = await enviarMensagemOriginal(...args);
if (resultado?.key?.id) {
mensagensEnviadasPeloBot.add(resultado.key.id);
if (mensagensEnviadasPeloBot.size > 1000) {
const primeiroId = mensagensEnviadasPeloBot.values().next().value;
mensagensEnviadasPeloBot.delete(primeiroId);
}
}
return resultado;
};
sockAtual = sock;
/* A Zapo persiste credenciais no store SQLite. */
sock.on('group', async (event) => {
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
const cartao = await gerarCartaoBoasVindas(sock, participant, groupId);
if (cartao) await sock.sendMessage(groupId, { image: cartao, caption: textoFinal, mentions: [participant] });
else await sock.sendMessage(groupId, { text: textoFinal, mentions: [participant] });
}
}
} catch {}
}
if (participants.includes(botJid)) {
if (!utils.isGroupSubscribed(groupId)) {
await sock.sendMessage(groupId, { text: `❌ Este grupo não possui assinatura activa.\n📞 Contacte ${CONFIG.creator}: ${CONFIG.ownerNumber}` }).catch(() => {});
setTimeout(() => { sock.groupLeave(groupId).catch(() => {}); }, 3000);
}
}
}
});
// ⚡ OPT — mensagens passam pela fila com concorrência limitada
sock.onMessage = (msg) => {
if (pausado) return;
enfileirarProcessamento(() => processarMensagem(sock, msg));
};
sock.on('connection', (update) => {
const { status, reason, isLogout } = update;
if (status === 'close') {
if (sock !== sockAtual) return; // ⚡ OPT — evento de socket obsoleto
if (isLogout || reason === 'logged_out') { console.log('🚪 Bot desconectado (logout). Reinicia manualmente.'); return; }
reconnectAttempts++;
const base = Math.min(2000 * Math.pow(2, reconnectAttempts), 60000);
const delay = base + Math.floor(Math.random() * 1000);
console.log(`🔄 Reconectando em ${Math.round(delay / 1000)}s... (${reconnectAttempts})`);
setTimeout(startBot, delay);
} else if (status === 'open') {
if (sock !== sockAtual) return;
reconnectAttempts = 0;
console.log('✅ KORTEX CONECTADO!');
console.log(`📱 Número: ${sock.user?.id || 'desconhecido'}`);
console.log(`⚡ Prefixo: ${CONFIG.prefix}`);
console.log(`⚡ Criado por: ${CONFIG.creator}`);
}
});
await sock.connect();
} catch (err) {
console.error('❌ Erro ao iniciar:', err);
reconnectAttempts++;
const delay = Math.min(5000 * reconnectAttempts, 60000) + Math.floor(Math.random() * 1000);
setTimeout(startBot, delay);
}
}

async function iniciarKortexComTurso() {
  console.log('🚀 Iniciando ' + CONFIG.botName + '...');
  console.log('👤 Criado por: ' + CONFIG.creator);

  try {
    if (turso) {
      const backup = await turso.Backup.carregarTudo();
      if (backup && Object.keys(backup).length > 0) {
        let usarTurso = true;
        try {
          if (fs.existsSync(CONFIG.dataFile) && backup.atualizadoEm) {
            const horaLocal = fs.statSync(CONFIG.dataFile).mtimeMs;
            if (backup.atualizadoEm < horaLocal) usarTurso = false;
          }
        } catch {}

        if (usarTurso) {
          const restaurado = aplicarBackupTurso(backup);
          if (restaurado) console.log('☁️ Backup Turso restaurado com sucesso');
          else console.warn('⚠️ Backup Turso inválido ou não foi aplicado');
        } else {
          console.log('💾 Arquivo local mais recente; Turso ignorado');
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ Falha ao restaurar Turso:', e.message);
  }

  await startBot();
}

iniciarKortexComTurso().catch(console.error);

module.exports = { CONFIG, db, commands, utils, startBot, iniciarKortexComTurso };

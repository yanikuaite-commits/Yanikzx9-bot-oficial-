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
axios.defaults.timeout = 60000;
const translate = require('translate-google');
const { Image: WebpImage } = require('node-webpmux');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

process.on('unhandledRejection', (err) => { console.error('⚠️ [unhandledRejection]', (err && err.message) ? String(err.message).substring(0, 200) : err); });
process.on('uncaughtException', (err) => { console.error('⚠️ [uncaughtException]', (err && err.message) ? String(err.message).substring(0, 200) : err); });

const CONFIG = {
  botName: "Kortex ⚡",
  creator: "Yanik Uaite",
  ownerId: "275381038891241",
  ownerNumber: "834788141",
  botNumber: "258850421617",
  prefix: ".",
  omdbKey: "8053b257",
  // ⚡ SISTEMA DE ENTREGA AUTOMÁTICA DE MEGAS
  megas: {
    webhookUrl: "COLE_AQUI_A_URL_DO_WEBHOOK_DO_MACRODROID", // ex: https://trigger.macrodroid.com/XXXXXXXX-XXXX-XXXX/entregar
    callbackSecret: "kortex_megas_2024" // muda isto para algo só teu
  },
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

const KEY_UNIVERSAL_DONO = "8414";

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
  // ⚡ CALLBACK DO MACRODROID — confirma entrega automática de megas
  if (req.url.startsWith('/megascallback')) {
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      const id = u.searchParams.get('id');
      const status = u.searchParams.get('status'); // 'ok' ou 'falhou'
      const secret = u.searchParams.get('secret');

      if (secret !== CONFIG.megas.callbackSecret) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
      }

      const pedido = id ? db.pedidosPagamento.get(id) : null;
      if (!pedido || pedido.tipoProduto !== 'megas') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Pedido não encontrado');
      }

      if (status === 'ok') {
        pedido.status = 'entregue';
        db.pedidosPagamento.set(id, pedido);
        salvarDados();
        if (sockAtual) {
          sockAtual.sendMessage(pedido.grupoId, { text: `✅ *MEGAS ENTREGUES*\n\n🆔 Pedido: ${id}\n📶 ${pedido.quantidadeMB}MB → ${pedido.numeroDestino}`, mentions: [pedido.cliente] }).catch(() => {});
          sockAtual.sendMessage(pedido.cliente, { text: `✅ Os teus ${pedido.quantidadeMB}MB foram enviados para ${pedido.numeroDestino}! 🎉` }).catch(() => {});
        }
      } else {
        pedido.status = 'falha_entrega';
        db.pedidosPagamento.set(id, pedido);
        salvarDados();
        if (sockAtual) {
          sockAtual.sendMessage(pedido.grupoId, { text: `⚠️ *FALHA NA ENTREGA AUTOMÁTICA*\n\n🆔 Pedido: ${id}\n📶 ${pedido.quantidadeMB}MB → ${pedido.numeroDestino}\n\nEnvia manualmente e usa: .megasenviado ${id}` }).catch(() => {});
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('OK');
    } catch (e) {
      console.warn('megascallback:', e.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Erro');
    }
  }
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
  stats: new Map(), notifications: new Map(), cache: new Map(), rateLimit: new Map(),
  keysRandom: new Map(),
  fluxosKey: new Map(),
  alertasKey: new Map(),
  // ⚡ NOVOS SISTEMAS
  modoInternet: new Map(),
  tabelasPagamento: new Map(),
  pedidosPagamento: new Map(),
  anagramas: new Map(),
  eununca: new Map(),
  verdadeDesafio: new Map()
};

const jogosVelha = new Map();
const agendamentos = new Map();
const cacheMetadata = new Map();
const cacheDonoLid = new Set();
const desafiosVelha = new Map();
const TEMPO_EXPIRACAO_DESAFIO = 60000;
const solicitacoesPendentes = new Map();
let solicitacaoIdCounter = 1;
const TEMPO_EXPIRACAO_APROVACAO = 60000;

// ⚡ FILA DE PROCESSAMENTO — processa mensagens em sequência, sem travar em erro
let filaProcessamento = Promise.resolve();
function enfileirarProcessamento(fn) {
  filaProcessamento = filaProcessamento
    .then(() => fn())
    .catch(e => console.warn('⚠️ Erro no processamento da fila:', e?.message || e));
}

// ⚡ ANTI-FLOOD — 5 mensagens em 5 segundos = advertência automática
const floodTracker = new Map(); // key: `${chatId}:${senderId}` → array de timestamps
const FLOOD_LIMITE_MSGS = 5;
const FLOOD_JANELA_MS = 5000;

setInterval(() => {
  const agora = Date.now();
  for (const [id, sol] of solicitacoesPendentes) if (agora > sol.expiraEm) solicitacoesPendentes.delete(id);
  for (const [id, des] of desafiosVelha) if (agora > des.expiraEm) desafiosVelha.delete(id);
  for (const [chatId, g] of jogosVelha) if (agora - (g.ts || 0) > 10 * 60000) jogosVelha.delete(chatId);
  for (const [chatId, fluxo] of db.fluxosKey) if (agora > fluxo.expiraEm) db.fluxosKey.delete(chatId);
  for (const [id, alerta] of db.alertasKey) if (agora > alerta.expiraEm) db.alertasKey.delete(id);
  // ⚡ LIMPEZA DE NOVOS JOGOS
  for (const [chatId, jogo] of db.anagramas) if (agora - (jogo.criadoEm || 0) > 10 * 60000) db.anagramas.delete(chatId);
  for (const [chatId, jogo] of db.eununca) if (agora - (jogo.criadoEm || 0) > 10 * 60000) db.eununca.delete(chatId);
  for (const [chatId, jogo] of db.verdadeDesafio) if (agora - (jogo.criadoEm || 0) > 30 * 60000) db.verdadeDesafio.delete(chatId);
  // ⚡ LIMPEZA DO ANTI-FLOOD (entradas paradas há mais de 1 minuto)
  for (const [key, timestamps] of floodTracker) {
    if (!timestamps.length || agora - timestamps[timestamps.length - 1] > 60000) floodTracker.delete(key);
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

function extrairVideoId(link) { const m = link.match(/(?:youtu.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : null; }

// ══════════════════════════════════════════════════════════
// ⚡ NOVOS SISTEMAS — FUNÇÕES AUXILIARES
// ══════════════════════════════════════════════════════════

// DETECÇÃO DE PAGAMENTO
function detectarPagamento(texto, tabelas) {
  if (!texto || !tabelas?.length) return null;
  const lower = texto.toLowerCase();
  const palavrasChave = ['transferência', 'transferencia', 'pagamento', 'comprovativo', 'comprovante', 'enviei', 'paguei', 'depósito', 'deposito', 'mpesa', 'emola'];
  if (!palavrasChave.some(p => lower.includes(p))) return null;
  
  const valorMatch = texto.match(/(\d+[.,]?\d*)\s*(mt|mtn|meticais|mzn)?/i);
  const valor = valorMatch ? parseFloat(valorMatch[1].replace(',', '.')) : null;
  
  const refMatch = texto.match(/(?:refer[eê]ncia|ref|c[oó]digo)[:\s]*([a-z0-9-]+)/i);
  const referencia = refMatch ? refMatch[1] : null;
  
  const pedidoMatch = texto.match(/(?:pedido|n[º°o]\s*|order)[:\s]*#?(\d+)/i);
  const pedido = pedidoMatch ? pedidoMatch[1] : null;
  
  const linhas = texto.trim().split('\n').map(l => l.trim()).filter(Boolean);
  let numeroRecebimento = null;
  for (let i = linhas.length - 1; i >= Math.max(0, linhas.length - 3); i--) {
    const numMatch = linhas[i].match(/^(\d{8,9})$/);
    if (numMatch) { numeroRecebimento = numMatch[1]; break; }
  }
  
  let metodo = null;
  for (const t of tabelas) {
    if (lower.includes(t.nome.toLowerCase()) || lower.includes(t.metodo.toLowerCase())) {
      metodo = t;
      break;
    }
  }
  
  if (!valor && !referencia && !pedido) return null;
  
  return { valor, referencia, pedido, numeroRecebimento, metodo };
}

async function notificarADMsPagamento(sock, groupId, pedido) {
  try {
    const meta = await getMetadataCached(sock, groupId);
    const admins = meta.participants.filter(p => p.admin).map(p => p.id);
    const clienteNome = pedido.cliente.split('@')[0];
    const texto = `╔══════════════════════╗
║   🧾 NOVO PAGAMENTO  ║
╠══════════════════════╣
║ 👤 Cliente: @${clienteNome}
║ 💰 Valor: ${pedido.valor ? pedido.valor + ' MT' : 'Não informado'}
║ 🔖 Referência: ${pedido.referencia || 'Não informado'}
║ 🧾 Pedido: ${pedido.pedido ? '#' + pedido.pedido : 'Não informado'}
║ 📱 Recebimento: ${pedido.numeroRecebimento || 'Não informado'}
║ 💳 Método: ${pedido.metodo ? pedido.metodo.nome : 'Não identificado'}
${pedido.tipoProduto === 'megas' ? `║ 📶 Produto: ${pedido.quantidadeMB}MB → ${pedido.numeroDestino}\n` : ''}╠══════════════════════╣
║ ⏳ AGUARDANDO ANÁLISE ║
╚══════════════════════╝

✅ Confirmar: .pagamento recebido ${pedido.id}
❌ Rejeitar: .pagamento recusado ${pedido.id}`;
    
    await sock.sendMessage(groupId, { text: texto, mentions: [pedido.cliente, ...admins] });
    pedido.notificado = true;
    db.pedidosPagamento.set(pedido.id, pedido);
    salvarDados();
  } catch (e) { console.warn('notificarADMsPagamento:', e.message); }
}

// ⚡ ENVIO AUTOMÁTICO DE MEGAS — dispara o webhook do MacroDroid
async function enviarPedidoMegas(sock, groupId, pedido) {
  if (!CONFIG.megas.webhookUrl || CONFIG.megas.webhookUrl.startsWith('COLE_AQUI')) {
    await sock.sendMessage(groupId, { text: `⚠️ Webhook do MacroDroid não configurado.\n\nEnvia manualmente: ${pedido.quantidadeMB}MB → ${pedido.numeroDestino}\nDepois usa: .megasenviado ${pedido.id}` });
    return;
  }
  try {
    pedido.status = 'entregando';
    db.pedidosPagamento.set(pedido.id, pedido);
    salvarDados();
    await axios.get(CONFIG.megas.webhookUrl, {
      params: { id: pedido.id, mb: pedido.quantidadeMB, numero: pedido.numeroDestino, secret: CONFIG.megas.callbackSecret },
      timeout: 15000
    });
    await sock.sendMessage(groupId, { text: `🔄 *ENTREGA AUTOMÁTICA INICIADA*\n\n🆔 Pedido: #${pedido.id}\n📶 ${pedido.quantidadeMB}MB → ${pedido.numeroDestino}\n\nAguarda confirmação... ⚡` });
  } catch (e) {
    console.warn('enviarPedidoMegas:', e.message);
    await sock.sendMessage(groupId, { text: `⚠️ Falha ao contactar o sistema de entrega.\n\nEnvia manualmente: ${pedido.quantidadeMB}MB → ${pedido.numeroDestino}\nDepois usa: .megasenviado ${pedido.id}` });
  }
}

// ⚡ Sistema de advertências reutilizável (usado por .advertir e pelo anti-flood)
async function aplicarAdvertencia(sock, chatId, target, motivo = 'Motivo não especificado') {
  if (!db.warns.has(chatId)) db.warns.set(chatId, new Map());
  const w = db.warns.get(chatId);
  const n = (w.get(target) || 0) + 1;
  w.set(target, n); salvarDados();
  if (n >= 3) {
    w.delete(target); salvarDados();
    try {
      await sock.groupParticipantsUpdate(chatId, [target], 'remove');
      await sock.sendMessage(chatId, { text: `🔨 @${target.split('@')[0]} atingiu 3 advertências (${motivo}) e foi removido.`, mentions: [target] });
    } catch (e) {
      console.warn('⚠️ Falha ao remover após 3 advertências:', e.message);
      await sock.sendMessage(chatId, { text: `⚠️ 3 advertências (${motivo})! Não consegui remover @${target.split('@')[0]}.`, mentions: [target] });
    }
    return n;
  }
  await sock.sendMessage(chatId, { text: `⚠️ *ADVERTÊNCIA ${n}/3*\n@${target.split('@')[0]}\n📋 Motivo: ${motivo}`, mentions: [target] });
  return n;
}

// JOGO: ANAGRAMA
const PALAVRAS_ANAGRAMA = [
  'computador', 'telefone', 'internet', 'programa', 'sistema',
  'mocambique', 'maputo', 'familia', 'amizade', 'felicidade',
  'conhecimento', 'educacao', 'trabalho', 'desenvolvimento',
  'tecnologia', 'comunicacao', 'informacao', 'diversao'
];

function embaralharPalavra(palavra) {
  const arr = palavra.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

// JOGO: VERDADE OU DESAFIO (+18)
async function gerarVerdadeOuDesafio(tipo, genero) {
  const generoTxt = genero === 'masculino' ? 'homem' : genero === 'feminino' ? 'mulher' : 'pessoa';
  const prompt = tipo === 'verdade'
    ? `Gera uma pergunta de "verdade" picante (+18) para um jogo de verdade ou desafio. A pergunta deve ser para um ${generoTxt}. Responde APENAS com a pergunta, sem explicações. Máximo 2 frases.`
    : `Gera um desafio picante (+18) para um jogo de verdade ou desafio. O desafio deve ser para um ${generoTxt}. Pode incluir mandar foto/mensagem para outro jogador. Responde APENAS com o desafio, sem explicações. Máximo 2 frases.`;
  
  const resposta = await perguntarGroq(prompt);
  return resposta || (tipo === 'verdade' ? 'Qual foi a coisa mais vergonhosa que já fizeste?' : 'Manda uma mensagem romântica para a pessoa à tua direita.');
}

// ══════════════════════════════════════════════════════════
// BUSCA DE CANAL POR NOME (PV)
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
  } catch (e) { console.warn('pesquisarCanalPorNome:', e.message); return null; }
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

// ⚡ OPT — ffmpeg com timeout (sticker animado)
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

// ⚡ NOVO (MODO B) — normaliza vídeo p/ H.264+AAC+faststart (WhatsApp oficial)
async function normalizarVideoParaWhatsApp(buffer) {
  const tmpIn = path.join(os.tmpdir(), `kortex_nv_in_${Date.now()}.bin`);
  const tmpOut = path.join(os.tmpdir(), `kortex_nv_out_${Date.now()}.mp4`);
  fs.writeFileSync(tmpIn, buffer);
  try {
    await new Promise((resolve, reject) => {
      const cmd = ffmpeg(tmpIn).outputOptions([
        '-c:v libx264', '-preset veryfast', '-crf 28',
        '-vf scale=-2:480', '-c:a aac', '-b:a 96k',
        '-pix_fmt yuv420p', '-movflags +faststart'
      ]).save(tmpOut);
      const to = setTimeout(() => { try { cmd.kill('SIGKILL'); } catch {} reject(new Error('ffmpeg timeout')); }, 180000);
      cmd.on('end', () => { clearTimeout(to); resolve(); }).on('error', (e) => { clearTimeout(to); reject(e); });
    });
    const out = fs.readFileSync(tmpOut);
    return (out && out.length > 0 && out.length <= 64 * 1024 * 1024) ? out : buffer;
  } catch (e) {
    console.warn('normalizarVideo:', e.message);
    return buffer;
  } finally { try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {} }
}

// ⚡ FIX — regex válida do .calcular
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

const RATE_LIMIT_MAX = 4, RATE_LIMIT_JANELA_MS = 180000, RATE_LIMIT_EXCLUIR = new Set(['apagar', 'info', 'jogodavelha', 'aceitardesafio', 'recusardesafio']);
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

const SEM_PREFIXO_SEGUROS = new Set(['menu','menubtn','ajuda','comandos','cgeral','cutil','ctexto','cinfo','cdiv','cimg','cmidia','cstick','cadmin','cprot','cdono','guiamidia','info','ping','hora','calcular','moeda','senha','pin','aleatorio','idade','tabuada','porcentagem','contar','sortear','caraoucoroa','romanos','significado','sinonimo','antonimo','leet','vaporwave','gerarnome','wiki','pais','capital','hoje','noticias','filme','serie','manga','personagem','musica','dolar','euro','ouro','futebol','tabela','charada','frase','traduzir','ranking','pontos','jogodavelha','transcrever','aprovar','recusar','anagrama','eununca']);
const COMANDOS_SENSIVEIS = new Set([
  'banir','promover','rebaixar','fechar','abrir','apagar',
  'antilink','proibirpalavra','desbanirpalavra','regras','boasvindas',
  'ativarvip','removervip','desativarcomando','ativarcomando',
  'ignorar','designorar','desligarbot','ligarbot',
  'nome','foto','criargrupo','silenciar','dessilenciar',
  'advertir','removeradvertencia','antimidia','autodelete',
  'notificar','ia','entrar','atalho','removeratalho',
  'prefixo','backup','restaurar','modelo','marcartodos','agendar',
  'gerarkey','desativarkey','mudarkey',
  'modointernet','tabpag','pagamento','megasenviado'
]);

const COMANDO_EMOJIS = {
  menu: '📜', menubtn: '📜', ajuda: '📜', cgeral: '🌐', cadmin: '👮', cprot: '🛡️', cmidia: '📲', cstick: '🖼️', cdono: '👑',
  cutil: '🧰', ctexto: '🔤', cinfo: '🌍', cdiv: '😄', cimg: '🖼️',
  ping: '🏓', hora: '🕒', info: '⚡', planos: '💰', statusgrupo: '💎', comandos: '📋', ranking: '🏆', pontos: '🔢', indicar: '📨',
  banir: '🔨', promover: '⬆️', rebaixar: '⬇️', marcartodos: '📢', historico: '📜', fechar: '🔒', abrir: '🔓', link: '🔗', idgrupo: '🆔', apagar: '🗑️',
  antilink: '🔗', proibirpalavra: '📵', desbanirpalavra: '✅', regras: '📜', ia: '🧠', autodelete: '🤖', verregras: '📃', listarpalavras: '📃', boasvindas: '👋',
  figurinha: '🎨', stickertexto: '✏️', infosticker: 'ℹ️', modelo: '🖼️', traduzir: '🌍', recibo: '🧾',
  ativarvip: '💎', removervip: '🚫', listargrupos: '📋', avisartodos: '📣', atalho: '⚡', removeratalho: '🗑️', listaratalhos: '⚡',
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
  gerarkey: '🔑', desativarkey: '🚫', mudarkey: '🔐',
  // ⚡ NOVOS COMANDOS
  modointernet: '🌐', tabpag: '💳', pagamento: '💰', anagrama: '🔤', eununca: '🎭', vd: '🎲', meunome: '👤', megas: '📶', megasenviado: '✅'
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
// ⚡ OPT — SAVE DEBOUNCED + flush no exit
// ══════════════════════════════════════════════════════════
function escreverDados() {
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
      agendamentos: Object.fromEntries(agendamentos),
      keysRandom: Object.fromEntries(db.keysRandom),
      // ⚡ NOVOS SISTEMAS
      modoInternet: Object.fromEntries(db.modoInternet),
      tabelasPagamento: Object.fromEntries(db.tabelasPagamento),
      pedidosPagamento: Object.fromEntries(db.pedidosPagamento)
    };
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), 'utf8');
    fs.writeFileSync(CONFIG.historicoFile, JSON.stringify(Object.fromEntries(db.historicoGrupos), null, 2), 'utf8');
    if (global.gc) { try { global.gc(); } catch {} }
  } catch (e) { console.error('Erro ao guardar dados:', e.message); }
}

let _saveTimer = null;
function salvarDados() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; escreverDados(); }, 1500);
  if (_saveTimer.unref) _saveTimer.unref();
}

process.on('exit', () => { try { escreverDados(); } catch {} });
process.on('SIGINT', () => { try { escreverDados(); } catch {} process.exit(0); });
process.on('SIGTERM', () => { try { escreverDados(); } catch {} process.exit(0); });

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
      if (data.keysRandom) for (const [k, v] of Object.entries(data.keysRandom)) db.keysRandom.set(k, v);
      // ⚡ NOVOS SISTEMAS
      if (data.modoInternet) for (const [k, v] of Object.entries(data.modoInternet)) db.modoInternet.set(k, v);
      if (data.tabelasPagamento) for (const [k, v] of Object.entries(data.tabelasPagamento)) db.tabelasPagamento.set(k, v);
      if (data.pedidosPagamento) for (const [k, v] of Object.entries(data.pedidosPagamento)) db.pedidosPagamento.set(k, v);
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
      const c = await comFallbackGroq(client => client.chat.completions.create({ messages: [{ role: 'user', content: prompt }], model: modelo, temperature: 0.5, max_tokens: 120 }));
      return c.choices[0]?.message?.content?.trim();
    } catch {}
  }
  return null;
}

// ⚡ CHAT DA IA (menção/modo livre) — usa comFallbackGroq (rotação real de chaves) + histórico por chat
const HISTORICO_IA_MAX = 8; // mensagens guardadas (user+assistant) por conversa

async function askGroq(chatId, texto, isOwner, mencionado) {
  try {
    if (!db.historicoIA.has(chatId)) db.historicoIA.set(chatId, []);
    const historico = db.historicoIA.get(chatId);

    const systemPrompt = `Tu és o Kortex, um assistente de WhatsApp moçambicano. Responde sempre em português de Moçambique, de forma curta, natural e directa (máx. 2-3 frases), como numa conversa de WhatsApp — nunca uses formatação markdown.${isOwner ? ' A pessoa a falar contigo é o teu dono/criador — trata-a com familiaridade e respeito especial.' : ''}${mencionado ? ' A pessoa mencionou-te ou chamou-te diretamente — responde de forma direta ao que foi pedido.' : ' Estás numa conversa livre de grupo — participa de forma natural, como mais um membro do grupo.'}`;

    historico.push({ role: 'user', content: texto });
    if (historico.length > HISTORICO_IA_MAX) historico.splice(0, historico.length - HISTORICO_IA_MAX);

    const mensagens = [{ role: 'system', content: systemPrompt }, ...historico];
    const modelos = [CONFIG.groq_model, ...GROQ_MODELOS_FALLBACK].filter((m, i, a) => m && a.indexOf(m) === i);

    let respostaTexto = null;
    for (const modelo of modelos) {
      try {
        const c = await comFallbackGroq(client => client.chat.completions.create({ messages: mensagens, model: modelo, temperature: 0.7, max_tokens: 300 }));
        respostaTexto = c.choices?.[0]?.message?.content?.trim();
        if (respostaTexto) break;
      } catch (e) {
        console.warn(`⚠️ Modelo ${modelo} falhou em askGroq:`, e.message);
      }
    }

    if (!respostaTexto) return null;

    historico.push({ role: 'assistant', content: respostaTexto });
    if (historico.length > HISTORICO_IA_MAX) historico.splice(0, historico.length - HISTORICO_IA_MAX);
    db.historicoIA.set(chatId, historico);
    db.historicoIAUltimoUso.set(chatId, Date.now());

    return respostaTexto;
  } catch (e) {
    console.warn('⚠️ askGroq falhou completamente:', e.message);
    return null;
  }
}
// ══════════════════════════════════════════════════════════
// COMANDOS (interface 100% preservada + NOVOS)
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
      pSticker: isOwner || !!vip?.sticker
    };
  },
  'menubtn': async (sock, ctx) => { await commands['menu'](sock, ctx); },
  'menu': async (sock, ctx) => {
    const nomeCategoria = ctx.args?.[0];
    if (nomeCategoria) {
      const alvo = MAPA_MENU_CATEGORIAS[normalizarTexto(nomeCategoria)];
      if (alvo && commands[alvo]) return await commands[alvo](sock, { ...ctx, args: ctx.args.slice(1) });
    }
    const p = await commands._getPerms(sock, ctx);
    const linhas = [];
    linhas.push(`║ 🌐 GERAL\n║ 🧰 UTILITÁRIOS\n║ 🔤 TEXTO\n║ 🌍 INFORMAÇÃO\n║ 😄 DIVERSÃO\n║ 🖼️ IMAGEM\n║ 📲 MÍDIA`);
    if (p.pAdmin || p.pBan || p.pPromote) linhas.push(`║ 🛡️ PROTEÇÃO\n║ 👮 ADMINISTRAÇÃO`);
    if (p.pSticker) linhas.push(`║ 🎨 STICKERS`);
    if (p.isOwner) linhas.push(`║ 👑 DONO`);
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO PRINCIPAL', conteudo: linhas.join('\n'), imagemChave: 'principal', rodape: `⚡ KORTEX CORE\n║ Prefixo: ${CONFIG.prefix}` });
  },
  'ajuda': async (sock, ctx) => { await commands['menu'](sock, ctx); },
  'cgeral': async (sock, ctx) => {
    const conteudo = `║ 🌐 MÓDULO GERAL\n║ 📌 BÁSICO\n║ .menu → categorias\n║ .ajuda → categorias\n║ .info → estado do bot\n║ .ping → velocidade\n║ .hora → hora de Maputo\n║ .meuid → IDs do sistema\n\n║ 💎 ASSINATURA\n║ .planos → ver planos\n║ .statusgrupo → estado\n\n║ INDICAÇÕES\n║ .indicar [nº] → +1 ponto\n║ .ranking → top 10\n║ .pontos → meus pontos\n\n║ 🌍 UTILITÁRIOS\n║ .traduzir [texto] → traduz`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO GERAL', conteudo, imagemChave: 'geral' });
  },
  'cutil': async (sock, ctx) => {
    const conteudo = `║ 🧰 MÓDULO UTILITÁRIOS\n\n║ 🧮 CÁLCULOS\n║ .calcular [expr] → resolve conta\n║ .porcentagem [v] [%] → calcula %\n║ .tabuada [n] → tabuada do n\n\n║ 🎲 GERADORES\n║ .senha [tamanho] → senha segura\n║ .pin [tamanho] → PIN numérico\n║ .aleatorio [min] [max] → nº aleatório\n║ .caraoucoroa → cara ou coroa\n║ .sortear [a|b|c] → sorteia opção\n\n║ 📏 CONVERSÕES\n║ .moeda [v] [de] [para] → converte moeda\n║ .idade [dd/mm/aaaa] → calcula idade\n║ .contar [texto] → letras/palavras\n\n║ 🎙️ ÁUDIO\n║ .transcrever (responde) → transcreve áudio`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO UTILITÁRIOS', conteudo, imagemChave: 'utilitarios' });
  },
  'calcular': async (sock, ctx) => {
    const expr = ctx.args.join(' ');
    if (!expr) return sock.sendMessage(ctx.chatId, { text: 'Uso: .calcular [expressão]\nEx: .calcular 12+8*4' });
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
      await new Promise((res, rej) => {
        const cmd = ffmpeg(tmpIn).toFormat('mp3').save(tmpOut);
        const to = setTimeout(() => { try { cmd.kill('SIGKILL'); } catch {} rej(new Error('ffmpeg timeout')); }, 120000);
        cmd.on('end', () => { clearTimeout(to); res(); }).on('error', (e) => { clearTimeout(to); rej(e); });
      });
      const r = await comFallbackGroq(client => client.audio.transcriptions.create({ file: fs.createReadStream(tmpOut), model: 'whisper-large-v3' }));
      try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {}
      await sock.sendMessage(ctx.chatId, { text: `🎙️ *Transcrição:*\n\n"${r.text || '…'}"` });
    } catch (e) { console.warn('transcrever:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui transcrever este áudio.' }); }
  },
  'ctexto': async (sock, ctx) => {
    const conteudo = `║ 🔤 MÓDULO TEXTO\n\n║ 🔤 .romanos [número] → nº em romanos\n║ 📖 .significado [palavra] → definição\n║ 📖 .sinonimo [palavra] → sinónimos\n║ 📖 .antonimo [palavra] → antónimos\n║ 👾 .leet [texto] → estilo leet\n║ 🌸 .vaporwave [texto] → estilo vaporwave\n║ ✍️ .gerarnome → nome aleatório`;
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
    const conteudo = `║ 🌍 MÓDULO INFORMAÇÃO\n\n║ 📚 .wiki [tema] → Wikipédia\n║ 🗺️ .pais [país] → dados do país\n║ 🏛️ .capital [país] → capital\n║ 📅 .hoje → efeméride do dia\n║ 📰 .noticias [tema] → notícias\n║ 🎬 .filme [título] → info do filme\n║ 📺 .serie [título] → info da série\n║ 📖 .manga [título] → info do mangá\n║ 🎭 .personagem [nome] → info\n║ 🎵 .musica [nome] → info da música\n\n║ 💰 COTAÇÕES\n║ .dolar / .euro / .ouro → cotação\n║ .moeda [v] [de] [para] → converte\n\n║ ⚽ FUTEBOL\n║ .futebol [equipa] → últimos jogos\n║ .tabela [campeonato] → classificação`;
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
  // ⚡ ORIGINAL — TABELA DE FUTEBOL (preservado)
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
    const conteudo = `║ 😄 MÓDULO DIVERSÃO\n\n║ 🧩 .charada → adivinha\n║ 💬 .frase → frase motivacional\n║ ⭕ .jogodavelha @user → desafia alguém\n║ .jogodavelha [1-9] → faz jogada\n║ .jogodavelha off → cancela jogo\n\n║ 🔤 .anagrama → jogo de palavras\n║ 🎭 .eununca [pergunta] → sondagem\n║ 🎲 .vd iniciar [n] → verdade ou desafio\n\n║ 💳 PAGAMENTOS\n║ .tabpag add/remove/list → tabelas\n║ .pagamento recebido/recusado [id]\n║ .megas [MB] [número] → pede megas\n║ .megasenviado [id] → confirma manual\n\n║ 🌐 MODO INTERNET\n║ .modointernet on/off (VIP Diamante+)`;
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
      if (!alvo) return sock.sendMessage(ctx.chatId, { text: '⭕ JOGO DA VELHA\n\nUso:\n.jogodavelha @user → desafiar\n.jogodavelha [1-9] → jogada\n.jogodavelha off → cancelar' });
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
  // ══════════════════════════════════════════════════════════
  // ⚡ NOVOS JOGOS
  // ══════════════════════════════════════════════════════════
  'anagrama': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Joga num grupo.' });
    
    const existente = db.anagramas.get(ctx.chatId);
    if (existente && Date.now() - existente.criadoEm < 120000) {
      return sock.sendMessage(ctx.chatId, { text: `🔤 Já existe um anagrama activo!\n\nPalavra embaralhada: *${existente.embaralhada}*\n\nResponde com a palavra correcta.` });
    }
    
    const palavra = PALAVRAS_ANAGRAMA[Math.floor(Math.random() * PALAVRAS_ANAGRAMA.length)];
    const embaralhada = embaralharPalavra(palavra);
    
    db.anagramas.set(ctx.chatId, {
      palavra,
      embaralhada,
      criadoEm: Date.now(),
      acertou: null
    });
    
    await sock.sendMessage(ctx.chatId, { text: `🔤 *ANAGRAMA*\n\nPalavra embaralhada: *${embaralhada}*\n\n🎯 Quem acertar primeiro ganha 1 ponto!\n\n⏳ Tens 2 minutos para responder.` });
    
    setTimeout(() => {
      const jogo = db.anagramas.get(ctx.chatId);
      if (jogo && !jogo.acertou) {
        db.anagramas.delete(ctx.chatId);
        sock.sendMessage(ctx.chatId, { text: `⏳ Tempo esgotado!\n\nA resposta era: *${palavra}*` }).catch(() => {});
      }
    }, 120000);
  },
  'eununca': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Joga num grupo.' });
    
    const pergunta = ctx.args.join(' ');
    if (!pergunta) return sock.sendMessage(ctx.chatId, { text: 'Uso: .eununca [pergunta]\nEx: .eununca Já beijaste alguém no grupo?' });
    
    const existente = db.eununca.get(ctx.chatId);
    if (existente && Date.now() - existente.criadoEm < 300000) {
      return sock.sendMessage(ctx.chatId, { text: `⚠️ Já existe uma sondagem activa!\n\n${existente.pergunta}\n\nVota: .eununca sim ou .eununca nao` });
    }
    
    db.eununca.set(ctx.chatId, {
      pergunta,
      votos: new Map(),
      criadoEm: Date.now()
    });
    
    await sock.sendMessage(ctx.chatId, { text: `🎭 *EU NUNCA...*\n\n${pergunta}\n\n✅ Já fiz: .eununca sim\n❌ Nunca fiz: .eununca nao\n\n⏳ Votações abertas por 5 minutos.` });
    
    setTimeout(() => {
      const jogo = db.eununca.get(ctx.chatId);
      if (jogo) {
        const sim = [...jogo.votos.values()].filter(v => v).length;
        const nao = [...jogo.votos.values()].filter(v => !v).length;
        const total = sim + nao;
        db.eununca.delete(ctx.chatId);
        sock.sendMessage(ctx.chatId, { text: `📊 *RESULTADO*\n\n${jogo.pergunta}\n\n✅ Já fiz: ${sim} (${total ? Math.round(sim/total*100) : 0}%)\n❌ Nunca fiz: ${nao} (${total ? Math.round(nao/total*100) : 0}%)\n\n👥 Total: ${total} votos` }).catch(() => {});
      }
    }, 300000);
  },
  'vd': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Joga num grupo.' });
    
    const subcmd = ctx.args[0]?.toLowerCase();
    const jogo = db.verdadeDesafio.get(ctx.chatId);
    
    if (subcmd === 'iniciar') {
      if (jogo && jogo.estado !== 'configurando') {
        return sock.sendMessage(ctx.chatId, { text: '⚠️ Já existe um jogo em andamento.' });
      }
      if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId)) && !utils.isOwner(ctx.senderId)) {
        return sock.sendMessage(ctx.chatId, { text: '❌ Apenas ADMs podem iniciar.' });
      }
      
      const total = parseInt(ctx.args[1]);
      if (!total || total < 2) return sock.sendMessage(ctx.chatId, { text: 'Uso: .vd iniciar [número de jogadores]\nMínimo: 2 jogadores' });
      
      db.verdadeDesafio.set(ctx.chatId, {
        estado: 'entrando',
        totalJogadores: total,
        jogadores: [],
        vezAtual: 0,
        historico: [],
        criadoEm: Date.now()
      });
      
      return sock.sendMessage(ctx.chatId, { text: `🎭 *VERDADE OU DESAFIO*\n\n👥 Total de jogadores: ${total}\n\nPara entrar, envia:\n.meunome [nome] [masculino/feminino]\n\nEx: .meunome João masculino\n\n⏳ Esperando jogadores...` });
    }
    
    if (subcmd === 'iniciarjogo') {
      if (!jogo || jogo.estado !== 'pronto') {
        return sock.sendMessage(ctx.chatId, { text: '❌ Jogo não está pronto. Espera todos entrarem.' });
      }
      if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId)) && !utils.isOwner(ctx.senderId)) {
        return sock.sendMessage(ctx.chatId, { text: '❌ Apenas ADMs podem iniciar o jogo.' });
      }
      
      jogo.estado = 'jogando';
      jogo.vezAtual = 0;
      db.verdadeDesafio.set(ctx.chatId, jogo);
      
      const jogador = jogo.jogadores[0];
      return sock.sendMessage(ctx.chatId, { text: `🎭 *JOGO INICIADO!*\n\n👤 Vez de @${jogador.id.split('@')[0]} (${jogador.nome})\n\nEscolhe:\n1️⃣ Verdade\n2️⃣ Desafio\n\nResponde: .vd verdade ou .vd desafio`, mentions: [jogador.id] });
    }
    
    if (subcmd === 'verdade' || subcmd === 'desafio') {
      if (!jogo || jogo.estado !== 'jogando') {
        return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum jogo em andamento.' });
      }
      
      const jogadorAtual = jogo.jogadores[jogo.vezAtual];
      if (jogadorAtual.id !== ctx.senderId) {
        return sock.sendMessage(ctx.chatId, { text: `❌ Não é a tua vez! Vez de @${jogadorAtual.id.split('@')[0]}`, mentions: [jogadorAtual.id] });
      }
      
      const tipo = subcmd;
      const pergunta = await gerarVerdadeOuDesafio(tipo, jogadorAtual.genero);
      
      jogo.historico.push({ jogador: jogadorAtual.nome, tipo, pergunta });
      db.verdadeDesafio.set(ctx.chatId, jogo);
      
      const emoji = tipo === 'verdade' ? '❓' : '🔥';
      const titulo = tipo === 'verdade' ? 'VERDADE' : 'DESAFIO';
      
      await sock.sendMessage(ctx.chatId, { text: `${emoji} *@${jogadorAtual.id.split('@')[0]} escolheu ${titulo}*\n\n${pergunta}\n\n⏭️ Quando terminares, o próximo jogador usa .vd verdade/desafio`, mentions: [jogadorAtual.id] });
      
      jogo.vezAtual++;
      if (jogo.vezAtual >= jogo.jogadores.length) {
        jogo.estado = 'finalizado';
        db.verdadeDesafio.set(ctx.chatId, jogo);
        
        let texto = '🎭 *JOGO FINALIZADO!*\n\n📋 Histórico:\n\n';
        jogo.historico.forEach((h, i) => {
          texto += `${i+1}. ${h.jogador} — ${h.tipo.toUpperCase()}\n   ${h.pergunta.substring(0, 60)}...\n\n`;
        });
        
        return sock.sendMessage(ctx.chatId, { text: texto });
      } else {
        const proximo = jogo.jogadores[jogo.vezAtual];
        db.verdadeDesafio.set(ctx.chatId, jogo);
        await sock.sendMessage(ctx.chatId, { text: `🎭 *VEZ DE @${proximo.id.split('@')[0]}* (${proximo.nome})\n\nEscolhe:\n1️⃣ Verdade\n2️⃣ Desafio`, mentions: [proximo.id] });
      }
      return;
    }
    
    if (subcmd === 'parar') {
      if (!jogo) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum jogo activo.' });
      if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId)) && !utils.isOwner(ctx.senderId)) {
        return sock.sendMessage(ctx.chatId, { text: '❌ Apenas ADMs podem parar.' });
      }
      db.verdadeDesafio.delete(ctx.chatId);
      return sock.sendMessage(ctx.chatId, { text: '🛑 Jogo parado.' });
    }
    
    if (subcmd === 'jogadores') {
      if (!jogo) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum jogo activo.' });
      let texto = '👥 *JOGADORES*\n\n';
      jogo.jogadores.forEach((j, i) => {
        texto += `${i+1}. @${j.id.split('@')[0]} — ${j.nome} (${j.genero})\n`;
      });
      return sock.sendMessage(ctx.chatId, { text: texto, mentions: jogo.jogadores.map(j => j.id) });
    }
    
    await sock.sendMessage(ctx.chatId, { text: '🎭 *VERDADE OU DESAFIO*\n\n.vd iniciar [número] — Configurar jogo\n.meunome [nome] [genero] — Entrar\n.vd iniciarjogo — Começar\n.vd verdade/desafio — Escolher\n.vd jogadores — Ver jogadores\n.vd parar — Parar jogo' });
  },
  'meunome': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa num grupo.' });
    
    const jogo = db.verdadeDesafio.get(ctx.chatId);
    if (!jogo || jogo.estado !== 'entrando') {
      return sock.sendMessage(ctx.chatId, { text: '❌ Nenhuma configuração activa. Usa .vd iniciar [número]' });
    }
    
    const nome = ctx.args[0];
    const genero = ctx.args[1]?.toLowerCase();
    if (!nome || !['masculino', 'feminino', 'm', 'f'].includes(genero)) {
      return sock.sendMessage(ctx.chatId, { text: 'Uso: .meunome [nome] [masculino/feminino]\nEx: .meunome João masculino' });
    }
    
    if (jogo.jogadores.find(j => j.id === ctx.senderId)) {
      return sock.sendMessage(ctx.chatId, { text: '⚠️ Já estás no jogo!' });
    }
    
    jogo.jogadores.push({
      id: ctx.senderId,
      nome,
      genero: genero === 'm' ? 'masculino' : genero === 'f' ? 'feminino' : genero
    });
    
    db.verdadeDesafio.set(ctx.chatId, jogo);
    
    const restantes = jogo.totalJogadores - jogo.jogadores.length;
    await sock.sendMessage(ctx.chatId, { text: `✅ @${ctx.senderId.split('@')[0]} entrou como *${nome}*!\n\n${restantes > 0 ? `Faltam ${restantes} jogador(es).` : 'Todos entraram! Usa .vd iniciarjogo para começar.'}`, mentions: [ctx.senderId] });
    
    if (restantes === 0) {
      jogo.estado = 'pronto';
      db.verdadeDesafio.set(ctx.chatId, jogo);
    }
  },
  // ══════════════════════════════════════════════════════════
  // ⚡ MODO INTERNET + SISTEMA DE PAGAMENTOS
  // ══════════════════════════════════════════════════════════
  'modointernet': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa num grupo.' });
    const sub = utils.getGroupSubscription(ctx.chatId);
    if (!sub || (sub.nivel !== 'diamante' && sub.nivel !== 'lenda')) {
      if (!utils.isOwner(ctx.senderId)) return sock.sendMessage(ctx.chatId, { text: '❌ Modo Internet disponível apenas para VIP Diamante ou Lenda.' });
    }
    if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    
    const acao = ctx.args[0]?.toLowerCase();
    if (acao === 'on') {
      db.modoInternet.set(ctx.chatId, true);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: '🌐 *MODO INTERNET ACTIVADO*\n\n🚫 Comandos comuns bloqueados\n👮 Apenas comandos administrativos disponíveis' });
    }
    if (acao === 'off') {
      db.modoInternet.delete(ctx.chatId);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: '✅ *MODO INTERNET DESACTIVADO*\n\nTodos os comandos disponíveis novamente.' });
    }
    await sock.sendMessage(ctx.chatId, { text: `🌐 Modo Internet: ${db.modoInternet.get(ctx.chatId) ? '✅ ON' : '❌ OFF'}\n\nUso: .modointernet on/off\nDisponível: VIP Diamante+` });
  },
  // ⚡ NOVO: TABELAS DE PAGAMENTO (renomeado para .tabpag para não conflitar com .tabela de futebol)
  'tabpag': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa num grupo.' });
    if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    
    const subcmd = ctx.args[0]?.toLowerCase();
    
    if (subcmd === 'add' || subcmd === 'adicionar') {
      const metodo = ctx.args[1];
      const nome = ctx.args[2];
      const numero = ctx.args[3];
      const descricao = ctx.args.slice(4).join(' ');
      if (!metodo || !nome || !numero) {
        return sock.sendMessage(ctx.chatId, { text: 'Uso: .tabpag add [metodo] [nome] [numero] [descricao]\nEx: .tabpag add mpesa Yanik 841234567 Pagamento VIP' });
      }
      if (!db.tabelasPagamento.has(ctx.chatId)) db.tabelasPagamento.set(ctx.chatId, []);
      const lista = db.tabelasPagamento.get(ctx.chatId);
      const id = Date.now() % 100000;
      lista.push({ id, metodo, nome, numero, descricao });
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `✅ Método de pagamento adicionado!\n\n💳 ${metodo.toUpperCase()}\n👤 ${nome}\n📱 ${numero}\n📝 ${descricao || 'Sem descrição'}\n🆔 #${id}` });
    }
    
    if (subcmd === 'remove' || subcmd === 'remover') {
      const id = parseInt(ctx.args[1]);
      if (!id) return sock.sendMessage(ctx.chatId, { text: 'Uso: .tabpag remove [id]' });
      const lista = db.tabelasPagamento.get(ctx.chatId) || [];
      const idx = lista.findIndex(t => t.id === id);
      if (idx === -1) return sock.sendMessage(ctx.chatId, { text: '❌ Método não encontrado.' });
      lista.splice(idx, 1);
      salvarDados();
      return sock.sendMessage(ctx.chatId, { text: `✅ Método #${id} removido.` });
    }
    
    if (subcmd === 'list' || subcmd === 'listar' || !subcmd) {
      const lista = db.tabelasPagamento.get(ctx.chatId) || [];
      if (!lista.length) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhuma tabela de pagamento configurada.' });
      let texto = '💳 *TABELAS DE PAGAMENTO*\n\n';
      lista.forEach(t => {
        texto += `🆔 #${t.id}\n💳 ${t.metodo.toUpperCase()}\n👤 ${t.nome}\n📱 ${t.numero}\n📝 ${t.descricao || 'Sem descrição'}\n\n`;
      });
      return sock.sendMessage(ctx.chatId, { text: texto });
    }
    
    await sock.sendMessage(ctx.chatId, { text: 'Uso: .tabpag [add/remove/list]' });
  },
  'pagamento': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa num grupo.' });
    if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    
    const acao = ctx.args[0]?.toLowerCase();
    const id = ctx.args[1];
    if (!id) return sock.sendMessage(ctx.chatId, { text: 'Uso: .pagamento [recebido/recusado] [id]' });
    
    const pedido = db.pedidosPagamento.get(id);
    if (!pedido) return sock.sendMessage(ctx.chatId, { text: '❌ Pedido não encontrado.' });
    if (pedido.status !== 'pendente') return sock.sendMessage(ctx.chatId, { text: `⚠️ Este pedido já foi ${pedido.status}.` });
    
    if (acao === 'recebido' || acao === 'confirmar') {
      pedido.status = 'recebido';
      db.pedidosPagamento.set(id, pedido);
      salvarDados();
      await sock.sendMessage(ctx.chatId, { text: `✅ *PAGAMENTO CONFIRMADO*\n\n🧾 Pedido: #${id}\n💰 Valor: ${pedido.valor || '?'} MT\n👤 Cliente: @${pedido.cliente.split('@')[0]}`, mentions: [pedido.cliente] });
      try { await sock.sendMessage(pedido.cliente, { text: `✅ Pagamento confirmado!\n\n🧾 Pedido: #${id}\n💰 Valor: ${pedido.valor || '?'} MT\n\nObrigado! 🎉` }); } catch {}
      if (pedido.tipoProduto === 'megas') {
        await enviarPedidoMegas(sock, ctx.chatId, pedido);
      }
    } else if (acao === 'recusado' || acao === 'recusar') {
      pedido.status = 'recusado';
      db.pedidosPagamento.set(id, pedido);
      salvarDados();
      await sock.sendMessage(ctx.chatId, { text: `❌ *PAGAMENTO RECUSADO*\n\n🧾 Pedido: #${id}\n💰 Valor: ${pedido.valor || '?'} MT\n👤 Cliente: @${pedido.cliente.split('@')[0]}`, mentions: [pedido.cliente] });
      try { await sock.sendMessage(pedido.cliente, { text: `❌ Pagamento não confirmado.\n\n🧾 Pedido: #${id}\n\nContacta o suporte para mais informações.` }); } catch {}
    } else {
      await sock.sendMessage(ctx.chatId, { text: 'Uso: .pagamento [recebido/recusado] [id]' });
    }
  },
  // ⚡ SISTEMA DE MEGAS — cliente cria o pedido
  'megas': async (sock, ctx) => {
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa este comando dentro do grupo de vendas.' });
    const quantidade = parseInt(ctx.args[0]);
    const numeroDestino = (ctx.args[1] || '').replace(/\D/g, '');
    if (!quantidade || !numeroDestino || numeroDestino.length < 8) {
      return sock.sendMessage(ctx.chatId, { text: '📶 Uso: .megas [quantidade em MB] [número que vai receber]\nEx: .megas 500 841234567' });
    }
    const id = Date.now().toString().slice(-6);
    const pedido = {
      id, cliente: ctx.senderId, status: 'pendente',
      tipoProduto: 'megas', quantidadeMB: quantidade, numeroDestino,
      valor: null, referencia: null, pedido: null, numeroRecebimento: null, metodo: null,
      grupoId: ctx.chatId, criadoEm: Date.now(), notificado: false
    };
    db.pedidosPagamento.set(id, pedido);
    salvarDados();
    await sock.sendMessage(ctx.chatId, {
      text: `📶 *PEDIDO DE MEGAS CRIADO*\n\n🆔 Pedido: ${id}\n📦 Quantidade: ${quantidade}MB\n📱 Vai para: ${numeroDestino}\n\n💳 Efetua o pagamento e envia aqui o comprovativo, mencionando: "pedido ${id}"\n\nAssim que o admin confirmar, os megas são enviados automaticamente. ⚡`
    });
  },
  // ⚡ Fallback manual — se a entrega automática falhar
  'megasenviado': async (sock, ctx) => {
    if (!(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const id = ctx.args[0];
    const pedido = db.pedidosPagamento.get(id);
    if (!pedido || pedido.tipoProduto !== 'megas') return sock.sendMessage(ctx.chatId, { text: '❌ Pedido de megas não encontrado.' });
    pedido.status = 'entregue';
    db.pedidosPagamento.set(id, pedido);
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ *MEGAS ENTREGUES (manual)*\n\n🆔 Pedido: ${id}\n📶 ${pedido.quantidadeMB}MB → ${pedido.numeroDestino}` });
    try { await sock.sendMessage(pedido.cliente, { text: `✅ Os teus ${pedido.quantidadeMB}MB foram enviados para ${pedido.numeroDestino}! 🎉` }); } catch {}
  },
  'cimg': async (sock, ctx) => {
    const conteudo = `║ 🖼️ MÓDULO IMAGEM\n\n║ 🖼️ .converterimagem → sticker em imagem\n║ 🥷 .roubarsticker → salva o sticker\n║ ⭕ .circular → recorte circular`;
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
    let conteudo = `║ 👮 MÓDULO ADMINISTRAÇÃO\n`;
    if (p.pAdmin) conteudo += `║ 🏟️ GRUPO\n║ .marcartodos [msg] → chama todos\n║ .fechar / .abrir → fecha/abre grupo\n║ .link / .idgrupo → link ou ID\n║ .apagar (responde) → apaga mensagem\n║ .nome [novo nome] → renomeia grupo\n║ .foto (responde img) → troca a foto\n║ .criargrupo [nome] → cria novo grupo\n\n║ 📅 AGENDAMENTO\n║ .agendar HH:MM [msg] → agenda envio\n║ .agendar ls → lista agendamentos\n║ .agendar del [id] → apaga agendamento\n`;
    if (p.pBan) conteudo += `║ MODERAÇÃO\n║ .banir @user → remove do grupo\n║ .listarbanidos → lista banidos\n║ ⚠️ .advertir @user → dá advertência\n║ ⚠️ .advertencias @user → vê advertências\n║ ✅ .removeradvertencia → remove advertência\n║ 🔇 .silenciar @user [min] → silencia\n║ 🔊 .dessilenciar @user → retira silêncio\n`;
    if (p.pPromote) conteudo += `║ CARGOS\n║ .promover @user → torna admin\n║ .rebaixar @user → remove admin\n`;
    conteudo += `║\n║ COMANDOS DO GRUPO\n║ .desativarcomando .cmd → desliga comando\n║ .ativarcomando .cmd → liga comando\n║ .listardesativados → vê desativados`;
    await enviarMenuKortex(sock, ctx, { titulo: 'MÓDULO ADMINISTRAÇÃO', conteudo, imagemChave: 'administracao' });
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
    await aplicarAdvertencia(sock, ctx.chatId, target, 'Manual (admin)');
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
    let conteudo = `║ 🛡️ MÓDULO PROTEÇÃO\n`;
    if (p.pAnti) conteudo += `║ 🔗 ANTI-LINK\n║ .antilink [modo] → ativa/desativa\n║ .antilink add [site] → permite site\n║ .antilink remove [site] → remove site\n║ .antilink ls → lista permitidos\n\n║ 🛡️ ANTI-MÍDIA\n║ .antimidia [tipo] on/off → bloqueia tipo\n║ .antimidia ls → lista bloqueios\n\n║ ⏱️ AUTO-DELETE\n║ .autodelete [tempo] → apaga automático\n\n║ 🚫 PALAVRAS\n║ .proibirpalavra [p] → bloqueia palavra\n║ .desbanirpalavra [p] → desbloqueia palavra\n║ .listarpalavras → lista bloqueadas\n`;
    if (p.pRules) conteudo += `║ 📜 REGRAS\n║ .regras [texto] → define regras\n║ .verregras → mostra regras\n`;
    conteudo += `║\n║ 👋 .boasvindas [msg]/off → msg de entrada\n║ 📢 .notificar on/off → avisos do grupo\n║ 🤖 .ia on/off → IA livre no grupo`;
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
    const conteudo = `║ 📲 MÓDULO MÍDIA\n\n║ 🎵 REDES\n║ .tiktok [link] → baixa vídeo\n║ .tiktokaudio [link] → baixa áudio\n║ .instagram [link] → baixa mídia\n║ .facebook [link] → baixa vídeo\n║ .pinterest [link] → baixa imagem\n║ .baixar [link] → baixa genérico\n\n║ 🎬 YOUTUBE\n║ .youtube [pesquisa] → procura vídeo\n║ .youtubevideo [link] → baixa vídeo\n║ .youtubeaudio [link] → baixa áudio/mp3\n\n║ 👻 EXTRAS\n║ .revelar → revela status/foto\n║ .fichamidia [link] → dados da mídia\n║ .canal [url] → info do canal\n║ .zip [links] → compacta em zip\n\n║ OUTROS\n║ .traduzir [texto] → traduz\n║ .recibo [plano] [dias] → gera recibo`;
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
    await sock.sendMessage(ctx.chatId, { text: '📸 ⚡ Instagram\n⏳ Só um instante...' });
    try {
      const dados = await extrairGenDownload(link);
      const formatos = dados?.formats || [];
      const videos = formatos.filter(f => f.type === 'video');
      const imagens = formatos.filter(f => f.type === 'image' || /jpe?g|png|webp/.test(f.ext || ''));
      if (videos.length) { const buf = await baixarBufferGen(videos[0]); if (buf) return await sock.sendMessage(ctx.chatId, { video: buf, caption: `Instagram — ${dados.author || ''}`, mimetype: 'video/mp4' }); }
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
    await sock.sendMessage(ctx.chatId, { text: '📘 ⚡ Facebook\nA capturar...' });
    try { await executarDownloadUniversal(sock, ctx, link); }
    catch (e) { console.warn('facebook:', e.message); await sock.sendMessage(ctx.chatId, { text: '😔 Não consegui baixar do Facebook.' }); }
  },
  'baixar': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'baixar')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const link = ctx.args[0];
    if (!link || !/^https?:\/\//i.test(link)) return sock.sendMessage(ctx.chatId, { text: '🌐 Uso: .baixar [link]\nFunciona com 1600+ sites.' });
    await sock.sendMessage(ctx.chatId, { text: '🌐 Download Universal\nA analisar...' });
    try { await executarDownloadUniversal(sock, ctx, link); }
    catch (e) { console.warn('baixar:', e.message); await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui extrair mídia.' }); }
  },
  'youtube': async (sock, ctx) => {
    if (!verificarAcessoMidia(ctx, 'youtube')) return sock.sendMessage(ctx.chatId, { text: '❌ Acesso negado!\n\n💡 Usa .guiamidia para ver como desbloquear.' });
    const pesquisa = ctx.args.join(' ');
    if (!pesquisa) return sock.sendMessage(ctx.chatId, { text: 'Uso: .youtube [pesquisa]' });
    try {
      await sock.sendMessage(ctx.chatId, { text: '🔍 A pesquisar...' });
      const yts = require('yt-search');
      const resultados = await yts(pesquisa);
      const videos = resultados.videos.slice(0, 5);
      if (!videos.length) return sock.sendMessage(ctx.chatId, { text: '❌ Nenhum resultado.' });
      let texto = `🎬 *RESULTADOS*\n\n`;
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
        let videoFinal = buf;
        const ehMp4Real = buf.length > 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp';
        if (!ehMp4Real) videoFinal = await normalizarVideoParaWhatsApp(buf);
        const videoId = extrairVideoId(link);
        const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
        return await sock.sendMessage(ctx.chatId, { video: videoFinal, mimetype: 'video/mp4', caption: `${(dados.title || 'Vídeo').substring(0, 60)}\n⚡ Kortex`, contextInfo: thumbnail ? { externalAdReply: { title: dados.title || 'Vídeo', body: dados.author || '', thumbnailUrl: thumbnail, mediaType: 2, renderLargerThumbnail: true } } : undefined });
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
    await sock.sendMessage(ctx.chatId, { text: '📌 Pinterest\nA extrair imagens...' });
    try {
      const dados = await extrairGenDownload(link);
      const imagens = (dados.formats || []).filter(f => f.type === 'image' || /jpe?g|png|webp/.test(f.ext || ''));
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
    if (!viewOnce) return sock.sendMessage(ctx.chatId, { text: '👻 Responde a uma mensagem "visualização única" com .revelar' });
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
      const texto = `📊 *FICHA DA MÍDIA*\n\n🌐 ${(dados.source || '—').toUpperCase()}\n🎬 ${dados.title || '—'}\n👤 ${dados.author || '—'}\n⏱️ ${dur}\n👁️ ${dados.views ? Number(dados.views).toLocaleString('pt-PT') : '—'}\n\n📦 Formatos:\n${formatos || '(nenhum)'}\n\n💡 Usa .baixar [link]`;
      if (dados.thumbnail) await sock.sendMessage(ctx.chatId, { image: { url: dados.thumbnail }, caption: texto });
      else await sock.sendMessage(ctx.chatId, { text: texto });
    } catch { await sock.sendMessage(ctx.chatId, { text: '❌ Não consegui ler este link.' }); }
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
      let texto = `📡 *VÍDEOS*\n\n`;
      itens.slice(0, 10).forEach((v, i) => { texto += `${i + 1}. ${(v.title || 'Sem título').substring(0, 45)}\n🔗 ${v.url}\n\n`; });
      texto += `💡 Usa .baixar [link]`;
      await sock.sendMessage(ctx.chatId, { text: texto });
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
    const conteudo = `║ 🎨 MÓDULO STICKERS\n\n║ 🖼️ .figurinha → cria sticker\n║ ✏️ .stickertexto [texto] → sticker com texto\n║ ℹ️ .infosticker → dados do sticker`;
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
    await sock.sendMessage(ctx.chatId, { text: `📋 *INFO DO STICKER*\n┃ 📦 Pacote: ${s.stickerPack || '—'}\n┃ ✏️ Autor: ${s.stickerAuthor || '—'}\n┃ 📛 Nome: ${s.stickerName || '—'}\n┃ 📏 ${(s.fileLength ? (Number(s.fileLength) / 1024).toFixed(1) : 'N/A')} KB\n┃ 🎞️ Animado: ${s.isAnimated ? '✅' : '❌'}` });
  },
  'cdono': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const conteudo = `║ 👑 PAINEL DO DONO\n\n║ 💎 VIPs GRUPO\n║ .ativarvip [nível] [dias] → ativa VIP\n║ .removervip → remove VIP\n║ .listargrupos → lista grupos\n║ .avisartodos all → avisa todos os grupos\n\n║ 👤 VIPs USER\n║ .vipuser @user [n] [d] → dá VIP a user\n║ .meuvip → vê o teu VIP\n\n║ 🔑 KEYS\n║ .gerarkey [nível] [qtd] → gera keys random\n║ .desativarkey [KRX-...] → invalida key\n║ .mudarkey [nova] → altera Key Universal\n\n║ 🛠️ SISTEMA\n║ .estatisticas → estatísticas do bot\n║ .usocomandos → uso dos comandos\n║ .relatorio → relatório completo\n║ .historico → histórico de ações\n║ .prefixo [novo] → muda o prefixo\n║ .backup / .restaurar → backup dos dados\n║ .modelo [nome] → muda modelo de IA\n║ ⚡ .semprefixo on/off → comandos sem ponto\n\n║ 🔇 CONTROLO\n║ .desligarbot / .ligarbot → liga/desliga\n║ .ignorar / .designorar → ignora user\n║ .ignorados → lista ignorados\n║ .atalho / .removeratalho → atalhos de texto\n║ .listaratalhos → lista atalhos\n║ .entrar [link] → entra em grupo\n║ 📤 .sair → sai do grupo\n║ 🧾 .recibo [p] [d] [n] → gera recibo\n║ .meuid → IDs do sistema`;
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
    if (!sub || sub.expiraEm < Date.now()) return sock.sendMessage(ctx.chatId, { text: `🚫 *SEM ASSINATURA*\nContacte: ${CONFIG.ownerNumber}` });
    const restante = Math.max(0, sub.expiraEm - Date.now());
    const nivel = NIVEIS_VIP[sub.nivel];
    await sock.sendMessage(ctx.chatId, { text: `💎 Nível: ${nivel.nome}\n⏳ ${utils.tempoRestante(restante)}\n\nBan: ${nivel.ban ? '✅' : '❌'}\nPromover: ${nivel.promote ? '✅' : '❌'}\nRegras: ${nivel.rules ? '✅' : '❌'}\nProtecção: ${nivel.anti ? '✅' : '❌'}\nBoas-vindas: ${nivel.boasvindas ? '✅' : '❌'}\nStickers: ${nivel.sticker ? '✅' : '❌'}` });
  },
  'meuid': async (sock, ctx) => {
    const botId = sock.user?.id || 'Desconhecido';
    await sock.sendMessage(ctx.chatId, { text: `🆔 *IDs*\n\n🤖 Bot: ${botId}\n👑 Dono: ${CONFIG.ownerId}\n👤 Tu: ${ctx.senderId}\nÉ dono? ${utils.isOwner(ctx.senderId) ? '✅' : '❌'}` });
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
    await sock.sendMessage(ctx.chatId, { text: `✅ *VIP USER ACTIVADO*\n👤 @${target.split('@')[0]}\n💎 ${NIVEIS_VIP_USER[nivel].nome}\n⏳ ${diasFinais} dias\n🔓 ${NIVEIS_VIP_USER[nivel].cmds.map(c => '.' + c).join(', ')}`, mentions: [target] });
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
    const m = (ctx.args[0] || '').match(/chat.whatsapp.com\/([A-Za-z0-9_-]+)/);
    if (!m) return sock.sendMessage(ctx.chatId, { text: 'Uso: .entrar [link do grupo]' });
    try { const g = await sock.groupAcceptInvite(m[1]); await sock.sendMessage(ctx.chatId, { text: `✅ Entrei no grupo ${g?.gid || ''}` }); }
    catch { await sock.sendMessage(ctx.chatId, { text: '❌ Link inválido ou expirado.' }); }
  },
  'sair': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!ctx.isGroup) return sock.sendMessage(ctx.chatId, { text: '❌ Usa num grupo.' });
    await sock.sendMessage(ctx.chatId, { text: '👋 Até já!' });
    setTimeout(() => { sock.groupLeave(ctx.chatId).catch(() => {}); }, 1500);
  },
  'semprefixo': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const a = ctx.args[0]?.toLowerCase();
    if (a === 'on') { db.grupos.semPrefixo.add(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⚡ SEM PREFIXO ACTIVADO neste grupo.\n(comandos perigosos continuam a exigir prefixo)' }); }
    if (a === 'off') { db.grupos.semPrefixo.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '⚡ Sem prefixo desativado.' }); }
    await sock.sendMessage(ctx.chatId, { text: `Sem prefixo: ${db.grupos.semPrefixo.has(ctx.chatId) ? '✅ ON' : '❌ OFF'}\nUso: .semprefixo on/off` });
  },
  // ══════════════════════════════════════════════════════════
  // KORTEX KEY SYSTEM — COMANDOS
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
    if (buf) return await sock.sendMessage(ctx.chatId, { audio: buf, mimetype: 'audio/mpeg', fileName: `${(dados.title || 'audio').replace(/[^a-z0-9]/gi, '_').substring(0, 50)}.mp3`, ptt: false });
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
// ESTADO GLOBAL + TERMINAL
// ══════════════════════════════════════════════════════════
let reconnectAttempts = 0, pausado = false, geracaoAtual = 0, sockAtual = null;
let ultimasMensagensIds = [];
let mensagensIgnoradas = new Set();

setInterval(() => {
  try {
    const AGORA = Date.now(); const TEMPO_MORTO = 2 * 60 * 60 * 1000; let limpos = 0;
    for (const [chatId, ultimoUso] of db.historicoIAUltimoUso) {
      if (AGORA - ultimoUso > TEMPO_MORTO) { db.historicoIA.delete(chatId); db.historicoIAUltimoUso.delete(chatId); limpos++; }
    }
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

// ══════════════════════════════════════════════════════════
// PROCESSAMENTO DE MENSAGEM (com novos sistemas integrados)
// ══════════════════════════════════════════════════════════
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
  if (pausado || minhaGeracao !== geracaoAtual) return;
  if (db.ignorados.has(senderId) && !utils.isOwner(senderId)) return;
  if (isGroup && db.grupos.desligados.has(chatId) && !utils.isOwner(senderId)) return;

  // PV — cartão de apresentação para não-VIP
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

  // ══════════════════════════════════════════════════════════
  // ⚡ MODO INTERNET — BLOQUEIO DE COMANDOS
  // ══════════════════════════════════════════════════════════
  if (isGroup && db.modoInternet.get(chatId)) {
    const COMANDOS_ADM_MODO_INTERNET = new Set([
      'banir', 'promover', 'rebaixar', 'fechar', 'abrir', 'apagar',
      'antilink', 'proibirpalavra', 'desbanirpalavra', 'regras', 'boasvindas',
      'advertir', 'removeradvertencia', 'antimidia', 'autodelete',
      'notificar', 'nome', 'foto', 'marcartodos', 'agendar',
      'desativarcomando', 'ativarcomando', 'listardesativados',
      'modointernet', 'tabpag', 'pagamento', 'megas', 'megasenviado', 'menu', 'ajuda', 'cgeral',
      'cadmin', 'cprot', 'cmidia', 'cstick', 'cdono', 'cutil', 'ctexto',
      'cinfo', 'cdiv', 'cimg', 'info', 'ping', 'hora', 'statusgrupo',
      'verregras', 'listarpalavras', 'listarbanidos', 'advertencias',
      'link', 'idgrupo', 'meuid', 'meuvip', 'pontos', 'ranking'
    ]);
    
    if (fullText?.startsWith(CONFIG.prefix)) {
      const cmd = fullText.slice(CONFIG.prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
      if (cmd && !COMANDOS_ADM_MODO_INTERNET.has(cmd) && !utils.isOwner(senderId)) {
        return sock.sendMessage(chatId, { text: '🌐 *MODO INTERNET ACTIVO*\n\n🚫 Comandos comuns bloqueados.\n👮 Apenas comandos administrativos disponíveis.' });
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // ⚡ DETECÇÃO DE PAGAMENTO (sem prefixo)
  // ══════════════════════════════════════════════════════════
  if (isGroup && fullText && !fullText.startsWith(CONFIG.prefix)) {
    const tabelas = db.tabelasPagamento.get(chatId);
    if (tabelas?.length) {
      const dados = detectarPagamento(fullText, tabelas);
      if (dados) {
        let pedidoId = 'P' + Date.now().toString().slice(-6);
        let pedido = null;

        // ⚡ Se o cliente referenciou um pedido já criado (ex: .megas), reaproveita-o
        if (dados.pedido && db.pedidosPagamento.has(dados.pedido)) {
          const existente = db.pedidosPagamento.get(dados.pedido);
          if (existente.status === 'pendente' && existente.cliente === senderId) {
            pedidoId = dados.pedido;
            pedido = existente;
            pedido.valor = dados.valor ?? pedido.valor;
            pedido.referencia = dados.referencia ?? pedido.referencia;
            pedido.numeroRecebimento = dados.numeroRecebimento ?? pedido.numeroRecebimento;
            pedido.metodo = dados.metodo ?? pedido.metodo;
          }
        }
        if (!pedido) {
          pedido = {
            id: pedidoId,
            cliente: senderId,
            valor: dados.valor,
            referencia: dados.referencia,
            pedido: dados.pedido,
            numeroRecebimento: dados.numeroRecebimento,
            metodo: dados.metodo,
            grupoId: chatId,
            status: 'pendente',
            criadoEm: Date.now(),
            notificado: false
          };
        }
        
        db.pedidosPagamento.set(pedidoId, pedido);
        salvarDados();
        
        if (dados.numeroRecebimento) {
          await notificarADMsPagamento(sock, chatId, pedido);
        } else {
          await sock.sendMessage(chatId, { text: `🧾 *PAGAMENTO DETECTADO*\n\n💰 Valor: ${dados.valor || '?'} MT\n🔖 Referência: ${dados.referencia || 'Não informado'}\n🧾 Pedido: ${dados.pedido ? '#' + dados.pedido : 'Não informado'}\n\n📱 *Número de recebimento não encontrado.*\n\nPor favor, envia o número para onde fizeste a transferência.` });
          
          db.fluxosKey.set(senderId, {
            tipo: 'pagamentoNumero',
            passo: 'aguardarNumero',
            dados: { pedidoId },
            expiraEm: Date.now() + 300000
          });
        }
        return;
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // ⚡ VOTO EU NUNCA (sem prefixo)
  // ══════════════════════════════════════════════════════════
  if (isGroup && fullText && !fullText.startsWith(CONFIG.prefix)) {
    const textoLower = fullText.toLowerCase().trim();
    if (textoLower === '.eununca sim' || textoLower === '.eununca nao' || textoLower === '.eununca não') {
      const jogo = db.eununca.get(chatId);
      if (jogo) {
        const voto = textoLower.includes('sim');
        if (jogo.votos.has(senderId)) {
          return sock.sendMessage(chatId, { text: '⚠️ Já votaste!' });
        }
        jogo.votos.set(senderId, voto);
        db.eununca.set(chatId, jogo);
        return sock.sendMessage(chatId, { text: `✅ Voto registado: ${voto ? 'Já fiz' : 'Nunca fiz'}` });
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // ⚡ RESPOSTA ANAGRAMA (sem prefixo)
  // ══════════════════════════════════════════════════════════
  if (isGroup && fullText && !fullText.startsWith(CONFIG.prefix)) {
    const anagrama = db.anagramas.get(chatId);
    if (anagrama && !anagrama.acertou) {
      const resposta = fullText.toLowerCase().trim();
      if (resposta === anagrama.palavra.toLowerCase()) {
        anagrama.acertou = senderId;
        db.anagramas.set(chatId, anagrama);
        
        const pontos = db.indicadores.get(senderId) || 0;
        db.indicadores.set(senderId, pontos + 1);
        salvarDados();
        
        await sock.sendMessage(chatId, { text: `🎉 *ACERTOU!*\n\n@${senderId.split('@')[0]} descobriu a palavra: *${anagrama.palavra}*\n\n🏆 +1 ponto (total: ${pontos + 1})`, mentions: [senderId] });
        return;
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // KORTEX KEY SYSTEM — HANDLER DE FLUXOS
  // ══════════════════════════════════════════════════════════
  const fluxoAtivo = db.fluxosKey.get(chatId) || db.fluxosKey.get(senderId);
  if (fluxoAtivo && Date.now() < fluxoAtivo.expiraEm) {
    const resposta = fullText.toLowerCase().trim();
    
    // ⚡ Fluxo de número de pagamento
    if (fluxoAtivo.tipo === 'pagamentoNumero' && fluxoAtivo.passo === 'aguardarNumero') {
      const numMatch = fullText.match(/^(\d{8,9})$/);
      if (numMatch) {
        const { pedidoId } = fluxoAtivo.dados;
        const pedido = db.pedidosPagamento.get(pedidoId);
        if (pedido) {
          pedido.numeroRecebimento = numMatch[1];
          db.pedidosPagamento.set(pedidoId, pedido);
          salvarDados();
          
          await sock.sendMessage(chatId, { text: '✅ Número registado! A notificar ADMs...' });
          await notificarADMsPagamento(sock, pedido.grupoId, pedido);
        }
        db.fluxosKey.delete(senderId);
        return;
      } else {
        await sock.sendMessage(chatId, { text: '❌ Número inválido. Envia um número de 8 ou 9 dígitos.' });
        return;
      }
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
    
    // Fluxo de confirmação de revogação
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
      await sock.sendMessage(chatId, { text: '🔐 KORTEX SECURITY\n\n⛔ Acesso negado.\nEsta Key é exclusiva do dono.' });
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
      await sock.sendMessage(chatId, { text: '❌ KORTEX SECURITY\n\n🔑 Key inválida ou não encontrada.' });
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
  if (isGroup) {
    const isAdmin = await utils.isSenderGroupAdmin(sock, chatId, senderId);
    const isOwner = utils.isOwner(senderId);
    if (!isAdmin && !isOwner) {
      // ⚡ ANTI-FLOOD — 5 mensagens em 5 segundos = advertência automática
      const floodKey = `${chatId}:${senderId}`;
      const agora = Date.now();
      let timestamps = floodTracker.get(floodKey) || [];
      timestamps.push(agora);
      timestamps = timestamps.filter(t => agora - t <= FLOOD_JANELA_MS);
      floodTracker.set(floodKey, timestamps);
      if (timestamps.length >= FLOOD_LIMITE_MSGS) {
        floodTracker.delete(floodKey); // reinicia a contagem para não advertir de novo na mesma rajada
        await aplicarAdvertencia(sock, chatId, senderId, `Flood (${FLOOD_LIMITE_MSGS}+ mensagens em ${FLOOD_JANELA_MS / 1000}s)`);
        return;
      }
      const mut = db.mutados.get(chatId)?.get(senderId);
      if (mut) {
        if (mut > Date.now()) { try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { console.warn('⚠️ Falha ao apagar (mutado):', e.message); } return; }
        db.mutados.get(chatId).delete(senderId); salvarDados();
      }
      const antiLinkMode = db.grupos.antiLink.get(chatId);
      if (antiLinkMode && fullText) {
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
      if (fullText) {
        for (const palavra of palavrasBanidas) {
          if (fullText.toLowerCase().includes(palavra)) {
            try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { console.warn('⚠️ Falha ao apagar (palavra banida):', e.message); }
            await sock.sendMessage(chatId, { text: `🚫 *PALAVRA PROIBIDA*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
            return;
          }
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
          try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (e) { console.warn(`⚠️ Falha ao apagar (antimídia ${tipo}):`, e.message); }
          await sock.sendMessage(chatId, { text: `🛡️ *${tipo.toUpperCase()} BLOQUEADO*\n@${senderId.split('@')[0]}`, mentions: [senderId] });
          return;
        }
      }
    }
  }

  // ⚡ Atraso humanizado — só aplica-se depois da moderação, para não atrasar deleções
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));


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
            else if (['ativarvip','removervip'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
            else if (['desligarbot','ligarbot','ignorar','designorar','prefixo','backup','restaurar','modelo','entrar','atalho','removeratalho'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
            else if (['gerarkey','desativarkey','mudarkey'].includes(detecao.comando)) temPermissaoDireta = utils.isOwner(senderId);
            else if (['modointernet','tabpag','pagamento','megasenviado'].includes(detecao.comando)) temPermissaoDireta = await utils.hasGroupAdminRights(sock, chatId, senderId);
            
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
    else if (textoLower === 'boa tarde') { await utils.reagir(sock, msg, '🌇'); await sock.sendMessage(chatId, { text: ['Boa tarde! 😊', 'Boa tarde! ⚡', 'Boa tarde, chefe! 🤝'][Math.floor(Math.random() * 3)] }); }
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
    if (pareceNomeCanalCandidato(fullText)) {
      const canal = await pesquisarCanalPorNome(fullText.trim());
      if (canal) { await enviarCartaoCanal(sock, chatId, canal); return; }
    }
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
// ⚡ startBot REFORÇADO
// ══════════════════════════════════════════════════════════
async function startBot() {
  let sock;
  try {
    if (sockAtual) {
      try { sockAtual.end(new Error('substituído')); } catch {}
      try { sockAtual.ws?.removeAllListeners(); sockAtual.ev?.removeAllListeners(); } catch {}
      sockAtual = null;
    }
    const { state, saveCreds } = await useMultiFileAuthState('sessao_kortex');
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
      printQRInTerminal: false, browser: ['Ubuntu', 'Chrome', '20.0.04'],
      logger: pino({ level: 'fatal' }), syncFullHistory: false, markOnlineOnConnect: true,
      getMessage: async () => undefined
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
    sock.ws.on('CB:call', async (json) => {
      try {
        const from = json.content?.[0]?.attrs?.from || json.attrs?.from;
        if (!from) return;
        const bloqueios = db.grupos.antiMidia.get(from) || new Set();
        if (bloqueios.has('ligacao')) {
          await sock.rejectCall(json.content?.[0]?.attrs?.['call-id'] || json.attrs?.id, from);
          await sock.sendMessage(from, { text: '📵 Ligações não são permitidas neste grupo.' }).catch(() => {});
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
            await sock.sendMessage(groupId, { text: `❌ Este grupo não possui assinatura activa.\n📞 Contacte ${CONFIG.creator}: ${CONFIG.ownerNumber}` }).catch(() => {});
            setTimeout(() => { sock.groupLeave(groupId).catch(() => {}); }, 3000);
          }
        }
      }
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' || pausado) return;
      for (const m of messages) {
        enfileirarProcessamento(() => processarMensagem(sock, m));
      }
    });
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        if (sock !== sockAtual) return;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { console.log('🚪 Bot desconectado (logout). Reinicia manualmente.'); return; }
        reconnectAttempts++;
        const base = Math.min(2000 * Math.pow(2, reconnectAttempts), 60000);
        const delay = base + Math.floor(Math.random() * 1000);
        console.log(`🔄 Reconectando em ${Math.round(delay / 1000)}s... (${reconnectAttempts})`);
        setTimeout(startBot, delay);
      } else if (connection === 'open') {
        if (sock !== sockAtual) return;
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
    const delay = Math.min(5000 * reconnectAttempts, 60000) + Math.floor(Math.random() * 1000);
    setTimeout(startBot, delay);
  }
}

console.log(`🚀 Iniciando ${CONFIG.botName}...`);
console.log(`👤 Criado por: ${CONFIG.creator}`);
startBot().catch(console.error);

module.exports = { CONFIG, db, commands, utils, startBot };
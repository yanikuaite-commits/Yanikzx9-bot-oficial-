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
botNumber: "258865672009",
prefix: ".",
dataFile: path.join(__dirname, 'data', 'bot_data.json'),
historicoFile: path.join(__dirname, 'data', 'historico.json')
};

const groq = new Groq({
apiKey: process.env.GROQ_API_KEY
});

const server = http.createServer((req, res) => {
res.writeHead(200, { 'Content-Type': 'text/html' });
res.end(`<h1>💚 ${CONFIG.botName}</h1><p>Criado por ${CONFIG.creator}</p><p>🟢 Online</p>`);
});

server.listen(process.env.PORT || 3000, () => {
console.log(`🌐 Servidor HTTP na porta ${process.env.PORT || 3000}`);
});// =================== BASE DE DADOS DO BOT ===================
const db = {
gruposVIP: new Map(),
grupoDono: new Map(),
historicoIA: new Map(),
statusDono: null,
historicoGrupos: new Map(),
atalhos: new Map(),
lembretes: [],
ultimoCartaoPV: new Map(),
grupos: {
antiLink: new Map(),
palavrasBanidas: new Map(),
banidos: new Map(),
boasvindas: new Map(),
regras: new Map(),
iaAtivo: new Set(),
transacoes: new Map(),
desligados: new Set()
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

const RATE_LIMIT_MAX = 4;
const RATE_LIMIT_JANELA_MS = 3 * 60 * 1000;
const RATE_LIMIT_EXCLUIR = new Set(['dlt', 'info']);

function verificarRateLimit(senderId, cmd) {
if (RATE_LIMIT_EXCLUIR.has(cmd)) return { permitido: true };
const chave = `${senderId}|${cmd}`;
const agora = Date.now();
let usos = (db.rateLimit.get(chave) || []).filter(t => agora - t < RATE_LIMIT_JANELA_MS);
if (usos.length >= RATE_LIMIT_MAX) {
db.rateLimit.set(chave, usos);
const esperarMs = RATE_LIMIT_JANELA_MS - (agora - usos[0]);
return { permitido: false, esperarMs };
}
usos.push(agora);
db.rateLimit.set(chave, usos);
return { permitido: true };
}

const CHAT_LIMITE_MAX = 5;
const CHAT_LIMITE_JANELA_MS = 5 * 60 * 1000;

function verificarLimiteConversaIA(senderId) {
const chave = `chat|${senderId}`;
const agora = Date.now();
let usos = (db.rateLimit.get(chave) || []).filter(t => agora - t < CHAT_LIMITE_JANELA_MS);
if (usos.length >= CHAT_LIMITE_MAX) {
db.rateLimit.set(chave, usos);
const esperarMs = CHAT_LIMITE_JANELA_MS - (agora - usos[0]);
return { permitido: false, esperarMs };
}
usos.push(agora);
db.rateLimit.set(chave, usos);
return { permitido: true };
}

const MENU_LIMITE_MAX = 2;
const MENU_LIMITE_JANELA_MS = 3 * 60 * 1000;

class PermissaoNegada extends Error {}

const MENU_COMANDOS = new Set(['menu', 'menubtn', 'h', 'help', 'cgeral', 'cadmin', 'cprot', 'cmidia', 'cstick', 'cdono']);

const COMANDO_EMOJIS = {
menu: '📜', menubtn: '📜', cgeral: '🌐', cadmin: '👮', cprot: '🛡️', cmidia: '📲', cstick: '🖼️', cdono: '👑',
ping: '', hora: '🕒', info: '💚', alug: '💰', stg: '💎', comandos: '📋', ranking: '', pontos: '🔢', indicar: '📨',
ban: '', kick: '👢', up: '⬆️', down: '⬇️', all: '', rj: '🚫', hist: '📜', tconta: '',
close: '🔒', open: '🔓', link: '', tid: '🆔', dlt: '🗑️',
antil: '🔗', banw: '', unbanw: '✅', rg: '📜', ia: '', auto: '🤖', vrg: '📃', listw: '',
fig: '🎨', sticker: '🎨', stext: '️', stinfo: 'ℹ️', modelo: '🖼️',
tr: '🌍', traduzir: '', t: '🌍', grcb: '💬',
ativ: '💎', rmvip: '🚫', lsg: '📋', bemv: '👋', at: '', rmat: '🗑️', lsat: '⚡',
stats: '📊', relatorio: '', hisr: '📜', prefix: '⚙️', backup: '💾', restore: '♻️',
l: '⏰', ls: '', ap: '🗑️', limpar: '🧹', wrnvp: '📢',
offbot: '🔴', onbot: '🟢', ignorar: '🔇', designorar: '', ignorados: '🔇',
act: '✅', pend: '', notificar: '🔔', estats: '📊'
};

function verificarLimiteMenu(senderId, cmd) {
const chave = `menu|${senderId}|${cmd}`;
const agora = Date.now();
let usos = (db.rateLimit.get(chave) || []).filter(t => agora - t < MENU_LIMITE_JANELA_MS);
if (usos.length >= MENU_LIMITE_MAX) {
db.rateLimit.set(chave, usos);
const esperarMs = MENU_LIMITE_JANELA_MS - (agora - usos[0]);
return { permitido: false, esperarMs };
}
usos.push(agora);
db.rateLimit.set(chave, usos);
return { permitido: true };
}

const NIVEIS_VIP = {
ouro:     { nome: 'Ouro ',     maxDias: 7,  admin: true,  ban: true,  promote: false, rules: false, anti: false, boasvindas: false, sticker: false },
diamante: { nome: 'Diamante 💎', maxDias: 30, admin: true,  ban: true,  promote: true,  rules: true,  anti: true,  boasvindas: true,  sticker: true  },
lenda:    { nome: 'Lenda 👑',    maxDias: 60, admin: true,  ban: true,  promote: true,  rules: true,  anti: true,  boasvindas: true,  sticker: true  }
};

const RANK_VIP = { ouro: 1, diamante: 2, lenda: 3 };// =================== IA ===================
async function askGroq(chatId, userText, isOwner = false, isGrupo = false) {
const iaAtiva = db.grupos.iaAtivo.has(chatId);
if (!isOwner && isGrupo && !iaAtiva) {
     const palavrasChave = ['grupo', 'vip', 'ativo', 'antilink', 'status', 'assinatura', 'bot', 'nano'];
     const temPalavraChave = palavrasChave.some(p => userText.toLowerCase().includes(p));
     if (!temPalavraChave) return null;
 }
 if (!db.historicoIA.has(chatId)) db.historicoIA.set(chatId, []);
 const history = db.historicoIA.get(chatId);
 history.push({ role: "user", content: userText });
 if (history.length > 20) history.shift();
 try {
     const totalVip = db.gruposVIP.size;
     let infoSistema = `ESTADO DO SISTEMA:\n- Grupos VIP activos: ${totalVip}\n`;
     if (db.grupos.antiLink.size > 0) {
         infoSistema += `- Anti-link activo em ${db.grupos.antiLink.size} grupos\n`;
     } else {
         infoSistema += `- Anti-link: inactivo\n`;
     }
     const totalPalavras = [...db.grupos.palavrasBanidas.values()].reduce((a, v) => a + v.length, 0);
     infoSistema += `- Palavras banidas: ${totalPalavras} palavras em ${db.grupos.palavrasBanidas.size} grupos\n`;
     infoSistema += `- IA activa em ${db.grupos.iaAtivo.size} grupos\n`;
     infoSistema += `- Uptime: ${Math.floor(process.uptime() / 60)} minutos\n`;
     let systemMsg;
     if (!isGrupo) {
         systemMsg = `Chamas-te ${CONFIG.botName}, és um assistente de WhatsApp criado por ${CONFIG.creator}.
PERSONALIDADE:
Simpático, directo e prestável
Falas português de Moçambique
Respondes de forma concisa e clara
Podes responder a qualquer tipo de pergunta: curiosidades, traduções, cálculos, conselhos, receitas, etc.
Nunca inventas factos — se não souberes, dizes claramente
${infoSistema}
Prefixo de comandos: ${CONFIG.prefix}`; if (isOwner) systemMsg +=`\n\nO DONO está a falar contigo — podes partilhar detalhes do sistema.`; } else { systemMsg =`Chamas-te ${CONFIG.botName}, és um assistente de WhatsApp criado por ${CONFIG.creator}.
PERSONALIDADE:
Simpático, directo e útil
Falas português de Moçambique
Respondes de forma concisa (máx. 3 frases)
Nunca inventas informações
${iaAtiva ? `IA LIVRE ACTIVADA: responde a qualquer pergunta de forma útil e amigável.` : `MODO RESTRITO: só responde sobre o sistema do bot.`}
${infoSistema}
Prefixo de comandos: ${CONFIG.prefix}`; if (isOwner) systemMsg +=`\n\nO DONO está a falar contigo — podes dar informações mais detalhadas.`;
}
    const modelToUse = CONFIG.groq_model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
     const completion = await groq.chat.completions.create({
         messages: [{ role: "system", content: systemMsg }, ...history],
         model: modelToUse,
         temperature: 0.5,
         max_tokens: 250
     });
     const resposta = completion.choices[0]?.message?.content?.trim();
     if (!resposta) return "Não tenho essa informação.";
     history.push({ role: "assistant", content: resposta });
     return resposta;
 } catch (err) {
     console.error('Erro IA [modelo/chave]:', err.message);
     if (err.message?.includes('rate')) return "⏳ Muitas perguntas! Aguarda um momento.";
     if (err.message?.includes('auth') || err.message?.includes('key')) return "❌ Chave Groq inválida.";
     return "❌ Erro ao processar. Tenta novamente.";
 }
}
// =================== COMANDOS ===================
// =================== SISTEMA DE TRANSAÇÕES (E-MOLA / M-PESA) ===================
function getTransacoesGrupo(groupId) {
if (!db.grupos.transacoes.has(groupId)) {
db.grupos.transacoes.set(groupId, { ativo: false, contador: 0, pedidos: {}, contas: [] });
}
const dados = db.grupos.transacoes.get(groupId);
if (!dados.contas) dados.contas = []; // compatibilidade com grupos criados antes desta função
return dados;
}
// Tenta identificar um comprovativo de E-Mola ou M-Pesa no texto da mensagem.
// NOTA: os formatos reais de SMS/comprovativo podem variar (idioma, espaçamento,
// símbolos). Este regex cobre o formato descrito, mas pode precisar de ajuste
// fino com exemplos reais de comprovativos recebidos no grupo.
function detectarComprovativo(texto) {
if (!texto) return null;
// E-Mola (formato real): "ID da transacao XXX. Transferiste X.XXMT para conta NÚMERO, nome: NOME as HH:MM:SS de DD/MM/AAAA..."
let m = texto.match(/id da transac[aã]o[:\s]+([A-Za-z0-9.]+)\.\s*transferiste\s+(\d+(?:[.,]\d{1,2})?)\s*mt\s*para\s*conta\s*(\d+)(?:,\s*nome:\s*([^\n.]+?))?\s+as\s/i);
if (m) return { tipo: 'E-Mola', idTransacao: m[1], valor: m[2].replace(',', '.'), contaDestino: m[3], nomeDestino: m[4]?.trim() };
// M-Pesa (formato real): "Confirmado XXX. Transferiste X.XXMT e a taxa foi de Y.YYMT para NÚMERO aos DD/M/AA as HH:MM PM"
m = texto.match(/confirmado[:\s]+([A-Za-z0-9]+)\.\s*transferiste\s+(\d+(?:[.,]\d{1,2})?)\s*mt.*?para\s+(\d+)\s+aos\s/i);
if (m) return { tipo: 'M-Pesa', idTransacao: m[1], valor: m[2].replace(',', '.'), contaDestino: m[3] };
return null;
}
// Procura em quais grupos existe um pedido pendente #numero que o remetente
// tem permissão para gerir (dono = todos; admin de grupo DIAMANTE+ = só o seu).
// Usado quando .act/.rj/.pend/.hist são executados em privado (PV).
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
// Lista todos os grupos que o remetente pode gerir (dono = todos com sistema
// activo; admin de grupo = só os seus grupos DIAMANTE+). Usado por .pend/.hist
// quando chamados em privado (PV).
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
// Gera os blocos de texto do relatório completo (um por grupo + cabeçalho).
// Usado tanto pelo comando .relatorio como pelo gatilho de IA ("Nano, ...").
async function gerarBlocosRelatorio(sock) {
const gruposInfo = await sock.groupFetchAllParticipating();
const grupoIds = Object.keys(gruposInfo);
if (!grupoIds.length) return ['O bot não está em nenhum grupo no momento.'];
const blocos = [];
 for (const groupId of grupoIds) {
     const nome = gruposInfo[groupId]?.subject || groupId;
     const sub = db.gruposVIP.get(groupId);
     let vipTexto = ' Sem assinatura';
     if (sub) {
         const restante = sub.expiraEm - Date.now();
         vipTexto = restante > 0
             ? `${NIVEIS_VIP[sub.nivel]?.nome || sub.nivel} — expira em ${utils.tempoRestante(restante)}`
             : '⌛ Expirado';
     }
     const antiLinkModo = db.grupos.antiLink.get(groupId);
     const palavras = db.grupos.palavrasBanidas.get(groupId) || [];
     const transacoes = db.grupos.transacoes.get(groupId);
     const banidos = db.grupos.banidos.get(groupId) || [];
     const autoDel = db.autoDelete.get(groupId);
     blocos.push(
`━━━━━━━━━━━━━━━━━━━ 🏷️ *${nome}* 💎 VIP: ${vipTexto} 🔗 Anti-link: ${antiLinkModo ?`✅ (${antiLinkModo})`: '❌'}  IA livre: ${db.grupos.iaAtivo.has(groupId) ? '✅' : '❌'} 🚫 Palavras banidas: ${palavras.length} 👋 Boas-vindas: ${db.grupos.boasvindas.has(groupId) ? '✅' : '❌'} 📜 Regras definidas: ${db.grupos.regras.has(groupId) ? '✅' : '❌'} 💰 Transações: ${transacoes?.ativo ?`✅ (${transacoes.contador} pedido(s), ${transacoes.contas?.length || 0} conta(s))`: '❌'} 🗑️ Auto-delete: ${autoDel ?`✅ (${autoDel}ms)`: '❌'} ⛔ Banidos registados: ${banidos.length}`
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
// Detecta se a pergunta feita à IA está a pedir um resumo/relatório dos grupos
// — nesse caso respondemos com dados reais (gerarBlocosRelatorio) em vez de
// deixar a IA inventar/generalizar uma resposta.
function pareceIntentoRelatorio(texto) {
const t = texto.toLowerCase();
const mencionaGrupos = /grupo/.test(t);
const mencionaResumo = /status|relat[oó]rio|resumo|situa[cç][aã]o|geri[rs]|administr/.test(t);
return mencionaGrupos && mencionaResumo;
}
// Detecta se o dono pediu, por frase natural, para o bot sair do grupo
// (ex: "Nano, saia do grupo", "sai daqui", "pode ir embora").
function pareceIntentoSairGrupo(texto) {
const t = texto.toLowerCase();
return /\b(sai|saia|sair|retira-?te|vai\sembora|desliga-?te)\b.\b(grupo|daqui)\b/.test(t)
|| /\b(sai|saia|pode\sir)\sembora\b/.test(t);
}
// "Nano, bane/silencia fulano" — só dispara se houver alguém mencionado ou
// uma mensagem citada, para não reagir a frases soltas tipo "bane essa dor".
// Como o WhatsApp não tem "silenciar uma pessoa" de verdade, tratamos
// "silenciar"/"cala" como sinónimo de banir (a única acção real disponível).
function pareceIntentoBanir(texto) {
const t = texto.toLowerCase();
return /\b(bane|banir|expulsa|expulsar|remove|tira|silencia|silenciar|cala)\b/.test(t);
}
function pareceIntentoFecharGrupo(texto) {
const t = texto.toLowerCase();
return /\bfecha(r)?\b.*\bgrupo\b/.test(t);
}
function pareceIntentoAbrirGrupo(texto) {
const t = texto.toLowerCase();
return /\b(abre|abrir)\b.*\bgrupo\b/.test(t);
}
// "Nano, apaga essa" — só dispara junto de uma mensagem citada (verificado
// separadamente), para não reagir sempre que alguém disser "apaga" à toa.
function pareceIntentoApagarMensagem(texto) {
const t = texto.toLowerCase();
return /\b(apaga|apagar|deleta|deletar|remove)\b/.test(t);
}
// "Nano, quem é o dono / quem te criou" — pergunta informativa, qualquer
// pessoa pode perguntar (não é uma acção sensível).
function pareceIntentoQuemDono(texto) {
const t = texto.toLowerCase();
return /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\sdono/.test(t)
|| /quem\s+te\s+criou/.test(t)
|| /quem\s+(é|e)\s+(o\s+teu|o\s+seu|teu|seu)?\scriador/.test(t);
}
// =================== SISTEMA DE LEMBRETES (SÓ DONO) ===================
// Interpreta a especificação de hora no início de ctx.args e devolve
// { data, consumidos } — consumidos = quantos tokens de args pertencem à
// hora (o resto é o texto do lembrete). Devolve null se não reconhecer.
function interpretarDataHora(args) {
const agora = new Date();
const juntar = (n) => args.slice(0, n).join(' ');
// "DD/MM HH:MM" ou "DD/MM/AAAA HH:MM"
 let m = juntar(2).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2})$/);
 if (m) {
     const [, dia, mes, ano, h, min] = m;
     const anoFinal = ano ? (ano.length === 2 ? 2000 + parseInt(ano) : parseInt(ano)) : agora.getFullYear();
     const data = new Date(anoFinal, parseInt(mes) - 1, parseInt(dia), parseInt(h), parseInt(min), 0, 0);
     if (!ano && data < agora) data.setFullYear(data.getFullYear() + 1);
     return { data, consumidos: 2 };
 }
 // "amanhã HH:MM"
 m = juntar(2).match(/^amanh[ãa]\s+(\d{1,2}):(\d{2})$/i);
 if (m) {
     const data = new Date(agora);
     data.setDate(data.getDate() + 1);
     data.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
     return { data, consumidos: 2 };
 }
 // "N minutos"
 m = juntar(2).match(/^(\d+)\s*(minutos?|mins?)$/i);
 if (m) return { data: new Date(agora.getTime() + parseInt(m[1]) * 60000), consumidos: 2 };
 // "N horas"
 m = juntar(2).match(/^(\d+)\s*(horas?|hs?)$/i);
 if (m) return { data: new Date(agora.getTime() + parseInt(m[1]) * 3600000), consumidos: 2 };
 // "N dias"
 m = juntar(2).match(/^(\d+)\s*(dias?|d)$/i);
 if (m) return { data: new Date(agora.getTime() + parseInt(m[1]) * 86400000), consumidos: 2 };
 // "HH:MM" (hoje; se já passou, assume amanhã)
 m = juntar(1).match(/^(\d{1,2}):(\d{2})$/);
 if (m) {
     const data = new Date(agora);
     data.setHours(parseInt(m[1]), parseInt(m[2]), 0, 0);
     if (data <= agora) data.setDate(data.getDate() + 1);
     return { data, consumidos: 1 };
 }
 return null;
}
// Cartão enviado a quem não é o dono quando escreve no PV.
function gerarCartaoApresentacao() {
return `╔══════════════════════════════╗\n║  NANO BOT 🤖 ║\n║ Criado por Yanik Uaite ║\n╚══════════════════════════════╝\n\n📌 *SOBRE MIM:*\nSou um assistente pessoal criado para auxiliar em tarefas diárias, estudos e organização. Fui desenvolvido para ser útil e prático no dia a dia.\n\n✨ *O QUE EU FAÇO:*\n├─ Gestão e proteção de grupos (anti-link, boas-vindas, moderação)\n├─ Assinaturas VIP para grupos (Ouro, Diamante, Lenda)\n├─ Sistema de pagamentos E-Mola/M-Pesa\n├─ Tradutor de texto\n└─ Loja Yanikzx9 Store (produtos e planos)\n\n *ATENÇÃO:*\nEste bot é um projeto pessoal do meu criador\n\n *CONTACTO DO CRIADOR:*\n✆ 834788141\n📧 yanikuaite@gmail.com\n\n💬 *FUNCIONALIDADES DISPONÍVEIS:*\n➜ Comandos ótimos para gestão de grupos\n➜ várias funções interessantes\n➜ Gestão de tarefas e estudos\n\n🔐 *PRIVACIDADE:*\nTodas as suas interações e dados são tratados com confidencialidade. Não compartilho informações com terceiros.\n\n *VERSÃO:* 2.0.0\n\n💚 Obrigado por entrar em contato!\nPara mais informações, fale com o meu criador.\n\n╔══════════════════════════════╗\n║ 💚 NANO BOT  2026 ║\n══════════════════════════════╝`;
}
// Cartão de aviso enviado a um grupo que TEM VIP activo (.wrnvp all)
function gerarCartaoVipAtivo(sub) {
const dias = Math.max(0, Math.ceil((sub.expiraEm - Date.now()) / 86400000));
const nivel = NIVEIS_VIP[sub.nivel]?.nome || sub.nivel;
return `╔══════════════════════════════╗\n ◈ N A N O B O T  ◈\n╚══════════════════════════════╝\n\n 💎 *STATUS VIP DESTE GRUPO*\n ─────────────────────────────\n\n ✅ Este grupo tem o plano *${nivel}* activo!\n ⏳ Dias restantes: *${dias}*\n\n Para renovar antes que expire e não perder as funções, contacta o dono:\n ✆ 834788141\n 📧 yanikuaite@gmail.com\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n 💚 Obrigado por confiares no Nano Bot!\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
}
// Cartão de aviso enviado a um grupo SEM VIP activo (.wrnvp all)
function gerarCartaoVipConvite() {
return `╔══════════════════════════════╗\n ◈ N A N O B O T  ◈\n╚══════════════════════════════╝\n\n 💎 *ACTIVA O VIP NESTE GRUPO!*\n ─────────────────────────────\n\n Este grupo ainda não tem uma assinatura VIP activa.\n\n Com o VIP desbloqueias:\n ├─ Administração automática (ban, promover, etc.)\n ├─ Anti-link e protecção contra spam\n ├─ Boas-vindas personalizadas\n ├─ Auto-replies e regras do grupo\n └─ Sistema de pagamentos E-Mola/M-Pesa\n\n Fala com o dono para activares agora:\n ✆ 834788141\n 📧 yanikuaite@gmail.com\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n 💚 Desbloqueia todo o potencial do Nano Bot!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
}
// =================== MENUS EM TEXTO (sem botões) ===================
// Os botões interativos não estavam a ser gerados de forma fiável (o
// WhatsApp não os renderiza em muitas contas normais/não-Business), por
// isso foram removidos. Os menus e submenus agora enviam sempre texto puro.
// Abre o menu principal em texto simples — usado tanto pelo .menu como
// pelo atalho de mencionar o bot pelo nome sozinho.
async function enviarMenuComBotoes(sock, jid, senderId) {
const isGroup = jid.endsWith('@g.us');
const ctxFallback = { chatId: jid, args: [], senderId, isGroup };
await commands['menu'](sock, ctxFallback);
}
// Envia o texto detalhado de um submenu (o 'corpo' já vem com tudo:
// título, lista de comandos e rodapé), sem tentar gerar botões.
async function enviarSubmenuBotoes(sock, jid, { corpo }) {
await sock.sendMessage(jid, { text: corpo });
}
const commands = {
_getPerms: async (sock, ctx) => {
const isOwner   = utils.isOwner(ctx.senderId);
const isGroupAdmin = ctx.isGroup ? await utils.isSenderGroupAdmin(sock, ctx.chatId, ctx.senderId) : false;
const sub  = ctx.isGro up ? utils.getGroupSubscription(ctx.chatId) : null;
const vip  = sub ? NIVEIS_VIP[sub.nivel] : null;
return {
isOwner, isGroupAdmin, vip, sub,
nivelNome : vip ? vip.nome : null,
pA dmin    : isOwner || (isGroupAdmin  & & !!vip?.admin),
pBan      : isOwner || (isGroupAdmin  & & !!vip?.ban),
pPromote  : isOwner || (isGroupAdmin  & & !!vip?.promote),
pAnti     : isOwner || (isGroupAdmin  & & !!vip?.anti),
pRules    : isOwner || (isGroupAdmin  & & !!vip?.rules),
pBemv     : isOwner || (isGroupAdmin  & & !!vip?.boasvindas),
pSticker  : isOwner || (isGroupAdmin  & & !!vip?.sticker),
pTransacoes: isOwner || (isGroupAdmin  & & !!sub  & & (RANK_VIP[sub.nivel] || 0)  >= 2),
};
},
// ─── MENU COM BOTÕES (EXPERIMENTAL) ────────────────────────────────────
 'menubtn': async (sock, ctx) => {
     await enviarMenuComBotoes(sock, ctx.chatId, ctx.senderId);
 },
 // ─── MENU PRINCIPAL ───────────────────────────────────────────────────
 'menu': async (sock, ctx) => {
     const nome = ctx.senderId.split('@')[0];
     const p = await commands._getPerms(sock, ctx);
     const cats = [];
     cats.push(`  ╠ .cgeral  — 🌐 Geral`);
     if (p.pAdmin || p.pBan || p.pPromote) cats.push(`  ▸ .cadmin  — 👮 Administração`);
     if (p.pAnti || p.pRules || p.pBemv) cats.push(`  ╠▸ .cprot   — 🛡️ Proteção`);
     cats.push(`  ╠▸ .cmidia  — 📲 Mídia & Utilitários`);
     if (p.pSticker) cats.push(`  ╠ .cstick  — 🎨 Stickers`);
     if (p.isOwner) cats.push(`  ╠▸ .cdono   — 👑 Dono`);
     if (cats.length) cats[cats.length - 1] = cats[cats.length - 1].replace('▸', '╚▸');
     const nivelLinha = p.nivelNome ? `\n  ✦ Grupo: ${p.nivelNome}` : (ctx.isGroup ? '\n  ✦ Grupo sem assinatura' : '');
     const menu = `╔══════════════════════════════╗
    ◈  N A N O  B O T  🤖  ◈
    ✦ by ${CONFIG.creator} ✦
╚══════════════════════════════╝
👤 Olá, @${nome}!${nivelLinha}
⬡ ─── ESCOLHE UMA CATEGORIA ──── ⬡
(Use os comandos abaixo para ver os menus)
${cats.join('\n')}
◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈
✦ ${CONFIG.botName} | Prefixo: ${CONFIG.prefix}
📱 Suporte: ${CONFIG.ownerNumber}
◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
await sock.sendMessage(ctx.chatId, { text: menu, mentions: [ctx.senderId] });
},
'h': async (sock, ctx) => commands['menu'](sock, ctx),
'help': async (sock, ctx) => commands['menu'](sock, ctx),// ─── SUB-MENU: GERAL ─────────────────────────────────────────────────
'cgeral': async (sock, ctx) => {
    const corpo = `╔══════════════════════════════╗
   ◈  N A N O  B O T  🤖  ◈
╚══════════════════════════════╝
➤ 🌐  COMANDOS GERAIS
─────────────────────────────
╠▸ .menu
┃   └─ Abre o menu principal
╠▸ .help
┃   └─ Mostra os menus do bot
╠▸ .info
┃   └─ Informação e estado do bot
╠▸ .ping
┃   └─ Verifica a latência do bot
╠▸ .hora
   └─ Mostra a hora actual em Maputo
╠▸ .alug
┃   └─ Como alugar o bot para o teu grupo
╠▸ .stg
┃   └─ Ver o estado da assinatura do grupo
▸ .comandos
┃   └─ Lista os comandos disponíveis
╠▸ .indicar [número]
┃   └─ Regista uma indicação e ganha pontos
╠ .ranking
┃   └─ Top 10 de quem mais indicou
╚▸ .pontos
└─ Vê quantos pontos de indicação tens
◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✦ ← .menu para voltar atrás
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, {
        titulo: '🌐 Comandos Gerais',
        corpo,
        comandos: [
            { id: '.info', texto: 'ℹ️ Info' },
            { id: '.ping', texto: '📶 Ping' },
            { id: '.hora', texto: ' Hora' },
            { id: '.alug', texto: '💰 Alugar bot' },
            { id: '.stg', texto: ' Estado assinatura' },
            { id: '.comandos', texto: '📋 Comandos' },
            { id: '.ranking', texto: ' Ranking' },
            { id: '.pontos', texto: '🔢 Meus pontos' }
        ]
    });
},
// ── SUB-MENU: ADMINISTRAÇÃO ──────────────────────────────────────────
'cadmin': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAdmin && !p.pBan && !p.pPromote && !p.pTransacoes) throw new PermissaoNegada();
    let texto = `══════════════════════════════╗\n       ◈  N A N O  B O T  🤖  ◈\n╚══════════════════════════════╝\n\n  ➤ 👮  *ADMINISTRAÇÃO DO GRUPO*\n  ─────────────────────────────\n`;
    const botoes = [];
    if (p.pAdmin) {
        texto += `\n  ╠▸ .all [mensagem]\n  ┃   └─ Marca todos os membros do grupo\n\n  ╠▸ .close\n     └─ Fecha o grupo para admins\n\n  ╠▸ .open\n  ┃   └─ Abre o grupo para todos\n\n  ╠▸ .link\n  ┃   ─ Gera o link de convite\n\n  ▸ .tid\n  ┃   └─ Mostra o ID do grupo\n\n  ╠ .dlt\n  ┃   └─ Apaga a mensagem citada\n`;
        botoes.push({ id: '.close', texto: ' Fechar' }, { id: '.open', texto: '🔓 Abrir' }, { id: '.link', texto: '🔗 Link' }, { id: '.tid', texto: '🆔 ID grupo' });
    }
    if (p.pBan) {
        texto += `\n  ▸ .ban @pessoa\n  ┃   └─ Bane o utilizador do grupo\n\n  ╠▸ .kick @pessoa\n  ┃   └─ Expulsa sem banir\n\n  ╠▸ .listb\n  ┃   └─ Lista os utilizadores banidos\n`;
        botoes.push({ id: '.listb', texto: '📵 Banidos' });
    }
    if (p.pPromote) {
        texto += `\n  ╠▸ .up @pessoa\n  ┃   └─ Promove a administrador\n\n  ╠▸ .down @pessoa\n  ┃   └─ Remove de administrador\n`;
    }
    if (p.pTransacoes) {
        texto += `\n  ╠▸ .t on/off/status\n  ┃   └─ Activa/desactiva deteção de pagamentos (E-Mola/M-Pesa)\n\n  ╠▸ .tconta add/rm/list [número]\n  ┃   └─ Define quais contas de destino são aceites neste grupo\n\n  ╠▸ .act [nº]\n  ┃   └─ Aprova um pedido de pagamento\n\n  ╠ .rj [nº] [motivo]\n  ┃   └─ Rejeita um pedido de pagamento\n\n  ╠▸ .pend\n  ┃   └─ Lista pedidos pendentes\n\n  ╠▸ .hist @pessoa\n  ┃   └─ Histórico de transações do utilizador\n`;
        botoes.push({ id: '.pend', texto: '⏳ Pendentes' });
    }
    texto = texto.trimEnd().replace(/╠▸([^╠]*)$/, '╚▸$1');
    texto += `\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ✦ ← .menu para voltar atrás\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: '👮 Administração', corpo: texto, comandos: botoes });
},
// ─── SUB-MENU: PROTECÇÃO ──────────────────────────────────────────────
'cprot': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pAnti && !p.pRules && !p.pBemv) throw new PermissaoNegada();
    let texto = `╔══════════════════════════════╗\n       ◈  N A N O  B O T  🤖  ◈\n══════════════════════════════╝\n\n  ➤ 🛡️  *PROTECÇÃO & SEGURANÇA*\n  ─────────────────────────────\n`;
    const botoes = [];
    if (p.pAnti) {
        texto += `\n  ╠▸ .antil [modo/off]\n  ┃   └─ Anti-link: aviso | delete | ban\n\n  ▸ .auto [tempo|off]\n  ┃   └─ Auto-delete de mensagens\n\n  ╠▸ .banw [palavra]\n  ┃   └─ Bane automaticamente quem usar a palavra\n\n  ╠▸ .unbanw [palavra]\n  ┃   └─ Remove palavra da lista negra\n\n  ╠▸ .listw\n  ┃   └─ Lista todas as palavras banidas\n`;
        botoes.push({ id: '.listw', texto: '🚫 Palavras banidas' });
    }
    if (p.pRules) {
        texto += `\n  ╠▸ .rg [texto das regras]\n  ┃   ─ Define as regras do grupo\n\n  ╠▸ .vrg\n  ┃   └─ Mostra as regras definidas\n`;
        botoes.push({ id: '.vrg', texto: ' Ver regras' });
    }
    if (p.pAnti || p.pRules) texto += `\n  ╠▸ .ia on/off\n  ┃   └─ Activa/desactiva IA livre no grupo\n`;
    texto = texto.trimEnd().replace(/╠▸([^╠]*)$/, '╚▸$1');
    texto += `\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  ✦ ← .menu para voltar atrás\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: '🛡️ Proteção', corpo: texto, comandos: botoes });
},
// ─── SUB-MENU: MÍDIA E UTILITÁRIOS ───────────────────────────────────
'cmidia': async (sock, ctx) => {
    const corpo = `╔══════════════════════════════╗\n       ◈  N A N O  B O T  🤖  ◈\n╚══════════════════════════════╝\n\n   📲  *MÍDIA & UTILITÁRIOS*\n  ─────────────────────────────\n\n  ╠▸ .traduzir [texto]\n  ┃   └─ Traduz um texto para outro idioma\n\n  ▸ .tr [texto]\n  ┃   └─ Alias rápido para traduzir\n\n  ╚▸ .grcb [ouro/diamante/lenda] [dias] [número] [valor?]\n      └─ Gera comprovativo de pagamento (só dono)\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n  ✦ ← .menu para voltar atrás\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, { titulo: ' Mídia & Utilitários', corpo, comandos: [] });
},
// ─── SUB-MENU: STICKERS ───────────────────────────────────────────────
'cstick': async (sock, ctx) => {
    const p = await commands._getPerms(sock, ctx);
    if (!p.pSticker) throw new PermissaoNegada();
    const corpo = `╔══════════════════════════════╗\n       ◈  N A N O  B O T  🤖  \n╚══════════════════════════════╝\n\n  ➤ 🎨  *STICKERS*\n  ─────────────────────────────\n\n  ╠▸ .fig\n  ┃   └─ Converte imagem/vídeo em sticker\n\n  ╠▸ .stext [texto]\n  ┃   └─ Cria um sticker com texto\n\n  ╠ .stinfo\n  ┃   └─ Informações de um sticker\n\n  ╚▸ .sticker [texto]\n      └─ Cria sticker com texto (alias)\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n  ✦ ← .menu para voltar atrás\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, {
        titulo: '🎨 Stickers', corpo,
        comandos: [{ id: '.fig', texto: '️ Fig' }, { id: '.stinfo', texto: 'ℹ️ Info sticker' }]
    });
},
// ─── SUB-MENU: DONO ───────────────────────────────────────────────────
'cdono': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const corpo = `╔══════════════════════════════╗\n       ◈  N A N O  B O T  🤖  \n╚══════════════════════════════╝\n\n  ➤ 👑  *PAINEL DO DONO*\n  ─────────────────────────────\n\n  ╠▸ .ativ [nivel] [dias]\n  ┃   └─ Activa VIP num grupo\n  ┃      Níveis: ouro | diamante | lenda\n\n  ╠▸ .rmvip\n     └─ Remove a assinatura VIP do grupo\n\n  ╠▸ .lsg\n  ┃   └─ Lista todos os grupos com VIP activo\n\n  ╠▸ .bemv [texto/off]\n  ┃   └─ Define mensagem de boas-vindas\n\n  ╠▸ .at [nome] [texto]\n  ┃   └─ Cria atalho global de resposta rápida\n\n  ╠▸ .rmat [nome]\n  ┃   └─ Remove um atalho\n\n  ╠▸ .lsat\n  ┃   └─ Lista todos os atalhos criados\n\n  ╠▸ .stats\n  ┃   └─ Estatísticas gerais do bot\n\n  ╠▸ .relatorio\n  ┃   └─ Relatório completo de todos os grupos\n\n  ╠▸ .hisr\n  ┃   └─ Histórico de acções do grupo\n\n  ╠▸ .prefix [novo prefixo]\n  ┃   └─ Muda o prefixo dos comandos\n\n  ╠▸ .backup\n  ┃   └─ Faz backup dos dados\n\n  ▸ .restore\n  ┃   └─ Restaura os dados do backup\n\n  ╠▸ .l [hora] [texto]\n  ┃   └─ Cria lembrete pessoal\n\n  ╠▸ .ls\n  ┃   └─ Lista lembretes pendentes\n\n  ╠▸ .ap [número]\n  ┃   └─ Apaga um lembrete específico\n\n  ╠▸ .limpar\n  ┃   └─ Apaga todos os lembretes\n\n  ╠▸ .wrnvp all\n  ┃   └─ Avisa todos os grupos sobre o VIP\n\n  ╠ .offbot\n  ┃   └─ Desliga o bot neste grupo\n\n  ╠ .onbot\n  ┃   └─ Religa o bot neste grupo\n\n  ╠ .ignorar [@pessoa/número]\n  ┃   └─ O bot ignora essa pessoa\n\n  ╠▸ .designorar [@pessoa/número]\n  ┃   ─ Volta a responder a essa pessoa\n\n  ▸ .ignorados\n      └─ Lista quem está a ser ignorado\n\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n  ✦ ← .menu para voltar atrás\n◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈`;
    await enviarSubmenuBotoes(sock, ctx.chatId, {
        titulo: '👑 Painel do Dono', corpo,
        comandos: [
            { id: '.lsg', texto: '📋 Grupos VIP' },
            { id: '.stats', texto: '📊 Stats' },
            { id: '.relatorio', texto: '🧾 Relatório' },
            { id: '.hisr', texto: '📜 Histórico' },
            { id: '.lsat', texto: '⚡ Atalhos' },
            { id: '.ls', texto: '⏰ Lembretes' },
            { id: '.limpar', texto: '🗑️ Limpar lembretes' },
            { id: '.backup', texto: '💾 Backup' },
            { id: '.rmvip', texto: '❌ Remover VIP' },
            { id: '.offbot', texto: '🔴 Desligar bot aqui' },
            { id: '.onbot', texto: '🟢 Ligar bot aqui' },
            { id: '.ignorados', texto: '🔇 Ver ignorados' }
        ]
    });
},
// ─── COMANDOS GERAIS ─────────────────────────────────────────────────
'ping': async (sock, ctx) => {
    const inicio = Date.now();
    await sock.sendMessage(ctx.chatId, { text: ' *Pong!*' });
    const latencia = Date.now() - inicio;
    await sock.sendMessage(ctx.chatId, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n 🏓 *PING*\n┃\n┃ ⚡ Latência: ${latencia}ms\n┃ 🟢 Bot online\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
},
'hora': async (sock, ctx) => {
    const agora = new Date();
    const hora = agora.toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const data = agora.toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    await sock.sendMessage(ctx.chatId, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🕐 *HORA ACTUAL*\n┃\n┃ ⏰ ${hora}\n┃ 📅 ${data}\n┃ 🌍 Maputo (CAT)\n━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
},
'tid': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.sendMessage(ctx.chatId, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🆔 *ID DO CHAT*\n┃\n \`${ctx.chatId}\`\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
},
'info': async (sock, ctx) => {
    const totalVip = db.gruposVIP.size;
    const antiLinkAtivo = db.grupos.antiLink.size;
    const uptime = utils.tempoRestante(process.uptime() * 1000);
    await sock.sendMessage(ctx.chatId, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💚 *${CONFIG.botName}*\n┃ 👤 ${CONFIG.creator}\n┃ 📱 ${CONFIG.ownerNumber}\n┃ ⚡ Prefixo: ${CONFIG.prefix}\n┃ 🤖 Status:  Online\n┃ ⏱️ Uptime: ${uptime}\n┃\n┃ 📊 *SISTEMA*\n┃ ├─ VIPs activos: ${totalVip}\n┃ ├─ Anti-link: ${antiLinkAtivo > 0 ? `✅ ${antiLinkAtivo} grupos` : '❌ Inactivo'}\n ├─ IA activa: ${db.grupos.iaAtivo.size} grupos\n┃ └─ Palavras banidas: ${db.grupos.palavrasBanidas.size} grupos\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
},
'alug': async (sock, ctx) => {
    await sock.sendMessage(ctx.chatId, {
        text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💰 *ALUGUER DO BOT*\n┃\n┃ 📦 *Planos disponíveis:*\n┃ ├─ 🥇 Ouro - 7 dias\n┃ ├─ 💎 Diamante - 30 dias\n┃ └─  Lenda - 60 dias\n┃\n┃ 📞 Contacte:\n 👤 ${CONFIG.creator}\n┃  ${CONFIG.ownerNumber}\n┃\n 💚 ${CONFIG.botName}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
},
'stg': async (sock, ctx) => {
    const sub = db.gruposVIP.get(ctx.chatId);
    if (!sub || sub.expiraEm < Date.now()) {
        return sock.sendMessage(ctx.chatId, {
            text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *SEM ASSINATURA*\n┃\n┃ Grupo sem plano activo.\n┃ Contacte: ${CONFIG.creator}\n┃ 📱 ${CONFIG.ownerNumber}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
        });
    }
    const restante = Math.max(0, sub.expiraEm - Date.now());
    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const nivel = NIVEIS_VIP[sub.nivel];
    await sock.sendMessage(ctx.chatId, {
        text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💚 *STATUS DA ASSINATURA*\n┃\n┃ 💎 Nível: ${nivel.nome}\n┃ ⏳ Restante: ${d}d ${h}h\n┃\n 🔑 *Permissões:*\n┃ ├─ Ban: ${nivel.ban ? '✅' : '❌'}\n┃ ├─ Promover: ${nivel.promote ? '✅' : '❌'}\n┃ ├─ Regras: ${nivel.rules ? '✅' : ''}\n┃ ├─ Protecção: ${nivel.anti ? '✅' : '❌'}\n┃ ├─ Boas-vindas: ${nivel.boasvindas ? '✅' : '❌'}\n┃ └─ Stickers: ${nivel.sticker ? '✅' : '❌'}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
},
'auto': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const mode = ctx.args[0]?.toLowerCase();
    if (!mode) return sock.sendMessage(ctx.chatId, { text: 'Uso: .auto [tempo|off]. Exemplos: .auto 10s, .auto 5m, .auto off' });
    if (mode === 'off') { db.autoDelete.delete(ctx.chatId); salvarDados(); return sock.sendMessage(ctx.chatId, { text: '️ Auto-delete desativado' }); }
    const parse = (v) => {
        const m = v.match(/^(\d+)(s|m|h)?$/i);
        if (!m) return null; const n = parseInt(m[1],10); const u = (m[2]||'s').toLowerCase(); if (u==='s') return n*1000; if (u==='m') return n*60000; return n*3600000;
    };
    const ms = parse(mode);
    if (!ms) return sock.sendMessage(ctx.chatId, { text: 'Formato inválido. Ex: 10s, 5m, 1h' });
    db.autoDelete.set(ctx.chatId, ms); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `⏱️ Auto-delete ativado: mensagens serão apagadas após ${mode}` });
},
'indicar': async (sock, ctx) => {
    const numero = ctx.args[0];
    if (!numero) return sock.sendMessage(ctx.chatId, { text: 'Uso: .indicar [numero]' });
    const who = ctx.senderId;
    const cur = db.indicadores.get(who) || 0; db.indicadores.set(who, cur + 1); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `✅ Obrigado! Indicação registada. Pontos: ${cur+1}` });
},
'ranking': async (sock, ctx) => {
    const arr = [...db.indicadores.entries()];
    if (!arr.length) return sock.sendMessage(ctx.chatId, { text: 'Nenhuma indicação registada.' });
    arr.sort((a,b)=>b[1]-a[1]);
    const top = arr.slice(0,10).map((r,i)=>`${i+1}. @${r[0].split('@')[0]} — ${r[1]} pontos`).join('\n');
    await sock.sendMessage(ctx.chatId, { text: `🏆 Ranking de Indicadores:\n${top}`, mentions: arr.slice(0,10).map(r=>r[0]) });
},
'pontos': async (sock, ctx) => {
    const who = ctx.senderId;
    const pontos = db.indicadores.get(who) || 0;
    await sock.sendMessage(ctx.chatId, { text: `🔢 Tens ${pontos} pontos.` });
},
'traduzir': async (sock, ctx) => {
    const all = ctx.args.join(' ');
    if (!all) return sock.sendMessage(ctx.chatId, { text: 'Uso: .traduzir [texto] ou .traduzir [idioma] [texto]' });
    let target = 'pt';
    let text = all;
    const maybe = ctx.args[0]; if (maybe && maybe.length<=3 && ctx.args.length>1) { target = maybe; text = ctx.args.slice(1).join(' '); }
    try { const res = await translate(text, { to: target }); await sock.sendMessage(ctx.chatId, { text: `🌐 Tradução (${target}):\n${res}` }); } catch (e) { await sock.sendMessage(ctx.chatId, { text: 'Erro na tradução.' }); }
},
'tr': async (sock, ctx) => commands['traduzir'](sock, ctx),'close': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'announcement');
    registrarAcao(ctx.chatId, 'Grupo fechado');
    await sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔒 *GRUPO FECHADO*\n\n┃ Apenas admins podem enviar\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'open': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'not_announcement');
    registrarAcao(ctx.chatId, 'Grupo aberto');
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔓 *GRUPO ABERTO*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'up': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: `❌ Menciona o utilizador a promover.` });
    try {
        await sock.groupParticipantsUpdate(ctx.chatId, [target], 'promote');
        registrarAcao(ctx.chatId, `Promoção: @${target.split('@')[0]}`);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 👑 *PROMOVIDO*\n┃\n┃ @${target.split('@')[0]} agora é admin!\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [target] });
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao promover.` }); }
},
'down': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: `❌ Menciona o utilizador a rebaixar.` });
    try {
        await sock.groupParticipantsUpdate(ctx.chatId, [target], 'demote');
        registrarAcao(ctx.chatId, `Rebaixamento: @${target.split('@')[0]}`);
        await sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ⬇️ *REBAIXADO*\n\n┃ @${target.split('@')[0]} foi rebaixado\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [target] });
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao rebaixar.` }); }
},
'link': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    try {
        const code = await sock.groupInviteCode(ctx.chatId);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔗 *LINK DO GRUPO*\n┃\n┃ https://chat.whatsapp.com/${code}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao obter link.` }); }
},
'dlt': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo;
    if (!quoted?.stanzaId) return sock.sendMessage(ctx.chatId, { text: `❌ Responde à mensagem que queres apagar.` });
    try {
        await sock.sendMessage(ctx.chatId, { delete: { remoteJid: ctx.chatId, id: quoted.stanzaId, participant: quoted.participant } });
        await utils.reagir(sock, ctx.msg, '✅');
    } catch { await sock.sendMessage(ctx.chatId, { text: ` Não consegui apagar.` }); }
},
'rg': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasRulesRights(sock, ctx.chatId, ctx.senderId))) return;
    const regras = ctx.args.join(' ');
    if (!regras) return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .rg [regras do grupo]` });
    db.grupos.regras.set(ctx.chatId, regras); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *REGRAS ACTUALIZADAS*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'vrg': async (sock, ctx) => {
    const regras = db.grupos.regras.get(ctx.chatId);
    if (!regras) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhuma regra definida.\nUsa .rg [regras] para definir.' });
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📋 *REGRAS DO GRUPO*\n┃\n┃ ${regras.replace(/\n/g, '\n┃ ')}\n╰━━━━━━━━━━━━━━━━━━━━━━━` });
},
'antil': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const sub = ctx.args[0]?.toLowerCase();
    if (!sub) {
        return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💡 *ANTI-LINK*\n┃\n┃ .antil [modo]\n┃ • ban | kick | delete | warn | off\n┃ .antil add [dominio] → adiciona à whitelist\n┃ .antil remove [dominio] → remove da whitelist\n┃ .antil ls → lista whitelist\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    if (sub === 'off') {
        db.grupos.antiLink.delete(ctx.chatId); salvarDados();
        return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *ANTI-LINK OFF*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    if (sub === 'add') {
        const domain = ctx.args[1];
        if (!domain) return sock.sendMessage(ctx.chatId, { text: 'Uso: .antil add dominio.com' });
        const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (!db.whitelist.has(ctx.chatId)) db.whitelist.set(ctx.chatId, new Set());
        db.whitelist.get(ctx.chatId).add(host);
        salvarDados();
        return sock.sendMessage(ctx.chatId, { text: `✅ Dominio ${host} adicionado à whitelist.` });
    }
    if (sub === 'remove') {
        const domain = ctx.args[1];
        if (!domain) return sock.sendMessage(ctx.chatId, { text: 'Uso: .antil remove dominio.com' });
        const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        const set = db.whitelist.get(ctx.chatId);
        if (set && set.has(host)) { set.delete(host); salvarDados(); return sock.sendMessage(ctx.chatId, { text: `✅ Dominio ${host} removido da whitelist.` }); }
        return sock.sendMessage(ctx.chatId, { text: `⚠️ Dominio ${host} não estava na whitelist.` });
    }
    if (sub === 'ls' || sub === 'list') {
        const set = db.whitelist.get(ctx.chatId) || new Set();
        if (!set.size) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum dominio na whitelist deste grupo.' });
        return sock.sendMessage(ctx.chatId, { text: `Whitelist:\n${[...set].join('\n')}` });
    }
    if (['ban', 'kick', 'delete', 'warn'].includes(sub)) {
        db.grupos.antiLink.set(ctx.chatId, sub); salvarDados();
        const descModo = { ban: 'Banir', kick: 'Remover', delete: 'Apagar', warn: 'Avisar' };
        return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n 🔗 *ANTI-LINK ACTIVO*\n\n┃ Modo: ${descModo[sub]}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    return sock.sendMessage(ctx.chatId, { text: 'Uso inválido de .antil' });
},
'ia': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const acao = ctx.args[0]?.toLowerCase();
    if (acao === 'on') {
        db.grupos.iaAtivo.add(ctx.chatId); salvarDados();
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🤖 *IA ACTIVADA*\n┃\n┃ O bot responde a todos!\n╰━━━━━━━━━━━━━━━━━━━━━━━` });
    } else if (acao === 'off') {
        db.grupos.iaAtivo.delete(ctx.chatId); salvarDados();
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *IA DESACTIVADA*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    } else {
        const activa = db.grupos.iaAtivo.has(ctx.chatId);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🤖 *IA*\n┃\n┃ Estado: ${activa ? '✅ Activa' : '❌ Inactiva'}\n┃ Usa .ia on/off\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
},
'banw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .banw [palavra]` });
    if (!db.grupos.palavrasBanidas.has(ctx.chatId)) db.grupos.palavrasBanidas.set(ctx.chatId, []);
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId);
    if (lista.includes(palavra)) return sock.sendMessage(ctx.chatId, { text: `⚠️ Palavra "${palavra}" já está banida.` });
    lista.push(palavra); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *PALAVRA BANIDA*\n┃\n┃ "${palavra}"\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'unbanw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return;
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    const idx = lista.indexOf(palavra);
    if (idx === -1) return sock.sendMessage(ctx.chatId, { text: `⚠️ Palavra "${palavra}" não está na lista.` });
    lista.splice(idx, 1); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *PALAVRA REMOVIDA*\n┃\n "${palavra}"\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'listw': async (sock, ctx) => {
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    if (!lista.length) return sock.sendMessage(ctx.chatId, { text: ' Nenhuma palavra banida neste grupo.' });
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n 🚫 *PALAVRAS BANIDAS*\n┃\n┃ ${lista.join('\n┃ ')}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'listb': async (sock, ctx) => {
    const lista = db.grupos.banidos.get(ctx.chatId) || [];
    if (!lista.length) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum utilizador banido neste grupo.' });
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *UTILIZADORES BANIDOS*\n┃\n┃ ${lista.map(b => `@${b.id.split('@')[0]} - ${b.data}`).join('\n┃ ')}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: lista.map(b => b.id) });
},
'ban': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg);
    if (!target) { const mentions = utils.getMentions(ctx.msg); if (mentions.length) target = mentions[0]; }
    if (!target) return sock.sendMessage(ctx.chatId, { text: `❌ Menciona ou responde à mensagem do utilizador para banir.` });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: `❌ Não é possível banir o dono.` });
    try {
        await sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove');
        if (!db.grupos.banidos.has(ctx.chatId)) db.grupos.banidos.set(ctx.chatId, []);
        db.grupos.banidos.get(ctx.chatId).push({ id: target, data: new Date().toLocaleDateString('pt-PT') });
        salvarDados(); registrarAcao(ctx.chatId, `Ban: @${target.split('@')[0]}`);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *UTILIZADOR BANIDO*\n┃\n┃ @${target.split('@')[0]} foi banido!\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [target] });
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao banir. O bot precisa ser admin com permissões.` }); }
},
'kick': async (sock, ctx) => commands['ban'](sock, ctx),
'all': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const meta = await sock.groupMetadata(ctx.chatId);
    const mensagem = ctx.args.join(' ') || 'Atenção! Mensagem importante!';
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📢 *AVISO GERAL*\n┃\n┃ ${mensagem}\n━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: meta.participants.map(p => p.id) });
},
'sticker': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) {
        return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    }
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    try {
        const msg = ctx.msg;
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        let mediaMsg = quotedMsg ? { message: quotedMsg } : msg;
        let buffer;
        if (mediaMsg.message?.imageMessage) {
            buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
        } else if (mediaMsg.message?.videoMessage) {
            if (mediaMsg.message.videoMessage.seconds > 10) {
                return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ❌ *ERRO*\n┃\n┃ Máximo 10 segundos!\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
            }
            buffer = await downloadMediaMessage(mediaMsg, 'buffer', {});
        } else {
            return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ❌ *ERRO*\n\n┃ Envie imagem/vídeo com .fig\n┃ ou responda uma mídia\n━━━━━━━━━━━━━━━━━━━━━━━╯` });
        }
        buffer = await sharp(buffer).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90 }).toBuffer();
        buffer = await utils.adicionarMetadadosSticker(buffer, CONFIG.botName, CONFIG.creator);
        await sock.sendMessage(ctx.chatId, { sticker: buffer });
        await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) {
        console.error('Erro sticker:', e);
        await sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ❌ *ERRO AO CRIAR STICKER*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
},
'fig': async (sock, ctx) => commands['sticker'](sock, ctx),
'stext': async (sock, ctx) => {
    if (ctx.isGroup && !(await utils.hasStickerRights(sock, ctx.chatId, ctx.senderId))) {
        return sock.sendMessage(ctx.chatId, { text: utils.mensagemSemVIP() });
    }
    if (!ctx.isGroup && !utils.isOwner(ctx.senderId)) return;
    const texto = ctx.args.join(' ');
    if (!texto) return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ❌ *USO INCORRETO*\n┃\n┃ .stext [seu texto]\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    try {
        const buffer = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 128, g: 0, b: 128, alpha: 1 } } })
            .composite([{ input: Buffer.from(`<svg width="512" height="512"><style>text { fill: white; font-size: 40px; font-family: Arial, sans-serif; text-anchor: middle; dominant-baseline: central; font-weight: bold; }</style><text x="256" y="256">${texto.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text></svg>`), top: 0, left: 0 }])
            .webp({ quality: 90 }).toBuffer();
        const bufferComMetadados = await utils.adicionarMetadadosSticker(buffer, CONFIG.botName, CONFIG.creator);
        await sock.sendMessage(ctx.chatId, { sticker: bufferComMetadados });
        await utils.reagir(sock, ctx.msg, '✅');
    } catch (e) {
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ❌ *ERRO AO CRIAR*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
},
'stinfo': async (sock, ctx) => {
    const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg?.stickerMessage) {
        return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━\n┃ ❌ *ERRO*\n┃\n┃ Responde a um sticker\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    const s = quotedMsg.stickerMessage;
    await sock.sendMessage(ctx.chatId, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📋 *INFO DO STICKER*\n┃\n┃  Pacote: ${s.stickerPack || 'Desconhecido'}\n┃ ✏️ Autor: ${s.stickerAuthor || 'Desconhecido'}\n┃ 📛 Nome: ${s.stickerName || 'Desconhecido'}\n┃ 📏 Tamanho: ${s.fileLength ? (s.fileLength / 1024).toFixed(1) + ' KB' : 'N/A'}\n┃ 🎞️ Animado: ${s.isAnimated ? '✅' : '❌'}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
    });
},
'at': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const atalho = ctx.args[0]?.toLowerCase();
    const info = ctx.args.slice(1).join(' ');
    if (!atalho || !info) return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .at [nome] [texto]` });
    let grupoNome = 'PV (privado)';
    if (ctx.isGroup) {
        try { grupoNome = (await sock.groupMetadata(ctx.chatId)).subject; } catch { grupoNome = 'Grupo desconhecido'; }
    }
    db.atalhos.set(atalho, { texto: info, grupoId: ctx.chatId, grupoNome });
    salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *ATALHO CRIADO*\n┃\n┃ 🔗 ${atalho}\n┃ 📝 ${info}\n┃ 📍 ${grupoNome}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'rmat': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const atalho = ctx.args[0]?.toLowerCase();
    if (!atalho) return;
    if (db.atalhos.delete(atalho)) {
        salvarDados();
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *ATALHO REMOVIDO*\n┃\n┃ 🔗 ${atalho}\n━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
},
'lsat': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    if (!db.atalhos.size) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum atalho criado.' });
    let lista = "╭━━━━━━━━━━━━━━━━━━━━━━━╮\n 📋 *ATALHOS*\n┃\n";
    for (const [a, v] of db.atalhos) {
        if (typeof v === 'string') {
            lista += `┃ 🔹 *${a}* → ${v}\n┃    📍 grupo não registado (atalho antigo)\n┃\n`;
        } else {
            lista += `┃  *${a}* → ${v.texto}\n┃    📍 ${v.grupoNome}\n┃\n`;
        }
    }
    lista += "╰━━━━━━━━━━━━━━━━━━━━━━━╯";
    await sock.sendMessage(ctx.chatId, { text: lista });
},// ─── ADMIN COMMANDS ───────────────────────────────────────────────────
'bemv': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBoasvindasRights(sock, ctx.chatId, ctx.senderId))) return;
    const texto = ctx.args.join(' ');
    if (texto === 'off') {
        db.grupos.boasvindas.delete(ctx.chatId); salvarDados();
        return sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔕 *BOAS-VINDAS OFF*\n━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    if (!texto) {
        return sock.sendMessage(ctx.chatId, {
            text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💡 *USO DAS BOAS-VINDAS*\n┃\n┃ .bemv [mensagem]\n┃ .bemv off → desactivar\n┃\n┃ Variáveis:\n @nome → nome do utilizador\n┃ @grupo → nome do grupo\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
        });
    }
    db.grupos.boasvindas.set(ctx.chatId, texto); salvarDados();
    await sock.sendMessage(ctx.chatId, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *BOAS-VINDAS*\n┃\n┃ Configuradas com sucesso!\n┃ Pré-visualização:\n┃ ${texto.replace(/@nome/g, '@' + ctx.senderId.split('@')[0]).replace(/@grupo/g, 'Grupo')}\n━━━━━━━━━━━━━━━━━━━━━━━╯`,
        mentions: [ctx.senderId]
    });
},
'ban': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasBanRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg);
    if (!target) { const mentions = utils.getMentions(ctx.msg); if (mentions.length) target = mentions[0]; }
    if (!target) return sock.sendMessage(ctx.chatId, { text: `❌ Menciona ou responde à mensagem do utilizador para banir.` });
    if (utils.isOwner(target)) return sock.sendMessage(ctx.chatId, { text: `❌ Não é possível banir o dono.` });
    try {
        await sock.groupParticipantsUpdate(ctx.chatId, [target], 'remove');
        if (!db.grupos.banidos.has(ctx.chatId)) db.grupos.banidos.set(ctx.chatId, []);
        db.grupos.banidos.get(ctx.chatId).push({ id: target, data: new Date().toLocaleDateString('pt-PT') });
        salvarDados(); registrarAcao(ctx.chatId, `Ban: @${target.split('@')[0]}`);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *UTILIZADOR BANIDO*\n┃\n┃ @${target.split('@')[0]} foi banido!\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [target] });
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao banir. O bot precisa ser admin com permissões.` }); }
},
'kick': async (sock, ctx) => commands['ban'](sock, ctx),
'all': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const meta = await sock.groupMetadata(ctx.chatId);
    const mensagem = ctx.args.join(' ') || 'Atenção! Mensagem importante!';
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📢 *AVISO GERAL*\n┃\n┃ ${mensagem}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: meta.participants.map(p => p.id) });
},
'close': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'announcement');
    registrarAcao(ctx.chatId, 'Grupo fechado');
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *GRUPO FECHADO*\n┃\n┃ Apenas admins podem enviar\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'open': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    await sock.groupSettingUpdate(ctx.chatId, 'not_announcement');
    registrarAcao(ctx.chatId, 'Grupo aberto');
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔓 *GRUPO ABERTO*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'up': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: `❌ Menciona o utilizador a promover.` });
    try {
        await sock.groupParticipantsUpdate(ctx.chatId, [target], 'promote');
        registrarAcao(ctx.chatId, `Promoção: @${target.split('@')[0]}`);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n 👑 *PROMOVIDO*\n\n┃ @${target.split('@')[0]} agora é admin!\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [target] });
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao promover.` }); }
},
'down': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasPromoteRights(sock, ctx.chatId, ctx.senderId))) return;
    let target = utils.getQuotedMention(ctx.msg) || utils.getMentions(ctx.msg)[0];
    if (!target) return sock.sendMessage(ctx.chatId, { text: ` Menciona o utilizador a rebaixar.` });
    try {
        await sock.groupParticipantsUpdate(ctx.chatId, [target], 'demote');
        registrarAcao(ctx.chatId, `Rebaixamento: @${target.split('@')[0]}`);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ⬇️ *REBAIXADO*\n┃\n┃ @${target.split('@')[0]} foi rebaixado\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [target] });
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Erro ao rebaixar.` }); }
},
'link': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    try {
        const code = await sock.groupInviteCode(ctx.chatId);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔗 *LINK DO GRUPO*\n┃\n┃ https://chat.whatsapp.com/${code}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    } catch { await sock.sendMessage(ctx.chatId, { text: ` Erro ao obter link.` }); }
},
'dlt': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasGroupAdminRights(sock, ctx.chatId, ctx.senderId))) return;
    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo;
    if (!quoted?.stanzaId) return sock.sendMessage(ctx.chatId, { text: `❌ Responde à mensagem que queres apagar.` });
    try {
        await sock.sendMessage(ctx.chatId, { delete: { remoteJid: ctx.chatId, id: quoted.stanzaId, participant: quoted.participant } });
        await utils.reagir(sock, ctx.msg, '✅');
    } catch { await sock.sendMessage(ctx.chatId, { text: `❌ Não consegui apagar.` }); }
},
'rg': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasRulesRights(sock, ctx.chatId, ctx.senderId))) return;
    const regras = ctx.args.join(' ');
    if (!regras) return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .rg [regras do grupo]` });
    db.grupos.regras.set(ctx.chatId, regras); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *REGRAS ACTUALIZADAS*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'vrg': async (sock, ctx) => {
    const regras = db.grupos.regras.get(ctx.chatId);
    if (!regras) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhuma regra definida.\nUsa .rg [regras] para definir.' });
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 📋 *REGRAS DO GRUPO*\n┃\n┃ ${regras.replace(/\n/g, '\n┃ ')}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'antil': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const sub = ctx.args[0]?.toLowerCase();
    if (!sub) {
        return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 💡 *ANTI-LINK*\n┃\n┃ .antil [modo]\n┃ • ban | kick | delete | warn | off\n┃ .antil add [dominio] → adiciona à whitelist\n┃ .antil remove [dominio] → remove da whitelist\n┃ .antil ls → lista whitelist\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    if (sub === 'off') {
        db.grupos.antiLink.delete(ctx.chatId); salvarDados();
        return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔗 *ANTI-LINK OFF*\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
    if (sub === 'add') {
        const domain = ctx.args[1];
        if (!domain) return sock.sendMessage(ctx.chatId, { text: 'Uso: .antil add dominio.com' });
        const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (!db.whitelist.has(ctx.chatId)) db.whitelist.set(ctx.chatId, new Set());
        db.whitelist.get(ctx.chatId).add(host);
        salvarDados();
        return sock.sendMessage(ctx.chatId, { text: `✅ Dominio ${host} adicionado à whitelist.` });
    }
    if (sub === 'remove') {
        const domain = ctx.args[1];
        if (!domain) return sock.sendMessage(ctx.chatId, { text: 'Uso: .antil remove dominio.com' });
        const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        const set = db.whitelist.get(ctx.chatId);
        if (set && set.has(host)) { set.delete(host); salvarDados(); return sock.sendMessage(ctx.chatId, { text: `✅ Dominio ${host} removido da whitelist.` }); }
        return sock.sendMessage(ctx.chatId, { text: `⚠️ Dominio ${host} não estava na whitelist.` });
    }
    if (sub === 'ls' || sub === 'list') {
        const set = db.whitelist.get(ctx.chatId) || new Set();
        if (!set.size) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhum dominio na whitelist deste grupo.' });
        return sock.sendMessage(ctx.chatId, { text: `Whitelist:\n${[...set].join('\n')}` });
    }
    if (['ban', 'kick', 'delete', 'warn'].includes(sub)) {
        db.grupos.antiLink.set(ctx.chatId, sub); salvarDados();
        const descModo = { ban: 'Banir', kick: 'Remover', delete: 'Apagar', warn: 'Avisar' };
        return sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔗 *ANTI-LINK ACTIVO*\n┃\n┃ Modo: ${descModo[sub]}\n╰━━━━━━━━━━━━━━━━━━━━━━━` });
    }
    return sock.sendMessage(ctx.chatId, { text: 'Uso inválido de .antil' });
},
'ia': async (sock, ctx) => {
    if (!utils.isOwner(ctx.senderId)) throw new PermissaoNegada();
    const acao = ctx.args[0]?.toLowerCase();
    if (acao === 'on') {
        db.grupos.iaAtivo.add(ctx.chatId); salvarDados();
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🤖 *IA ACTIVADA*\n┃\n┃ O bot responde a todos!\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
    } else if (acao === 'off') {
        db.grupos.iaAtivo.delete(ctx.chatId); salvarDados();
        await sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🤖 *IA DESACTIVADA*\n━━━━━━━━━━━━━━━━━━━━━━━╯` });
    } else {
        const activa = db.grupos.iaAtivo.has(ctx.chatId);
        await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃  *IA*\n┃\n┃ Estado: ${activa ? '✅ Activa' : '❌ Inactiva'}\n┃ Usa .ia on/off\n╰━━━━━━━━━━━━━━━━━━━━━━━` });
    }
},
'banw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return sock.sendMessage(ctx.chatId, { text: `❌ Uso: .banw [palavra]` });
    if (!db.grupos.palavrasBanidas.has(ctx.chatId)) db.grupos.palavrasBanidas.set(ctx.chatId, []);
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId);
    if (lista.includes(palavra)) return sock.sendMessage(ctx.chatId, { text: `⚠️ Palavra "${palavra}" já está banida.` });
    lista.push(palavra); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *PALAVRA BANIDA*\n\n┃ "${palavra}"\n━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'unbanw': async (sock, ctx) => {
    if (!ctx.isGroup || !(await utils.hasAntiRights(sock, ctx.chatId, ctx.senderId))) return;
    const palavra = ctx.args.join(' ').toLowerCase().trim();
    if (!palavra) return;
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    const idx = lista.indexOf(palavra);
    if (idx === -1) return sock.sendMessage(ctx.chatId, { text: `⚠️ Palavra "${palavra}" não está na lista.` });
    lista.splice(idx, 1); salvarDados();
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ✅ *PALAVRA REMOVIDA*\n┃\n┃ "${palavra}"\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'listw': async (sock, ctx) => {
    const lista = db.grupos.palavrasBanidas.get(ctx.chatId) || [];
    if (!lista.length) return sock.sendMessage(ctx.chatId, { text: '📝 Nenhuma palavra banida neste grupo.' });
    await sock.sendMessage(ctx.chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *PALAVRAS BANIDAS*\n┃\n┃ ${lista.join('\n┃ ')}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯` });
},
'listb': async (sock, ctx) => {
    const lista = db.grupos.banidos.get(ctx.chatId) || [];
    if (!lista.length) return sock.sendMessage(ctx.chatId, { text: ' Nenhum utilizador banido neste grupo.' });
    await sock.sendMessage(ctx.chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *UTILIZADORES BANIDOS*\n\n┃ ${lista.map(b => `@${b.id.split('@')[0]} - ${b.data}`).join('\n┃ ')}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: lista.map(b => b.id) });
}
};

// =================== MODERAÇÃO AUTOMÁTICA ===================
async function executarAntiLink(sock, chatId, msg, senderId, modo) {
    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
    if (modo === 'warn') {
        await sock.sendMessage(chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ ⚠️ *AVISO: LINK DETECTADO*\n┃\n┃ @${senderId.split('@')[0]}, links não são permitidos!\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [senderId] });
    } else if (modo === 'delete') {
        await sock.sendMessage(chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🔗 *LINK REMOVIDO*\n┃\n @${senderId.split('@')[0]}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [senderId] });
    } else if (modo === 'kick' || modo === 'ban') {
        try {
            await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
            registrarAcao(chatId, `Anti-link (${modo}): @${senderId.split('@')[0]}`);
            await sock.sendMessage(chatId, { text: `━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *REMOVIDO POR LINK*\n┃\n┃ @${senderId.split('@')[0]}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [senderId] });
        } catch {
            await sock.sendMessage(chatId, { text: `⚠️ Não consegui remover @${senderId.split('@')[0]}.`, mentions: [senderId] });
        }
    }
}

// =================== INICIALIZAÇÃO DO BOT ===================
let reconnectAttempts = 0;

// =================== CONTROLO MANUAL VIA TERMINAL ===================
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
        console.log('🛑 PARADO — mensagens em espera foram canceladas. Digita "continuar" para retomar.');
    } else if (cmd === 'continuar' || cmd === '.continuar') {
        pausado = false;
        console.log('▶️ RETOMADO — o bot volta a processar mensagens normalmente.');
    } else if (cmd === 'reiniciar' || cmd === '.reiniciar') {
        mensagensIgnoradas = new Set(ultimasMensagensIds);
        console.log(`🔄 A reiniciar a ligação — as últimas ${ultimasMensagensIds.length} mensagens serão ignoradas.`);
        try { sockAtual?.end(new Error('Reinício manual via terminal')); } catch (e) { console.error('Erro ao reiniciar:', e.message); }
    } else if (cmd === 'status' || cmd === '.statuscmd') {
        console.log(`Estado actual: ${pausado ? '🛑 PAUSADO' : '✅ ATIVO'} | Geração: ${geracaoAtual}`);
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
        
        setInterval(async () => {
            try {
                const agora = Date.now();
                const prontos = db.lembretes.filter(l => l.dataHora <= agora);
                if (!prontos.length) return;
                db.lembretes = db.lembretes.filter(l => l.dataHora > agora);
                salvarDados();
                for (const l of prontos) {
                    try { await sock.sendMessage(`${CONFIG.ownerId}@s.whatsapp.net`, { text: ` *LEMBRETE*\n\n ${l.texto}` }); } catch (e) { console.error('Erro ao enviar lembrete:', e.message); }
                }
            } catch (e) { console.error('Erro no verificador de lembretes:', e.message); }
        }, 60000);

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
            const botJid = sock.user.id;
            if (action === 'add') {
                const boasVindasMsg = db.grupos.boasvindas.get(groupId);
                if (boasVindasMsg) {
                    try {
                        const metadata = await sock.groupMetadata(groupId);
                        for (const participant of participants) {
                            if (participant !== botJid) {
                                const nome = `@${participant.split('@')[0]}`;
                                const textoFinal = boasVindasMsg.replace(/@nome/g, nome).replace(/@grupo/g, metadata.subject);
                                await sock.sendMessage(groupId, { text: textoFinal, mentions: [participant] });
                            }
                        }
                    } catch {}
                }
                if (participants.includes(botJid)) {
                    if (!utils.isGroupSubscribed(groupId)) {
                        await sock.sendMessage(groupId, { text: ` Este grupo não possui assinatura activa.\n Contacte ${CONFIG.creator}: ${CONFIG.ownerNumber}` });
                        setTimeout(() => sock.groupLeave(groupId), 3000);
                    }
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return;
                if (pausado) return;
                const minhaGeracao = geracaoAtual;
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;
                if (msg.key.id && mensagensIgnoradas.has(msg.key.id)) {
                    mensagensIgnoradas.delete(msg.key.id);
                    return;
                }
                const chatId = msg.key.remoteJid;
                if (chatId === 'status@broadcast' || chatId?.endsWith('@broadcast')) return;
                const msgTime = msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now();
                if (Date.now() - msgTime > 60000) return;
                const isGroup = chatId.endsWith('@g.us');
                const senderId = isGroup ? msg.key.participant : chatId;
                const fullText = utils.extractText(msg);
                if (msg.key.id) {
                    ultimasMensagensIds.push(msg.key.id);
                    if (ultimasMensagensIds.length > 4) ultimasMensagensIds.shift();
                }
                if (!isGroup) console.log(`📩 Privado de ${senderId.split('@')[0]}: "${fullText}"`);
                try { await sock.readMessages([msg.key]); } catch {}
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 2000)));
                if (pausado || minhaGeracao !== geracaoAtual) return;
                if (db.ignorados.has(senderId) && !utils.isOwner(senderId)) return;
                if (isGroup && db.grupos.desligados.has(chatId) && !utils.isOwner(senderId)) return;
                if (!isGroup && !utils.isOwner(senderId)) {
                    const ultimoEnvio = db.ultimoCartaoPV.get(senderId) || 0;
                    if (Date.now() - ultimoEnvio < 10 * 60 * 1000) return;
                    db.ultimoCartaoPV.set(senderId, Date.now());
                    await sock.sendMessage(chatId, { text: gerarCartaoApresentacao() });
                    return;
                }
                try {
                    if (isGroup && db.autoDelete.has(chatId)) {
                        const ms = db.autoDelete.get(chatId);
                        setTimeout(async () => {
                            try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {};
                        }, ms);
                    }
                } catch (e) { console.warn('autoDelete schedule failed', e.message); }
                if (isGroup) await utils.checkGroupExpired(sock, chatId);
                if (isGroup && fullText) {
                    const isAdmin = await utils.isSenderGroupAdmin(sock, chatId, senderId);
                    const isOwner = utils.isOwner(senderId);
                    const dadosTransacoes = db.grupos.transacoes.get(chatId);
                    if (dadosTransacoes?.ativo) {
                        const comprovativo = detectarComprovativo(fullText);
                        if (comprovativo) {
                            const contasConfiguradas = dadosTransacoes.contas || [];
                            const contaValida = !contasConfiguradas.length || contasConfiguradas.includes(comprovativo.contaDestino);
                            if (!contaValida) {
                                console.log(`Comprovativo ignorado (conta ${comprovativo.contaDestino} não está na whitelist do grupo ${chatId})`);
                            } else {
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
                                    const metadata = await sock.groupMetadata(chatId);
                                    const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
                                    const destinatarios = new Set([...admins, `${CONFIG.ownerId}@s.whatsapp.net`]);
                                    for (const adminId of destinatarios) {
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
                    if (!isAdmin && !isOwner) {
                        const antiLinkMode = db.grupos.antiLink.get(chatId);
                        if (antiLinkMode) {
                            const urlRegex = /(https?:\/\/[^\s]+)/g;
                            const links = [...(fullText.match(urlRegex) || [])];
                            const hasLink = links.length > 0 || /wa\.me\//.test(fullText) || /chat\.whatsapp\.com/.test(fullText);
                            if (hasLink) {
                                let ignore = false;
                                const whitelist = db.whitelist.get(chatId) || new Set();
                                for (const link of links) {
                                    try {
                                        const u = new URL(link.startsWith('http') ? link : 'http://' + link);
                                        const host = u.hostname.replace(/^www\./, '');
                                        if (whitelist.has(host)) { ignore = true; break; }
                                    } catch {}
                                }
                                if (!ignore) { await executarAntiLink(sock, chatId, msg, senderId, antiLinkMode); return; }
                            }
                        }
                        const palavrasBanidas = db.grupos.palavrasBanidas.get(chatId) || [];
                        for (const palavra of palavrasBanidas) {
                            if (fullText.toLowerCase().includes(palavra)) {
                                try { await sock.sendMessage(chatId, { delete: msg.key }); } catch {}
                                await sock.sendMessage(chatId, { text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n┃ 🚫 *PALAVRA PROIBIDA*\n┃\n @${senderId.split('@')[0]}\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`, mentions: [senderId] });
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
                                    await sock.sendMessage(chatId, { text: `⏳ Calma! Já abriste o menu ${MENU_LIMITE_MAX}x nos últimos 3 minutos.\nAguarda ${tempo} para abrir de novo.` });
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
                                await sock.sendMessage(chatId, { text: `⏳ Calma! Já falaste comigo ${CHAT_LIMITE_MAX}x nos últimos 5 minutos.\nAguarda ${tempo} para falar de novo.` });
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
                                await sock.sendMessage(chatId, { text: `⏳ Calma! Já falaste comigo ${CHAT_LIMITE_MAX}x nos últimos 5 minutos.\nAguarda ${tempo} para falar de novo.`, quoted: msg });
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
                if (!isGroup && fullText && !fullText.startsWith(CONFIG.prefix)) {
                    if (utils.isOwner(senderId) && pareceIntentoRelatorio(fullText)) { await enviarRelatorioCompleto(sock, chatId); return; }
                    const resposta = await askGroq(chatId, fullText, utils.isOwner(senderId), false);
                    if (resposta) await sock.sendMessage(chatId, { text: `💚 ${resposta}` });
                    return;
                }
                if (fullText?.startsWith(CONFIG.prefix)) {
                    const args = fullText.slice(CONFIG.prefix.length).trim().split(/ +/);
                    const cmd = args.shift()?.toLowerCase();
                    if (cmd && commands[cmd]) {
                        if (MENU_COMANDOS.has(cmd)) {
                            const limiteMenu = verificarLimiteMenu(senderId, cmd);
                            if (!limiteMenu.permitido) {
                                const seg = Math.ceil(limiteMenu.esperarMs / 1000);
                                const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
                                return await sock.sendMessage(chatId, { text: ` Calma! Já abriste o menu ${MENU_LIMITE_MAX}x nos últimos 3 minutos.\nAguarda ${tempo} para abrir de novo.` });
                            }
                        }
                        const rl = verificarRateLimit(senderId, cmd);
                        if (!rl.permitido) {
                            const seg = Math.ceil(rl.esperarMs / 1000);
                            const tempo = seg > 60 ? `${Math.ceil(seg / 60)} min` : `${seg}s`;
                            return await sock.sendMessage(chatId, { text: ` Calma! Já usaste *.${cmd}* ${RATE_LIMIT_MAX}x nos últimos 3 minutos.\nAguarda ${tempo} para usar de novo.` });
                        }
                        try { const cur = db.stats.get(cmd) || 0; db.stats.set(cmd, cur + 1); salvarDados(); } catch {}
                        try {
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
        console.error(' Erro ao iniciar:', err);
        reconnectAttempts++;
        const delay = Math.min(10000 * reconnectAttempts, 60000);
        setTimeout(startBot, delay);
    }
}

if (!process.env.GROQ_API_KEY) {
    console.warn('⚠️  GROQ_API_KEY não está definida no .env — os comandos de IA vão falhar até isto ser corrigido.');
}
console.log(`🚀 Iniciando ${CONFIG.botName}...`);
console.log(`👤 Criado por: ${CONFIG.creator}`);
startBot().catch(console.error);

module.exports = { CONFIG, db, commands, utils, startBot };
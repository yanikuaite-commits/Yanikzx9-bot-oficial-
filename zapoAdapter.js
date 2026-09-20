const { createStore, ConsoleLogger, WaClient } = require('zapo-js');
const { createSqliteStore } = require('@zapo-js/store-sqlite');
const fs = require('fs');
const path = require('path');

const providers = {
  auth: 'sqlite', signal: 'sqlite', preKey: 'sqlite', session: 'sqlite',
  identity: 'sqlite', senderKey: 'sqlite', appState: 'sqlite',
  privacyToken: 'sqlite', messages: 'sqlite', threads: 'sqlite', contacts: 'sqlite'
};

function createZapoSocket({ authPath, sessionId = 'kortex', pairingNumber }) {
  if (!authPath) throw new Error('authPath e obrigatorio para a sessao Zapo');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const normalizedPairingNumber = String(pairingNumber || '').replace(/\D/g, '');

  const store = createStore({
    backends: { sqlite: createSqliteStore({ path: authPath, driver: 'auto' }) },
    providers
  });
  const client = new WaClient({ store, sessionId, markOnlineOnConnect: true }, new ConsoleLogger('error'));
  const incoming = new WeakMap();
  const sentIds = new Set();

  function normalize(event) {
    const remoteJid = event.chatJid || event.key?.remoteJid;
    const participant = event.participantJid || event.key?.participant || remoteJid;
    const msg = {
      key: { remoteJid, participant, id: event.stanzaId || event.key?.id, fromMe: Boolean(event.fromMe || event.key?.fromMe) },
      message: event.message,
      pushName: event.pushName || event.senderName,
      messageTimestamp: event.messageTimestampMs ? Math.floor(event.messageTimestampMs / 1000) : undefined
    };
    incoming.set(msg, event);
    return msg;
  }

  async function sendMessage(chatId, content, options = {}) {
    let payload;
    if (typeof content === 'string') payload = content;
    else if (content?.react) payload = { type: 'reaction', emoji: content.react.text || '', target: content.react.key };
    else if (content?.delete) payload = { type: 'protocol', protocolType: 'revoke', key: content.delete };
    else if (content?.text !== undefined) {
      payload = { type: 'text', text: content.text };
      if (content.mentions?.length) payload.contextInfo = { mentionedJid: content.mentions };
    } else {
      const type = ['image', 'video', 'audio', 'document', 'sticker'].find((kind) => content?.[kind]);
      if (!type) throw new Error(`Unsupported message content: ${Object.keys(content || {}).join(', ')}`);
      const media = content[type];
      payload = { type, media: Buffer.isBuffer(media) || media instanceof Uint8Array ? media : media.url || media, mimetype: content.mimetype, fileName: content.fileName, caption: content.caption, ptt: content.ptt };
    }
    const result = await client.message.send(chatId, payload, options.quoted ? { quoted: options.quoted } : undefined);
    if (result?.id) sentIds.add(result.id);
    return { key: { id: result?.id, remoteJid: chatId, fromMe: true } };
  }

  const socket = {
    client,
    get user() {
      const credentials = client.auth.getCurrentCredentials();
      return credentials?.meJid ? { id: credentials.meJid } : undefined;
    },
    sendMessage,
    groupMetadata: (groupId) => client.group.queryGroupMetadata(groupId),
    groupSettingUpdate: (groupId, setting) => client.group.setSetting(groupId, setting, true),
    groupInviteCode: (groupId) => client.group.queryInviteCode(groupId),
    groupParticipantsUpdate: (groupId, participants, action) => {
      const methods = { add: 'addParticipants', remove: 'removeParticipants', promote: 'promoteParticipants', demote: 'demoteParticipants' };
      const method = methods[action];
      if (!method) throw new Error(`Unsupported group action: ${action}`);
      return client.group[method](groupId, participants);
    },
    groupUpdateSubject: (groupId, subject) => client.group.setSubject(groupId, subject),
    groupLeave: (groupId) => client.group.leaveGroup([groupId]),
    groupCreate: (subject, participants) => client.group.createGroup(subject, participants),
    updateProfilePicture: (jid, bytes) => client.profile.setProfilePicture(bytes, jid),
    downloadMediaMessage: (message) => {
      const event = incoming.get(message);
      if (!event) throw new Error('Media message is not attached to a Zapo event');
      return client.message.downloadBytes(event);
    },
    wasSentByBot: (id) => sentIds.has(id),
    on: (event, handler) => client.on(event, handler),
    once: (event, handler) => client.once(event, handler),
    connect: () => client.connect(),
    disconnect: () => client.disconnect()
  };

  // ✅ FIXADO: Armazena código de pareamento para acesso via HTTP
  client.on('auth_pairing_required', async () => {
    if (!normalizedPairingNumber) {
      console.error('❌ Numero de pairing code ausente ou invalido.');
      return;
    }
    try {
      const code = await client.auth.requestPairingCode(normalizedPairingNumber);
      
      // ✅ NOVO: Armazena globalmente para endpoint HTTP acessar
      global.codigoPareamentoAtual = code;
      
      console.log(`\n📲 ╔════════════════════════════════════╗`);
      console.log(`   ║  CÓDIGO DE EMPARELHAMENTO         ║`);
      console.log(`   ║                                    ║`);
      console.log(`   ║        ${code}               ║`);
      console.log(`   ║                                    ║`);
      console.log(`   ║  WhatsApp > Dispositivos ligados  ║`);
      console.log(`   ║         > Ligar dispositivo       ║`);
      console.log(`   ╚════════════════════════════════════╝\n`);
      
      console.log('🌐 Ou acessa via HTTP: /pairing ou /pairing-dashboard');
      console.log('No WhatsApp, abra Dispositivos ligados > Ligar dispositivo > Ligar com numero de telefone.');
    } catch (error) {
      console.error('❌ Nao foi possivel gerar o codigo de emparelhamento:', error.message);
    }
  });
  
  client.on('message', (event) => socket.onMessage?.(normalize(event), event));
  return socket;
}

module.exports = { createZapoSocket };

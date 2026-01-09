const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    // FUNÇÃO DE BOAS-VINDAS
    sock.ev.on('group-participants.update', async (anu) => {
        if (anu.action === 'add') {
            const chatId = anu.id;
            const newMember = anu.participants[0];
            const welcomeText = `👋 Olá @${newMember.split('@')[0]}! Bem-vindo à *Yanikzx9 Store*! 💎\n\nAqui podes comprar Dimas de forma rápida e segura.\n\n🌐 *Site:* https://yanikzx9.vercel.app\n📞 *Suporte:* wa.me/258840474014\n\nLê as regras na descrição e bons jogos! 🎮`;
            
            await sock.sendMessage(chatId, { text: welcomeText, mentions: [newMember] });
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const chatId = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        
        // TEU NÚMERO DE ADMIN
        const MEU_NUMERO = '258840474014@s.whatsapp.net';

        // COMANDOS PÚBLICOS
        if (text === '!site') {
            await sock.sendMessage(chatId, { text: '💎 *Yanikzx9 Store*\nhttps://yanikzx9.vercel.app' });
        }
        if (text === '!dono') {
            await sock.sendMessage(chatId, { text: '📞 Suporte Yanikzx9: wa.me/258840474014' });
        }

        // COMANDOS PRIVADOS (SÓ TU USAS)
        if (sender === MEU_NUMERO) {
            if (text === '!fechar') {
                await sock.groupSettingUpdate(chatId, 'announcement');
                await sock.sendMessage(chatId, { text: '🔒 Grupo fechado!' });
            }
            if (text === '!abrir') {
                await sock.groupSettingUpdate(chatId, 'not_announcement');
                await sock.sendMessage(chatId, { text: '🔓 Grupo aberto!' });
            }
            if (text.startsWith('!ban')) {
                const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid[0];
                if (mentioned) await sock.groupParticipantsUpdate(chatId, [mentioned], "remove");
            }
        }
    });
}
startBot();

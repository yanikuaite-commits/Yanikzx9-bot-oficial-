# Kortex ⚡ — WhatsApp Bot

Bot de WhatsApp construído sobre **Baileys**, criado por **Yanik Uaite**.

## Requisitos

- **Node.js 18+**
- **ffmpeg** — não precisas de instalar nada manualmente: o pacote `ffmpeg-static`
  já traz o binário e o bot configura o caminho automaticamente no arranque.

## Instalação

```bash
# 1. Descompactar o ZIP
unzip kortex-bot.zip
cd kortex-bot

# 2. Instalar dependências
npm install

# 3. Arrancar o bot
npm start
```

## Emparelhamento (pairing code)

No primeiro arranque, o bot **não usa QR code** — ele pede o teu número de
WhatsApp diretamente no terminal e gera um **código de emparelhamento**.

1. Corre `npm start`.
2. Segue a instrução apresentada no terminal e introduz o teu número.
3. No telemóvel: **WhatsApp → Definições → Dispositivos ligados → Ligar
   dispositivo → Ligar com número de telefone** e introduz o código
   apresentado no terminal.
4. Assim que emparelhado, a sessão fica guardada automaticamente na pasta
   `sessao_kortex/` — nos arranques seguintes o bot liga-se sozinho, sem
   pedir o código novamente (a menos que apagues essa pasta ou saias do
   dispositivo ligado no WhatsApp).

## Pasta `media/kortex/` — imagens dos menus

Esta pasta contém as artes oficiais usadas nos menus do bot. Os **nomes dos
ficheiros são fixos** (o `bot.js` refere-se a eles diretamente por caminho) —
não renomeies, apenas substitui o conteúdo se quiseres trocar alguma arte,
mantendo sempre o mesmo nome de ficheiro e o formato `.jpg`:

| Ficheiro                         | Menu                        |
|-----------------------------------|------------------------------|
| `principal.jpg`                   | Kortex • Núcleo (menu principal) |
| `geral.jpg`                       | Kortex • Geral               |
| `utilitarios.jpg`                 | Kortex • Utilitários          |
| `texto.jpg`                       | Kortex • Texto                |
| `informacao.jpg`                  | Kortex • Informação            |
| `diversao.jpg`                    | Kortex • Diversão             |
| `imagem.jpg`                      | Kortex • Imagem               |
| `midia.jpg`                       | Kortex • Mídia                |
| `stickers.jpg`                    | Kortex • Stickers             |
| `protecao.jpg`                    | Kortex • Proteção             |
| `administracao.jpg`               | Kortex • Administração        |
| `dono.jpg`                        | Kortex • Owner Core           |
| `games.jpg`                       | Kortex • Games                |

## Estrutura de pastas

```
kortex-bot/
├── bot.js               ← código do bot (Baileys)
├── package.json
├── README.md
├── .gitignore
├── data/                ← ficheiros de dados gerados pelo bot em runtime
│   └── (bot_data.json, historico.json, banners/... são criados
│        automaticamente na primeira execução)
└── media/
    └── kortex/           ← as 13 imagens oficiais dos menus (ver tabela acima)
```

> **Nota:** a pasta `sessao_kortex/` (sessão do WhatsApp) e a pasta
> `node_modules/` **não** vêm incluídas neste ZIP — são geradas
> automaticamente ao correr `npm install` e `npm start`.

## Deploy no Render

1. Cria um novo **Web Service** no Render a partir deste repositório/ZIP.
2. **Build Command:** `npm install`
3. **Start Command:** `npm start`
4. A Render define a variável `PORT` automaticamente — o bot já está
   preparado para a usar (serve um pequeno endpoint HTTP para manter o
   serviço "vivo").
5. Como o Render usa um sistema de ficheiros efémero em planos gratuitos,
   a pasta `sessao_kortex/` pode ser apagada em cada novo deploy — nesse
   caso terás de emparelhar novamente. Para sessão persistente, usa um
   disco persistente (Render Disks) montado nessa pasta.

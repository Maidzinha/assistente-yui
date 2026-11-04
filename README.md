# Assistente — Yuri Degurechaff (“Yui”)

Assistente pessoal para Windows 10/11 com a **Yui**, uma irmãzinha brincalhona que conversa por **texto ou voz**,
em português, lembra do que você conta e ajuda a usar o PC. Ela aparece em **3D** (modelo VRM), mexe a boca
enquanto fala e muda de expressão conforme a emoção da frase.

Electron + React + TypeScript, com processos separados:

| Processo | Papel |
|---|---|
| `src/main` | Acesso ao sistema: IA, voz, memória, ações do Windows, configurações, histórico, créditos |
| `src/preload` | Ponte mínima e tipada (`window.assistant`) via `contextBridge` |
| `src/renderer` | Interface React (sem Node, `sandbox`, `contextIsolation`, CSP) |

## O que ela faz

- 🎙️ **Conversa por voz**: você fala, ela transcreve, responde e fala frase a frase (começa a falar antes de terminar a resposta).
- 💬 **Voz expressiva**: com a ElevenLabs (v3/v4), a IA coloca marcações de emoção como `[laughing]` ou `[softly]` só quando fazem sentido; o padrão é falar normal.
- 🧠 **Memória de longo prazo**: guarda fatos importantes sobre você (nunca dados sensíveis) e usa nas próximas conversas. Dá para ver e apagar em Configurações → Memória.
- 💖 **Personalidade de irmãzinha**: descontraída, faz piadas e às vezes zoa com carinho.
- 🧍‍♀️ **Yui em 3D**: modelo `.vrm` (feito no VRoid Studio, por exemplo) com piscadas, respiração, lábios sincronizados com a voz e expressões (feliz, triste, surpresa, brava, relaxada).
- 📊 **Créditos**: painel com os caracteres restantes na ElevenLabs e o gasto/limites do dia na Groq.
- 🗂️ **Ações no PC**: encontrar arquivos, abrir pastas, documentos, aplicativos e sites, sempre por uma lista fechada de ações.

## Iniciar

Requisitos: Node.js 20+ e Windows 10/11.

```bash
npm install
```

```bash
npm run dev
```

Outros comandos: `npm run build` (compila em `out/`), `npm start` (abre a versão compilada), `npm run typecheck`,
`npm run dist` (gera o instalador em `release/`).

> **Controle Inteligente de Aplicativos do Windows**: o instalador não tem assinatura digital, então o Windows pode
> bloquear o app instalado. Nesse caso, abra pelo Electron do projeto com um atalho para
> `node_modules\electron\dist\electron.exe "<pasta do projeto>"` depois de `npm run build`.

## Provedores

Tudo é ajustado em **Configurações** (ícone de engrenagem), que mostra o estado de cada provedor e o que falta.
As configurações ficam em `%APPDATA%\Assistente\settings.json`; o arquivo
[`config.example.json`](config.example.json) mostra o formato (sem credenciais).

### IA e microfone — Groq (nuvem, recomendado)

- Crie uma chave em https://console.groq.com → API Keys.
- IA: provedor “compatível com OpenAI”, URL `https://api.groq.com/openai/v1`, modelo `openai/gpt-oss-20b` (o mais barato).
- Microfone: mesmo provedor e URL, modelo `whisper-large-v3-turbo`.
- O plano gratuito tem limite de tokens por minuto; quando estoura (erro 429), o app espera o tempo pedido e tenta de novo sozinho.

Também funciona tudo local: **Ollama** ou qualquer servidor compatível com OpenAI (LM Studio, `llama-server`) para a IA,
e **whisper.cpp** / faster-whisper para o microfone.

### Voz da Yui

- **ElevenLabs (nuvem, recomendado)**: chave em https://elevenlabs.io → Profile → API Keys, e o *Voice ID* da voz
  (por exemplo, uma voz clonada). Modelos `eleven_v4_turbo`, `eleven_v4`, `eleven_v3` (entendem emoções),
  `eleven_multilingual_v2` e `eleven_flash_v2_5`. Ajustes de estabilidade, similaridade e “jeito de falar”.
- **Fish Audio** (nuvem), **XTTS + RVC** (local, voz treinada, via [`voice-workers/`](voice-workers)),
  **Piper**, **vozes do Windows** e servidores compatíveis com OpenAI `/v1/audio/speech`.

### Chaves de API

As chaves são cifradas com o DPAPI do Windows (`safeStorage`) em `%APPDATA%\Assistente\secrets.json` e nunca ficam no código.

### Modelo 3D

Em Configurações → Aparência, importe um arquivo `.vrm` (VRM 0.x ou 1.0, até 150 MB). Ele é copiado para
`%APPDATA%\Assistente\yui.vrm`. Sem modelo, a Yui aparece em 2D.

## Como a voz funciona

```
microfone (só após clicar) → WAV 16 kHz em memória → transcrição (Groq ou local, pt-BR)
  → mesma conversa e mesmo histórico do chat → resposta em streaming
  → síntese frase a frase → boca e expressão da Yui acompanham a fala
```

- Estados visíveis: **Ouvindo**, **Pensando**, **Falando**, **Pronta** (e *Aguardando confirmação*).
- Controles: silenciar microfone, silenciar a voz da Yui, interromper a fala e encerrar.

## Ações no PC

Lista explícita em [`src/main/actions/definitions.ts`](src/main/actions/definitions.ts). Não há execução de comandos de terminal.

| Ação | Confirmação |
|---|---|
| Encontrar arquivos, abrir pasta, abrir documento (não executável), abrir aplicativo do Menu Iniciar, lembrar/esquecer | Não |
| Pesquisar na internet, abrir site, criar pasta, mover, renomear, enviar para a Lixeira | **Sim** |
| Instalar programas, terminais, registro, arquivos fora da pasta do usuário ou em `AppData` | Bloqueado |

## Estrutura

```
src/
  shared/          tipos, canais IPC e marcações de emoção da voz
  main/
    ai/            adaptadores de LLM (Ollama, OpenAI-compatível/Groq), persona e laço de ferramentas
    voice/         transcrição e voz (ElevenLabs, Fish Audio, XTTS+RVC, Piper, OpenAI-compatível)
    memory/        memória de longo prazo
    actions/       ações permitidas, validação de caminhos, aplicativos, executor com confirmação
    config/        configurações e segredos cifrados
    conversation/  histórico (somente texto)
    usage.ts       créditos da ElevenLabs e gasto/limites da Groq
    avatar.ts      importação do modelo 3D
  preload/         ponte segura
  renderer/src/
    components/    interface (Avatar3D, painéis, conversa, configurações)
    hooks/         useChat, useVoice, useProviders
    lib/           microfone, fala por frases, emoções do avatar, API
voice-workers/     serviços Python locais da voz personalizada (XTTS e RVC)
```

Para adicionar um provedor, implemente `LlmAdapter`, `SttAdapter` ou `TtsAdapter` e registre-o na fábrica correspondente.

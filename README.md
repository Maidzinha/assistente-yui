# Assistente — Yuri Degurechaff (“Yui”)

Assistente pessoal de IA para Windows 10/11 que conversa por **texto ou voz** e ajuda a controlar o PC.
**Tudo roda localmente:** modelo de linguagem, reconhecimento de fala e síntese de voz.

Electron + React + TypeScript, com processos separados:

| Processo | Papel |
|---|---|
| `src/main` | Acesso ao sistema: IA, voz, ações do Windows, configurações, histórico |
| `src/preload` | Ponte mínima e tipada (`window.assistant`) via `contextBridge` |
| `src/renderer` | Interface React (sem Node, `sandbox`, `contextIsolation`, CSP) |

## Iniciar

Requisitos: Node.js 20+ e Windows 10/11.

```bash
npm install
```

```bash
npm run dev
```

Outros comandos: `npm run build` (compila em `out/`), `npm start` (abre a versão compilada), `npm run typecheck`.

## Configurar os provedores locais

Tudo pode ser ajustado em **Configurações** (ícone de engrenagem). A tela mostra o estado de cada provedor e
os passos que faltam. As configurações ficam em `%APPDATA%\Assistente\settings.json`; o arquivo
[`config.example.json`](config.example.json) mostra o formato (sem credenciais).

### 1. IA (obrigatório) — Ollama

1. Instale: https://ollama.com/download
2. Baixe um modelo com suporte a ferramentas (necessário para controlar o PC):
   ```bash
   ollama pull llama3.1:8b
   ```
   Alternativas: `qwen2.5:7b` (ótimo em pt-BR), `llama3.2:3b` (mais leve).
3. Deixe o Ollama aberto (ou rode `ollama serve`). Padrão: `http://127.0.0.1:11434`.

Também funciona com qualquer servidor local **compatível com OpenAI** (LM Studio, `llama-server` do llama.cpp):
escolha esse provedor e use a URL com `/v1`, por exemplo `http://127.0.0.1:1234/v1`.

### 2. Reconhecimento de fala (para conversar por voz) — whisper.cpp

1. Baixe o whisper.cpp para Windows: https://github.com/ggml-org/whisper.cpp/releases
2. Baixe um modelo multilíngue (`ggml-small.bin` é um bom equilíbrio; `ggml-large-v3-turbo.bin` é mais preciso).
3. Inicie o servidor:
   ```bash
   whisper-server.exe -m ggml-small.bin -l pt --port 8080
   ```

Alternativa: um servidor compatível com OpenAI `/v1/audio/transcriptions` (Speaches/faster-whisper-server).

Sem esse servidor, a conversa por voz fica **desativada** e o painel mostra como configurar — a voz nunca é simulada.

### 3. Voz da Yui (respostas faladas)

- **Voz personalizada (XTTS + RVC)** — usa uma voz treinada por você, como a da Maidzinha:
  1. O **XTTS v2** gera a fala a partir dos latentes da voz (`voz-maidzinha-latentes.pt`).
  2. O **RVC** aplica o timbre do modelo (`maidzinha_e255_s15555.pth` + `.index`).

  O app inicia sozinho os dois processos Python de [`voice-workers/`](voice-workers) (só em `127.0.0.1`,
  e eles fecham junto com o app). Em Configurações → Voz, informe:
  - o `python.exe` do ambiente com o pacote `TTS` e a pasta do modelo XTTS v2;
  - o `python.exe` do ambiente do RVC e a pasta do RVC (com `infer\` e `assets\hubert_base`, `assets\rmvpe`);
  - os arquivos da voz (latentes `.pt`, modelo `.pth` e índice `.index`).

  Com uma RTX 3080, cada frase leva cerca de 3 s (XTTS) + 0,3 s (RVC na placa). Se faltar memória de vídeo,
  escolha “Placa de vídeo só enquanto fala” para o XTTS ou “Processador” para o RVC. Os logs ficam em
  `%APPDATA%\Assistente\logs`.
- **Vozes do Windows** (offline): usa as vozes instaladas, como *Microsoft Maria (pt-BR)*.
  Para mais vozes: Configurações do Windows → Hora e idioma → Fala.
- **Piper** (voz neural offline): baixe `piper.exe` em https://github.com/rhasspy/piper/releases e uma voz pt-BR
  (`pt_BR-faber-medium.onnx` + `.onnx.json`). Informe os dois caminhos nas configurações.
- **Servidor compatível com OpenAI** `/v1/audio/speech` (ex.: Kokoro-FastAPI, voz `pf_dora`).

Nas configurações você também escolhe idioma (pt-BR padrão), voz, velocidade, se a Yui responde falando nas
conversas por voz e se ela também lê em voz alta as respostas das mensagens digitadas.

### Chaves de API

Servidores locais normalmente não pedem chave. Se o seu pedir, informe-a nas configurações: ela é
cifrada com o DPAPI do Windows (`safeStorage`) em `%APPDATA%\Assistente\secrets.json` e nunca fica no código.

## Como a voz funciona

```
microfone (só após clicar) → WAV 16 kHz em memória → whisper local (pt-BR)
  → mesma conversa e mesmo histórico do chat → resposta em streaming
  → síntese frase a frase (começa a falar antes de a resposta terminar)
```

- A transcrição aparece na conversa como mensagem do usuário (marcada como *Transcrição*), e a frase sendo falada fica destacada na resposta.
- Estados visíveis: **Ouvindo**, **Pensando**, **Falando**, **Pronta** (e *Aguardando confirmação*).
- Controles: silenciar microfone, silenciar a voz da Yui, interromper a fala (volta a ouvir) e encerrar.
- O áudio nunca é gravado em disco. Arquivos temporários do Piper são apagados logo após a leitura.

## Ações no PC

Lista explícita em [`src/main/actions/definitions.ts`](src/main/actions/definitions.ts). Não há execução de comandos de terminal.

| Ação | Confirmação |
|---|---|
| Encontrar arquivos, abrir pasta, abrir documento (não executável), abrir aplicativo do Menu Iniciar | Não |
| Pesquisar na internet, abrir site, criar pasta, mover, renomear, enviar para a Lixeira | **Sim** |
| Instalar programas, terminais, registro, arquivos fora da pasta do usuário ou em `AppData` | Bloqueado |

Ações pedidas por voz passam pelo mesmo executor e pelas mesmas confirmações das pedidas por texto.
Cada ação aparece na conversa com o estado (em andamento, concluída, falhou, cancelada, não autorizada) e pode ser cancelada.
O modelo é instruído a só afirmar sucesso quando o resultado da ação for `SUCESSO`.

## Estrutura

```
src/
  shared/          tipos e canais IPC
  main/
    ai/            adaptadores de LLM (Ollama, OpenAI-compatível), persona e laço de ferramentas
    voice/         adaptadores de transcrição (whisper.cpp, OpenAI-compatível) e voz (XTTS+RVC, Piper, OpenAI-compatível)
voice-workers/     serviços Python locais da voz personalizada (XTTS e RVC)
    actions/       ações permitidas, validação de caminhos, aplicativos, executor com confirmação
    config/        configurações e segredos cifrados
    conversation/  histórico (somente texto)
  preload/         ponte segura
  renderer/src/
    components/    componentes reutilizáveis da interface
    hooks/         useChat, useVoice, useProviders
    lib/           captura do microfone, fala por frases, API
```

Para adicionar um provedor, implemente `LlmAdapter`, `SttAdapter` ou `TtsAdapter` e registre-o na fábrica correspondente.

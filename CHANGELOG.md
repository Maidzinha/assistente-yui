# Histórico de versões — Assistente Yui

**Português** · [English](docs/en/CHANGELOG.md)

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). As versões seguem `MAIOR.MENOR.CORREÇÃO`.

## [0.2.0] — 2026-11-06

- Coluna lateral reorganizada: os cartões da Yui, da conversa por voz e dos créditos não são mais cortados e ficam mais compactos.
- Yui em 3D enquadrada do peito para cima, centralizada no rosto; texturas do modelo carregam certo (antes ela aparecia toda branca).
- Limite por minuto da Groq (erro 429): o app espera o tempo pedido e tenta de novo sozinho, e cada pergunta gasta menos tokens.
- Só uma janela da Yui aberta por vez; abrir de novo traz a janela para a frente.
- Fixar a janela na barra de tarefas reabre a Yui certa.
- Licença de uso privado (proprietária, todos os direitos reservados), avisos de terceiros e documentação em inglês.

## [0.1.0] — 2026-11-04

Primeira versão.

- Conversa por texto e por voz em português, com histórico compartilhado.
- IA e transcrição pela Groq (`openai/gpt-oss-20b` e `whisper-large-v3-turbo`), ou servidores locais.
- Voz pela ElevenLabs com marcações de emoção só quando fazem sentido; também Fish Audio, XTTS + RVC, Piper e vozes do Windows.
- Personalidade de irmãzinha brincalhona e memória de longo prazo (ver e apagar em Configurações → Memória).
- Yui em 3D (modelo VRM) com piscadas, respiração, lábios sincronizados e expressões.
- Painel de créditos da ElevenLabs e de gasto/limites da Groq.
- Ações no PC por lista fechada, com confirmação para o que muda arquivos ou abre sites.

# Changelog — Assistente Yui

[Português](../../CHANGELOG.md) · **English**

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow `MAJOR.MINOR.PATCH`.

## [0.3.0] — 2026-11-10

- **New look:** Yui now lives on a large stage that fills the whole column, with her name and status on top; a side
  navigation rail (home, last conversation, new conversation, hide Yui, settings); a centered home screen, shortcut
  cards, subtle scrollbars and smooth animations.
- **A livelier 3D Yui:** her eyes and head follow the mouse, and she looks up while thinking. Drag to rotate, use the
  mouse wheel to zoom, and pick the framing (Face, Bust or Body). The framing adapts to the model's size and the
  window height.
- **Microphone modes**, in a new settings tab: *Tap to talk*, *Open microphone* (keeps listening on its own and
  listens again after answering) and *Push to talk* (records while you hold a key). Sensitivity and the pause before
  sending are adjustable too.
- Collapsible credits panel that shows just a summary.
- Keyboard shortcuts: `Ctrl+N` new conversation, `Ctrl+,` settings, `Ctrl+B` shows or hides Yui.
- Fix: the microphone no longer stays on after a recording with no speech.
- License changed to the **PolyForm Noncommercial 1.0.0**: the code may be used, modified and shared for
  noncommercial purposes, keeping the license and the copyright notice.

## [0.2.0] — 2026-11-06

- Side column reorganized: the Yui, voice chat and credits cards are no longer cut off and are more compact.
- Yui in 3D framed from the chest up, centered on her face; the model's textures load correctly (before, she showed up all white).
- Groq per-minute limit (error 429): the app waits the requested time and retries on its own, and each question uses fewer tokens.
- Only one Yui window at a time; opening it again brings the window to the front.
- Pinning the window to the taskbar reopens the right Yui.
- Private use license (proprietary, all rights reserved), third-party notices and English documentation.

## [0.1.0] — 2026-11-04

First version.

- Text and voice chat in Portuguese, with a shared history.
- AI and transcription through Groq (`openai/gpt-oss-20b` and `whisper-large-v3-turbo`), or local servers.
- Voice through ElevenLabs with emotion tags only when they fit; also Fish Audio, XTTS + RVC, Piper and Windows voices.
- Playful little-sister personality and long-term memory (view and delete in Settings → Memória).
- Yui in 3D (VRM model) with blinking, breathing, lip sync and expressions.
- Credits panel for ElevenLabs and for Groq spending/limits.
- PC actions from a closed list, with confirmation for anything that changes files or opens websites.

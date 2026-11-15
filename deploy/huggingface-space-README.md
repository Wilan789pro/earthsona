---
title: EARTHSONA Luna backend
emoji: 🌙
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Luna, the guide of EARTHSONA (Gemini chat + Kokoro voice)
---

# EARTHSONA: Luna backend

API for the EARTHSONA web app (NASA Space Apps Challenge 2026, *The Earth Information Jukebox*), by Team AstroNopes.

- `GET /api/health`: status
- `POST /api/luna/chat`: Luna's answers (Google Gemini; the key is a Space secret, never sent to browsers)
- `POST /api/luna/tts`: Luna's voice (Kokoro-82M, voice `af_heart`, Apache-2.0)

Configure in **Settings → Variables and secrets**:
- secret `GEMINI_API_KEY`;
- variables `GEMINI_MODEL=gemini-3.5-flash` and `CORS_ORIGINS=https://wilan789pro.github.io`;
- optional `LUNA_DAILY_CHAT_LIMIT`.

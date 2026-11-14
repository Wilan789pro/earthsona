"""Standalone Gemini connection check (no web server needed). Run from the backend folder:

    .venv\\Scripts\\python.exe check_gemini.py

1. confirms backend/.env provides GEMINI_API_KEY (prints only whether it is set, never the key);
2. lists the models this key can use and checks that GEMINI_MODEL is one of them;
3. sends one real request through the same service the API uses, and prints Luna's reply.
Exit code 0 only if a real response came back.
"""

from __future__ import annotations

import asyncio
import sys

from config.settings import ENV_FILE, settings
from schemas.luna import LunaContext
from services.gemini_service import GeminiError, GeminiService
from services.luna_service import LunaService


async def main() -> int:
    print(f".env file : {ENV_FILE} ({'found' if ENV_FILE.exists() else 'NOT FOUND'})")
    print(f"API key   : {settings.masked_key()}")
    print(f"Model     : {settings.gemini_model}")
    if not settings.has_key:
        print("\nFAIL: no Gemini API key yet. Open the .env file shown above and replace the placeholder after GEMINI_API_KEY= with your key.")
        return 1
    gemini = GeminiService(settings)
    try:
        models = await gemini.list_models()
    except GeminiError as e:
        print(f"\nFAIL while listing models [{e.kind}]: {e.message}")
        return 1
    flash = sorted(m for m in models if "flash" in m)
    if settings.gemini_model in models:
        print(f"Model check: OK, '{settings.gemini_model}' is available for this key.")
    else:
        print(f"\nFAIL: '{settings.gemini_model}' is not in the models available to this key.")
        print("Available 'flash' models: " + (", ".join(flash) if flash else "(none)"))
        print("Set GEMINI_MODEL in backend/.env to one of these and run this check again.")
        return 1
    luna = LunaService(settings, gemini)
    ctx = LunaContext(mission="forest", experiment="connection test", sliders={"rainfall": {"value": 60, "baseline": 100, "unit": "%"}, "temperature": {"value": 2, "baseline": 0, "unit": "°C above baseline"}})
    try:
        reply = await luna.chat("connection-check", "Hi Luna! In one or two sentences: what happens when it gets hotter and drier at the same time?", ctx)
    except GeminiError as e:
        print(f"\nFAIL while generating [{e.kind}]: {e.message}")
        return 1
    print("\nSUCCESS - Luna replied via Gemini:\n")
    print(reply)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

"""Backend configuration, read from backend/.env (never committed) and the process environment.

The Gemini API key stays here, on the server. It is never sent to the browser, never returned by an
endpoint and never written to logs (use `masked_key()` if you need to show that a key is present).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"

# override=False: a variable already set in the shell wins over the file.
load_dotenv(ENV_FILE, override=False)


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", "").strip(), repr=False)
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip())
    request_timeout_s: int = field(default_factory=lambda: _int("GEMINI_TIMEOUT_SECONDS", 30))
    max_output_tokens: int = field(default_factory=lambda: _int("GEMINI_MAX_OUTPUT_TOKENS", 2048))
    # Short, conversational answers don't need long reasoning; "low" is faster and leaves room for the reply.
    thinking_level: str = field(default_factory=lambda: os.getenv("GEMINI_THINKING_LEVEL", "low").strip())
    # Browser origins allowed to call the API (the Vite dev server by default).
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()
        )
    )
    # Simple abuse guard: requests per minute per client IP.
    rate_limit_per_minute: int = field(default_factory=lambda: _int("LUNA_RATE_LIMIT_PER_MINUTE", 20))
    # Conversation turns kept per session (one turn = user + Luna).
    history_turns: int = field(default_factory=lambda: _int("LUNA_HISTORY_TURNS", 10))

    @property
    def has_key(self) -> bool:
        # The .env template ships with a placeholder; treat it as "no key yet".
        return bool(self.gemini_api_key) and not self.gemini_api_key.upper().startswith("PASTE_")

    def masked_key(self) -> str:
        k = self.gemini_api_key
        if not k:
            return "(missing)"
        if not self.has_key:
            return "(placeholder: paste your real key into backend/.env)"
        return f"(set, {len(k)} characters)"


settings = Settings()

"""Thin wrapper around Google's official `google-genai` SDK.

Only this module talks to Gemini, so the provider can be swapped later without touching Luna's logic.
Every failure is turned into a GeminiError with a stable `kind` (no key or raw provider payload is ever
included in what reaches the browser or the logs).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import httpx
from google import genai
from google.genai import errors, types

from config.settings import Settings

log = logging.getLogger("earthsona.gemini")


class GeminiError(Exception):
    """kind: missing_key | invalid_key | quota | model_not_found | unavailable | bad_request | timeout | network | upstream"""

    def __init__(self, kind: str, message: str, status_code: int):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.status_code = status_code


@dataclass
class Turn:
    role: str  # "user" or "model"
    text: str


class GeminiService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: genai.Client | None = None

    def _client_or_raise(self) -> genai.Client:
        if not self.settings.has_key:
            raise GeminiError("missing_key", "Luna is not configured yet: GEMINI_API_KEY is missing from backend/.env.", 503)
        if self._client is None:
            self._client = genai.Client(
                api_key=self.settings.gemini_api_key,
                http_options=types.HttpOptions(timeout=self.settings.request_timeout_s * 1000),  # milliseconds
            )
        return self._client

    async def generate(self, system_instruction: str, turns: list[Turn], temperature: float = 0.8) -> str:
        client = self._client_or_raise()
        contents = [types.Content(role=t.role, parts=[types.Part.from_text(text=t.text)]) for t in turns]
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            # Thinking tokens count towards this limit on Gemini 3 models, so keep headroom.
            max_output_tokens=self.settings.max_output_tokens,
            thinking_config=self._thinking(),
        )
        # Retry only temporary provider problems (overloaded / internal error), with a short backoff.
        delays = [1.5, 4.0]
        for attempt in range(len(delays) + 1):
            try:
                resp = await asyncio.wait_for(
                    client.aio.models.generate_content(model=self.settings.gemini_model, contents=contents, config=config),
                    timeout=self.settings.request_timeout_s + 5,
                )
                break
            except Exception as exc:  # noqa: BLE001 - mapped to a safe, stable error below
                err = self._map(exc)
                if err.kind == "unavailable" and attempt < len(delays):
                    log.info("Gemini temporarily unavailable; retrying in %.1fs (attempt %d)", delays[attempt], attempt + 2)
                    await asyncio.sleep(delays[attempt])
                    continue
                raise err from exc
        text = (resp.text or "").strip()
        try:
            if resp.candidates and str(resp.candidates[0].finish_reason).endswith("MAX_TOKENS"):
                log.warning("Gemini reply hit max_output_tokens (%s); consider raising GEMINI_MAX_OUTPUT_TOKENS", self.settings.max_output_tokens)
        except Exception:  # noqa: BLE001
            pass
        if not text:
            # Usually a safety block or an empty candidate.
            reason = None
            try:
                reason = resp.candidates[0].finish_reason if resp.candidates else None
            except Exception:  # noqa: BLE001
                pass
            raise GeminiError("upstream", f"Gemini returned no text (finish reason: {reason}).", 502)
        return text

    def _thinking(self) -> types.ThinkingConfig | None:
        """GEMINI_THINKING_LEVEL: minimal | low | medium | high | default (let the model decide)."""
        level = self.settings.thinking_level.upper()
        if level in ("", "DEFAULT"):
            return None
        try:
            return types.ThinkingConfig(thinking_level=types.ThinkingLevel[level])
        except KeyError:
            log.warning("Unknown GEMINI_THINKING_LEVEL %r; using the model default", self.settings.thinking_level)
            return None

    async def list_models(self) -> list[str]:
        """Names of models that support generateContent for this key (used by the connection check)."""
        client = self._client_or_raise()
        try:
            names: list[str] = []
            pager = await client.aio.models.list()
            async for m in pager:
                actions = getattr(m, "supported_actions", None) or []
                if not actions or "generateContent" in actions:
                    names.append((m.name or "").removeprefix("models/"))
            return names
        except Exception as exc:  # noqa: BLE001
            raise self._map(exc) from exc

    # ------------------------------------------------------------------
    def _map(self, exc: Exception) -> GeminiError:
        if isinstance(exc, GeminiError):
            return exc
        if isinstance(exc, (asyncio.TimeoutError, httpx.TimeoutException)):
            return GeminiError("timeout", f"Gemini did not answer within {self.settings.request_timeout_s} s.", 504)
        if isinstance(exc, (httpx.ConnectError, httpx.NetworkError)):
            return GeminiError("network", "Could not reach the Gemini API (network problem).", 503)
        if isinstance(exc, errors.APIError):
            code = exc.code or 0
            msg = (exc.message or "").lower()
            status = (exc.status or "").upper()
            log.warning("Gemini API error %s %s", code, status)  # no key, no payload
            if code in (401, 403) or "api key" in msg or status in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
                return GeminiError("invalid_key", "Gemini rejected the API key (check GEMINI_API_KEY in backend/.env).", 502)
            if code == 429 or status == "RESOURCE_EXHAUSTED":
                return GeminiError("quota", "Gemini quota or rate limit reached. Please wait and try again.", 429)
            if code == 404 or status == "NOT_FOUND":
                return GeminiError("model_not_found", f"The model '{self.settings.gemini_model}' is not available for this key (check GEMINI_MODEL).", 502)
            if code == 504 or status == "DEADLINE_EXCEEDED":
                return GeminiError("timeout", "Gemini took too long to answer (the model may be overloaded). Please try again.", 504)
            if code in (500, 503) or status in ("UNAVAILABLE", "INTERNAL"):
                return GeminiError("unavailable", "Gemini is busy or temporarily unavailable right now. Please try again in a moment.", 503)
            if 400 <= code < 500:
                return GeminiError("bad_request", f"Gemini could not process the request ({status or code}).", 502)
            return GeminiError("upstream", f"Gemini service error ({status or code}). Please try again.", 502)
        log.exception("Unexpected Gemini failure")
        return GeminiError("upstream", "Unexpected error while contacting Gemini.", 502)

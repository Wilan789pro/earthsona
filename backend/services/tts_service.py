"""Luna's voice: Kokoro-82M text-to-speech (ONNX build via `kokoro-onnx`), voice `af_heart` by default.

Kept separate from Gemini so either can be replaced. The model files live in backend/models (git-ignored);
download them with `python download_kokoro.py`. Synthesis runs in a worker thread.

Latency: Kokoro runs at roughly real time on a laptop CPU (≈1 s of compute per 1 s of speech), so Luna
avoids waiting instead of trying to synthesise faster:
  * results are cached in memory AND on disk (backend/cache/tts, git-ignored), so any line said before —
    including after a restart — starts instantly;
  * `prewarm()` synthesises common phrases in the background, but always yields to live requests;
  * the browser asks for a short first chunk (one short sentence) so speech starts after ~1 s.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import os
import threading
import time
import wave
from collections import OrderedDict
from pathlib import Path

from config.settings import BACKEND_DIR

log = logging.getLogger("earthsona.tts")

MODEL_DIR = BACKEND_DIR / "models"
MODEL_FILE = MODEL_DIR / os.getenv("KOKORO_MODEL_FILE", "kokoro-v1.0.int8.onnx")
VOICES_FILE = MODEL_DIR / os.getenv("KOKORO_VOICES_FILE", "voices-v1.0.bin")
VOICE = os.getenv("KOKORO_VOICE", "af_heart")
SPEED = float(os.getenv("KOKORO_SPEED", "1.0"))
CACHE_DIR = BACKEND_DIR / "cache" / "tts"
MEMORY_ITEMS = 200


class TTSError(Exception):
    def __init__(self, kind: str, message: str, status_code: int):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.status_code = status_code


class TTSService:
    def __init__(self) -> None:
        self._kokoro = None
        self._lock = threading.Lock()
        self._cache: "OrderedDict[str, bytes]" = OrderedDict()
        self.error: str | None = None
        self._last_user = 0.0  # time of the last live (non-prewarm) request
        self._alock: "asyncio.Lock | None" = None  # one synthesis at a time, in arrival order
        self._queue: list[str] = []
        self._warming = False
        self.stats = {"live": 0, "cache_hits": 0, "prewarmed": 0}

    @property
    def files_present(self) -> bool:
        return MODEL_FILE.exists() and VOICES_FILE.exists()

    def available(self) -> bool:
        return self.files_present and self.error is None

    def _load(self):
        if self._kokoro is not None:
            return self._kokoro
        if not self.files_present:
            raise TTSError("tts_not_installed", "Luna's voice model is not installed (run download_kokoro.py in backend/).", 503)
        try:
            from kokoro_onnx import Kokoro

            self._kokoro = Kokoro(str(MODEL_FILE), str(VOICES_FILE))
            log.info("Kokoro loaded (%s, voice %s)", MODEL_FILE.name, VOICE)
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)
            log.exception("Could not load Kokoro")
            raise TTSError("tts_failed", "Luna's voice could not start on the server.", 503) from exc
        return self._kokoro

    def _synth(self, text: str) -> bytes:
        with self._lock:  # one synthesis at a time keeps CPU use predictable
            kokoro = self._load()
            samples, rate = kokoro.create(text, voice=VOICE, speed=SPEED, lang="en-us")
        import numpy as np

        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(int(rate))
            w.writeframes(pcm)
        return buf.getvalue()

    # --- cache ---------------------------------------------------------------
    @staticmethod
    def _key(text: str) -> str:
        return hashlib.sha256(f"{VOICE}|{SPEED}|{text}".encode("utf-8")).hexdigest()[:32]

    def _cached(self, text: str) -> bytes | None:
        if text in self._cache:
            self._cache.move_to_end(text)
            return self._cache[text]
        f = CACHE_DIR / f"{self._key(text)}.wav"
        if f.exists():
            audio = f.read_bytes()
            self._remember(text, audio)
            return audio
        return None

    def _remember(self, text: str, audio: bytes, to_disk: bool = False) -> None:
        self._cache[text] = audio
        while len(self._cache) > MEMORY_ITEMS:
            self._cache.popitem(last=False)
        if to_disk:
            try:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                (CACHE_DIR / f"{self._key(text)}.wav").write_bytes(audio)
            except OSError:
                log.warning("Could not write the TTS disk cache")

    # --- background pre-generation ------------------------------------------------
    def prewarm(self, texts: list[str]) -> int:
        """Queue phrases to synthesise when the server is idle. Returns how many were queued."""
        new = [t for t in dict.fromkeys(x.strip() for x in texts) if t and len(t) <= 100 and t not in self._queue and self._cached(t) is None]
        self._queue.extend(new)
        if new and not self._warming and self.available():
            self._warming = True
            asyncio.get_running_loop().create_task(self._warm_loop())
        return len(new)

    async def _warm_loop(self) -> None:
        try:
            while self._queue:
                # Live requests always come first: wait until nobody has asked for speech for a moment.
                if time.monotonic() - self._last_user < 4 or self._busy().locked():
                    await asyncio.sleep(0.5)
                    continue
                text = self._queue.pop(0)
                if self._cached(text) is not None:
                    continue
                try:
                    async with self._busy():
                        audio = await asyncio.to_thread(self._synth, text)
                except Exception:  # noqa: BLE001 - prewarm is best-effort
                    continue
                self._remember(text, audio, to_disk=True)
                self.stats["prewarmed"] += 1
        finally:
            self._warming = False

    def _busy(self) -> asyncio.Lock:
        if self._alock is None:
            self._alock = asyncio.Lock()
        return self._alock

    async def speak(self, text: str, gone=None) -> bytes:
        """`gone` (optional async callable) says whether the browser has given up (e.g. Luna was interrupted);
        such requests are skipped instead of keeping the CPU busy."""
        self._last_user = time.monotonic()
        hit = self._cached(text)
        if hit is not None:
            self.stats["cache_hits"] += 1
            return hit
        if text in self._queue:
            self._queue.remove(text)
        self.stats["live"] += 1
        try:
            async with self._busy():
                if gone is not None and await gone():
                    raise TTSError("cancelled", "The request was cancelled.", 499)
                hit = self._cached(text)  # it may have been made while we waited
                if hit is not None:
                    return hit
                audio = await asyncio.wait_for(asyncio.to_thread(self._synth, text), timeout=60)
        except TTSError:
            raise
        except asyncio.TimeoutError as exc:
            raise TTSError("tts_timeout", "Generating Luna's voice took too long.", 504) from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("Kokoro synthesis failed")
            raise TTSError("tts_failed", "Luna's voice could not be generated for this text.", 500) from exc
        self._remember(text, audio, to_disk=True)
        self._last_user = time.monotonic()
        return audio

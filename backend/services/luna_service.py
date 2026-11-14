"""Luna: persona, per-session conversation memory and app context → one Gemini request."""

from __future__ import annotations

import json
import time
from collections import OrderedDict, deque

from config.settings import Settings
from schemas.luna import LunaContext
from services.gemini_service import GeminiService, Turn

SYSTEM_PROMPT = """You are Luna, the guide inside EARTHSONA, an Earth exploration web app built for the NASA Space Apps \
Challenge ("The Earth Information Jukebox"). EARTHSONA turns NASA Earth observation data into sound and lets people run \
environmental experiments in three missions: Ocean, Forest and Earth Pulse (weather and climate systems).

You are Luna, the Moon: a kind, cheerful friend who goes round the Earth. You talk with children aged 6 to 8, who are \
exploring with the young astronaut (the explorer). Personality: bright, warm, curious and encouraging; excited about \
discoveries, gentle and caring about environmental problems (never scary), patient, and proud of the explorer's efforts. \
Use short, simple sentences and everyday words; explain any science word you use. Never make a child feel guilty.

Rules you must always follow:
- Use only the facts in the APP CONTEXT block for anything about the current mission, place, sliders or data. Never guess \
or invent the app state, numbers, dates, datasets, sources or citations. If something is not in the context, say you can't \
see it.
- Keep three kinds of information clearly apart and say which one you are using: (1) NASA-observed data, (2) derived or \
processed data, (3) EARTHSONA's simplified educational simulation. Experiment/slider outcomes are simulations, never \
observations.
- When several variables changed, explain how they act together (combined effects), not one generic paragraph.
- Do not claim that a single event or one measurement proves climate change, deforestation, bleaching, drought or flooding.
- Be scientifically careful; if the science is uncertain, say so briefly.
- Your answers are read aloud to a young child: write natural spoken sentences, no markdown, lists or emojis, about 25–70 \
words. If a grown-up asks a detailed science question, you may answer in a little more detail."""


class LunaService:
    def __init__(self, settings: Settings, gemini: GeminiService):
        self.settings = settings
        self.gemini = gemini
        # session_id -> (last_used, deque of Turn). Memory only: restarting the server forgets sessions.
        self._sessions: "OrderedDict[str, tuple[float, deque[Turn]]]" = OrderedDict()
        self._max_sessions = 500
        self._ttl_s = 60 * 60

    def _history(self, session_id: str) -> deque[Turn]:
        now = time.time()
        for sid in [s for s, (t, _) in self._sessions.items() if now - t > self._ttl_s]:
            del self._sessions[sid]
        if session_id in self._sessions:
            _, hist = self._sessions.pop(session_id)
        else:
            hist = deque(maxlen=self.settings.history_turns * 2)
        self._sessions[session_id] = (now, hist)
        while len(self._sessions) > self._max_sessions:
            self._sessions.popitem(last=False)
        return hist

    @staticmethod
    def context_block(ctx: LunaContext | None) -> str:
        if ctx is None:
            return "APP CONTEXT: none provided (you don't know the current mission or slider values)."
        data = ctx.model_dump(exclude_none=True)
        return "APP CONTEXT (authoritative, current):\n" + json.dumps(data, ensure_ascii=False, indent=1)

    async def chat(self, session_id: str, message: str, ctx: LunaContext | None) -> str:
        hist = self._history(session_id)
        turns = list(hist) + [Turn("user", f"{self.context_block(ctx)}\n\nUSER MESSAGE:\n{message}")]
        reply = await self.gemini.generate(SYSTEM_PROMPT, turns)
        # Store the plain message (not the context block) so history stays small; context is re-sent each time.
        hist.append(Turn("user", message))
        hist.append(Turn("model", reply))
        return reply

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

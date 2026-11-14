import { API_BASE } from "./luna";

/**
 * Talks to Luna's backend (FastAPI → Gemini). The browser never sees the Gemini key: it only calls /api.
 * The session id keeps the conversation going for this browser tab.
 */
export interface ChatContext {
  mission?: "ocean" | "forest" | "pulse";
  place?: string;
  experiment?: string;
  sliders?: Record<string, unknown>;
  dataset?: Record<string, unknown>;
  observations?: string[];
  simulation?: Record<string, unknown>;
}

export interface BackendStatus {
  online: boolean;
  chat: boolean;
  tts: boolean;
  model?: string;
}

const SESSION_KEY = "earthsona.lunaSession";

export function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, "");
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon-" + Math.random().toString(36).slice(2, 12);
  }
}

export async function backendStatus(): Promise<BackendStatus> {
  try {
    const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { online: false, chat: false, tts: false };
    const j = await r.json();
    return { online: true, chat: !!j.gemini_key_configured, tts: !!j.tts_available, model: j.model };
  } catch {
    return { online: false, chat: false, tts: false };
  }
}

export type ChatResult = { ok: true; reply: string } | { ok: false; kind: string; message: string };

let inflight: AbortController | null = null;

/** Send one message. A new message cancels a pending one (no overlapping answers). */
export async function sendToLuna(message: string, context: ChatContext): Promise<ChatResult> {
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const r = await fetch(`${API_BASE}/api/luna/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId(), context }),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && typeof j.reply === "string") return { ok: true, reply: j.reply };
    if (r.status === 422) return { ok: false, kind: "invalid", message: "That message couldn't be sent (it may be empty or too long)." };
    return { ok: false, kind: j.error ?? "error", message: j.message ?? `Luna couldn't answer (error ${r.status}).` };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, kind: ctl === inflight ? "timeout" : "cancelled", message: "Luna took too long to answer. Please try again." };
    return { ok: false, kind: "offline", message: "Luna's server isn't reachable. Start the backend (see README) and try again." };
  } finally {
    clearTimeout(timer);
    if (inflight === ctl) inflight = null;
  }
}

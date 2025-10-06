// backend/src/heygen.ts
import axios from "axios";
import WebSocket from "ws";
import { Readable } from "stream";
import { CreateSessionRequest } from "./types";

const HEYGEN_API = "https://api.heygen.com/v1";

/**
 * Create HeyGen streaming session (this returns details you give to the client to connect via LiveKit)
 */
export async function createHeygenSession(opts: CreateSessionRequest & { character?: string; voice_id?: string }) {
  const body = {
    quality: opts.quality || "medium",
    voice: { rate: 1 },
    video_encoding: opts.video_encoding || "VP8",
    disable_idle_timeout: opts.disable_idle_timeout || false,
    version: opts.version || "v2",
    stt_settings: opts.stt_settings || {
      provider: "deepgram",
      confidence: 0.55
    },
    activity_idle_timeout: opts.activity_idle_timeout || 120,
    avatar_id: opts.character || "",
  };

  const heyKey = process.env.HEYGEN_API_KEY;

  const resp = await axios.post(`${HEYGEN_API}/streaming.new`, body, {
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-api-key': heyKey
    },
  });

  console.log({
    resp
  });

  // Return the full HeyGen response which includes code, data, and message
  return resp.data;
}

/**
 * Starts a connection to HeyGen Audio->Video WebSocket for a given sessionId.
 * It forwards audio chunks from `audioSource` (Readable stream) to HeyGen socket.
 *
 * audioSource should be a Readable stream that yields raw PCM16 or Opus chunks as the HeyGen API expects.
 */
const pipes = new Map<string, { ws: WebSocket; closed: boolean }>();

export async function startHeygenAudioPipe(sessionId: string, audioSource: Readable) {
  // 1) Get session details to find websocket endpoint for audio->video
  const heyKey3 = process.env.HEYGEN_API_KEY;
  if (!heyKey3) throw new Error("HEYGEN_API_KEY is not set. Please add it to your environment or .env file");

  const resp = await axios.get(`${HEYGEN_API}/streaming.info?session_id=${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${heyKey3}` },
  });
  const data = resp.data.data || resp.data;
  const wssUrl = data?.audio_ws_url || data?.websocket_url; // confirm field in your HeyGen response

  if (!wssUrl) throw new Error("HeyGen websocket URL not found in streaming.info response");

  const heyKey4 = process.env.HEYGEN_API_KEY;
  if (!heyKey4) throw new Error("HEYGEN_API_KEY is not set. Please add it to your environment or .env file");

  const ws = new WebSocket(wssUrl, {
    headers: { Authorization: `Bearer ${heyKey4}` },
  });

  ws.on("open", () => {
    console.log("HeyGen audio->video WS open");
    // start piping audio from audioSource into HeyGen ws as binary frames
    audioSource.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });
    audioSource.on("end", () => {
      // signal end of audio (HeyGen may expect a control message — adjust per their spec)
      try { ws.send(JSON.stringify({ event: "audio_end" })); } catch {}
    });
  });

  ws.on("message", (msg: WebSocket.Data) => {
    // Handle HeyGen status updates (e.g., when video frame available, status events)
    try {
      const message = typeof msg === "string" ? msg : msg.toString();
      // console.log("HeyGen WS msg:", message);
    } catch (e) {}
  });

  ws.on("close", () => console.log("HeyGen WS closed"));

  pipes.set(sessionId, { ws, closed: false });
}

/**
 * Start a HeyGen streaming session
 */
export async function startHeygenSession(sessionId: string) {
  const heyKey = process.env.HEYGEN_API_KEY;
  if (!heyKey) throw new Error("HEYGEN_API_KEY is not set. Please add it to your environment or .env file");

  const body = { session_id: sessionId };

  const resp = await axios.post(`${HEYGEN_API}/streaming.start`, body, {
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-api-key': heyKey
    },
  });

  return resp.data;
}

/**
 * Close a HeyGen streaming session
 */
export async function closeHeygenSession(sessionId: string) {
  const heyKey = process.env.HEYGEN_API_KEY;
  if (!heyKey) throw new Error("HEYGEN_API_KEY is not set. Please add it to your environment or .env file");

  const body = { session_id: sessionId };

  const resp = await axios.post(`${HEYGEN_API}/streaming.stop`, body, {
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-api-key': heyKey
    },
  });

  return resp.data;
}

/**
 * Get available avatars from HeyGen
 */
export async function getAvailableAvatars() {
  const heyKey = process.env.HEYGEN_API_KEY;
  if (!heyKey) throw new Error("HEYGEN_API_KEY is not set. Please add it to your environment or .env file");

  const resp = await axios.get(`${HEYGEN_API}/streaming/avatar.list`, {
    headers: {
      'accept': 'application/json',
      'x-api-key': heyKey
    },
  });

  return resp.data;
}

/**
 * Send a task to HeyGen streaming session
 */
export async function sendHeygenTask(sessionId: string, text: string) {
  const heyKey = process.env.HEYGEN_API_KEY;
  if (!heyKey) throw new Error("HEYGEN_API_KEY is not set. Please add it to your environment or .env file");

  const body = { session_id: sessionId, text };

  const resp = await axios.post(`${HEYGEN_API}/streaming.task`, body, {
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-api-key': heyKey
    },
  });

  return resp.data;
}

/**
 * Stop the audio pipe and close WS
 */
export async function stopHeygenAudioPipe(sessionId: string) {
  const entry = pipes.get(sessionId);
  if (!entry) return;
  try {
    entry.ws.close();
  } catch {}
  entry.closed = true;
  pipes.delete(sessionId);
}

// backend/src/openai_realtime.ts
import { Readable } from "stream";

const OPENAI_CLIENT_SECRETS_API = "https://api.openai.com/v1/realtime/client_secrets";

/**
 * Generate an ephemeral token for OpenAI Realtime API
 * This token allows the client to connect directly to OpenAI's WebRTC endpoint
 */
export async function generateOpenAIRealtimeToken(): Promise<{ value: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Please add it to your environment or .env file");

  const sessionConfig = JSON.stringify({
    session: {
      type: "realtime",
      model: "gpt-realtime",
      audio: {
        output: {
          voice: "marin",
        },
      },
    },
  });

  const response = await fetch(OPENAI_CLIENT_SECRETS_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: sessionConfig,
  });

  if (!response.ok) {
    throw new Error(`OpenAI token generation error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Convert OpenAI audio format to HeyGen compatible format
 * This handles audio format conversion if needed
 */
export function convertAudioFormatForHeyGen(audioBuffer: Buffer): Buffer {
  // For now, assume the audio format is compatible
  // In practice, you might need to convert between different audio formats
  // (e.g., Opus to PCM16, different sample rates, etc.)
  return audioBuffer;
}

/**
 * Legacy function for backward compatibility
 * Consider deprecating this in favor of the token-based approach
 */
export async function askOpenAIAndGetAudio(prompt: string): Promise<Readable> {
  throw new Error("This function is deprecated. Please use the token-based WebRTC approach with generateOpenAIRealtimeToken.");
}

/**
 * Legacy function for backward compatibility
 * Consider deprecating this in favor of the token-based approach
 */
export async function createOpenAIRealtimeSession(sdpOffer: string): Promise<string> {
  throw new Error("This function is deprecated. Please use the token-based WebRTC approach with generateOpenAIRealtimeToken.");
}

// backend/src/index.ts
import 'dotenv/config';
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { createHeygenSession, startHeygenSession, closeHeygenSession, sendHeygenTask, startHeygenAudioPipe, stopHeygenAudioPipe, getAvailableAvatars } from "./heygen";
import { generateOpenAIRealtimeToken } from "./openai_realtime";
import { CreateSessionRequest, SessionResponse } from "./types";
const app = express();
app.use(cors());
app.use(bodyParser.json());

// In-memory session store (consider using Redis or similar for production)
const activeSessions = new Map<string, {
  heygenSessionId?: string;
  heygenData?: any;
  createdAt: Date;
}>();

/**
 * Get available avatars from HeyGen
 */
app.get("/api/heygen/avatars", async (req, res) => {
  try {
    const response = await getAvailableAvatars();
    res.json(response);
  } catch (err: any) {
    console.error("heygen/avatars err:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Create a HeyGen streaming session (LiveKit room + tokens).
 * Returns the data the frontend needs to connect to LiveKit (url, token)
 */
app.post("/api/heygen/session", async (req, res) => {
  try {
    const sessionRequest: CreateSessionRequest & { character?: string; voice_id?: string } = req.body;
    const response: SessionResponse = await createHeygenSession(sessionRequest);
    res.json(response);
  } catch (err: any) {
    console.error("heygen/session err:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Generate an ephemeral token for OpenAI Realtime API
 * This endpoint provides a token that the client can use to connect directly to OpenAI
 */
app.get("/token", async (req, res) => {
  try {
    const tokenData = await generateOpenAIRealtimeToken();
    res.json(tokenData);
  } catch (err: any) {
    console.error("Token generation error:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message || "Failed to generate token" });
  }
});

/**
 * Create a session that coordinates HeyGen with OpenAI Realtime
 * This endpoint creates a HeyGen session and returns session info
 */
app.post("/api/session/create", async (req, res) => {
  try {
    const { character, voice } = req.body;

    // Generate a session ID for this connection
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    let heygenSession = null;

    if (character) {
      const heygenResponse = await createHeygenSession({
        character,
        voice: voice ? { rate: 1 } : undefined
      });
      heygenSession = heygenResponse.data;

      // Start HeyGen session
      await startHeygenSession(heygenSession.session_id);

      // Store session mapping
      activeSessions.set(sessionId, {
        heygenSessionId: heygenSession.session_id,
        heygenData: heygenSession,
        createdAt: new Date()
      });
    } else {
      // Store session without HeyGen
      activeSessions.set(sessionId, {
        createdAt: new Date()
      });
    }

    res.json({
      sessionId,
      heygenData: heygenSession,
      success: true
    });
  } catch (err: any) {
    console.error("Session creation error:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message || "Failed to create session" });
  }
});

/**
 * Get session information including HeyGen connection details
 */
app.get("/session/:sessionId/info", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData = activeSessions.get(sessionId);

    if (!sessionData) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({
      sessionId,
      heygenSessionId: sessionData.heygenSessionId,
      heygenData: sessionData.heygenData,
      createdAt: sessionData.createdAt
    });
  } catch (err: any) {
    console.error("Session info error:", err.message || err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Handle data channel events from OpenAI and forward to HeyGen
 * This endpoint receives events from the frontend data channel
 */
app.post("/api/realtime/events", async (req, res) => {
  try {
    const { sessionId, event } = req.body;
    if (!sessionId || !event) return res.status(400).json({ error: "sessionId and event required" });

    const sessionData = activeSessions.get(sessionId);
    if (!sessionData) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Forward relevant events to HeyGen if we have a HeyGen session
    if (sessionData.heygenSessionId && (event.type === 'input_text' || event.type === 'user_speech')) {
      const text = event.content || event.text || '';
      if (text.trim()) {
        await sendHeygenTask(sessionData.heygenSessionId, text);
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Event forwarding error:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * End a session and clean up resources
 */
app.delete("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData = activeSessions.get(sessionId);

    if (!sessionData) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Close HeyGen session if it exists
    if (sessionData.heygenSessionId) {
      await closeHeygenSession(sessionData.heygenSessionId);
      await stopHeygenAudioPipe(sessionData.heygenSessionId);
    }

    // Remove from session store
    activeSessions.delete(sessionId);

    res.json({ success: true });
  } catch (err: any) {
    console.error("Session cleanup error:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Start a HeyGen streaming session
 */
app.post("/api/heygen/start", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const response = await startHeygenSession(sessionId);
    res.json(response);
  } catch (err: any) {
    console.error("heygen/start err:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Close a HeyGen streaming session
 */
app.post("/api/heygen/close", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });

    const response = await closeHeygenSession(sessionId);
    await stopHeygenAudioPipe(sessionId);
    res.json(response);
  } catch (err: any) {
    console.error("heygen/close err:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Send a task to HeyGen streaming session
 */
app.post("/api/heygen/task", async (req, res) => {
  try {
    const { sessionId, text } = req.body;
    if (!sessionId || !text) return res.status(400).json({ error: "sessionId and text required" });

    const response = await sendHeygenTask(sessionId, text);
    res.json(response);
  } catch (err: any) {
    console.error("heygen/task err:", err.response?.data || err.message || err);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

/**
 * Stop streaming for session (close HeyGen audio ws etc.)
 */
app.post("/api/heygen/stop", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    await stopHeygenAudioPipe(sessionId);
    res.json({ success: true });
  } catch (err: any) {
    console.error("heygen/stop err:", err.message || err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));

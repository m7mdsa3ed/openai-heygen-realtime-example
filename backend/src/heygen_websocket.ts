// backend/src/heygen_websocket.ts
import WebSocket from "ws";
import { EventEmitter } from "events";

export interface HeyGenWebSocketEvent {
  type: string;
  event_id: string;
  [key: string]: any;
}

export interface HeyGenAgentSpeakEvent {
  type: "agent.speak";
  event_id: string;
  audio: string; // Base64 encoded PCM 16bit 24khz audio
}

export interface HeyGenAgentSpeakEndEvent {
  type: "agent.speak_end";
  event_id: string;
  audio?: string; // Optional final audio chunk
}

export interface HeyGenAgentInterruptEvent {
  type: "agent.interrupt";
  event_id: string;
}

export interface HeyGenAgentStartListeningEvent {
  type: "agent.start_listening";
  event_id: string;
}

export interface HeyGenAgentStopListeningEvent {
  type: "agent.stop_listening";
  event_id: string;
}

export interface HeyGenAgentAudioBufferClearEvent {
  type: "agent.audio_buffer_clear";
  event_id: string;
}

export interface HeyGenSessionKeepAliveEvent {
  type: "session.keep_alive";
  event_id: string;
}

export class HeyGenWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionId: string;
  private apiKey: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(sessionId: string, realtimeEndpoint: string, apiKey: string) {
    super();
    this.sessionId = sessionId;
    this.url = realtimeEndpoint;
    this.apiKey = apiKey;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Connecting to HeyGen WebSocket: ${this.url}`);
        this.ws = new WebSocket(this.url, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'User-Agent': 'HeyGen-Realtime-Client/1.0'
          }
        });

        this.ws.on('open', () => {
          console.log('HeyGen WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = typeof data === 'string' ? data : data.toString('utf8');
            const event: HeyGenWebSocketEvent = JSON.parse(message);
            this.handleEvent(event);
          } catch (error) {
            console.error('Failed to parse HeyGen WebSocket message:', error);
          }
        });

        this.ws.on('close', (code: number, reason: string) => {
          console.log(`HeyGen WebSocket closed: ${code} - ${reason}`);
          this.isConnected = false;
          this.stopHeartbeat();
          this.emit('disconnected', { code, reason });

          // Attempt to reconnect if not intentionally closed
          if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => {
              this.reconnectAttempts++;
              console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
              this.connect().catch(console.error);
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        });

        this.ws.on('error', (error) => {
          console.error('HeyGen WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  private handleEvent(event: HeyGenWebSocketEvent) {
    console.log('📥 HeyGen event received:', event.type, event.event_id);
    this.emit(event.type, event);
    this.emit('event', event);
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.sendKeepAlive();
    }, 30000); // Send keep alive every 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private generateEventId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Send audio chunk to HeyGen for avatar speech
   * Audio should be Base64 encoded PCM 16bit 24khz
   */
  sendSpeak(audio: string): string {
    const eventId = this.generateEventId();
    const event: HeyGenAgentSpeakEvent = {
      type: "agent.speak",
      event_id: eventId,
      audio
    };
    this.send(event);
    return eventId;
  }

  /**
   * Signal end of speech with optional final audio chunk
   */
  sendSpeakEnd(finalAudio?: string): string {
    const eventId = this.generateEventId();
    const event: HeyGenAgentSpeakEndEvent = {
      type: "agent.speak_end",
      event_id: eventId,
      audio: finalAudio
    };
    this.send(event);
    return eventId;
  }

  /**
   * Interrupt current avatar speech
   */
  sendInterrupt(): string {
    const eventId = this.generateEventId();
    const event: HeyGenAgentInterruptEvent = {
      type: "agent.interrupt",
      event_id: eventId
    };
    this.send(event);
    return eventId;
  }

  /**
   * Start avatar listening animation
   */
  sendStartListening(): string {
    const eventId = this.generateEventId();
    const event: HeyGenAgentStartListeningEvent = {
      type: "agent.start_listening",
      event_id: eventId
    };
    this.send(event);
    return eventId;
  }

  /**
   * Stop avatar listening animation
   */
  sendStopListening(): string {
    const eventId = this.generateEventId();
    const event: HeyGenAgentStopListeningEvent = {
      type: "agent.stop_listening",
      event_id: eventId
    };
    this.send(event);
    return eventId;
  }

  /**
   * Clear audio buffer
   */
  sendAudioBufferClear(): string {
    const eventId = this.generateEventId();
    const event: HeyGenAgentAudioBufferClearEvent = {
      type: "agent.audio_buffer_clear",
      event_id: eventId
    };
    this.send(event);
    return eventId;
  }

  /**
   * Send keep alive to prevent session timeout
   */
  sendKeepAlive(): string {
    const eventId = this.generateEventId();
    const event: HeyGenSessionKeepAliveEvent = {
      type: "session.keep_alive",
      event_id: eventId
    };
    this.send(event);
    return eventId;
  }

  private send(event: HeyGenWebSocketEvent) {
    if (this.ws && this.isConnected) {
      const message = JSON.stringify(event);
      this.ws.send(message);
      console.log('📤 Sent HeyGen event:', event.type, event.event_id);
      if (event.type === 'agent.speak') {
        console.log('🎵 Audio chunk size:', (event as any).audio?.length || 'no audio');
      }
    } else {
      console.warn('❌ HeyGen WebSocket not connected, cannot send event:', event.type, {
        wsExists: !!this.ws,
        isConnected: this.isConnected,
        readyState: this.ws?.readyState
      });
    }
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.isConnected = false;
  }

  isConnectionOpen(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  getSessionId(): string {
    return this.sessionId;
  }
}
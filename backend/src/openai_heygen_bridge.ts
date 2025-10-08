// backend/src/openai_heygen_bridge.ts
import { HeyGenWebSocketClient } from "./heygen_websocket";

export interface OpenAIEvent {
  type: string;
  text?: string;
  audio?: string; // Base64 encoded audio
  content?: string;
  [key: string]: any;
}

export class OpenAIHeyGenBridge {
  private heygenClient: HeyGenWebSocketClient | null = null;
  private currentSpeakEventId: string | null = null;
  private isListening = false;

  constructor(heygenClient: HeyGenWebSocketClient | null = null) {
    this.heygenClient = heygenClient;
    if (heygenClient) {
      this.setupHeyGenEventListeners();
    }
  }

  setHeyGenClient(client: HeyGenWebSocketClient) {
    this.heygenClient = client;
    this.setupHeyGenEventListeners();
  }

  private setupHeyGenEventListeners() {
    if (!this.heygenClient) return;

    // Listen to HeyGen events to track state
    this.heygenClient.on('agent.speak_started', (_event) => {
      console.log('HeyGen agent started speaking');
    });

    this.heygenClient.on('agent.speak_ended', (_event) => {
      console.log('HeyGen agent stopped speaking');
      this.currentSpeakEventId = null;
    });

    this.heygenClient.on('agent.speak_interrupted', (_event) => {
      console.log('HeyGen agent speech interrupted');
      this.currentSpeakEventId = null;
    });

    this.heygenClient.on('agent.idle_started', (_event) => {
      console.log('HeyGen agent entered idle state');
    });

    this.heygenClient.on('agent.idle_ended', (_event) => {
      console.log('HeyGen agent left idle state');
    });
  }

  /**
   * Process OpenAI events and map them to HeyGen actions
   */
  async processOpenAIEvent(event: OpenAIEvent): Promise<void> {
    console.log('🔵 Received OpenAI event:', event.type, event);

    if (!this.heygenClient || !this.heygenClient.isConnectionOpen()) {
      console.warn('⚠️ HeyGen client not available, skipping event processing');
      console.log('HeyGen client status:', {
        exists: !!this.heygenClient,
        isOpen: this.heygenClient?.isConnectionOpen()
      });
      return;
    }

    console.log('🟢 Processing OpenAI event:', event.type);

    switch (event.type) {
      case 'response.audio':
      case 'response.audio.delta':
        // Handle audio chunks from OpenAI
        console.log('🎵 Audio event details:', {
          hasAudio: !!event.audio,
          hasDelta: !!event.delta,
          hasItem: !!event.item,
          itemId: event.item?.id
        });

        // OpenAI Realtime API sends audio differently - check multiple possible fields
        const audioData = event.audio || event.delta;
        if (audioData) {
          this.handleOpenAIAudio(audioData);
        } else {
          console.log('⚠️ No audio data found in audio event');
        }
        break;

      case 'response.text':
      case 'response.text.delta':
        // Handle text responses from OpenAI
        console.log('💬 Text event details:', {
          hasText: !!event.text,
          hasDelta: !!event.delta,
          text: event.text?.substring(0, 100) + '...',
          delta: event.delta?.substring(0, 100) + '...'
        });

        const textData = event.text || event.delta;
        if (textData) {
          this.handleOpenAIText(textData);
        }
        break;

      case 'response.audio_transcript.done':
      case 'response.text.done':
        // Final transcript/text is ready
        console.log('📝 Final transcript/text:', event.text || event.transcript);
        break;

      case 'response.done':
        // OpenAI response is complete
        console.log('✅ Response completed');
        this.handleOpenAIResponseDone();
        break;

      case 'input_text':
        // User sent text input
        console.log('⌨️ User input text:', event.text || event.content);
        this.handleUserTextInput(event.text || event.content);
        break;

      case 'input_audio':
        // User started speaking
        console.log('🎤 User started speaking');
        this.handleUserAudioInput();
        break;

      case 'input_audio.stop':
        // User stopped speaking
        console.log('🔇 User stopped speaking');
        this.handleUserAudioStop();
        break;

      case 'error':
        console.error('❌ OpenAI error event:', event);
        break;

      default:
        console.log('❓ Unhandled OpenAI event type:', event.type, event);
    }
  }

  private handleOpenAIAudio(audio: string) {
    if (!this.heygenClient) return;

    console.log('🎵 Received OpenAI audio chunk, length:', audio.length);

    // If we're not currently speaking, start a new speech session
    if (!this.currentSpeakEventId) {
      this.currentSpeakEventId = this.heygenClient.sendSpeak(audio);
      console.log('🗣️ Started HeyGen speech with audio chunk, event_id:', this.currentSpeakEventId);
    } else {
      // Continue sending audio chunks for current speech
      this.heygenClient.sendSpeak(audio);
      console.log('📢 Continued HeyGen speech with audio chunk');
    }
  }

  private handleOpenAIText(text: string) {
    if (!this.heygenClient) return;

    // For text responses, we could either:
    // 1. Convert to speech using TTS and send as audio
    // 2. Display as subtitles or UI feedback
    // 3. Trigger appropriate avatar animations

    console.log('OpenAI text response:', text);
    // For now, we'll just log it. In a real implementation, you might
    // want to convert this to speech using a TTS service.
  }

  private handleOpenAIResponseDone() {
    if (!this.heygenClient) return;

    // Signal that the response is complete
    if (this.currentSpeakEventId) {
      this.heygenClient.sendSpeakEnd();
      this.currentSpeakEventId = null;
      console.log('Ended HeyGen speech session');
    }
  }

  private handleUserTextInput(text: string | undefined) {
    if (!this.heygenClient) return;

    const actualText = text || '';
    console.log('User input text:', actualText);

    // Start listening animation if avatar is idle
    if (!this.isListening) {
      this.heygenClient.sendStartListening();
      this.isListening = true;
      console.log('Started HeyGen listening animation');
    }

    // Clear any buffered audio to prepare for new response
    this.heygenClient.sendAudioBufferClear();
  }

  private handleUserAudioInput() {
    if (!this.heygenClient) return;

    console.log('User started speaking');

    // Interrupt any current avatar speech
    if (this.currentSpeakEventId) {
      this.heygenClient.sendInterrupt();
      this.currentSpeakEventId = null;
    }

    // Start listening animation
    if (!this.isListening) {
      this.heygenClient.sendStartListening();
      this.isListening = true;
    }
  }

  private handleUserAudioStop() {
    if (!this.heygenClient) return;

    console.log('User stopped speaking');

    // Stop listening animation
    if (this.isListening) {
      this.heygenClient.sendStopListening();
      this.isListening = false;
      console.log('Stopped HeyGen listening animation');
    }
  }

  /**
   * Manually trigger avatar to speak text
   * This could be used for TTS integration
   */
  async speakText(text: string, _voiceProvider?: string): Promise<void> {
    if (!this.heygenClient) {
      throw new Error('HeyGen client not available');
    }

    // In a real implementation, you would:
    // 1. Send text to TTS service (11 Labs, Cartesia, etc.)
    // 2. Get back base64 encoded audio
    // 3. Send audio to HeyGen using handleOpenAIAudio

    console.log('Would speak text if TTS was integrated:', text);

    // For now, we'll just trigger a speaking state without audio
    this.currentSpeakEventId = this.heygenClient.sendSpeak('');
    setTimeout(() => {
      if (this.currentSpeakEventId) {
        this.heygenClient?.sendSpeakEnd();
        this.currentSpeakEventId = null;
      }
    }, 1000); // Simulate 1 second of speech
  }

  /**
   * Interrupt current avatar speech
   */
  interrupt(): void {
    if (!this.heygenClient) return;

    if (this.currentSpeakEventId) {
      this.heygenClient.sendInterrupt();
      this.currentSpeakEventId = null;
      console.log('Manually interrupted HeyGen speech');
    }
  }

  /**
   * Start listening animation
   */
  startListening(): void {
    if (!this.heygenClient || this.isListening) return;

    this.heygenClient.sendStartListening();
    this.isListening = true;
    console.log('Manually started HeyGen listening');
  }

  /**
   * Stop listening animation
   */
  stopListening(): void {
    if (!this.heygenClient || !this.isListening) return;

    this.heygenClient.sendStopListening();
    this.isListening = false;
    console.log('Manually stopped HeyGen listening');
  }

  /**
   * Get current state
   */
  getState(): {
    isConnected: boolean;
    isSpeaking: boolean;
    isListening: boolean;
    currentSpeakEventId: string | null;
  } {
    return {
      isConnected: this.heygenClient?.isConnectionOpen() || false,
      isSpeaking: this.currentSpeakEventId !== null,
      isListening: this.isListening,
      currentSpeakEventId: this.currentSpeakEventId
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.currentSpeakEventId = null;
    this.isListening = false;
    if (this.heygenClient) {
      this.heygenClient.disconnect();
      this.heygenClient = null;
    }
  }
}
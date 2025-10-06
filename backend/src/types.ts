export interface VoiceSettings {
  rate: number;
}

export interface STTSettings {
  provider: string;
  confidence: number;
}

export interface CreateSessionRequest {
  quality?: string;
  voice?: VoiceSettings;
  video_encoding?: string;
  disable_idle_timeout?: boolean;
  version?: string;
  stt_settings?: STTSettings;
  activity_idle_timeout?: number;
}

export interface HeyGenSessionData {
  session_id: string;
  sdp: any;
  access_token: string;
  livekit_agent_token: string;
  url: string;
  ice_servers: any;
  ice_servers2: any;
  is_paid: boolean;
  session_duration_limit: number;
  realtime_endpoint: string;
}

export interface SessionResponse {
  code: number;
  data: HeyGenSessionData;
  message: string;
}
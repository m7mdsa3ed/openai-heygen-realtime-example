// frontend/src/App.tsx
import React, { useRef, useState } from "react";
import axios from "axios";
import { Room, RoomEvent } from "livekit-client";

function App() {
  const [session, setSession] = useState<any>(null);
  const [webrtcSession, setWebrtcSession] = useState<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("idle");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [room, setRoom] = useState<any>(null);
  const [avatars, setAvatars] = useState<any[]>([]);
  const [selectedAvatar, setSelectedAvatar] = useState<string>("");
  const [isWebRTCConnected, setIsWebRTCConnected] = useState(false);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Fetch available avatars on component mount
  React.useEffect(() => {
    async function fetchAvatars() {
      try {
        const resp = await axios.get("http://localhost:5000/api/heygen/avatars");
        if (resp.data.code === 100 && resp.data.data) {
          setAvatars(resp.data.data);
          if (resp.data.data.length > 0) {
            setSelectedAvatar(resp.data.data[0].avatar_id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch avatars:", error);
      }
    }
    fetchAvatars();
  }, []);

  // Cleanup WebRTC on unmount
  React.useEffect(() => {
    return () => {
      cleanupWebRTC();
    };
  }, []);

  async function connectToLiveKit(newRoom: any, url: string, token: string) {
    // Set up event listeners before connecting
    newRoom.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
      console.log("Track subscribed:", track.kind, track.sid);

      if (track.kind === "video") {
        const stream = new MediaStream();
        stream.addTrack(track.mediaStreamTrack);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          console.log("Video stream connected to element");
        }
      }

      // Also handle audio tracks
      if (track.kind === "audio") {
        console.log("Audio track received");
      }
    });

    newRoom.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log("Participant connected:", participant.identity);
    });

    newRoom.on(RoomEvent.Connected, () => {
      console.log("Room connected successfully");
    });

    newRoom.on(RoomEvent.Disconnected, () => {
      console.log("Room disconnected");
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    });

    await newRoom.connect(url, token);
  }

  async function setupWebRTCConnection() {
    try {
      setStatus("Setting up WebRTC connection...");

      // Get a session token for OpenAI Realtime API
      const tokenResponse = await fetch("http://localhost:5000/token");
      const tokenData = await tokenResponse.json();
      const EPHEMERAL_KEY = tokenData.value;

      // Create a peer connection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" }
        ]
      });
      peerConnectionRef.current = pc;

      // Set up to play remote audio from OpenAI
      audioRef.current = document.createElement("audio");
      audioRef.current.autoplay = true;
      pc.ontrack = (e) => {
        console.log("Received remote track:", e.track.kind);
        if (e.streams[0]) {
          audioRef.current.srcObject = e.streams[0];
        }
      };

      // Add local audio track for microphone input
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      pc.addTrack(ms.getTracks()[0]);

      // Set up data channel for sending and receiving events
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.onopen = () => {
        console.log("Data channel opened");
        setIsWebRTCConnected(true);
      };

      dc.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received data channel message:", data);

          // Handle different types of responses from OpenAI
          if (data.type === 'response.text') {
            // You can handle text responses here if needed
            console.log("OpenAI text response:", data.text);
          }

          // Forward events to HeyGen if we have a session
          if (webrtcSession?.sessionId && data.type === 'response.text') {
            try {
              await axios.post("http://localhost:5000/api/realtime/events", {
                sessionId: webrtcSession.sessionId,
                event: {
                  type: "input_text",
                  content: data.text
                }
              });
            } catch (error) {
              console.error("Error forwarding to HeyGen:", error);
            }
          }
        } catch (error) {
          console.error("Error parsing data channel message:", error);
        }
      };

      dc.onerror = (error) => {
        console.error("Data channel error:", error);
      };

      // Start the session using the Session Description Protocol (SDP)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`OpenAI SDP negotiation failed: ${sdpResponse.statusText}`);
      }

      const answer = {
        type: "answer",
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);

      setStatus("WebRTC connected to OpenAI");
      return pc;
    } catch (error) {
      console.error("WebRTC setup error:", error);
      setStatus("Failed to setup WebRTC");
      throw error;
    }
  }

  function sendDataToOpenAI(event: any) {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(event));
    } else {
      console.error("Data channel not available");
    }
  }

  async function cleanupWebRTC() {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (dataChannelRef.current) {
      dataChannelRef.current = null;
    }
    setIsWebRTCConnected(false);

    // Clean up session on backend
    if (webrtcSession?.sessionId) {
      try {
        await fetch(`http://localhost:5000/session/${webrtcSession.sessionId}`, {
          method: "DELETE"
        });
      } catch (error) {
        console.error("Error cleaning up session:", error);
      }
    }
    setWebrtcSession(null);
  }

  async function createSession() {
    try {
      setStatus("Creating WebRTC connection to OpenAI...");

      // Setup direct WebRTC connection to OpenAI
      await setupWebRTCConnection();

      setSessionStarted(false);
      setStatus("OpenAI WebRTC session created");
    } catch (error) {
      console.error("Failed to create session:", error);
      setStatus("failed to create session");
    }
  }

  async function startSession() {
    try {
      if (!isWebRTCConnected) {
        setStatus("Please create OpenAI session first");
        return;
      }

      setStatus("Setting up HeyGen session...");

      // Create HeyGen session for avatar
      const resp = await axios.post("http://localhost:5000/api/session/create", {
        character: selectedAvatar,
        voice: "en_us_male_2"
      });

      const sessionData = resp.data;
      if (sessionData.success) {
        setWebrtcSession({ sessionId: sessionData.sessionId });

        if (sessionData.heygenData) {
          console.log("HeyGen session data:", sessionData.heygenData);
          setSession(sessionData.heygenData);

          // Connect to LiveKit for video
          const newRoom = new Room();
          await connectToLiveKit(newRoom, sessionData.heygenData.url, sessionData.heygenData.livekit_agent_token);
          setRoom(newRoom);

          setSessionStarted(true);
          setStatus("Session started - OpenAI WebRTC + HeyGen Avatar active");
        } else {
          setSessionStarted(true);
          setStatus("OpenAI WebRTC session active (no HeyGen)");
        }
      }
    } catch (error) {
      console.error("Failed to start session:", error);
      setStatus("failed to start session");
    }
  }

  async function ask() {
    if (!isWebRTCConnected) return alert("Create OpenAI session first");
    if (!prompt.trim()) return alert("Please enter a message");

    try {
      setStatus("sending message...");

      // Send message directly to OpenAI via data channel
      sendDataToOpenAI({
        type: "input_text",
        content: prompt
      });

      // Forward to HeyGen via our backend if we have a session
      if (webrtcSession?.sessionId) {
        try {
          await axios.post("http://localhost:5000/api/realtime/events", {
            sessionId: webrtcSession.sessionId,
            event: {
              type: "input_text",
              content: prompt
            }
          });
        } catch (error) {
          console.error("Error forwarding to HeyGen:", error);
        }
      }

      setPrompt("");
      setStatus("message sent via WebRTC");
    } catch (error) {
      console.error("Failed to send message:", error);
      setStatus("failed to send message");
    }
  }

  async function closeSession() {
    setStatus("closing session...");

    try {
      // Cleanup WebRTC connection
      await cleanupWebRTC();

      // Disconnect from LiveKit room first
      if (room) {
        room.disconnect();
        setRoom(null);
      }

      // Clear video and audio elements
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (audioRef.current) {
        audioRef.current.srcObject = null;
      }

      setSession(null);
      setSessionStarted(false);
      setStatus("session closed");
    } catch (error) {
      console.error("Failed to close session:", error);
      setStatus("failed to close session");
    }
  }

  async function sendTask() {
    if (!session || !sessionStarted) return alert("Create and start session first");
    if (!taskText.trim()) return alert("Please enter task text");
    setStatus("sending task...");
    await axios.post("http://localhost:5000/api/heygen/task", {
      sessionId: session.session_id,
      text: taskText,
    });
    setTaskText("");
    setStatus("task sent");
  }

  async function stop() {
    if (!session) return;
    try {
      await axios.post("http://localhost:5000/api/heygen/stop", { sessionId: session.session_id });
      setStatus("stopped");
    } catch (error) {
      console.error("Failed to stop:", error);
      setStatus("failed to stop");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">WebRTC Realtime Avatar</h1>
          <p className="text-gray-600">Interactive AI conversations with OpenAI Realtime + HeyGen</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Controls */}
          <div className="space-y-6">
            {/* Avatar Selection Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">1. Choose Your Avatar</h2>
              {avatars.length === 0 ? (
                <div className="flex items-center justify-center p-8 border-2 border-dashed border-gray-300 rounded-lg">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                    <p className="text-gray-500">Loading available avatars...</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <select
                    value={selectedAvatar}
                    onChange={(e) => setSelectedAvatar(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {avatars.map((avatar) => (
                      <option key={avatar.avatar_id} value={avatar.avatar_id}>
                        {avatar.pose_name || avatar.avatar_id}
                      </option>
                    ))}
                  </select>
                  {selectedAvatar && avatars.find(a => a.avatar_id === selectedAvatar)?.normal_preview && (
                    <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                      <img
                        src={avatars.find(a => a.avatar_id === selectedAvatar)?.normal_preview}
                        alt="Avatar preview"
                        className="w-20 h-20 object-cover rounded-lg shadow-md"
                      />
                      <div>
                        <p className="font-medium text-gray-700">Selected Avatar</p>
                        <p className="text-sm text-gray-500">
                          {avatars.find(a => a.avatar_id === selectedAvatar)?.pose_name || selectedAvatar}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Session Controls Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">2. Start Token-Based Session</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={createSession}
                  className="px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all transform hover:scale-105 font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  1. Connect OpenAI
                </button>
                <button
                  onClick={startSession}
                  disabled={!isWebRTCConnected}
                  className="px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all transform hover:scale-105 font-medium disabled:bg-gray-300 disabled:cursor-not-allowed disabled:transform-none"
                >
                  2. Add Avatar
                </button>
                <button
                  onClick={closeSession}
                  disabled={!sessionStarted && !isWebRTCConnected}
                  className="px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all transform hover:scale-105 font-medium disabled:bg-gray-300 disabled:cursor-not-allowed disabled:transform-none"
                >
                  End Session
                </button>
              </div>
              {isWebRTCConnected && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                    <span className="text-sm text-blue-700 font-medium">🔗 OpenAI WebRTC Connected</span>
                  </div>
                </div>
              )}
              {sessionStarted && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                    <span className="text-sm text-green-700 font-medium">🎭 HeyGen Avatar Active</span>
                  </div>
                </div>
              )}
            </div>

            {/* Task Input Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">3. Send Task</h2>
              <textarea
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                placeholder="Give your avatar a task or instruction..."
                rows={3}
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                onClick={sendTask}
                disabled={!sessionStarted || !taskText.trim()}
                className="mt-3 w-full px-4 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-all transform hover:scale-105 font-medium disabled:bg-gray-300 disabled:cursor-not-allowed disabled:transform-none"
              >
                Send Task to Avatar
              </button>
            </div>

            {/* Realtime Chat Input Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">4. Realtime Chat</h2>
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  🔗 Token-based WebRTC connection to OpenAI + HeyGen Avatar
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Messages are sent directly to OpenAI via WebRTC data channel
                </p>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Type your message here (it will be sent via WebRTC)..."
                rows={3}
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <div className="flex gap-3 mt-3">
                <button
                  onClick={ask}
                  disabled={!isWebRTCConnected || !prompt.trim()}
                  className="flex-1 px-4 py-3 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-all transform hover:scale-105 font-medium disabled:bg-gray-300 disabled:cursor-not-allowed disabled:transform-none"
                >
                  Send via WebRTC
                </button>
                <button
                  onClick={stop}
                  className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-all transform hover:scale-105 font-medium"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>

          {/* Right Column - Video & Status */}
          <div className="space-y-6">
            {/* Video Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Avatar Video Feed</h2>
              <div className="relative bg-gray-900 rounded-lg overflow-hidden">
                {sessionStarted ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    controls
                    className="w-full aspect-video rounded-lg"
                  />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center bg-gray-100">
                    <div className="text-center">
                      <div className="text-gray-400 mb-2">
                        <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <p className="text-gray-500">Video will appear here when session starts</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Status Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Session Status</h2>
              <div className={`p-4 rounded-lg ${isWebRTCConnected ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                <div className="flex items-center">
                  <div className={`w-3 h-3 rounded-full mr-3 ${isWebRTCConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
                  <span className={`font-medium ${isWebRTCConnected ? 'text-green-700' : 'text-yellow-700'}`}>
                    {status}
                  </span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 text-sm">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-gray-500 mb-1">WebRTC Session</p>
                  <p className="font-mono text-xs text-gray-700">
                    {webrtcSession?.sessionId || 'Not created'}
                  </p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-gray-500 mb-1">HeyGen Session</p>
                  <p className="font-mono text-xs text-gray-700">
                    {session?.session_id || 'Not created'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-gray-500 mb-1">WebRTC</p>
                    <p className="font-medium text-gray-700">
                      {isWebRTCConnected ? '🟢 Connected' : '🔴 Disconnected'}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-gray-500 mb-1">HeyGen</p>
                    <p className="font-medium text-gray-700">
                      {sessionStarted ? '🟢 Active' : '🔴 Inactive'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

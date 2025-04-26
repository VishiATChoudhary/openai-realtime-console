import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";
import Webcam from "./Webcam";
import Timer from "./Timer";
import LogDeletionControl from "./LogDeletionControl";
import GeminiControl from "./GeminiControl";

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const peerConnection = useRef(null);
  const audioElement = useRef(null);
  const eventQueue = useRef([]);

  // Define available functions
  const fns = {
    getLogs: ({ count = 5 }) => {
      return { 
        success: true, 
        logs: events.slice(0, count).map(event => ({
          type: event.type,
          timestamp: event.timestamp,
          content: event.item?.content || event.response?.output || event
        }))
      };
    },
    updateSystemPrompt: ({ context }) => {
      const systemPrompt = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `You are a helpful AI assistant that provides conversational descriptions of what you see in images. Based on the latest image logs, you are currently seeing:

${context}

Your role is to:
- Describe what you see in a natural, conversational way
- Update your understanding of the scene based on new image logs
- Engage in dialogue about the scene and its context
- Be observant of changes in the environment or person's state

Please maintain a friendly and engaging tone while describing the scene.`,
            },
          ],
        },
      };
      sendClientEvent(systemPrompt);
      return { success: true, context };
    }
  };

  // Function to flush queued events when data channel is ready
  const flushQueue = () => {
    while (eventQueue.current.length > 0) {
      const event = eventQueue.current.shift();
      sendClientEvent(event);
    }
  };

  // Function to queue events when data channel is not ready
  const queueEvent = (event) => {
    eventQueue.current.push(event);
  };

  // Function to update system prompt based on latest logs
  const updateSystemPrompt = (latestLogs) => {
    if (!latestLogs || latestLogs.length < 2) return;
    
    // Get the last two entries from the array
    const lastTwoLogs = latestLogs.slice(-2);
    const context = lastTwoLogs.map(log => {
      // Extract the caption from the log entry
      const caption = log.caption || '';
      // Clean up the caption by removing markdown formatting
      return caption.replace(/\*\*/g, '').replace(/\*/g, '');
    }).join('\n\n');
    
    fns.updateSystemPrompt({ context });
  };

  async function startSession() {
    try {
      // Get a session token for OpenAI Realtime API
      const tokenResponse = await fetch("/token");
      if (!tokenResponse.ok) {
        throw new Error(`Failed to get token: ${tokenResponse.statusText}`);
      }
      const data = await tokenResponse.json();
      const EPHEMERAL_KEY = data.client_secret.value;

      // Create a peer connection with more robust configuration
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      // Set up connection state change handler
      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          console.log("Connection failed or disconnected, attempting to restart...");
          stopSession();
          startSession();
        }
      };

      // Set up ICE connection state change handler
      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          console.log("ICE connection failed, attempting to restart...");
          stopSession();
          startSession();
        }
      };

      // Set up to play remote audio from the model
      audioElement.current = document.createElement("audio");
      audioElement.current.autoplay = true;
      pc.ontrack = (e) => (audioElement.current.srcObject = e.streams[0]);

      // Add local audio track for microphone input in the browser
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      pc.addTrack(ms.getTracks()[0]);

      // Set up data channel for sending and receiving events
      const dc = pc.createDataChannel("oai-events", {
        ordered: true,
        maxRetransmits: 3
      });
      setDataChannel(dc);

      // Start the session using the Session Description Protocol (SDP)
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`Failed to get SDP response: ${sdpResponse.statusText}`);
      }

      // Add system prompt to the session with dynamic image context
      const systemPrompt = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `You are a helpful AI assistant that provides conversational descriptions of what you see in images. Based on the latest image logs, you are currently seeing:

              ${events.slice(-2).map(log => {
                const caption = log.caption || '';
                return caption.replace(/\*\*/g, '').replace(/\*/g, '');
              }).join('\n\n')}

              Your role is to:
              - Describe what you see in a natural, conversational way
              - Update your understanding of the scene based on new image logs
              - Engage in dialogue about the scene and its context
              - Be observant of changes in the environment or person's state

              Please maintain a friendly and engaging tone while describing the scene.`,
            },
          ],
        },
      };

      // Add tools to the session
      const toolsUpdate = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          tools: [
            {
              type: "function",
              name: "getLogs",
              description: "Retrieves the latest event logs from the session",
              parameters: {
                type: "object",
                properties: {
                  count: {
                    type: "integer",
                    description: "Number of recent logs to retrieve",
                  },
                },
                required: ["count"],
              },
            },
            {
              type: "function",
              name: "updateSystemPrompt",
              description: "Updates the system prompt with new context",
              parameters: {
                type: "object",
                properties: {
                  context: {
                    type: "string",
                    description: "New context to update the system prompt with",
                  },
                },
                required: ["context"],
              },
            },
          ],
          tool_choice: "auto",
        },
      };

      // Create initial assistant message to start the conversation
      const initialMessage = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "input_text",
              text: "Hello! I can see you're in a study environment. Would you like me to describe what I'm seeing in more detail?",
            },
          ],
        },
      };

      const answer = {
        type: "answer",
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);

      peerConnection.current = pc;

      // Queue the initialization messages to be sent when the data channel is ready
      queueEvent(systemPrompt);
      // Add a small delay before sending tools update
      setTimeout(() => {
        queueEvent(toolsUpdate);
        queueEvent(initialMessage);
        queueEvent({ type: "response.create" }); // Request a response from the assistant
      }, 100);

    } catch (error) {
      console.error("Error starting session:", error);
      // Clean up any resources that might have been created
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      if (dataChannel) {
        dataChannel.close();
        setDataChannel(null);
      }
      setIsSessionActive(false);
      throw error; // Re-throw to be handled by the caller
    }
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    try {
      if (dataChannel) {
        // Check if the data channel is still open before closing
        if (dataChannel.readyState === 'open') {
          dataChannel.close();
        }
      }

      if (peerConnection.current) {
        // Stop all tracks
        peerConnection.current.getSenders().forEach((sender) => {
          if (sender.track) {
            sender.track.stop();
          }
        });

        // Close the peer connection
        if (peerConnection.current.connectionState !== 'closed') {
          peerConnection.current.close();
        }
      }

      setIsSessionActive(false);
      setDataChannel(null);
      peerConnection.current = null;
      eventQueue.current = []; // Clear the event queue
    } catch (error) {
      console.error("Error stopping session:", error);
    }
  }

  // Send a message to the model
  function sendClientEvent(message) {
    if (dataChannel) {
      const timestamp = new Date().toLocaleTimeString();
      message.event_id = message.event_id || crypto.randomUUID();

      // send event before setting timestamp since the backend peer doesn't expect this field
      dataChannel.send(JSON.stringify(message));

      // if guard just in case the timestamp exists by miracle
      if (!message.timestamp) {
        message.timestamp = timestamp;
      }
      setEvents((prev) => [message, ...prev]);
    } else {
      console.warn("Data channel not ready, queuing event");
      queueEvent(message);
    }
  }

  // Send a text message to the model
  function sendTextMessage(message) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", async (e) => {
        const event = JSON.parse(e.data);
        if (!event.timestamp) {
          event.timestamp = new Date().toLocaleTimeString();
        }

        // Handle function calls
        if (event.type === "response.function_call_arguments.done") {
          const fn = fns[event.name];
          if (fn !== undefined) {
            console.log(`Calling local function ${event.name} with ${event.arguments}`);
            const args = JSON.parse(event.arguments);
            const result = await fn(args);
            console.log('result', result);
            
            // Let OpenAI know that the function has been called and share its output
            const functionResult = {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: event.call_id,
                output: JSON.stringify(result),
              },
            };
            sendClientEvent(functionResult);
            
            // Have assistant respond after getting the results
            sendClientEvent({ type: "response.create" });
          }
        }

        // Handle streaming responses
        if (event.type === "response.done") {
          // Ensure we have a complete response
          if (event.response && event.response.output) {
            const output = event.response.output;
            if (Array.isArray(output)) {
              // Process each part of the output
              output.forEach(part => {
                if (part.type === "text" || part.type === "input_text") {
                  console.log("Complete response:", part.text);
                }
              });
            }
          }
        }

        setEvents((prev) => {
          const newEvents = [event, ...prev];
          // Update system prompt when new logs are received
          if (event.type === "log.update") {
            updateSystemPrompt(newEvents);
          }
          return newEvents;
        });
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        console.log("Data channel opened");
        setIsSessionActive(true);
        setEvents([]);
        flushQueue(); // now safe to send buffered events such as systemPrompt
      });

      // Handle data channel errors
      dataChannel.addEventListener("error", (error) => {
        // The "User-Initiated Abort" error is not a serious issue. It is
        // a normal error that happens when the data channel is closed by
        // either party. Therefore, we will not log it as an error in the console.
        if (error.error?.message !== "User-Initiated Abort") {
          console.error("Data channel error:", error);
        } else {
          console.log("Data channel closed due to User-Initiated Abort.");
        }
      });

      // Handle data channel closure
      dataChannel.addEventListener("close", () => {
        console.log("Data channel closed");
        setIsSessionActive(false);
      });

      // Handle data channel buffering
      dataChannel.addEventListener("bufferedamountlow", () => {
        console.log("Data channel buffer is low");
      });

      // Handle data channel state changes
      dataChannel.addEventListener("statechange", () => {
        console.log("Data channel state changed to:", dataChannel.readyState);
      });
    }
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>realtime console</h1>
          <Timer isSessionActive={isSessionActive} />
          <LogDeletionControl />
          <GeminiControl />
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex">
          <section className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <EventLog events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              events={events}
              isSessionActive={isSessionActive}
            />
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          <div className="flex flex-col h-full">
            <div className="flex-1 mb-4">
              <Webcam />
            </div>
            <div className="flex-1">
              <ToolPanel
                sendClientEvent={sendClientEvent}
                sendTextMessage={sendTextMessage}
                events={events}
                isSessionActive={isSessionActive}
              />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

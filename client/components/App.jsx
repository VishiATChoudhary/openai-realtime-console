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
  };

  async function startSession() {
    // Get a session token for OpenAI Realtime API
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

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
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
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

1. A person in a library/study environment
2. The person is wearing headphones
3. The setting is a bright, open space or university atrium
4. The person appears to be in a contemplative or focused state

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

    // Make the LLM initiate the conversation
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
    sendClientEvent(initialMessage);

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    peerConnection.current.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });

    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
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
      console.error(
        "Failed to send message - no data channel available",
        message,
      );
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
      dataChannel.addEventListener("message", (e) => {
        const event = JSON.parse(e.data);
        if (!event.timestamp) {
          event.timestamp = new Date().toLocaleTimeString();
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
        setIsSessionActive(true);
        setEvents([]);
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

import { useEffect, useRef, useState } from 'react';
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";

export default function Webcam() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [isWebcamEnabled, setIsWebcamEnabled] = useState(true);
  const [geminiResponse, setGeminiResponse] = useState('');

  useEffect(() => {
    let stream = null;
    let intervalId = null;

    const startWebcam = async () => {
      if (!isWebcamEnabled) {
        setIsWebcamActive(false);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsWebcamActive(true);
        }
      } catch (err) {
        console.error('Error accessing webcam:', err);
      }
    };

    const captureAndSendFrame = async () => {
      if (!isWebcamEnabled || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw current video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        // Convert canvas to blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
        
        // Create FormData and append the image
        const formData = new FormData();
        formData.append('file', blob, 'frame.jpg');

        // Send to your backend endpoint that will handle Gemini API
        const response = await fetch('/api/analyze-frame', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          setGeminiResponse(data.caption);
        }
      } catch (error) {
        console.error('Error sending frame to Gemini:', error);
      }
    };

    if (isWebcamEnabled) {
      startWebcam();
      // Start capturing frames every 2 seconds
      intervalId = setInterval(captureAndSendFrame, 2000);
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isWebcamEnabled]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Webcam Feed</h2>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={isWebcamEnabled}
            onChange={(e) => setIsWebcamEnabled(e.target.checked)}
            className="form-checkbox h-5 w-5 text-blue-600"
          />
          <span>Enable Webcam</span>
        </label>
      </div>
      <div className="relative w-full h-[calc(100%-2rem)] bg-gray-100 rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        {!isWebcamActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-50 text-white">
            <p>Webcam not available</p>
          </div>
        )}
      </div>
      {geminiResponse && (
        <div className="mt-4 p-4 bg-gray-100 rounded-lg">
          <h3 className="font-semibold mb-2">Gemini Analysis:</h3>
          <p>{geminiResponse}</p>
        </div>
      )}
    </div>
  );
} 
import express from "express";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import multer from "multer";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
} from "@google/genai";
import path from "path";

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const googleApiKey = process.env.GOOGLE_API_KEY;

// Global settings
let shouldDeleteLogs = true;
let isGeminiEnabled = true;

// Configure multer for handling file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Configure Vite middleware for React client
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});
app.use(vite.middlewares);

// Function to delete log file
const deleteLogFile = () => {
  if (!shouldDeleteLogs) {
    console.log('Log deletion is disabled');
    return;
  }
  
  const logFilePath = path.join(process.cwd(), 'logs', 'gemini-responses.json');
  try {
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
      console.log('Log file deleted successfully');
    }
  } catch (error) {
    console.error('Error deleting log file:', error);
  }
};

// Endpoint to toggle log deletion
app.post('/api/toggle-log-deletion', (req, res) => {
  shouldDeleteLogs = !shouldDeleteLogs;
  res.json({ shouldDeleteLogs });
});

// Endpoint to get current log deletion setting
app.get('/api/log-deletion-setting', (req, res) => {
  res.json({ shouldDeleteLogs });
});

// Endpoint to toggle Gemini functionality
app.post('/api/toggle-gemini', (req, res) => {
  isGeminiEnabled = !isGeminiEnabled;
  res.json({ isGeminiEnabled });
});

// Endpoint to get current Gemini setting
app.get('/api/gemini-setting', (req, res) => {
  res.json({ isGeminiEnabled });
});

// Handle server shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  deleteLogFile();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  deleteLogFile();
  process.exit(0);
});

// API route for token generation
app.get("/token", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "verse",
        }),
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// API route for frame analysis with Gemini
app.post("/api/analyze-frame", upload.single('file'), async (req, res) => {
  try {
    if (!isGeminiEnabled) {
      return res.status(200).json({ caption: "Gemini analysis is disabled" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!googleApiKey) {
      console.error("Google API key is not configured");
      return res.status(500).json({ error: "Google API key is not configured" });
    }

    const ai = new GoogleGenAI({ apiKey: googleApiKey });
    
    // Convert buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log("Sending image to Gemini API...");
    console.log("Image size:", req.file.size, "bytes");
    console.log("MIME type:", mimeType);

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          },
          { text: "Caption this image." }
        ]
      }]
    });

    console.log("Gemini API response:", response);
    
    // Extract the text from the response
    const caption = response.candidates[0].content.parts[0].text;
    console.log("Extracted caption:", caption);

    // Save response to log file with timestamp
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      caption,
      imageSize: req.file.size,
      mimeType
    };

    const logFilePath = path.join(process.cwd(), 'logs', 'gemini-responses.json');
    let existingLogs = [];
    
    try {
      if (fs.existsSync(logFilePath)) {
        const fileContent = fs.readFileSync(logFilePath, 'utf-8');
        existingLogs = JSON.parse(fileContent);
      }
    } catch (error) {
      console.error('Error reading existing logs:', error);
    }

    existingLogs.push(logEntry);
    fs.writeFileSync(logFilePath, JSON.stringify(existingLogs, null, 2));

    res.json({ caption });
  } catch (error) {
    console.error("Gemini analysis error:", error);
    console.error("Error details:", error.cause || error.message);
    res.status(500).json({ 
      error: "Failed to analyze frame",
      details: error.message
    });
  }
});

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    const template = await vite.transformIndexHtml(
      url,
      fs.readFileSync("./client/index.html", "utf-8"),
    );
    const { render } = await vite.ssrLoadModule("./client/entry-server.jsx");
    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e);
    next(e);
  }
});

const server = app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});

// Handle server shutdown
server.on('close', () => {
  console.log('Server is shutting down');
  deleteLogFile();
});

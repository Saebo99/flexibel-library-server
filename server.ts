import express, { Request, Response } from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = 3000;

// Initialize middleware
app.use(express.json()); // This will allow the server to parse JSON payloads
app.use(cors()); // Allow all origins for now (restrict in production)

const openai = new OpenAI({
  apiKey: "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",
});

app.get("/", (req: Request, res: Response) => {
  res.send("Welcome to the OpenAI Chat API!");
});

app.post("/api/chat", async (req: Request, res: Response) => {
  const { messages } = req.body;
  console.log("messages: ", messages);

  // Ensure messages are provided
  if (!messages) {
    return res.status(400).json({ error: "Messages are required" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
      stream: true,
    });

    // Stream the response to the client
    for await (const chunk of completion) {
      console.log("Received chunk:", chunk);

      // Check for valid content in the chunk
      if (
        chunk &&
        chunk.choices &&
        chunk.choices[0] &&
        chunk.choices[0].delta &&
        chunk.choices[0].delta.content
      ) {
        res.write(JSON.stringify(chunk.choices[0].delta.content));
      } else if (chunk.choices[0].finish_reason === "stop") {
        console.warn("Received stop signal from OpenAI.");
        break; // Exit the loop if OpenAI sends a 'stop' signal
      }
    }
    res.end();
  } catch (error) {
    // Only send a response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interacting with OpenAI" });
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});

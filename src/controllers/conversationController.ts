import { Request, Response } from "express";
import {
  createConversation,
  endConversation,
  getConversationDetails,
} from "../models/conversationModel";
import { validateApiKey } from "../models/apiKeyModel"; // Assuming you have a model for API key validation

export const createConversationController = async (
  req: Request,
  res: Response
) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const projectId = await validateApiKey(apiKey);

    const newConversationId = await createConversation(projectId);

    res.json({ conversationId: newConversationId });
  } catch (error) {
    console.error("Error creating new conversation:", error);
    res.status(500).send("Failed to create new conversation");
  }
};

export const endConversationController = async (
  req: Request,
  res: Response
) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { conversationId } = req.body;

  if (!apiKey) {
    return res.status(401).send("Unauthorized");
  }

  if (!conversationId) {
    return res.status(400).send("Conversation ID is required");
  }

  try {
    await validateApiKey(apiKey);

    await endConversation(conversationId);

    res.json({ message: "Conversation successfully ended.", conversationId });
  } catch (error) {
    console.error("Error ending conversation:", error);
    res.status(500).send("Failed to end conversation");
  }
};

export const retrieveConversationController = async (
  req: Request,
  res: Response
) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { conversationId } = req.body;

  if (!apiKey) {
    return res.status(401).send("Unauthorized");
  }

  if (!conversationId) {
    return res.status(400).send("Conversation ID is required");
  }

  try {
    await validateApiKey(apiKey);

    const conversationDetails = await getConversationDetails(conversationId);

    res.json(conversationDetails);
  } catch (error) {
    console.error("Error retrieving conversation:", error);
    res.status(500).send("Failed to retrieve conversation");
  }
};

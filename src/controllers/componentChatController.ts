import { Request, Response } from "express";
const crypto = require("crypto");
const admin = require("firebase-admin");
import { db } from "../firebase/db";
import {
  queryDB,
  updateConversationAndMetrics,
  updateLikesDislikes,
  getRelevantData
} from "../models/chatModels";
import { llm } from "../utils/openai";
import { validateClientKey } from "../models/apiKeyModel";
import { createConversation } from "../models/conversationModel";

// chat Route code
export const componentPostChat = async (req: Request, res: Response) => {
  const clientKey = req.headers.authorization?.replace("Bearer ", "");
  const { messages, conversationId } = req.body; // Include conversationId in the request body

  if (!clientKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const projectId = await validateClientKey(clientKey);

    // Retrieve or create conversation document
    let conversationDocRef;
    if (conversationId) {
      // If a conversationId is provided, retrieve the existing conversation
      conversationDocRef = db.collection("conversations").doc(conversationId);
      const conversationDoc = await conversationDocRef.get();
      if (!conversationDoc.exists) {
        return res.status(404).send("Conversation not found");
      }
    } else {
      const newConversationId = await createConversation(projectId);
      conversationDocRef = db
        .collection("conversations")
        .doc(newConversationId);
    }

    // Fetching the document with the given projectId from the projects collection
    const projectDocRef = db.collection("projects").doc(projectId);
    const projectDocSnapshot = await projectDocRef.get();

    if (!projectDocSnapshot.exists) {
      console.error("Project document not found for the given projectId.");
      // Handle the error as needed
      return;
    }

    const models = projectDocSnapshot.data().models;
    // content of the final message in messages
    const queryParam = messages[messages.length - 1].content;

    // Ensure messages are provided
    if (!messages) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const { relatedDocs, similarityScore }: any = await queryDB(queryParam, projectId);
    console.log("queried DB: ", relatedDocs)

    // Find the key that has a value equal to true within the models object
    const modelKey = Object.keys(models).find((key) => models[key] === true);

    if (!modelKey) {
      res.status(400).send("No valid model key found");
      return;
    }

    // Use the retrieved key to get the model document from the Firestore database
    const modelDocRef = db.collection("models").doc(modelKey);
    const modelDoc = await modelDocRef.get();

    if (!modelDoc.exists) {
      res.status(400).send("Model not found");
      return;
    }
    const modelData = modelDoc.data();

    // Extract the last 4 messages (excluding the last one)
    const chatHistory = messages
      .slice(-5, -1)
      .map((msg: any) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const systemPrompt = modelData.prompt || "You are a helpful assistant.";
    const userPrompt = messages[messages.length - 1].content;

    res.setHeader("Content-Type", "application/json; charset=utf-8");

    let responseContent = "";

    // llm.stream() yields tokens one by one
    const stream = await llm.stream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]
    );

    for await (const chunk of stream) {
      if (chunk?.content) {
        responseContent += chunk.content;
        res.write(JSON.stringify(chunk.content));
      }
    }

    // After the OpenAI stream is completed and before closing the response
    if (!conversationId) {
      // Only send the new conversation ID if one was not provided in the request
      res.write(`[NEW_CONVERSATION_ID]
${conversationDocRef.id}
[END_OF_OPENAI_RESPONSE]
${relatedDocs.map((doc: any) => doc.metadata?.source).join(",")}
`);
    } else {
      // Send the delimiter
      res.write(`[END_OF_OPENAI_RESPONSE]
${relatedDocs.map((doc: any) => doc.metadata?.source).join(",")}
              `);
    }

    try {
      // Generate timestamps
      const clientMessageTimestamp = new Date().toISOString(); // Timestamp for the last client message
      const responseTimestamp = new Date().toISOString(); // Timestamp for the API response

      // Ensure there is at least one message to update
      if (messages.length === 0) {
        throw new Error("No messages to update.");
      }

      // Update conversation with the last message from the client and the response from the API
      const clientLastMessage = messages[messages.length - 1];

      // Create a unique messageId for the client's last message
      const clientLastMessageId = `client-${new Date().getTime()}`;

      // Construct the update object for the conversation
      const conversationUpdate = {
        messages: admin.firestore.FieldValue.arrayUnion(
          {
            messageId: clientLastMessageId,
            timestamp: clientMessageTimestamp,
            content: clientLastMessage.content,
            role: clientLastMessage.role, // Add the role field
          },
          {
            messageId: `response-${new Date().getTime()}`,
            timestamp: responseTimestamp,
            content: responseContent,
            sources: relatedDocs.map((doc: any) => doc.metadata?.source),
            role: "response", // Set the role for the response
            likeStatus: "",
          }
        ),
      };

      await conversationDocRef.update(conversationUpdate);

      const questionTypes = ["Type1", "Type2", "Type3"]; // Replace with actual types
      const conversationMessage = `
  [START OF CONVERSATION]
  QUESTION:
    ${messages[messages.length - 1].content}


  RESPONSE:
    ${responseContent}
  [END OF CONVERSATION]

[START OF INSTRUCTIONS]
  Analyze the conversation and classify.
    
  {
    escalation: Determine if the conversation was escalated to a human. (true/false)
    resolution: Assess if the query was resolved. (true/false)
    questionType: Categorize the question based on predefined types (${questionTypes.join(
        ", "
      )}), or suggest a new type. (string)
    sentimentAnalysis: Analyze the sentiment of the conversation. (positive/negative/neutral)
    personalInformation: Detect if the conversation contains personal information about the customer. (true/false)
  }
  [END OF INSTRUCTIONS]

  Begin!
`;

      const classMsg = await llm.invoke(
        [
          {
            role: "system",
            content:
              "Your task is to analyze a conversation and classify it in JSON format.",
          },
          { role: "user", content: conversationMessage },
        ],
        {
          response_format: { type: "json_object" }
        }
      );

      // 🛡️  Guard against null / invalid JSON
      let classificationResponse: any = {};
      try {
        if (typeof classMsg.content === "string") {
          classificationResponse = JSON.parse(classMsg.content);
        } else {
          throw new Error("OpenAI returned empty content");
        }
      } catch (err) {
        console.error("Classification JSON-parse failed:", err);
        classificationResponse = {
          escalation: false,
          resolution: false,
          questionType: "Unknown",
          sentimentAnalysis: "neutral",
          personalInformation: false,
          similarityScore
        };
      }
      // Add the similarity score to the classification response
      classificationResponse.similarityScore = similarityScore;
      console.log("classificationResponse: ", classificationResponse);

      await updateConversationAndMetrics(
        projectId,
        conversationId,
        classificationResponse
      );
    } catch (error) {
      console.error("Error updating conversation document: ", error);
    }

    res.end();
  } catch (error) {
    // Only send a response if headers haven't been sent yet
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Error interacting with OpenAI: " + error });
    }
  }
};

// rateMessage Route code
export const componentRateMessage = async (req: Request, res: Response) => {
  const clientKey = req.headers.authorization?.replace("Bearer ", "");
  const { feedback, conversationId } = req.body;

  if (!clientKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    // Validate API Key
    const projectId = await validateClientKey(clientKey);

    // Check if feedback is an object and if the feedbackType is valid
    if (
      typeof feedback !== "object" ||
      Object.values(feedback).some(
        (type) => type !== "like" && type !== "dislike"
      )
    ) {
      return res.status(400).send("Invalid feedback format or type");
    }

    // Update likes/dislikes count in metrics
    await updateLikesDislikes(projectId, feedback);

    // Update conversation message likeStatus
    const conversationDocRef = db
      .collection("conversations")
      .doc(conversationId);

    await db.runTransaction(async (transaction: any) => {
      console.log("conversationId: ", conversationId);
      const conversationDoc = await transaction.get(conversationDocRef);
      if (!conversationDoc.exists) {
        throw new Error("Conversation document does not exist");
      }
      const conversationData = conversationDoc.data();
      const messages = conversationData.messages;
      console.log("messages: ", messages);

      // Update the likeStatus for the message at index - 1
      Object.entries(feedback).forEach(([index, feedbackType]) => {
        const messageIndex = parseInt(index, 10) - 1; // Convert index to number and subtract 1
        console.log("messageIndex: ", messageIndex);
        console.log("feedbackType: ", feedbackType);

        if (messages[messageIndex]) {
          // Check if the message exists at messageIndex
          messages[messageIndex].likeStatus = feedbackType; // Update likeStatus
        }
      });

      transaction.update(conversationDocRef, { messages });
    });
    console.log("Conversation feedback updated!");
  } catch (error) {
    console.error("Failed to update conversation feedback:", error);
    return res.status(500).send("Failed to update conversation feedback");
  }
};

// KeywordSearch Route code
export const componentKeywordSearch = async (req: Request, res: Response) => {
  const clientKey = req.headers.authorization?.replace("Bearer ", "");
  const { searchTerm } = req.body;

  if (!clientKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const projectId = await validateClientKey(clientKey);

    if (!searchTerm) {
      return res.status(400).send({ error: "Search term is required." });
    }

    const data = await getRelevantData(
      searchTerm as string,
      projectId as string
    );
    res.send(data);
  } catch (error: any) {
    res.status(500).send({ error: error.message });
  }
};

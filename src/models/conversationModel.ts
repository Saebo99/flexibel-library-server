import { db } from "../firebase/db";

export const createConversation = async (projectId: string) => {
  const conversationRef = db.collection("conversations").doc();
  await conversationRef.set({
    messages: [],
    projectId: projectId,
  });

  return conversationRef.id; // Return the newly created conversation's ID
};

export const endConversation = async (conversationId: string) => {
  const conversationRef = db.collection("conversations").doc(conversationId);

  // Here, you might update the conversation's status or perform any cleanup necessary.
  // This example assumes a 'status' field to update. Adjust as per your schema.
  await conversationRef.update({ status: "ended" });

  return conversationId; // Return the conversation ID for confirmation.
};

export const getConversationDetails = async (conversationId: string) => {
  const conversationRef = db.collection("conversations").doc(conversationId);
  const conversationDoc = await conversationRef.get();

  if (!conversationDoc.exists) {
    throw new Error("Conversation not found");
  }

  return conversationDoc.data(); // Return the conversation data
};

// Additional model functions...

import crypto from "crypto";
import { db } from "../firebase/db";

export const validateApiKey = async (apiKey: string) => {
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const keysCollectionRef = db.collection("keys");
  const keysQuery = keysCollectionRef.where("apiKeyHashed", "==", apiKeyHash);
  const snapshot = await keysQuery.get();

  if (snapshot.empty) {
    throw new Error("Invalid API Key");
  }

  // Retrieve projectId from the document
  const keyDoc = snapshot.docs[0];
  return keyDoc.data().projectId;
};

export const validateClientKey = async (clientKey: string) => {
  const clientKeyHash = crypto
    .createHash("sha256")
    .update(clientKey)
    .digest("hex");
  const clientKeysCollectionRef = db.collection("clientKeys");
  const clientKeysQuery = clientKeysCollectionRef.where(
    "clientKeyHashed",
    "==",
    clientKeyHash
  );
  const snapshot = await clientKeysQuery.get();

  if (snapshot.empty) {
    throw new Error("Invalid Client Key");
  }

  // Retrieve projectId from the document
  const keyDoc = snapshot.docs[0];
  return keyDoc.data().projectId;
};

import express, { Request, Response } from "express";
import cors from "cors";
const crypto = require("crypto");
import OpenAI from "openai";
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import weaviate from "weaviate-ts-client";
import { WeaviateStore } from "langchain/vectorstores/weaviate";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
const admin = require("firebase-admin");
import { db } from "./firebase/db";

require("dotenv").config();

const app = express();
const PORT = 3000;

const SECRET_CRYPTO_KEY =
  "623c04d4bba66a6379db4df14c3cbca794153390ddcd204186066daf894c3e52";

// Initialize middleware
app.use(express.json()); // This will allow the server to parse JSON payloads
app.use(cors()); // Allow all origins for now (restrict in production)

const openai = new OpenAI({
  apiKey: "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",
});

export async function saveToDB(documents: any[], projectId: string) {
  const client = (weaviate as any).client({
    scheme: process.env.WEAVIATE_SCHEME || "https",
    host: "my-test-cluster-85hxrlf0.weaviate.network" || "localhost",
    apiKey: new (weaviate as any).ApiKey(
      "7yJQ3ztTXROAtKHQxIt0sj2HWOEVvQ1ncze3" || "default"
    ),
  });

  await WeaviateStore.fromDocuments(documents, new OpenAIEmbeddings(), {
    client,
    indexName: projectId,
  });
}

export async function queryDB(query: string, projectId: string) {
  // Something wrong with the weaviate-ts-client types, so we need to disable
  const client = (weaviate as any).client({
    scheme: process.env.WEAVIATE_SCHEME || "https",
    host: "my-test-cluster-85hxrlf0.weaviate.network" || "localhost",
    apiKey: new (weaviate as any).ApiKey(
      "7yJQ3ztTXROAtKHQxIt0sj2HWOEVvQ1ncze3" || "default"
    ),
  });

  try {
    // Create a store for an existing index
    const store = await WeaviateStore.fromExistingIndex(
      new OpenAIEmbeddings(),
      {
        client,
        indexName: projectId,
      }
    );

    // Search the index with a filter, in this case, only return results where
    // the "foo" metadata key is equal to "baz", see the Weaviate docs for more
    // https://weaviate.io/developers/weaviate/api/graphql/filters
    const results = await store.similaritySearch(query, 3);
    return results;
  } catch (error: any) {
    console.error("Error creating store from existing index:", error.message);

    // If an error occurs (e.g., no index matching the projectId), return an empty list
    return [];
  }
}

export async function deleteFromDB(projectId: string, source: string) {
  // Something wrong with the weaviate-ts-client types, so we need to disable
  const client = (weaviate as any).client({
    scheme: process.env.WEAVIATE_SCHEME || "https",
    host: "my-test-cluster-85hxrlf0.weaviate.network" || "localhost",
    apiKey: new (weaviate as any).ApiKey(
      "7yJQ3ztTXROAtKHQxIt0sj2HWOEVvQ1ncze3" || "default"
    ),
  });

  // Create a store for an existing index
  const store = await WeaviateStore.fromExistingIndex(new OpenAIEmbeddings(), {
    client,
    indexName: projectId,
    metadataKeys: [source],
  });

  // delete documents with filter
  await store.delete({
    filter: {
      where: {
        operator: "Equal",
        path: ["foo"],
        valueText: "bar",
      },
    },
  });
}

app.post("/api/createAPIKey", async (req, res) => {
  const idToken = req.headers.authorization?.replace("Bearer ", "");
  const { projectId, keyName } = req.body;

  if (!idToken) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    // Generate API Key
    const apiKey = crypto.randomBytes(32).toString("hex");

    // Generate a hashed version of the API Key for lookup
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    // For encryption, create an initialization vector (IV) and use it with createCipheriv
    const iv = crypto.randomBytes(16);
    const keyBuffer = Buffer.from(SECRET_CRYPTO_KEY || "", "hex");
    const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
    const encrypted = Buffer.concat([
      cipher.update(apiKey, "utf8"),
      cipher.final(),
    ]);

    // Use Firebase modular SDK to add the API key to the specified project
    const keysCollectionRef = db.collection("keys");
    const newKeyData = {
      projectId: projectId,
      name: keyName,
      apiKeyEncrypted: encrypted.toString("hex"),
      iv: iv.toString("hex"), // Store the IV for later decryption
      apiKeyHashed: apiKeyHash,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await keysCollectionRef.doc().set(newKeyData);

    // Respond to the client
    res.json({ apiKey });
  } catch (e) {
    console.log(e);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/api/getAPIKeys", async (req, res) => {
  const idToken = req.headers.authorization?.replace("Bearer ", "");
  const { projectId } = req.query;

  if (!idToken) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    // Use Firebase to get the API keys for the specified project
    const keysCollectionRef = db.collection("keys");
    const keysQuery = keysCollectionRef.where("projectId", "==", projectId);
    const querySnapshot = await keysQuery.get();

    const apiKeysData: any[] = [];

    querySnapshot.forEach((doc: any) => {
      const data = doc.data();
      const { apiKeyEncrypted, iv, name, createdAt, lastUsedAt } = data;

      // Decrypt the apiKeyEncrypted field
      const keyBuffer = Buffer.from(SECRET_CRYPTO_KEY || "", "hex");
      const ivBuffer = Buffer.from(iv, "hex");
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        keyBuffer,
        ivBuffer
      );
      const decryptedKey = Buffer.concat([
        decipher.update(Buffer.from(apiKeyEncrypted, "hex")),
        decipher.final(),
      ]).toString("utf8");

      // Collect the required data for each key
      apiKeysData.push({
        name,
        decryptedKey,
        createdAt: createdAt.toDate(), // Convert Firestore Timestamp to JavaScript Date
        lastUsedAt: lastUsedAt.toDate(), // Convert Firestore Timestamp to JavaScript Date
      });
    });

    // Send the collected data to the client
    res.json({ apiKeys: apiKeysData });
  } catch (error) {
    console.error("Error fetching document: ", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/api/ingestData", async (req, res) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { urls } = req.body;

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  // Validate API Key
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const keysCollectionRef = db.collection("keys");
  const keysQuery = keysCollectionRef.where("apiKeyHashed", "==", apiKeyHash);
  const snapshot = await keysQuery.get();

  if (snapshot.empty) {
    res.status(401).send("Invalid API Key");
    return;
  }

  // Retrieve projectId from the document
  const doc = snapshot.docs[0];
  const projectId = doc.data().projectId;

  for (let url of urls) {
    try {
      const loader = new CheerioWebBaseLoader(url, {
        selector: "p, span",
      });
      const docs = await loader.load();

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 0,
      });
      const splitDocs = await textSplitter.splitDocuments(docs);

      await saveToDB(splitDocs, projectId);

      // Get a reference to the dataSources subcollection in the current project document
      const dataSourcesRef = db
        .collection("projects")
        .doc(projectId)
        .collection("dataSources")
        .doc();

      // Create a new document for the current url
      await dataSourcesRef.set({
        source: url,
        charCount: splitDocs.reduce(
          (sum, doc) => sum + doc.pageContent.length,
          0
        ),
        type: "website",
        isActive: true,
        insertedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error: any) {
      console.error("Error processing URL:", url, error.message);
    }
  }

  res.json({ message: "Data ingestion was successful" });
});

app.post("/api/chat", async (req: Request, res: Response) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { messages } = req.body;

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    // Validate API Key
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const keysCollectionRef = db.collection("keys");
    const keysQuery = keysCollectionRef.where("apiKeyHashed", "==", apiKeyHash);
    const snapshot = await keysQuery.get();

    if (snapshot.empty) {
      res.status(401).send("Invalid API Key");
      return;
    }

    // Retrieve projectId from the document
    const doc = snapshot.docs[0];
    const projectId = doc.data().projectId;

    // content of the final message in messages
    const queryParam = messages[messages.length - 1].content;
    // All messages in messages except the final one
    const context = messages
      .slice(0, messages.length - 1)
      .map((m: any) => m.content);

    // Ensure messages are provided
    if (!messages) {
      return res.status(400).json({ error: "Messages are required" });
    }
    const relatedDocs = await queryDB(queryParam, projectId);

    const prompt = `You are part of the Sparebank1 customer service team. Given the verified sources and question below, create a final answer in markdown:

      ${relatedDocs.map((doc) => doc.pageContent).join("\n\n")}

    Remember while answering:
        - Be polite and friendly.
        - Be helpful.
        - Only talk about the answer. Do not reference the sources.
        - You have access to previous messages in the conversation.
        - Always answer in the same language as the question.

    Question: ${queryParam}

      Begin!`;

    // A list of all the messages in the messages array except the last one, and the prompt at the end in this format: {role: "user", content: prompt}
    const promptMessages = [
      ...messages.slice(0, messages.length - 1),
      { role: "user", content: prompt },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: promptMessages,
      stream: true,
    });

    // Stream the response to the client
    for await (const chunk of completion) {
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

//"0.0.0.0"

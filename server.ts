import express, { Request, Response } from "express";
import axios from "axios";
import * as url from "url";
const cheerio = require("cheerio");
import cors from "cors";
const crypto = require("crypto");
import OpenAI from "openai";
const fs = require("fs").promises;
const fetch = require("node-fetch");
const multer = require("multer");
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { DocxLoader } from "langchain/document_loaders/fs/docx";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { JSONLoader } from "langchain/document_loaders/fs/json";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import weaviate from "weaviate-ts-client";
import { WeaviateStore } from "langchain/vectorstores/weaviate";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
const admin = require("firebase-admin");
import { db } from "./firebase/db";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

async function crawlAndProcess(
  initialUrl: string,
  depth: number,
  projectId: string,
  maxPages = 400
) {
  const paginationURLsToVisit: [string, number][] = [[initialUrl, depth]]; // URL with its associated depth
  const visitedURLs: string[] = [];

  while (paginationURLsToVisit.length !== 0 && visitedURLs.length <= maxPages) {
    const [currentURL, currentDepth] = paginationURLsToVisit.pop() || ["", 0];

    // Check if this URL is already visited or depth is zero
    if (visitedURLs.includes(currentURL) || currentDepth <= 0) continue;

    try {
      // Fetch and parse the page content
      const response = await axios.get(currentURL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
        },
      });
      const $ = cheerio.load(response.data);

      // Extract title and description
      const title = $("title").text().trim();
      const description =
        $('meta[name="description"]').attr("content").trim() || "";

      // Get all anchor links and resolve them to absolute URLs
      $("a").each((index: number, element: any) => {
        const foundURL = url.resolve(currentURL, $(element).attr("href"));

        // You might want to filter URLs based on some criteria
        if (
          !visitedURLs.includes(foundURL) &&
          !paginationURLsToVisit.some(([url]) => url === foundURL) &&
          foundURL.startsWith("http") // Ensure it's a valid HTTP URL
        ) {
          paginationURLsToVisit.push([foundURL, currentDepth - 1]);
        }
      });

      console.log("currentURL: ", currentURL);
      // Process this URL (Your logic to save data from this URL)
      const loader = new CheerioWebBaseLoader(currentURL, {
        selector: "p, span",
      });
      const docs = await loader.load();

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 0,
      });
      const splitDocs = await textSplitter.splitDocuments(docs);

      // Save the data with title and description
      await saveToDB(splitDocs, projectId, { title, description });

      // Create a new document for the current URL with additional metadata
      const dataSourcesRef = db
        .collection("projects")
        .doc(projectId)
        .collection("dataSources")
        .doc();

      await dataSourcesRef.set({
        source: currentURL,
        title: title,
        description: description,
        charCount: splitDocs.reduce(
          (sum, doc) => sum + doc.pageContent.length,
          0
        ),
        type: "website",
        isActive: true,
        insertedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Mark this URL as visited
      visitedURLs.push(currentURL);
    } catch (error: any) {
      console.error(`Error processing URL: ${currentURL}`, error.message);
      // Continue to the next URL
    }

    // Delay between requests to respect rate limits and avoid being blocked
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
  }
}

export async function saveToDB(
  documents: any[],
  projectId: string,
  extraFields?: any
) {
  console.log("projectId: ", projectId);

  const sanitizedDocuments = documents.map((document) => {
    const { metadata } = document;
    const sanitizedMetadata: any = {};

    // Add fields from metadata that start with "loc" or are "source"
    for (const key in metadata) {
      if (key.startsWith("loc") || key === "source") {
        sanitizedMetadata[key] = metadata[key];
      }
    }

    // Add extra fields if provided
    if (extraFields) {
      for (const extraKey in extraFields) {
        sanitizedMetadata[extraKey] = extraFields[extraKey];
      }
    }

    // Return the updated document
    return {
      ...document,
      metadata: sanitizedMetadata,
    };
  });

  const client = weaviate.client({
    scheme: process.env.WEAVIATE_SCHEME || "https",
    host: "my-test-cluster-85hxrlf0.weaviate.network" || "localhost",
    apiKey: new weaviate.ApiKey(
      "7yJQ3ztTXROAtKHQxIt0sj2HWOEVvQ1ncze3" || "default"
    ),
  });

  try {
    // Process one document at a time
    await WeaviateStore.fromDocuments(
      sanitizedDocuments,
      new OpenAIEmbeddings(),
      {
        client,
        indexName: projectId,
      }
    );
  } catch (error) {
    console.error("Failed to upload documents");
    // Continue with the next document even if the current one fails
  }
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
        metadataKeys: ["source"],
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

export async function deleteFromDB(projectId: string, sources: string[]) {
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
    metadataKeys: ["source"],
  });

  for (const source of sources) {
    // delete documents with filter
    await store.delete({
      filter: {
        where: {
          operator: "Equal",
          path: ["source"],
          valueText: source,
        },
      },
    });
  }
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
    const apiKey = crypto.randomBytes(22).toString("hex");

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
  const { urls, crawlType } = req.body;

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
      const response = await axios.get(url); // Use axios to fetch the HTML content
      const $ = cheerio.load(response.data); // Load HTML content into Cheerio

      // Retrieve title and meta description
      const title = $("title").text().trim();
      console.log("title: ", title);
      const description = $('meta[name="description"]').attr("content").trim();
      if (crawlType === "single") {
        const loader = new CheerioWebBaseLoader(url, {
          selector: "p, span",
        });
        const docs = await loader.load();

        const textSplitter = new RecursiveCharacterTextSplitter({
          chunkSize: 500,
          chunkOverlap: 0,
        });
        const splitDocs = await textSplitter.splitDocuments(docs);

        await saveToDB(splitDocs, projectId, { title, description });

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
      } else if (crawlType === "crawl") {
        await crawlAndProcess(url, 2, projectId, 100); // Here, 2 is the depth of crawling. You can adjust it as required.
      } else {
        res.status(400).send("Invalid crawlType provided");
        return;
      }
    } catch (error: any) {
      console.error("Error processing URL:", url, error.message);
    }
  }

  res.json({ message: "Data ingestion was successful" });
});

app.post("/api/ingestFile", upload.single("file"), async (req, res) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const {} = req.body;

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

  if (!(req as any).file) {
    return res.status(400).send("No file uploaded");
  }

  // Generate a path for a new temporary file
  const tmpFilePath = `/tmp/${(req as any).file.originalname}`;

  // Write the uploaded file data to the temporary file
  await fs.writeFile(tmpFilePath, (req as any).file.buffer);
  console.log("Saved uploaded file to:", tmpFilePath);

  // Determine the file extension to decide which loader to use
  const fileExtension = (req as any).file.originalname
    .split(".")
    .pop()
    ?.toLowerCase();

  let loader;
  switch (fileExtension) {
    case "pdf":
      loader = new PDFLoader(tmpFilePath);
      break;
    case "docx":
      loader = new DocxLoader(tmpFilePath);
      break;
    case "txt":
      loader = new TextLoader(tmpFilePath);
      break;
    case "json":
      loader = new JSONLoader(tmpFilePath);
      break;
    default:
      return res.status(400).send("Unsupported file type");
  }

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
    source: (req as any).file.originalname,
    charCount: splitDocs.reduce((sum, doc) => sum + doc.pageContent.length, 0),
    type: "file",
    isActive: true,
    insertedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ message: "Data ingestion was successful" });
});

app.post("/api/deleteData", async (req, res) => {
  console.log("Deleting data...");
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { sources } = req.body;

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

  deleteFromDB(projectId, sources);

  // Reference to the project's dataSources collection
  const dataSourcesRef = db
    .collection("projects")
    .doc(projectId)
    .collection("dataSources");

  try {
    for (const source of sources) {
      // Query all documents with the source field equal to the current source
      const querySnapshot = await dataSourcesRef
        .where("source", "==", source)
        .get();
      querySnapshot.forEach(async (doc: any) => {
        // Delete documents
        await dataSourcesRef.doc(doc.id).delete();
      });
    }
    res.json({ message: "Data deletion was successful" });
  } catch (error: any) {
    res.status(500).send("Error deleting documents: " + error.message);
  }
});

app.post("/api/createModel", async (req, res) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { config } = req.body;

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

  const modelsCollectionRef = db.collection("models");

  // Use config parameter if provided, otherwise use default values
  const newModelData = config || {
    modelType: "gpt-3.5-turbo",
    name: "new model",
    prompt: "New prompt",
    responseLength: 1500,
    temperature: 0.5,
    suggestedMessages: [],
  };

  try {
    const modelRef = await modelsCollectionRef.add(newModelData);
    const modelId = modelRef.id;

    // Retrieve projectId from the document
    const doc = snapshot.docs[0];
    const projectId = doc.data().projectId;

    // Get a reference to the dataSources subcollection in the current project document
    const projectRef = db.collection("projects").doc(projectId);

    // Get the current data of the project document
    const projectDoc = await projectRef.get();
    const projectData = projectDoc.data();

    if (projectData) {
      // Find the key that has a value of true and set it to false
      const updatedModels = { ...projectData.models };
      for (const [key, value] of Object.entries(updatedModels)) {
        if (value === true) {
          updatedModels[key] = false;
          break;
        }
      }

      // Add the new key-value pair with a value of true
      updatedModels[modelId] = true;

      // Update the models object inside the projectRef document
      await projectRef.update({
        models: updatedModels,
      });
    }

    // return modelId
    res.json({ modelId });
  } catch (error: any) {
    console.error("Error creating model:", error.message);
    res.status(500).send("Server Error");
  }
});

const updateLikesDislikes = async (projectId: string, feedback: any) => {
  const metricsCollectionRef = db.collection("metrics");
  const today = new Date().toISOString().split("T")[0]; // Get current date in YYYY-MM-DD format

  try {
    await db.runTransaction(async (transaction: any) => {
      const metricsQuery = metricsCollectionRef.where(
        "projectId",
        "==",
        projectId
      );
      const querySnapshot = await transaction.get(metricsQuery);

      // If the document does not exist, create it with today's date
      if (querySnapshot.empty) {
        const newMetricDocRef = metricsCollectionRef.doc();
        transaction.set(newMetricDocRef, {
          projectId: projectId,
          dailyCounts: {
            [today]: {
              messageCount: 0, // Assuming you want to initialize messageCount as well
              likeCount: feedback.like ? 1 : 0,
              dislikeCount: feedback.dislike ? 1 : 0,
            },
          },
        });
      } else {
        // Process the existing document
        querySnapshot.forEach((doc: any) => {
          const metricsData = doc.data();

          // Initialize dailyCounts for today if not present
          if (!metricsData.dailyCounts || !metricsData.dailyCounts[today]) {
            transaction.set(
              doc.ref,
              {
                dailyCounts: {
                  ...metricsData.dailyCounts,
                  [today]: {
                    messageCount: 0, // Assuming you want to initialize messageCount as well
                    likeCount: feedback.like ? 1 : 0,
                    dislikeCount: feedback.dislike ? 1 : 0,
                  },
                },
              },
              { merge: true }
            );
          } else {
            // Increment like or dislike count based on the feedback
            Object.entries(feedback).forEach(([key, value]) => {
              const incrementField =
                value === "like" ? "likeCount" : "dislikeCount";
              transaction.update(doc.ref, {
                [`dailyCounts.${today}.${incrementField}`]:
                  admin.firestore.FieldValue.increment(1),
              });
            });
          }
        });
      }
    });
    console.log("Feedback successfully updated!");
  } catch (error) {
    console.error("Failed to update feedback:", error);
  }
};

// Feedback route
app.post("/api/feedback/", async (req, res) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { feedback, conversationId } = req.body;

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

    // Retrieve projectId and models from the document
    const keyDoc = snapshot.docs[0];
    const projectId = keyDoc.data().projectId;

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
});

// Function to retrieve the 10 most relevant data pieces
const getRelevantData = async (searchTerm: string, projectId: string) => {
  try {
    console.log("before client");
    const client = (weaviate as any).client({
      scheme: process.env.WEAVIATE_SCHEME || "https",
      host: "my-test-cluster-85hxrlf0.weaviate.network" || "localhost",
      apiKey: new (weaviate as any).ApiKey(
        "7yJQ3ztTXROAtKHQxIt0sj2HWOEVvQ1ncze3" || "default"
      ),
      headers: {
        "X-OpenAI-Api-Key":
          "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",
      },
    });

    console.log("before response");

    const response = await client.graphql
      .get()
      .withClassName(projectId)
      .withFields("source title description _additional { score }")
      .withLimit(3)
      .withBm25({
        query: searchTerm,
        properties: ["text"],
      })
      .do();

    const firstKeyArray: any = Object.values(response.data.Get)[0];
    console.log("firstKeyArray: ", firstKeyArray);

    // Map over the array to create a new list of objects with only the source and score fields.
    const sourceAndScoreList = firstKeyArray.map((item: any) => ({
      source: item.source,
      title: item.title,
      description: item.description,
      score: item._additional.score,
    }));

    console.log(sourceAndScoreList);

    return sourceAndScoreList;
  } catch (error) {
    console.error("Error retrieving data:", error);
    throw error;
  }
};

// Define the API route
app.post("/api/keywordSearch", async (req, res) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { searchTerm } = req.body;

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

    // Retrieve projectId and models from the document
    const keyDoc = snapshot.docs[0];
    const projectId = keyDoc.data().projectId;

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
});

const updateMessageCount = async (projectId: string) => {
  const metricsCollectionRef = db.collection("metrics");

  try {
    await db.runTransaction(async (transaction: any) => {
      const today = new Date().toISOString().split("T")[0]; // Get current date in YYYY-MM-DD format
      const metricsQuery = metricsCollectionRef.where(
        "projectId",
        "==",
        projectId
      );
      const querySnapshot = await transaction.get(metricsQuery);

      if (querySnapshot.empty) {
        // Create a new document with today's date as a key for messageCount
        const newMetricDocRef = metricsCollectionRef.doc();
        transaction.set(newMetricDocRef, {
          projectId: projectId,
          dailyCounts: {
            [today]: {
              messageCount: 1,
              likeCount: 0,
              dislikeCount: 0,
            },
          },
        });
      } else {
        const existingMetricDocRef = querySnapshot.docs[0].ref;
        const metricsData = querySnapshot.docs[0].data();

        // Initialize if today's date is not present
        if (!metricsData.dailyCounts || !metricsData.dailyCounts[today]) {
          transaction.set(
            existingMetricDocRef,
            {
              dailyCounts: {
                ...metricsData.dailyCounts,
                [today]: {
                  messageCount: 1,
                  likeCount: 0,
                  dislikeCount: 0,
                },
              },
            },
            { merge: true }
          );
        } else {
          // Increment today's message count
          transaction.update(existingMetricDocRef, {
            [`dailyCounts.${today}.messageCount`]:
              admin.firestore.FieldValue.increment(1),
          });
        }
      }
    });
    console.log("Transaction successfully committed!");
  } catch (error) {
    console.log("Transaction failed: ", error);
  }
};

app.post("/api/chat", async (req: Request, res: Response) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { messages, conversationId } = req.body; // Include conversationId in the request body

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

    // Retrieve projectId and models from the document
    const keyDoc = snapshot.docs[0];
    const projectId = keyDoc.data().projectId;

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
      // If no conversationId is provided, create a new conversation document
      conversationDocRef = db.collection("conversations").doc();
      await conversationDocRef.set({
        messages: [],
        projectId: projectId,
      }); // You might want to store additional data
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

    const relatedDocs = await queryDB(queryParam, projectId);

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

    const promptTemplate = modelData.prompt
      .replace(
        "[context]",
        `${relatedDocs.map((doc) => doc.pageContent).join("\n\n")}`
      )
      .replace("[chat_history]", chatHistory || "No history")
      .replace("[question]", messages[messages.length - 1].content);

    console.log("promptTemplate: ", promptTemplate);

    await updateMessageCount(projectId);

    const completion = await openai.chat.completions.create({
      model: modelData.modelType,
      messages: [{ role: "user", content: promptTemplate }],
      stream: true,
      max_tokens: modelData.responseLength,
      temperature: modelData.temperature,
    });

    let responseContent = "";
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
        const content = chunk.choices[0].delta.content;
        responseContent += content;
        res.write(JSON.stringify(content));
      } else if (chunk.choices[0].finish_reason === "stop") {
        console.warn("Received stop signal from OpenAI.");
        break; // Exit the loop if OpenAI sends a 'stop' signal
      }
    }

    // After the OpenAI stream is completed and before closing the response
    if (!conversationId) {
      // Only send the new conversation ID if one was not provided in the request
      res.write(`[NEW_CONVERSATION_ID]
${conversationDocRef.id}
[END_OF_OPENAI_RESPONSE]
${relatedDocs.map((doc) => doc.metadata?.source).join(",")}
`);
    } else {
      // Send the delimiter
      res.write(`[END_OF_OPENAI_RESPONSE]
${relatedDocs.map((doc) => doc.metadata?.source).join(",")}
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
            sources: relatedDocs.map((doc) => doc.metadata?.source),
            role: "response", // Set the role for the response
            likeStatus: "",
          }
        ),
      };

      await conversationDocRef.update(conversationUpdate);
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
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

//"0.0.0.0"

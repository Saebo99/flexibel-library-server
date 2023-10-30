import express, { Request, Response } from "express";
import axios from "axios";
import * as url from "url";
const cheerio = require("cheerio");
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

    // Fetch and parse the page content
    let pageHTML;
    try {
      pageHTML = await axios.get(currentURL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
        },
      });
    } catch (error: any) {
      console.error(`Error fetching URL: ${currentURL}`, error.message);
      continue; // skip this URL and proceed with the next one
    }
    const $ = cheerio.load(pageHTML.data);

    // Get all anchor links and resolve them to absolute URLs
    $("a").each((index: number, element: any) => {
      const foundURL = url.resolve(currentURL, $(element).attr("href"));

      // You might want to filter URLs based on some criteria
      if (
        !visitedURLs.includes(foundURL) &&
        !paginationURLsToVisit.some(([url]) => url === foundURL)
      ) {
        paginationURLsToVisit.push([foundURL, currentDepth - 1]);
      }
    });

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

    await saveToDB(splitDocs, projectId);

    // Get a reference to the dataSources subcollection in the current project document
    const dataSourcesRef = db
      .collection("projects")
      .doc(projectId)
      .collection("dataSources")
      .doc();

    // Create a new document for the current url
    await dataSourcesRef.set({
      source: currentURL,
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

    // Delay between requests to respect rate limits and avoid being blocked
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
  }
}

// Make sure to handle errors in the main function or caller function like the example provided.

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

  console.log("urls: ", urls);
  console.log("crawlType: ", crawlType);
  for (let url of urls) {
    try {
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

    // Retrieve projectId and models from the document
    const doc = snapshot.docs[0];
    const projectId = doc.data().projectId;
    const models = doc.data().models;
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
    const promptTemplate = modelData.prompt.replace(
      "[context]",
      `${relatedDocs.map((doc) => doc.pageContent).join("\n\n")}`
    );

    const promptMessages = [
      ...messages.slice(0, messages.length - 1),
      { role: "user", content: promptTemplate },
    ];

    console.log("Prompt messages: ", promptMessages);

    const completion = await openai.chat.completions.create({
      model: modelData.modelType,
      messages: promptMessages,
      stream: true,
      max_tokens: modelData.responseLength,
      temperature: modelData.temperature,
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

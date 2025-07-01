import { Request, Response } from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { db } from "../firebase/db";

import * as url from "url";
const crypto = require("crypto");
const fs = require("fs").promises;
import path from "path";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { JSONLoader } from "langchain/document_loaders/fs/json";
import { YoutubeLoader } from "@langchain/community/document_loaders/web/youtube";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "langchain/document";
const admin = require("firebase-admin");

import { saveToDB, deleteFromDB } from "../models/dataModels";
import { validateApiKey } from "../models/apiKeyModel";

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
        $('meta[name="description"]').attr("content")?.trim() || "";

      // Get all anchor links and resolve them to absolute URLs
      $("a").each((index: number, element: any) => {
        const foundURL = url.resolve(currentURL, $(element).attr("href") || "");

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
        selector:
          "p, span, li, h1, h2, h3, h4, b, i, strong, em, u, s, strike, code, pre",
      });
      const docs = await loader.load();

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 0,
      });
      const splitDocs = await textSplitter.splitDocuments(docs);

      // Save the data with title and description
      await saveToDB(splitDocs, projectId, {
        title,
        description,
        type: "website",
      });

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

export const ingestData = async (req: Request, res: Response) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { urls, crawlType } = req.body;

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  // Validate API Key
  const projectId = await validateApiKey(apiKey);
  console.log("projectId: ", projectId)

  for (let url of urls) {
    console.log("url: ", url)
    try {
      const response = await axios.get(url); // Use axios to fetch the HTML content
      const $ = cheerio.load(response.data); // Load HTML content into Cheerio

      // Retrieve title and meta description
      const title = $("title").text().trim();
      const description = $('meta[name="description"]').attr("content")?.trim();
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

        await saveToDB(splitDocs, projectId, {
          title,
          description,
          type: "website",
        });

        console.log("after saveToDB")

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
};

export const ingestFile = async (req: Request, res: Response) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const {} = req.body;

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  // Validate API Key
  const projectId = await validateApiKey(apiKey);

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

  await saveToDB(splitDocs, projectId, {
    type: "file",
    title: fileExtension,
    description: "File",
  });

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
};

export const ingestVideo = async (req: Request, res: Response) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { url } = req.body;
  console.log("url: ", url)

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  console.log("api key exists")

  try {
    // Validate API Key
    const projectId = await validateApiKey(apiKey);
    console.log("projectId: ", projectId)

    const loader = YoutubeLoader.createFromUrl(url, {
      language: "en",
      addVideoInfo: true,
    });

    console.log("loader created")

    const docs = await loader.load();

    console.log("doc uno: ", docs[0])

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 0,
    });
    const splitDocs = await textSplitter.splitDocuments(docs);

    console.log("entering save to db: ", docs[0].metadata);
    await saveToDB(splitDocs, projectId, {
      title: docs[0].metadata.title,
      description: docs[0].metadata.author,
      type: "video",
    });

    // Get a reference to the dataSources subcollection in the current project document
    const dataSourcesRef = db
      .collection("projects")
      .doc(projectId)
      .collection("dataSources")
      .doc();

    // Create a new document for the current url
    await dataSourcesRef.set({
      source: docs[0].metadata.source,
      title: docs[0].metadata.title,
      author: docs[0].metadata.author,

      charCount: splitDocs.reduce(
        (sum, doc) => sum + doc.pageContent.length,
        0
      ),
      type: "video",
      isActive: true,
      insertedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ message: "Data ingestion was successful" });
  } catch (error: any) {
    console.error("Error processing URL:", url, error.message);
  }
};

export const ingestFaq = async (req: Request, res: Response) => {
  console.log("ingesting faq");
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { faqGroupName, faqId, question, answer } = req.body;
  console.log("req.body: ", req.body);

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    // Validate API Key
    const projectId = await validateApiKey(apiKey);

    // Combine question and answer into one string
    const combinedText = `QUESTION STARTS HERE
    ${question}
    QUESTION ENDS HERE

    ANSWER STARTS HERE
    ${answer}
    ANSWER ENDS HERE`;

    const doc = new Document({
      pageContent: combinedText,
      metadata: { source: faqId, description: "FAQ", title: question },
    });

    console.log("doc: ", doc);
    let isActive = true;
    let faqGroupDocRef;
    if (faqGroupName) {
      console.log("faqGroupName: ", faqGroupName);
      const faqGroupDocSnapshot = await db
        .collection("projects")
        .doc(projectId)
        .collection("dataSources")
        .where("type", "==", "faq")
        .where("name", "==", faqGroupName)
        .limit(1)
        .get();
      console.log("faqGroupDocSnapshot: ", faqGroupDocSnapshot);

      if (!faqGroupDocSnapshot.empty) {
        faqGroupDocRef = faqGroupDocSnapshot.docs[0].ref;
        const faqGroupData = faqGroupDocSnapshot.docs[0].data();
        isActive = faqGroupData.isActive;

        let faqs = faqGroupData.faqs || [];
        const existingFaqIndex = faqs.findIndex((faq: any) => faq.id === faqId);

        const now = new Date();
        const faqData: any = {
          id: faqId,
          question: question,
          answer: answer,
          updatedAt: now,
        };

        if (existingFaqIndex >= 0) {
          // Update existing FAQ
          faqs[existingFaqIndex] = { ...faqs[existingFaqIndex], ...faqData };
        } else {
          // Add new FAQ with a placeholder timestamp
          faqData.insertedAt = now;
          faqs.push(faqData);
        }

        // Update the entire array
        await faqGroupDocRef.update({ faqs });
      }
    }

    await saveToDB([doc], projectId, {
      faqGroupName: faqGroupName || question,
      isActive,
      title: question,
      description: "FAQ",
      type: "faq",
    });

    res.json({ newFaqId: faqId });
  } catch (error: any) {
    console.error("Error processing FAQ:", error.message);
    res.status(500).send("Internal Server Error");
  }
};

export const ingestImprovedAnswer = async (req: Request, res: Response) => {
  console.log("ingesting improved answer");
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { conversationId, messageId, improvedAnswerId, question, answer } =
    req.body;
  console.log("req.body: ", req.body);

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    // Validate API Key
    const projectId = await validateApiKey(apiKey);

    // Combine question and answer into one string
    const combinedText = `QUESTION STARTS HERE
    ${question}
    QUESTION ENDS HERE

    ANSWER STARTS HERE
    ${answer}
    ANSWER ENDS HERE`;

    const dataSourcesRef = db
      .collection("projects")
      .doc(projectId)
      .collection("dataSources");

    let dataSourcesDocRef;
    if (improvedAnswerId) {
      console.log("improvedAnswerId: ", improvedAnswerId);
      // Check if a document with the provided ID exists
      dataSourcesDocRef = dataSourcesRef.doc(improvedAnswerId);
      const docSnapshot = await dataSourcesDocRef.get();
      if (docSnapshot.exists) {
        // Update the existing document
        await dataSourcesDocRef.update({
          question: question,
          answer: answer,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        return res
          .status(404)
          .send("Document with the provided ID does not exist.");
      }
    } else {
      console.log("no improvedAnswerId provided");
      console.log("conversationId: ", conversationId);
      console.log("messageId: ", messageId);
      // Create a new document
      dataSourcesDocRef = dataSourcesRef.doc();
      await dataSourcesDocRef.set({
        source: dataSourcesDocRef.id,
        question: question,
        answer: answer,
        type: "improved answer",
        isActive: true,
        conversationId: conversationId,
        messageId: messageId,
        insertedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const doc = new Document({
      pageContent: combinedText,
      metadata: {
        source: improvedAnswerId || dataSourcesDocRef.id,
        description: "Improved Answer",
        title: question,
      },
    });

    console.log("doc: ", doc);

    await saveToDB([doc], projectId, {
      improvedAnswerId: improvedAnswerId || dataSourcesDocRef.id,
      isActive: true,
      title: question,
      description: "Improved Answer",
      type: "improved answer",
    });

    // Locate the conversation document
    const conversationDocRef = db
      .collection("conversations")
      .doc(conversationId);

    const conversationDoc = await conversationDocRef.get();
    if (!conversationDoc.exists) {
      return res
        .status(404)
        .send("Conversation with the provided ID does not exist.");
    }

    const conversationData = conversationDoc.data();
    const messages = conversationData.messages || [];
    const messageIndex = messages.findIndex(
      (msg: any) => msg.messageId === messageId
    );

    if (messageIndex < 0) {
      return res
        .status(404)
        .send(
          "Message with the provided ID does not exist in the conversation."
        );
    }

    // Update the specific message with the improved answer
    const updatedMessages = [...messages];
    updatedMessages[messageIndex] = {
      ...updatedMessages[messageIndex],
      improvedAnswer: {
        question: question,
        answer: answer,
      },
    };

    // Save the updated messages back to the conversation document
    await conversationDocRef.update({ messages: updatedMessages });

    res.json({ newImprovedAnswerId: improvedAnswerId || dataSourcesDocRef.id });
  } catch (error: any) {
    console.error("Error processing improved answer:", error.message);
    res.status(500).send("Internal Server Error");
  }
};

export const deleteData = async (req: Request, res: Response) => {
  console.log("Deleting data...");
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  const { source, deleteAllSources } = req.body;
  console.log("source: ", source);

  if (!apiKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  // Validate API Key
  const projectId = await validateApiKey(apiKey);

  await deleteFromDB(projectId, [source]);
  console.log("Data deleted form weaviate");

  if (deleteAllSources) {
    // Logic to delete all sources
    const dataSourcesRef = db
      .collection("projects")
      .doc(projectId)
      .collection("dataSources");
    try {
      const querySnapshot = await dataSourcesRef.get();
      querySnapshot.forEach(async (doc: any) => {
        await dataSourcesRef.doc(doc.id).delete();
      });
      res.json({
        message: "All sources successfully deleted.",
        deleted: "All Sources",
      });
    } catch (error: any) {
      res.status(500).send("Error deleting all sources: " + error.message);
    }
  } else if (source) {
    // Logic to delete a specific source
    const dataSourcesRef = db
      .collection("projects")
      .doc(projectId)
      .collection("dataSources");
    try {
      const querySnapshot = await dataSourcesRef
        .where("source", "==", source)
        .get();
      querySnapshot.forEach(async (doc: any) => {
        await dataSourcesRef.doc(doc.id).delete();
      });
      res.json({ message: "Source successfully deleted.", deleted: source });
    } catch (error: any) {
      res.status(500).send("Error deleting source: " + error.message);
    }
  } else {
    res
      .status(400)
      .send("Invalid request: source or deleteAllSources parameter required");
  }
};

const admin = require("firebase-admin");
import { db } from "../firebase/db";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import weaviate from "weaviate-ts-client";
import { WeaviateStore } from "langchain/vectorstores/weaviate";

export async function saveToDB(
  documents: any[],
  projectId: string,
  extraFields?: any
) {
  console.log("projectId: ", projectId);

  try {
    const client = (weaviate as any).client({
      scheme: process.env.WEAVIATE_SCHEME || "https",
      host: "flexibel-test-cluster-8ucecmqf.weaviate.network" || "localhost",
      apiKey: new (weaviate as any).ApiKey(
        "IPlba3vSCgG0agCa3O22SVXDMNlDfrF2pRRo" || "default"
      ),
    });
    console.log("done setting up client");

    console.log("documents[0].metadata: ", documents[0].metadata);
    const source = documents[0].metadata.source;

    deleteFromDB(projectId, [source]);
    console.log("deleteFromDB done");

    const sanitizedDocuments = documents.map((document) => {
      const { metadata } = document;
      const sanitizedMetadata: any = {};

      console.log("beginning of sanitizedDocuments");
      // Add fields from metadata that start with "loc" or are "source"
      for (const key in metadata) {
        if (key.startsWith("loc") || key === "source") {
          sanitizedMetadata[key] = metadata[key];
        }
      }
      console.log("end of sanitizedDocuments");

      // Set isActive field based on extraFields or default to true
      sanitizedMetadata["isActive"] = extraFields?.isActive ?? true;

      console.log("beginning of document");
      // Add extra fields if provided
      if (extraFields) {
        for (const extraKey in extraFields) {
          sanitizedMetadata[extraKey] = extraFields[extraKey];
        }
      }
      console.log("end of document");

      // Return the updated document
      return {
        ...document,
        metadata: sanitizedMetadata,
      };
    });
    console.log("end of sanitizedDocumentsadsfasdfadsf");

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

export async function deleteFromDB(projectId: string, sources: string[]) {
  // Something wrong with the weaviate-ts-client types, so we need to disable
  const client = weaviate.client({
    scheme: process.env.WEAVIATE_SCHEME || "https",
    host: "flexibel-test-cluster-8ucecmqf.weaviate.network" || "localhost",
    apiKey: new weaviate.ApiKey(
      "IPlba3vSCgG0agCa3O22SVXDMNlDfrF2pRRo" || "default"
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

// Additional functions for data processing and Firestore interactions...

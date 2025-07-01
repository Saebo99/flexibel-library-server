import { v4 as uuidv4 } from "uuid";
import { AzureKeyCredential, SearchClient } from "@azure/search-documents";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import admin from "firebase-admin";
import { db } from "../firebase/db";

const searchClient = new SearchClient(
  process.env.SEARCH_ENDPOINT!,               // https://flexibel-search-ai.search.windows.net
  "flexibel-index",                           // your index name
  new AzureKeyCredential(process.env.SEARCH_ADMIN_KEY!)
);

// ---------- Embedding model ----------
const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiEmbeddingsDeploymentName: "text-embedding-3-small",
  azureOpenAIApiKey: "2xTMgvtKOhkgmcDGGARcuG54fhqGIA98jhMFGvrL4caXiPRjcyJmJQQJ99BGACHYHv6XJ3w3AAAAACOGj0XC", // In Node.js defaults to process.env.AZURE_OPENAI_API_KEY
  azureOpenAIApiVersion: "2024-02-01",
  azureOpenAIBasePath: "https://patri-mckkdq7n-eastus2.cognitiveservices.azure.com/openai/deployments/text-embedding-3-small/embeddings?api-version=2023-05-15"
});

export async function saveToDB(
  documents: any[],
  projectId: string,
  extraFields: Record<string, any> = {}
) {
  // 1) enrich metadata first
  const enriched = documents.map(d => ({
    ...d,
    metadata: {
      ...(d.metadata || {}),
      projectId,
      ...extraFields
    },
    chunkId: d.metadata?.chunkId ?? uuidv4()   // PK in the index
  }));

  // 2) embed texts (assume chunk text lives on `pageContent`)
  const vectors = await embeddings.embedDocuments(
    enriched.map(d => d.pageContent)
  );

  // 3) build Azure Search docs
  const searchDocs = enriched.map((d, i) => ({
    chunkId: d.chunkId,
    projectId: d.metadata.projectId,
    sourceId: d.metadata.source || "unknown",
    text: d.pageContent,
    embedding: vectors[i],
    ...(d.metadata.title && { title: d.metadata.title }),
    ...(d.metadata.description && { description: d.metadata.description }),
    ...(d.metadata.type && { type: d.metadata.type }),
  }));

  // 4) upload (max 1000 docs per batch)
  await searchClient.uploadDocuments(searchDocs);
  console.log(`✅ Uploaded ${searchDocs.length} chunks for project ${projectId}`);
}

/* ---------- DELETE (soft delete by key list) ---------- */
export async function deleteFromDB(projectId: string, sources: string[]) {
  try {
    const keys = sources.map(s => ({ chunkId: `${projectId}-${s}` }));
    await searchClient.deleteDocuments(keys);
  } catch (err) {
    console.error("Azure AI Search delete failed:", err);
  }
}
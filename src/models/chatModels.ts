const admin = require("firebase-admin");
import { db } from "../firebase/db";

import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import weaviate from "weaviate-ts-client";
import { WeaviateStore } from "langchain/vectorstores/weaviate";

export const queryDB = async (query: string, projectId: string) => {
  // Something wrong with the weaviate-ts-client types, so we need to disable
  const client = (weaviate as any).client({
    scheme: process.env.WEAVIATE_SCHEME || "https",
    host: "flexibel-test-cluster-8ucecmqf.weaviate.network" || "localhost",
    apiKey: new (weaviate as any).ApiKey(
      "IPlba3vSCgG0agCa3O22SVXDMNlDfrF2pRRo" || "default"
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
};

export const updateMessageCount = async (projectId: string) => {
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

export const updateLikesDislikes = async (projectId: string, feedback: any) => {
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

export const getRelevantData = async (
  searchTerm: string,
  projectId: string
) => {
  try {
    console.log("before client");
    const client = (weaviate as any).client({
      scheme: process.env.WEAVIATE_SCHEME || "https",
      host: "flexibel-test-cluster-8ucecmqf.weaviate.network" || "localhost",

      apiKey: new (weaviate as any).ApiKey(
        "IPlba3vSCgG0agCa3O22SVXDMNlDfrF2pRRo" || "default"
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

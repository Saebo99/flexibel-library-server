const admin = require("firebase-admin");
import { db } from "../firebase/db";

import { OpenAIEmbeddings } from "@langchain/openai";

export const queryDB = async () => ({
  relatedDocs: [],
  similarityScore: 0
})

export const updateConversationAndMetrics = async (
  projectId: string,
  conversationId: string,
  classification: any
) => {
  console.log("Updating conversation and metrics");
  console.log("classification: ", classification);

  const metricsCollectionRef = db.collection("metrics");
  const conversationsCollectionRef = db.collection("conversations");

  try {
    await db.runTransaction(async (transaction: any) => {
      const today = new Date().toISOString().split("T")[0]; // Get current date in YYYY-MM-DD format

      // Update Metrics Collection
      const metricsQuery = metricsCollectionRef.where(
        "projectId",
        "==",
        projectId
      );
      const metricsQuerySnapshot = await transaction.get(metricsQuery);

      const conversationDocRef = conversationsCollectionRef.doc(conversationId);
      const conversationDoc = await transaction.get(conversationDocRef);

      if (!conversationDoc.exists) {
        throw new Error("Conversation not found");
      }

      let metricsDocRef;
      if (metricsQuerySnapshot.empty) {
        console.log("Creating new metrics document");
        metricsDocRef = metricsCollectionRef.doc();
        transaction.set(metricsDocRef, {
          projectId: projectId,
          dailyCounts: {
            [today]: {
              messageCount: admin.firestore.FieldValue.increment(1),
              likeCount: 0,
              dislikeCount: 0,
              // Additional classification counts
              escalationCount: classification.escalation ? 1 : 0,
              resolutionCount: classification.resolution ? 1 : 0,
              questionTypeCounts: {
                [classification.questionType]: 1,
              },
              positiveSentimentCount:
                classification.sentimentAnalysis === "positive" ? 1 : 0,
              negativeSentimentCount:
                classification.sentimentAnalysis === "negative" ? 1 : 0,
              neutralSentimentCount:
                classification.sentimentAnalysis === "neutral" ? 1 : 0,
              sourceConfidence: {
                cumulativeScore: classification.similarityScore || 0, // Assuming similarityScore is a number
                count: 1,
                average: classification.similarityScore || 0,
              },
            },
          },
        });
      } else {
        console.log("Updating existing metrics document");
        metricsDocRef = metricsQuerySnapshot.docs[0].ref;
        const metricsData = metricsQuerySnapshot.docs[0].data();
        let newCumulativeScore, newCount, newAverage;

        // Initialize if today's date is not present
        if (!metricsData.dailyCounts || !metricsData.dailyCounts[today]) {
          console.log("Initializing today's date");
          transaction.set(
            metricsDocRef,
            {
              dailyCounts: {
                ...metricsData.dailyCounts,
                [today]: {
                  messageCount: 1,
                  likeCount: 0,
                  dislikeCount: 0,
                  // Additional classification counts initialization
                  escalationCount: classification.escalation ? 1 : 0,
                  resolutionCount: classification.resolution ? 1 : 0,
                  questionTypeCounts: {
                    [classification.questionType]: 1,
                  },
                  positiveSentimentCount:
                    classification.sentimentAnalysis === "positive" ? 1 : 0,
                  negativeSentimentCount:
                    classification.sentimentAnalysis === "negative" ? 1 : 0,
                  neutralSentimentCount:
                    classification.sentimentAnalysis === "neutral" ? 1 : 0,
                  sourceConfidence: {
                    cumulativeScore: classification.similarityScore || 0, // Assuming similarityScore is a number
                    count: 1,
                    average: classification.similarityScore || 0,
                  },
                },
              },
            },
            { merge: true }
          );
        } else {
          // When updating existing metrics document
          const existingData = metricsData.dailyCounts[today];
          newCumulativeScore =
            (existingData.sourceConfidence?.cumulativeScore || 0) +
            (classification.similarityScore || 0);
          newCount = (existingData.sourceConfidence?.count || 0) + 1;
          newAverage = newCumulativeScore / newCount;
          console.log("Incrementing today's date");
          console.log("classification.escalation: ", classification.escalation);
          // Update metrics counts
          const updatePath = `dailyCounts.${today}`;
          transaction.update(metricsDocRef, {
            [`${updatePath}.messageCount`]:
              admin.firestore.FieldValue.increment(1),
            [`${updatePath}.escalationCount`]: classification.escalation
              ? admin.firestore.FieldValue.increment(1)
              : 0,
            [`${updatePath}.resolutionCount`]: classification.resolution
              ? admin.firestore.FieldValue.increment(1)
              : 0,
            [`${updatePath}.questionTypeCounts.${classification.questionType}`]:
              admin.firestore.FieldValue.increment(1),
            [`${updatePath}.positiveSentimentCount`]:
              classification.sentimentAnalysis === "positive"
                ? admin.firestore.FieldValue.increment(1)
                : 0,
            [`${updatePath}.negativeSentimentCount`]:
              classification.sentimentAnalysis === "negative"
                ? admin.firestore.FieldValue.increment(1)
                : 0,
            [`${updatePath}.neutralSentimentCount`]:
              classification.sentimentAnalysis === "neutral"
                ? admin.firestore.FieldValue.increment(1)
                : 0,
            [`${updatePath}.sourceConfidence.cumulativeScore`]:
              admin.firestore.FieldValue.increment(
                classification.similarityScore || 0
              ),
            [`${updatePath}.sourceConfidence.count`]:
              admin.firestore.FieldValue.increment(1),
            [`${updatePath}.sourceConfidence.average`]: newAverage,
          });
        }
      }

      // Update Conversation Collection
      const conversationData = conversationDoc.data();
      const lastMessageIndex = conversationData.messages.length - 1;
      transaction.update(conversationDocRef, {
        [`messages.${lastMessageIndex}.classification`]: classification,
      });
    });

    console.log("Transaction successfully committed!");
  } catch (error) {
    console.error("Transaction failed: ", error);
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
    if (projectId && /^[A-Za-z]/.test(projectId)) {
      projectId = projectId.charAt(0).toUpperCase() + projectId.slice(1);
    }
    console.log("before client");

    console.log("before response");

    const firstKeyArray: any = []
    console.log("firstKeyArray: ", firstKeyArray);

    // Map over the array to create a new list of objects with only the source and score fields.
    const sourceAndScoreList = firstKeyArray.map((item: any) => ({
      source: item.source,
      title: item.title,
      description: item.description,
      type: item.type,
      score: item._additional.score,
    }));

    console.log(sourceAndScoreList);

    return sourceAndScoreList;
  } catch (error) {
    console.error("Error retrieving data:", error);
    throw error;
  }
};

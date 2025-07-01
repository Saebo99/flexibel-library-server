import { EventHubProducerClient } from "@azure/event-hubs";
const conn = process.env.EH_CONN_CHAT_EVENTS!; // from Key Vault / env
const hub = process.env.EH_NAME || "chat-events";

export const producer = new EventHubProducerClient(conn, hub);

export async function emit(eventType: string, projectId: string, body: any) {
  const batch = await producer.createBatch();
  batch.tryAdd({
    body: JSON.stringify(body),
    properties: { eventType, projectId },
  });
  await producer.sendBatch(batch);
}

import { AzureChatOpenAI } from "@langchain/openai";
import { z } from "zod";

export const llm = new AzureChatOpenAI({
  temperature:  0.2,
  streaming: true,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY, // In Node.js defaults to process.env.AZURE_OPENAI_API_KEY
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
  azureOpenAIBasePath: process.env.AZURE_OPENAI_BASE_PATH
});
import express from "express";
import {
  createConversationController,
  endConversationController,
  retrieveConversationController,
} from "../controllers/conversationController";

const router = express.Router();

router.post("/api/v0/createConversation", createConversationController);
router.post("/api/v0/endConversation", endConversationController);
router.post("/api/v0/retrieveConversation", retrieveConversationController);

export default router;

import express from "express";
import {
  postChat,
  rateMessage,
  keywordSearch,
} from "../controllers/chatController";
import {
  componentPostChat,
  componentRateMessage,
  componentKeywordSearch,
} from "../controllers/componentChatController";

const router = express.Router();

router.post("/api/v0/chat", postChat);
router.post("/api/v0/rateMessage", rateMessage);
router.post("/api/v0/keywordSearch", keywordSearch);
router.post("/component/chat", componentPostChat);
router.post("/component/rateMessage", componentRateMessage);
router.post("/component/keywordSearch", componentKeywordSearch);

export default router;

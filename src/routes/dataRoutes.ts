import express from "express";
import {
  ingestData,
  ingestFile,
  ingestVideo,
  ingestFaq,
  ingestImprovedAnswer,
  deleteData,
} from "../controllers/dataController";
const multer = require("multer");

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post("/api/v0/ingestData", ingestData);
router.post("/api/v0/ingestFile", upload.single("file"), ingestFile);
router.post("/api/v0/ingestVideo", ingestVideo);
router.post("/api/v0/ingestFaq", ingestFaq);
router.post("/api/v0/ingestImprovedAnswer", ingestImprovedAnswer);
router.post("/api/v0/deleteData", deleteData);

export default router;

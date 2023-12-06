import express from "express";
import cors from "cors";
import dataRoutes from "./routes/dataRoutes";
import chatRoutes from "./routes/chatRoutes";
import conversationRoutes from "./routes/conversationRoutes";
// Import other routes as needed

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

app.use(dataRoutes); // Use the data routes
app.use(chatRoutes); // Use the chat routes
app.use(conversationRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;

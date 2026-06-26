/**
 * Entry point for the backend. Starts Express and mounts routes.
 * Port and tenant id come from config.runtime (env: PORT, TENANT_ID).
 * All API keys/tokens are loaded in src/config/env.js from .env.
 */

import express from "express";
import { metaRouter } from "./routes/metaWebhook.js";
import { config } from "./config/env.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/v1", metaRouter);

app.get("/", (req, res) => {
  res.send("Tech Jump LeadOps Day-1 API up");
});

app.listen(config.runtime.port, () => {
  console.log(`Server listening on port ${config.runtime.port}`);
});

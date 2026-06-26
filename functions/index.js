/**
 * Firebase Cloud Functions — HTTP API + scheduled sequence worker.
 */
const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const express = require("express");
const admin = require("firebase-admin");
const {attachApiRoutes} = require("./apiRoutes");
const {runSequenceWorker} = require("./sequenceWorker");

setGlobalOptions({maxInstances: 10, region: "us-central1"});

if (!admin.apps.length) {
  admin.initializeApp();
}
const adminAuth = admin.auth();
const db = admin.firestore();

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function requireUser(req, res) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({error: "Missing Authorization: Bearer <Firebase ID token>"});
    return null;
  }
  try {
    return await adminAuth.verifyIdToken(m[1].trim());
  } catch (e) {
    logger.warn("verifyIdToken failed", {err: e && e.message ? e.message : e});
    res.status(401).json({error: "Invalid or expired token"});
    return null;
  }
}

const app = express();
app.use(
  express.json({
    limit: "2mb",
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb",
  })
);

app.get("/api/health", (req, res) => {
  res.json({ok: true, service: "api"});
});

attachApiRoutes(app, {db, requireUser});

exports.api = onRequest(
  {
    invoker: "public",
    timeoutSeconds: 180,
    memory: "512MiB",
    secrets: ["OPENAI_API_KEY", "SENDGRID_API_KEY"],
  },
  app
);

exports.sequenceWorkerTick = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Etc/UTC",
    memory: "512MiB",
    secrets: ["SENDGRID_API_KEY"],
  },
  async () => {
    const out = await runSequenceWorker(db);
    logger.info("sequence_worker_tick", out);
  }
);

import express from "express";
import { pool } from "./db.js";

const app = express();
app.use(express.json());

// ✅ CORS setup
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ✅ In-memory request queue
const requestQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  const { appId, res } = requestQueue.shift();

  try {
    console.log("Processing appId:", appId);

    const validIds = [1, 2, 3, 4, 5];
    if (!validIds.includes(appId)) {
      return res.status(400).json({ error: "Invalid appId" });
    }

    const result = await pool.query(
      `UPDATE usage_counters
       SET count = count + 1
       WHERE option_id = $1
       RETURNING count`,
      [appId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "App ID not found in DB" });
    }

    const updatedCount = result.rows[0].count;

    res.status(200).json({
      message: "PUT processed successfully",
      updatedUsages: updatedCount,
    });
  } catch (err) {
    console.error("Error in /app-usage:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    isProcessing = false;
    processQueue(); // Continue to next in line
  }
}

app.get("/", (req, res) => {
  res.send("Server is running");
});

// ✅ PUT endpoint
app.put("/app-usage", (req, res) => {
  const appId = req.body.appId;

  if (!appId) {
    return res.status(400).json({ error: "Missing appId in request body" });
  }

  console.log("Received PUT request:", req.body);

  requestQueue.push({ appId, res });
  processQueue();
});

// ✅ Start server

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
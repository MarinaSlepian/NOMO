import express from "express";
import { pool } from "./db.js";

const app = express();
app.use(express.json());
console.log('🧠 🧠 Middleware active');


app.all("/route-check", (req, res) => {
  console.log("✅ /route-check handler reached!");
  res.send("Route check OK");
});

// ✅ CORS setup
app.use((req, res, next) => {
  console.log(`➡️ Request received: ${req.method} ${req.url}`);
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

  console.log("🚀 Processing appId:", appId); 
  try {
    const id = Number(appId);
    const validIds = [1, 2, 3, 4, 5];
    if (!validIds.includes(id)) {
      return res.status(400).json({ error: "Invalid appId" });
    }

    const result = await pool.query(
      `
      INSERT INTO usage_counters (option_id, usage_date, count)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (option_id, usage_date)
      DO UPDATE SET count = usage_counters.count + 1
      RETURNING count
      `,
      [id]
    );

    const updatedCount = result.rows[0].count;
    console.log("✅ DB updated for appId:", id, "on date:", new Date().toISOString().split('T')[0]);

    res.status(200).json({
      message: "PUT processed with daily tracking",
      updatedUsages: updatedCount,
    });
  } catch (err) {
    console.error("Error in /app-usage:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    isProcessing = false;
    processQueue(); // continue to next
  }
}

app.get("/", (req, res) => {
  console.log("✅ debug-log route hit");
  res.send("Server is running");
});

// ✅ PUT endpoint
app.put("/app-usage", (req, res) => {
  console.log("🟡 PUT /app-usage endpoint reached");
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
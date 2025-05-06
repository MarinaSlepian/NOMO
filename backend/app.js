import fs from "node:fs/promises";
import express from "express";

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

    const fileContent = await fs.readFile("./data/app-usage.json");
    const appData = JSON.parse(fileContent);

    const appIndex = appData.findIndex((app) => app.id === appId);
    if (appIndex === -1) {
      return res.status(404).json({ error: "App ID not found" });
    }

    appData[appIndex].usages++;

    await fs.writeFile("./data/app-usage.json", JSON.stringify(appData, null, 2));

    res.status(200).json({
      message: "Received PUT successfully",
      updatedUsages: appData[appIndex].usages,
    });
  } catch (err) {
    console.error("Error in /app-usage:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    isProcessing = false;
    processQueue(); // Continue to next in line
  }
}
app.get('/', (req, res) => {
  res.send('Server is running');
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
app.listen(3000, () => {
  console.log("Server listening on port 3000");
});

import express from "express";
import { pool } from "./db.js";
import fetch from 'node-fetch';
import { UAParser } from 'ua-parser-js';
  
const parser = new UAParser();

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
  const { appId, deviceId, res } = requestQueue.shift();

  console.log("🚀 Processing appId - deviceId ", appId,"-",deviceId); 
  try {
    const id = Number(appId);
    const validIds = [1, 2, 3, 4, 5];
    if (!validIds.includes(id)) {
      return res.status(400).json({ error: "Invalid appId" });
    }

        // ✅ Добавляем: сбор данных устройства
    const rawIp = res.req.headers["x-forwarded-for"] || res.req.socket.remoteAddress;
    const ipAddress = rawIp?.split(',')[0].trim();
    const userAgent = res.req.headers["user-agent"];

    // 🔍 1. Разбираем user-agent
    const ua = parser.setUA(userAgent).getResult();
    const os_platform = ua.os.name + " " + ua.os.version;
    const device_type = ua.device.type || "desktop"; // default if missing

    // 🌍 2. Получаем страну по IP через ipwho.is
    let country = "unknown";
    try {
      const response = await fetch(`https://ipwho.is/${ipAddress}`);
      const geo = await response.json();
      console.log("📦 ipwho.is result:", geo);

      if (geo.success) {
        country = geo.country;
      }
    } catch (e) {
      console.warn("🌐 ipwho.is lookup failed:", e.message);
    }


    // 💾 3. Обновляем device_info
    await pool.query(
      `
      INSERT INTO device_info (device_id, country, os_platform, device_type, last_seen)
      VALUES ($1, $2, $3, $4, CURRENT_DATE)
      ON CONFLICT (device_id) DO UPDATE
      SET country = EXCLUDED.country,
          os_platform = EXCLUDED.os_platform,
          device_type = EXCLUDED.device_type,
          last_seen = CURRENT_DATE
      `,
      [deviceId, country, os_platform, device_type]
    );
    
    // ✅ 2. Обновляем счётчик использования
    const result = await pool.query(
      `
      INSERT INTO usage_counters (device_id, option_id, usage_date, count)
      VALUES ($1, $2, CURRENT_DATE, 1)
      ON CONFLICT (device_id, option_id, usage_date)
      DO UPDATE SET count = usage_counters.count + 1
      RETURNING count
      `,
      [deviceId, id]
    );


    const updatedCount = result.rows[0].count;
    console.log("✅ usage_counters updated:", {
      deviceId,
      appId: id,
      updatedCount,
      date: new Date().toISOString().split("T")[0],
    });
    
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
  const deviceId = req.body.deviceId;

  if (!appId || !deviceId) {
    return res.status(400).json({ error: "Missing appId or deviceID in request body" });
  }

  console.log("Received PUT request:", req.body);

  requestQueue.push({ appId, deviceId,res });
  processQueue();
});

// ✅ Start server

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
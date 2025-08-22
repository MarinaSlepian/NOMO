// app.js
import 'dotenv/config';
import express from "express";
import { pool } from "./db.js";
import fetch from 'node-fetch';
import { UAParser } from 'ua-parser-js';
import cardcomRouter from "./payments/cardcom.js";
import authRouter from "./auth.js"; // 👈 import auth routes
import jwt from 'jsonwebtoken';



const parser = new UAParser();
const app = express();

app.use(express.json());
console.log('🧠 🧠 Middleware active');

// CORS setup
app.use((req, res, next) => {
  console.log(`➡️ Request received: ${req.method} ${req.url}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Routes
app.use("/api/pay", cardcomRouter);
// ✅ Success/fail pages
app.get("/pay/success", (req, res) => {
  res.send("Payment received. You can close this window.");
});

app.get("/pay/failed", (req, res) => {
  res.send("Payment failed or canceled.");
});

app.use("/", authRouter); // 👈 signup/login now live here

app.all("/route-check", (req, res) => {
  console.log("✅ /route-check handler reached!");
  res.send("Route check OK");
});

// In-memory request queue
const requestQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;
  const { appId, deviceId, email, res } = requestQueue.shift();

  console.log("🚀 Processing appId - deviceId ", appId, "-", deviceId);
  try {
    const id = Number(appId);
    const validIds = [1, 2, 3, 4, 5];
    if (!validIds.includes(id)) {
      return res.status(400).json({ error: "Invalid appId" });
    }

    // Get device info
    const rawIp = res.req.headers["x-forwarded-for"] || res.req.socket.remoteAddress;
    const ipAddress = rawIp?.split(',')[0].trim();
    const userAgent = res.req.headers["user-agent"];
    const ua = parser.setUA(userAgent).getResult();
    const os_platform = ua.os.name + " " + ua.os.version;
    const device_type = ua.device.type || "desktop";

    // Get country from IP
    let country = "unknown";
    try {
      const response = await fetch(`https://ipwho.is/${ipAddress}`);
      const geo = await response.json();
      if (geo.success) {
        country = geo.country;
      }
    } catch (e) {
      console.warn("🌐 ipwho.is lookup failed:", e.message);
    }

    // Update device_info
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

    // Update usage_counters
    const result = await pool.query(
      `
      INSERT INTO usage_counters (device_id, option_id, usage_date, count, email)
      VALUES ($1, $2, CURRENT_DATE, 1, $3)
      ON CONFLICT (device_id, option_id, usage_date)
      DO UPDATE SET count = usage_counters.count + 1
      RETURNING count
      `,
      [deviceId, id, email]
    );

    const updatedCount = result.rows[0].count;
    console.log("✅ usage_counters updated:", {
      deviceId,
      email,
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
    processQueue();
  }
}

// Main routes
app.get("/", (req, res) => {
  console.log("✅ debug-log route hit");
  res.send("Server is running");
});

app.put("/app-usage", (req, res) => {
  console.log("🟡 PUT /app-usage endpoint reached");
  const { appId, deviceId, email } = req.body;

  if (!appId || !deviceId) {
    return res.status(400).json({ error: "Missing appId or deviceId in request body" });
  }

  console.log("Received PUT request:", req.body);
  requestQueue.push({ appId, deviceId, email, res });
  processQueue();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Example auth guard. Replace with your JWT/session logic.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  console.log('🔐 Received Authorization header:', authHeader); // 👈 Log full header (for dev only)

  const token = authHeader.replace('Bearer ', '').trim();
  console.log('🔍 Extracted token:', token); // 👈 Token string for debugging (for dev only)

  if (!token) {
    console.warn('🚫 No token provided');
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // ⬅️ make sure you're using the correct env variable
    console.log('✅ Token verified:', decoded); // 👈 Show decoded payload
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ Auth failed:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}


// GET /api/access/me  -> { active: boolean, until: ISO | null }
app.get('/api/access/me', requireAuth, async (req, res) => {
  try {
    console.log('🔐 Access granted to user:', req.user);

    const email = req.user.email; // from auth middleware

    // ✅ Rely on the access window, not status
    const { rows } = await pool.query(
      `SELECT
         MAX(access_from)  AS from_ts,
         MAX(access_until) AS until_ts
       FROM payments
       WHERE user_email = $1 AND status IN ('paid','subscribed')`,

      [email]
    );

    const until = rows[0]?.until_ts || null;
    // optional: const from = rows[0]?.from_ts || null;

    res.json({
      active: !!until && new Date(until) > new Date(),
      until
      // optional: from
    });
  } catch (e) {
    console.error('access/me error', e);
    res.status(500).json({ error: 'internal' });
  }
});

// (optional) quick health check
app.get('/healthz', (_req, res) => res.send('ok'));

// Start server
const PORT = Number(process.env.PORT) || 3000;   // Render provides PORT
const HOST = '0.0.0.0';                          // listen on all interfaces

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  console.error('❌ app.listen error:', err);
});
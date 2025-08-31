// app.js
import 'dotenv/config';
import express from "express";
import { pool } from "./db.js";
import fetch from 'node-fetch';
import { UAParser } from 'ua-parser-js';
import cardcomRouter from "./payments/cardcom.js";
import authRouter from "./auth.js"; // 👈 import auth routes
import jwt from 'jsonwebtoken';
import accessRouter from './access.js';


const parser = new UAParser();
const app = express();

app.use('/api/access', accessRouter);

app.set("trust proxy", true);
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
// Fast path for preflight
app.options("*", (_req, res) => res.sendStatus(204));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/pay", cardcomRouter);

// Quick health checks to validate mount
app.get("/api/pay/healthz", (_req, res) => res.send("ok"));

// ✅ Success/fail pages
app.get("/pay/success", (_req, res) => {
  res.send("Payment received. You can close this window.");
});
app.get("/pay/failed", (_req, res) => {
  res.send("Payment failed or canceled.");
});

app.use("/", authRouter); // 👈 signup/login now live here

app.all("/route-check", (_req, res) => {
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
app.get("/", (_req, res) => {
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

// Example auth guard. Replace with your JWT/session logic.
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  console.log('🔐 Received Authorization header:', authHeader); // dev-only

  const token = authHeader.replace('Bearer ', '').trim();
  console.log('🔍 Extracted token:', token); // dev-only

  if (!token) {
    console.warn('🚫 No token provided');
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token verified:', decoded); // dev-only
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ Auth failed:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}



// (optional) quick health check
app.get('/healthz', (_req, res) => res.send('ok'));

// ─── Debug: print mounted Cardcom sub-routes on startup ───────────────
try {
  const layers = (cardcomRouter && cardcomRouter.stack) ? cardcomRouter.stack : [];
  console.log(`[Boot] Cardcom router layers: ${layers.length}`);
  for (const l of layers) {
    const methods = l?.route?.methods ? Object.keys(l.route.methods).join(',').toUpperCase() : 'MIDDLEWARE';
    const path = l?.route?.path || l?.name || '(anonymous)';
    console.log(`  • ${methods} ${path}`);
  }
} catch (e) {
  console.warn("⚠️ Could not introspect cardcomRouter:", e.message);
}

// ─── 404 handler LAST ─────────────────────────────────────────────────
app.use((req, res) => res.status(404).send(`Cannot ${req.method} ${req.originalUrl}`));

// Start server
const PORT = Number(process.env.PORT) || 3000;   // Render provides PORT
const HOST = '0.0.0.0';                          // listen on all interfaces

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  console.error('❌ app.listen error:', err);
});

// app.js
import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import { UAParser } from 'ua-parser-js';
import { pool } from './db.js';
import cardcomRouter from './payments/cardcom.js';
import authRouter from './auth.js';      // /signup, /login
import accessRouter from './access.js';  // should protect itself with requireAuth

const app = express();
const parser = new UAParser();

/* ── Core middleware FIRST ───────────────────── */
app.set('trust proxy', true);
app.use(express.json());
console.log('🧠 🧠 Middleware active');

// CORS
app.use((req, res, next) => {
  console.log(`➡️ Request received: ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
// Preflight
app.options('*', (_req, res) => res.sendStatus(204));

/* ── Routers (after middleware) ──────────────── */
app.use('/api', authRouter);            // -> /api/signup, /api/login
app.use('/',     authRouter); // only if the router’s routes are strictly /login and /signup

app.use('/api/pay', cardcomRouter);
app.use('/api/access', accessRouter);   // -> /api/access/me

/* ── Health & misc ──────────────────────────── */
app.get('/api/pay/healthz', (_req, res) => res.send('ok'));
app.get('/healthz', (_req, res) => res.send('ok'));
app.all('/route-check', (_req, res) => res.send('Route check OK'));

/* ── Device/usage tracking (unchanged) ──────── */
const requestQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;
  const { appId, deviceId, email, res } = requestQueue.shift();
  try {
    const id = Number(appId);
    const validIds = [1, 2, 3, 4, 5];
    if (!validIds.includes(id)) return res.status(400).json({ error: 'Invalid appId' });

    const rawIp = res.req.headers['x-forwarded-for'] || res.req.socket.remoteAddress;
    const ipAddress = rawIp?.split(',')[0].trim();
    const userAgent = res.req.headers['user-agent'];
    const ua = parser.setUA(userAgent).getResult();
    const os_platform = `${ua.os.name} ${ua.os.version}`;
    const device_type = ua.device.type || 'desktop';

    let country = 'unknown';
    try {
      const response = await fetch(`https://ipwho.is/${ipAddress}`);
      const geo = await response.json();
      if (geo.success) country = geo.country;
    } catch (e) { console.warn('🌐 ipwho.is lookup failed:', e.message); }

    await pool.query(
      `INSERT INTO device_info (device_id, country, os_platform, device_type, last_seen)
       VALUES ($1, $2, $3, $4, CURRENT_DATE)
       ON CONFLICT (device_id) DO UPDATE
       SET country = EXCLUDED.country,
           os_platform = EXCLUDED.os_platform,
           device_type = EXCLUDED.device_type,
           last_seen = CURRENT_DATE`,
      [deviceId, country, os_platform, device_type]
    );

    const result = await pool.query(
      `INSERT INTO usage_counters (device_id, option_id, usage_date, count, email)
       VALUES ($1, $2, CURRENT_DATE, 1, $3)
       ON CONFLICT (device_id, option_id, usage_date)
       DO UPDATE SET count = usage_counters.count + 1
       RETURNING count`,
      [deviceId, id, email]
    );

    res.status(200).json({ message: 'PUT processed with daily tracking', updatedUsages: result.rows[0].count });
  } catch (err) {
    console.error('Error in /app-usage:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    isProcessing = false;
    processQueue();
  }
}

app.get('/', (_req, res) => res.send('Server is running'));
app.put('/app-usage', (req, res) => {
  const { appId, deviceId, email } = req.body;
  if (!appId || !deviceId) return res.status(400).json({ error: 'Missing appId or deviceId' });
  requestQueue.push({ appId, deviceId, email, res });
  processQueue();
});

/* ── 404 & startup ──────────────────────────── */
app.use((req, res) => res.status(404).send(`Cannot ${req.method} ${req.originalUrl}`));

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
});
server.on('error', (err) => console.error('❌ app.listen error:', err));

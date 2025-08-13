// payments/cardcom.js
import express from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";

const router = express.Router();

// === Required envs ===
const TERMINAL = Number(process.env.CARDCOM_TERMINAL);
const API_NAME = process.env.CARDCOM_API_NAME;

// FRONTEND (browser redirects) and BACKEND (server webhook)
const APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:4200";
const API_URL = process.env.PUBLIC_API_URL || "https://nomo-cj4l.onrender.com";

// --- sanity checks ---
if (!Number.isFinite(TERMINAL)) console.error("[Cardcom] Missing/invalid CARDCOM_TERMINAL");
if (!API_NAME) console.error("[Cardcom] Missing CARDCOM_API_NAME");

// --- helpers ---
async function logEvent({ orderId, lowProfileId, type, payload }) {
  await pool.query(
    `INSERT INTO payment_events (order_id, low_profile_id, event_type, payload)
     VALUES ($1, $2, $3, $4)`,
    [orderId, lowProfileId || null, type, payload ? JSON.stringify(payload) : null]
  );
}

async function saveStart({ orderId, lowProfileId, userId, amountMinor, currency }) {
  await pool.query(
    `INSERT INTO payments (order_id, low_profile_id, user_id, amount_minor, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (order_id) DO UPDATE
     SET low_profile_id = EXCLUDED.low_profile_id,
         amount_minor   = EXCLUDED.amount_minor,
         currency       = EXCLUDED.currency,
         updated_at     = now()`,
    [orderId, lowProfileId, userId || null, amountMinor, currency]
  );
  await logEvent({ orderId, lowProfileId, type: "start_ok" });
}

async function markPaid({ lowProfileId, orderId, txId, amountMinor, cardType, last4, payload }) {
  await pool.query(
    `UPDATE payments
       SET status='paid',
           transaction_id=$1,
           card_type=$2,
           card_last4=$3,
           amount_minor=COALESCE($4, amount_minor),
           verify_payload=$5,
           updated_at=now()
     WHERE low_profile_id=$6`,
    [txId || null, cardType || null, last4 || null, amountMinor || null, JSON.stringify(payload || null), lowProfileId]
  );
  await logEvent({ orderId, lowProfileId, type: "verify_ok", payload });
}

async function markFailed({ lowProfileId, orderId, reason, payload }) {
  await pool.query(
    `UPDATE payments
       SET status='failed',
           failure_reason=$1,
           verify_payload=$2,
           updated_at=now()
     WHERE low_profile_id=$3`,
    [reason || "unknown", JSON.stringify(payload || null), lowProfileId]
  );
  await logEvent({ orderId, lowProfileId, type: "verify_fail", payload });
}

async function cardcomFetch(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await resp.json();
}

function normalizeUrl(u, fallbackPath) {
  try {
    if (!u) throw new Error("missing");
    const parsed = new URL(u); // throws if invalid
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("protocol");
    return parsed.toString();
  } catch {
    return `${APP_URL}${fallbackPath}`;
  }
}

/**
 * POST /api/pay/start
 * Body: { amount:number, orderId:string, description?:string, currency?:number, userId?:number|string, successUrl?:string, failUrl?:string }
 * Returns: { url, lowProfileId }
 */
router.post("/start", async (req, res) => {
  try {
    const {
      amount,
      orderId,
      description = "NOMO payment",
      currency = 1,
      userId,
      successUrl,
      failUrl
    } = req.body;

    const amt = Number(amount);
    const oid = String(orderId || "").trim();

    if (!Number.isFinite(amt) || amt <= 0 || !oid) {
      return res.status(400).json({ error: "Invalid amount or orderId" });
    }
    if (!Number.isFinite(TERMINAL) || !API_NAME) {
      return res.status(500).json({ error: "Server misconfigured: Cardcom credentials" });
    }

    const SuccessRedirectUrl = normalizeUrl(successUrl, "/pay/success");
    const FailedRedirectUrl  = normalizeUrl(failUrl, "/pay/failed");
    const WebHookUrl         = `${API_URL}/api/pay/webhook`;

    const body = {
      TerminalNumber: TERMINAL,
      ApiName: API_NAME,
      Operation: "ChargeOnly",
      Amount: amt,                      // major units (₪)
      ISOCoinId: Number(currency) || 1, // 1 = ILS
      ProductName: description,
      ReturnValue: oid,
      SuccessRedirectUrl,
      FailedRedirectUrl,
      WebHookUrl,
      Language: "EN",
    };

    console.log("➡️ /start payload:", { oid, amt, SuccessRedirectUrl, FailedRedirectUrl });

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/Create",
      body
    );

    console.log("🟠 Cardcom Create response:", data);

    if (data?.ResponseCode === 0 && data?.Url) {
      const amountMinor = Math.round(amt * 100); // ₪ -> agorot
      await saveStart({
        orderId: oid,
        lowProfileId: String(data.LowProfileId),
        userId,
        amountMinor,
        currency: Number(currency) || 1,
      });
      console.log("✅ Start OK:", { LowProfileId: data.LowProfileId, orderId: oid });
      return res.json({ url: data.Url, lowProfileId: data.LowProfileId });
    }

    await logEvent({ orderId: oid, lowProfileId: null, type: "start_fail", payload: data });
    return res.status(400).json({ error: data?.Description || "Cardcom error", raw: data });
  } catch (err) {
    console.error("❌ Cardcom /start error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Webhook expects raw text; verify with POST (not GET)
router.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  try {
    const raw = req.body || "";
    console.log("📬 Webhook raw:", raw?.slice(0, 400)); // truncated log

    // Support URL-encoded text; allow numeric or UUID LowProfileId
    const qs = new URLSearchParams(raw);
    const lpFromQS = qs.get("LowProfileId");
    const lpFromRegex = /(?:^|[&])LowProfileId=([^&]+)/i.exec(raw)?.[1];
    const lowProfileId = (lpFromQS || lpFromRegex || "").trim();

    if (!lowProfileId) {
      console.warn("Webhook without LowProfileId");
      return res.status(200).send("MISSING LOWPROFILEID"); // ack to avoid retries
    }

    // Verify with Cardcom via POST
    const verifyData = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult",
      {
        TerminalNumber: Number(TERMINAL),
        ApiName: API_NAME,
        LowProfileId: lowProfileId,
      }
    );

    console.log("🔎 Verify result:", {
      LowProfileId: lowProfileId,
      ResponseCode: verifyData?.ResponseCode,
      Description: verifyData?.Description,
      ReturnValue: verifyData?.ReturnValue,
    });

    const orderId = verifyData?.ReturnValue ? String(verifyData.ReturnValue) : null;

    if (verifyData?.ResponseCode === 0) {
      const txId   = verifyData.TransactionId ? String(verifyData.TransactionId) : null;
      const amount = Number(verifyData.Amount ?? NaN);
      const amountMinor = Number.isFinite(amount) ? Math.round(amount * 100) : null;
      const cardType = verifyData.CardType || null;
      const last4    = verifyData.CardMask ? String(verifyData.CardMask).slice(-4) : null;

      await markPaid({ lowProfileId, orderId, txId, amountMinor, cardType, last4, payload: verifyData });
      console.log("✅ Webhook OK:", { lowProfileId, orderId, txId });
      return res.status(200).send("OK");
    }

    await markFailed({
      lowProfileId,
      orderId,
      reason: verifyData?.Description || `code:${verifyData?.ResponseCode}`,
      payload: verifyData
    });
    console.warn("🟡 Webhook FAIL:", { lowProfileId, orderId, desc: verifyData?.Description });
    return res.status(200).send("FAIL"); // still 200 to acknowledge
  } catch (err) {
    console.error("❌ Cardcom /webhook error:", err);
    return res.status(200).send("ERROR"); // ack so they don't spam retries
  }
});

// Manual status check (GET by param) — calls Cardcom via POST under the hood
router.get("/status/:lowProfileId", async (req, res) => {
  try {
    const { lowProfileId } = req.params;

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult",
      {
        TerminalNumber: Number(TERMINAL),
        ApiName: API_NAME,
        LowProfileId: String(lowProfileId),
      }
    );

    console.log("🛰️ Manual status check (GET):", {
      LowProfileId: lowProfileId,
      ResponseCode: data?.ResponseCode,
      Description: data?.Description,
    });

    res.json(data);
  } catch (err) {
    console.error("Cardcom /status (GET) error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Manual status check (POST body: { lowProfileId }) — also POST to Cardcom
router.post("/status", express.json(), async (req, res) => {
  try {
    const lowProfileId = String(req.body?.lowProfileId || "").trim();
    if (!lowProfileId) return res.status(400).json({ error: "lowProfileId required" });

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult",
      {
        TerminalNumber: Number(TERMINAL),
        ApiName: API_NAME,
        LowProfileId: lowProfileId,
      }
    );

    console.log("🛰️ Manual status check (POST):", {
      LowProfileId: lowProfileId,
      ResponseCode: data?.ResponseCode,
      Description: data?.Description
    });

    res.json(data);
  } catch (err) {
    console.error("Cardcom /status (POST) error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

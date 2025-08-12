// payments/cardcom.js
import express from "express";
import fetch from "node-fetch";
import { pool } from "../db.js"; // 👈 add this

const router = express.Router();

const TERMINAL = process.env.CARDCOM_TERMINAL;
const API_NAME = process.env.CARDCOM_API_NAME;
const BASE_URL = process.env.PUBLIC_BASE_URL;

// helpers to persist
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
  await logEvent({ orderId, lowProfileId, type: 'start_ok' });
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
  await logEvent({ orderId, lowProfileId, type: 'verify_ok', payload });
}

async function markFailed({ lowProfileId, orderId, reason, payload }) {
  await pool.query(
    `UPDATE payments
       SET status='failed',
           failure_reason=$1,
           verify_payload=$2,
           updated_at=now()
     WHERE low_profile_id=$3`,
    [reason || 'unknown', JSON.stringify(payload || null), lowProfileId]
  );
  await logEvent({ orderId, lowProfileId, type: 'verify_fail', payload });
}

// Small helper for Cardcom HTTP POST
async function cardcomFetch(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await resp.json();
}

/**
 * POST /api/pay/start
 * Body: { amount:number, orderId:string, description?:string, currency?:number, userId?:number }
 * Returns: { url, lowProfileId }
 */
router.post("/start", async (req, res) => {
  try {
    const { amount, orderId, description = "NOMO payment", currency = 1, userId } = req.body;
    if (!amount || !orderId) {
      return res.status(400).json({ error: "amount and orderId are required" });
    }

    const body = {
      TerminalNumber: Number(TERMINAL),
      ApiName: API_NAME,
      Operation: "ChargeOnly",
      Amount: Number(amount),          // Cardcom expects major units (₪)
      ISOCoinId: Number(currency),     // 1=ILS
      ProductName: description,
      ReturnValue: String(orderId),    // comes back in verification
      SuccessRedirectUrl: `${BASE_URL}/pay/success`,
      FailedRedirectUrl: `${BASE_URL}/pay/failed`,
      WebHookUrl: `${BASE_URL}/api/pay/webhook`,
      Language: "EN",
    };

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/Create",
      body
    );

    if (data?.ResponseCode === 0 && data?.Url) {
      // persist "pending"
      const amountMinor = Math.round(Number(amount) * 100); // ₪ -> agorot
      await saveStart({
        orderId,
        lowProfileId: String(data.LowProfileId),
        userId,
        amountMinor,
        currency: Number(currency),
      });

      return res.json({ url: data.Url, lowProfileId: data.LowProfileId });
    }

    await logEvent({ orderId, lowProfileId: null, type: 'start_fail', payload: data });
    return res.status(400).json({ error: data?.Description || "Cardcom error", raw: data });
  } catch (err) {
    console.error("Cardcom /start error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Webhook expects raw text
router.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  try {
    const raw = req.body || "";
    const lowProfileId =
      /LowProfileId=(\d+)/.exec(raw)?.[1] ||
      new URLSearchParams(raw).get("LowProfileId");

    if (!lowProfileId) {
      console.warn("Webhook without LowProfileId. Raw:", raw);
      return res.status(200).send("MISSING LOWPROFILEID"); // ack to avoid retries
    }

    // Verify with Cardcom
    const url = new URL("https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult");
    url.searchParams.set("TerminalNumber", TERMINAL);
    url.searchParams.set("ApiName", API_NAME);
    url.searchParams.set("LowProfileId", lowProfileId);

    const verifyResp = await fetch(url.toString());
    const verifyData = await verifyResp.json();

    const orderId = verifyData?.ReturnValue ? String(verifyData.ReturnValue) : null;

    if (verifyData?.ResponseCode === 0) {
      // Pull useful fields (guarding if not present)
      const txId   = verifyData.TransactionId ? String(verifyData.TransactionId) : null;
      const amount = Number(verifyData.Amount ?? NaN); // major units
      const amountMinor = Number.isFinite(amount) ? Math.round(amount * 100) : null;
      const cardType = verifyData.CardType || null;
      const last4    = verifyData.CardMask ? String(verifyData.CardMask).slice(-4) : null;

      await markPaid({
        lowProfileId,
        orderId,
        txId,
        amountMinor,
        cardType,
        last4,
        payload: verifyData
      });

      return res.status(200).send("OK");
    }

    await markFailed({
      lowProfileId,
      orderId,
      reason: verifyData?.Description || `code:${verifyData?.ResponseCode}`,
      payload: verifyData
    });

    return res.status(200).send("FAIL"); // still 200 to acknowledge
  } catch (err) {
    console.error("Cardcom /webhook error:", err);
    return res.status(200).send("ERROR"); // ack so they don't spam retries
  }
});

// Manual status check
router.get("/status/:lowProfileId", async (req, res) => {
  try {
    const { lowProfileId } = req.params;
    const url = new URL("https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult");
    url.searchParams.set("TerminalNumber", TERMINAL);
    url.searchParams.set("ApiName", API_NAME);
    url.searchParams.set("LowProfileId", lowProfileId);

    const r = await fetch(url.toString());
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error("Cardcom /status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

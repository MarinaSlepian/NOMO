// payments/cardcom.js
import express from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";

const DEFAULT_PLAN_DAYS = 30; // adjust as needed

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

async function saveStart({ orderId, lowProfileId, userEmail, amountMinor, currency, planDays }) {
  await pool.query(
    `INSERT INTO payments (order_id, low_profile_id, user_email, amount_minor, currency, status, plan_days)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (order_id) DO UPDATE
     SET low_profile_id = EXCLUDED.low_profile_id,
         user_email     = COALESCE(EXCLUDED.user_email, payments.user_email),
         amount_minor   = EXCLUDED.amount_minor,
         currency       = EXCLUDED.currency,
         plan_days      = COALESCE(EXCLUDED.plan_days, payments.plan_days),
         updated_at     = now()`,
    [orderId, lowProfileId, userEmail || null, amountMinor, currency, planDays || DEFAULT_PLAN_DAYS]
  );
  await logEvent({ orderId, lowProfileId, type: 'start_ok' });
}


async function markPaid({
  lowProfileId,
  orderId,
  txId,
  amountMinor,
  cardType,
  last4,
  payload,
  planDays,
}) {
  const sql = `
    WITH me AS (
      SELECT user_email, COALESCE(plan_days, $8) AS plan_days
      FROM payments
      WHERE low_profile_id = $4
    ),
    base AS (
      SELECT
        (SELECT COALESCE(MAX(access_until), now())
           FROM payments p2
          WHERE p2.user_email = (SELECT user_email FROM me)
            AND p2.status = 'paid') AS last_until,
        (SELECT plan_days FROM me) AS plan_days
    ),
    start_at AS (
      SELECT GREATEST(now(), (SELECT last_until FROM base)) AS s
    )
    UPDATE payments p
       SET status         = 'paid',
           amount_minor   = COALESCE($1, amount_minor),
           verify_payload = $2,
           paid_at        = now(),
           transaction_id = $3,
           order_id       = COALESCE($5::text, order_id),
           card_type      = $6,
           card_last4     = $7,
           access_from    = (SELECT s FROM start_at),
           access_until   = (SELECT s FROM start_at) + ((SELECT plan_days FROM base) || ' days')::interval,
           plan_days      = (SELECT plan_days FROM base),
           updated_at     = now()
     WHERE p.low_profile_id = $4
     RETURNING user_email, access_from, access_until, plan_days;
  `;

  let amtMinor = Number(amountMinor);
  if (!Number.isFinite(amtMinor)) amtMinor = null;

  const { rows } = await pool.query(sql, [
    amtMinor,
    JSON.stringify(payload || null),
    txId || null,
    lowProfileId,
    orderId || null,
    cardType || null,
    last4 || null,
    planDays,
  ]);

  await logEvent({ orderId, lowProfileId, type: "verify_ok", payload });
  return rows[0];
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
function getPeriodFromPlanDays(planDays) {
  if (planDays >= 365) {
    return { PeriodTypeCode: 4, PeriodFrequency: 1 }; // שנה
  }
  if (planDays >= 90) {
    return { PeriodTypeCode: 3, PeriodFrequency: 3 }; // רבעון
  }
  return { PeriodTypeCode: 3, PeriodFrequency: 1 }; // ברירת מחדל: חודש
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
      userEmail,
      successUrl,
      failUrl,
      planDays = DEFAULT_PLAN_DAYS   // ✅ read from frontend, default to 30
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
      Operation: "CreateSubscription",
      Amount: amt,
      ISOCoinId: Number(currency) || 1,
      ProductName: description,
      ReturnValue: oid,
      SuccessRedirectUrl,
      FailedRedirectUrl,
      WebHookUrl,
      Language: "EN",
    };

        // רק אם זה מנוי – מוסיפים פרטים נוספים
    if (true) {
      const { PeriodTypeCode, PeriodFrequency } = getPeriodFromPlanDays(planDays);
      Object.assign(body, {
        PeriodTypeCode,
        PeriodFrequency,
        MaxNumOfPayments: 9999,
        FirstPaymentSum: amt,
      });
    }

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/Create",
      body
    );

    console.log("🟠 Cardcom Create response:", data);

    if (data?.ResponseCode === 0 && data?.Url) {
      const amountMinor = Math.round(amt * 100);
      await saveStart({
        orderId: oid,
        lowProfileId: String(data.LowProfileId),
        userEmail,
        amountMinor,
        currency: Number(currency) || 1,
        planDays // ✅ now passed into saveStart
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


// ===== /webhook =====
router.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  try {
    const rawBody = req.body;
    let parsed;

    try {
      parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    } catch {
      // If not JSON, try to parse as URL-encoded form
      parsed = Object.fromEntries(new URLSearchParams(rawBody));
    }

    const lowProfileId =
      parsed?.LowProfileId || parsed?.lowprofileid || parsed?.lowProfileId || "";
    if (!lowProfileId) throw new Error("Missing LowProfileId in webhook");

    const verifyData = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult",
      {
        TerminalNumber: TERMINAL,
        ApiName: API_NAME,
        LowProfileId: lowProfileId,
      }
    );

    const orderId = verifyData?.ReturnValue ? String(verifyData.ReturnValue) : null;

    if (verifyData?.ResponseCode === 0) {
      const txId = verifyData?.TranzactionId
        ? String(verifyData.TranzactionId)
        : verifyData?.TranzactionInfo?.TranzactionId
        ? String(verifyData.TranzactionInfo.TranzactionId)
        : null;

      const tInfo = verifyData.TranzactionInfo || {};

      const amount = Number(tInfo?.Amount);
      const amountMinor =
        Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;

      const cardType = tInfo?.CardName || null;
      const last4 =
        tInfo?.Last4CardDigitsString ||
        (tInfo?.Last4CardDigits
          ? String(tInfo.Last4CardDigits).padStart(4, "0")
          : null);

      const brand = tInfo?.Brand || null;
      const issuer = tInfo?.Issuer || null;
      const cardOwner = tInfo?.CardOwnerName || null;

      console.log("🔍 amount:", amount, "→ amountMinor:", amountMinor);
      console.log("💳 last4:", last4, "cardType:", cardType);
      console.log("💳 brand:", brand, "issuer:", issuer, "cardOwner:", cardOwner);

      // ✅ Get planDays from DB (fallback to DEFAULT_PLAN_DAYS)
      const { rows: pdRows } = await pool.query(
        `SELECT plan_days FROM payments WHERE low_profile_id = $1 LIMIT 1`,
        [lowProfileId]
      );
      const planDays = pdRows[0]?.plan_days || DEFAULT_PLAN_DAYS;

      await markPaid({
        lowProfileId,
        orderId,
        txId,
        amountMinor,
        cardType,
        last4,
        brand,
        issuer,
        cardOwner,
        payload: verifyData,
        planDays,
      });

      console.log("✅ Webhook OK:", { lowProfileId, orderId, txId });
      return res.status(200).send("OK");
    }

    // If response code not 0
    await markFailed({
      lowProfileId,
      orderId,
      reason: verifyData?.Description || `code:${verifyData?.ResponseCode}`,
      payload: verifyData,
    });

    console.warn("🟡 Webhook FAIL:", {
      lowProfileId,
      orderId,
      desc: verifyData?.Description,
    });
    return res.status(200).send("FAIL");
  } catch (err) {
    console.error("❌ Cardcom /webhook error:", err);
    return res.status(200).send("ERROR");
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

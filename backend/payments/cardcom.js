// payments/cardcom.js
// 💡 Cardcom recurring billing implementation (2-step):
// Step 1: User pays one-time via LowProfile
// Step 2: On webhook → use token to call Subscription/CreateSubscription

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

export async function cardcomFetch(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("🔴 Failed to parse Cardcom response as JSON:", text);
    throw new Error("Invalid JSON response from Cardcom");
  }
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
      orderId,
      description = "NOMO subscription",
      userEmail,
      successUrl,
      failUrl,
      amount,                // 👈 NEW: monthly/quarterly/yearly price (float)
      currency = 1,          // 👈 NEW: 1=ILS
      planDays = DEFAULT_PLAN_DAYS  // 👈 NEW: 30/90/365 etc.
    } = req.body;

    const oid = String(orderId || "").trim();
    if (!oid) return res.status(400).json({ error: "Missing orderId" });

    if (!Number.isFinite(TERMINAL) || !API_NAME) {
      return res.status(500).json({ error: "Server misconfigured: Cardcom credentials" });
    }

    const SuccessRedirectUrl = normalizeUrl(successUrl, "/pay/success");
    const FailedRedirectUrl  = normalizeUrl(failUrl,  "/pay/failed");
    const WebHookUrl         = `${API_URL}/api/pay/webhook`;

    // LowProfile save-card only (no charge)
    const body = {
      TerminalNumber: TERMINAL,
      ApiName: API_NAME,
      Operation: 3, // save card only
      ProductName: description,
      ReturnValue: oid,
      SuccessRedirectUrl,
      FailedRedirectUrl,
      WebHookUrl,
      Language: "EN"
    };

    console.log("🟠 Saving card only:", body);

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/Create",
      body
    );

    console.log("🟠 Cardcom SaveCard response:", data);

    if (data?.ResponseCode === 0 && data?.Url) {
      // ✅ persist amount/currency/planDays for webhook → RecurringPayment
      const amountMinor =
        Number.isFinite(Number(amount)) && Number(amount) > 0
          ? Math.round(Number(amount) * 100)
          : null;

      await pool.query(`
        INSERT INTO payments (order_id, low_profile_id, user_email, amount_minor, currency, status, plan_days)
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        ON CONFLICT (order_id) DO UPDATE
        SET low_profile_id = EXCLUDED.low_profile_id,
            user_email     = COALESCE(EXCLUDED.user_email, payments.user_email),
            amount_minor   = COALESCE(EXCLUDED.amount_minor, payments.amount_minor),
            currency       = COALESCE(EXCLUDED.currency, payments.currency),
            plan_days      = COALESCE(EXCLUDED.plan_days, payments.plan_days),
            updated_at     = now()
      `, [oid, String(data.LowProfileId), userEmail || null, amountMinor, Number(currency) || 1, planDays]);

      await logEvent({ orderId: oid, lowProfileId: String(data.LowProfileId), type: "start_ok" });
      return res.json({ url: data.Url, lowProfileId: data.LowProfileId });
    }

    await logEvent({ orderId: oid, lowProfileId: null, type: "start_fail", payload: data });
    return res.status(400).json({ error: data?.Description || "Cardcom error", raw: data });
  } catch (err) {
    console.error("❌ Cardcom /start (SaveCard) error:", err);
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
      parsed = Object.fromEntries(new URLSearchParams(rawBody));
    }

    const lowProfileId =
      parsed?.LowProfileId || parsed?.lowprofileid || parsed?.lowProfileId || "";
    if (!lowProfileId) throw new Error("Missing LowProfileId in webhook");

    // 1) Verify LowProfile (JSON API)
    const verifyData = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult",
      { TerminalNumber: TERMINAL, ApiName: API_NAME, LowProfileId: lowProfileId }
    );

    const orderId   = verifyData?.ReturnValue ? String(verifyData.ReturnValue) : null;
    const tInfo     = verifyData?.TranzactionInfo || {};
    const cardToken = tInfo?.Token || null;

    if (verifyData?.ResponseCode !== 0 || !cardToken) {
      await logEvent({ orderId, lowProfileId, type: "subscription_fail", payload: verifyData });
      return res.status(200).send("FAIL");
    }

    // 2) Pull what we need for recurring from your DB (only existing fields)
    const { rows } = await pool.query(
      `SELECT amount_minor, currency, user_email, plan_days, access_from, access_until
         FROM payments
        WHERE low_profile_id = $1
        LIMIT 1`,
      [lowProfileId]
    );

    const rec = rows[0] || {};
    const amount    = Number(rec.amount_minor || 0) / 100; // price per interval
    const coinId    = Number(rec.currency || 1);           // 1 = ILS
    const planDays  = Number(rec.plan_days || 30);

    if (!amount || amount <= 0) {
      await logEvent({
        orderId, lowProfileId,
        type: "subscription_fail",
        payload: { reason: "Missing amount (amount_minor)" }
      });
      return res.status(200).send("FAIL");
    }

    // 3) Map plan_days -> RecurringPayments.TimeIntervalId (+ env overrides)
    const timeIntervalId = mapPlanDaysToTimeIntervalId(planDays);

    // 4) Next charge date (dd/MM/yyyy). You can offset via env if you like.
    const d = new Date();
    const offset = Number(process.env.CARDCOM_START_OFFSET_DAYS || 0); // 0=today, 1=tomorrow, etc.
    if (Number.isFinite(offset) && offset > 0) d.setDate(d.getDate() + offset);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const nextDateToBill = `${dd}/${mm}/${yyyy}`;

    // 5) Build NV GET params for RecurringPayment.aspx
    const customerName = tInfo?.CardOwnerName || rec.user_email || "NOMO user";

    const params = {
      TerminalNumber: TERMINAL,
      UserName: API_NAME,
      codepage: 65001,
      Operation: "NewAndUpdate",

      // Payment source (from LowProfile Operation=3):
      "CreditCard.Token": cardToken,

      // Account info:
      "Account.CompanyName": customerName,
      "Account.Email": rec.user_email || "",

      // Recurring details:
      "RecurringPayments.InternalDecription": "NOMO subscription",
      "RecurringPayments.InternalDescription": "NOMO subscription",
      "RecurringPayments.NextDateToBill": nextDateToBill,   // dd/MM/yyyy
      "RecurringPayments.TotalNumOfBills": 999999,          // effectively endless
      "RecurringPayments.FinalDebitCoinId": coinId,         // 1=ILS
      "RecurringPayments.ReturnValue": orderId || "",

      "RecurringPayments.TimeIntervalId": timeIntervalId,

      // Line (price per interval):
      "RecurringPayments.FlexItem.InvoiceDescription": "NOMO plan",
      "RecurringPayments.FlexItem.Price": amount.toFixed(2),
      "RecurringPayments.FlexItem.IsPriceIncludeVat": "true",
    };

    console.log("📦 RecurringPayment NV params:", params);

    // 6) Call the NV GET endpoint
    const subResult = await cardcomFetchNVGet(
      "https://secure.cardcom.solutions/interface/RecurringPayment.aspx",
      params
    );

    console.log("📦 RecurringPayment NV response:", subResult);

    if (String(subResult?.ResponseCode) !== "0") {
      await logEvent({ orderId, lowProfileId, type: "subscription_fail", payload: subResult });
      return res.status(200).send("FAIL");
    }

    // Extract ids + card meta + payloads
    const recurringId = extractRecurringId(subResult);
    if (!recurringId) {
      await logEvent({
        orderId, lowProfileId, type: "subscription_fail",
        payload: { reason: "Missing RecurringId in NV response", subResult }
      });
      return res.status(200).send("FAIL");
    }
    const accountId = subResult?.AccountId || null;

    const last4 =
      tInfo?.Last4CardDigitsString ||
      (tInfo?.Last4CardDigits ? String(tInfo.Last4CardDigits).padStart(4, "0") : null);
    const cardType = tInfo?.CardName || null;
    const combinedPayload = { lp: verifyData, rp: subResult };

    // 7) Immediately grant access (idempotent: only if not already set)
    //    access_from = COALESCE(access_from, now())
    //    access_until = COALESCE(access_until, now() + plan_days)
    await pool.query(
      `UPDATE payments
          SET subscription_id     = $1,
              card_token          = $2,
              cardcom_account_id  = COALESCE($3, cardcom_account_id),
              card_type           = COALESCE($4, card_type),
              card_last4          = COALESCE($5, card_last4),
              verify_payload      = $6,
              access_from         = COALESCE(access_from, now()),
              access_until        = COALESCE(access_until, now() + ($7 || ' days')::interval),
              status              = 'subscribed',
              updated_at          = now()
        WHERE low_profile_id = $8`,
      [recurringId, cardToken, accountId, cardType, last4, JSON.stringify(combinedPayload), String(planDays), lowProfileId]
    );

    await logEvent({ orderId, lowProfileId, type: "subscription_created_and_access_opened", payload: subResult });
    return res.status(200).send("OK");

  } catch (err) {
    console.error("❌ Cardcom /webhook error:", err);
    return res.status(200).send("ERROR");
  }
});



// Recurring status webhook (Cardcom → your server)
// In Cardcom Admin, point “דיווח למערכת חיצונית - הוראת קבע” to this URL.
router.post("/recurring-webhook",
  express.urlencoded({ extended: false }), // Cardcom posts URL-encoded form
  async (req, res) => {
    try {
      const b = req.body || {};

      // 0) Verify Secret (recommended by Cardcom)
      const secret = b.Secret || b.secret;
      if (process.env.CARDCOM_RECURRING_WEBHOOK_SECRET &&
          secret !== process.env.CARDCOM_RECURRING_WEBHOOK_SECRET) {
        console.warn("❌ Recurring webhook: bad secret");
        return res.status(403).send("BAD_SECRET");
      }

      const recordType = b.RecordType || b.recordtype || "";
      const recurringId = b.RecurringId || b.recurringid || null;
      const returnValue = b.ReturnValue || b.returnvalue || null; // your orderId if you sent it on creation

      // Log all raw payloads for auditing
      await logEvent({
        orderId: returnValue || null,
        lowProfileId: null,
        type: `recurring_${String(recordType || "unknown").toLowerCase()}`,
        payload: b
      });

      // 1) Creation/changes to the recurring order
      if (recordType === "MasterRecurring") {
        // nothing to do for access—just acknowledge
        return res.status(200).send("OK");
      }

      // 2) A real debit or its status update
      if (recordType === "DetailRecurring") {
        const status = b.Status || b.status || "";
        // We only grant access on a successful debit
        if (status !== "SUCCESSFUL") {
          // You may mark failures for visibility:
          // await pool.query(`UPDATE payments SET status='failed', verify_payload=$1, updated_at=now() WHERE subscription_id=$2`,
          //   [JSON.stringify(b), recurringId]);
          return res.status(200).send("OK");
        }

        // Amount actually charged
        const sum = Number(b.Sum);
        const amountMinor = Number.isFinite(sum) ? Math.round(sum * 100) : null;

        // Cardcom's credit-card transaction ID (real charge)
        const txId = b.InternalDealNumber || b.UID || null;

        // Optional: parse LastBillDate (dd/MM/yyyy) if you prefer to use it
        const paidAt = new Date(); // or parse b.LastBillDate

        // Pull plan_days / email from the subscription we created earlier
        const { rows } = await pool.query(
          `SELECT id, user_email, plan_days,
                  COALESCE(access_until, now()) AS last_until
             FROM payments
            WHERE subscription_id = $1
            ORDER BY updated_at DESC
            LIMIT 1`,
          [recurringId]
        );
        if (!rows[0]) {
          console.warn("⚠️ No subscription row found for RecurringId:", recurringId);
          return res.status(200).send("OK");
        }

        const row = rows[0];
        const planDays = Number(row.plan_days || 30);

        // Start access from the later of now() or the previous access_until (stack periods)
        const startFrom = new Date(Math.max(Date.now(), new Date(row.last_until).getTime()));
        const until = new Date(startFrom.getTime());
        until.setDate(until.getDate() + planDays);
        const last4 =
        tInfo?.Last4CardDigitsString ||
          (tInfo?.Last4CardDigits ? String(tInfo.Last4CardDigits).padStart(4, "0") : null);
        const cardType = tInfo?.CardName || null;
        const combinedPayload = { lp: verifyData, rp: subResult };

        // Update the same row (or choose to insert a new “cycle” row if you prefer)
        await pool.query(
          `UPDATE payments
            SET subscription_id     = $1,
                card_token          = $2,
                cardcom_account_id  = COALESCE($3, cardcom_account_id),
                card_type           = COALESCE($4, card_type),
                card_last4          = COALESCE($5, card_last4),
                verify_payload      = $6,
                status              = 'subscribed',
                updated_at          = now()
          WHERE low_profile_id = $7`,
          [recurringId, cardToken, accountId, cardType, last4, JSON.stringify(combinedPayload), lowProfileId]
        );

        await logEvent({
          orderId: returnValue || null,
          lowProfileId: null,
          type: "recurring_debit_success",
          payload: { recurringId, txId, amountMinor }
        });

        return res.status(200).send("OK");
      }

      // Unknown record type → ack to prevent retries but log for analysis
      console.warn("ℹ️ Recurring webhook: unknown RecordType", recordType);
      return res.status(200).send("OK");

    } catch (err) {
      console.error("❌ /recurring-webhook error:", err);
      return res.status(200).send("ERROR");
    }
  }
);



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

async function cardcomFetchNVGet(url, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  const fullUrl = `${url}?${qs.toString()}`;

  const res = await fetch(fullUrl, { method: "GET" });
  const text = await res.text();

  // Parse "name=value&name2=value2" (or newline-separated)
  const out = {};
  text.split(/[&\r\n]+/).filter(Boolean).forEach(pair => {
    const i = pair.indexOf("=");
    if (i > -1) out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });

  // In case of HTML error page, return a hint
  if (!out.ResponseCode && text.startsWith("<!DOCTYPE")) {
    return { ResponseCode: "-1", Description: "HTML error page", raw: text };
  }
  return Object.keys(out).length ? out : { raw: text };
}

// helper: derive TimeIntervalId from plan_days with env overrides
function mapPlanDaysToTimeIntervalId(planDays) {
  const interval =
    planDays >= 365 ? "yearly" :
    planDays >= 90  ? "quarterly" :
                      "monthly";

  const cfg = {
    monthly:   Number(process.env.CARDCOM_TIME_ID_MONTHLY   || 1),
    quarterly: Number(process.env.CARDCOM_TIME_ID_QUARTERLY || 3),
    yearly:    Number(process.env.CARDCOM_TIME_ID_YEARLY    || 2),
  };
  return cfg[interval]; // no fallback needed now that you set .env
}

// helper: pick RecurringId from NV response (handles indexed keys)
function extractRecurringId(nv) {
  if (nv?.RecurringId) return nv.RecurringId;
  if (nv?.RecurringID) return nv.RecurringID;
  for (const [k, v] of Object.entries(nv || {})) {
    if (/^Recurring\d+\.RecurringId$/i.test(k)) return v;
  }
  return null;
}
export default router;

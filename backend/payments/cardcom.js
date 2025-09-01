// payments/cardcom.js
// 💡 Cardcom recurring billing implementation (2-step):
// Step 1: User pays one-time via LowProfile
// Step 2: On webhook → use token to call Subscription/CreateSubscription

import express from "express";
import fetch from "node-fetch";
import { pool } from "../db.js";
import crypto from "node:crypto";

const DEFAULT_PLAN_DAYS = 30; // adjust as needed

const router = express.Router();

// === Required envs ===
const TERMINAL = Number(process.env.CARDCOM_TERMINAL);
const TERMINAL_RECURRING = Number(process.env.CARDCOM_TERMINAL_RECURRING) || TERMINAL; // 👈 explicit recurring terminal
const API_NAME = process.env.CARDCOM_API_NAME;

// FRONTEND (browser redirects) and BACKEND (server webhook)
const APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:4200";
const API_URL = process.env.PUBLIC_API_URL || "https://nomo-backend.onrender.com";

// --- sanity checks ---
if (!Number.isFinite(TERMINAL)) console.error("[Cardcom] Missing/invalid CARDCOM_TERMINAL");
if (!API_NAME) console.error("[Cardcom] Missing CARDCOM_API_NAME");

// --- helpers ---
async function logEvent({ orderId, lowProfileId, type, payload }) {
  try {
    // Build a non-null reference for order_id
    const recurringId =
      payload?.RecurringId || payload?.recurringid || payload?.RecurringID || null;

    const orderRef =
      (orderId && String(orderId)) ||
      (payload?.ReturnValue && String(payload.ReturnValue)) ||
      (recurringId ? `recurring:${recurringId}` : 'n/a');   // 👈 NEVER NULL

    await pool.query(
      `INSERT INTO payment_events (order_id, low_profile_id, event_type, payload)
       VALUES ($1, $2, $3, $4)`,
      [orderRef, lowProfileId || null, type, payload ? JSON.stringify(payload) : null]
    );
  } catch (e) {
    console.error("⚠️ logEvent failed:", e.message);
    // swallow error so webhooks never fail because of logging
  }
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

// (kept for future use if needed)
function getPeriodFromPlanDays(planDays) {
  if (planDays >= 365) {
    return { PeriodTypeCode: 4, PeriodFrequency: 1 }; // שנה
  }
  if (planDays >= 90) {
    return { PeriodTypeCode: 3, PeriodFrequency: 3 }; // רבעון
  }
  return { PeriodTypeCode: 3, PeriodFrequency: 1 }; // ברירת מחדל: חודש
}

// format: dd/MM/yyyy HH/mm  (Cardcom sometimes shows times like 11/14)
function fmtDDMMYYYY_HH_mmSlash(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}/${pad(d.getMinutes())}`;
}
// Try to extract expiry from TranzactionInfo
// Robust expiry extractor with clear precedence and debug output
function getExpiryFromTInfo(ti = {}) {
  const dbg = {};
  const digits = v => v == null ? null : String(v).replace(/\D/g, "");

  // Prefer explicit month/year fields
  const monthKeys = [
    "CardValidityMonth", "CardExpMonth", "ExpiryMonth",
    "ValidityMonth", "CardExpDateMonth"
  ];
  const yearKeys = [
    "CardValidityYear", "CardExpYear", "ExpiryYear",
    "ValidityYear", "CardExpDateYear"
  ];

  let mm = null, yy = null, source = null;

  for (const k of monthKeys) {
    if (ti[k] != null) { dbg[k] = ti[k]; mm = digits(ti[k]); source = source || `pair:${k}`; break; }
  }
  for (const k of yearKeys) {
    if (ti[k] != null) { dbg[k] = ti[k]; yy = digits(ti[k]); source = source || `pair:${k}`; break; }
  }

  // Fall back to composite strings (NO generic scan!)
  if ((!mm || !yy)) {
    const compositeKeys = [
      "CardExpDate", "CardExpiry", "CardExp",
      "ExpirationDate", "ExpDate", "Expiry", "CardExpiration"
    ];
    for (const k of compositeKeys) {
      if (ti[k] != null) {
        const s = String(ti[k]).trim();
        dbg[k] = s;
        let m;
        // MM/YY or MM-YY
        m = /^(\d{2})[\/\-](\d{2})$/.exec(s);
        if (m) { mm = m[1]; yy = m[2]; source = `composite:${k}`; break; }
        // MM/YYYY
        m = /^(\d{2})[\/\-](\d{4})$/.exec(s);
        if (m) { mm = m[1]; yy = m[2].slice(-2); source = `composite:${k}`; break; }
        // MMYY
        m = /^(\d{2})(\d{2})$/.exec(s);
        if (m) { mm = m[1]; yy = m[2]; source = `composite:${k}`; break; }
        // MMYYYY
        m = /^(\d{2})(\d{4})$/.exec(s);
        if (m) { mm = m[1]; yy = m[2].slice(-2); source = `composite:${k}`; break; }
      }
    }
  }

  // Normalize to 2 digits
  if (mm != null) mm = String(mm).padStart(2, "0");
  if (yy != null) yy = String(yy).slice(-2);

  // Reject if month not 01..12
  if (!(mm && /^\d{2}$/.test(mm) && +mm >= 1 && +mm <= 12)) mm = null;
  if (!(yy && /^\d{2}$/.test(yy))) yy = null;

  // Reject if it equals card last4 (e.g., 1052 → 10/52)
  const last4 = digits(ti.Last4CardDigitsString ?? ti.Last4CardDigits ?? "");
  if (mm && yy && last4 && last4.length === 4 && (mm + yy) === last4) {
    dbg.rejectedBecauseMatchesLast4 = last4;
    mm = yy = null;
    source = "rejected:last4_match";
  }

  const mmyy = (mm && yy) ? `${mm}/${yy}` : null;
  return { mm, yy, mmyy, source, debug: dbg };
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
      amount,                 // price for the 1st charge & each cycle
      currency = 1,           // 1 = ILS
      planDays = DEFAULT_PLAN_DAYS
    } = req.body;

    const oid = String(orderId || "").trim();
    if (!oid) return res.status(400).json({ error: "Missing orderId" });

    if (!Number.isFinite(TERMINAL) || !API_NAME) {
      return res.status(500).json({ error: "Server misconfigured: Cardcom credentials" });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const SuccessRedirectUrl = normalizeUrl(successUrl, "/pay/success");
    const FailedRedirectUrl  = normalizeUrl(failUrl,  "/pay/failed");
    const WebHookUrl         = `${API_URL}/api/pay/webhook`;

    // 🔹 First payment now (Operation 1)
    const body = {
      TerminalNumber: TERMINAL,
      ApiName: API_NAME,
      Operation: 1,                 // charge now
      Amount: amt,
      ISOCoinId: Number(currency) || 1,
      ProductName: description,
      ReturnValue: oid,
      SuccessRedirectUrl,
      FailedRedirectUrl,
      WebHookUrl,
      Language: "EN"
    };

    console.log("🟠 First charge (LowProfile Operation=1):", body);

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/Create",
      body
    );

    console.log("🟠 Cardcom Create response:", data);

    if (data?.ResponseCode === 0 && data?.Url) {
      const amountMinor = Math.round(amt * 100);
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
      parsed = Object.fromEntries(new URLSearchParams(rawBody));
    }

    const lowProfileId =
      parsed?.LowProfileId || parsed?.lowprofileid || parsed?.lowProfileId || "";
    if (!lowProfileId) throw new Error("Missing LowProfileId in webhook");

    // 1) Verify result of the first payment
    const verifyData = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult",
      { TerminalNumber: TERMINAL, ApiName: API_NAME, LowProfileId: lowProfileId }
    );

    const orderId = verifyData?.ReturnValue ? String(verifyData.ReturnValue) : null;

    if (verifyData?.ResponseCode !== 0) {
      await markFailed({
        lowProfileId,
        orderId,
        reason: verifyData?.Description || `code:${verifyData?.ResponseCode}`,
        payload: verifyData,
      });
      console.warn("🟡 Webhook FAIL:", { lowProfileId, orderId, desc: verifyData?.Description });
      return res.status(200).send("FAIL");
    }

    // Extract payment details
    const tInfo = verifyData.TranzactionInfo || {};
    const txId = tInfo?.TranzactionId ? String(tInfo.TranzactionId) : null;

    const amount = Number(tInfo?.Amount);
    const amountMinor = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;

    const cardType = tInfo?.CardName || null;
    const last4 =
      tInfo?.Last4CardDigitsString ||
      (tInfo?.Last4CardDigits ? String(tInfo.Last4CardDigits).padStart(4, "0") : null);

    const cardToken = tInfo?.Token || null;
    const cardOwner = tInfo?.CardOwnerName || null;

    // Get plan/currency from DB
    const { rows: recRows } = await pool.query(
      `SELECT amount_minor, currency, user_email, plan_days, subscription_id
         FROM payments
        WHERE low_profile_id = $1
        LIMIT 1`,
      [lowProfileId]
    );
    const rec = recRows[0] || {};
    const coinId   = Number(rec.currency || 1);
    const planDays = Number(rec.plan_days || DEFAULT_PLAN_DAYS);
    const price    = amountMinor ?? Number(rec.amount_minor || 0);

    // 2) Mark the first payment as PAID & grant access
    const paidRow = await markPaid({
      lowProfileId,
      orderId,
      txId,
      amountMinor: price,
      cardType,
      last4,
      payload: verifyData,
      planDays,
    });
    console.log("✅ First charge marked as paid:", {
      user: paidRow?.user_email, access_from: paidRow?.access_from, access_until: paidRow?.access_until
    });

    // 3) Create recurring subscription (if not already created)
    if (!cardToken) {
      console.warn("⚠️ No CardToken on first charge; cannot create subscription.");
      await logEvent({ orderId, lowProfileId, type: "subscription_skip_no_token", payload: verifyData });
      return res.status(200).send("OK");
    }
    if (rec.subscription_id) {
      console.log("ℹ️ Subscription already exists, skipping creation:", rec.subscription_id);
      return res.status(200).send("OK");
    }

    // ---------- NEW: helpers for date parsing/formatting ----------
    const fmtDDMMYYYY_HHmm = (d) => {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      const HH = String(d.getHours()).padStart(2, "0");
      const MM = String(d.getMinutes()).padStart(2, "0");
      return `${dd}/${mm}/${yyyy} ${HH}:${MM}`; // <- COLON between hour and minute
    };
    const parseMaybeDealDate = (s) => {
      if (!s) return null;
      // dd/MM/yyyy HH:mm:ss
      let m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s);
      if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6]);
      // dd/MM/yyyy HH/mm (legacy)
      m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\/(\d{2})$/.exec(s);
      if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
      // dd/MM/yyyy
      m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      if (m) return new Date(+m[3], +m[2]-1, +m[1]);
      return null;
    };
    // --------------------------------------------------------------

    // NextDateToBill = paidAt + planDays (use Cardcom's deal time if available)
    const paidAt = parseMaybeDealDate(tInfo?.DealDate) || new Date();
    const next = new Date(paidAt);
    next.setDate(next.getDate() + planDays);

    // Map planDays → TimeIntervalId from your .env mapping
    const timeIntervalId = mapPlanDaysToTimeIntervalId(planDays);

    // Extract expiry from TranzactionInfo, then allow env override if needed
    console.log("tInfo", tInfo); // 'source/debug' may be undefined
    const parsedExp = getExpiryFromTInfo(tInfo);
    console.log("🔍 Expiry candidates from tInfo", parsedExp); // 'source/debug' may be undefined

    // Optional hard override (useful when Cardcom sends misleading fields)
    const forceMM = process.env.CARDCOM_FORCE_EXP_MM || null;   // e.g. "11"
    const forceYY = process.env.CARDCOM_FORCE_EXP_YY || null;   // e.g. "30"

    const mm = forceMM || parsedExp.mm;
    const yy = forceYY || parsedExp.yy;
    const mmyy = (mm && yy) ? `${mm}/${yy}` : null;

    console.log("🧾 Expiry to send (after override check)", { mm, yy, mmyy });

    // Build just the expiry fields when available
    const expiryFields = {
      ...(mm   ? { "CreditCard.ValidityMonth": mm } : {}),
      ...(yy   ? { "CreditCard.ValidityYear":  yy } : {}),
      ...(mmyy ? { "CreditCard.ChangeDateValidity": mmyy } : {}),
    };

    // Build NV params and create the recurring order
    const customerName = cardOwner || rec.user_email || "NOMO user";

    const params = {
       // prefer recurring terminal if set, otherwise fall back to the main one
      TerminalNumber: Number.isFinite(TERMINAL_RECURRING) ? TERMINAL_RECURRING : TERMINAL,
      UserName: API_NAME,
      codepage: 65001,
      Operation: "NewAndUpdate",
      // Source (same card as first charge):
      "CreditCard.Token": cardToken,
        // << הוספת התוקף >>
      // << add expiry >>
      ...expiryFields,
      // Account info
      "Account.CompanyName": customerName,
      "Account.Email": rec.user_email || "",
      // Recurring details
      "RecurringPayments.InternalDecription": "NOMO subscription",
      "RecurringPayments.NextDateToBill": fmtDDMMYYYY_HHmm(next),          // <-- colon format
      "RecurringPayments.TotalNumOfBills": 999999,
      "RecurringPayments.FinalDebitCoinId": coinId,
      "RecurringPayments.ReturnValue": orderId || "",
      "RecurringPayments.TimeIntervalId": timeIntervalId,
      // Price line
      "RecurringPayments.FlexItem.InvoiceDescription": "NOMO plan",
      "RecurringPayments.FlexItem.Price": (price / 100).toFixed(2),
      "RecurringPayments.FlexItem.IsPriceIncludeVat": "true",
    };
    console.log("📦 RecurringPayment NV params (expiry):", { mm, yy, mmyy, expiryFields });

    // (Optional) Only include explicit recurring terminal if provided
    if (process.env.CARDCOM_TERMINAL_RECURRING) {
      params["RecurringPayments.ChargeInTerminal"] =
        Number(process.env.CARDCOM_TERMINAL_RECURRING);
    }

    console.log("📦 RecurringPayment NV params:", params);

    const subResult = await cardcomFetchNVGet(
      "https://secure.cardcom.solutions/interface/RecurringPayment.aspx",
      params
    );

    console.log("📦 RecurringPayment NV response:", subResult);

    if (String(subResult?.ResponseCode) !== "0") {
      await logEvent({ orderId, lowProfileId, type: "subscription_fail", payload: subResult });
      // keep access for first paid cycle regardless
      return res.status(200).send("OK");
    }

    const recurringId = extractRecurringId(subResult);
    const accountId   = subResult?.AccountId || null;

    await pool.query(
      `UPDATE payments
          SET subscription_id    = COALESCE($1, subscription_id),
              card_token         = COALESCE($2, card_token),
              cardcom_account_id = COALESCE($3, cardcom_account_id),
              updated_at         = now()
        WHERE low_profile_id = $4`,
      [recurringId, cardToken, accountId, lowProfileId]
    );

    await logEvent({ orderId, lowProfileId, type: "subscription_created", payload: subResult });
    console.log("✅ Subscription created:", { recurringId, nextDateToBill: fmtDDMMYYYY_HHmm(next) });

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Cardcom /webhook error:", err);
    // Always ack 200 so Cardcom won't retry forever
    return res.status(200).send("OK");
  }
});


// פרסר לפוסטים מסוג form-urlencoded (רק כשבאמת POST)
const parseForm = express.urlencoded({ extended: true });

// Recurring status webhook (Cardcom → your server)
// In Cardcom Admin, point “דיווח למערכת חיצונית - הוראת קבע” to this URL.
// NOTE: require at top of file
// import crypto from "node:crypto";

router.all(
  "/recurring-webhook",
  (req, res, next) => {
    // If POST → parse application/x-www-form-urlencoded into req.body
    if (req.method === "POST") return parseForm(req, res, next);
    return next();
  },
  async (req, res) => {
    const recvAt = new Date();
    try {
      // For GETs use querystring; for POSTs use parsed body
      const b = req.method === "GET" ? req.query : (req.body || {});

      // -------- Secret check (timing safe, trimmed) --------
      const providedStr = String(b.Secret || b.secret || "").trim();
      const expectedStr = String(process.env.CARDCOM_RECURRING_WEBHOOK_SECRET || "").trim();

      const mask = s => (s ? `${s.slice(0,4)}…${s.slice(-4)} (len=${s.length})` : "EMPTY");
      console.log("🔎 Recurring secret check", {
        method: req.method,
        provided: mask(providedStr),
        expected: mask(expectedStr),
      });

      const provided = Buffer.from(providedStr, "utf8");
      const expected = Buffer.from(expectedStr, "utf8");

      if (!provided.length || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        console.warn("❌ Recurring webhook: BAD_SECRET", { ip: req.ip, method: req.method });
        return res.status(403).send("BAD_SECRET");
      }

      // -------- Envelope --------
      const recordType  = String(b.RecordType || b.recordtype || b.recordType || "").toUpperCase();
      const status      = String(b.Status || b.status || "").toUpperCase();
      const recurringId = b.RecurringId || b.recurringid || null;
      const returnValue = b.ReturnValue || b.returnvalue || null; // your orderId if you sent it

      // Cardcom sends different keys for the same value. Normalize the tx id:
      const txIdInPayload =
        b.InternalDealNumber || b.UID || b.Deal || b.DealNumber || b.UniqueId || null;

      // Scrub secret before logging to DB
      const payloadForLog = { ...b };
      if (payloadForLog.Secret) payloadForLog.Secret = "***";

      console.log("📨 Cardcom recurring webhook", {
        ts: recvAt.toISOString(),
        method: req.method,
        ip: req.ip,
        ua: req.get("user-agent"),
        recordType,
        status,
        recurringId,
        orderId: returnValue,
        sum: b.Sum,
        lastBillDate: b.LastBillDate,
        txId: txIdInPayload,
      });

      if (!recurringId) {
        console.warn("⚠️ Recurring webhook without RecurringId");
        await logEvent({
          orderId: returnValue || null,
          lowProfileId: null,
          type: "recurring_missing_id",
          payload: payloadForLog
        });
        return res.status(200).send("OK");
      }

      // Persist raw event for audit
      await logEvent({
        orderId: returnValue || null,
        lowProfileId: null,
        type: `recurring_${String(recordType || "UNKNOWN").toLowerCase()}`,
        payload: payloadForLog,
      });

      // ===================== MASTER =====================
      if (recordType === "MASTERRECURRING") {
        // If master got canceled – revoke access immediately
        if (status === "CANCELED" || status === "CANCELLED") {
          await pool.query(
            `UPDATE payments
               SET status='failed',
                   verify_payload=$1,
                   access_until=LEAST(COALESCE(access_until, now()), now()),
                   updated_at=now()
             WHERE subscription_id=$2`,
            [JSON.stringify(payloadForLog), recurringId]
          );
          await logEvent({
            orderId: returnValue || null,
            lowProfileId: null,
            type: "recurring_master_canceled",
            payload: { recurringId },
          });
          console.warn("🔒 Access revoked due to master cancel", { recurringId });
        }
        return res.status(200).send("OK");
      }

      // ===================== DETAIL (charge attempt) =====================
      if (recordType === "DETAILRECURRING") {
        // Per Cardcom: DEBTAUTOBILLING = a failed attempt now queued in arrears.
        const PENDING_STATUSES = new Set(["PENDINGFORPROCESSING", "PENDING"]);
        const HARD_FAIL = new Set([
          "FAILED","CANCELED","CANCELLED","CHARGEBACK","DECLINED","ERROR","LOSTDEBT",
          "DEBTAUTOBILLING" // 👈 treat as hard failure (support's guidance)
        ]);

        // 1) "Pending" → just log. Keep whatever status you had (e.g. 'subscribed').
        if (PENDING_STATUSES.has(status)) {
          console.log("⏳ Recurring debit pending", {
            recurringId, orderId: returnValue, status, sum: b.Sum, lastBillDate: b.LastBillDate
          });
          await logEvent({
            orderId: returnValue || null,
            lowProfileId: null,
            type: "recurring_debit_pending",
            payload: payloadForLog
          });
          return res.status(200).send("OK");
        }

        // 2) Non-success path
        if (status !== "SUCCESSFUL") {
          if (!HARD_FAIL.has(status)) {
            // Non-success but not hard → log & wait (do not revoke)
            await logEvent({
              orderId: returnValue || null,
              lowProfileId: null,
              type: "recurring_debit_non_success_pending",
              payload: payloadForLog
            });
            return res.status(200).send("OK");
          }

          // Hard fail → revoke immediately (or after small grace)
          const graceMin = Number(process.env.CARDCOM_FAIL_GRACE_MINUTES || 0);
          const cutoff = new Date(Date.now() + (Number.isFinite(graceMin) && graceMin > 0 ? graceMin * 60 * 1000 : 0));

          const { rowCount } = await pool.query(
            `UPDATE payments
                SET status='failed',
                    verify_payload=$1,
                    access_until=LEAST(COALESCE(access_until, now()), $2),
                    updated_at=now()
              WHERE subscription_id=$3`,
            [JSON.stringify(payloadForLog), cutoff.toISOString(), recurringId]
          );

          console.warn("🚫 Recurring debit HARD-FAIL", { recurringId, status, rowCount });
          await logEvent({
            orderId: returnValue || null,
            lowProfileId: null,
            type: "recurring_debit_hard_fail",
            payload: { recurringId, status, rowCount }
          });
          return res.status(200).send("OK");
        }

        // 3) SUCCESSFUL → mark paid & extend access idempotently
        const sum = Number(String(b.Sum ?? "").replace(",", "."));
        const amountMinor = Number.isFinite(sum) ? Math.round(sum * 100) : null;
        const txId = txIdInPayload;

        // Parse 'dd/MM/yyyy', 'dd/MM/yyyy HH:mm' or 'dd/MM/yyyy HH:mm:ss'
        function parseCardcomDate(s) {
          if (!s) return null;
          let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
          if (m) return new Date(+m[3], +m[2]-1, +m[1]);
          m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})[:/](\d{2})$/.exec(s);      // 31/08/2025 05/12
          if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
          m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s); // 31/08/2025 05:12:30
          if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6]);
          return null;
        }
        const paidAt = parseCardcomDate(b.LastBillDate) || new Date();

        // Get current window (to stack periods neatly)
        const { rows } = await pool.query(
          `SELECT id, user_email, plan_days, access_from, access_until
             FROM payments
            WHERE subscription_id = $1
            ORDER BY updated_at DESC
            LIMIT 1`,
          [recurringId]
        );
        if (!rows[0]) {
          console.warn("⚠️ SUCCESSFUL debit but no payment row found", { recurringId });
          return res.status(200).send("OK");
        }

        const row = rows[0];
        const planDays = Number(row.plan_days || 30);

        // Start next window after the later of now() or current access_until
        const startFrom = new Date(Math.max(Date.now(), new Date(row.access_until || Date.now()).getTime()));
        const until = new Date(startFrom.getTime());
        until.setDate(until.getDate() + planDays);

        console.log("💳 Debit SUCCESS received", {
          recurringId,
          orderId: returnValue,
          sum,
          amountMinor,
          txId,
          paidAt: paidAt.toISOString(),
          window_before: { from: row.access_from, until: row.access_until },
          window_after:  { from: startFrom.toISOString(), until: until.toISOString() }
        });

        // Idempotent update: skip if same txId already applied
        const { rowCount } = await pool.query(
          `UPDATE payments
              SET amount_minor   = COALESCE($1, amount_minor),
                  verify_payload = $2,
                  paid_at        = $3,
                  transaction_id = $4,
                  access_from    = $5,
                  access_until   = $6,
                  status         = 'paid',
                  updated_at     = now()
            WHERE subscription_id = $7
              AND (transaction_id IS DISTINCT FROM $4)`,
          [
            amountMinor,
            JSON.stringify(payloadForLog),
            paidAt.toISOString(),
            txId,
            startFrom.toISOString(),
            until.toISOString(),
            recurringId,
          ]
        );

        if (rowCount === 0) {
          console.log("↩️ Duplicate debit ignored (idempotent)", { recurringId, txId });
          await logEvent({
            orderId: returnValue || null,
            lowProfileId: null,
            type: "recurring_debit_duplicate",
            payload: { recurringId, txId },
          });
        } else {
          console.log("✅ DB updated for successful debit", {
            recurringId, txId, new_until: until.toISOString()
          });
          await logEvent({
            orderId: returnValue || null,
            lowProfileId: null,
            type: "recurring_debit_success",
            payload: { recurringId, txId, amountMinor },
          });
        }

        return res.status(200).send("OK");
      }

      // Unknown type → ack to avoid Cardcom retries
      console.warn("ℹ️ Recurring webhook: unknown RecordType", { recordType, recurringId });
      return res.status(200).send("OK");
    } catch (err) {
      console.error("❌ /recurring-webhook error:", err);
      // Always 200 to avoid infinite retries from Cardcom
      return res.status(200).send("OK");
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
  // Prefer explicit daily when planDays <= 1
  if (planDays <= 1) {
    const daily = Number(process.env.CARDCOM_TIME_ID_DAILY || 0);
    if (!daily) throw new Error("Missing CARDCOM_TIME_ID_DAILY in env");
    return daily;
  }
  if (planDays >= 365) return Number(process.env.CARDCOM_TIME_ID_YEARLY    || 2);
  if (planDays >= 90)  return Number(process.env.CARDCOM_TIME_ID_QUARTERLY || 3);
  return Number(process.env.CARDCOM_TIME_ID_MONTHLY || 1);
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

// payments/cardcom.js
// 💡 Cardcom recurring billing implementation (2-step):
// Step 1: User pays one-time via LowProfile
// Step 2: On webhook → use token to call Subscription/CreateSubscription
// Plus: Token charge/refund endpoint with optional invoice creation (NV).
// NEW: Persist issueInvoice from /start → use in DD creation (RecurringPayment.aspx).

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
const API_URL = process.env.PUBLIC_API_URL || "https://nomo-cj4l.onrender.com";

// Defaults for invoice/doc creation
const DOC_TYPE_DEFAULT = Number(process.env.CARDCOM_DOC_TYPE_DEFAULT || 1); // 1 = InvoiceReceipt
const ISSUE_INVOICE_DEFAULT = /^true$/i.test(String(process.env.CARDCOM_ISSUE_INVOICE_DEFAULT || ""));

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

// Cache for information_schema checks so we can support optional columns
const _colCache = new Map();
async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (_colCache.has(key)) return _colCache.get(key);
  const q = `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`;
  try {
    const { rowCount } = await pool.query(q, [table, column]);
    const ok = !!rowCount;
    _colCache.set(key, ok);
    return ok;
  } catch (e) {
    console.warn("info_schema check failed, assuming no column", { table, column, err: e.message });
    _colCache.set(key, false);
    return false;
  }
}

async function saveStart({ orderId, lowProfileId, userEmail, amountMinor, currency, planDays, issueInvoice, invoice }) {
  // Dynamically include optional columns if they exist
  const hasIssue = await hasColumn("payments", "issue_invoice");
  const hasInvoiceJson = await hasColumn("payments", "invoice_json");

  const cols = ["order_id", "low_profile_id", "user_email", "amount_minor", "currency", "status", "plan_days"];
  const vals = ["$1", "$2", "$3", "$4", "$5", "'pending'", "$6"];
  const updates = [
    "low_profile_id = EXCLUDED.low_profile_id",
    "user_email     = COALESCE(EXCLUDED.user_email, payments.user_email)",
    "amount_minor   = EXCLUDED.amount_minor",
    "currency       = EXCLUDED.currency",
    "plan_days      = COALESCE(EXCLUDED.plan_days, payments.plan_days)",
    "updated_at     = now()",
  ];

  let args = [orderId, lowProfileId, userEmail || null, amountMinor, currency, planDays || DEFAULT_PLAN_DAYS];
  let argi = args.length;

  if (hasIssue) {
    cols.push("issue_invoice");
    vals.push(`$${++argi}`);
    updates.push("issue_invoice = COALESCE(EXCLUDED.issue_invoice, payments.issue_invoice)");
    args.push(issueInvoice === true || issueInvoice === "true" ? true : false);
  }
  if (hasInvoiceJson) {
    cols.push("invoice_json");
    vals.push(`$${++argi}`);
    updates.push("invoice_json = COALESCE(EXCLUDED.invoice_json, payments.invoice_json)");
    args.push(invoice ? JSON.stringify(invoice) : null);
  }

  const sql = `
    INSERT INTO payments (${cols.join(", ")})
    VALUES (${vals.join(", ")})
    ON CONFLICT (order_id) DO UPDATE SET
      ${updates.join(", ")}
  `;

  await pool.query(sql, args);

  // Log a meta event so we still persist preferences even if DB doesn't have columns
  await logEvent({
    orderId,
    lowProfileId,
    type: 'start_meta',
    payload: { issueInvoice: !!issueInvoice, invoice: invoice || null }
  });

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
           fail_reason=$1,
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

// format: dd/MM/yyyy (for Recurring NextDateToBill)
function fmtDDMMYYYY(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
// format: dd/MM/yyyy HH/mm  (legacy helper kept where relevant)
function fmtDDMMYYYY_HH_mmSlash(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}/${pad(d.getMinutes())}`;
}
// Try to extract expiry from TranzactionInfo
// Robust expiry extractor with clear precedence and debug output
function getExpiryFromTInfo(ti = {}) {
  // Cardcom typically returns CardMonth (MM) and CardYear (YY)
  let mm = ti.CardMonth ?? ti.CardValidityMonth ?? ti.CardExpMonth ?? ti.ExpiryMonth ?? ti.ValidityMonth ?? ti.CardExpDateMonth ?? null;
  let yy = ti.CardYear  ?? ti.CardValidityYear  ?? ti.CardExpYear  ?? ti.ExpiryYear  ?? ti.ValidityYear  ?? ti.CardExpDateYear  ?? null;

  // Also accept a single field (MMYY / MM/YY / MMYYYY / MM/YYYY)
  const one = ti.CardExpDate || ti.CardExpiry || ti.CardExp || null;
  if ((!mm || !yy) && one) {
    const s = String(one).replace(/\s+/g, "");
    let m = /^(\d{2})[\/\-]?(\d{2})$/.exec(s);      // MMYY or MM/YY
    if (m) { mm = m[1]; yy = m[2]; }
    m = m || /^(\d{2})[\/\-]?(\d{4})$/.exec(s);     // MMYYYY or MM/YYYY
    if (m && !yy) { mm = m[1]; yy = m[2]; }
  }

  // Normalize: MM two digits (01..12), YY last two digits
  if (mm != null) mm = String(mm).padStart(2, "0");
  if (yy != null) yy = String(yy).slice(-2);

  // Guard month range
  if (mm && (+mm < 1 || +mm > 12)) mm = null;

  const mmyy = (mm && yy) ? `${mm}/${yy}` : null;
  return { mm, yy, mmyy, source: "tInfo" };
}

// ===== NV helpers (GET/POST) =====
// put near your other helpers
async function getLowProfileResult({ terminal, apiName, lowProfileId }) {
  const url = "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult";
  const params = {
    TerminalNumber: Number(terminal),
    ApiName: apiName,
    LowProfileId: String(lowProfileId),
  };

  // 1) Try GET (as in docs)
  try {
    return await cardcomFetchJsonGET(url, params);
  } catch (e) {
    const msg = (e && String(e.message || e)) || "";
    if (!/does not support http method/i.test(msg)) {
      console.warn("ℹ️ GET GetLpResult failed, will try POST JSON:", msg);
    }
  }

  // 2) Try POST JSON
  try {
    return await cardcomFetch(url, params); // your existing JSON POST helper
  } catch (e2) {
    console.warn("ℹ️ POST(JSON) GetLpResult failed, will try POST NV:", e2?.message || e2);
  }

  // 3) Try POST NV (x-www-form-urlencoded) — parse NV into an object
  const nv = await cardcomFetchNVPost(url, params);
  // ensure ResponseCode is numeric where possible
  if (nv && typeof nv.ResponseCode === "string" && /^\d+$/.test(nv.ResponseCode)) {
    nv.ResponseCode = Number(nv.ResponseCode);
  }
  return nv;
}
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

async function cardcomFetchNVPost(url, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") body.append(k, String(v));
  }
  // codepage is required for Hebrew / Unicode in NV
  if (!body.has("codepage")) body.append("codepage", "65001");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();

  // Parse "name=value&name2=value2" (or newline-separated) into object
  const out = {};
  text.split(/[&\r\n]+/).filter(Boolean).forEach(pair => {
    const i = pair.indexOf("=");
    if (i > -1) out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });

  if (!Object.keys(out).length) return { raw: text };
  return out;
}

// ===== LowProfile: Create payment page + first charge + token =====
/**
 * POST /api/pay/start
 * Body: {
 *   amount:number, orderId:string, description?:string, currency?:number,
 *   userEmail?:string, planDays?:number,
 *   successUrl?:string, failUrl?:string,
 *   issueInvoice?: boolean,           // NEW: persist user's invoice preference
 *   invoice?: object                  // NEW: optional invoice head/line overrides
 * }
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
      amount,                 // First charge sum
      currency = 1,           // 1 = ILS
      planDays = DEFAULT_PLAN_DAYS,
      issueInvoice = ISSUE_INVOICE_DEFAULT,
      invoice = null
    } = req.body || {};

    const oid = String(orderId || "").trim();
    if (!oid) return res.status(400).json({ error: "Missing orderId" });

    if (!Number.isFinite(TERMINAL) || !API_NAME) {
      return res.status(500).json({ error: "Server misconfigured: Cardcom credentials" });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // require external https URLs (no localhost)
    function requireExternalHttps(u, fieldName) {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:") {
        throw new Error(`${fieldName} must be https URL`);
      }
      const host = parsed.hostname || "";
      if (host === "localhost" || host.endsWith(".local")) {
        throw new Error(`${fieldName} must be public (no localhost)`);
      }
      return parsed.toString();
    }

    const SuccessRedirectUrl = requireExternalHttps(
      normalizeUrl(successUrl, "/pay/success"),
      "SuccessRedirectUrl"
    );
    const FailedRedirectUrl  = requireExternalHttps(
      normalizeUrl(failUrl,  "/pay/failed"),
      "FailedRedirectUrl"
    );
    const WebHookUrl         = requireExternalHttps(
      `${API_URL}/api/pay/webhook`,
      "WebHookUrl"
    );

    // JSON v11: string Operation. For subscription flow we use charge + token
    const body = {
      TerminalNumber: Number(TERMINAL),
      ApiName: API_NAME,
      Operation: "ChargeAndCreateToken",   // 🔴 new
      ReturnValue: oid,
      Amount: amt,
      ISOCoinId: Number(currency) || 1,
      ProductName: description,
      SuccessRedirectUrl,
      FailedRedirectUrl,
      WebHookUrl,
      Language: "en",
      // (optional) prefill/validation on hosted page
      UIDefinition: userEmail ? {
        CardOwnerEmailValue: userEmail,
        IsCardOwnerEmailRequired: true
      } : undefined
    };

    console.log("🟠 First charge (LowProfile Create):", body);

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
        userEmail: userEmail || null,
        amountMinor,
        currency: Number(currency) || 1,
        planDays,
        issueInvoice: !!issueInvoice,
        invoice: invoice || null
      });

      return res.json({ url: data.Url, lowProfileId: data.LowProfileId });
    }

    await logEvent({ orderId: oid, lowProfileId: null, type: "start_fail", payload: data });
    return res.status(400).json({ error: data?.Description || "Cardcom error", raw: data });
  } catch (err) {
    console.error("❌ Cardcom /start error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// helper: GET JSON (Cardcom sometimes allows GET for LowProfile/GetLpResult)
async function cardcomFetchJsonGET(url, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  const full = `${url}?${qs.toString()}`;
  const res  = await fetch(full, { method: "GET" });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("🔴 Cardcom GET JSON parse fail:", text);
    throw new Error("Invalid JSON from Cardcom");
  }
}

// ===== /webhook  (LowProfile result) =====
// ===== /webhook  (LowProfile result) =====
// ===== /webhook (LowProfile result) =====
router.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  try {
    const rawBody = req.body;

    // Parse Cardcom webhook payload: JSON or x-www-form-urlencoded
    let parsed;
    try {
      parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    } catch {
      parsed = Object.fromEntries(new URLSearchParams(rawBody));
    }

    const lowProfileId =
      parsed?.LowProfileId || parsed?.lowprofileid || parsed?.lowProfileId || "";
    if (!lowProfileId) throw new Error("Missing LowProfileId in webhook");

    // ---------- Verify LowProfile result with robust fallback ----------
    const verifyUrl = "https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult";
    const verifyParams = {
      TerminalNumber: Number(TERMINAL),
      ApiName: API_NAME,
      ...(API_PASSWORD ? { ApiPassword: API_PASSWORD } : {}),
      LowProfileId: String(lowProfileId),
    };

    let verifyData = null;
    let lastErrMsg = "";

    // 1) Try GET (per docs)
    try {
      verifyData = await cardcomFetchJsonGET(verifyUrl, verifyParams);
      console.log("🔎 GetLpResult via GET OK");
    } catch (e) {
      lastErrMsg = e?.message || String(e);
      console.warn("🔎 GetLpResult via GET failed:", lastErrMsg);
    }

    // 2) Try POST(JSON)
    if (!verifyData) {
      try {
        verifyData = await cardcomFetch(verifyUrl, verifyParams);
        console.log("🔎 GetLpResult via POST(JSON) OK");
      } catch (e2) {
        lastErrMsg = e2?.message || String(e2);
        console.warn("🔎 GetLpResult via POST(JSON) failed:", lastErrMsg);
      }
    }

    // 3) Try POST(NV)
    if (!verifyData) {
      try {
        const nv = await cardcomFetchNVPost(verifyUrl, verifyParams);
        if (nv && typeof nv.ResponseCode === "string" && /^\d+$/.test(nv.ResponseCode)) {
          nv.ResponseCode = Number(nv.ResponseCode);
        }
        verifyData = nv;
        console.log("🔎 GetLpResult via POST(NV) OK");
      } catch (e3) {
        lastErrMsg = e3?.message || String(e3);
        console.warn("🔎 GetLpResult via POST(NV) failed:", lastErrMsg);
      }
    }

    console.log("🟢 Verify response", {
      LowProfileId: lowProfileId,
      ResponseCode: verifyData?.ResponseCode,
      Description: verifyData?.Description || verifyData?.ResponseDescription,
      ReturnValue: verifyData?.ReturnValue,
    });

    // ---------- Ensure we have orderId (ReturnValue) ----------
    let orderId = verifyData?.ReturnValue ? String(verifyData.ReturnValue) : null;
    if (!orderId) {
      try {
        const { rows } = await pool.query(
          "SELECT order_id FROM payments WHERE low_profile_id = $1 LIMIT 1",
          [lowProfileId]
        );
        orderId = rows?.[0]?.order_id || null;
      } catch {}
    }

    // If verify didn't return anything useful, mark failure with a clear reason
    if (!verifyData || typeof verifyData.ResponseCode === "undefined") {
      await markFailed({
        lowProfileId,
        orderId,
        reason: lastErrMsg || "GetLpResult failed (no ResponseCode)",
        payload: verifyData || { message: lastErrMsg },
      });
      console.warn("🟡 Webhook FAIL (no verify data):", { lowProfileId, orderId, desc: lastErrMsg });
      return res.status(200).send("FAIL");
    }

    if (verifyData.ResponseCode !== 0) {
      const reason =
        verifyData?.Description ||
        verifyData?.ResponseDescription ||
        verifyData?.Reason ||
        `code:${verifyData?.ResponseCode}`;
      await markFailed({ lowProfileId, orderId, reason, payload: verifyData });
      console.warn("🟡 Webhook FAIL:", { lowProfileId, orderId, desc: reason });
      return res.status(200).send("FAIL");
    }

    // ---------- Success path ----------
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

    // Read plan/currency + invoice prefs from DB if present
    const hasIssue = await hasColumn("payments", "issue_invoice");
    const hasInvoiceJson = await hasColumn("payments", "invoice_json");

    let selectSql = `SELECT amount_minor, currency, user_email, plan_days, subscription_id`;
    if (hasIssue) selectSql += `, issue_invoice`;
    if (hasInvoiceJson) selectSql += `, invoice_json`;
    selectSql += ` FROM payments WHERE low_profile_id = $1 LIMIT 1`;

    const { rows: recRows } = await pool.query(selectSql, [lowProfileId]);
    const rec = recRows[0] || {};
    const coinId   = Number(rec.currency || 1);
    const planDays = Number(rec.plan_days || DEFAULT_PLAN_DAYS);
    const price    = amountMinor ?? Number(rec.amount_minor || 0);

    // Load /start metadata if columns were absent
    let issueInvoice = hasIssue ? !!rec.issue_invoice : undefined;
    let invoiceMeta  = hasInvoiceJson ? (rec.invoice_json || null) : null;
    if (issueInvoice === undefined) {
      const { rows: ev } = await pool.query(
        `SELECT payload FROM payment_events
         WHERE low_profile_id = $1 AND event_type = 'start_meta'
         ORDER BY id DESC LIMIT 1`,
        [lowProfileId]
      );
      if (ev[0]?.payload) {
        try {
          const meta = typeof ev[0].payload === "string" ? JSON.parse(ev[0].payload) : ev[0].payload;
          issueInvoice = !!meta.issueInvoice;
          invoiceMeta  = meta.invoice || null;
        } catch {}
      }
    }
    if (issueInvoice === undefined) issueInvoice = ISSUE_INVOICE_DEFAULT;

    // 2) Mark first payment as PAID & grant access
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
      user: paidRow?.user_email,
      access_from: paidRow?.access_from,
      access_until: paidRow?.access_until
    });

    // 3) Create recurring subscription (if token exists and not yet created)
    if (!cardToken) {
      console.warn("⚠️ No CardToken on first charge; cannot create subscription.");
      await logEvent({ orderId, lowProfileId, type: "subscription_skip_no_token", payload: verifyData });
      return res.status(200).send("OK");
    }
    if (rec.subscription_id) {
      console.log("ℹ️ Subscription already exists, skipping creation:", rec.subscription_id);
      return res.status(200).send("OK");
    }

    // helpers
    const fmtDDMMYYYY = (d) => {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };
    const parseMaybeDealDate = (s) => {
      if (!s) return null;
      let m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s);
      if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6]);
      m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\/(\d{2})$/.exec(s);
      if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]);
      m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      if (m) return new Date(+m[3], +m[2]-1, +m[1]);
      return null;
    };

    const timeIntervalId = mapPlanDaysToTimeIntervalId(planDays);
    const paidAt = parseMaybeDealDate(tInfo?.DealDate) || new Date();
    const next   = new Date(paidAt); next.setDate(next.getDate() + planDays);

    const parsedExp = getExpiryFromTInfo(tInfo);
    const forceMM   = process.env.CARDCOM_FORCE_EXP_MM || null;
    const forceYY   = process.env.CARDCOM_FORCE_EXP_YY || null;
    const mm        = forceMM || parsedExp.mm || null;
    const yy        = forceYY || parsedExp.yy || null;

    const expiryFieldsNV = {
      ...(mm ? { "CardValidityMonth": mm } : {}),
      ...(yy ? { "CardValidityYear":  yy } : {}),
    };

    const customerName = cardOwner || rec.user_email || "NOMO user";
    const params = {
      TerminalNumber: Number.isFinite(TERMINAL_RECURRING) ? TERMINAL_RECURRING : TERMINAL,
      UserName: API_NAME,
      codepage: 65001,
      Operation: "NewAndUpdate",

      "CreditCard.Token": cardToken,
      ...expiryFieldsNV,

      "Account.CompanyName": customerName,
      "Account.Email": rec.user_email || "",

      "RecurringPayments.InternalDecription": "NOMO subscription",
      "RecurringPayments.NextDateToBill": fmtDDMMYYYY(next),
      "RecurringPayments.TotalNumOfBills": 999999,
      "RecurringPayments.FinalDebitCoinId": coinId,
      "RecurringPayments.ReturnValue": orderId || "",
      "RecurringPayments.TimeIntervalId": timeIntervalId,

      "RecurringPayments.FlexItem.InvoiceDescription": "NOMO plan",
      "RecurringPayments.FlexItem.Price": (price / 100).toFixed(2),
      "RecurringPayments.FlexItem.IsPriceIncludeVat": "true",
    };

    if (issueInvoice) {
      params["RecurringPayments.DocTypeToCreate"] = DOC_TYPE_DEFAULT; // 1 = InvoiceReceipt
    }
    if (process.env.CARDCOM_TERMINAL_RECURRING) {
      params["RecurringPayments.ChargeInTerminal"] = Number(process.env.CARDCOM_TERMINAL_RECURRING);
    }

    const subResult = await cardcomFetchNVPost(
      "https://secure.cardcom.solutions/interface/RecurringPayment.aspx",
      params
    );

    if (String(subResult?.ResponseCode) !== "0") {
      await logEvent({ orderId, lowProfileId, type: "subscription_fail", payload: subResult });
      return res.status(200).send("OK"); // first payment remains granted
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
    console.log("✅ Subscription created:", { recurringId, nextDateToBill: fmtDDMMYYYY(next), issueInvoice });

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Cardcom /webhook error:", err);
    return res.status(200).send("OK"); // always ACK
  }
});



// ===== Recurring status webhook (Cardcom → your server) =====
// פרסר לפוסטים מסוג form-urlencoded (רק כשבאמת POST)
const parseForm = express.urlencoded({ extended: true });

// In Cardcom Admin, point “דיווח למערכת חיצונית - הוראת קבע” to this URL.
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
      // Always 200 to avoid infinite retries
      return res.status(200).send("OK");
    }
  }
);

// ===== Manual status check =====
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

// ===== Helpers: map plan days → TimeIntervalId; extract RecurringId =====
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

function extractRecurringId(nv) {
  if (nv?.RecurringId) return nv.RecurringId;
  if (nv?.RecurringID) return nv.RecurringID;
  for (const [k, v] of Object.entries(nv || {})) {
    if (/^Recurring\d+\.RecurringId$/i.test(k)) return v;
  }
  return null;
}

// ===== Invoice builder (NV) + Token charge/refund endpoint =====
/**
 * Build Name-to-Value invoice params according to Cardcom docs:
 * "יצירת מסמך ... לעסקת פ.נמוך ראשונית או חיוב אסימון"
 * We always create a single line matching the charged amount.
 * Docs: InvoiceHead.* and InvoiceLines N.*
 */
function buildInvoiceNV({
  issueInvoice,
  amount,
  currency,
  description,
  orderId,
  customerName,
  userEmail,
  invoice = {},
}) {
  if (!issueInvoice) return {};

  const price = Number(amount || 0);
  const priceStr = Number.isFinite(price) ? price.toFixed(2) : undefined;

  const custName = invoice.custName || customerName || userEmail || "Customer";
  const sendByEmail = invoice.sendByEmail !== undefined ? !!invoice.sendByEmail : !!userEmail;
  const email = invoice.email || userEmail || "";

  const head = {
    "InvoiceHead.CustName": custName,
    ...(sendByEmail ? { "InvoiceHead.SendByEmail": "true" } : {}),
    ...(email ? { "InvoiceHead.Email": email } : {}),
    "InvoiceHead.Language": invoice.language || "he",
    ...(invoice.addressLine1 ? { "InvoiceHead.CustAddresLine1": invoice.addressLine1 } : {}),
    ...(invoice.addressLine2 ? { "InvoiceHead.CustAddresLine2": invoice.addressLine2 } : {}),
    ...(invoice.city ? { "InvoiceHead.CustCity": invoice.city } : {}),
    ...(invoice.phone ? { "InvoiceHead.CustLinePH": invoice.phone } : {}),
    ...(invoice.mobile ? { "InvoiceHead.CustMobilePH": invoice.mobile } : {}),
    ...(invoice.compId ? { "InvoiceHead.CompID": invoice.compId } : {}),
    ...(invoice.departmentId ? { "InvoiceHead.DepartmentId": String(invoice.departmentId) } : {}),
    ...(orderId ? { "InvoiceHead.ExternalId": String(orderId) } : {}),
    ...(invoice.isVatFree ? { "InvoiceHead.ExtIsVatFree": "true" } : {}),
  };

  const lineDesc = invoice.lineDescription || description || "Token charge";
  const lines = {
    "InvoiceLines 1.Description": lineDesc,
    ...(priceStr !== undefined ? { "InvoiceLines 1.Price": priceStr } : {}),
    "InvoiceLines 1.Quantity": "1",
    ...(invoice.lineIsVatFree ? { "InvoiceLines 1.IsVatFree": "true" } : {}),
    ...(invoice.productId ? { "InvoiceLines 1.ProductID": invoice.productId } : {}),
  };

  return { ...head, ...lines };
}

/**
 * POST /api/pay/token-charge
 * Body:
 * {
 *   token: string,                 // required - Cardcom token to charge
 *   amount: number,                // required - amount in major currency (e.g. 49.90)
 *   currency?: number,             // CoinID (1=ILS, 2=USD, 978=EUR). default 1
 *   orderId?: string,              // your id - will be sent as UniqAsmachta and in invoice ExternalId
 *   description?: string,          // for invoice line
 *   isRefund?: boolean,            // if true -> RefundInsteadOfCharge
 *   userEmail?: string,            // used both for invoice & log
 *   customerName?: string,         // invoice CustName fallback
 *   issueInvoice?: boolean,        // if true -> auto add DocTypeToCreate + InvoiceHead / InvoiceLines params
 *   invoice?: {                    // optional overrides for invoice head/line (all optional)
 *     custName?: string,
 *     sendByEmail?: boolean,
 *     email?: string,
 *     language?: 'he'|'en',
 *     addressLine1?: string,
 *     addressLine2?: string,
 *     city?: string,
 *     phone?: string,
 *     mobile?: string,
 *     compId?: string,             // ת.ז./ח.פ
 *     departmentId?: number,
 *     isVatFree?: boolean,         // whole document
 *     lineDescription?: string,
 *     lineIsVatFree?: boolean,     // this single line only
 *     productId?: string
 *   }
 * }
 * Returns: Cardcom NV response (parsed) incl. DealResponse_*, maybe InvoiceResponse_*
 * Docs: ChargeToken.aspx (NV) + invoice params (InvoiceHead.*, InvoiceLines N.*)
 */
router.post("/token-charge", express.json(), async (req, res) => {
  try {
    const {
      token,
      amount,
      currency = 1,
      orderId,
      description = "Token charge",
      isRefund = false,
      userEmail,
      customerName,
      issueInvoice = ISSUE_INVOICE_DEFAULT,
      invoice = {}
    } = req.body || {};

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token is required" });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const coinId = Number(currency) || 1;

    // Build base NV for ChargeToken.aspx
    const params = {
      TerminalNumber: Number.isFinite(TERMINAL_RECURRING) ? TERMINAL_RECURRING : Number(TERMINAL),
      UserName: API_NAME,
      codepage: 65001,
      "TokenToCharge.Token": token,
      "TokenToCharge.SumToBill": amt.toFixed(2),
      "TokenToCharge.CoinID": coinId,
      "TokenToCharge.RefundInsteadOfCharge": isRefund ? "true" : "false",
      ...(orderId ? { "TokenToCharge.UniqAsmachta": String(orderId) } : {}),
    };

    // Auto add invoice parameters if requested
    if (issueInvoice) {
      params["DocTypeToCreate"] = DOC_TYPE_DEFAULT;                 // some setups expect generic
      params["TokenToCharge.DocTypeToCreate"] = DOC_TYPE_DEFAULT;   // others expect nested
    }
    Object.assign(params, buildInvoiceNV({
      issueInvoice,
      amount: amt,
      currency: coinId,
      description,
      orderId,
      customerName,
      userEmail,
      invoice
    }));

    console.log("💳 ChargeToken NV params:", params);

    const result = await cardcomFetchNVPost(
      "https://secure.cardcom.solutions/interface/ChargeToken.aspx",
      params
    );

    // Normalize ResponseCode to number when possible
    const respCode = Number(result.ResponseCode);
    const ok = respCode === 0;

    await logEvent({
      orderId: orderId || null,
      lowProfileId: null,
      type: ok ? (isRefund ? "token_refund_ok" : "token_charge_ok") : (isRefund ? "token_refund_fail" : "token_charge_fail"),
      payload: result
    });

    if (!ok) {
      return res.status(400).json({ error: result.Description || "Cardcom error", raw: result });
    }

    return res.json(result);
  } catch (err) {
    console.error("❌ /token-charge error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

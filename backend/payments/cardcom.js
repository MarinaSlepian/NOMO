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
const ISSUE_INVOICE_DEFAULT = process.env.CARDCOM_ISSUE_INVOICE_DEFAULT === "true";
const DOC_TYPE_DEFAULT = Number(process.env.CARDCOM_DOC_TYPE || 1); // 1 = InvoiceReceipt

// FRONTEND (browser redirects) and BACKEND (server webhook)
const APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:4200";
const API_URL = process.env.PUBLIC_API_URL || "http://localhost:3000";

// for recurring webhook shared secret (from Cardcom admin "דיווח למערכת חיצונית - הוראת קבע")
const RECUR_SECRET = process.env.CARDCOM_RECURRING_SECRET || "";

// ===== helpers =====
function isHttpsUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:") return false;
    if (/localhost|127\.0\.0\.1/.test(x.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

// Memoize column existence checks (so we can dynamically include optional columns like issue_invoice, invoice_json)
const _colCache = new Map();
async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (_colCache.has(key)) return _colCache.get(key);
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column]
    );
    const exists = !!rows.length;
    _colCache.set(key, exists);
    return exists;
  } catch (e) {
    console.warn("hasColumn check failed:", e?.message);
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
    "amount_minor   = COALESCE(EXCLUDED.amount_minor, payments.amount_minor)",
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
}

async function markFailed({ lowProfileId, orderId, reason }) {
  await pool.query(
    `UPDATE payments SET status = 'failed', fail_reason = $1, updated_at = now() WHERE low_profile_id = $2 OR order_id = $3`,
    [reason || null, lowProfileId || null, orderId || null]
  );
}

async function markPaid({ lowProfileId, orderId, txId, amountMinor, cardType, last4, payload, planDays }) {
  await pool.query(
    `WITH base AS (
       SELECT COALESCE(MAX(access_until), now()) AS last_until, COALESCE(MAX(plan_days), $4) AS plan_days
         FROM payments WHERE (low_profile_id = $5 OR order_id = $6)
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
           order_id       = COALESCE($6::text, order_id),
           card_type      = $7,
           card_last4     = $8,
           access_from    = (SELECT s FROM start_at),
           access_until   = (SELECT s FROM start_at) + (SELECT plan_days FROM base) * INTERVAL '1 day',
           plan_days      = (SELECT plan_days FROM base),
           updated_at     = now()
     WHERE (low_profile_id = $5 OR order_id = $6)`,
    [amountMinor || null, (payload ? JSON.stringify(payload) : null), txId || null, planDays || DEFAULT_PLAN_DAYS, lowProfileId || null, orderId || null, cardType || null, last4 || null]
  );
}

async function logEvent({ orderId, lowProfileId, type, payload }) {
  try {
    await pool.query(
      `INSERT INTO payment_events(order_id, low_profile_id, event_type, payload) VALUES ($1,$2,$3,$4)`,
      [orderId || null, lowProfileId || null, type || null, payload ? JSON.stringify(payload) : null]
    );
  } catch (e) {
    console.warn("logEvent failed:", e?.message);
  }
}

// Parse application/x-www-form-urlencoded body into req.body
function parseForm(req, res, next) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = {};
    raw.split(/[&\r\n]+/).filter(Boolean).forEach(pair => {
      const i = pair.indexOf("=");
      if (i > -1) body[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    });
    req.body = body;
    next();
  });
}

// Extract card expiry from Verify payload (new JSON v11 LowProfile)
function extractExpiryFromVerify(verifyData) {
  const tInfo = verifyData?.TranzactionInfo || {};
  let mm = tInfo?.ExpiryMonth != null ? String(tInfo.ExpiryMonth) : null;
  let yy = tInfo?.ExpiryYear != null ? String(tInfo.ExpiryYear)   : null;
  if (mm != null) mm = mm.padStart(2, "0");
  if (yy != null) yy = yy.slice(-2);

  if (mm && (+mm < 1 || +mm > 12)) mm = null;
  const mmyy = (mm && yy) ? `${mm}/${yy}` : null;
  return { mm, yy, mmyy, source: "v11" };
}

// Extract expiry from a raw string like "11/30" if provided
function extractExpiryFromText(text) {
  if (!text) return { mm: null, yy: null, mmyy: null, source: "none" };
  const m = String(text).match(/^(\d{1,2})\/(\d{2})$/);
  if (!m) return { mm: null, yy: null, mmyy: null, source: "none" };
  let mm = m[1].padStart(2, "0");
  let yy = m[2];
  if (+mm < 1 || +mm > 12) mm = null;
  const mmyy = (mm && yy) ? `${mm}/${yy}` : null;
  return { mm, yy, mmyy, source: "tInfo" };
}

// ===== NV helpers (GET/POST) =====
async function cardcomFetchNVGet(url, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  if (!qs.has("codepage")) qs.append("codepage", "65001");
  const href = `${url}?${qs.toString()}`;
  const res = await fetch(href);
  const text = await res.text();

  // Parse "name=value&name2=value2" (or newline-separated) into object
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
  if (!out.ResponseCode && text.startsWith("<!DOCTYPE")) {
    return { ResponseCode: "-1", Description: "HTML error page", raw: text };
  }
  return Object.keys(out).length ? out : { raw: text };
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
    let { amount, orderId, description, currency, userEmail, planDays, successUrl, failUrl, issueInvoice, invoice } = req.body || {};

    if (!Number.isFinite(Number(amount))) {
      return res.status(400).json({ error: "amount is required" });
    }
    amount = Number(amount);
    currency = Number(currency) || 1; // default ILS
    planDays = Number(planDays) || DEFAULT_PLAN_DAYS;
    orderId = orderId || String(Date.now());

    const okUrls = [
      successUrl || `${APP_URL}/pay/success`,
      failUrl || `${APP_URL}/pay/fail`,
      `${API_URL}/api/pay/webhook`,
    ];
    if (!okUrls.every(isHttpsUrl)) {
      return res.status(400).json({ error: "All URLs (success/fail/webhook) must be HTTPS and public" });
    }

    const payload = {
      TerminalNumber: TERMINAL,
      ApiName: API_NAME,
      Operation: "ChargeAndCreateToken",
      codepage: 65001,
      Amount: amount,
      ISOCoinId: currency,
      ReturnValue: orderId,
      SuccessRedirectUrl: successUrl || `${APP_URL}/pay/success`,
      FailedRedirectUrl: failUrl || `${APP_URL}/pay/fail`,
      IndicatorUrl: `${API_URL}/api/pay/webhook`,
      WebHookUrl: `${API_URL}/api/pay/webhook`,
      ProductName: description || "NOMO",
      CustomerEmail: userEmail || undefined,
      // Ask Cardcom to tokenize card
      CreateToken: true,
    };

    // Persist start meta for later steps (including invoice preferences)
    await saveStart({
      orderId,
      lowProfileId: null,
      userEmail: userEmail || null,
      amountMinor: Math.round(amount * 100),
      currency,
      planDays,
      issueInvoice,
      invoice,
    });
    await logEvent({ orderId, lowProfileId: null, type: "start_meta", payload: { issueInvoice, invoice } });

    const resp = await fetch("https://secure.cardcom.solutions/api/v11/LowProfile/Create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();

    if (Number(data?.ResponseCode) !== 0) {
      await logEvent({ orderId, lowProfileId: null, type: "start_fail", payload: data });
      return res.status(400).json({ error: data?.Description || "Cardcom error", raw: data });
    }

    const lowProfileId = String(data?.LowProfileId || "");
    await saveStart({
      orderId,
      lowProfileId,
      userEmail: userEmail || null,
      amountMinor: Math.round(amount * 100),
      currency,
      planDays,
      issueInvoice,
      invoice,
    });

    await logEvent({ orderId, lowProfileId, type: "start_ok", payload: data });
    return res.json({ url: data?.URL, lowProfileId });
  } catch (e) {
    console.error("/start error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ===== LowProfile webhook: verify, mark paid, and create recurring =====
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

    if (Number(verifyData?.ResponseCode) !== 0){
      await markFailed({
        lowProfileId,
        orderId,
        reason: verifyData?.Description || `code:${verifyData?.ResponseCode}`,
      });
      await logEvent({ orderId, lowProfileId, type: "first_charge_fail", payload: verifyData });
      return res.status(200).send("OK");
    }

    // Extract card info and token
    const tx = verifyData?.Transaction || verifyData?.TranzactionInfo || {};
    const cardToken = tx?.Token || tx?.TokenNumber || null;
    const txId = tx?.InternalDealNumber || tx?.DealResponse_TransactionID || null;
    const cardType = tx?.Brand || null;
    const last4 = tx?.Last4CardDigitsString || null;

const cardOwner = tx?.CardOwnerName || verifyData?.TranzactionInfo?.CardOwnerName || null;
    // Pull persisted start meta (price, currency, planDays, issueInvoice, invoice)
    const hasIssue = await hasColumn("payments", "issue_invoice");
    const hasInvoiceJson = await hasColumn("payments", "invoice_json");

    // Build a dynamic select so we don't error on missing columns
    let selectSql = `SELECT amount_minor, currency, user_email, plan_days, subscription_id`;
    if (hasIssue) selectSql += `, issue_invoice`;
    if (hasInvoiceJson) selectSql += `, invoice_json`;
    selectSql += ` FROM payments WHERE low_profile_id = $1 LIMIT 1`;

    const { rows: recRows } = await pool.query(selectSql, [lowProfileId]);
    const rec = recRows[0] || {};
    const coinId   = Number(rec.currency || 1);
    const planDays = Number(rec.plan_days || DEFAULT_PLAN_DAYS);
    const price    = Number(rec.amount_minor || 0);
// Load meta from event if columns are missing
    let issueInvoice = hasIssue ? !!rec.issue_invoice : undefined;
    let invoiceMeta  = hasInvoiceJson ? (rec.invoice_json || null) : null;
    if (issueInvoice === undefined) {
      // fall back to latest start_meta event
      const {
        rows: ev
      } = await pool.query(
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
      orderId,
      lowProfileId,
      txId,
      price,
      planDays,
      issueInvoice,
    });

    // 3) Create Direct Debit (Recurring) master using Name-to-Value
    if (!cardToken) {
      await logEvent({ orderId, lowProfileId, type: "subscription_skip_missing_token", payload: verifyData });
      return res.status(200).send("OK");
    }

    // Derive expiry
    const parsedExp = extractExpiryFromVerify(verifyData);
    const forceMM   = process.env.CARDCOM_FORCE_EXP_MM || null; // e.g. "11"
    const forceYY   = process.env.CARDCOM_FORCE_EXP_YY || null; // e.g. "30"
    const mm        = forceMM || parsedExp.mm || null;
    const yy        = forceYY || parsedExp.yy || null;
    const mmyy      = (mm && yy) ? `${mm}/${yy}` : null;

    // Build ONLY the NV fields Cardcom documents for Direct Debit NV:
    const expiryFieldsNV = {
      ...(mm   ? { "CardValidityMonth": mm } : {}),
      ...(yy   ? { "CardValidityYear":  yy } : {}),
      // (Do NOT send ChangeDateValidity in NV; Cardcom said it's not a NV param)
    };

    console.log("📦 NV expiry being sent:", { mm, yy, mmyy });

    const timeIntervalId = 1; // monthly cadence per docs
const next = addDays(new Date(), planDays || DEFAULT_PLAN_DAYS);

// --- final NV params for RecurringPayment.aspx (Name-to-Value) ---
    const customerName = cardOwner || rec.user_email || "NOMO user";

    const params = {
      TerminalNumber: Number.isFinite(TERMINAL_RECURRING) ? TERMINAL_RECURRING : TERMINAL,
      UserName: API_NAME,
      codepage: 65001,
      Operation: "NewAndUpdate",

      // Source card (token from first charge)
      "CreditCard.Token": cardToken,

      // Correct NV expiry fields (no "CreditCard.*" keys here)
      ...expiryFieldsNV,

      // Account (CRM)
      "Account.CompanyName": customerName,
      "Account.Email": rec.user_email || undefined,
      // Optional mapping (if you collect it on /start invoice meta):
      ...(invoiceMeta?.compId ? { "Account.RegisteredBusinessNumber": invoiceMeta.compId } : {}),

      // Recurring
      "RecurringPayments.InternalDecription": "NOMO subscription",
      // Cardcom expects date-only here
      "RecurringPayments.NextDateToBill": fmtDDMMYYYY(next), // dd/MM/yyyy (no time)
      "RecurringPayments.TotalNumOfBills": 999999,
      "RecurringPayments.FinalDebitCoinId": coinId,
      "RecurringPayments.ReturnValue": orderId || "",
      "RecurringPayments.TimeIntervalId": timeIntervalId,

      // Line
      "RecurringPayments.FlexItem.InvoiceDescription": "NOMO plan",
      "RecurringPayments.FlexItem.Price": (price / 100).toFixed(2),
      "RecurringPayments.FlexItem.IsPriceIncludeVat": "true",
    };

    // Honor persisted invoice preference: ask Cardcom to create a doc per debit
    if (issueInvoice) {
      params["RecurringPayments.DocTypeToCreate"] = DOC_TYPE_DEFAULT; // 1 = InvoiceReceipt
      // For recurring, Cardcom builds the document from the FlexItem line per debit.
      // If you want to include more per-customer head fields (like CompID), these must be set on the account in Cardcom.
      // You could also pass some InvoiceHead fields if the API supports them at master creation (varies by setup).
    }

    if (process.env.CARDCOM_TERMINAL_RECURRING) {
      params["RecurringPayments.ChargeInTerminal"] = Number(process.env.CARDCOM_TERMINAL_RECURRING);
    }

    console.log("📦 RecurringPayment NV params:", params);

    // Per docs: call RecurringPayment.aspx via GET (Name=Value)
    const subResult = await cardcomFetchNVGet(
      "https://secure.cardcom.solutions/interface/RecurringPayment.aspx",
      params
    );

    console.log("📦 RecurringPayment NV response:", subResult);

    if (String(subResult?.ResponseCode) !== "0") {
      await logEvent({ orderId, lowProfileId, type: "subscription_fail", payload: subResult });
      // keep access for the first paid cycle regardless
      return res.status(200).send("OK");
    }

    const recurringId = subResult?.["Recurring0.RecurringId"] || subResult?.RecurringPaymentId || subResult?.RecurringPaymentCode || null;
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
    console.error("❌ /webhook error:", err);
    return res.status(200).send("OK"); // Cardcom expects 200 regardless
  }
});

// ===== Recurring webhook (Direct Debit) =====
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

      // -------- Secret check (timing safe, constant-time compare) --------
      const provided = String(b?.Secret || "");
      const expected = String(RECUR_SECRET || "");
      const bad = provided.length !== expected.length ||
        crypto.timingSafeEqual(Buffer.from(provided.padEnd(expected.length)), Buffer.from(expected)) === false;

      console.log("➡️ Recurring webhook:", {
        ip: req.ip,
        method: req.method,
        ok: !bad,
      });

      if (bad) {
        await logEvent({ orderId: b?.ReturnValue || null, lowProfileId: null, type: "recurring_bad_secret", payload: { headers: req.headers, body: b } });
        return res.status(200).send("OK");
      }

      const type = String(b?.Type || "").toUpperCase(); // MASTERRECURRING / DETAILRECURRING
      const status = String(b?.Status || "").toUpperCase();
      const subscriptionId = b?.RecurringPaymentId || b?.RecurringPaymentCode || null;

      // Normalize timestamps
      const paidAt = b?.ChargeDate || b?.StartDate;

      // Update access window for successful details
      if (type.includes("DETAIL") && status === "SUCCESSFUL") {
        await pool.query(
          `UPDATE payments SET
             status = 'subscribed',
             access_from = COALESCE(access_until, now()),
             access_until = COALESCE(access_until, now())
             + COALESCE(plan_days, 30) * INTERVAL '1 day',
             updated_at = now()
           WHERE subscription_id = $1`,
          [subscriptionId]
        );
      }

      await logEvent({ orderId: b?.ReturnValue || null, lowProfileId: null, type: `recurring_${type.toLowerCase()}_${status.toLowerCase()}`, payload: b });
      return res.status(200).send("OK");
    } catch (e) {
      console.error("❌ recurring-webhook error:", e);
      return res.status(200).send("OK");
    }
  }
);

// ===== Utility: simple fetch for JSON v11 endpoints =====
async function cardcomFetch(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await resp.json().catch(() => ({}));
  return data;
}

// ===== Helpers: date/interval for recurring =====
function fmtDDMMYYYY(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ===== Token charge/refund (NV ChargeToken.aspx) with optional invoice creation =====
function buildInvoiceNV({ issueInvoice, amount, currency, description, orderId, customerName, userEmail, invoice = {} }) {
  if (!issueInvoice) return {};

  const head = {
    "DocTypeToCreate": DOC_TYPE_DEFAULT, // 1 = InvoiceReceipt
    "InvoiceHead.CustName": invoice.custName || customerName || "Customer",
    "InvoiceHead.SendByEmail": (invoice.sendByEmail ?? true) ? "true" : "false",
    ...(userEmail ? { "InvoiceHead.Email": userEmail } : {}),
    ...(invoice.city ? { "InvoiceHead.City": invoice.city } : {}),
    ...(invoice.addressLine1 ? { "InvoiceHead.Address1": invoice.addressLine1 } : {}),
    ...(invoice.addressLine2 ? { "InvoiceHead.Address2": invoice.addressLine2 } : {}),
    ...(invoice.phone ? { "InvoiceHead.Phone": invoice.phone } : {}),
    ...(invoice.mobile ? { "InvoiceHead.Mobile": invoice.mobile } : {}),
    ...(invoice.compId ? { "InvoiceHead.RegisteredBusinessNumber": invoice.compId } : {}),
    ...(invoice.departmentId ? { "InvoiceHead.DepartmentId": invoice.departmentId } : {}),
    ...(orderId ? { "InvoiceHead.ExternalID": String(orderId) } : {}),
    ...(invoice.isVatFree ? { "InvoiceHead.IsVatFree": "true" } : {}),
  };

  const priceStr = Number.isFinite(Number(invoice.linePrice)) ? Number(invoice.linePrice).toFixed(2) : amount.toFixed(2);
  const lines = {
    "InvoiceLines 1.Description": invoice.lineDescription || description || "NOMO charge",
    "InvoiceLines 1.Price": priceStr,
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
router.post("/token-charge", async (req, res) => {
  try {
    const { token, amount, currency, orderId, description, isRefund, userEmail, customerName, issueInvoice, invoice } = req.body || {};

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

    // Recommended: richer response fields
    params["TokenToCharge.APILevel"] = 10;

    // Optional extras per terminal configuration
    if (req.body?.approvalNumber) {
      params["TokenToCharge.ApprovalNumber"] = String(req.body.approvalNumber);
    }
    if (req.body?.identityNumber) {
      params["TokenToCharge.IdentityNumber"] = String(req.body.identityNumber);
    }
    if (req.body?.mti === 420 || String(req.body?.mti) === "420") {
      params["TokenToCharge.MTI"] = 420; // release hold
    }

    // Refund password is required for refunds
    if (isRefund) {
      const refundPwd = process.env.CARDCOM_API_PASSWORD || process.env.CARDCOM_USER_PASSWORD || null;
      if (refundPwd) params["TokenToCharge.UserPassword"] = refundPwd;
    }

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

// payments/cardcom.js
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// ✅ env (DON'T hardcode secrets)
const TERMINAL = process.env.CARDCOM_TERMINAL;     // e.g. 173449
const API_NAME = process.env.CARDCOM_API_NAME;     // e.g. ELtFz5RUS...
const BASE_URL = process.env.PUBLIC_BASE_URL;      // e.g. https://yourapi.com

// Small helper
async function cardcomFetch(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return data;
}

/**
 * POST /api/pay/start
 * Body: { amount:number, orderId:string, description?:string, currency?:number }
 * Returns: { url, lowProfileId }
 */
router.post("/start", async (req, res) => {
  try {
    const { amount, orderId, description = "NOMO payment", currency = 1 } = req.body;
    if (!amount || !orderId) {
      return res.status(400).json({ error: "amount and orderId are required" });
    }

    const body = {
      TerminalNumber: Number(TERMINAL),
      ApiName: API_NAME,
      Operation: "ChargeOnly",
      Amount: Number(amount),
      ISOCoinId: Number(currency), // 1=ILS, 2=USD...
      ProductName: description,
      ReturnValue: String(orderId),
      SuccessRedirectUrl: `${BASE_URL}/pay/success`,
      FailedRedirectUrl: `${BASE_URL}/pay/failed`,
      WebHookUrl: `${BASE_URL}/api/pay/webhook`,
      Language: "EN", // or "HE"
    };

    const data = await cardcomFetch(
      "https://secure.cardcom.solutions/api/v11/LowProfile/Create",
      body
    );

    if (data?.ResponseCode === 0 && data?.Url) {
      // TIP: store data.LowProfileId ↔ orderId in DB for later verification
      return res.json({ url: data.Url, lowProfileId: data.LowProfileId });
    }
    return res.status(400).json({ error: data?.Description || "Cardcom error", raw: data });
  } catch (err) {
    console.error("Cardcom /start error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// This endpoint expects raw text from Cardcom. Use a text parser just for this route:
router.post("/webhook", express.text({ type: "*/*" }), async (req, res) => {
  try {
    // Parse whatever Cardcom sent; often LowProfileId/ReturnValue come as form/text
    const raw = req.body || "";
    // Example: try to extract LowProfileId from raw text or querystring if they send it that way
    const lowProfileId =
      /LowProfileId=(\d+)/.exec(raw)?.[1] ||
      new URLSearchParams(raw).get("LowProfileId");

    if (!lowProfileId) {
      console.warn("Webhook without LowProfileId. Raw:", raw);
      // Always 200 so Cardcom doesn't retry endlessly, but mark as fail internally
      return res.status(200).send("MISSING LOWPROFILEID");
    }

    // Verify with Cardcom from the SERVER (important!)
    const url = new URL("https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult");
    url.searchParams.set("TerminalNumber", TERMINAL);
    url.searchParams.set("ApiName", API_NAME);
    url.searchParams.set("LowProfileId", lowProfileId);

    const verifyResp = await fetch(url.toString());
    const verifyData = await verifyResp.json();

    // Success?
    if (verifyData?.ResponseCode === 0) {
      // Mark PAID in your DB here using verifyData.ReturnValue (your orderId) etc.
      // save: verifyData.TransactionId, verifyData.Amount, verifyData.CardType, etc.
      console.log("✅ Cardcom verified:", {
        orderId: verifyData?.ReturnValue,
        tx: verifyData?.TransactionId,
        amount: verifyData?.Amount,
      });
      return res.status(200).send("OK");
    }

    console.warn("❌ Cardcom verification failed:", verifyData);
    return res.status(200).send("FAIL"); // still 200 to acknowledge receipt
  } catch (err) {
    console.error("Cardcom /webhook error:", err);
    res.status(200).send("ERROR"); // acknowledge so they don't spam retries
  }
});

/**
 * Optional: GET /api/pay/status/:lowProfileId
 * lets you check a payment manually from your back-office
 */
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

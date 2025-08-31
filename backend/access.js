// access.js
import { Router } from 'express';
import { pool } from './db.js';
import { requireAuth } from './auth.js'; // reuse your existing middleware

const router = Router();

/**
 * GET /api/access/me
 * Returns: { email, plan{...}, billing{...}, server_time }
 */
// access.js (route)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const email = req.user.email;

    const sql = `
      WITH base AS (
        SELECT *
        FROM payments
        WHERE user_email = $1
      ),
      cur AS (
        SELECT
          MAX(access_from)  AS from_ts,
          MAX(access_until) AS until_ts
        FROM base
        WHERE status IN ('paid','subscribed')
      ),
      last_charge AS (
        SELECT
          amount_minor,                      -- integer in minor units
          currency,
          subscription_id,
          plan_days,
          access_until                      AS period_end,
          COALESCE(paid_at, created_at)     AS charged_at,
          -- Resolve card brand/last4 from columns or JSON
          COALESCE(
            card_type,
            (verify_payload::jsonb -> 'TranzactionInfo' ->> 'Brand')
          ) AS brand_resolved,
          COALESCE(
            card_last4,
            (verify_payload::jsonb -> 'TranzactionInfo' ->> 'Last4CardDigitsString'),
            (verify_payload::jsonb -> 'TranzactionInfo' ->> 'Last4CardDigits')
          ) AS last4_resolved,
          -- Exp month from UIValues or TranzactionInfo
          COALESCE(
            NULLIF((verify_payload::jsonb -> 'UIValues'        ->> 'CardMonth'), '')::int,
            NULLIF((verify_payload::jsonb -> 'TranzactionInfo' ->> 'CardMonth'), '')::int
          ) AS exp_month_resolved,
          -- Exp year: prefer full year from UIValues; else 2-digit in TranzactionInfo -> convert to 2000+YY
          COALESCE(
            NULLIF((verify_payload::jsonb -> 'UIValues'        ->> 'CardYear'), '')::int,
            CASE
              WHEN (verify_payload::jsonb -> 'TranzactionInfo' ->> 'CardYear') ~ '^[0-9]+$'
              THEN
                CASE
                  WHEN length((verify_payload::jsonb -> 'TranzactionInfo' ->> 'CardYear')) = 2
                    THEN 2000 + ((verify_payload::jsonb -> 'TranzactionInfo' ->> 'CardYear')::int)
                  ELSE (verify_payload::jsonb -> 'TranzactionInfo' ->> 'CardYear')::int
                END
              ELSE NULL
            END
          ) AS exp_year_resolved
        FROM base
        WHERE status IN ('paid','subscribed')
        ORDER BY COALESCE(paid_at, created_at) DESC
        LIMIT 1
      )
      SELECT
        $1::text AS email,
        json_build_object(
          'status',
            CASE
              WHEN cur.until_ts IS NULL THEN 'none'
              WHEN cur.until_ts > NOW() THEN 'active'
              ELSE 'past_due'
            END,
          'current_period_end', cur.until_ts,
          'next_charge_date',
            CASE
              WHEN cur.until_ts IS NOT NULL AND cur.until_ts > NOW() THEN cur.until_ts
              WHEN last_charge.subscription_id IS NOT NULL
                   AND last_charge.plan_days IS NOT NULL
                   AND last_charge.charged_at IS NOT NULL
                THEN (last_charge.charged_at + (last_charge.plan_days || ' days')::interval)
              ELSE NULL
            END
        ) AS plan,
        json_build_object(
          'last_payment_sum',
            CASE
              WHEN last_charge.amount_minor IS NULL THEN NULL
              ELSE (last_charge.amount_minor::double precision / 100.0)
            END,
          'last_charge_date', last_charge.charged_at,
          'next_charge_date',
            CASE
              WHEN cur.until_ts IS NOT NULL AND cur.until_ts > NOW() THEN cur.until_ts
              WHEN last_charge.subscription_id IS NOT NULL
                   AND last_charge.plan_days IS NOT NULL
                   AND last_charge.charged_at IS NOT NULL
                THEN (last_charge.charged_at + (last_charge.plan_days || ' days')::interval)
              ELSE NULL
            END,
          'currency', last_charge.currency,
          'payment_method',
            CASE
              WHEN last_charge.brand_resolved IS NULL
                   AND last_charge.last4_resolved IS NULL
                THEN NULL
              ELSE json_build_object(
                'brand',     last_charge.brand_resolved,
                'last4',     last_charge.last4_resolved,
                'exp_month', last_charge.exp_month_resolved,
                'exp_year',  last_charge.exp_year_resolved
              )
            END
        ) AS billing,
        (NOW() AT TIME ZONE 'UTC') AS server_time
      FROM cur
      LEFT JOIN last_charge ON TRUE;
    `;

    const { rows } = await pool.query(sql, [email]);
    const r = rows[0] || {};

    const plan = r.plan ?? { status: 'none', current_period_end: null, next_charge_date: null };
    const billing = r.billing ?? {
      last_payment_sum: null,
      last_charge_date: null,
      next_charge_date: null,
      currency: 'ILS',
      payment_method: null
    };

    res.json({
      email,
      plan: {
        status: plan.status ?? 'none',
        current_period_end: plan.current_period_end ?? null,
        next_charge_date: plan.next_charge_date ?? null
      },
      billing: {
        last_payment_sum: billing.last_payment_sum ?? null,
        last_charge_date: billing.last_charge_date ?? null,
        next_charge_date: billing.next_charge_date ?? null,
        currency: billing.currency ?? 'ILS',
        payment_method: billing.payment_method ?? null
      },
      server_time: r.server_time ?? new Date().toISOString()
    });
  } catch (e) {
    console.error('access/me error', e);
    res.status(500).json({ error: 'internal' });
  }
});


export default router;

/*
export type PlanStatus = 'none' | 'trialing' | 'active' | 'grace' | 'past_due' | 'canceled';


export interface PlanInfo {
  status: PlanStatus;
  current_period_end: string | null;
  next_charge_date: string | null;
}

export interface PaymentMethod {
  brand: string;// e.g., 'visa'
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
}

export interface BillingSummary {
  last_payment_sum: number | null;
  last_charge_date: string | null;
  next_charge_date: string | null;
  currency?: string;
  payment_method: PaymentMethod | null;
}

export interface MeResponse {
  email: string;
  plan: PlanInfo | null;
  billing: BillingSummary | null;
  server_time: string;
}*/
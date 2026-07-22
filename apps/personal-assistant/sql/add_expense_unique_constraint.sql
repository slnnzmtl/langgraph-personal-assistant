-- Add a unique constraint on (name, amount, paid_date) to public.expense
-- This enables ON CONFLICT DO NOTHING for idempotent Wise transaction inserts.
--
-- Run once in Supabase SQL Editor.
-- Safe to re-run: the IF NOT EXISTS guard prevents duplicate constraint errors.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expense_name_amount_paid_date_key'
      AND conrelid = 'public.expense'::regclass
  ) THEN
    ALTER TABLE public.expense
      ADD CONSTRAINT expense_name_amount_paid_date_key
      UNIQUE (name, amount, paid_date);
  END IF;
END;
$$;

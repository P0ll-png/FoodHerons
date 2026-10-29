-- FoodHerons — Phase B — 0009_order_payment_enum.sql
-- GCash-gated pre-orders: the two new order_status labels ONLY, per the
-- admin-revenue-gcash design (§4.3). Run AFTER 0008_vendor_approval.sql and
-- BEFORE 0010_order_payment.sql.
--
-- These are split into their own migration (and MUST be run as their own
-- SQL-editor execution, committed before 0010) because Postgres forbids using
-- a newly added enum label in the same transaction that added it, and 0010
-- both sets a column DEFAULT to 'awaiting_payment' and references the labels
-- inside RPC bodies. `alter type ... add value` cannot run inside an explicit
-- begin…commit, so these are bare top-of-file statements.

alter type public.order_status add value if not exists 'awaiting_payment';
alter type public.order_status add value if not exists 'payment_submitted';

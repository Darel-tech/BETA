-- Rollback script for 0007_product_layer_tables.sql
-- Run manually if product layer schema needs to be reverted.
-- NEVER auto-run by migration tools.

DROP TABLE IF EXISTS rate_counters CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS usage_events CASCADE;
DROP TABLE IF EXISTS check_runs CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS auth_config CASCADE;
DROP TABLE IF EXISTS app_profiles CASCADE;

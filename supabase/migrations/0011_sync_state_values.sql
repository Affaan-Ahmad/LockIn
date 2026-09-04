-- =============================================================================
-- 0011_sync_state_values.sql
--
-- New enum values only.
--
-- Deliberately alone in this file. Postgres allows ALTER TYPE ... ADD VALUE
-- inside a transaction, but the new label cannot be *used* until that
-- transaction commits -- so a single migration that added a value and then
-- referenced it in a function body or a CHECK would fail at apply time. Split
-- across two files, 0012 runs in its own transaction and can use these freely.
--
-- Nothing here is destructive: adding a label leaves every existing row valid.
-- =============================================================================

-- QUEUED: work remains and nobody owns it.
--
-- This is the state that makes synchronisation resumable. Previously a run was
-- RUNNING or it was finished, so an invocation that died mid-run left a row
-- that only a lease expiry could rescue, and the work it had already done was
-- indistinguishable from work never started. QUEUED says "durable progress
-- exists, pick this up" -- and it is what the continuation worker looks for.
alter type sync_status add value if not exists 'QUEUED' before 'RUNNING';

-- PENDING / RUNNING for the per-course work queue.
--
-- sync_course_results already recorded the outcome of a course. Adding the two
-- non-terminal states turns the same table into the checkpoint: the set of
-- PENDING rows *is* the remaining work, so progress needs no JSON blob and no
-- second table.
alter type course_sync_status add value if not exists 'PENDING' before 'SUCCESS';
alter type course_sync_status add value if not exists 'RUNNING' before 'SUCCESS';

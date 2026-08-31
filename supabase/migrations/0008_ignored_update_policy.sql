-- =============================================================================
-- 0008_ignored_update_policy.sql
--
-- Fixes a real defect in 0007, found by the integration test for hiding the
-- same assignment twice.
--
-- 0007 granted select, insert and delete on ignored_assignments but no update.
-- app_set_assignment_ignored hides with `insert ... on conflict do update set
-- note = excluded.note`, and the conflict arm is an UPDATE: with no update
-- policy it failed with 42501, "new row violates row-level security policy
-- (USING expression)".
--
-- The user-visible symptom was a 500 on the second tap of Hide -- exactly the
-- double-tap the function was written to tolerate.
--
-- SECURITY INVOKER is kept deliberately. The alternative fix, making the
-- function SECURITY DEFINER so it bypasses RLS, would have removed the check
-- rather than satisfied it: every future bug in that function would then have
-- had the whole table to work with. A narrow policy is the smaller grant.
-- =============================================================================

create policy ignored_update_own on ignored_assignments
  for update to authenticated
  using (user_id = (select auth.uid()))
  -- Both halves. USING decides which rows may be updated, WITH CHECK decides
  -- what they may become; without the second, a row could be updated into
  -- another student's name.
  with check (user_id = (select auth.uid()));

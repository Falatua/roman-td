-- Roman TD leaderboard cleanup — 2026-07-05
--
-- Run this in the Supabase SQL editor with owner/admin rights.
-- Public game clients intentionally cannot UPDATE or DELETE scores.
--
-- Context:
--   * The campaign is now 30 waves, so historical W20 rows may keep their
--     W badge but should not receive the old 20-wave win bonus.
--   * Three June 29 W30 rows were produced before the W30 balance was valid
--     and should be removed from the physical table.

-- Remove invalid pre-balance W30 rows from the global board.
delete from public.scores
where id in (
  '59674466-f16b-4022-bcc5-731d2c827a9a',
  '0f32dab9-abcb-4cd0-843b-fb216ddffaf4',
  '7ae16acf-e27c-4485-9118-e6baaa23c20f'
);

-- Recompute historical campaign scores with the current formula:
-- waves cleared + combos + quests + W30-only win bonus.
-- This preserves the W/L badge in `won` while removing the old W20 win factor.
update public.scores
set score =
  (case
    when won then wave
    else greatest(0, wave - 1)
   end * 2000)
  + greatest(0, towers_combined) * 500
  + greatest(0, quests_completed) * 400
  + case when won and wave >= 30 then 40000 else 0 end
where mode = 'campaign';


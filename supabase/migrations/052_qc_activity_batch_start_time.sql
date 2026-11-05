-- Migration 052: add batch_start_time to qc_activity_draft
-- Stores the FG Batch Start Time (hh:mm 24-hr) so Production → Activity
-- can display it as "Sample Time" on the live QC card.

alter table qc_activity_draft
  add column if not exists batch_start_time text;

-- Staff OS (P2 step 2): the StaffTasks / StaffPlans tabs, moved from Google Sheets.
-- Columns mirror SOS_TASK_HDRS_ / SOS_PLAN_HDRS_ in Code_staff_os.gs. The value columns have no declared type on
-- purpose: SQLite then keeps each value exactly as written (text stays text, a number stays a number), so the
-- page gets back the same JSON the sheet gave it. Rows come back in insertion order (rowid), like the sheet.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  owner, title, notes, status, due, priority, assignedBy, createdAt, updatedAt, planId
);
CREATE INDEX tasks_owner ON tasks(owner);
CREATE TABLE plans (
  id TEXT PRIMARY KEY NOT NULL,
  owner, type, title, detail, period, status, progress, metric, target, current, parentId, createdAt, updatedAt
);
CREATE INDEX plans_owner ON plans(owner);
-- A write's request id → its reply, so a retried save is answered from here instead of running twice.
CREATE TABLE rids (rid TEXT PRIMARY KEY NOT NULL, reply TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX rids_at ON rids(at);

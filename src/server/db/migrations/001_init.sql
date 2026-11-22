-- Fixi initial schema. All dates are ISO 8601 strings in UTC.

CREATE TABLE apps (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                  TEXT    NOT NULL UNIQUE,
  name                  TEXT    NOT NULL,
  api_key               TEXT    NOT NULL,
  allowed_origins       TEXT    NOT NULL DEFAULT '[]', -- JSON array of origins
  issue_provider        TEXT    CHECK (issue_provider IN ('gitlab', 'github')),
  issue_project         TEXT,                           -- GitLab project id ("42") or GitHub "owner/repo"
  issue_default_labels  TEXT,                           -- "bug,fixi"
  issue_anonymize       INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL
);

CREATE TABLE bug_reports (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id                    INTEGER NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
  parent_id                 INTEGER REFERENCES bug_reports(id),
  category                  TEXT    NOT NULL CHECK (category IN ('bug', 'blocking', 'suggestion')),
  status                    TEXT    NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'in_progress', 'sent', 'resolved', 'rejected', 'duplicate')),
  comment                   TEXT    NOT NULL DEFAULT '',
  user_info                 TEXT    NOT NULL DEFAULT '',
  user_email                TEXT,
  app_version               TEXT,
  url                       TEXT    NOT NULL DEFAULT '',
  user_agent                TEXT    NOT NULL DEFAULT '',
  viewport                  TEXT    NOT NULL DEFAULT '',
  client_created_at         TEXT    NOT NULL,
  screenshot_path           TEXT,
  attachment_path           TEXT,
  attachment_original_name  TEXT,
  attachment_mime           TEXT,
  timeline_json             TEXT    NOT NULL DEFAULT '[]',
  has_http_error            INTEGER NOT NULL DEFAULT 0,
  max_http_status           INTEGER,
  has_js_error              INTEGER NOT NULL DEFAULT 0,
  issue_provider            TEXT,
  issue_number              INTEGER,
  issue_url                 TEXT,                       -- not unique: several tickets may share an issue
  admin_notes               TEXT,                       -- strictly private
  last_notified_at          TEXT,
  created_at                TEXT    NOT NULL,
  updated_at                TEXT    NOT NULL
);

CREATE INDEX idx_reports_app_status ON bug_reports (app_id, status);
CREATE INDEX idx_reports_parent     ON bug_reports (parent_id);
CREATE INDEX idx_reports_created    ON bug_reports (created_at);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

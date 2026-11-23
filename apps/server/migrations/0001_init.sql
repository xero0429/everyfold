-- Everyfold 초기 스키마
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('rev', 0);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

-- 폴더(=카테고리)와 북마크. parent_id NULL = Everyfold 루트. deleted=1 은 tombstone.
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'bookmark')),
  parent_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  norm_url TEXT,
  position REAL NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX nodes_rev ON nodes (rev);
CREATE INDEX nodes_parent ON nodes (parent_id);
CREATE INDEX nodes_norm_live ON nodes (norm_url) WHERE deleted = 0;

-- 모든 서버 변경 기록(되돌리기의 근거). rev 하나 = 변경 하나.
CREATE TABLE changes (
  rev INTEGER PRIMARY KEY,
  node_id TEXT NOT NULL,
  op TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  device_id TEXT,
  batch_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX changes_node ON changes (node_id, rev);
CREATE INDEX changes_batch ON changes (batch_id);

-- 동시 수정 충돌에서 버려진 쪽 기록
CREATE TABLE conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  device_id TEXT,
  reason TEXT NOT NULL,
  op_json TEXT NOT NULL,
  server_json TEXT,
  server_won TEXT,
  created_at INTEGER NOT NULL
);

-- 기기별 browserNodeId ↔ serverId (재설치 복구용 사본)
CREATE TABLE mappings (
  device_id TEXT NOT NULL,
  browser_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  PRIMARY KEY (device_id, browser_id)
);

-- 사용자가 북마크를 카테고리로 옮긴 기록(분류 학습 입력)
CREATE TABLE moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  to_category_id TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- 새 카테고리·구조 개편 제안. 승인해야 적용된다.
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  batch_id TEXT
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  rev INTEGER NOT NULL,
  node_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
-- D1 행 크기 한도(2MB) 때문에 스냅샷 내용은 500개씩 나눠 담는다
CREATE TABLE snapshot_parts (
  snapshot_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, part)
);
CREATE INDEX snapshots_created ON snapshots (created_at);

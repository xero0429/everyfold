-- 카테고리 안정 키 + 로캘 설정
-- 규칙·인박스는 폴더 이름이 아니라 cat_key 로 찾는다 → 사용자가 이름을 바꿔도 분류가 계속 맞는다.
ALTER TABLE nodes ADD COLUMN cat_key TEXT;
CREATE INDEX nodes_cat_key ON nodes (cat_key) WHERE cat_key IS NOT NULL;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 0001 로 이미 만들어진 서버(한국어 기본 카테고리)는 키를 붙이고 로캘을 ko 로 둔다
UPDATE nodes SET cat_key = 'dev' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '개발';
UPDATE nodes SET cat_key = 'work' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '업무·도구';
UPDATE nodes SET cat_key = 'news' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '뉴스';
UPDATE nodes SET cat_key = 'shopping' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '쇼핑';
UPDATE nodes SET cat_key = 'media' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '영상·음악';
UPDATE nodes SET cat_key = 'social' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '소셜';
UPDATE nodes SET cat_key = 'learning' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '학습·참고';
UPDATE nodes SET cat_key = 'finance' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '금융';
UPDATE nodes SET cat_key = 'travel' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '여행·지도';
UPDATE nodes SET cat_key = 'inbox' WHERE kind = 'folder' AND parent_id IS NULL AND deleted = 0 AND title = '미분류';
INSERT INTO settings (key, value) SELECT 'locale', 'ko' WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'seeded');

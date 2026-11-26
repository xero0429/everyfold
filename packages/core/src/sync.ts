/**
 * 동기화 프로토콜 — 서버와 확장(및 이후 모바일)이 공유하는 타입과 충돌 규칙.
 *
 * 모델
 * - 서버가 진실. 모든 변경은 서버의 단조 증가 revision(rev) 을 하나씩 받는다.
 * - 노드 = 폴더(=카테고리) 또는 북마크. parentId=null 은 Everyfold 루트.
 * - 삭제는 tombstone(deleted=true) 으로 남겨 pull 하는 기기가 알 수 있게 한다.
 * - pull 은 상태 기반: since 이후 rev 가 바뀐 노드의 "현재 상태" 를 돌려준다(ops 재생이 아니다).
 * - push 는 ops 묶음(batch). 기기는 각 op 에 자기가 마지막으로 본 노드 rev(baseRev) 를 붙인다.
 * - 기기별 browserNodeId ↔ serverId 매핑은 기기가 보관하고, 서버에도 사본을 둔다(재설치 복구용).
 */
export type NodeKind = 'folder' | 'bookmark';

export interface ServerNode {
  id: string;
  kind: NodeKind;
  parentId: string | null;
  title: string;
  url: string | null;
  position: number;
  deleted: boolean;
  rev: number;
  updatedAt: number;
  /** 서버가 정한 폴더 안정 키(기본 카테고리 키·세션 폴더 'sessions'). 사용자 폴더·북마크엔 없다. API 2 부터 */
  key?: string;
}

/** op 가 가리키는 부모: 이미 서버에 있는 노드거나, 같은 batch 안에서 먼저 만든 노드(clientRef). */
export type NodeRef = { serverId: string } | { clientRef: string };

export type SyncOp =
  | {
      op: 'create';
      clientRef: string; // 보통 browserNodeId
      kind: NodeKind;
      parent: NodeRef | null;
      title: string;
      url?: string;
      position?: number;
      /** parent=null 인 북마크를 서버가 분류해 카테고리 폴더에 넣는다(브라우저 다른 곳에서 새로 만든 북마크 수집용) */
      autoCategorize?: boolean;
      /** 예약 폴더 만들기(API 2): 'sessions' = 세션 폴더. parent=null 폴더만. 이미 있으면 그 폴더로 merged */
      key?: string;
    }
  | { op: 'update'; id: string; baseRev: number; title?: string; url?: string }
  | { op: 'move'; id: string; baseRev: number; parent: NodeRef | null; position?: number }
  | { op: 'delete'; id: string; baseRev: number };

export interface PushRequest {
  ops: SyncOp[];
  /** 대량 삭제 차단을 사용자가 확인한 뒤 다시 보낼 때 true */
  confirmMassDelete?: boolean;
  /** pull 로 만든 브라우저 노드의 매핑 보고(서버 사본 갱신용) */
  mappings?: Mapping[];
}

export interface Mapping {
  browserId: string;
  serverId: string;
}

export type OpStatus = 'applied' | 'merged' | 'conflict' | 'noop' | 'rejected';

export interface OpResult {
  index: number;
  status: OpStatus;
  serverId?: string;
  reason?: string;
  /** conflict 일 때 서버가 이긴 필드 */
  serverWon?: string[];
  /** 이 op 적용 후 노드 rev (기기가 다음 baseRev 로 쓴다) */
  rev?: number;
  /** merged(이미 있던 노드에 합침) 이면 서버 노드의 현재 상태 — 기기는 제목·위치를 이것으로 맞춘다 */
  node?: ServerNode;
}

export interface PushResponse {
  rev: number;
  batchId: string | null;
  results: OpResult[];
  mappings: Array<{ clientRef: string; serverId: string }>;
}

export interface PullResponse {
  rev: number;
  nodes: ServerNode[];
}

export interface MassDeleteError {
  error: 'mass_delete';
  deletes: number;
  liveBookmarks: number;
  ratio: number;
  threshold: number;
}

/** 대량 삭제 기준 — 살아 있는 북마크의 20% 이상을 한 번에 지우려 하면 멈춘다(작은 컬렉션 오탐 방지로 최소 5개). */
export const MASS_DELETE_RATIO = 0.2;
export const MASS_DELETE_MIN = 5;

export function isMassDelete(deletes: number, liveBookmarks: number): boolean {
  if (deletes < MASS_DELETE_MIN) return false;
  if (liveBookmarks <= 0) return false;
  return deletes / liveBookmarks >= MASS_DELETE_RATIO;
}

/**
 * 충돌 결정 규칙 (서버가 이 함수로 판정한다)
 *
 * 기기가 본 baseRev 이후에 서버 쪽에서 같은 노드가 바뀌었으면 "동시 수정" 이다.
 * - update/move: 필드 단위 병합. baseRev 이후 서버가 바꾼 필드는 서버가 이긴다(기록 남김),
 *   서버가 안 건드린 필드는 기기 값을 적용한다. 그래서 A 가 제목, B 가 위치를 바꾸면 둘 다 산다.
 * - delete vs 서버의 더 새 수정: 삭제하지 않는다(수정한 쪽 보호). 충돌 기록.
 * - 이미 삭제된(tombstone) 노드에 대한 update/move: 무시하고 충돌 기록. 되살리려면 변경 기록 되돌리기.
 * - create: 같은 정규화 URL 의 살아 있는 북마크가 있으면 새로 만들지 않고 그 노드로 매핑(merged).
 * 버려진 쪽 값은 conflicts 표에 남으므로 언제든 복구 가능하다.
 */
export type Field = 'title' | 'url' | 'parentId' | 'position';

export interface ConflictDecision {
  apply: Partial<Record<Field, unknown>>;
  serverWon: Field[];
  conflict: boolean;
}

export function decideFieldMerge(
  wanted: Partial<Record<Field, unknown>>,
  serverChangedSinceBase: ReadonlySet<Field>,
): ConflictDecision {
  const apply: Partial<Record<Field, unknown>> = {};
  const serverWon: Field[] = [];
  for (const [k, v] of Object.entries(wanted) as Array<[Field, unknown]>) {
    if (v === undefined) continue;
    if (serverChangedSinceBase.has(k)) serverWon.push(k);
    else apply[k] = v;
  }
  return { apply, serverWon, conflict: serverWon.length > 0 };
}

export type DeleteDecision = 'delete' | 'keep-conflict' | 'noop';

export function decideDelete(node: { deleted: boolean; rev: number }, baseRev: number): DeleteDecision {
  if (node.deleted) return 'noop';
  if (node.rev > baseRev) return 'keep-conflict';
  return 'delete';
}

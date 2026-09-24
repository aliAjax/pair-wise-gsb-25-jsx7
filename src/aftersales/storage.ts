// 保存层：localStorage 仓库。所有写入都基于判定层的规则，这里只负责落盘和状态变更。

import {
  aggregateParts,
  canMove,
  evaluateCase,
  latest,
} from "./rules";
import type {
  AdjustCase,
  CaseVersion,
  Database,
  DraftPatch,
  PartStock,
} from "./types";

const STORAGE_KEY = "hxwl11-aftersales-v1";

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(db: Database): Database {
  return structuredClone(db);
}

function commit(db: Database): Database {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  return db;
}

function caseRef(db: Database, id: string): { db: Database; c: AdjustCase; v: CaseVersion } {
  const c = db.cases.find((x) => x.id === id);
  if (!c) throw new Error(`找不到案件 ${id}`);
  return { db, c, v: latest(c) };
}

function assertMove(v: CaseVersion, to: CaseVersion["status"]) {
  if (!canMove(v.status, to)) {
    throw new Error(`案件当前为「${v.status}」，不能转为「${to}」`);
  }
}

/** 按配件台账同步名称与牌价，汇总同编号配件。 */
function normalizeParts(db: Database, patch: DraftPatch): CaseVersion["parts"] {
  return aggregateParts(patch.parts).map((p) => {
    const s = db.stocks.find((x) => x.code === p.partCode);
    return s ? { ...p, partName: s.name, unitPrice: s.unitPrice } : p;
  });
}

function nextCaseId(db: Database): string {
  db.seq += 1;
  const now = new Date();
  const ym = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, "0");
  return `AS${ym}-${String(db.seq).padStart(2, "0")}`;
}

/** 建案：顾客代号、镜架编号、购买日三要素齐全才立案。 */
export function createCase(
  db: Database,
  base: { customerCode: string; frameCode: string; purchaseDate: string },
): { db: Database; id: string } {
  if (!base.customerCode.trim() || !base.frameCode.trim() || !base.purchaseDate.trim()) {
    throw new Error("请先填写顾客代号、镜架编号和购买日");
  }
  const next = clone(db);
  const id = nextCaseId(next);
  const version: CaseVersion = {
    version: 1,
    status: "待处理",
    faults: [],
    parts: [],
    slot: null,
    blockReasons: ["新案待登记：请填写故障、配件需求并安排调整位时段"],
    feeItems: [],
    materialFee: 0,
    createdAt: new Date().toISOString(),
  };
  next.cases.unshift({
    id,
    customerCode: base.customerCode.trim(),
    frameCode: base.frameCode.trim(),
    purchaseDate: base.purchaseDate,
    versions: [version],
    createdAt: new Date().toISOString(),
  });
  return { db: commit(next), id };
}

/** 待处理版本登记故障 / 配件 / 时段，重新判定并把卡点原因写回。 */
export function saveDraft(db: Database, id: string, patch: DraftPatch): Database {
  const next = clone(db);
  const { c, v } = caseRef(next, id);
  if (v.status !== "待处理") throw new Error("只有待处理的案件可以编辑登记");
  v.faults = patch.faults.map((f) => ({ ...f }));
  v.parts = normalizeParts(next, patch);
  v.slot = patch.slot ? { ...patch.slot } : null;
  const result = evaluateCase(c, { faults: v.faults, parts: v.parts, slot: v.slot }, next);
  v.blockReasons = result.blockReasons;
  return commit(next);
}

/** 提交排期判定：撞档或缺料留待处理；条件满足转待确认，保修期外快照材料费。 */
export function submitCase(db: Database, id: string): Database {
  const next = clone(db);
  const { c, v } = caseRef(next, id);
  if (v.status !== "待处理") throw new Error("只有待处理的案件可以提交判定");
  const result = evaluateCase(c, { faults: v.faults, parts: v.parts, slot: v.slot }, next);
  v.blockReasons = result.blockReasons;
  if (!result.canConfirm) {
    // 留在待处理，原因已写回，页面提示即可
    return commit(next);
  }
  assertMove(v, "待确认");
  v.status = "待确认";
  v.feeItems = result.feeItems;
  v.materialFee = result.materialFee;
  v.submittedAt = new Date().toISOString();
  v.blockReasons = result.blockReasons; // 保修期外的提示仍展示给顾客看
  return commit(next);
}

/** 顾客点头确认：故障、配件、费用锁定，同时预留扣减备件。 */
export function confirmCase(db: Database, id: string): Database {
  const next = clone(db);
  const { v } = caseRef(next, id);
  if (v.status !== "待确认") throw new Error("只有待顾客确认的案件可以确认锁定");
  // 提交后库存可能被别的案件挤占，确认前再核一次
  for (const need of aggregateParts(v.parts)) {
    const held = heldByOthers(next, id, need.partCode);
    const onHand = next.stocks.find((s) => s.code === need.partCode)?.stock ?? 0;
    if (need.qty > Math.max(0, onHand - held)) {
      throw new Error(`备件已被其他案件占用：${need.partName}，请退回待处理重新排期`);
    }
  }
  assertMove(v, "已锁定");
  for (const need of aggregateParts(v.parts)) {
    const s = next.stocks.find((x) => x.code === need.partCode);
    if (s) s.stock = Math.max(0, s.stock - need.qty);
  }
  v.status = "已锁定";
  v.confirmedAt = new Date().toISOString();
  return commit(next);
}

function heldByOthers(db: Database, id: string, code: string): number {
  let held = 0;
  for (const c of db.cases) {
    if (c.id === id) continue;
    const v = latest(c);
    if (v.status !== "已锁定" && v.status !== "返修中") continue;
    held += v.parts.filter((p) => p.partCode === code).reduce((sum, p) => sum + p.qty, 0);
  }
  return held;
}

export function startRepair(db: Database, id: string): Database {
  const next = clone(db);
  const { v } = caseRef(next, id);
  assertMove(v, "返修中");
  v.status = "返修中";
  v.startedAt = new Date().toISOString();
  return commit(next);
}

export function completeRepair(db: Database, id: string): Database {
  const next = clone(db);
  const { v } = caseRef(next, id);
  assertMove(v, "已完成");
  v.status = "已完成";
  v.finishedAt = new Date().toISOString();
  return commit(next);
}

/** 顾客不认可费用或方案：退回待处理，清空待确认费用，改完再提交。 */
export function sendBack(db: Database, id: string): Database {
  const next = clone(db);
  const { v } = caseRef(next, id);
  assertMove(v, "待处理");
  v.status = "待处理";
  v.feeItems = [];
  v.materialFee = 0;
  v.submittedAt = undefined;
  v.blockReasons = ["顾客未确认，方案退回待处理"];
  return commit(next);
}

/**
 * 返工重开：已完成的案件不能改旧档，按当前故障/配件复制出新版本，
 * 记录返工原因；旧版本原样保留可查。
 */
export function reopenCase(db: Database, id: string, reason: string): Database {
  if (!reason.trim()) throw new Error("请填写返工重开原因");
  const next = clone(db);
  const { c, v } = caseRef(next, id);
  if (v.status !== "已完成") throw new Error("只有已完成交付的案件可以返工重开");
  const reopened: CaseVersion = {
    version: v.version + 1,
    status: "待处理",
    reopenedReason: reason.trim(),
    faults: v.faults.map((f) => ({ ...f })),
    parts: v.parts.map((p) => ({ ...p, id: uid("part") })),
    slot: null, // 旧时段已过，重新安排调整位
    blockReasons: [`返工重开（v${v.version}）：${reason.trim()}，请重新安排时段并核对配件`],
    feeItems: [],
    materialFee: 0,
    createdAt: new Date().toISOString(),
  };
  c.versions.push(reopened);
  return commit(next);
}

export function restock(db: Database, code: string, qty: number): Database {
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("入库数量需为正数");
  const next = clone(db);
  const s = next.stocks.find((x) => x.code === code);
  if (!s) throw new Error(`配件台账中没有 ${code}`);
  s.stock += Math.floor(qty);
  return commit(next);
}

// ---------- 种子数据 ----------

const INITIAL_STOCKS: PartStock[] = [
  { code: "BT-S", name: "硅胶鼻托（成对）", stock: 4, unitPrice: 15 },
  { code: "TP-T", name: "镜腿胶套（成对）", stock: 2, unitPrice: 10 },
  { code: "HG-W", name: "焊接焊丝小包", stock: 3, unitPrice: 25 },
  { code: "SCR-H", name: "铰链螺丝", stock: 20, unitPrice: 2 },
];

function emptyDb(): Database {
  return { cases: [], stocks: INITIAL_STOCKS.map((s) => ({ ...s })), seq: 0 };
}

/** 首次使用时的演示档案：覆盖缺料+撞档待处理、保修内返修中、保修外焊接返修返工。 */
function seed(): Database {
  let db = emptyDb();

  // 案件三：保修内镜腿变形，已开修，占着 2026-09-25 上午 1号调整位和一副胶套
  let r = createCase(db, { customerCode: "C-0517", frameCode: "F-2106", purchaseDate: "2026-06-02" });
  db = r.db;
  db = saveDraft(db, r.id, {
    faults: [{ id: uid("f"), kind: "镜腿变形", note: "左镜腿外张角偏大，佩戴下滑" }],
    parts: [{ id: uid("p"), partCode: "TP-T", partName: "镜腿胶套（成对）", qty: 1, unitPrice: 10 }],
    slot: { station: "1号调整位", date: "2026-09-25", period: "上午" },
  });
  db = submitCase(db, r.id);
  db = confirmCase(db, r.id);
  db = startRepair(db, r.id);

  // 案件二：鼻托松脱，顾客已确认待修，4 副鼻托把现货占满
  r = createCase(db, { customerCode: "C-0932", frameCode: "F-3388", purchaseDate: "2026-07-21" });
  db = r.db;
  db = saveDraft(db, r.id, {
    faults: [{ id: uid("f"), kind: "鼻托松脱", note: "右侧鼻托螺丝位松动，托叶晃" }],
    parts: [{ id: uid("p"), partCode: "BT-S", partName: "硅胶鼻托（成对）", qty: 4, unitPrice: 15 }],
    slot: { station: "1号调整位", date: "2026-09-26", period: "下午" },
  });
  db = submitCase(db, r.id);
  db = confirmCase(db, r.id);

  // 案件一：鼻托松脱登记后撞档（案件三的时段）且缺鼻托现货 → 留待处理
  r = createCase(db, { customerCode: "C-1024", frameCode: "F-3301", purchaseDate: "2026-08-02" });
  db = r.db;
  db = saveDraft(db, r.id, {
    faults: [{ id: uid("f"), kind: "鼻托松脱", note: "鼻托整体松脱，需要更换" }],
    parts: [{ id: uid("p"), partCode: "BT-S", partName: "硅胶鼻托（成对）", qty: 1, unitPrice: 15 }],
    slot: { station: "1号调整位", date: "2026-09-25", period: "上午" },
  });
  db = submitCase(db, r.id);

  // 案件四：保修外焊接返修，首版已修完交付，顾客一周后反馈再次松脱，返工重开 v2 已确认
  r = createCase(db, { customerCode: "C-0815", frameCode: "F-2108", purchaseDate: "2025-03-10" });
  db = r.db;
  db = saveDraft(db, r.id, {
    faults: [{ id: uid("f"), kind: "焊接返修", note: "右桩头焊接点开焊" }],
    parts: [{ id: uid("p"), partCode: "HG-W", partName: "焊接焊丝小包", qty: 1, unitPrice: 25 }],
    slot: { station: "2号调整位", date: "2026-09-22", period: "上午" },
  });
  db = submitCase(db, r.id);
  db = confirmCase(db, r.id);
  db = startRepair(db, r.id);
  db = completeRepair(db, r.id);
  db = reopenCase(db, r.id, "焊接点交付一周后再次松脱，顾客要求返工");
  db = saveDraft(db, r.id, {
    faults: [{ id: uid("f"), kind: "焊接返修", note: "同一焊点复开，重新补焊并加固" }],
    parts: [{ id: uid("p"), partCode: "HG-W", partName: "焊接焊丝小包", qty: 1, unitPrice: 25 }],
    slot: { station: "2号调整位", date: "2026-09-27", period: "上午" },
  });
  db = submitCase(db, r.id);
  db = confirmCase(db, r.id);

  return db;
}

export function loadDb(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Database;
      if (parsed && Array.isArray(parsed.cases) && Array.isArray(parsed.stocks)) return parsed;
    }
  } catch {
    // 存储损坏时重新播种
  }
  return commit(seed());
}

export function resetDb(): Database {
  return commit(seed());
}

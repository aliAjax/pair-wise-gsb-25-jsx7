// 判定层：纯规则，不读写存储、不碰 DOM。
// 保修判定、调整位撞档、备件占用、材料费、状态流转、确认锁定与返工重开都在这里。

import type {
  AdjustCase,
  AdjustSlot,
  CaseStatus,
  CaseVersion,
  Database,
  FeeItem,
  FaultEntry,
  FaultKind,
  PartDemand,
  PartStock,
} from "./types";

export const WARRANTY_MONTHS = 12;
export const STATIONS = ["1号调整位", "2号调整位"] as const;
export const PERIODS = ["上午", "下午"] as const;
export const FAULT_KINDS: FaultKind[] = ["鼻托松脱", "镜腿变形", "焊接返修"];

export function todayISO(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** 购买日 + N 月保修，返回保修截止日。购买日非法时返回 null。 */
export function warrantyUntil(purchaseDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(purchaseDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  date.setMonth(date.getMonth() + WARRANTY_MONTHS);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function isUnderWarranty(purchaseDate: string, onDate: string = todayISO()): boolean {
  const until = warrantyUntil(purchaseDate);
  return until !== null && onDate <= until;
}

export function slotKey(slot: AdjustSlot): string {
  return `${slot.date}|${slot.period}|${slot.station}`;
}

export function slotLabel(slot: AdjustSlot): string {
  return `${slot.date} ${slot.period} · ${slot.station}`;
}

/** 占用调整位的状态：待处理占位、已锁定待修、返修中都算占着位。 */
const SLOT_HOLDERS: CaseStatus[] = ["待处理", "已锁定", "返修中"];

/** 按编号汇总同一配件的需求数量。 */
export function aggregateParts(parts: PartDemand[]): PartDemand[] {
  const map = new Map<string, PartDemand>();
  for (const p of parts) {
    if (!p.partCode) continue;
    const qty = Number.isFinite(p.qty) ? p.qty : 0;
    const prev = map.get(p.partCode);
    if (prev) prev.qty += qty;
    else map.set(p.partCode, { ...p, qty });
  }
  return [...map.values()].filter((p) => p.qty > 0);
}

/**
 * 某案件当前可用备件数量：
 * 已锁定 / 返修中 的需求视为已预留占用；待处理的缺口还不算库存占用。
 * caseId 为空（新建草稿预览）时，不排除任何案件。
 */
export function availableFor(caseId: string, code: string, db: Database): number {
  const part = db.stocks.find((s) => s.code === code);
  const onHand = part ? part.stock : 0;
  let held = 0;
  for (const c of db.cases) {
    if (caseId && c.id === caseId) continue;
    const v = latest(c);
    if (v.status !== "已锁定" && v.status !== "返修中") continue;
    held += v.parts.filter((p) => p.partCode === code).reduce((sum, p) => sum + p.qty, 0);
  }
  return Math.max(0, onHand - held);
}

/** 某时段的占用案件（待处理占位也算，避免同一时段被重复登记）。 */
export function slotOccupants(slot: AdjustSlot | null, db: Database): AdjustCase[] {
  if (!slot) return [];
  const key = slotKey(slot);
  const out: AdjustCase[] = [];
  for (const c of db.cases) {
    const v = latest(c);
    if (v.slot && SLOT_HOLDERS.includes(v.status) && slotKey(v.slot) === key) out.push(c);
  }
  return out;
}

export interface CaseEvaluation {
  underWarranty: boolean | null; // null = 购买日无法判定
  blockReasons: string[];
  feeItems: FeeItem[];
  materialFee: number;
  canConfirm: boolean;
}

export interface EvaluateInput {
  purchaseDate: string;
  faults: FaultEntry[];
  parts: PartDemand[];
  slot: AdjustSlot | null;
}

/**
 * 统一判定：
 * 资料不全 / 撞档 / 缺料 → 留待处理并给出原因；
 * 条件满足 → 可进入待确认；保修期外按配件台账最新牌价列明材料费。
 */
export function evaluateCase(
  base: { id: string; customerCode: string; frameCode: string; purchaseDate: string },
  draft: { faults: FaultEntry[]; parts: PartDemand[]; slot: AdjustSlot | null },
  db: Database,
): CaseEvaluation {
  const blockReasons: string[] = [];
  const validDate = warrantyUntil(base.purchaseDate) !== null;
  const underWarranty = validDate ? isUnderWarranty(base.purchaseDate) : null;

  if (!base.customerCode.trim() || !base.frameCode.trim() || !validDate) {
    blockReasons.push("顾客代号、镜架编号、购买日需填写完整且日期有效");
  }
  if (draft.faults.length === 0) blockReasons.push("至少登记一项故障");

  if (!draft.slot) {
    blockReasons.push("尚未安排调整位时段");
  } else {
    const clash = slotOccupants(draft.slot, db).filter((c) => c.id !== base.id);
    if (clash.length > 0) {
      blockReasons.push(`调整位撞档：${slotLabel(draft.slot)} 已被 ${clash.map((c) => c.id).join("、")} 占用`);
    }
  }

  const feeItems: FeeItem[] = [];
  for (const need of aggregateParts(draft.parts)) {
    const stockPart = db.stocks.find((s) => s.code === need.partCode);
    const available = availableFor(base.id, need.partCode, db);
    if (!stockPart) {
      blockReasons.push(`备件 ${need.partName || need.partCode}（${need.partCode}）不在配件台账中`);
      continue;
    }
    if (need.qty > available) {
      blockReasons.push(`备件不足：${stockPart.name} 需 ${need.qty}，可用 ${available}`);
    }
    if (underWarranty === false) {
      feeItems.push({
        partCode: stockPart.code,
        partName: stockPart.name,
        qty: need.qty,
        unitPrice: stockPart.unitPrice,
        amount: stockPart.unitPrice * need.qty,
      });
    }
  }
  const materialFee = feeItems.reduce((sum, f) => sum + f.amount, 0);
  if (underWarranty === false) {
    blockReasons.push(
      materialFee > 0
        ? `超出保修范围：材料费 ¥${materialFee}，需顾客确认`
        : "超出保修范围：本次无材料费，仍需顾客确认",
    );
  }

  const hardBlocks = blockReasons.filter((r) => !r.startsWith("超出保修范围"));
  return {
    underWarranty,
    blockReasons,
    feeItems: feeItems.sort((a, b) => a.partCode.localeCompare(b.partCode)),
    materialFee,
    canConfirm: hardBlocks.length === 0,
  };
}

/** 允许的状态流转。 */
const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  待处理: ["待确认"],
  待确认: ["已锁定", "待处理"], // 顾客不认可 → 退回待处理改方案
  已锁定: ["返修中"],
  返修中: ["已完成"],
  已完成: [], // 只能返工重开新版本
};

export function canMove(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isLockedVersion(v: CaseVersion): boolean {
  return v.status === "已锁定" || v.status === "返修中" || v.status === "已完成";
}

export function latest(c: AdjustCase): CaseVersion {
  return c.versions[c.versions.length - 1];
}

export function findCaseById(db: Database, id: string): AdjustCase | undefined {
  return db.cases.find((c) => c.id === id);
}

export function feeTotal(items: FeeItem[]): number {
  return items.reduce((sum, f) => sum + f.amount, 0);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type { PartStock };

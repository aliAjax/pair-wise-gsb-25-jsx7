// 判定层：售后调整台的业务规则，全部为纯函数。
// 不读写 localStorage、不引用 React，只做"该怎么判定"。

import { WARRANTY_FEE_NAME, WARRANTY_MONTHS } from "./catalog";
import type {
  AfterSalesCase,
  CaseStatus,
  CaseVersion,
  FeeItem,
  Part,
  Slot,
} from "./types";

// ---------- 日期与保修 ----------

/** 把 YYYY-MM-DD 解析为 UTC 零点的 Date，避免时区误差 */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 购买日起 WARRANTY_MONTHS 个月内视为保修范围 */
export function isWithinWarranty(purchaseDate: string, today = new Date()): boolean {
  const purchase = parseDateKey(purchaseDate);
  const limit = new Date(Date.UTC(
    purchase.getUTCFullYear(),
    purchase.getUTCMonth() + WARRANTY_MONTHS,
    purchase.getUTCDate(),
  ));
  const nowUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return nowUtc < limit.getTime();
}

/** 已购买天数（用于页面展示） */
export function ownedDays(purchaseDate: string, today = new Date()): number {
  const purchase = parseDateKey(purchaseDate);
  const nowUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((nowUtc - purchase.getTime()) / 86400000);
}

// ---------- 调整位时段 ----------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 同一工位、同一天、时间区间相交（端点相接不算撞档） */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  if (a.stationId !== b.stationId || a.date !== b.date) return false;
  const as = toMinutes(a.start);
  const ae = toMinutes(a.end);
  const bs = toMinutes(b.start);
  const be = toMinutes(b.end);
  return as < be && bs < ae;
}

/**
 * 检查期望时段是否与"占用工位"的案件撞档。
 * 待处理案件不占工位；excludeId 用于编辑时排除自身。
 */
export function findClash(
  want: Slot,
  cases: AfterSalesCase[],
  excludeId?: string,
): AfterSalesCase | undefined {
  const occupying: CaseStatus[] = ["QUOTED", "CONFIRMED"];
  return cases.find(
    (c) =>
      c.id !== excludeId &&
      occupying.includes(c.status) &&
      slotsOverlap(want, c.slot),
  );
}

// ---------- 备件 ----------

export interface PartShortage {
  partId: string;
  partName: string;
  need: number;
  stock: number;
}

/** 找出库存不足的配件需求（按现有库存或指定库存计算） */
export function findShortages(
  needs: { partId: string; qty: number }[],
  parts: Part[],
): PartShortage[] {
  const result: PartShortage[] = [];
  for (const need of needs) {
    const part = parts.find((p) => p.id === need.partId);
    const stock = part?.stock ?? 0;
    if (need.qty > stock) {
      result.push({
        partId: need.partId,
        partName: part?.name ?? need.partId,
        need: need.qty,
        stock,
      });
    }
  }
  return result;
}

// ---------- 材料费 ----------

/**
 * 列明材料费：
 * - 保内：全免，费用为空；
 * - 保外：按配件数量 × 单价列明材料费总额，供顾客确认。
 */
export function quoteFees(
  warrantyCovered: boolean,
  needs: { partId: string; qty: number }[],
  parts: Part[],
): { fees: FeeItem[]; materialFee: number } {
  if (warrantyCovered || needs.length === 0) {
    return { fees: [], materialFee: 0 };
  }
  const materialFee = needs.reduce((sum, need) => {
    const part = parts.find((p) => p.id === need.partId);
    return sum + (part ? part.price * need.qty : 0);
  }, 0);
  return materialFee > 0
    ? { fees: [{ name: WARRANTY_FEE_NAME, amount: materialFee }], materialFee }
    : { fees: [], materialFee: 0 };
}

// ---------- 建案/重审判定 ----------

export interface IntakeInput {
  customerCode: string;
  frameCode: string;
  purchaseDate: string;
  faults: AfterSalesCase["faults"];
  parts: AfterSalesCase["parts"];
  slot: Slot;
}

export type IntakeDecision =
  | {
      kind: "PENDING";
      reason: string;
      warrantyCovered: boolean;
      fees: FeeItem[];
      materialFee: number;
    }
  | {
      kind: "QUOTED";
      warrantyCovered: boolean;
      fees: FeeItem[];
      materialFee: number;
    };

/**
 * 建案/调整后重新判定：
 * 1. 调整位撞档 → 待处理
 * 2. 备件不足 → 待处理
 * 3. 否则排班成功：保内可直接确认返修；保外先列明材料费，等顾客点头。
 */
export function evaluateIntake(
  input: IntakeInput,
  cases: AfterSalesCase[],
  parts: Part[],
  excludeCaseId?: string,
): IntakeDecision {
  const warrantyCovered = isWithinWarranty(input.purchaseDate);
  const quote = quoteFees(warrantyCovered, input.parts, parts);

  const clash = findClash(input.slot, cases, excludeCaseId);
  if (clash) {
    const when = `${clash.slot.date} ${clash.slot}-${clash.slot.end}`;
    return {
      kind: "PENDING",
      reason: `调整位撞档：与案件 ${clash.id}（${when}）时段冲突`,
      warrantyCovered,
      ...quote,
    };
  }

  const shortages = findShortages(input.parts, parts);
  if (shortages.length > 0) {
    const detail = shortages
      .map((s) => `${s.partName} 需求 ${s.need}，库存 ${s.stock}`)
      .join("；");
    return {
      kind: "PENDING",
      reason: `备件不足：${detail}`,
      warrantyCovered,
      ...quote,
    };
  }

  return { kind: "QUOTED", warrantyCovered, ...quote };
}

// ---------- 确认返修 / 完成 / 返工重开 ----------

/** 仅 QUOTED 可确认；保外案件必须有顾客点头（customerApproved） */
export function canConfirm(c: AfterSalesCase): boolean {
  if (c.status !== "QUOTED") return false;
  if (!c.warrantyCovered && c.materialFee > 0) return false; // 需要顾客确认标记
  return true;
}

export function confirmError(c: AfterSalesCase, approved: boolean): string | null {
  if (c.status !== "QUOTED") return "当前状态不能确认返修";
  if (!c.warrantyCovered && c.materialFee > 0 && !approved) {
    return "超出保修范围，需顾客确认材料费后才能返修";
  }
  return null;
}

/**
 * 确认返修：锁定故障、配件、费用，生成（或追加）一个版本。
 * 配件库存由保存层据此扣减；本函数只算案件档案。
 */
export function lockVersion(
  c: AfterSalesCase,
  nowIso: string,
): AfterSalesCase {
  const version: CaseVersion = {
    version: c.currentVersion + 1,
    lockedAt: nowIso,
    status: "CONFIRMED",
    faults: c.faults.map((f) => ({ ...f })),
    parts: c.parts.map((p) => ({ ...p })),
    fees: c.fees.map((f) => ({ ...f })),
    warrantyCovered: c.warrantyCovered,
    materialFee: c.materialFee,
    reopenReason: c.reopenReason,
  };
  return {
    ...c,
    status: "CONFIRMED",
    currentVersion: version.version,
    versions: [...c.versions, version],
    pendingReason: undefined,
  };
}

/** 返修完成：把当前锁定版本标记为 DONE */
export function markDone(c: AfterSalesCase, nowIso: string, note: string): AfterSalesCase {
  if (c.status !== "CONFIRMED") return c;
  const versions = c.versions.map((v) =>
    v.version === c.currentVersion ? { ...v, status: "DONE" as const, finishNote: note } : v,
  );
  return { ...c, status: "DONE", versions, finishedAt: nowIso };
}

/**
 * 返工重开：只有已完成案件可以重开，必须填写返工原因。
 * 已锁定的版本原样保留（旧记录还能查），案件回到待重审状态，
 * 由页面调整登记内容后重新判定、重新锁定新版本。
 */
export function reopenCase(
  c: AfterSalesCase,
  reason: string,
): AfterSalesCase | { error: string } {
  if (c.status !== "DONE") return { error: "只有返修完成的案件可以返工重开" };
  if (!reason.trim()) return { error: "返工重开必须填写原因" };
  return {
    ...c,
    status: "QUOTED",
    reopenReason: reason.trim(),
    pendingReason: undefined,
    finishedAt: undefined,
  };
}

/** 确认返修后锁定字段：页面据此禁用编辑 */
export function isLocked(c: AfterSalesCase): boolean {
  return c.status === "CONFIRMED" || c.status === "DONE";
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  PENDING: "待处理",
  QUOTED: "待确认",
  CONFIRMED: "返修中",
  DONE: "已完成",
};

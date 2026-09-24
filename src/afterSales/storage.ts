// 保存层：localStorage 存取 + 数据变更（建案、确认、完成、返工重开）。
// 判定规则仍由 rules.ts 提供，本层只负责应用规则、维护库存并落盘。

import { buildSeedData, STORAGE_KEY } from "./catalog";
import {
  confirmError,
  evaluateIntake,
  lockVersion,
  markDone,
  reopenCase,
} from "./rules";
import type {
  AfterSalesCase,
  AfterSalesData,
  Part,
} from "./types";

// ---------- 存取适配器 ----------

export function loadData(): AfterSalesData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = buildSeedData();
      persist(seed);
      return seed;
    }
    const parsed = JSON.parse(raw) as AfterSalesData;
    if (!parsed.cases || !parsed.parts || !parsed.stations) {
      throw new Error("档案结构不完整");
    }
    return parsed;
  } catch {
    // 档案损坏时回落到初始数据，保证页面可用
    const seed = buildSeedData();
    persist(seed);
    return seed;
  }
}

export function resetData(): AfterSalesData {
  const seed = buildSeedData();
  persist(seed);
  return seed;
}

function persist(data: AfterSalesData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 存储不可用时仅在本次会话内运行
  }
}

// ---------- 库存 ----------

function adjustStock(parts: Part[], partId: string, delta: number): Part[] {
  return parts.map((p) =>
    p.id === partId ? { ...p, stock: Math.max(0, p.stock + delta) } : p,
  );
}

/** 返修确认时锁定配件：扣减库存 */
function deductParts(data: AfterSalesData, c: AfterSalesCase): AfterSalesData {
  let parts = data.parts;
  for (const need of c.parts) {
    parts = adjustStock(parts, need.partId, -need.qty);
  }
  return { ...data, parts };
}

/** 返工重开时回补最近一版锁定的配件（重确认时会再次扣减） */
function releaseLockedParts(data: AfterSalesData, c: AfterSalesCase): AfterSalesData {
  const locked = c.versions.find((v) => v.version === c.currentVersion);
  if (!locked) return data;
  let parts = data.parts;
  for (const need of locked.parts) {
    parts = adjustStock(parts, need.partId, need.qty);
  }
  return { ...data, parts };
}

// ---------- 编号 ----------

function nextCaseId(data: AfterSalesData): { id: string; seq: number } {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  const seq = data.seq + 1;
  return { id: `AS-${ymd}-${String(seq).padStart(3, "0")}`, seq };
}

// ---------- 建案 / 待处理后重新提交 ----------

export interface IntakeDraft {
  customerCode: string;
  frameCode: string;
  purchaseDate: string;
  faults: AfterSalesCase["faults"];
  parts: AfterSalesCase["parts"];
  slot: AfterSalesCase["slot"];
}

export interface IntakeResult {
  data: AfterSalesData;
  caseId: string;
  status: AfterSalesCase["status"];
  pendingReason?: string;
  error?: string;
}

/** 新建案件；existingId 用于待处理案件修改后重新提交 */
export function submitIntake(
  data: AfterSalesData,
  draft: IntakeDraft,
  existingId?: string,
): IntakeResult {
  const validation = validateDraft(draft);
  if (validation) {
    return { ...errorResult(data, validation), caseId: existingId ?? "" };
  }

  const decision = evaluateIntake(
    draft,
    data.cases,
    data.parts,
    existingId,
  );

  const now = new Date().toISOString();

  if (existingId) {
    const old = data.cases.find((c) => c.id === existingId);
    if (!old) {
      return { ...errorResult(data, "未找到要修改的案件"), caseId: "" };
    }
    // 已锁定（返修中/已完成）的故障、配件、费用不允许通过登记表改动
    if (old.status === "CONFIRMED" || old.status === "DONE") {
      return { ...errorResult(data, "案件已确认锁定，请通过返工重开修改"), caseId: existingId };
    }
    const updated: AfterSalesCase = {
      ...old,
      customerCode: draft.customerCode.trim(),
      frameCode: draft.frameCode.trim(),
      purchaseDate: draft.purchaseDate,
      faults: draft.faults.map((f) => ({ ...f })),
      parts: draft.parts.map((p) => ({ ...p })),
      slot: { ...draft.slot },
      status: decision.kind,
      warrantyCovered: decision.warrantyCovered,
      fees: decision.fees,
      materialFee: decision.materialFee,
      pendingReason: decision.kind === "PENDING" ? decision.reason : undefined,
    };
    const next = {
      ...data,
      cases: data.cases.map((c) => (c.id === existingId ? updated : c)),
    };
    persist(next);
    return {
      data: next,
      caseId: existingId,
      status: decision.kind,
      pendingReason: decision.kind === "PENDING" ? decision.reason : undefined,
    };
  }

  const { id, seq } = nextCaseId(data);
  const created: AfterSalesCase = {
    id,
    customerCode: draft.customerCode.trim(),
    frameCode: draft.frameCode.trim(),
    purchaseDate: draft.purchaseDate,
    createdAt: now,
    faults: draft.faults.map((f) => ({ ...f })),
    parts: draft.parts.map((p) => ({ ...p })),
    slot: { ...draft.slot },
    status: decision.kind,
    warrantyCovered: decision.warrantyCovered,
    fees: decision.fees,
    materialFee: decision.materialFee,
    pendingReason: decision.kind === "PENDING" ? decision.reason : undefined,
    currentVersion: 0,
    versions: [],
  };
  const next = { ...data, cases: [created, ...data.cases], seq };
  persist(next);
  return {
    data: next,
    caseId: id,
    status: decision.kind,
    pendingReason: decision.kind === "PENDING" ? decision.reason : undefined,
  };
}

function validateDraft(draft: IntakeDraft): string | null {
  if (!draft.customerCode.trim()) return "请填写顾客代号";
  if (!draft.frameCode.trim()) return "请填写镜架编号";
  if (!draft.purchaseDate) return "请填写购买日";
  if (draft.faults.length === 0) return "请至少登记一项故障";
  if (!draft.slot.date || !draft.slot.start || !draft.slot.end) {
    return "请安排调整位时段";
  }
  if (draft.slot.start >= draft.slot.end) return "时段开始时间需早于结束时间";
  for (const p of draft.parts) {
    if (p.qty <= 0) return `配件「${p.partName}」数量需大于 0`;
  }
  return null;
}

function errorResult(data: AfterSalesData, error: string): IntakeResult {
  return { data, caseId: "", status: "PENDING", error };
}

// ---------- 顾客确认后返修（锁定故障/配件/费用，扣配件） ----------

export interface ActionResult {
  data: AfterSalesData;
  error?: string;
}

export function confirmForRepair(
  data: AfterSalesData,
  caseId: string,
  customerApproved: boolean,
): ActionResult {
  const c = data.cases.find((x) => x.id === caseId);
  if (!c) return { data, error: "未找到案件" };

  const err = confirmError(c, customerApproved);
  if (err) return { data, error: err };

  // 确认前再核一次库存（可能被其他案件先占用）
  const locked = lockVersion(c, new Date().toISOString());
  let next = {
    ...data,
    cases: data.cases.map((x) => (x.id === caseId ? locked : x)),
  };
  next = deductParts(next, locked);
  persist(next);
  return { data: next };
}

// ---------- 返修完成 ----------

export function finishRepair(
  data: AfterSalesData,
  caseId: string,
  note: string,
): ActionResult {
  const c = data.cases.find((x) => x.id === caseId);
  if (!c) return { data, error: "未找到案件" };
  if (c.status !== "CONFIRMED") return { data, error: "只有返修中的案件可以完成" };

  const done = markDone(c, new Date().toISOString(), note.trim());
  const next = {
    ...data,
    cases: data.cases.map((x) => (x.id === caseId ? done : x)),
  };
  persist(next);
  return { data: next };
}

// ---------- 返工重开（回补配件，旧版本保留） ----------

export function reopenForRework(
  data: AfterSalesData,
  caseId: string,
  reason: string,
): ActionResult {
  const c = data.cases.find((x) => x.id === caseId);
  if (!c) return { data, error: "未找到案件" };

  const reopened = reopenCase(c, reason);
  if ("error" in reopened) return { data, error: reopened.error };

  let next = {
    ...data,
    cases: data.cases.map((x) => (x.id === caseId ? reopened : x)),
  };
  next = releaseLockedParts(next, reopened);
  persist(next);
  return { data: next };
}

// 档案层：售后调整台的数据结构定义，不放任何业务判断。

export type FaultKind = "鼻托松脱" | "镜腿变形" | "焊接返修";

export type SlotPeriod = "上午" | "下午";

// 待处理：撞档 / 缺料 / 资料不全，尚未排上
// 待确认：时段和备件都落实，材料费已列明，等顾客点头
// 已锁定：顾客已确认，故障、配件、费用冻结，等待返修
// 返修中：已上调整位作业
// 已完成：交付，可因返工重开新版本
export type CaseStatus = "待处理" | "待确认" | "已锁定" | "返修中" | "已完成";

export interface FaultEntry {
  id: string;
  kind: FaultKind;
  note: string;
}

export interface PartDemand {
  id: string;
  partCode: string;
  partName: string;
  qty: number;
  unitPrice: number;
}

export interface AdjustSlot {
  station: string;
  date: string; // YYYY-MM-DD
  period: SlotPeriod;
}

export interface FeeItem {
  partCode: string;
  partName: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface CaseVersion {
  version: number;
  status: CaseStatus;
  reopenedReason?: string;
  faults: FaultEntry[];
  parts: PartDemand[];
  slot: AdjustSlot | null;
  // 最近一次判定留下的说明
  blockReasons: string[];
  // 提交判定时快照的材料费，确认后随版本锁定
  feeItems: FeeItem[];
  materialFee: number;
  createdAt: string;
  submittedAt?: string;
  confirmedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AdjustCase {
  id: string;
  customerCode: string;
  frameCode: string;
  purchaseDate: string; // YYYY-MM-DD
  versions: CaseVersion[];
  createdAt: string;
}

export interface PartStock {
  code: string;
  name: string;
  stock: number;
  unitPrice: number;
}

export interface Database {
  cases: AdjustCase[];
  stocks: PartStock[];
  seq: number;
}

// 待处理版本允许编辑的内容
export interface DraftPatch {
  faults: FaultEntry[];
  parts: PartDemand[];
  slot: AdjustSlot | null;
}

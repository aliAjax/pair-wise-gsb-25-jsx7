// 档案层：售后调整台的领域档案与状态定义
// 只描述"数据是什么"，不写任何判定和存取逻辑。

/** 镜架售后常见故障类别（对应原先便签上的三类问题） */
export type FaultCode = "NOSEPAD_LOOSE" | "TEMPLE_DEFORMED" | "WELD_REPAIR";

/** 案件状态 */
export type CaseStatus =
  | "PENDING" // 待处理：调整位撞档 或 备件不足
  | "QUOTED" // 已排班待确认（超保修需顾客点头）
  | "CONFIRMED" // 已确认返修：故障、配件、费用锁定
  | "DONE"; // 返修完成（可返工重开）

/** 配件条目：某案件对某配件的需求 */
export interface PartNeed {
  partId: string;
  partName: string;
  qty: number;
}

/** 费用条目（超保修时列明材料费） */
export interface FeeItem {
  name: string;
  amount: number;
}

/** 调整位（工位） */
export interface Station {
  id: string;
  name: string;
}

/** 调整位时段 */
export interface Slot {
  stationId: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string; // HH:mm
}

/** 故障登记 */
export interface FaultEntry {
  code: FaultCode;
  note: string;
}

/**
 * 已锁定的历史版本。
 * 每次"确认返修"生成一个版本；返工重开后再确认会生成新版本，
 * 旧版本原样保留可查。
 */
export interface CaseVersion {
  version: number;
  lockedAt: string; // ISO 时间
  status: "CONFIRMED" | "DONE";
  faults: FaultEntry[];
  parts: PartNeed[];
  fees: FeeItem[];
  warrantyCovered: boolean;
  materialFee: number;
  /** 若该版本来自返工重开，记录上一版被重开的原因 */
  reopenReason?: string;
  /** 完成备注（DONE 时） */
  finishNote?: string;
}

/** 售后调整案件档案 */
export interface AfterSalesCase {
  id: string; // 案件编号，如 AS-20260924-001
  customerCode: string; // 顾客代号
  frameCode: string; // 镜架编号
  purchaseDate: string; // 购买日 YYYY-MM-DD
  createdAt: string;

  // 登记内容（未确认前可改）
  faults: FaultEntry[];
  parts: PartNeed[];
  slot: Slot; // 期望/已安排的调整位时段

  status: CaseStatus;
  warrantyCovered: boolean; // 本次判定是否在保修范围
  fees: FeeItem[]; // 已列明的材料费（保内为空）
  materialFee: number;

  // 待处理/重开时的说明
  pendingReason?: string;
  reopenReason?: string;

  currentVersion: number; // 当前已锁定版本号，0 表示从未确认
  versions: CaseVersion[]; // 历史版本（旧记录）
  finishedAt?: string;
}

/** 配件库存档案 */
export interface Part {
  id: string;
  name: string;
  unit: string;
  stock: number;
  /** 超保修时的材料单价（元） */
  price: number;
}

/** 保存层整体数据快照 */
export interface AfterSalesData {
  cases: AfterSalesCase[];
  parts: Part[];
  stations: Station[];
  seq: number;
}

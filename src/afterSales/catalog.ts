// 档案层：故障目录、保修政策、初始档案数据
// 目录与种子数据集中存放，页面和判定层都从这里取常量。

import type {
  AfterSalesData,
  FaultCode,
  AfterSalesCase,
  Part,
  Station,
} from "./types";

/** 故障类别目录（即原便签上的三类） */
export const FAULT_CATALOG: Record<
  FaultCode,
  { label: string; desc: string }
> = {
  NOSEPAD_LOOSE: {
    label: "鼻托松脱",
    desc: "鼻托松动或脱落，需更换鼻托/锁紧",
  },
  TEMPLE_DEFORMED: {
    label: "镜腿变形",
    desc: "镜腿外张、弯折或开合不顺",
  },
  WELD_REPAIR: {
    label: "焊接返修",
    desc: "焊点开裂或脱落，需重新焊接",
  },
};

export const FAULT_CODES: FaultCode[] = [
  "NOSEPAD_LOOSE",
  "TEMPLE_DEFORMED",
  "WELD_REPAIR",
];

/** 镜架保修政策：购买日起 12 个月 */
export const WARRANTY_MONTHS = 12;

/** 调整位时段粒度：每个时段 30 分钟 */
export const SLOT_STEP_MINUTES = 30;
export const WORK_START = "09:00";
export const WORK_END = "20:00";

/** 保内免材料费；保外的费用说明前缀 */
export const WARRANTY_FEE_NAME = "材料费（超出保修范围）";

export const STORAGE_KEY = "hxwl-11-aftersales-v1";

// ---- 初始配件库存 ----
const seedParts: Part[] = [
  { id: "P-NOSEPAD", name: "硅胶鼻托", unit: "对", stock: 6, price: 15 },
  { id: "P-SCREW", name: "鼻托螺丝", unit: "颗", stock: 20, price: 1 },
  { id: "P-TEMPLE-TIP", name: "镜腿胶套", unit: "对", stock: 4, price: 25 },
  { id: "P-HINGE", name: "铰链组件", unit: "个", stock: 2, price: 40 },
  { id: "P-WELD", name: "焊接耗材包", unit: "包", stock: 3, price: 60 },
];

// ---- 调整位 ----
const seedStations: Station[] = [
  { id: "S-01", name: "1号调整位" },
  { id: "S-02", name: "2号调整位" },
];

// ---- 示例案件 ----
// 今天/昨天的日期在首次加载时按当前日期生成，保证排班判定可演示。
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toDateKey(d);
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildSeedCases(): AfterSalesCase[] {
  const today = toDateKey(new Date());

  // 1) 保内、待处理：与 2 号调整位某个已排班案件撞档
  const slotClash = {
    stationId: "S-01",
    date: today,
    start: "14:00",
    end: "14:30",
  };

  // 2) 保内、待处理：鼻托库存不够
  // 3) 保外、待顾客确认材料费
  // 4) 已完成并返工重开过一次（演示版本历史）

  return [
    {
      id: "AS-DEMO-001",
      customerCode: "C-1023",
      frameCode: "F-TI-8801",
      purchaseDate: isoDaysAgo(80),
      createdAt: new Date().toISOString(),
      faults: [{ code: "TEMPLE_DEFORMED", note: "左腿外张，佩戴下滑" }],
      parts: [{ partId: "P-HINGE", partName: "铰链组件", qty: 1 }],
      slot: slotClash,
      status: "CONFIRMED",
      warrantyCovered: true,
      fees: [],
      materialFee: 0,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          lockedAt: new Date().toISOString(),
          status: "CONFIRMED",
          faults: [{ code: "TEMPLE_DEFORMED", note: "左腿外张，佩戴下滑" }],
          parts: [{ partId: "P-HINGE", partName: "铰链组件", qty: 1 }],
          fees: [],
          warrantyCovered: true,
          materialFee: 0,
        },
      ],
    },
    {
      id: "AS-DEMO-002",
      customerCode: "C-1058",
      frameCode: "F-TR-3320",
      purchaseDate: isoDaysAgo(30),
      createdAt: new Date().toISOString(),
      faults: [{ code: "NOSEPAD_LOOSE", note: "右侧鼻托整体脱落" }],
      parts: [{ partId: "P-NOSEPAD", partName: "硅胶鼻托", qty: 8 }],
      slot: { stationId: "S-02", date: today, start: "15:00", end: "15:30" },
      status: "PENDING",
      warrantyCovered: true,
      fees: [],
      materialFee: 0,
      pendingReason: "备件不足：硅胶鼻托 需求 8 对，库存 6 对",
      currentVersion: 0,
      versions: [],
    },
    {
      id: "AS-DEMO-003",
      customerCode: "C-0877",
      frameCode: "F-MT-5560",
      purchaseDate: isoDaysAgo(420),
      createdAt: new Date().toISOString(),
      faults: [{ code: "WELD_REPAIR", note: "中梁焊点开裂" }],
      parts: [{ partId: "P-WELD", partName: "焊接耗材包", qty: 1 }],
      slot: { stationId: "S-02", date: today, start: "16:30", end: "17:00" },
      status: "QUOTED",
      warrantyCovered: false,
      fees: [{ name: "材料费（超出保修范围）", amount: 60 }],
      materialFee: 60,
      pendingReason: undefined,
      currentVersion: 0,
      versions: [],
    },
  ];
}

export function buildSeedData(): AfterSalesData {
  return {
    cases: buildSeedCases(),
    parts: seedParts.map((p) => ({ ...p })),
    stations: seedStations.map((s) => ({ ...s })),
    seq: 3,
  };
}

import { useMemo, useState } from "react";
import {
  FAULT_KINDS,
  PERIODS,
  STATIONS,
  evaluateCase,
  slotLabel,
  slotOccupants,
  warrantyUntil,
} from "../rules";
import { uid } from "../storage";
import type {
  AdjustCase,
  AdjustSlot,
  Database,
  FaultEntry,
  FaultKind,
  PartDemand,
  SlotPeriod,
} from "../types";
import { StatusBadge, WarrantyTag } from "./CaseList";

interface CaseEditorProps {
  db: Database;
  record: AdjustCase;
  onSave: (patch: { faults: FaultEntry[]; parts: PartDemand[]; slot: AdjustSlot | null }) => void;
  onSubmit: (patch: { faults: FaultEntry[]; parts: PartDemand[]; slot: AdjustSlot | null }) => void;
}

type SlotDraft = { date: string; period: SlotPeriod; station: string };

export default function CaseEditor({ db, record, onSave, onSubmit }: CaseEditorProps) {
  const v = record.versions[record.versions.length - 1];

  const [faults, setFaults] = useState<FaultEntry[]>(v.faults.map((f) => ({ ...f })));
  const [parts, setParts] = useState<PartDemand[]>(v.parts.map((p) => ({ ...p })));
  const [slot, setSlot] = useState<SlotDraft>(
    v.slot
      ? { date: v.slot.date, period: v.slot.period, station: v.slot.station }
      : { date: "", period: "上午", station: STATIONS[0] },
  );

  const effectiveSlot: AdjustSlot | null = slot.date
    ? { date: slot.date, station: slot.station, period: slot.period }
    : null;

  const patch = useMemo(
    () => ({ faults, parts, slot: effectiveSlot }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faults, parts, slot],
  );

  // 实时判定：编辑时就能看到卡点、保修期与预计材料费
  const preview = useMemo(
    () =>
      evaluateCase(
        {
          id: record.id,
          customerCode: record.customerCode,
          frameCode: record.frameCode,
          purchaseDate: record.purchaseDate,
        },
        patch,
        db,
      ),
    [db, patch, record],
  );

  const occupants = effectiveSlot
    ? slotOccupants(effectiveSlot, db).filter((c) => c.id !== record.id)
    : [];

  const addFault = () =>
    setFaults((fs) => [...fs, { id: uid("f"), kind: FAULT_KINDS[0] as FaultKind, note: "" }]);
  const updateFault = (id: string, key: "kind" | "note", value: string) =>
    setFaults((fs) => fs.map((f) => (f.id === id ? { ...f, [key]: value } : f)));
  const removeFault = (id: string) => setFaults((fs) => fs.filter((f) => f.id !== id));

  const addPart = () => {
    const first = db.stocks[0];
    setParts((ps) => [
      ...ps,
      { id: uid("p"), partCode: first.code, partName: first.name, qty: 1, unitPrice: first.unitPrice },
    ]);
  };
  const updatePart = (id: string, key: "partCode" | "qty", value: string | number) => {
    setParts((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        if (key === "partCode") {
          const s = db.stocks.find((x) => x.code === value)!;
          return { ...p, partCode: s.code, partName: s.name, unitPrice: s.unitPrice };
        }
        return { ...p, qty: Math.max(0, Math.floor(Number(value) || 0)) };
      }),
    );
  };
  const removePart = (id: string) => setParts((ps) => ps.filter((p) => p.id !== id));

  return (
    <div className="case-editor">
      <div className="detail-head">
        <div>
          <h2>{record.id}</h2>
          <p className="detail-base">
            {record.customerCode} · 镜架 {record.frameCode} · 购买日 {record.purchaseDate}
            {v.reopenedReason ? ` · 返工第 ${v.version} 版` : ""}
          </p>
        </div>
        <StatusBadge status={v.status} />
      </div>
      <WarrantyTag purchaseDate={record.purchaseDate} />
      {v.reopenedReason && (
        <p className="banner warn">返工重开原因：{v.reopenedReason}（旧版本保留在下方历史中可查）</p>
      )}

      <section className="editor-block">
        <div className="block-title-row">
          <h3>故障登记</h3>
          <button onClick={addFault}>+ 添加故障</button>
        </div>
        {faults.length === 0 && <p className="empty-hint">还没有登记故障</p>}
        {faults.map((f) => (
          <div className="fault-row" key={f.id}>
            <select value={f.kind} onChange={(e) => updateFault(f.id, "kind", e.target.value)}>
              {FAULT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              value={f.note}
              placeholder="故障现象 / 位置 / 顾客描述"
              onChange={(e) => updateFault(f.id, "note", e.target.value)}
            />
            <button className="danger-btn" onClick={() => removeFault(f.id)}>
              删除
            </button>
          </div>
        ))}
      </section>

      <section className="editor-block">
        <div className="block-title-row">
          <h3>配件需求</h3>
          <button onClick={addPart}>+ 添加配件</button>
        </div>
        {parts.length === 0 && <p className="empty-hint">无需配件时可留空（如纯调校）</p>}
        {parts.map((p) => {
          const stock = db.stocks.find((s) => s.code === p.partCode);
          const othersHold = db.cases
            .filter((c) => c.id !== record.id)
            .reduce((sum, c) => {
              const cv = c.versions[c.versions.length - 1];
              if (cv.status !== "已锁定" && cv.status !== "返修中") return sum;
              return sum + cv.parts.filter((x) => x.partCode === p.partCode).reduce((s, x) => s + x.qty, 0);
            }, 0);
          const available = Math.max(0, (stock?.stock ?? 0) - othersHold);
          return (
            <div className="part-row" key={p.id}>
              <select value={p.partCode} onChange={(e) => updatePart(p.id, "partCode", e.target.value)}>
                {db.stocks.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name}（¥{s.unitPrice}）
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                value={p.qty}
                onChange={(e) => updatePart(p.id, "qty", e.target.value)}
              />
              <span className={"part-avail" + (available < p.qty ? " short" : "")}>
                可用 {available}
              </span>
              <button className="danger-btn" onClick={() => removePart(p.id)}>
                删除
              </button>
            </div>
          );
        })}
      </section>

      <section className="editor-block">
        <h3>调整位时段</h3>
        <div className="slot-row">
          <label>
            <span>日期</span>
            <input
              type="date"
              value={slot.date}
              onChange={(e) => setSlot((s) => ({ ...s, date: e.target.value }))}
            />
          </label>
          <label>
            <span>时段</span>
            <select
              value={slot.period}
              onChange={(e) => setSlot((s) => ({ ...s, period: e.target.value as SlotPeriod }))}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>调整位</span>
            <select
              value={slot.station}
              onChange={(e) => setSlot((s) => ({ ...s, station: e.target.value }))}
            >
              {STATIONS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        </div>
        {effectiveSlot && occupants.length > 0 && (
          <p className="banner error">
            该时段已被占用：{occupants.map((c) => c.id).join("、")}（{slotLabel(effectiveSlot)}）
          </p>
        )}
        {effectiveSlot && occupants.length === 0 && (
          <p className="banner ok">时段空闲：{slotLabel(effectiveSlot)}</p>
        )}
      </section>

      <section className="editor-block judge-box">
        <h3>判定预览</h3>
        <p className="judge-line">
          保修状态：
          {preview.underWarranty === null ? (
            <span className="dim">购买日无效</span>
          ) : preview.underWarranty ? (
            <span className="fee-free">保修内，免材料费</span>
          ) : (
            <span className="fee-charge">
              超出保修范围，材料费合计 ¥{preview.materialFee}
            </span>
          )}
        </p>
        {preview.underWarranty === false && preview.feeItems.length > 0 && (
          <ul className="fee-list">
            {preview.feeItems.map((f) => (
              <li key={f.partCode}>
                {f.partName} × {f.qty}　¥{f.unitPrice} = ¥{f.amount}
              </li>
            ))}
          </ul>
        )}
        <ul className="reason-list">
          {preview.blockReasons.map((r) => (
            <li key={r} className={r.startsWith("超出保修范围") ? "reason-warn" : "reason-hard"}>
              {r}
            </li>
          ))}
        </ul>
        {warrantyUntil(record.purchaseDate) !== null && preview.canConfirm && (
          <p className="banner ok">条件满足，提交后进入「待确认」，等顾客点头再锁定返修。</p>
        )}
      </section>

      <div className="editor-actions">
        <button onClick={() => onSave(patch)}>保存登记</button>
        <button className="primary-action" onClick={() => onSubmit(patch)}>
          提交判定
        </button>
      </div>
    </div>
  );
}

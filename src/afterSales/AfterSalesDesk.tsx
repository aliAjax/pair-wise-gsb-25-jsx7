import { useMemo, useState } from "react";
import { FAULT_CATALOG, FAULT_CODES } from "./catalog";
import {
  STATUS_LABEL,
  evaluateIntake,
  isWithinWarranty,
  ownedDays,
} from "./rules";
import {
  confirmForRepair,
  finishRepair,
  loadData,
  reopenForRework,
  resetData,
  submitIntake,
  type IntakeDraft,
} from "./storage";
import type {
  AfterSalesCase,
  AfterSalesData,
  CaseStatus,
  FaultCode,
  FaultEntry,
  PartNeed,
  Slot,
} from "./types";

type FilterKey = "ALL" | CaseStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "全部" },
  { key: "PENDING", label: "待处理" },
  { key: "QUOTED", label: "待确认" },
  { key: "CONFIRMED", label: "返修中" },
  { key: "DONE", label: "已完成" },
];

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function emptyDraft(data: AfterSalesData): IntakeDraft {
  return {
    customerCode: "",
    frameCode: "",
    purchaseDate: todayKey(),
    faults: [],
    parts: [],
    slot: {
      stationId: data.stations[0]?.id ?? "",
      date: todayKey(),
      start: "10:00",
      end: "10:30",
    },
  };
}

export default function AfterSalesDesk() {
  const [data, setData] = useState<AfterSalesData>(loadData);
  const [draft, setDraft] = useState<IntakeDraft>(() => emptyDraft(data));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ text: string; warn?: boolean } | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [finishNote, setFinishNote] = useState<Record<string, string>>({});
  const [reopenReason, setReopenReason] = useState<Record<string, string>>({});
  const [showFinish, setShowFinish] = useState<Record<string, boolean>>({});
  const [showReopen, setShowReopen] = useState<Record<string, boolean>>({});

  // 表单录入时的实时判定（撞档/备件/材料费）
  const preview = useMemo(() => {
    if (!draft.purchaseDate || !draft.slot.date) return null;
    return evaluateIntake(draft, data.cases, data.parts, editingId ?? undefined);
  }, [draft, data, editingId]);

  const metrics = useMemo(() => {
    const count = (s: CaseStatus) => data.cases.filter((c) => c.status === s).length;
    return {
      pending: count("PENDING"),
      quoted: count("QUOTED"),
      confirmed: count("CONFIRMED"),
      done: count("DONE"),
    };
  }, [data.cases]);

  const visibleCases = useMemo(() => {
    const q = query.trim().toUpperCase();
    return data.cases.filter((c) => {
      if (filter !== "ALL" && c.status !== filter) return false;
      if (!q) return true;
      return (
        c.id.toUpperCase().includes(q) ||
        c.customerCode.toUpperCase().includes(q) ||
        c.frameCode.toUpperCase().includes(q)
      );
    });
  }, [data.cases, filter, query]);

  function notify(text: string, warn = false) {
    setToast({ text, warn });
    window.setTimeout(() => setToast(null), 3200);
  }

  // ---------- 表单操作 ----------

  function patchDraft(patch: Partial<IntakeDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function patchSlot(patch: Partial<Slot>) {
    setDraft((d) => ({ ...d, slot: { ...d.slot, ...patch } }));
  }

  function toggleFault(code: FaultCode) {
    const exists = draft.faults.some((f) => f.code === code);
    if (exists) {
      patchDraft({ faults: draft.faults.filter((f) => f.code !== code) });
    } else {
      const entry: FaultEntry = { code, note: "" };
      patchDraft({ faults: [...draft.faults, entry] });
    }
  }

  function updateFaultNote(code: FaultCode, note: string) {
    patchDraft({
      faults: draft.faults.map((f) => (f.code === code ? { ...f, note } : f)),
    });
  }

  function addPartRow() {
    const first = data.parts[0];
    if (!first) return;
    if (draft.parts.some((p) => p.partId === first.id)) return;
    const need: PartNeed = { partId: first.id, partName: first.name, qty: 1 };
    patchDraft({ parts: [...draft.parts, need] });
  }

  function updatePartRow(index: number, patch: Partial<PartNeed>) {
    const parts = draft.parts.map((p, i) => {
      if (i !== index) return p;
      const next = { ...p, ...patch };
      const part = data.parts.find((x) => x.id === next.partId);
      if (part) next.partName = part.name;
      return next;
    });
    patchDraft({ parts });
  }

  function removePartRow(index: number) {
    patchDraft({ parts: draft.parts.filter((_, i) => i !== index) });
  }

  function handleSubmit() {
    const result = submitIntake(data, draft, editingId ?? undefined);
    if (result.error) {
      notify(result.error, true);
      return;
    }
    setData(result.data);
    if (result.status === "PENDING") {
      notify(`已登记，留在待处理：${result.pendingReason}`, true);
    } else if (result.data.parts.length === 0) {
      notify("案件已建立并安排调整位时段");
    } else {
      const fee = result.data.cases.find((c) => c.id === result.caseId);
      notify(
        fee && fee.materialFee > 0
          ? "排班成功，超出保修范围，请顾客确认材料费"
          : "排班成功，保内免材料费，可确认返修",
      );
    }
    setEditingId(null);
    setDraft(emptyDraft(result.data));
  }

  function startEdit(c: AfterSalesCase) {
    setEditingId(c.id);
    setDraft({
      customerCode: c.customerCode,
      frameCode: c.frameCode,
      purchaseDate: c.purchaseDate,
      faults: c.faults.map((f) => ({ ...f })),
      parts: c.parts.map((p) => ({ ...p })),
      slot: { ...c.slot },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft(data));
  }

  // ---------- 案件操作 ----------

  function handleConfirm(c: AfterSalesCase) {
    const result = confirmForRepair(data, c.id, !!approved[c.id]);
    if (result.error) {
      notify(result.error, true);
      return;
    }
    setData(result.data);
    setApproved((m) => ({ ...m, [c.id]: false }));
    notify("已确认返修：故障、配件与费用已锁定");
  }

  function handleFinish(c: AfterSalesCase) {
    const note = (finishNote[c.id] ?? "").trim();
    const result = finishRepair(data, c.id, note);
    if (result.error) {
      notify(result.error, true);
      return;
    }
    setData(result.data);
    setShowFinish((m) => ({ ...m, [c.id]: false }));
    setFinishNote((m) => ({ ...m, [c.id]: "" }));
    notify("返修完成");
  }

  function handleReopen(c: AfterSalesCase) {
    const reason = (reopenReason[c.id] ?? "").trim();
    const result = reopenForRework(data, c.id, reason);
    if (result.error) {
      notify(result.error, true);
      return;
    }
    setData(result.data);
    setShowReopen((m) => ({ ...m, [c.id]: false }));
    setReopenReason((m) => ({ ...m, [c.id]: "" }));
    notify(`已返工重开（第 ${c.currentVersion + 1} 版）：${reason}`, true);
  }

  function handleReset() {
    const seed = resetData();
    setData(seed);
    setDraft(emptyDraft(seed));
    setEditingId(null);
    notify("已恢复演示档案");
  }

  return (
    <main className="app-shell aftersales">
      <section className="hero">
        <div>
          <p className="eyebrow">售后调整台 · AFTER-SALES BENCH</p>
          <h1>镜架售后调整台</h1>
          <p className="subtitle">
            按顾客代号、镜架编号与购买日建案，安排调整位时段并登记故障与配件需求。
            撞档或备件不足留在待处理；超保修列明材料费，顾客点头后才返修。
          </p>
        </div>
        <div className="stack-card">
          <span>分层结构</span>
          <strong>types/catalog 档案 · rules 判定 · storage 保存 · 本页 页面</strong>
          <button onClick={handleReset}>恢复演示档案</button>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>待处理（撞档/缺件）</span>
          <strong>{metrics.pending}</strong>
          <i className="status-danger" />
        </article>
        <article className="metric-card">
          <span>待顾客确认</span>
          <strong>{metrics.quoted}</strong>
          <i className="status-watch" />
        </article>
        <article className="metric-card">
          <span>返修中（已锁定）</span>
          <strong>{metrics.confirmed}</strong>
          <i className="status-ok" />
        </article>
        <article className="metric-card">
          <span>返修完成</span>
          <strong>{metrics.done}</strong>
          <i className="status-ok" />
        </article>
      </section>

      <section className="workspace">
        {/* 建案/编辑面板 */}
        <aside className="panel narrow intake-panel">
          <div className="section-heading">
            <h2>{editingId ? `修改案件 ${editingId}` : "新建售后案"}</h2>
          </div>

          <label>
            <span>顾客代号 *</span>
            <input
              value={draft.customerCode}
              placeholder="如 C-1023"
              onChange={(e) => patchDraft({ customerCode: e.target.value })}
            />
          </label>
          <label>
            <span>镜架编号 *</span>
            <input
              value={draft.frameCode}
              placeholder="如 F-TI-8801"
              onChange={(e) => patchDraft({ frameCode: e.target.value })}
            />
          </label>
          <label>
            <span>购买日 *</span>
            <input
              type="date"
              value={draft.purchaseDate}
              onChange={(e) => patchDraft({ purchaseDate: e.target.value })}
            />
          </label>
          {draft.purchaseDate && (
            <p className={`hint ${isWithinWarranty(draft.purchaseDate) ? "hint-ok" : "hint-warn"}`}>
              已购 {ownedDays(draft.purchaseDate)} 天 ·{" "}
              {isWithinWarranty(draft.purchaseDate)
                ? "保修范围内（12 个月），免材料费"
                : "超出保修范围，需列明材料费"}
            </p>
          )}

          <h3 className="form-sub">故障登记 *</h3>
          <div className="fault-list">
            {FAULT_CODES.map((code) => {
              const entry = draft.faults.find((f) => f.code === code);
              return (
                <div key={code} className="fault-row">
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={!!entry}
                      onChange={() => toggleFault(code)}
                    />
                    <span>{FAULT_CATALOG[code].label}</span>
                  </label>
                  {entry && (
                    <input
                      className="fault-note"
                      placeholder={FAULT_CATALOG[code].desc}
                      value={entry.note}
                      onChange={(e) => updateFaultNote(code, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <h3 className="form-sub">
            配件需求
            <button className="inline-add" onClick={addPartRow}>
              + 添加配件
            </button>
          </h3>
          <div className="part-rows">
            {draft.parts.length === 0 && <p className="hint">无配件更换（仅调校）</p>}
            {draft.parts.map((p, index) => {
              const part = data.parts.find((x) => x.id === p.partId);
              return (
                <div key={index} className="part-row">
                  <select
                    value={p.partId}
                    onChange={(e) => updatePartRow(index, { partId: e.target.value })}
                  >
                    {data.parts.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}（库存 {opt.stock}
                        {opt.unit}）
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={p.qty}
                    onChange={(e) =>
                      updatePartRow(index, { qty: Number(e.target.value) })
                    }
                  />
                  <span className="part-unit">{part?.unit}</span>
                  <button className="row-remove" onClick={() => removePartRow(index)}>
                    删
                  </button>
                </div>
              );
            })}
          </div>

          <h3 className="form-sub">调整位时段 *</h3>
          <div className="slot-grid">
            <select
              value={draft.slot.stationId}
              onChange={(e) => patchSlot({ stationId: e.target.value })}
            >
              {data.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={draft.slot.date}
              onChange={(e) => patchSlot({ date: e.target.value })}
            />
            <div className="slot-time">
              <input
                type="time"
                value={draft.slot.start}
                step={1800}
                onChange={(e) => patchSlot({ start: e.target.value })}
              />
              <span>至</span>
              <input
                type="time"
                value={draft.slot.end}
                step={1800}
                onChange={(e) => patchSlot({ end: e.target.value })}
              />
            </div>
          </div>

          {preview && (
            <div className={`preview ${preview.kind === "PENDING" ? "preview-warn" : "preview-ok"}`}>
              {preview.kind === "PENDING" ? (
                <>
                  <strong>将留在待处理</strong>
                  <p>{preview.reason}</p>
                </>
              ) : (
                <>
                  <strong>时段可安排</strong>
                  <p>
                    {preview.warrantyCovered
                      ? "保内：材料费全免"
                      : preview.materialFee > 0
                        ? `保外材料费：¥${preview.materialFee}，需顾客确认`
                        : "保外但无材料费用"}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="form-actions">
            <button className="primary-action" onClick={handleSubmit}>
              {editingId ? "重新提交判定" : "登记建案"}
            </button>
            {editingId && <button onClick={cancelEdit}>取消修改</button>}
          </div>
        </aside>

        {/* 案件列表 */}
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>售后案件</p>
              <h2>调整台队列</h2>
            </div>
            <input
              className="search-box"
              placeholder="搜索代号 / 镜架编号 / 案号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="chips muted filter-chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={filter === f.key ? "chip-active" : ""}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="case-list">
            {visibleCases.length === 0 && (
              <p className="hint empty-hint">没有符合条件的案件</p>
            )}
            {visibleCases.map((c) => (
              <CaseCard
                key={c.id}
                c={c}
                data={data}
                approved={!!approved[c.id]}
                onApprovedChange={(v) => setApproved((m) => ({ ...m, [c.id]: v }))}
                onEdit={() => startEdit(c)}
                onConfirm={() => handleConfirm(c)}
                historyOpen={!!historyOpen[c.id]}
                onToggleHistory={() =>
                  setHistoryOpen((m) => ({ ...m, [c.id]: !m[c.id] }))
                }
                showFinish={!!showFinish[c.id]}
                finishNote={finishNote[c.id] ?? ""}
                onToggleFinish={() =>
                  setShowFinish((m) => ({ ...m, [c.id]: !m[c.id] }))
                }
                onFinishNoteChange={(v) =>
                  setFinishNote((m) => ({ ...m, [c.id]: v }))
                }
                onFinish={() => handleFinish(c)}
                showReopen={!!showReopen[c.id]}
                reopenReason={reopenReason[c.id] ?? ""}
                onToggleReopen={() =>
                  setShowReopen((m) => ({ ...m, [c.id]: !m[c.id] }))
                }
                onReopenReasonChange={(v) =>
                  setReopenReason((m) => ({ ...m, [c.id]: v }))
                }
                onReopen={() => handleReopen(c)}
              />
            ))}
          </div>

          <h3 className="form-sub stock-title">备件库存</h3>
          <div className="stock-grid">
            {data.parts.map((p) => (
              <div key={p.id} className={`stock-item ${p.stock === 0 ? "stock-zero" : ""}`}>
                <span>{p.name}</span>
                <strong>
                  {p.stock}
                  {p.unit}
                </strong>
                <em>¥{p.price}/{p.unit}</em>
              </div>
            ))}
          </div>
        </section>
      </section>

      {toast && (
        <div className={`toast ${toast.warn ? "toast-warn" : ""}`}>{toast.text}</div>
      )}
    </main>
  );
}

interface CaseCardProps {
  c: AfterSalesCase;
  data: AfterSalesData;
  approved: boolean;
  onApprovedChange: (v: boolean) => void;
  onEdit: () => void;
  onConfirm: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  showFinish: boolean;
  finishNote: string;
  onToggleFinish: () => void;
  onFinishNoteChange: (v: string) => void;
  onFinish: () => void;
  showReopen: boolean;
  reopenReason: string;
  onToggleReopen: () => void;
  onReopenReasonChange: (v: string) => void;
  onReopen: () => void;
}

function CaseCard(props: CaseCardProps) {
  const { c } = props;
  const station = props.data.stations.find((s) => s.id === c.slot.stationId);
  const locked = c.status === "CONFIRMED" || c.status === "DONE";

  return (
    <article className={`case-card status-${c.status.toLowerCase()}`}>
      <header className="case-head">
        <div>
          <h3>{c.id}</h3>
          <p>
            顾客 {c.customerCode} · 镜架 {c.frameCode} · 购买日 {c.purchaseDate}
          </p>
        </div>
        <div className="badges">
          <span className={`badge badge-${c.warrantyCovered ? "in" : "out"}`}>
            {c.warrantyCovered ? "保内" : "保外"}
          </span>
          <span className={`badge badge-status-${c.status.toLowerCase()}`}>
            {STATUS_LABEL[c.status]}
          </span>
        </div>
      </header>

      <dl className="case-detail">
        <div>
          <dt>故障</dt>
          <dd>
            {c.faults.map((f) => (
              <span key={f.code} className="tag">
                {FAULT_CATALOG[f.code].label}
                {f.note ? `：${f.note}` : ""}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>配件</dt>
          <dd>
            {c.parts.length === 0
              ? "无"
              : c.parts.map((p) => (
                  <span key={p.partId} className="tag">
                    {p.partName} × {p.qty}
                  </span>
                ))}
          </dd>
        </div>
        <div>
          <dt>调整位时段</dt>
          <dd>
            {station?.name} · {c.slot.date} {c.slot.start}-{c.slot.end}
          </dd>
        </div>
        <div>
          <dt>材料费</dt>
          <dd className={c.materialFee > 0 ? "fee-warn" : "fee-ok"}>
            {c.warrantyCovered
              ? "保内免材料费"
              : c.materialFee > 0
                ? `¥${c.materialFee}（需顾客确认）`
                : "¥0"}
          </dd>
        </div>
      </dl>

      {c.pendingReason && <p className="pending-reason">⚠ {c.pendingReason}</p>}
      {c.reopenReason && (
        <p className="reopen-reason">↻ 返工重开原因：{c.reopenReason}</p>
      )}
      {locked && <p className="lock-note">🔒 故障、配件与费用已锁定（第 {c.currentVersion} 版）</p>}

      <div className="case-actions">
        {c.status === "PENDING" && (
          <button className="primary-action" onClick={props.onEdit}>
            修改并重新判定
          </button>
        )}
        {c.status === "QUOTED" && (
          <>
            {!c.warrantyCovered && c.materialFee > 0 && (
              <label className="check-line approve-line">
                <input
                  type="checkbox"
                  checked={props.approved}
                  onChange={(e) => props.onApprovedChange(e.target.checked)}
                />
                <span>顾客已知情并点头确认材料费 ¥{c.materialFee}</span>
              </label>
            )}
            <button
              className="primary-action"
              disabled={!c.warrantyCovered && c.materialFee > 0 && !props.approved}
              onClick={props.onConfirm}
            >
              确认返修（锁定）
            </button>
            <button onClick={props.onEdit}>调整登记</button>
          </>
        )}
        {c.status === "CONFIRMED" && (
          <>
            {!props.showFinish ? (
              <button className="primary-action" onClick={props.onToggleFinish}>
                完成返修
              </button>
            ) : (
              <div className="inline-form">
                <input
                  placeholder="完成备注（可选）"
                  value={props.finishNote}
                  onChange={(e) => props.onFinishNoteChange(e.target.value)}
                />
                <button className="primary-action" onClick={props.onFinish}>
                  确认完成
                </button>
                <button onClick={props.onToggleFinish}>取消</button>
              </div>
            )}
          </>
        )}
        {c.status === "DONE" && (
          <>
            {!props.showReopen ? (
              <button className="primary-action" onClick={props.onToggleReopen}>
                返工重开
              </button>
            ) : (
              <div className="inline-form">
                <input
                  placeholder="返工原因（必填）"
                  value={props.reopenReason}
                  onChange={(e) => props.onReopenReasonChange(e.target.value)}
                />
                <button
                  className="primary-action"
                  disabled={!props.reopenReason.trim()}
                  onClick={props.onReopen}
                >
                  确认重开
                </button>
                <button onClick={props.onToggleReopen}>取消</button>
              </div>
            )}
          </>
        )}
        <button onClick={props.onToggleHistory}>
          {props.historyOpen ? "收起版本记录" : `版本记录（${c.versions.length}）`}
        </button>
      </div>

      {props.historyOpen && <VersionHistory c={c} />}
    </article>
  );
}

function VersionHistory({ c }: { c: AfterSalesCase }) {
  if (c.versions.length === 0) {
    return <p className="hint">尚未确认返修，暂无锁定版本。</p>;
  }
  return (
    <div className="version-history">
      <h4>历史版本（旧记录可查，不可修改）</h4>
      {[...c.versions].reverse().map((v) => (
        <div key={v.version} className="version-item">
          <div className="version-head">
            <strong>第 {v.version} 版</strong>
            <span className={v.status === "DONE" ? "fee-ok" : ""}>
              {v.status === "DONE" ? "已完成" : "返修中"}
            </span>
            <em>{new Date(v.lockedAt).toLocaleString("zh-CN")}</em>
            {v.version === c.currentVersion && <span className="tag tag-current">当前版本</span>}
          </div>
          <p>
            故障：
            {v.faults.map((f) => FAULT_CATALOG[f.code].label).join("、")}
          </p>
          <p>
            配件：
            {v.parts.length === 0
              ? "无"
              : v.parts.map((p) => `${p.partName}×${p.qty}`).join("、")}
          </p>
          <p>
            费用：{v.warrantyCovered ? "保内免材料费" : `¥${v.materialFee}`}
          </p>
          {v.reopenReason && <p className="reopen-reason">重开原因：{v.reopenReason}</p>}
          {v.finishNote && <p>完成备注：{v.finishNote}</p>}
        </div>
      ))}
    </div>
  );
}

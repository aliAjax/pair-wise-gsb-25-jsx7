import { useMemo, useState } from "react";
import { latest } from "./rules";
import {
  completeRepair,
  confirmCase,
  createCase,
  loadDb,
  resetDb,
  restock,
  reopenCase,
  saveDraft,
  sendBack,
  startRepair,
  submitCase,
} from "./storage";
import type { AdjustCase, CaseStatus, Database, DraftPatch } from "./types";
import CaseEditor from "./components/CaseEditor";
import CaseList, { StatusBadge } from "./components/CaseList";
import CaseView from "./components/CaseView";
import StockPanel from "./components/StockPanel";

type Filter = CaseStatus | "全部";

const METRIC_LABELS: CaseStatus[] = ["待处理", "待确认", "已锁定", "返修中", "已完成"];

export default function AfterSalesDesk() {
  const [db, setDb] = useState<Database>(() => loadDb());
  const [filter, setFilter] = useState<Filter>("全部");
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const first = loadDb().cases[0];
    return first ? first.id : null;
  });
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [customerCode, setCustomerCode] = useState("");
  const [frameCode, setFrameCode] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");

  const selected = useMemo(
    () => db.cases.find((c) => c.id === selectedId) ?? null,
    [db.cases, selectedId],
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of db.cases) m[latest(c).status] = (m[latest(c).status] ?? 0) + 1;
    return m;
  }, [db.cases]);

  const run = (fn: () => Database, ok?: string) => {
    try {
      const next = fn();
      setDb(next);
      setNotice(ok ? { kind: "ok", text: ok } : null);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "操作失败" });
    }
  };

  const handleCreate = () => {
    try {
      const r = createCase(db, { customerCode, frameCode, purchaseDate });
      setDb(r.db);
      setSelectedId(r.id);
      setFilter("待处理");
      setCustomerCode("");
      setFrameCode("");
      setPurchaseDate("");
      setNotice({ kind: "ok", text: `已按顾客代号 / 镜架编号 / 购买日建案 ${r.id}` });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "建案失败" });
    }
  };

  const handleSave = (patch: DraftPatch) =>
    run(() => saveDraft(db, selectedId!, patch), "已保存登记");

  const handleSubmit = (patch: DraftPatch) => {
    try {
      const next = submitCase(saveDraft(db, selectedId!, patch), selectedId!);
      setDb(next);
      const c = next.cases.find((x) => x.id === selectedId);
      const v = c ? latest(c) : null;
      setNotice(
        v && v.status === "待确认"
          ? { kind: "ok", text: "时段与备件均落实，已进入待确认，请向顾客列明方案与费用" }
          : { kind: "error", text: "仍有待处理项：" + (v ? v.blockReasons.join("；") : "案件不存在") },
      );
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "提交失败" });
    }
  };

  const selectedVersion = selected ? latest(selected) : null;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-11 · 售后调整台</p>
          <h1>镜架售后调整台</h1>
          <p className="subtitle">
            鼻托松脱、镜腿变形、焊接返修统一按顾客代号、镜架编号、购买日建案；
            调整位撞档或备件不足留在待处理，超保修列明材料费，顾客点头后故障 / 配件 / 费用锁定，
            返工重开新版本，旧记录可查。
          </p>
        </div>
        <div className="stack-card">
          <span>分层</span>
          <strong>档案 · 判定 · 保存 · 页面 分离</strong>
          <button
            className="reset-btn"
            onClick={() => {
              const next = resetDb();
              setDb(next);
              setSelectedId(next.cases[0]?.id ?? null);
              setNotice({ kind: "ok", text: "已恢复演示数据" });
            }}
          >
            恢复演示数据
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        {METRIC_LABELS.map((label) => (
          <article className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{counts[label] ?? 0}</strong>
            <i className={"bar-" + label} />
          </article>
        ))}
      </section>

      {notice && (
        <p className={"banner " + (notice.kind === "ok" ? "ok" : "error")}>{notice.text}</p>
      )}

      <section className="create-bar panel">
        <div className="create-fields">
          <label>
            <span>顾客代号</span>
            <input
              placeholder="如 C-1024"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
            />
          </label>
          <label>
            <span>镜架编号</span>
            <input
              placeholder="如 F-3301"
              value={frameCode}
              onChange={(e) => setFrameCode(e.target.value)}
            />
          </label>
          <label>
            <span>购买日</span>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </label>
        </div>
        <button className="primary-action create-btn" onClick={handleCreate}>
          建案
        </button>
      </section>

      <section className="desk-layout">
        <aside className="panel list-pane">
          <CaseList
            cases={db.cases}
            selectedId={selectedId}
            filter={filter}
            onFilter={setFilter}
            onSelect={setSelectedId}
          />
        </aside>

        <section className="panel detail-pane">
          {!selected || !selectedVersion ? (
            <p className="empty-hint">左侧选择案件，或先在上方按顾客代号、镜架编号、购买日建案。</p>
          ) : selectedVersion.status === "待处理" ? (
            <CaseEditor
              key={selected.id + "-v" + selectedVersion.version}
              db={db}
              record={selected}
              onSave={handleSave}
              onSubmit={handleSubmit}
            />
          ) : (
            <CaseView
              key={selected.id + "-v" + selectedVersion.version}
              record={selected}
              onConfirm={() => run(() => confirmCase(db, selected.id), "顾客已确认，故障 / 配件 / 费用已锁定，备件已预留")}
              onSendBack={() => run(() => sendBack(db, selected.id), "已退回待处理，可修改方案后重新提交")}
              onStart={() => run(() => startRepair(db, selected.id), "已上调整位开始返修")}
              onComplete={() => run(() => completeRepair(db, selected.id), "已完成交付")}
              onReopen={(reason) => {
                run(() => reopenCase(db, selected.id, reason), "已返工重开新版本，请重新登记并安排时段");
                setFilter("待处理");
              }}
            />
          )}
        </section>
      </section>

      <StockPanel db={db} onRestock={(code, qty) => run(() => restock(db, code, qty), "已入库")} />

      <footer className="desk-foot">
        {selected && (
          <span>
            当前案件：{selected.id} <StatusBadge status={latest(selected).status} />
          </span>
        )}
        <span>数据保存在本机浏览器（localStorage），确认后的版本不可再编辑。</span>
      </footer>
    </main>
  );
}

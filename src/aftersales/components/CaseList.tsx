import { isUnderWarranty, latest, slotLabel, warrantyUntil } from "../rules";
import type { AdjustCase, CaseStatus } from "../types";

const FILTERS: (CaseStatus | "全部")[] = [
  "全部",
  "待处理",
  "待确认",
  "已锁定",
  "返修中",
  "已完成",
];

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className="badge" data-status={status}>
      {status}
    </span>
  );
}

export function WarrantyTag({ purchaseDate }: { purchaseDate: string }) {
  const until = warrantyUntil(purchaseDate);
  if (!until) return <span className="warranty-tag unknown">日期无效</span>;
  return (
    <span className={"warranty-tag " + (isUnderWarranty(purchaseDate) ? "in" : "out")}>
      {isUnderWarranty(purchaseDate) ? `保修内（至 ${until}）` : `已过保（${until} 到期）`}
    </span>
  );
}

interface CaseListProps {
  cases: AdjustCase[];
  selectedId: string | null;
  filter: CaseStatus | "全部";
  onFilter: (f: CaseStatus | "全部") => void;
  onSelect: (id: string) => void;
}

export default function CaseList({ cases, selectedId, filter, onFilter, onSelect }: CaseListProps) {
  const shown = filter === "全部" ? cases : cases.filter((c) => latest(c).status === filter);

  return (
    <div className="case-list-panel">
      <div className="filter-row">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={"filter-chip" + (filter === f ? " active" : "")}
            onClick={() => onFilter(f)}
          >
            {f}
            {f !== "全部" && (
              <em>{cases.filter((c) => latest(c).status === f).length}</em>
            )}
          </button>
        ))}
      </div>

      <div className="case-list">
        {shown.length === 0 && <p className="empty-hint">该分类下暂无案件</p>}
        {shown.map((c) => {
          const v = latest(c);
          return (
            <button
              key={c.id}
              className={"case-item" + (selectedId === c.id ? " selected" : "")}
              onClick={() => onSelect(c.id)}
            >
              <div className="case-item-head">
                <strong>{c.id}</strong>
                <StatusBadge status={v.status} />
              </div>
              <div className="case-item-meta">
                {c.customerCode} · {c.frameCode}
              </div>
              <div className="case-item-meta">购买日 {c.purchaseDate}</div>
              <div className="case-item-foot">
                {v.slot ? (
                  <span>{slotLabel(v.slot)}</span>
                ) : (
                  <span className="dim">未排时段</span>
                )}
                {c.versions.length > 1 && <span className="version-mark">v{v.version} 返工</span>}
              </div>
              {v.status === "待处理" && v.blockReasons.length > 0 && (
                <div className="case-item-reason">{v.blockReasons[0]}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

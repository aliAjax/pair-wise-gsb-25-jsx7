import { useState } from "react";
import { formatDateTime, slotLabel } from "../rules";
import type { AdjustCase, CaseVersion } from "../types";
import { StatusBadge, WarrantyTag } from "./CaseList";

interface CaseViewProps {
  record: AdjustCase;
  onConfirm: () => void;
  onSendBack: () => void;
  onStart: () => void;
  onComplete: () => void;
  onReopen: (reason: string) => void;
}

function VersionSnapshot({ v, current }: { v: CaseVersion; current: boolean }) {
  const [open, setOpen] = useState(current);
  return (
    <article className={"version-card" + (current ? " current" : "")}>
      <button className="version-head" onClick={() => setOpen((o) => !o)}>
        <strong>v{v.version}</strong>
        <StatusBadge status={v.status} />
        <span className="dim">{formatDateTime(v.createdAt)}</span>
        <span className="version-toggle">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="version-body">
          {v.reopenedReason && <p className="banner warn">返工原因：{v.reopenedReason}</p>}

          <h4>故障（确认后锁定）</h4>
          <ul className="locked-list">
            {v.faults.map((f) => (
              <li key={f.id}>
                <strong>{f.kind}</strong>
                {f.note ? `：${f.note}` : ""}
              </li>
            ))}
          </ul>

          <h4>配件（确认后锁定）</h4>
          {v.parts.length === 0 ? (
            <p className="dim">无配件需求</p>
          ) : (
            <ul className="locked-list">
              {v.parts.map((p) => (
                <li key={p.id}>
                  {p.partCode} · {p.partName} × {p.qty}
                </li>
              ))}
            </ul>
          )}

          <h4>调整位时段</h4>
          <p>{v.slot ? slotLabel(v.slot) : "未安排"}</p>

          <h4>材料费</h4>
          {v.feeItems.length === 0 ? (
            <p className="dim">无（保修内或无配件）</p>
          ) : (
            <table className="fee-table">
              <tbody>
                {v.feeItems.map((f) => (
                  <tr key={f.partCode}>
                    <td>{f.partName}</td>
                    <td className="mono">×{f.qty}</td>
                    <td className="mono">¥{f.unitPrice}</td>
                    <td className="mono">¥{f.amount}</td>
                  </tr>
                ))}
                <tr className="fee-total-row">
                  <td colSpan={3}>合计</td>
                  <td className="mono">¥{v.materialFee}</td>
                </tr>
              </tbody>
            </table>
          )}

          <dl className="time-line">
            {v.submittedAt && <><dt>提交判定</dt><dd>{formatDateTime(v.submittedAt)}</dd></>}
            {v.confirmedAt && <><dt>顾客确认锁定</dt><dd>{formatDateTime(v.confirmedAt)}</dd></>}
            {v.startedAt && <><dt>开始返修</dt><dd>{formatDateTime(v.startedAt)}</dd></>}
            {v.finishedAt && <><dt>完成交付</dt><dd>{formatDateTime(v.finishedAt)}</dd></>}
          </dl>
        </div>
      )}
    </article>
  );
}

export default function CaseView({
  record,
  onConfirm,
  onSendBack,
  onStart,
  onComplete,
  onReopen,
}: CaseViewProps) {
  const v = record.versions[record.versions.length - 1];
  const [agreed, setAgreed] = useState(false);
  const [reopenMode, setReopenMode] = useState(false);
  const [reason, setReason] = useState("");

  const reopen = () => {
    if (!reason.trim()) return;
    onReopen(reason);
    setReason("");
    setReopenMode(false);
  };

  return (
    <div className="case-view">
      <div className="detail-head">
        <div>
          <h2>{record.id}</h2>
          <p className="detail-base">
            {record.customerCode} · 镜架 {record.frameCode} · 购买日 {record.purchaseDate}
          </p>
        </div>
        <StatusBadge status={v.status} />
      </div>
      <WarrantyTag purchaseDate={record.purchaseDate} />

      <section className="view-block">
        <h3>故障登记</h3>
        <ul className="locked-list">
          {v.faults.map((f) => (
            <li key={f.id}>
              <strong>{f.kind}</strong>
              {f.note ? `：${f.note}` : ""}
            </li>
          ))}
        </ul>
        <h3>配件需求</h3>
        {v.parts.length === 0 ? (
          <p className="dim">无配件需求</p>
        ) : (
          <ul className="locked-list">
            {v.parts.map((p) => (
              <li key={p.id}>
                {p.partCode} · {p.partName} × {p.qty}
              </li>
            ))}
          </ul>
        )}
        <h3>调整位时段</h3>
        <p>{v.slot ? slotLabel(v.slot) : "未安排"}</p>
      </section>

      {v.status === "待确认" && (
        <section className="confirm-box">
          <h3>顾客确认</h3>
          {v.materialFee > 0 ? (
            <>
              <p className="fee-note">本案超出保修范围，材料费明细：</p>
              <table className="fee-table">
                <tbody>
                  {v.feeItems.map((f) => (
                    <tr key={f.partCode}>
                      <td>{f.partName}</td>
                      <td className="mono">×{f.qty}</td>
                      <td className="mono">¥{f.unitPrice}</td>
                      <td className="mono">¥{f.amount}</td>
                    </tr>
                  ))}
                  <tr className="fee-total-row">
                    <td colSpan={3}>合计材料费</td>
                    <td className="mono">¥{v.materialFee}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : (
            <p className="fee-note fee-free">保修内（或无需配件），不收取材料费。</p>
          )}
          <label className="agree-row">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            顾客已知晓故障、配件与费用并同意返修
          </label>
          <div className="editor-actions">
            <button onClick={onSendBack}>顾客不认可，退回改方案</button>
            <button className="primary-action" disabled={!agreed} onClick={onConfirm}>
              顾客确认 · 锁定并返修
            </button>
          </div>
        </section>
      )}

      {v.status === "已锁定" && (
        <section className="confirm-box">
          <p className="banner ok">故障、配件、费用已按顾客确认锁定，等待上调整位。</p>
          <div className="editor-actions">
            <button className="primary-action" onClick={onStart}>
              开始返修
            </button>
          </div>
        </section>
      )}

      {v.status === "返修中" && (
        <section className="confirm-box">
          <p className="banner">正在返修作业……</p>
          <div className="editor-actions">
            <button className="primary-action" onClick={onComplete}>
              完成交付
            </button>
          </div>
        </section>
      )}

      {v.status === "已完成" && (
        <section className="confirm-box">
          <p className="banner ok">已完成交付。如顾客返修反馈，可重开新版本，旧记录保留可查。</p>
          {!reopenMode ? (
            <div className="editor-actions">
              <button onClick={() => setReopenMode(true)}>返工重开</button>
            </div>
          ) : (
            <div className="reopen-box">
              <label className="field-label">返工重开原因（必填，写入新版本）</label>
              <textarea
                rows={3}
                value={reason}
                placeholder="例如：交付三天后鼻托再次松脱"
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="editor-actions">
                <button onClick={() => setReopenMode(false)}>取消</button>
                <button className="primary-action" disabled={!reason.trim()} onClick={reopen}>
                  重开 v{v.version + 1}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="history-block">
        <h3>版本记录{record.versions.length > 1 ? `（共 ${record.versions.length} 版，旧档可查）` : ""}</h3>
        {[...record.versions].reverse().map((x) => (
          <VersionSnapshot key={x.version} v={x} current={x.version === v.version} />
        ))}
      </section>
    </div>
  );
}

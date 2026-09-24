import { useState } from "react";
import type { Database } from "../types";

interface StockPanelProps {
  db: Database;
  onRestock: (code: string, qty: number) => void;
}

/** 配件台账：现货、牌价、已预留占用；入库后待处理案件可重新提交。 */
export default function StockPanel({ db, onRestock }: StockPanelProps) {
  const [qtyByCode, setQtyByCode] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const reserved = (code: string): number => {
    let n = 0;
    for (const c of db.cases) {
      const v = c.versions[c.versions.length - 1];
      if (v.status !== "已锁定" && v.status !== "返修中") continue;
      n += v.parts.filter((p) => p.partCode === code).reduce((s, p) => s + p.qty, 0);
    }
    return n;
  };

  const submit = (code: string) => {
    setError(null);
    const qty = Number(qtyByCode[code]);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("入库数量需为正数");
      return;
    }
    onRestock(code, Math.floor(qty));
    setQtyByCode((m) => ({ ...m, [code]: "" }));
  };

  return (
    <section className="panel stock-panel">
      <div className="section-heading">
        <div>
          <p>备件管理</p>
          <h2>配件台账</h2>
        </div>
      </div>
      {error && <p className="banner error">{error}</p>}
      <table className="stock-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>配件</th>
            <th>现货</th>
            <th>已预留</th>
            <th>牌价</th>
            <th>入库</th>
          </tr>
        </thead>
        <tbody>
          {db.stocks.map((s) => {
            const held = reserved(s.code);
            return (
              <tr key={s.code}>
                <td className="mono">{s.code}</td>
                <td>{s.name}</td>
                <td>
                  <strong className={s.stock - held <= 0 ? "stock-zero" : ""}>{s.stock}</strong>
                </td>
                <td className="dim">{held}</td>
                <td>¥{s.unitPrice}</td>
                <td>
                  <div className="restock-row">
                    <input
                      type="number"
                      min={1}
                      value={qtyByCode[s.code] ?? ""}
                      onChange={(e) =>
                        setQtyByCode((m) => ({ ...m, [s.code]: e.target.value }))
                      }
                      placeholder="数量"
                    />
                    <button onClick={() => submit(s.code)}>入库</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

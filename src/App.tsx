import { useState } from "react";
import "./styles.css";
import AfterSalesDesk from "./aftersales/AfterSalesDesk";
import OptometryBoard from "./optometry/OptometryBoard";

type Tab = "aftersales" | "optometry";

function App() {
  const [tab, setTab] = useState<Tab>("aftersales");

  return (
    <>
      <nav className="app-tabs">
        <button className={tab === "aftersales" ? "active" : ""} onClick={() => setTab("aftersales")}>
          售后调整台
        </button>
        <button className={tab === "optometry" ? "active" : ""} onClick={() => setTab("optometry")}>
          验光看板
        </button>
      </nav>
      {tab === "aftersales" ? <AfterSalesDesk /> : <OptometryBoard />}
    </>
  );
}

export default App;

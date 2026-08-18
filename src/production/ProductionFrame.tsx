import type { ReactNode } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";

type ProductionFrameProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  sidebarLabel?: string;
  sidebarDescription?: string;
};

export function ProductionFrame({
  eyebrow,
  title,
  description,
  children,
  sidebarLabel = "SHARED",
  sidebarDescription = "チームワークスペース",
}: ProductionFrameProps) {
  return (
    <main className="app-shell production-shell">
      <aside className="sidebar production-sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="brand-copy"><strong>MOSAIC</strong><small>Resource orchestration</small></span>
        </div>
        <div className="workspace-mode"><span>{sidebarLabel}</span><small>{sidebarDescription}</small></div>
        <div className="sidebar-spacer" />
        <div className="month-card production-trust-card">
          <div className="month-card-label"><span>安全な共同作業</span><strong>RLS</strong></div>
          <div className="month-track"><span style={{ width: "100%" }} /></div>
          <p>所属する組織の情報だけを読み込み、変更履歴を記録します。</p>
        </div>
      </aside>

      <section className="workspace production-workspace">
        <header className="topbar production-topbar">
          <div>
            <p className="eyebrow">{eyebrow} <span>/</span> MOSAIC</p>
            <h1>{title}</h1>
            <p className="date-range">{description}</p>
          </div>
        </header>
        <section className="schedule-card production-card" aria-live="polite">
          <div className="attention-panel production-card-body">{children}</div>
        </section>
      </section>
    </main>
  );
}

type ProductionStateProps = {
  eyebrow?: string;
  title: string;
  description: string;
  error?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export function ProductionState({
  eyebrow = "WORKSPACE STATUS",
  title,
  description,
  error = false,
  actionLabel,
  onAction,
}: ProductionStateProps) {
  return (
    <ProductionFrame eyebrow={eyebrow} title={title} description={description}>
      <div className="empty-state production-state" role={error ? "alert" : "status"}>
        {error ? <AlertTriangle size={24} /> : <LoaderCircle size={24} aria-hidden="true" />}
        <strong>{title}</strong>
        <p>{description}</p>
        {actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>}
      </div>
    </ProductionFrame>
  );
}

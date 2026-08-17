import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep workspace values out of the fallback UI. A production error
    // reporter can be connected here after its privacy policy is approved.
    console.error("MOSAIC render failure", error.name, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <p>SYSTEM RECOVERY</p>
        <h1>画面を表示できませんでした</h1>
        <span>入力中の内容を保護するため、自動では再読み込みしていません。再読み込み後も続く場合は、発生時刻を管理者へお知らせください。</span>
        <button type="button" onClick={() => window.location.reload()}>MOSAICを再読み込み</button>
      </main>
    );
  }
}

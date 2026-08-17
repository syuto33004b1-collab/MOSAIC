import { useState, type FormEvent } from "react";
import { Building2, Check, LogOut, MailCheck, Plus, UsersRound } from "lucide-react";
import type { MyContext, OrganizationSummary, PendingInvitation } from "./types";
import { ProductionFrame } from "./ProductionFrame";

type OrganizationSetupProps = {
  context: MyContext;
  onAcceptInvitation: (invitation: PendingInvitation) => Promise<void>;
  onCreate: (name: string, requestId: string) => Promise<void>;
  onSelect: (organization: OrganizationSummary) => void;
  onSignOut: () => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作を完了できませんでした。もう一度お試しください。";
}

function isClearlyNonRetryable(error: unknown) {
  return typeof error === "object" && error !== null && "retryable" in error && error.retryable === false;
}

export function OrganizationSetup({ context, onAcceptInvitation, onCreate, onSelect, onSignOut }: OrganizationSetupProps) {
  const [organizationName, setOrganizationName] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [pendingCreateRequest, setPendingCreateRequest] = useState<{ name: string; requestId: string } | null>(null);

  const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = organizationName.trim();
    if (name.length < 2 || pendingAction) return;
    const request = pendingCreateRequest?.name === name
      ? pendingCreateRequest
      : { name, requestId: crypto.randomUUID() };
    setPendingCreateRequest(request);
    setPendingAction("create");
    setError("");
    try {
      await onCreate(name, request.requestId);
      setPendingCreateRequest(null);
      setOrganizationName("");
    } catch (reason) {
      if (isClearlyNonRetryable(reason)) setPendingCreateRequest(null);
      setError(errorMessage(reason));
    } finally {
      setPendingAction("");
    }
  };

  const accept = async (invitation: PendingInvitation) => {
    if (pendingAction) return;
    setPendingAction(invitation.id);
    setError("");
    try {
      await onAcceptInvitation(invitation);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPendingAction("");
    }
  };

  return (
    <ProductionFrame
      eyebrow="ORGANIZATION ACCESS"
      title="利用する組織を選択"
      description={`${context.name}さんの所属先と招待を確認します。`}
      sidebarLabel="ACCOUNT"
      sidebarDescription={context.email}
    >
      <div className="production-organization-setup">
        {context.organizations.length > 0 && (
          <section className="production-organization-section" aria-labelledby="organization-list-heading">
            <div className="drawer-heading">
              <span className="drawer-icon cobalt"><Building2 size={19} /></span>
              <div><h2 id="organization-list-heading">所属している組織</h2><p>開くワークスペースを選択してください。</p></div>
            </div>
            <div className="allocation-list production-organization-list">
              {context.organizations.map((organization) => (
                <div key={organization.id}>
                  <span className="project-dot blue" />
                  <span><strong>{organization.name}</strong><small>{organization.role} · 共有ワークスペース</small></span>
                  <button className="drawer-secondary" type="button" disabled={Boolean(pendingAction)} onClick={() => onSelect(organization)}>開く</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {context.invitations.length > 0 && (
          <section className="production-invitation-section" aria-labelledby="invitation-list-heading">
            <div className="drawer-section-title"><span id="invitation-list-heading">届いている招待</span><small>{context.invitations.length}件</small></div>
            <div className="allocation-list">
              {context.invitations.map((invitation) => (
                <div key={invitation.id}>
                  <MailCheck size={16} />
                  <span><strong>{invitation.organizationName}</strong><small>{invitation.role}として参加</small></span>
                  <button className="drawer-secondary" type="button" disabled={Boolean(pendingAction)} onClick={() => void accept(invitation)}>
                    {pendingAction === invitation.id ? "確認中…" : "参加"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <form className="assignment-form production-create-organization" onSubmit={createOrganization}>
          <div className="drawer-heading">
            <span className="drawer-icon mint"><UsersRound size={19} /></span>
            <div><h2>新しい組織を作成</h2><p>最初の作成者はownerとして登録されます。</p></div>
          </div>
          <label>
            組織名
            <input required minLength={2} maxLength={80} disabled={Boolean(pendingAction)} value={organizationName} onChange={(event) => {
              const value = event.target.value;
              setOrganizationName(value);
              setPendingCreateRequest((current) => current && current.name !== value.trim() ? null : current);
            }} placeholder="例：プロダクト開発本部" />
          </label>
          {error && <div className="form-note production-error" role="alert"><span>{error}</span></div>}
          <button className="drawer-primary" type="submit" disabled={Boolean(pendingAction)}><Plus size={16} />{pendingAction === "create" ? "作成しています…" : pendingCreateRequest?.name === organizationName.trim() ? "同じ内容で再試行" : "組織を作成"}</button>
        </form>

        <button className="drawer-secondary production-sign-out" type="button" disabled={Boolean(pendingAction)} onClick={() => void onSignOut()}><LogOut size={15} />別のアカウントでログイン</button>
        {context.organizations.length === 0 && context.invitations.length === 0 && (
          <div className="form-note"><Check size={15} /><span>まだ所属組織はありません。組織を作成するか、管理者からの招待をお待ちください。</span></div>
        )}
      </div>
    </ProductionFrame>
  );
}

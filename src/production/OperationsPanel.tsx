import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Check, Clock3, History, KeyRound, MailPlus, MailX, RefreshCw, ShieldCheck, UsersRound, X } from "lucide-react";
import { ProductionRepository } from "./repository";
import type {
  AuditEvent,
  IntegrationClient,
  IntegrationScope,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationRole,
  OrganizationSummary,
} from "./types";
import { INTEGRATION_SCOPES } from "./types";

type OperationsPanelProps = {
  currentUserId: string;
  currentOrganization: OrganizationSummary;
  organizations: OrganizationSummary[];
  repository: ProductionRepository;
  onClose: () => void;
  onSelectOrganization: (organization: OrganizationSummary) => void;
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "運用情報を読み込めませんでした。もう一度お試しください。";
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function actionLabel(event: AuditEvent) {
  return event.summary;
}

function inviteStatusMessage(invitation: { email: string; role: string; authInvite?: "sent" | "existing" }) {
  if (invitation.authInvite === "existing") {
    return `${invitation.email}はすでにアカウントがあるため、ログイン後に招待を承認できます。`;
  }
  return `${invitation.email}へ招待メールを送りました。`;
}

const WRITABLE_INTEGRATION_SCOPES = INTEGRATION_SCOPES.filter((scope) => scope !== "workspace:read");
const INTEGRATION_SCOPE_LABELS: Record<IntegrationScope, string> = {
  "workspace:read": "メンバー・プロジェクト・アサイン・要員要件の参照",
  "members:write": "メンバーの登録・更新・アーカイブ",
  "projects:write": "プロジェクトの登録・更新・アーカイブ",
  "assignments:write": "アサインの登録・更新・取消",
  "staffing:write": "要員要件の登録・充足・取消",
};

function formatScopes(scopes: IntegrationScope[]) {
  return scopes.map((scope) => INTEGRATION_SCOPE_LABELS[scope] ?? scope).join(" / ");
}

function formatAuditData(value?: Record<string, unknown>) {
  return value ? JSON.stringify(value, null, 2) : "—";
}

export function OperationsPanel({
  currentUserId,
  currentOrganization,
  organizations,
  repository,
  onClose,
  onSelectOrganization,
}: OperationsPanelProps) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [clients, setClients] = useState<IntegrationClient[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<OrganizationRole, "owner">>("planner");
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviting, setInviting] = useState(false);
  const [memberAction, setMemberAction] = useState("");
  const [invitationAction, setInvitationAction] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientScopes, setClientScopes] = useState<IntegrationScope[]>(["workspace:read"]);
  const [issuingClient, setIssuingClient] = useState(false);
  const [clientAction, setClientAction] = useState("");
  const [issuedSecret, setIssuedSecret] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const canInvite = currentOrganization.role === "owner" || currentOrganization.role === "admin";
  const canViewAudit = canInvite;
  const effectiveInviteRole = currentOrganization.role !== "owner" && inviteRole === "admin" ? "planner" : inviteRole;

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const loadOperations = async () => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      repository.listOrganizationMembers(currentOrganization.id),
      canViewAudit ? repository.listAuditEvents(currentOrganization.id) : Promise.resolve({ events: [], nextBefore: undefined }),
      canInvite ? repository.listOrganizationInvitations(currentOrganization.id) : Promise.resolve([] as OrganizationInvitation[]),
      canInvite ? repository.listIntegrationClients(currentOrganization.id) : Promise.resolve([] as IntegrationClient[]),
    ]);
    const [memberResult, auditResult, invitationResult, clientResult] = results;
    if (memberResult.status === "fulfilled") setMembers(memberResult.value);
    if (auditResult.status === "fulfilled") {
      setEvents(auditResult.value.events);
      setNextBefore(auditResult.value.nextBefore);
    }
    if (invitationResult.status === "fulfilled") setInvitations(invitationResult.value);
    if (clientResult.status === "fulfilled") setClients(clientResult.value);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) setError(messageFrom(rejected.reason));
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      repository.listOrganizationMembers(currentOrganization.id),
      canViewAudit ? repository.listAuditEvents(currentOrganization.id) : Promise.resolve({ events: [], nextBefore: undefined }),
      canInvite ? repository.listOrganizationInvitations(currentOrganization.id) : Promise.resolve([] as OrganizationInvitation[]),
      canInvite ? repository.listIntegrationClients(currentOrganization.id) : Promise.resolve([] as IntegrationClient[]),
    ]).then((results) => {
      if (!active) return;
      const [memberResult, auditResult, invitationResult, clientResult] = results;
      if (memberResult.status === "fulfilled") setMembers(memberResult.value);
      if (auditResult.status === "fulfilled") {
        setEvents(auditResult.value.events);
        setNextBefore(auditResult.value.nextBefore);
      }
      if (invitationResult.status === "fulfilled") setInvitations(invitationResult.value);
      if (clientResult.status === "fulfilled") setClients(clientResult.value);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejected) setError(messageFrom(rejected.reason));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [canInvite, canViewAudit, currentOrganization.id, repository]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => panelRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = panelRef.current?.querySelectorAll<HTMLElement>(
        "a[href], area[href], button:not([disabled]), details > summary:first-of-type, input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable='true'], [tabindex]:not([tabindex='-1'])",
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      const activeElement = document.activeElement;
      if (activeElement === panelRef.current || !panelRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canInvite || inviting) return;
    setInviting(true);
    setInviteStatus("");
    setError("");
    try {
      const invitation = await repository.inviteMember(currentOrganization.id, inviteEmail, effectiveInviteRole);
      setInviteStatus(inviteStatusMessage(invitation));
      setInviteEmail("");
      await loadOperations();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setInviting(false);
    }
  };

  const resendInvitation = async (invitation: OrganizationInvitation) => {
    if (!canInvite || invitationAction) return;
    setInvitationAction(`resend:${invitation.id}`);
    setInviteStatus("");
    setError("");
    try {
      const result = await repository.inviteMember(currentOrganization.id, invitation.email, invitation.role);
      setInviteStatus(inviteStatusMessage(result));
      await loadOperations();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setInvitationAction("");
    }
  };

  const revokeInvitation = async (invitation: OrganizationInvitation) => {
    if (!canInvite || invitationAction) return;
    if (!window.confirm(`${invitation.email}への招待を取り消します。続けますか？`)) return;
    setInvitationAction(invitation.id);
    setInviteStatus("");
    setError("");
    try {
      await repository.revokeOrganizationInvitation(currentOrganization.id, invitation.id);
      setInviteStatus(`${invitation.email}への招待を取り消しました。`);
      await loadOperations();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setInvitationAction("");
    }
  };

  const toggleClientScope = (scope: IntegrationScope) => {
    setClientScopes((current) => {
      if (scope === "workspace:read") return current.includes("workspace:read") ? current : ["workspace:read", ...current];
      return current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope];
    });
  };

  const issueClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canInvite || issuingClient) return;
    setIssuingClient(true);
    setInviteStatus("");
    setIssuedSecret("");
    setError("");
    try {
      const scopes: IntegrationScope[] = clientScopes.includes("workspace:read")
        ? clientScopes
        : ["workspace:read", ...clientScopes];
      const result = await repository.createIntegrationClient(currentOrganization.id, clientName, scopes);
      setIssuedSecret(result.secret ?? "");
      setInviteStatus(result.secret
        ? `${result.client.name}の連携資格を発行しました。秘密鍵はこの画面を閉じるまでしか表示しません。`
        : `${result.client.name}の連携資格は既に発行済みです。秘密鍵は再表示できません。`);
      setClientName("");
      setClientScopes(["workspace:read"]);
      await loadOperations();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setIssuingClient(false);
    }
  };

  const copyIssuedSecret = async () => {
    if (!issuedSecret) return;
    try {
      await navigator.clipboard.writeText(issuedSecret);
      setInviteStatus("秘密鍵をコピーしました。パスワードマネージャへ保存してください。");
    } catch {
      setError("コピーできませんでした。表示中の秘密鍵を手動で控えてください。");
    }
  };

  const revokeClient = async (client: IntegrationClient) => {
    if (!canInvite || clientAction || client.status === "revoked") return;
    if (!window.confirm(`${client.name}の連携資格を失効します。既存のAPI/MCP接続は直ちに使えなくなります。続けますか？`)) return;
    setClientAction(client.id);
    setInviteStatus("");
    setError("");
    try {
      await repository.revokeIntegrationClient(currentOrganization.id, client.id);
      setInviteStatus(`${client.name}の連携資格を失効しました。`);
      await loadOperations();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setClientAction("");
    }
  };

  const loadMoreAuditEvents = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await repository.listAuditEvents(currentOrganization.id, 50, nextBefore);
      setEvents((current) => {
        const known = new Set(current.map((event) => event.id));
        return [...current, ...page.events.filter((event) => !known.has(event.id))];
      });
      setNextBefore(page.nextBefore);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setLoadingMore(false);
    }
  };

  const updateMemberAccess = async (member: OrganizationMember, role: OrganizationRole, status: OrganizationMember["status"]) => {
    if (!member.userId || memberAction) return;
    const description = status === "suspended" ? "利用を停止" : role !== member.role ? `権限を${role}へ変更` : "利用を再開";
    if (!window.confirm(`${member.name}さんの${description}します。続けますか？`)) return;
    setMemberAction(member.userId);
    setInviteStatus("");
    setError("");
    try {
      await repository.manageOrganizationMember(currentOrganization.id, member.userId, role, status);
      setInviteStatus(`${member.name}さんのアクセス設定を更新しました。`);
      await loadOperations();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setMemberAction("");
    }
  };

  const selectOrganization = (organizationId: string) => {
    if (organizationId === currentOrganization.id) return;
    const organization = organizations.find((item) => item.id === organizationId);
    if (!organization) return;
    onSelectOrganization(organization);
  };

  return (
    <div className="overlay production-operations-overlay">
      <button className="overlay-backdrop" aria-label="運用パネルを閉じる" onClick={onClose} />
      <section
        className="drawer production-operations-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="operations-title"
        tabIndex={-1}
      >
        <div className="drawer-top">
          <span className="drawer-kicker">WORKSPACE OPERATIONS</span>
          <button className="close-button" aria-label="運用パネルを閉じる" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="drawer-heading">
          <span className="drawer-icon cobalt"><ShieldCheck size={19} /></span>
          <div><h2 id="operations-title">組織と運用履歴</h2><p>{currentOrganization.name} · {currentOrganization.role}</p></div>
        </div>

        {organizations.length > 1 && (
          <div className="assignment-form production-organization-switcher">
            <label>
              表示する組織
              <select value={currentOrganization.id} onChange={(event) => selectOrganization(event.target.value)}>
                {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}
              </select>
            </label>
          </div>
        )}

        {error && <div className="form-note production-error" role="alert"><span>{error}</span></div>}
        {inviteStatus && <div className="form-note" role="status"><Check size={15} /><span>{inviteStatus}</span></div>}

        <div className="drawer-section-title"><span>メンバー</span><small>{loading ? "読込中" : `${members.length}名`}</small></div>
        <div className="allocation-list production-member-list">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const ownerCanManage = currentOrganization.role === "owner" && !isSelf && Boolean(member.userId);
            const adminCanManage = currentOrganization.role === "admin" && !isSelf && Boolean(member.userId) && (member.role === "planner" || member.role === "viewer");
            const canManageAccess = ownerCanManage || adminCanManage;
            return (
              <div key={member.membershipId ?? member.userId ?? `${member.name}-${member.role}`}>
                <span className="avatar lavender">{member.name.slice(0, 2)}</span>
                <span><strong>{member.name}{isSelf ? "（自分）" : ""}</strong><small>{member.email ?? (member.status === "active" ? "有効" : "利用停止中")} · {member.role}</small></span>
                {canManageAccess ? (
                  <span className="member-access-controls">
                    {ownerCanManage && <select aria-label={`${member.name}さんの権限`} value={member.role} disabled={Boolean(memberAction)} onChange={(event) => {
                      const role = event.target.value as OrganizationRole;
                      void updateMemberAccess(member, role, role === "owner" ? "active" : member.status);
                    }}><option value="owner">owner</option><option value="admin">admin</option><option value="planner">planner</option><option value="viewer">viewer</option></select>}
                    {member.role !== "owner" && <button className="row-open member-status-button" type="button" disabled={Boolean(memberAction)} onClick={() => void updateMemberAccess(member, member.role, member.status === "active" ? "suspended" : "active")}>{memberAction === member.userId ? "更新中" : member.status === "active" ? "利用停止" : "再開"}</button>}
                  </span>
                ) : <b>{member.status === "active" ? "有効" : "停止"}</b>}
              </div>
            );
          })}
          {!loading && members.length === 0 && <div><UsersRound size={16} /><span><strong>表示できるメンバーはいません</strong><small>権限または所属状況を確認してください。</small></span></div>}
        </div>

        {canInvite && (
          <>
            <div className="drawer-section-title"><span>保留中の招待</span><small>{loading ? "読込中" : `${invitations.length}件`}</small></div>
            <div className="allocation-list production-invitation-list">
              {invitations.map((invitation) => (
                <div key={invitation.id}>
                  <span className={`notice-icon ${invitation.status === "expired" ? "danger" : "info"}`}>{invitation.status === "expired" ? <Clock3 size={14} /> : <MailPlus size={14} />}</span>
                  <span>
                    <strong>{invitation.email}</strong>
                    <small>{invitation.role} · {invitation.status === "expired" ? "期限切れ" : `${formatDateTime(invitation.expiresAt)}まで`}{invitation.invitedByName ? ` · ${invitation.invitedByName}` : ""}</small>
                  </span>
                  <span className="member-access-controls">
                    <button className="row-open invitation-resend-button" type="button" disabled={Boolean(invitationAction)} onClick={() => void resendInvitation(invitation)}>
                      <MailPlus size={14} />{invitationAction === `resend:${invitation.id}` ? "再送中" : "再送"}
                    </button>
                    <button className="row-open invitation-revoke-button" type="button" disabled={Boolean(invitationAction)} onClick={() => void revokeInvitation(invitation)}>
                      <MailX size={14} />{invitationAction === invitation.id ? "取消中" : "取消"}
                    </button>
                  </span>
                </div>
              ))}
              {!loading && invitations.length === 0 && <div><MailPlus size={16} /><span><strong>保留中の招待はありません</strong><small>送った招待は受諾または取消までここに表示されます。</small></span></div>}
            </div>
          </>
        )}

        {canInvite && (
          <form className="assignment-form production-invite-form" onSubmit={invite}>
            <div className="drawer-section-title"><span>メンバーを招待</span><small>owner / admin</small></div>
            <label>
              メールアドレス
              <input required type="email" autoComplete="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@company.jp" />
            </label>
            <label>
              権限
              <select value={effectiveInviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<OrganizationRole, "owner">)}>
                {currentOrganization.role === "owner" && <option value="admin">admin · 組織運用</option>}
                <option value="planner">planner · アサイン編集</option>
                <option value="viewer">viewer · 閲覧のみ</option>
              </select>
            </label>
            <div className="form-note"><MailPlus size={15} /><span>招待メールを送ります。公開サインアップは使いません。届かない場合は再送してください。</span></div>
            <button className="drawer-primary" type="submit" disabled={inviting}><MailPlus size={15} />{inviting ? "送信中…" : "招待メールを送る"}</button>
          </form>
        )}

        {canInvite && (
          <>
            <div className="drawer-section-title"><span>外部連携</span><small>{loading ? "読込中" : `${clients.length}件`}</small></div>
            <div className="form-note"><KeyRound size={15} /><span>API・AI秘書・MCPは同じ業務カタログを使います。資格は人間のログインとは別です。公開エンドポイントはまだ発行しません。</span></div>
            {issuedSecret && (
              <div className="form-note production-secret-banner" role="status">
                <KeyRound size={15} />
                <span>
                  <strong>秘密鍵（再表示できません）</strong>
                  <code>{issuedSecret}</code>
                </span>
                <button className="row-open" type="button" onClick={() => void copyIssuedSecret()}>コピー</button>
              </div>
            )}
            <div className="allocation-list production-integration-list">
              {clients.map((client) => (
                <div key={client.id}>
                  <span className={`notice-icon ${client.status === "revoked" ? "danger" : "info"}`}><KeyRound size={14} /></span>
                  <span>
                    <strong>{client.name}</strong>
                    <small>
                      {client.status === "revoked" ? "失効済み" : "有効"}
                      {` · mosaic_sk_${client.keyPrefix}…`}
                      {` · ${formatScopes(client.scopes)}`}
                    </small>
                  </span>
                  {client.status === "active" ? (
                    <button className="row-open invitation-revoke-button" type="button" disabled={Boolean(clientAction)} onClick={() => void revokeClient(client)}>
                      {clientAction === client.id ? "失効中" : "失効"}
                    </button>
                  ) : <b>失効</b>}
                </div>
              ))}
              {!loading && clients.length === 0 && <div><KeyRound size={16} /><span><strong>発行済みの連携資格はありません</strong><small>owner / admin が名前とスコープを指定して発行します。</small></span></div>}
            </div>
            <form className="assignment-form production-invite-form" onSubmit={issueClient}>
              <div className="drawer-section-title"><span>連携資格を発行</span><small>最大20件</small></div>
              <label>
                名前
                <input required maxLength={80} value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="社内 MCP / レポート連携" />
              </label>
              <fieldset className="production-scope-list">
                <legend>許可する操作</legend>
                <label>
                  <input type="checkbox" checked disabled readOnly />
                  {INTEGRATION_SCOPE_LABELS["workspace:read"]}
                </label>
                {WRITABLE_INTEGRATION_SCOPES.map((scope) => (
                  <label key={scope}>
                    <input type="checkbox" checked={clientScopes.includes(scope)} onChange={() => toggleClientScope(scope)} />
                    {INTEGRATION_SCOPE_LABELS[scope]}
                  </label>
                ))}
              </fieldset>
              <div className="form-note"><ShieldCheck size={15} /><span>秘密鍵は発行直後に一度だけ表示します。任意のSQLやURLは実行できません。</span></div>
              <button className="drawer-primary" type="submit" disabled={issuingClient || !clientName.trim()}><KeyRound size={15} />{issuingClient ? "発行中…" : "連携資格を発行する"}</button>
            </form>
          </>
        )}

        {canViewAudit && (
          <>
            <div className="drawer-section-title"><span>監査ログ</span><button className="row-open" aria-label="監査ログを再読み込み" onClick={() => void loadOperations()}><RefreshCw size={14} /></button></div>
            <div className="allocation-list production-audit-list">
              {events.map((event) => (
                <div className="production-audit-event" key={event.id}>
                  <History size={15} />
                  <span><strong>{actionLabel(event)}</strong><small>{event.actorName} · {formatDateTime(event.createdAt)}</small></span>
                  {event.workspaceRevision !== undefined && <b>r{event.workspaceRevision}</b>}
                  <details className="production-audit-detail">
                    <summary>対象・変更前後・request ID</summary>
                    <dl>
                      <div><dt>対象</dt><dd>{event.entityType}{event.entityId ? ` / ${event.entityId}` : ""}</dd></div>
                      <div><dt>request ID</dt><dd>{event.requestId ?? "—"}</dd></div>
                      <div><dt>呼出元</dt><dd>{event.callerKind === "integration" ? `外部連携${event.integrationClientName ? ` / ${event.integrationClientName}` : ""}` : event.callerKind === "ai" ? "AI秘書" : "利用者"}</dd></div>
                      <div><dt>変更前</dt><dd><pre>{formatAuditData(event.oldData)}</pre></dd></div>
                      <div><dt>変更後</dt><dd><pre>{formatAuditData(event.newData)}</pre></dd></div>
                    </dl>
                  </details>
                </div>
              ))}
              {!loading && events.length === 0 && <div><History size={15} /><span><strong>監査ログはまだありません</strong><small>共有保存や招待の操作がここに記録されます。</small></span></div>}
            </div>
            {nextBefore && <button className="drawer-secondary production-load-more" type="button" disabled={loadingMore} onClick={() => void loadMoreAuditEvents()}>{loadingMore ? "読み込み中…" : "以前の履歴を読み込む"}</button>}
          </>
        )}
        <p className="production-runtime-info">Release {(import.meta.env.VITE_RELEASE || "local").slice(0, 12)} · {import.meta.env.VITE_APP_ENV || "development"}</p>
      </section>
    </div>
  );
}

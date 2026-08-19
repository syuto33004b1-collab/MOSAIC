import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Check, Clock3, History, MailPlus, MailX, RefreshCw, ShieldCheck, UsersRound, X } from "lucide-react";
import { ProductionRepository } from "./repository";
import type { AuditEvent, OrganizationInvitation, OrganizationMember, OrganizationRole, OrganizationSummary } from "./types";

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
    ]);
    const [memberResult, auditResult, invitationResult] = results;
    if (memberResult.status === "fulfilled") setMembers(memberResult.value);
    if (auditResult.status === "fulfilled") {
      setEvents(auditResult.value.events);
      setNextBefore(auditResult.value.nextBefore);
    }
    if (invitationResult.status === "fulfilled") setInvitations(invitationResult.value);
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
    ]).then((results) => {
      if (!active) return;
      const [memberResult, auditResult, invitationResult] = results;
      if (memberResult.status === "fulfilled") setMembers(memberResult.value);
      if (auditResult.status === "fulfilled") {
        setEvents(auditResult.value.events);
        setNextBefore(auditResult.value.nextBefore);
      }
      if (invitationResult.status === "fulfilled") setInvitations(invitationResult.value);
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

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import {
  ChatClientError,
  type ChatActionProposal,
  type ChatHistoryItem,
  type ChatTransport,
} from "../../lib/ai/chatClient";

export type AiChatRole = "owner" | "admin" | "planner" | "viewer";

export type AiChatProps = {
  transport?: ChatTransport;
  organizationId?: string;
  hasLocalChanges?: boolean;
  organizationRole?: AiChatRole;
  syncBusy?: boolean;
  onActionBusyChange?: (busy: boolean) => void;
  onWorkspaceRevision?: (revision: number) => void | Promise<void>;
  unavailableReason?: string;
  suspended?: boolean;
  elevated?: boolean;
};

type ProposalStatus = "pending" | "confirming" | "cancelling" | "confirmed" | "cancelled" | "superseded" | "error";

type ChatMessage = ChatHistoryItem & {
  id: string;
  proposal?: ChatActionProposal;
  proposalStatus?: ProposalStatus;
  proposalStatusMessage?: string;
};

type ActiveAction = {
  messageId: string;
  token: string;
  decision: "confirm" | "cancel";
};

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_VISIBLE_MESSAGES = 40;
const GENERIC_ERROR_MESSAGE = "回答を取得できませんでした。通信状況を確認して、もう一度お試しください。";
const GENERIC_ACTION_ERROR_MESSAGE = "変更案を処理できませんでした。内容を確認して、もう一度お試しください。";

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function proposalRequiresAdministrator(type: string) {
  const normalized = type.toLowerCase();
  return ["member", "person", "people", "organization", "invitation", "access", "role"].some((marker) => normalized.includes(marker));
}

function proposalBlockedReason(
  proposal: ChatActionProposal,
  options: { hasLocalChanges: boolean; role?: AiChatRole; syncBusy: boolean; now: number },
) {
  if (Date.parse(proposal.expiresAt) <= options.now) return "この変更案の有効期限が切れました。最新の内容でもう一度依頼してください。";
  if (options.hasLocalChanges) return "未保存の変更があります。先に保存するか、元に戻してから確認してください。";
  if (options.syncBusy) return "チームデータを同期しています。処理が終わってから確認してください。";
  if (!options.role) return "この組織での操作権限を確認できません。";
  if (options.role === "viewer") return "閲覧権限では変更できません。変更できるメンバーへ依頼してください。";
  if (options.role === "planner" && proposalRequiresAdministrator(proposal.type)) {
    return "この変更にはオーナーまたは管理者の権限が必要です。";
  }
  return "";
}

function proposalExpiryLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function safeConfirmLabel(proposal: ChatActionProposal) {
  if (!proposal.confirmLabel.includes("削除")) return proposal.confirmLabel;
  const type = proposal.type.toLowerCase();
  return type.includes("member") || type.includes("person") || type.includes("project")
    ? proposal.confirmLabel.replaceAll("削除", "アーカイブ")
    : proposal.confirmLabel.replaceAll("削除", "取消");
}

type ProposalCardProps = {
  activeAction: ActiveAction | null;
  blockedReason: string;
  messageRequestBusy: boolean;
  message: ChatMessage;
  onDecision: (message: ChatMessage, decision: "confirm" | "cancel") => void;
  setResultRef: (messageId: string, node: HTMLDivElement | null) => void;
};

function ProposalCard({ activeAction, blockedReason, messageRequestBusy, message, onDecision, setResultRef }: ProposalCardProps) {
  const proposal = message.proposal;
  if (!proposal) return null;
  const status = message.proposalStatus ?? "pending";
  const actionBusy = activeAction?.token === proposal.token;
  const settled = status === "confirmed" || status === "cancelled" || status === "superseded";
  const showActions = !settled && (status === "pending" || status === "error" || actionBusy);
  const titleId = `${message.id}-proposal-title`;
  const impactId = `${message.id}-proposal-impact`;
  const blockedId = `${message.id}-proposal-blocked`;
  const expiry = proposalExpiryLabel(proposal.expiresAt);
  const confirmLabel = safeConfirmLabel(proposal);

  return (
    <section
      className={classes(
        "ai-chat-proposal",
        proposal.destructive && "is-destructive",
        settled && "is-settled",
        status === "confirmed" && "is-confirmed",
      )}
      role="group"
      aria-labelledby={titleId}
      aria-busy={actionBusy}
    >
      <header className="ai-chat-proposal-header">
        <span className="ai-chat-proposal-icon" aria-hidden="true">
          {proposal.destructive ? <AlertTriangle size={16} /> : <ClipboardCheck size={16} />}
        </span>
        <span>
          <small>{proposal.destructive ? "確認が必要な変更" : "変更案"}</small>
          <h3 id={titleId}>{proposal.title}</h3>
        </span>
      </header>

      <p className="ai-chat-proposal-summary">{proposal.summary}</p>

      {proposal.details.length > 0 && (
        <dl className="ai-chat-proposal-details">
          {proposal.details.map((detail, index) => (
            <div key={`${detail.label}-${index}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {proposal.impacts.length > 0 && (
        <div className="ai-chat-proposal-impacts" id={impactId}>
          <strong>この操作の影響</strong>
          <ul>{proposal.impacts.map((impact, index) => <li key={`${impact}-${index}`}>{impact}</li>)}</ul>
        </div>
      )}

      <p className="ai-chat-proposal-meta">
        まだ変更されていません
        <span>revision {proposal.expectedRevision}{expiry ? ` · ${expiry}まで` : ""}</span>
      </p>
      <p className="ai-chat-proposal-disclosure">確認するとチームへ即時保存されます。未保存の手作業は含まれません。</p>

      {blockedReason && !settled && <p className="ai-chat-proposal-blocked" id={blockedId}>{blockedReason}</p>}

      {showActions && (
        <div className="ai-chat-proposal-actions">
          <button
            type="button"
            className="ai-chat-proposal-cancel"
            disabled={actionBusy || messageRequestBusy}
            onClick={() => onDecision(message, "cancel")}
          >
            {activeAction?.decision === "cancel" && actionBusy ? <LoaderCircle size={15} aria-hidden="true" /> : null}
            {activeAction?.decision === "cancel" && actionBusy ? "取り下げ中…" : "やめる"}
          </button>
          <button
            type="button"
            className={classes("ai-chat-proposal-confirm", proposal.destructive && "is-destructive")}
            aria-describedby={[proposal.impacts.length > 0 ? impactId : "", blockedReason ? blockedId : ""].filter(Boolean).join(" ") || undefined}
            disabled={actionBusy || messageRequestBusy || Boolean(blockedReason)}
            onClick={() => onDecision(message, "confirm")}
          >
            {activeAction?.decision === "confirm" && actionBusy ? <LoaderCircle size={15} aria-hidden="true" /> : null}
            {activeAction?.decision === "confirm" && actionBusy ? "保存中…" : confirmLabel}
          </button>
        </div>
      )}

      {status !== "pending" && status !== "confirming" && status !== "cancelling" && (
        <div
          className={classes("ai-chat-proposal-result", `is-${status}`)}
          ref={(node) => setResultRef(message.id, node)}
          role={status === "error" ? "alert" : "status"}
          tabIndex={-1}
        >
          {status === "confirmed" && <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{message.proposalStatusMessage}</span>
        </div>
      )}
    </section>
  );
}

export function AiChat({
  transport,
  organizationId,
  hasLocalChanges = false,
  organizationRole,
  syncBusy = false,
  onActionBusyChange,
  onWorkspaceRevision,
  unavailableReason,
  suspended = false,
  elevated = false,
}: AiChatProps) {
  const available = Boolean(transport && organizationId?.trim());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [interactionId, setInteractionId] = useState<string>();
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const [lastActionResultId, setLastActionResultId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const actionResultRefs = useRef(new Map<string, HTMLDivElement>());
  const messageSequenceRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const panelId = useId();
  const panelTitleId = useId();
  const availabilityDescriptionId = useId();
  const composerHelpId = useId();
  const unavailableMessage = unavailableReason?.trim() || "AIアシスタントは現在利用できません。";
  const visibleOpen = open && !suspended;
  const busy = loading || Boolean(activeAction);
  const workspaceNotice = hasLocalChanges
    ? "未保存の変更は回答に含まれません。新しい操作は、先に保存するか元に戻すと確認できます。"
    : syncBusy
      ? "チームデータを同期中です。参照はできますが、変更の確認は同期後に行えます。"
      : organizationRole === "viewer"
        ? "閲覧権限で利用中です。データの参照と相談ができます。"
        : "";

  const nextMessageId = (messageRole: ChatHistoryItem["role"]) => {
    messageSequenceRef.current += 1;
    return `ai-chat-${messageRole}-${messageSequenceRef.current}`;
  };

  const closeChat = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) launcherRef.current?.focus();
  }, []);

  const setResultRef = useCallback((messageId: string, node: HTMLDivElement | null) => {
    if (node) actionResultRefs.current.set(messageId, node);
    else actionResultRefs.current.delete(messageId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onActionBusyChange?.(false);
    };
  }, [onActionBusyChange]);

  useEffect(() => {
    if (!visibleOpen) return;
    const focusTarget = available ? composerRef.current : closeRef.current;
    focusTarget?.focus();
  }, [available, visibleOpen]);

  useEffect(() => {
    if (!visibleOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeChat();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeChat, visibleOpen]);

  useEffect(() => {
    if (!visibleOpen) return;
    logEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [activeAction, error, loading, messages, visibleOpen]);

  useEffect(() => {
    if (!lastActionResultId || !visibleOpen) return;
    actionResultRefs.current.get(lastActionResultId)?.focus();
  }, [lastActionResultId, visibleOpen]);

  useEffect(() => {
    const expiries = messages.flatMap((message) => {
      if (!message.proposal || (message.proposalStatus !== "pending" && message.proposalStatus !== "error")) return [];
      const expiry = Date.parse(message.proposal.expiresAt);
      return Number.isFinite(expiry) && expiry > now ? [expiry] : [];
    });
    if (expiries.length === 0) return;
    const delay = Math.min(Math.max(0, Math.min(...expiries) - Date.now() + 50), 2_147_483_647);
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [messages, now]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    const scopedOrganizationId = organizationId?.trim();
    if (!transport || !scopedOrganizationId || !message || requestInFlightRef.current) return;

    const history = interactionId
      ? []
      : messages
          .slice(-MAX_HISTORY_MESSAGES)
          .map(({ role: messageRole, content }) => ({ role: messageRole, content }));
    const userMessage: ChatMessage = {
      id: nextMessageId("user"),
      role: "user",
      content: message,
    };

    requestInFlightRef.current = true;
    setLoading(true);
    setError("");
    setDraft("");
    setMessages((current) => [...current, userMessage].slice(-MAX_VISIBLE_MESSAGES));

    try {
      const response = await transport({
        kind: "message",
        organizationId: scopedOrganizationId,
        message,
        history,
        hasLocalChanges,
        ...(interactionId ? { previousInteractionId: interactionId } : {}),
      });
      const reply = response.reply.trim();
      if (!reply) throw new Error("AI response was empty.");
      if (!mountedRef.current) return;
      const assistantMessage: ChatMessage = {
        id: nextMessageId("assistant"),
        role: "assistant",
        content: reply,
        ...(response.proposal ? { proposal: response.proposal, proposalStatus: "pending" as const } : {}),
      };
      setMessages((current) => [
        ...current.map((item) => response.proposal && item.proposal && (item.proposalStatus === "pending" || item.proposalStatus === "error") ? {
          ...item,
          proposalStatus: "superseded" as const,
          proposalStatusMessage: "新しい変更案が作成されたため、この変更案は確認できません。",
        } : item),
        assistantMessage,
      ].slice(-MAX_VISIBLE_MESSAGES));
      setInteractionId(response.interactionId);
      setNow(Date.now());
    } catch (reason) {
      if (!mountedRef.current) return;
      setMessages((current) => current.filter((item) => item.id !== userMessage.id));
      setDraft((current) => current || message);
      setError(reason instanceof ChatClientError ? reason.message : GENERIC_ERROR_MESSAGE);
    } finally {
      requestInFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleProposalDecision = async (message: ChatMessage, decision: "confirm" | "cancel") => {
    const proposal = message.proposal;
    const scopedOrganizationId = organizationId?.trim();
    if (!transport || !proposal || !scopedOrganizationId || requestInFlightRef.current) return;
    const blockedReason = proposalBlockedReason(proposal, { hasLocalChanges, role: organizationRole, syncBusy, now: Date.now() });
    if (decision === "confirm" && blockedReason) return;

    requestInFlightRef.current = true;
    const action: ActiveAction = { messageId: message.id, token: proposal.token, decision };
    onActionBusyChange?.(true);
    setActiveAction(action);
    setLastActionResultId("");
    setError("");
    setMessages((current) => current.map((item) => item.id === message.id ? {
      ...item,
      proposalStatus: decision === "confirm" ? "confirming" : "cancelling",
      proposalStatusMessage: "",
    } : item));

    try {
      const response = await transport({
        kind: "action",
        organizationId: scopedOrganizationId,
        actionToken: proposal.token,
        decision,
      });
      let statusMessage = response.reply.trim();
      if (decision === "confirm" && response.workspaceRevision !== undefined && onWorkspaceRevision) {
        try {
          await onWorkspaceRevision(response.workspaceRevision);
        } catch {
          statusMessage += " 変更は保存されましたが、画面を更新できませんでした。ページを再読み込みしてください。";
        }
      }
      if (!mountedRef.current) return;
      setInteractionId(response.interactionId);
      setMessages((current) => current.map((item) => item.id === message.id ? {
        ...item,
        proposalStatus: decision === "confirm" ? "confirmed" : "cancelled",
        proposalStatusMessage: statusMessage || (decision === "confirm" ? "変更を反映しました。" : "変更案を取り下げました。"),
      } : item));
      setLastActionResultId(message.id);
    } catch (reason) {
      if (!mountedRef.current) return;
      const actionError = reason instanceof ChatClientError ? reason : undefined;
      const proposalExpired = actionError
        ? ["ACCESS_CHANGED", "ACTION_REJECTED", "INVALID_ACTION_PLAN", "INVALID_ACTION_TOKEN", "WORKSPACE_CONFLICT"].includes(actionError.code)
        : false;
      setMessages((current) => current.map((item) => item.id === message.id ? {
        ...item,
        proposalStatus: proposalExpired ? "superseded" : "error",
        proposalStatusMessage: actionError?.message ?? GENERIC_ACTION_ERROR_MESSAGE,
      } : item));
      setLastActionResultId(message.id);
    } finally {
      requestInFlightRef.current = false;
      onActionBusyChange?.(false);
      if (mountedRef.current) setActiveAction(null);
    }
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const clearConversation = () => {
    setMessages([]);
    setError("");
    setInteractionId(undefined);
    setLastActionResultId("");
    composerRef.current?.focus();
  };

  return (
    <div
      className={classes("ai-chat-root", elevated && "is-elevated", suspended && "is-suspended", !available && "is-unavailable")}
      inert={suspended ? true : undefined}
    >
      {visibleOpen && (
        <section
          className="ai-chat-panel"
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={panelTitleId}
        >
          <header className="ai-chat-header">
            <span className="ai-chat-header-icon" aria-hidden="true"><Sparkles size={17} /></span>
            <span className="ai-chat-heading">
              <small>MOSAIC ASSIST</small>
              <h2 id={panelTitleId}>AI秘書</h2>
            </span>
            {messages.length > 0 && !busy && (
              <button className="ai-chat-clear" type="button" onClick={clearConversation}>会話をクリア</button>
            )}
            <button
              className="ai-chat-close"
              type="button"
              ref={closeRef}
              aria-label="AIチャットを閉じる"
              onClick={() => closeChat()}
            >
              <X size={18} />
            </button>
          </header>

          <div
            className="ai-chat-log"
            role="log"
            aria-label="AIとの会話履歴"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={busy}
          >
            {messages.length === 0 && (
              <div className="ai-chat-intro">
                <span aria-hidden="true"><Sparkles size={16} /></span>
                <div>
                  <strong>相談も操作も、ここから</strong>
                  <p>保存済みデータを確認し、必要な変更は実行前に内容をご提示します。</p>
                </div>
              </div>
            )}

            {workspaceNotice && available && <p className="ai-chat-context-note" role="status">{workspaceNotice}</p>}

            {!available && (
              <div className="ai-chat-unavailable" id={availabilityDescriptionId} role="status">
                <strong>現在は利用できません</strong>
                <p>{unavailableMessage}</p>
              </div>
            )}

            {messages.map((message) => {
              const blockedReason = message.proposal ? proposalBlockedReason(message.proposal, { hasLocalChanges, role: organizationRole, syncBusy, now }) : "";
              return (
                <article
                  className={classes("ai-chat-message", message.role === "user" ? "is-user" : "is-model")}
                  key={message.id}
                >
                  <small>{message.role === "user" ? "あなた" : "MOSAIC AI"}</small>
                  <p>{message.content}</p>
                  <ProposalCard
                    activeAction={activeAction}
                    blockedReason={blockedReason}
                    messageRequestBusy={loading}
                    message={message}
                    onDecision={(item, decision) => void handleProposalDecision(item, decision)}
                    setResultRef={setResultRef}
                  />
                </article>
              );
            })}

            {loading && (
              <div className="ai-chat-thinking" role="status">
                <LoaderCircle size={15} aria-hidden="true" />
                <span>回答を考えています…</span>
              </div>
            )}

            {error && <p className="ai-chat-error" role="alert">{error}</p>}
            <div ref={logEndRef} aria-hidden="true" />
          </div>

          <form className="ai-chat-composer" onSubmit={(event) => void sendMessage(event)}>
            <div className="ai-chat-composer-row">
              <label className="sr-only" htmlFor={`${panelId}-composer`}>AIへのメッセージ</label>
              <textarea
                id={`${panelId}-composer`}
                ref={composerRef}
                value={draft}
                rows={2}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={available ? "AI秘書に依頼・相談する" : "現在はメッセージを送信できません"}
                aria-describedby={available ? composerHelpId : `${composerHelpId} ${availabilityDescriptionId}`}
                disabled={!available || busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <button
                type="submit"
                aria-label={busy ? "処理が終わるのを待っています" : "メッセージを送信"}
                disabled={!available || busy || !draft.trim()}
              >
                {busy ? <LoaderCircle size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
              </button>
            </div>
            <p id={composerHelpId}>Enterで送信 · Shift + Enterで改行 · 変更は確認ボタンから実行</p>
          </form>
        </section>
      )}

      {!available && !visibleOpen && <span className="sr-only" id={availabilityDescriptionId}>{unavailableMessage}</span>}
      <button
        className="ai-chat-launcher"
        type="button"
        ref={launcherRef}
        aria-label={visibleOpen ? "AIアシスタントを閉じる" : available ? "AIアシスタントを開く" : "AIアシスタントの利用状況を確認"}
        aria-expanded={visibleOpen}
        aria-controls={panelId}
        aria-describedby={!available && !visibleOpen ? availabilityDescriptionId : undefined}
        onClick={() => {
          if (visibleOpen) closeChat();
          else setOpen(true);
        }}
      >
        {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
      </button>
    </div>
  );
}

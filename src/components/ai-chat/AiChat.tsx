import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { ChatClientError, type ChatHistoryItem, type ChatTransport } from "../../lib/ai/chatClient";

export type AiChatProps = {
  transport?: ChatTransport;
  unavailableReason?: string;
  suspended?: boolean;
  elevated?: boolean;
};

type ChatMessage = ChatHistoryItem & {
  id: string;
};

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_VISIBLE_MESSAGES = 40;
const GENERIC_ERROR_MESSAGE = "回答を取得できませんでした。通信状況を確認して、もう一度お試しください。";

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function AiChat({
  transport,
  unavailableReason,
  suspended = false,
  elevated = false,
}: AiChatProps) {
  const available = Boolean(transport);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [interactionId, setInteractionId] = useState<string>();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const messageSequenceRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const panelId = useId();
  const panelTitleId = useId();
  const availabilityDescriptionId = useId();
  const composerHelpId = useId();
  const unavailableMessage = unavailableReason?.trim() || "AIアシスタントは現在利用できません。";
  const visibleOpen = open && !suspended;

  const nextMessageId = (role: ChatHistoryItem["role"]) => {
    messageSequenceRef.current += 1;
    return `ai-chat-${role}-${messageSequenceRef.current}`;
  };

  const closeChat = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) launcherRef.current?.focus();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
  }, [error, loading, messages, visibleOpen]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!transport || !message || requestInFlightRef.current) return;

    const history = interactionId
      ? []
      : messages
          .slice(-MAX_HISTORY_MESSAGES)
          .map(({ role, content }) => ({ role, content }));
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
        message,
        history,
        ...(interactionId ? { previousInteractionId: interactionId } : {}),
      });
      const reply = response.reply.trim();
      if (!reply) throw new Error("AI response was empty.");
      if (!mountedRef.current) return;
      const assistantMessage: ChatMessage = {
        id: nextMessageId("assistant"),
        role: "assistant",
        content: reply,
      };
      setMessages((current) => [...current, assistantMessage].slice(-MAX_VISIBLE_MESSAGES));
      setInteractionId(response.interactionId);
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

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const clearConversation = () => {
    setMessages([]);
    setError("");
    setInteractionId(undefined);
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
              <h2 id={panelTitleId}>AIに聞く</h2>
            </span>
            {messages.length > 0 && !loading && (
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
            aria-busy={loading}
          >
            {messages.length === 0 && (
              <div className="ai-chat-intro">
                <span aria-hidden="true"><Sparkles size={16} /></span>
                <div>
                  <strong>MOSAICについて聞いてみてください</strong>
                  <p>機能の概要や、画面の見方・操作方法を簡潔にご案内します。</p>
                </div>
              </div>
            )}

            {!available && (
              <div className="ai-chat-unavailable" id={availabilityDescriptionId} role="status">
                <strong>現在は利用できません</strong>
                <p>{unavailableMessage}</p>
              </div>
            )}

            {messages.map((message) => (
              <article
                className={classes("ai-chat-message", message.role === "user" ? "is-user" : "is-model")}
                key={message.id}
              >
                <small>{message.role === "user" ? "あなた" : "MOSAIC AI"}</small>
                <p>{message.content}</p>
              </article>
            ))}

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
                placeholder={available ? "MOSAICについて質問する" : "現在はメッセージを送信できません"}
                aria-describedby={available ? composerHelpId : `${composerHelpId} ${availabilityDescriptionId}`}
                disabled={!available || loading}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <button
                type="submit"
                aria-label={loading ? "回答を待っています" : "メッセージを送信"}
                disabled={!available || loading || !draft.trim()}
              >
                {loading ? <LoaderCircle size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
              </button>
            </div>
            <p id={composerHelpId}>Enterで送信 · Shift + Enterで改行</p>
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

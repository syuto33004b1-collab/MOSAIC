import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { User } from "@supabase/supabase-js";
import App from "../App";
import { getSupabaseClient, getSupabaseRuntimeConfiguration } from "../lib/supabase";
import { createSupabaseChatTransport, type ChatTransport } from "../lib/ai/chatClient";
import { AuthScreen } from "./AuthScreen";
import { OperationsPanel } from "./OperationsPanel";
import { OrganizationSetup } from "./OrganizationSetup";
import { ProductionFrame, ProductionState } from "./ProductionFrame";
import { ProductionRepository } from "./repository";
import type {
  MyContext,
  OrganizationSummary,
  PendingInvitation,
  ProductionAppProps,
  WorkspaceEnvelope,
} from "./types";

const SharedApp = App as ComponentType<ProductionAppProps>;

type AuthState =
  | { status: "checking"; user: null; error: "" }
  | { status: "ready"; user: User | null; error: "" }
  | { status: "error"; user: null; error: string };

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "処理を完了できませんでした。もう一度お試しください。";
}

function storedOrganizationKey(userId: string) {
  return `mosaic-active-organization:${userId}`;
}

function invitationIdFromLocation() {
  const parameters = new URLSearchParams(window.location.search);
  return parameters.get("invitation") ?? parameters.get("invitation_id") ?? parameters.get("invite");
}

function clearInvitationFromLocation() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invitation");
  url.searchParams.delete("invitation_id");
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

type SharedWorkspaceRouteProps = {
  context: MyContext;
  currentOrganization: OrganizationSummary;
  organizations: OrganizationSummary[];
  repository: ProductionRepository;
  onSelectOrganization: (organization: OrganizationSummary) => void;
  onSignOut: () => void;
  onAccessInvalidated: () => void;
  aiChatTransport: ChatTransport;
};

type SharedWorkspaceRepository = Pick<ProductionRepository, "getWorkspace" | "saveWorkspace" | "subscribeToWorkspace">;

export function createSharedWorkspaceController(
  repository: SharedWorkspaceRepository,
  organizationId: string,
  initialRole: OrganizationSummary["role"] | null = null,
) {
  let baseline: WorkspaceEnvelope["state"] | null = null;
  let role = initialRole;

  return {
    setRole(nextRole: OrganizationSummary["role"]) {
      role = nextRole;
    },
    setBaseline(state: WorkspaceEnvelope["state"] | null) {
      baseline = state;
    },
    async reload() {
      const latest = await repository.getWorkspace(organizationId);
      baseline = latest.state;
      return { revision: latest.revision, state: latest.state };
    },
    async save(
      state: WorkspaceEnvelope["state"],
      expectedRevision: number,
      requestId: string,
    ) {
      if (!baseline) throw new Error("共有ワークスペースの保存基準を確認できませんでした。");
      if (!role) throw new Error("共有ワークスペースの操作権限を確認できませんでした。");
      const result = await repository.saveWorkspace(
        organizationId,
        state,
        expectedRevision,
        requestId,
        baseline,
        role,
      );
      baseline = state;
      return result;
    },
    subscribe(onRevision: (revision?: number) => void) {
      return repository.subscribeToWorkspace(organizationId, onRevision);
    },
  };
}

function SharedWorkspaceRoute({
  context,
  currentOrganization,
  organizations,
  repository,
  onSelectOrganization,
  onSignOut,
  onAccessInvalidated,
  aiChatTransport,
}: SharedWorkspaceRouteProps) {
  const [workspace, setWorkspace] = useState<WorkspaceEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const sharedController = useMemo(
    () => createSharedWorkspaceController(repository, currentOrganization.id),
    [currentOrganization.id, repository],
  );

  useLayoutEffect(() => {
    sharedController.setRole(currentOrganization.role);
  }, [currentOrganization.role, sharedController]);

  useEffect(() => {
    let active = true;
    repository.getWorkspace(currentOrganization.id)
      .then((result) => {
        if (active) {
          setWorkspace(result);
          sharedController.setBaseline(result.state);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          if (typeof reason === "object" && reason !== null && "code" in reason && reason.code === "FORBIDDEN") onAccessInvalidated();
          setError(messageFrom(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentOrganization.id, onAccessInvalidated, repository, retryKey, sharedController]);

  const shared = useMemo(() => workspace ? {
    initialRevision: workspace.revision,
    initialState: workspace.state,
    reload: sharedController.reload,
    save: sharedController.save,
    subscribe: sharedController.subscribe,
  } : undefined, [sharedController, workspace]);

  if (loading) {
    return <ProductionState eyebrow="SHARED WORKSPACE" title="共有データを読み込み中" description={`${currentOrganization.name}の最新アサインを確認しています。`} />;
  }

  if (error || !workspace || !shared) {
    return (
      <ProductionState
        eyebrow="SHARED WORKSPACE"
        title="共有データを読み込めません"
        description={error || "ワークスペースの応答を確認できませんでした。"}
        error
        actionLabel="再読み込み"
        onAction={() => {
          setLoading(true);
          setError("");
          setWorkspace(null);
          sharedController.setBaseline(null);
          setRetryKey((value) => value + 1);
        }}
      />
    );
  }

  return (
    <>
      <div inert={operationsOpen ? true : undefined}>
        <SharedApp
          key={currentOrganization.id}
          mode="shared"
          organizationName={currentOrganization.name}
          identity={{ email: context.email, name: context.name, role: currentOrganization.role }}
          shared={shared}
          onSignOut={onSignOut}
          onOpenOperations={() => setOperationsOpen(true)}
          onAccessInvalidated={onAccessInvalidated}
          aiChatTransport={aiChatTransport}
        />
      </div>
      {operationsOpen && (
        <OperationsPanel
          currentUserId={context.userId}
          currentOrganization={currentOrganization}
          organizations={organizations}
          repository={repository}
          onClose={() => setOperationsOpen(false)}
          onSelectOrganization={(organization) => {
            setOperationsOpen(false);
            onSelectOrganization(organization);
          }}
        />
      )}
    </>
  );
}

export function ProductionGate() {
  const client = useMemo(() => getSupabaseClient(), []);
  const repository = useMemo(() => new ProductionRepository(client), [client]);
  const aiChatTransport = useMemo(() => createSupabaseChatTransport(client), [client]);
  const [auth, setAuth] = useState<AuthState>({ status: "checking", user: null, error: "" });
  const [context, setContext] = useState<MyContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [contextRetryKey, setContextRetryKey] = useState(0);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const processedInvitationRef = useRef("");
  const hasLoadedContext = context !== null;

  useEffect(() => {
    let active = true;
    client.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error && error.name !== "AuthSessionMissingError") {
        setAuth({ status: "error", user: null, error: "セッションを確認できませんでした。通信状況を確認してください。" });
        return;
      }
      setAuth({ status: "ready", user: data.user, error: "" });
    });

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuth({ status: "ready", user: session?.user ?? null, error: "" });
      if (!session?.user) {
        setContext(null);
        setSelectedOrganizationId(null);
        setInvitationError("");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const loadContext = useCallback(async (user: User) => {
    const nextContext = await repository.getMyContext(user);
    setContext(nextContext);
    return nextContext;
  }, [repository]);

  const refreshAccessNow = useCallback(async () => {
    if (auth.status !== "ready" || !auth.user) return;
    try {
      const nextContext = await repository.getMyContext(auth.user);
      setContext(nextContext);
      setContextError("");
      setSelectedOrganizationId((current) => current && nextContext.organizations.some((organization) => organization.id === current) ? current : null);
    } catch (reason) {
      // A foreground authorization failure must fail closed: do not keep a
      // previously visible organization mounted while access is uncertain.
      setContext(null);
      setSelectedOrganizationId(null);
      setContextError(messageFrom(reason));
    }
  }, [auth.status, auth.user, repository]);

  useEffect(() => {
    if (auth.status !== "ready" || !auth.user) return;
    let active = true;
    repository.getMyContext(auth.user)
      .then((nextContext) => {
        if (!active) return;
        setContext(nextContext);
        setContextError("");
        const storedId = window.localStorage.getItem(storedOrganizationKey(auth.user!.id));
        const storedOrganization = nextContext.organizations.find((organization) => organization.id === storedId);
        if (storedOrganization) setSelectedOrganizationId(storedOrganization.id);
        else if (nextContext.organizations.length === 1) setSelectedOrganizationId(nextContext.organizations[0].id);
        else setSelectedOrganizationId(null);
      })
      .catch((reason: unknown) => {
        if (active) setContextError(messageFrom(reason));
      })
      .finally(() => {
        if (active) setContextLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.status, auth.user, contextRetryKey, repository]);

  useEffect(() => {
    if (auth.status !== "ready" || !auth.user || !hasLoadedContext) return;
    let active = true;
    let refreshing = false;
    const refreshAccess = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const nextContext = await repository.getMyContext(auth.user!);
        if (!active) return;
        setContext(nextContext);
        setSelectedOrganizationId((current) => current && nextContext.organizations.some((organization) => organization.id === current) ? current : null);
      } catch {
        // A transient background check must not replace a usable workspace.
        // Foreground RPCs still enforce the latest database role immediately.
      } finally {
        refreshing = false;
      }
    };
    const handleFocus = () => void refreshAccess();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshAccess();
    };
    const timer = window.setInterval(() => void refreshAccess(), 30_000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [auth.status, auth.user, hasLoadedContext, repository]);

  useEffect(() => {
    if (auth.status !== "ready" || !auth.user || !context) return;
    const invitationId = invitationIdFromLocation();
    if (!invitationId || processedInvitationRef.current === invitationId) return;
    processedInvitationRef.current = invitationId;
    setInvitationError("");
    repository.acceptInvitation(invitationId)
      .then(async (accepted) => {
        clearInvitationFromLocation();
        const nextContext = await loadContext(auth.user!);
        const organizationId = accepted.organizationId ?? nextContext.organizations.find((item) => item.name === accepted.organizationName)?.id;
        if (organizationId) setSelectedOrganizationId(organizationId);
      })
      .catch((reason: unknown) => {
        clearInvitationFromLocation();
        setInvitationError(`招待リンクを処理できませんでした。${messageFrom(reason)} 所属情報はそのまま利用できます。`);
      });
  }, [auth.status, auth.user, context, loadContext, repository]);

  const signIn = async (email: string, password: string) => {
    const user = await repository.signIn(email, password);
    if (user) setAuth({ status: "ready", user, error: "" });
  };

  const signOut = async () => {
    try {
      await repository.signOut();
      setAuth({ status: "ready", user: null, error: "" });
      setContext(null);
      setSelectedOrganizationId(null);
      setInvitationError("");
    } catch (reason) {
      setContextError(messageFrom(reason));
    }
  };

  const selectOrganization = (organization: OrganizationSummary) => {
    if (auth.status !== "ready" || !auth.user) return;
    window.localStorage.setItem(storedOrganizationKey(auth.user.id), organization.id);
    setSelectedOrganizationId(organization.id);
  };

  const refreshAndSelect = async (organizationId?: string) => {
    if (auth.status !== "ready" || !auth.user) return;
    const nextContext = await loadContext(auth.user);
    const organization = nextContext.organizations.find((item) => item.id === organizationId)
      ?? nextContext.organizations[nextContext.organizations.length - 1];
    if (organization) selectOrganization(organization);
  };

  const createOrganization = async (name: string, requestId: string) => {
    const organization = await repository.createOrganization(name, requestId);
    await refreshAndSelect(organization?.id);
  };

  const acceptInvitation = async (invitation: PendingInvitation) => {
    const accepted = await repository.acceptInvitation(invitation.id);
    await refreshAndSelect(accepted.organizationId ?? invitation.organizationId);
  };

  if (auth.status === "checking") {
    return <ProductionState eyebrow="SECURE SESSION" title="セッションを確認中" description="安全なチームワークスペースを準備しています。" />;
  }

  if (auth.status === "error") {
    return <ProductionState eyebrow="SECURE SESSION" title="セッションを確認できません" description={auth.error} error actionLabel="再読み込み" onAction={() => window.location.reload()} />;
  }

  if (!auth.user) return <AuthScreen onSignIn={signIn} />;

  if (contextLoading || (!context && !contextError)) {
    return <ProductionState eyebrow="ORGANIZATION ACCESS" title="所属情報を読み込み中" description="利用できる組織と権限を確認しています。" />;
  }

  if (contextError || !context) {
    return (
      <ProductionState
        eyebrow="ORGANIZATION ACCESS"
        title="所属情報を読み込めません"
        description={contextError || "アカウント情報の応答を確認できませんでした。"}
        error
        actionLabel="再試行"
        onAction={() => {
          processedInvitationRef.current = "";
          setContextError("");
          setContextRetryKey((value) => value + 1);
        }}
      />
    );
  }

  const invitationNotice = invitationError ? (
    <div className="toast show production-invitation-notice" role="alert">
      <span>{invitationError}</span>
      <button type="button" onClick={() => setInvitationError("")}>閉じる</button>
    </div>
  ) : null;

  const selectedOrganization = context.organizations.find((organization) => organization.id === selectedOrganizationId);
  if (!selectedOrganization) {
    return (
      <>
        {invitationNotice}
        <OrganizationSetup
          context={context}
          onAcceptInvitation={acceptInvitation}
          onCreate={createOrganization}
          onSelect={selectOrganization}
          onSignOut={signOut}
        />
      </>
    );
  }

  return (
    <>
      {invitationNotice}
      <SharedWorkspaceRoute
        context={context}
        key={selectedOrganization.id}
        currentOrganization={selectedOrganization}
        organizations={context.organizations}
        repository={repository}
        onSelectOrganization={selectOrganization}
        onSignOut={() => void signOut()}
        onAccessInvalidated={refreshAccessNow}
        aiChatTransport={aiChatTransport}
      />
    </>
  );
}

export default function RootApp() {
  const configuration = getSupabaseRuntimeConfiguration();
  if (configuration.mode === "demo") return <SharedApp mode="demo" />;
  if (configuration.mode === "invalid") {
    return (
      <ProductionFrame eyebrow="CONFIGURATION" title="共有モードを開始できません" description="Supabaseの接続設定を確認してください。">
        <div className="empty-state production-state" role="alert">
          <strong>接続設定が不完全です</strong>
          <p>{configuration.message}</p>
        </div>
      </ProductionFrame>
    );
  }
  return <ProductionGate />;
}

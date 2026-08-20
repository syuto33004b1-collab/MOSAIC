import type { PersonScope, RestrictableFeature, WorkspaceState } from "../domain";
import type { ChatTransport } from "../lib/ai/chatClient";
import type { Favorite, FavoriteKind } from "../collaboration";

export type OrganizationRole = "owner" | "admin" | "planner" | "viewer";

export type ProductionIdentity = {
  name: string;
  email: string;
  role: OrganizationRole;
  userId?: string;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  role: OrganizationRole;
  slug?: string;
  accessRevision?: number;
};

export type PendingInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  expiresAt?: string;
};

export type MyContext = {
  userId: string;
  name: string;
  email: string;
  organizations: OrganizationSummary[];
  invitations: PendingInvitation[];
};

/** The caller's own resolved limits, decided by the database and read-only here. */
export type WorkspacePermissions = {
  personScope: PersonScope;
  hiddenFieldKeys: string[];
  readonlyFieldKeys: string[];
  disabledFeatures: RestrictableFeature[];
};

export type WorkspaceEnvelope = {
  state: WorkspaceState;
  revision: number;
  savedAt?: string;
  permissions?: WorkspacePermissions;
};

export type SaveWorkspaceResult = {
  revision: number;
  savedAt: string;
};

export type SharedWorkspaceAdapter = {
  initialState: WorkspaceState;
  initialRevision: number;
  initialPermissions?: WorkspacePermissions;
  save: (state: WorkspaceState, expectedRevision: number, requestId: string) => Promise<SaveWorkspaceResult>;
  reload: () => Promise<{ state: WorkspaceState; revision: number; permissions?: WorkspacePermissions }>;
  subscribe: (onRevision: (revision?: number) => void) => () => void;
  listFavorites?: () => Promise<Favorite[]>;
  setFavorite?: (kind: FavoriteKind, targetId: string, favorite: boolean) => Promise<Favorite[]>;
  submitProfileRequest?: (
    requestId: string,
    proposed: { skills: string; workHistory: NonNullable<WorkspaceState["members"][number]["workHistory"]> },
    expectedRevision: number,
    requestIdToken: string,
  ) => Promise<SaveWorkspaceResult & { state?: WorkspaceState }>;
};

export type ProductionAppProps = {
  mode?: "demo" | "shared";
  organizationId?: string;
  organizationName?: string;
  identity?: ProductionIdentity;
  shared?: SharedWorkspaceAdapter;
  onSignOut?: () => void;
  onOpenOperations?: () => void;
  onAccessInvalidated?: () => void;
  aiChatTransport?: ChatTransport;
};

export type OrganizationMember = {
  membershipId?: string;
  userId?: string;
  email?: string;
  name: string;
  role: OrganizationRole;
  status: "active" | "suspended";
  joinedAt?: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  actorName: string;
  actorEmail?: string;
  createdAt: string;
  summary: string;
  requestId?: string;
  workspaceRevision?: number;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  callerKind?: "user" | "ai" | "integration";
  integrationClientId?: string;
  integrationClientName?: string;
};

export type AuditEventPage = {
  events: AuditEvent[];
  nextBefore?: string;
};

export type SaveWorkspacePayload = {
  members?: { upsert: WorkspaceState["members"]; archiveIds: string[] };
  projects?: { upsert: WorkspaceState["projects"]; archiveIds: string[] };
  assignments?: { upsert: WorkspaceState["assignments"]; cancelIds: string[] };
  needs?: { upsert: WorkspaceState["needs"]; cancelIds: string[] };
  skillCatalog?: { upsert: NonNullable<WorkspaceState["skillCatalog"]>; archiveIds: string[] };
  customFields?: { upsert: NonNullable<WorkspaceState["customFields"]>; archiveIds: string[] };
  opportunities?: { upsert: NonNullable<WorkspaceState["opportunities"]>; archiveIds: string[] };
  opportunityNeeds?: { upsert: NonNullable<WorkspaceState["opportunityNeeds"]>; cancelIds: string[] };
  orgUnits?: { upsert: NonNullable<WorkspaceState["orgUnits"]>; archiveIds: string[] };
  orgMemberships?: { upsert: NonNullable<WorkspaceState["orgMemberships"]>; archiveIds: string[] };
  searchScenes?: { upsert: NonNullable<WorkspaceState["searchScenes"]>; archiveIds: string[] };
  savedReports?: { upsert: NonNullable<WorkspaceState["savedReports"]>; archiveIds: string[] };
  profileRequests?: { upsert: NonNullable<WorkspaceState["profileRequests"]>; archiveIds: string[] };
  rolePermissions?: { upsert: NonNullable<WorkspaceState["rolePermissions"]> };
};

export type InvitationResult = {
  id?: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  expiresAt?: string;
  authInvite?: "sent" | "existing";
};

export type OrganizationInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  status: "pending" | "expired";
  expiresAt?: string;
  createdAt?: string;
  invitedByUserId?: string;
  invitedByName?: string;
};

export type RevokeInvitationResult = {
  changed: boolean;
  accessRevision?: number;
  requestId?: string;
};

export type AcceptInvitationResult = {
  organizationId?: string;
  organizationName?: string;
  role?: OrganizationRole;
};

export const INTEGRATION_SCOPES = ["workspace:read", "members:write", "projects:write", "assignments:write", "staffing:write"] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];
export type IntegrationClientStatus = "active" | "revoked";

export type IntegrationClient = {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  scopes: IntegrationScope[];
  status: IntegrationClientStatus;
  createdAt?: string;
  createdByUserId?: string;
  createdByName?: string;
  revokedAt?: string;
  lastUsedAt?: string;
};

export type CreateIntegrationClientResult = {
  client: IntegrationClient;
  secret?: string;
  requestId?: string;
  replayed: boolean;
};

export type RevokeIntegrationClientResult = {
  changed: boolean;
  requestId?: string;
  client: IntegrationClient;
};

export const WEBHOOK_EVENTS = [
  "workspace.committed",
  "member.changed",
  "project.changed",
  "assignment.changed",
  "staffing_need.changed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type WebhookEndpointStatus = "active" | "revoked";

export type WebhookEndpoint = {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  status: WebhookEndpointStatus;
  createdAt?: string;
  revokedAt?: string;
};

export type CreateWebhookEndpointResult = {
  endpoint: WebhookEndpoint;
  secret?: string;
  requestId?: string;
  replayed: boolean;
};

export type RevokeWebhookEndpointResult = {
  changed: boolean;
  requestId?: string;
  endpoint: WebhookEndpoint;
};

export type McpServerStatus = "active" | "revoked";

/** An external MCP server an owner or admin approved for the AI secretary. */
export type McpServer = {
  id: string;
  organizationId: string;
  serverKey: string;
  name: string;
  url: string;
  allowedTools: string[];
  status: McpServerStatus;
  createdAt?: string;
  createdByName?: string;
  revokedAt?: string;
};

export type CreateMcpServerResult = {
  server: McpServer;
  requestId?: string;
  replayed: boolean;
};

export type RevokeMcpServerResult = {
  changed: boolean;
  requestId?: string;
  server: McpServer;
};

export const MCP_SERVER_LIMITS = Object.freeze({
  maxServersPerOrg: 5,
  maxToolsPerServer: 8,
  serverKeyPattern: /^[a-z][a-z0-9_]{0,15}$/u,
  toolNamePattern: /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u,
});

export class ProductionRepositoryError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options?: { code?: string; retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ProductionRepositoryError";
    this.code = options?.code ?? "UNKNOWN";
    this.retryable = options?.retryable ?? false;
  }
}

export class WorkspaceConflictError extends ProductionRepositoryError {
  constructor(cause?: unknown) {
    super("他のユーザーが先に更新しました。最新データを読み込んでから、変更内容を確認してください。", {
      cause,
      code: "WORKSPACE_CONFLICT",
      retryable: false,
    });
    this.name = "WorkspaceConflictError";
  }
}

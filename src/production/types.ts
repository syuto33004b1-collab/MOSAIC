import type { WorkspaceState } from "../domain";

export type OrganizationRole = "owner" | "admin" | "planner" | "viewer";

export type ProductionIdentity = {
  name: string;
  email: string;
  role: OrganizationRole;
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

export type WorkspaceEnvelope = {
  state: WorkspaceState;
  revision: number;
  savedAt?: string;
};

export type SaveWorkspaceResult = {
  revision: number;
  savedAt: string;
};

export type SharedWorkspaceAdapter = {
  initialState: WorkspaceState;
  initialRevision: number;
  save: (state: WorkspaceState, expectedRevision: number, requestId: string) => Promise<SaveWorkspaceResult>;
  reload: () => Promise<{ state: WorkspaceState; revision: number }>;
  subscribe: (onRevision: (revision?: number) => void) => () => void;
};

export type ProductionAppProps = {
  mode?: "demo" | "shared";
  organizationName?: string;
  identity?: ProductionIdentity;
  shared?: SharedWorkspaceAdapter;
  onSignOut?: () => void;
  onOpenOperations?: () => void;
  onAccessInvalidated?: () => void;
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
};

export type InvitationResult = {
  id?: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  expiresAt?: string;
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

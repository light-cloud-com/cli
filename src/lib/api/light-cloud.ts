/**
 * Typed Light Cloud endpoints.
 *
 * One method per API route the CLI uses, and nothing cleverer: the command
 * layer decides what to ask, this layer knows only how to ask it.
 */

import type { ApiClient } from './client.js';
import type {
  Application,
  ApplicationStatusUpdate,
  Branch,
  ConnectionDetails,
  CreateApplicationRequest,
  CreateDatabaseRequest,
  CreateEnvironmentRequest,
  CreateFromUploadRequest,
  Database,
  DatabaseStatusUpdate,
  Deployment,
  DetectionResult,
  DomainResult,
  Environment,
  EnvironmentStatusUpdate,
  InstallationStatus,
  LogFilters,
  LogsPage,
  Paginated,
  PlatformConfig,
  Profile,
  Repository,
  UpdateEnvironmentRequest,
  UploadComplete,
  UploadSession,
} from './types.js';

export class LightCloudApi {
  constructor(readonly client: ApiClient) {}

  // ---- account -------------------------------------------------------------

  async profile(): Promise<Profile> {
    const data = await this.client.get<{ user: Profile } | Profile>('/api/auth/profile');
    return 'user' in data ? data.user : data;
  }

  async platformConfig(): Promise<PlatformConfig> {
    return this.client.get<PlatformConfig>('/api/config/platform');
  }

  // ---- applications --------------------------------------------------------

  async listApplications(organisationId: string, filter?: string, limit = 100): Promise<Application[]> {
    const page = await this.client.post<Paginated<Application>>('/api/applications', {
      targetOrganisationId: organisationId,
      page: 1,
      limit,
      filter: filter || undefined,
    });
    return page.items;
  }

  async getApplication(organisationId: string, applicationId: string): Promise<Application> {
    return this.client.post<Application>('/api/applications/get', {
      targetOrganisationId: organisationId,
      applicationId,
    });
  }

  async applicationStatus(organisationId: string, applicationId: string): Promise<ApplicationStatusUpdate> {
    return this.client.post<ApplicationStatusUpdate>('/api/applications/status', {
      targetOrganisationId: organisationId,
      applicationId,
    });
  }

  async createApplication(request: CreateApplicationRequest): Promise<Application> {
    return this.client.post<Application>('/api/applications/create', request);
  }

  async createFromUpload(request: CreateFromUploadRequest): Promise<Application> {
    return this.client.post<Application>('/api/applications/create-from-upload', request);
  }

  async deployApplication(organisationId: string, applicationId: string, uploadId?: string): Promise<Application> {
    return this.client.post<Application>('/api/applications/deploy', {
      targetOrganisationId: organisationId,
      applicationId,
      uploadId,
    });
  }

  async deleteApplication(organisationId: string, applicationId: string): Promise<void> {
    await this.client.post('/api/applications/delete', { targetOrganisationId: organisationId, applicationId });
  }

  async renameApplication(organisationId: string, applicationId: string, name: string): Promise<Application> {
    return this.client.post<Application>('/api/applications/rename', {
      targetOrganisationId: organisationId,
      applicationId,
      name,
    });
  }

  async detectFramework(input: {
    organisationId: string;
    owner: string;
    repo: string;
    branch?: string;
    rootDirectory?: string;
    gitProvider?: string;
  }): Promise<DetectionResult> {
    return this.client.post<DetectionResult>('/api/applications/detect-framework', {
      targetOrganisationId: input.organisationId,
      organisationId: input.organisationId,
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
      rootDirectory: input.rootDirectory,
      gitProvider: input.gitProvider,
    });
  }

  // ---- environments --------------------------------------------------------

  async listEnvironments(organisationId: string, applicationId: string): Promise<Environment[]> {
    return this.client.post<Environment[]>('/api/environments', {
      targetOrganisationId: organisationId,
      applicationId,
    });
  }

  async getEnvironment(organisationId: string, environmentId: string): Promise<Environment> {
    return this.client.post<Environment>('/api/environments/get', {
      targetOrganisationId: organisationId,
      environmentId,
    });
  }

  async environmentStatus(organisationId: string, environmentId: string): Promise<EnvironmentStatusUpdate> {
    return this.client.post<EnvironmentStatusUpdate>('/api/environments/status', {
      targetOrganisationId: organisationId,
      environmentId,
    });
  }

  /** Visitor password gate. No password turns the gate off. */
  async setEnvironmentPassword(organisationId: string, environmentId: string, password?: string): Promise<{ passwordEnabled: boolean }> {
    const enabled = Boolean(password);
    return this.client.post<{ passwordEnabled: boolean }>('/api/environments/password', {
      targetOrganisationId: organisationId,
      environmentId,
      enabled,
      ...(enabled ? { password } : {}),
    });
  }

  async createEnvironment(request: CreateEnvironmentRequest): Promise<Environment> {
    return this.client.post<Environment>('/api/environments/create', request);
  }

  async updateEnvironment(request: UpdateEnvironmentRequest): Promise<Environment> {
    return this.client.post<Environment>('/api/environments/update', request);
  }

  async deployEnvironment(organisationId: string, environmentId: string, uploadId?: string): Promise<Environment> {
    return this.client.post<Environment>('/api/environments/deploy', {
      targetOrganisationId: organisationId,
      environmentId,
      uploadId,
    });
  }

  async deleteEnvironment(organisationId: string, environmentId: string): Promise<void> {
    await this.client.post('/api/environments/delete', { targetOrganisationId: organisationId, environmentId });
  }

  async scaleEnvironment(
    organisationId: string,
    environmentId: string,
    scale: { minInstances?: number; maxInstances?: number }
  ): Promise<{ environment: Environment; applied: { minInstances?: number; maxInstances?: number }; clamped?: boolean; dedicated_addon_notice?: string | null }> {
    return this.client.post('/api/environments/scale', {
      targetOrganisationId: organisationId,
      environmentId,
      ...scale,
    });
  }

  async fetchLogs(organisationId: string, environmentId: string, filters: LogFilters): Promise<LogsPage> {
    return this.client.post<LogsPage>('/api/environments/logs', {
      targetOrganisationId: organisationId,
      environmentId,
      filters,
    });
  }

  /** Server-sent events; the caller reads `response.body`. */
  async streamLogs(organisationId: string, environmentId: string, severity?: string[], signal?: AbortSignal): Promise<Response> {
    return this.client.stream(`/api/environments/${organisationId}/${environmentId}/logs/stream`, {
      query: { severity: severity?.length ? severity.join(',') : undefined },
      signal,
    });
  }

  // ---- domains -------------------------------------------------------------

  async addDomain(organisationId: string, environmentId: string, domain: string, force = false): Promise<DomainResult> {
    return this.client.post<DomainResult>('/api/environments/add-domain', {
      targetOrganisationId: organisationId,
      environmentId,
      domain,
      ...(force ? { force: true } : {}),
    });
  }

  async checkDomain(organisationId: string, environmentId: string): Promise<DomainResult> {
    return this.client.post<DomainResult>('/api/environments/check-domain', {
      targetOrganisationId: organisationId,
      environmentId,
    });
  }

  async retryDomain(organisationId: string, environmentId: string): Promise<DomainResult> {
    return this.client.post<DomainResult>('/api/environments/retry-domain', {
      targetOrganisationId: organisationId,
      environmentId,
    });
  }

  async removeDomain(organisationId: string, environmentId: string): Promise<{ success?: boolean; message?: string }> {
    return this.client.post('/api/applications/remove-domain', {
      targetOrganisationId: organisationId,
      environmentId,
    });
  }

  // ---- deployments ---------------------------------------------------------

  async listDeployments(
    organisationId: string,
    environmentId: string,
    limit = 20,
    offset = 0
  ): Promise<{ deployments: Deployment[]; total: number; limit: number; offset: number }> {
    return this.client.post('/api/deployments', {
      targetOrganisationId: organisationId,
      environmentId,
      limit,
      offset,
    });
  }

  async getDeployment(organisationId: string, deploymentId: string): Promise<Deployment> {
    return this.client.post<Deployment>('/api/deployments/get', {
      targetOrganisationId: organisationId,
      deploymentId,
    });
  }

  async rollback(organisationId: string, environmentId: string, deploymentId: string): Promise<{ deployment: Deployment }> {
    return this.client.post('/api/deployments/rollback', {
      targetOrganisationId: organisationId,
      environmentId,
      deploymentId,
    });
  }

  // ---- databases -----------------------------------------------------------

  async listDatabases(organisationId: string): Promise<Database[]> {
    const data = await this.client.post<{ databases: Database[] }>('/api/databases', {
      targetOrganisationId: organisationId,
    });
    return data.databases;
  }

  async getDatabase(organisationId: string, databaseId: string): Promise<Database> {
    return this.client.post<Database>('/api/databases/get', {
      targetOrganisationId: organisationId,
      databaseId,
    });
  }

  async databaseStatus(organisationId: string, databaseId: string): Promise<DatabaseStatusUpdate> {
    return this.client.post<DatabaseStatusUpdate>('/api/databases/status', {
      targetOrganisationId: organisationId,
      databaseId,
    });
  }

  async createDatabase(request: CreateDatabaseRequest): Promise<Database> {
    return this.client.post<Database>('/api/databases/create', request);
  }

  async deleteDatabase(organisationId: string, databaseId: string): Promise<void> {
    await this.client.post('/api/databases/delete', { targetOrganisationId: organisationId, databaseId });
  }

  async connectionDetails(organisationId: string, databaseId: string): Promise<ConnectionDetails> {
    return this.client.post<ConnectionDetails>('/api/databases/connection-string', {
      targetOrganisationId: organisationId,
      databaseId,
    });
  }

  async rotatePassword(organisationId: string, databaseId: string, newPassword?: string): Promise<{ password: string }> {
    return this.client.post('/api/databases/rotate-password', {
      targetOrganisationId: organisationId,
      databaseId,
      newPassword,
    });
  }

  /** A gzip stream of the dump; the caller writes `response.body` to disk. */
  async dumpDatabase(organisationId: string, databaseId: string): Promise<Response> {
    return this.client.stream('/api/databases/dump', {
      method: 'POST',
      body: { targetOrganisationId: organisationId, databaseId },
    });
  }

  // ---- git providers -------------------------------------------------------

  // ---- Billing ----

  async ownerBillingSummary(): Promise<{ data: OwnerBillingSummary }> {
    return this.client.post<{ data: OwnerBillingSummary }>('/api/billing/owner-summary', {});
  }

  async plans(organisationId: string): Promise<{ data: PlansResponse }> {
    return this.client.post<{ data: PlansResponse }>('/api/billing/plans', { targetOrganisationId: organisationId });
  }

  async choosePlan(organisationId: string, planId: string): Promise<{ data: ChoosePlanResult }> {
    return this.client.post<{ data: ChoosePlanResult }>('/api/billing/choose-plan', { targetOrganisationId: organisationId, planId });
  }

  /** One-step plan change: a saved card is charged, or the answer is a Stripe Checkout link. */
  async upgradePlan(organisationId: string, planId: string, interval?: BillingInterval): Promise<{ data: UpgradeResult }> {
    return this.client.post<{ data: UpgradeResult }>('/api/billing/upgrade', {
      targetOrganisationId: organisationId,
      planId,
      ...(interval ? { interval } : {}),
      client: 'cli',
    });
  }

  async createCheckoutSession(organisationId: string): Promise<{ data: CheckoutSession }> {
    return this.client.post<{ data: CheckoutSession }>('/api/billing/checkout-session', { targetOrganisationId: organisationId, client: 'cli' });
  }

  async checkoutSessionStatus(organisationId: string, sessionId: string): Promise<{ data: CheckoutStatus }> {
    return this.client.post<{ data: CheckoutStatus }>('/api/billing/checkout-session/status', { targetOrganisationId: organisationId, sessionId });
  }

  /** The same session read through the upgrade route, which hosted card setup being off does not hide. */
  async upgradeStatus(organisationId: string, sessionId: string): Promise<{ data: CheckoutStatus }> {
    return this.client.post<{ data: CheckoutStatus }>('/api/billing/upgrade/status', { targetOrganisationId: organisationId, sessionId });
  }

  async removePaymentMethod(organisationId: string): Promise<void> {
    await this.client.post('/api/billing/payment-method/remove', { targetOrganisationId: organisationId });
  }

  async listRepositories(organisationId: string): Promise<Repository[]> {
    return this.client.get<Repository[]>(`/api/github-app/organisation/${organisationId}/repositories`);
  }

  async listBranches(organisationId: string, owner: string, repo: string): Promise<Branch[]> {
    return this.client.get<Branch[]>(
      `/api/github-app/organisation/${organisationId}/repositories/${owner}/${repo}/branches`
    );
  }

  async githubInstallationStatus(organisationId: string, owner: string, repo: string): Promise<InstallationStatus> {
    return this.client.get<InstallationStatus>('/api/github-app/installation-status', {
      query: { organisationId, owner, repo },
    });
  }

  async githubInstallUrl(): Promise<{ url: string }> {
    return this.client.get<{ url: string }>('/api/github-app/install');
  }

  // ---- uploads -------------------------------------------------------------

  async requestUpload(organisationId: string, fileSize: number): Promise<UploadSession> {
    return this.client.post<UploadSession>('/api/upload/request-url', {
      targetOrganisationId: organisationId,
      fileName: 'source.zip',
      contentType: 'application/zip',
      fileSize,
    });
  }

  async completeUpload(
    organisationId: string,
    uploadId: string,
    detection: {
      detectedFramework?: string;
      detectedRuntime?: string;
      detectedDeploymentType?: string;
      detectedBuildCommand?: string;
      detectedOutputDirectory?: string;
    }
  ): Promise<UploadComplete> {
    return this.client.post<UploadComplete>('/api/upload/complete', {
      targetOrganisationId: organisationId,
      uploadId,
      ...detection,
    });
  }

  // ---- parity with the console (2026-09-15) --------------------------------
  // Thin wrappers; the backend validates. Bodies mirror the console's calls.

  private org(organisationId: string, rest: Record<string, unknown> = {}): Record<string, unknown> {
    return { targetOrganisationId: organisationId, ...rest };
  }

  async updateApplication(organisationId: string, applicationId: string, changes: Record<string, unknown>): Promise<Application> {
    return this.client.post<Application>('/api/applications/update', this.org(organisationId, { applicationId, ...changes }));
  }
  async moveApplication(organisationId: string, applicationId: string, targetFolderId: string | null): Promise<unknown> {
    return this.client.post('/api/applications/move', this.org(organisationId, { applicationId, targetFolderId }));
  }
  async updateEnvironmentSettings(organisationId: string, environmentId: string, changes: Record<string, unknown>): Promise<Environment> {
    return this.client.post<Environment>('/api/environments/update', this.org(organisationId, { environmentId, ...changes }));
  }
  async environmentMetrics(organisationId: string, environmentId: string, timeRange: string): Promise<unknown> {
    return this.client.post('/api/environments/metrics/detailed', this.org(organisationId, { environmentId, timeRange }));
  }
  async environmentActivity(organisationId: string, environmentId: string, limit = 30): Promise<unknown> {
    return this.client.post('/api/environments/activity', this.org(organisationId, { environmentId, limit }));
  }
  async environmentRuntime(organisationId: string, environmentId: string): Promise<unknown> {
    return this.client.post('/api/environments/runtime', this.org(organisationId, { environmentId }));
  }
  async listRepoDirectories(organisationId: string, owner: string, repo: string, branch: string, path?: string, gitProvider?: string): Promise<unknown> {
    return this.client.post('/api/applications/list-repo-directories', { organisationId, owner, repo, branch, path, gitProvider });
  }

  async listFolders(organisationId: string, parentId?: string): Promise<unknown> {
    return this.client.post('/api/projects', this.org(organisationId, { page: 1, limit: 100, parentId }));
  }
  async createFolder(organisationId: string, name: string, parentId?: string): Promise<unknown> {
    return this.client.post('/api/projects/create', this.org(organisationId, { name, type: 'folder', parentId }));
  }
  async deleteFolder(organisationId: string, projectId: string): Promise<unknown> {
    return this.client.post('/api/projects/delete', this.org(organisationId, { projectId }));
  }
  async createStack(organisationId: string, stackId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/api/stacks/create', this.org(organisationId, { stackId, ...body }));
  }

  async updateDatabase(organisationId: string, databaseId: string, changes: Record<string, unknown>): Promise<Database> {
    return this.client.post<Database>('/api/databases/update', this.org(organisationId, { databaseId, ...changes }));
  }
  async databaseMetrics(organisationId: string, databaseId: string, timeRange: string): Promise<unknown> {
    return this.client.post('/api/databases/metrics', this.org(organisationId, { databaseId, timeRange }));
  }
  async databaseSchema(organisationId: string, databaseId: string): Promise<unknown> {
    return this.client.post('/api/databases/explorer/schema', this.org(organisationId, { databaseId }));
  }
  async queryDatabase(organisationId: string, databaseId: string, sql: string, allowWrites: boolean): Promise<unknown> {
    return this.client.post('/api/databases/explorer/query', this.org(organisationId, { databaseId, sql, allowWrites }));
  }
  async importDatabase(organisationId: string, databaseId: string, body: Uint8Array, gzip: boolean): Promise<unknown> {
    const query = new URLSearchParams({ targetOrganisationId: organisationId, databaseId });
    const response = await this.client.stream(`/api/databases/import?${query}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': gzip ? 'application/gzip' : 'application/sql' },
    });
    return response.json().catch(() => ({}));
  }

  async usage(organisationId: string, days = 30): Promise<unknown> {
    return this.client.post('/api/billing/usage', this.org(organisationId, { includeDaily: true, days }));
  }
  async usageHistory(organisationId: string, days = 90): Promise<unknown> {
    return this.client.post('/api/billing/usage-history', this.org(organisationId, { days }));
  }
  async invoices(organisationId: string, limit = 20, status?: string): Promise<unknown> {
    return this.client.post('/api/billing/invoices', this.org(organisationId, { limit, status }));
  }
  async invoice(organisationId: string, invoiceId: string): Promise<unknown> {
    return this.client.post(`/api/billing/invoice/${encodeURIComponent(invoiceId)}`, this.org(organisationId));
  }
  async outstanding(): Promise<unknown> {
    return this.client.get('/api/billing/outstanding');
  }
  async retryInvoice(organisationId: string, invoiceId: string): Promise<unknown> {
    return this.client.post('/api/billing/invoice/retry', this.org(organisationId, { invoiceId }));
  }
  async billingSettings(organisationId: string): Promise<unknown> {
    return this.client.post('/api/billing/settings/get', this.org(organisationId));
  }
  async setBillingSettings(organisationId: string, settings: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/api/billing/settings', this.org(organisationId, settings));
  }
  async billingDetails(organisationId: string): Promise<unknown> {
    return this.client.post('/api/billing/details/get', this.org(organisationId));
  }
  async setBillingDetails(organisationId: string, details: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/api/billing/details', this.org(organisationId, details));
  }

  async createOrganisation(name: string): Promise<unknown> {
    return this.client.post('/api/organisations/create', { name });
  }
  async members(organisationId: string): Promise<unknown> {
    return this.client.post('/api/users', this.org(organisationId, { page: 1, limit: 100 }));
  }
  async inviteMember(organisationId: string, email: string, role: string): Promise<unknown> {
    return this.client.post('/api/users/invite', this.org(organisationId, { email, role }));
  }
  async removeMember(organisationId: string, userId: string): Promise<unknown> {
    return this.client.post('/api/users/remove', this.org(organisationId, { userId }));
  }
  async setMemberRole(organisationId: string, userId: string, newRole: string): Promise<unknown> {
    return this.client.post('/api/users/update-role', this.org(organisationId, { userId, newRole }));
  }
  async roles(organisationId: string): Promise<unknown> {
    return this.client.post('/api/roles/all', this.org(organisationId));
  }

  async setProfileName(firstName: string, lastName: string): Promise<unknown> {
    return this.client.post('/api/profile/name', { firstName, lastName });
  }
  async setTimezone(timezone: string): Promise<unknown> {
    return this.client.put('/api/profile/timezone', { timezone, source: 'manual' });
  }
  async sessions(): Promise<{ sessions: Array<{ id: string; source: string; clientName: string | null; lastActiveAt: string; expiresAt: string; current: boolean }> }> {
    return this.client.get('/api/auth/sessions');
  }
  async revokeSession(sessionId: string): Promise<unknown> {
    return this.client.post('/api/auth/sessions/revoke', { sessionId });
  }
  async agentAccess(): Promise<{ enabled: boolean; blocked: string[]; groups: string[]; labels: Record<string, string> }> {
    return this.client.get('/api/profile/agent-access');
  }

  async gitProviderConnectUrl(provider: 'gitlab' | 'bitbucket', organisationId: string): Promise<{ url: string }> {
    const query = new URLSearchParams({ organisationId });
    return this.client.get<{ url: string }>(`/api/${provider}/connect?${query}`);
  }
  async gitProviderRepositories(provider: 'gitlab' | 'bitbucket', organisationId: string): Promise<unknown> {
    return this.client.get(`/api/${provider}/organisation/${organisationId}/repositories`);
  }
  async githubInstallations(organisationId: string): Promise<unknown> {
    return this.client.get(`/api/github-app/organisation/${organisationId}/installations`);
  }

  async apiKeys(organisationId: string): Promise<unknown> {
    return this.client.post('/api/api-keys', this.org(organisationId));
  }
  async createApiKey(organisationId: string, name: string, role?: string, expiresAt?: string): Promise<{ key?: string; secret?: string; id?: string } & Record<string, unknown>> {
    return this.client.post('/api/api-keys/create', this.org(organisationId, { name, role, expiresAt }));
  }
  async revokeApiKey(organisationId: string, keyId: string): Promise<unknown> {
    return this.client.post('/api/api-keys/revoke', this.org(organisationId, { keyId }));
  }

  async notifications(unreadOnly: boolean, limit = 20): Promise<unknown> {
    return this.client.post('/api/notifications/list', { page: 1, limit, unreadOnly });
  }
  async markNotificationsRead(notificationId?: string): Promise<unknown> {
    return notificationId
      ? this.client.post('/api/notifications/mark-read', { notificationId })
      : this.client.post('/api/notifications/mark-all-read', {});
  }
  async contactSupport(kind: 'support' | 'feature_request', subject: string, message: string): Promise<unknown> {
    return this.client.post('/api/support/request', { kind, subject, message });
  }

}

export interface OwnerBillingSummary {
  payment_method: { last4: string; brand: string } | null;
  billing_details_saved: boolean;
  billing_cycle: { next_billing_date: string | null; last_billed_at: string | null };
}

export interface PlanCatalogEntry {
  id: string;
  name: string;
  price: number;
  entitlements?: Record<string, unknown> | null;
  /** Usage the plan includes each cycle (backends since the 2026-10-06 redesign). */
  includedUsage?: number;
  /** Twelve months paid upfront; 0 on Free (backends since the 2026-10-06 redesign). */
  annualPrice?: number | null;
}

export interface PlansResponse {
  plans: PlanCatalogEntry[];
  currentPlanId: string | null;
  pendingPlanId: string | null;
  /** Why the workspace is paused: Free used its included usage, or a paid plan hit its usage limit. */
  hardStopReason?: 'free_allowance' | 'usage_limit' | null;
  interval?: BillingInterval;
  annualPaidUntil?: string | null;
  /** A scheduled switch between monthly and yearly billing. */
  pendingInterval?: BillingInterval | null;
  /** Optional usage limit on paid plans: extra usage, in dollars, after which server apps and deploys pause. */
  usageLimit?: { extra: number | null; paused: boolean };
  pool: { total: number; spent: number; remaining: number; overage: number; pct: number; planPrice: number; cycleStarted: boolean };
  hardStopped: boolean;
  spendingLimit: number | null;
  /** Every resource with its metered cost this cycle — the rows sum to pool.spent. */
  resources?: {
    running: Array<{ kind: string; name: string; machine?: string | null; hoursUsed?: number | null; costThisCycle: number }>;
    removed: Array<{ kind: string; name: string; machine?: string | null; costThisCycle: number }>;
  };
}

export interface ChoosePlanResult {
  planId: string;
  pendingPlanId: string | null;
  proratedCharge: number;
  chargeStatus: string;
  /** 'first_month' | 'first_year' (from Free), 'prorated' (difference against a paid period), 'none'. */
  chargeKind?: string;
  effectiveAt: string | null;
  interval?: BillingInterval;
  /** A switch between monthly and yearly billing that waits for the paid period. */
  pendingInterval?: BillingInterval | null;
}

export type BillingInterval = 'month' | 'year';

/**
 * POST /api/billing/upgrade. 'done': the saved card was charged, or a
 * downgrade was scheduled. 'checkout': no card yet; Stripe Checkout takes
 * the card and the first payment, and the plan switches when Stripe confirms.
 */
export type UpgradeResult =
  | ({ status: 'done' } & Omit<ChoosePlanResult, 'effectiveAt'> & { effectiveAt?: string | null })
  | ({ status: 'checkout' } & CheckoutSession);

export interface CheckoutSession {
  url: string;
  sessionId: string;
  expiresAt: string;
}

export interface CheckoutStatus {
  status: 'open' | 'complete' | 'expired';
  paymentMethod: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
  /** Set for an upgrade checkout: the plan it buys, and whether the switch has landed. */
  plan?: { id: string; applied: boolean };
}

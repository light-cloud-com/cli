/**
 * Shapes of what the Light Cloud API returns and accepts.
 *
 * Field names follow the API (snake_case on resources, camelCase on request
 * bodies) rather than being normalised, so a value printed with `--json` is
 * exactly what the console and the MCP server see.
 */

export type DeploymentType = 'static' | 'container';

export type RuntimeId =
  | 'nodejs'
  | 'python'
  | 'go'
  | 'java'
  | 'ruby'
  | 'php'
  | 'dotnet'
  | 'custom';

export type EnvironmentStatus =
  | 'pending'
  | 'queued'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'deleting'
  | 'delete_failed'
  | string;

export type DatabaseStatus =
  | 'pending'
  | 'queued'
  | 'provisioning'
  | 'ready'
  | 'failed'
  | 'deleting'
  | 'delete_failed'
  | 'deleted'
  | string;

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'upload' | string;

export interface Organisation {
  id: string;
  name: string;
  role: string;
  type?: string;
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Profile {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  organisations: Organisation[];
  github_connected?: boolean;
  mfa_enabled?: boolean;
}

export interface DeploymentLogStep {
  step: string;
  status: 'started' | 'completed' | 'failed';
  message: string;
  timestamp: string;
}

export interface Environment {
  id: string;
  application_id: string;
  name: string;
  github_branch: string;
  is_production: boolean;
  auto_deploy: boolean;
  build_command?: string | null;
  output_directory?: string | null;
  environment_vars?: Record<string, string> | null;
  container_port?: number | null;
  memory?: string | null;
  cpu?: string | null;
  min_instances?: number | null;
  max_instances?: number | null;
  concurrency?: number | null;
  current_deployment_id?: string | null;
  status: EnvironmentStatus;
  deployed_url?: string | null;
  cloud_run_service?: string | null;
  cloud_run_region?: string | null;
  custom_domain?: string | null;
  custom_domain_dns?: DnsRecord[] | null;
  custom_domain_status?: 'pending_verification' | 'active' | 'failed' | string | null;
  is_custom_domain?: boolean;
  password_enabled?: boolean;
  last_deployed_at?: string | null;
  created_at: string;
  updated_at: string;
  application?: Application;
}

export interface Application {
  id: string;
  name: string;
  slug: string;
  organisation_id: string;
  project_id?: string | null;
  deployment_type: DeploymentType;
  git_provider: GitProvider;
  github_repo_url: string;
  github_repo_owner: string;
  github_repo_name: string;
  github_branch: string;
  is_private: boolean;
  framework: string;
  runtime?: string | null;
  build_command?: string | null;
  output_directory?: string | null;
  root_directory?: string | null;
  environment_vars?: Record<string, string> | null;
  container_port?: number | null;
  memory?: string | null;
  cpu?: string | null;
  min_instances?: number | null;
  max_instances?: number | null;
  auto_deploy_branches?: boolean;
  status: string;
  deployment_stage?: string | null;
  deployment_logs?: DeploymentLogStep[] | null;
  deployment_error?: string | null;
  deployed_url?: string | null;
  custom_domain?: string | null;
  custom_domain_status?: string | null;
  last_deployed_at?: string | null;
  created_at: string;
  updated_at: string;
  environments?: Environment[];
  project?: { id: string; name: string } | null;
}

export interface Deployment {
  id: string;
  environment_id: string;
  deployed_by_id: string;
  deployed_by_name: string;
  deployed_by_email?: string | null;
  commit_sha?: string | null;
  commit_message?: string | null;
  commit_author?: string | null;
  started_at: string;
  completed_at?: string | null;
  duration_seconds?: number | null;
  status: string;
  deployment_stage?: string | null;
  deployment_logs?: DeploymentLogStep[] | null;
  deployment_error?: string | null;
  deployed_url?: string | null;
  rollback_eligible?: boolean;
  is_current?: boolean;
  environment_name?: string;
  application_id?: string;
  application_name?: string;
}

export interface Database {
  id: string;
  name: string;
  slug: string;
  organisation_id: string;
  project_id?: string | null;
  database_type: string;
  engine?: string;
  tier: string;
  region: string;
  storage_gb: number;
  ha_enabled: boolean;
  public_ip_enabled: boolean;
  connection_host?: string | null;
  connection_port?: number | null;
  connection_hostname?: string | null;
  database_name?: string | null;
  admin_user?: string | null;
  status: DatabaseStatus;
  deployment_stage?: string | null;
  deployment_logs?: DeploymentLogStep[] | null;
  deployment_error?: string | null;
  ready_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  /** The name relative to the root domain ("www", "@"). */
  host?: string;
  /** False for records that only matter when switching without downtime. */
  required?: boolean;
  /** Which hostname (www / root) the record belongs to. */
  hostname?: string;
  purpose?: 'routing' | 'ssl' | 'ownership' | 'caa';
  /** What the record is for, in one sentence. */
  reason?: string;
  check?: { ok: boolean; observed: string | null; checkedAt?: string };
}

export interface DomainHostname {
  hostname: string;
  role: 'primary' | 'redirect';
  status: string | null;
  /** A root redirect the DNS provider cannot point here; setup is complete without it. */
  optional?: boolean;
}

export interface DnsProviderInfo {
  name: string;
  apexSupport: 'alias' | 'flattening' | 'none' | 'unknown';
  note: string;
}

/** A record found in public DNS that is in the way and should be deleted. */
export interface DnsRecordToRemove {
  type: string;
  name: string;
  host: string;
  value: string;
}

export interface EnvironmentStatusUpdate {
  environmentId?: string;
  id?: string;
  status: EnvironmentStatus;
  current_deployment_id: string | null;
  deployment_stage: string | null;
  deployment_logs: DeploymentLogStep[] | null;
  deployment_error: string | null;
  deployed_url: string | null;
  custom_domain?: string | null;
  custom_domain_dns?: DnsRecord[] | null;
  custom_domain_status?: string | null;
  last_deployed_at?: string | null;
}

export interface ApplicationStatusUpdate {
  id: string;
  status: string;
  deployment_stage: string | null;
  deployment_logs: DeploymentLogStep[] | null;
  deployed_url: string | null;
  deployment_error: string | null;
  last_deployed_at: string | null;
}

export interface DatabaseStatusUpdate {
  databaseId?: string;
  id?: string;
  status: DatabaseStatus;
  deployment_stage: string | null;
  deployment_logs: DeploymentLogStep[] | null;
  connection_host: string | null;
  deployment_error: string | null;
  ready_at: string | null;
}

/** One live update, whichever resource kind it describes. */
export interface ResourceUpdate {
  status: string;
  deployment_stage: string | null;
  deployment_logs: DeploymentLogStep[] | null;
  deployment_error: string | null;
  deployed_url?: string | null;
  connection_host?: string | null;
}

export interface Paginated<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

export type LogSeverity =
  | 'DEFAULT'
  | 'DEBUG'
  | 'INFO'
  | 'NOTICE'
  | 'WARNING'
  | 'ERROR'
  | 'CRITICAL'
  | 'ALERT'
  | 'EMERGENCY';

export interface LogEntry {
  insertId: string;
  timestamp: string;
  severity: LogSeverity;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  labels?: Record<string, string>;
  resource?: {
    type: string;
    labels: Record<string, string | undefined>;
  };
  httpRequest?: {
    requestMethod: string;
    requestUrl: string;
    status: number;
    responseSize: string;
    userAgent: string;
    latency: string;
    remoteIp?: string;
    protocol?: string;
  };
}

export interface LogFilters {
  startTime?: string;
  endTime?: string;
  severity?: LogSeverity[];
  textSearch?: string;
  pageSize?: number;
  pageToken?: string;
}

export interface LogsPage {
  logs: LogEntry[];
  nextPageToken?: string;
  hasMore: boolean;
}

export interface LogStreamUpdate {
  type: 'log' | 'heartbeat' | 'error';
  entry?: LogEntry;
  timestamp?: string;
  error?: string;
}

export interface DetectionResult {
  deploymentType: DeploymentType;
  framework?: string;
  runtime?: RuntimeId;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  containerPort?: number;
  confidence: 'high' | 'medium' | 'low';
  detectedFiles: string[];
  configWarning?: string;
}

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url?: string;
}

export interface Branch {
  name: string;
  commit?: { sha: string; message?: string };
}

export interface InstallationStatus {
  configured: boolean;
  installed: boolean;
  installationId?: number;
  accountLogin?: string;
  repoAccess?: boolean;
}

export interface UploadSession {
  uploadId: string;
  signedUrl: string;
  gcsPath: string;
  expiresAt: string;
  maxSize: number;
}

export interface UploadComplete {
  id: string;
  status: string;
  fileSize: number;
  gcsPath: string;
  detectedFramework?: string | null;
  detectedRuntime?: string | null;
  detectedDeploymentType?: string | null;
  detectedBuildCommand?: string | null;
  detectedOutputDirectory?: string | null;
  detectedContainerPort?: number | null;
  /** 'server' when the backend inspected the archive itself; 'client' when it kept what we sent. */
  detectionSource?: 'server' | 'client';
  detectionConfidence?: 'high' | 'medium' | 'low' | null;
  detectedFiles?: string[];
  configWarning?: string | null;
}

export interface CreateApplicationRequest {
  targetOrganisationId: string;
  name: string;
  projectId?: string;
  githubRepoUrl: string;
  githubBranch?: string;
  isPrivate?: boolean;
  gitProvider?: 'github' | 'gitlab' | 'bitbucket';
  deploymentType: DeploymentType;
  framework?: string;
  runtime?: RuntimeId;
  buildCommand?: string;
  outputDirectory?: string;
  rootDirectory?: string;
  environmentVars?: Record<string, string>;
  containerPort?: number;
  memory?: string;
  cpu?: string;
  minInstances?: number;
  maxInstances?: number;
  region?: string;
  autoDeployOnPush?: boolean;
}

export interface CreateFromUploadRequest {
  targetOrganisationId: string;
  name: string;
  uploadId: string;
  projectId?: string;
  deploymentType: DeploymentType;
  framework?: string;
  runtime?: RuntimeId;
  buildCommand?: string;
  outputDirectory?: string;
  environmentVars?: Record<string, string>;
  containerPort?: number;
  memory?: string;
  cpu?: string;
  region?: string;
}

export interface CreateEnvironmentRequest {
  targetOrganisationId: string;
  applicationId: string;
  name: string;
  githubBranch?: string;
  isProduction?: boolean;
  autoDeploy?: boolean;
  buildCommand?: string;
  outputDirectory?: string;
  environmentVars?: Record<string, string>;
  containerPort?: number;
  memory?: string;
  cpu?: string;
  minInstances?: number;
  maxInstances?: number;
}

export interface UpdateEnvironmentRequest {
  targetOrganisationId: string;
  environmentId: string;
  name?: string;
  buildCommand?: string;
  outputDirectory?: string;
  environmentVars?: Record<string, string>;
  containerPort?: number;
  memory?: string;
  cpu?: string;
  minInstances?: number;
  maxInstances?: number;
  autoDeploy?: boolean;
}

export interface CreateDatabaseRequest {
  targetOrganisationId: string;
  name: string;
  projectId?: string;
  databaseType?: string;
  tier?: string;
  region?: string;
  storageGb?: number;
  haEnabled?: boolean;
  databaseName?: string;
  adminUser?: string;
  adminPassword?: string;
}

export interface ConnectionDetails {
  connectionString: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode?: string;
}

export interface DomainResult {
  success: boolean;
  domain: string;
  status: string;
  dnsRecords?: DnsRecord[];
  removeRecords?: DnsRecordToRemove[];
  hostnames?: DomainHostname[];
  dnsProvider?: DnsProviderInfo | null;
  message?: string;
  /** Reasons the edge gave for the domain not being active yet. */
  issues?: string[];
  environment?: Environment;
}

export interface OptionEntry {
  id: string;
  label: string;
  available: boolean;
  [key: string]: unknown;
}

export interface FrameworkCatalogueEntry {
  id: string;
  label: string;
  category: 'frontend' | 'backend' | 'fullstack';
  runtime: RuntimeId | null;
  deploymentType: DeploymentType;
  buildScript?: string;
  outputDirectory?: string;
  defaultPort?: number;
  available: boolean;
  unavailableReason?: string;
}

export interface PlatformConfig {
  version: string;
  container?: {
    machineTypes?: OptionEntry[];
    regions?: OptionEntry[];
    defaults?: Record<string, unknown>;
  };
  database?: {
    machineTypes?: Array<OptionEntry & { isSharedPool?: boolean; isProduction?: boolean; ram?: string; vCPUs?: number; price?: number }>;
    regions?: Array<OptionEntry & { continent?: string }>;
    storageOptions?: Array<OptionEntry & { value?: number }>;
    types?: Array<OptionEntry & { defaultPort?: number }>;
    sharedPoolRegions?: string[];
    defaults?: Record<string, unknown>;
  };
  frameworks?: FrameworkCatalogueEntry[];
}

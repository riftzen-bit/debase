export type SourceControlProviderKind =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "azure-devops"
  | "unknown";

export type SourceControlAuthStatus =
  | "authenticated"
  | "unauthenticated"
  | "unavailable"
  | "unknown";

export type SourceControlCloneProtocol = "auto" | "ssh" | "https";

export type SourceControlRepositoryVisibility = "private" | "public";

export type SourceControlRemote = {
  name: string;
  url: string;
  provider: SourceControlProviderKind;
  host: string | null;
  owner: string | null;
  repo: string | null;
};

export type SourceControlProviderDiscovery = {
  kind: Exclude<SourceControlProviderKind, "unknown">;
  label: string;
  executable: string | null;
  available: boolean;
  version: string | null;
  authStatus: SourceControlAuthStatus;
  account: string | null;
  installHint: string;
  authHint: string;
  matchedRemotes: SourceControlRemote[];
};

export type SourceControlScanRequest = {
  projectPath?: string;
};

export type SourceControlScanResponse =
  | {
      ok: true;
      checkedAt: number;
      isRepo: boolean;
      remotes: SourceControlRemote[];
      providers: SourceControlProviderDiscovery[];
    }
  | { ok: false; error: string };

export type GitCloneRequest = {
  repositoryUrl?: string;
  provider?: Exclude<SourceControlProviderKind, "unknown">;
  repository?: string;
  protocol?: SourceControlCloneProtocol;
  destinationParentPath: string;
  directoryName?: string;
};

export type GitCloneResponse =
  | {
      ok: true;
      path: string;
      name: string;
    }
  | { ok: false; error: string };

export type ChangeRequestState = "open" | "closed" | "merged";

export type SourceControlChangeRequest = {
  provider: Exclude<SourceControlProviderKind, "unknown">;
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  state: ChangeRequestState;
};

export type SourceControlListChangeRequestsRequest = {
  projectPath: string;
  state?: ChangeRequestState | "all";
  limit?: number;
  headRefName?: string;
};

export type SourceControlListChangeRequestsResponse =
  | {
      ok: true;
      provider: SourceControlProviderKind;
      branch: string | null;
      remotes: SourceControlRemote[];
      changeRequests: SourceControlChangeRequest[];
    }
  | { ok: false; error: string };

export type SourceControlOpenChangeRequestRequest = {
  projectPath: string;
  url: string;
};

export type SourceControlOpenChangeRequestResponse =
  | { ok: true }
  | { ok: false; error: string };

export type SourceControlCheckoutChangeRequestRequest = {
  projectPath: string;
  provider: Exclude<SourceControlProviderKind, "unknown">;
  number: number;
};

export type SourceControlCheckoutChangeRequestResponse =
  | { ok: true; refName: string | null }
  | { ok: false; error: string };

export type SourceControlCreateChangeRequestRequest = {
  projectPath: string;
  provider: Exclude<SourceControlProviderKind, "unknown">;
  title: string;
  body?: string;
  baseRefName?: string;
  push?: boolean;
};

export type SourceControlCreateChangeRequestResponse =
  | {
      ok: true;
      status: "created" | "existing";
      provider: Exclude<SourceControlProviderKind, "unknown">;
      branch: string;
      baseRefName: string;
      pushed: boolean;
      changeRequest: SourceControlChangeRequest | null;
    }
  | { ok: false; error: string };

export type SourceControlRepositoryInfo = {
  provider: Exclude<SourceControlProviderKind, "unknown">;
  nameWithOwner: string;
  url: string;
  sshUrl: string;
};

export type SourceControlPublishRepositoryRequest = {
  projectPath: string;
  provider: Exclude<SourceControlProviderKind, "unknown">;
  repository: string;
  visibility: SourceControlRepositoryVisibility;
  remoteName?: string;
  protocol?: SourceControlCloneProtocol;
};

export type SourceControlPublishRepositoryResponse =
  | {
      ok: true;
      repository: SourceControlRepositoryInfo;
      remoteName: string;
      remoteUrl: string;
      branch: string;
      upstreamBranch?: string;
      status: "pushed" | "remote_added";
    }
  | { ok: false; error: string };

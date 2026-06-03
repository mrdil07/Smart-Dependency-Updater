/**
 * Resolves the pull request to act on from the triggering event, decides
 * whether it is a dependency-update PR, and extracts the dependency version
 * change from the PR title and/or its manifest diff.
 */
import * as github from '@actions/github';
import { Octokit } from './client';
import { ActionConfig } from '../config';
import { DependencyChange, RemediationContext } from '../types';
import { logger } from '../logger';

interface PullRequestLike {
  number: number;
  title: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
}

/** Map common manifest filenames to a package ecosystem. */
const MANIFEST_ECOSYSTEMS: Array<{ test: RegExp; ecosystem: string }> = [
  { test: /package(-lock)?\.json$|yarn\.lock$|pnpm-lock\.yaml$/, ecosystem: 'npm' },
  { test: /requirements.*\.txt$|pyproject\.toml$|Pipfile(\.lock)?$|poetry\.lock$/, ecosystem: 'pip' },
  { test: /go\.(mod|sum)$/, ecosystem: 'go' },
  { test: /Gemfile(\.lock)?$/, ecosystem: 'bundler' },
  { test: /pom\.xml$|build\.gradle(\.kts)?$/, ecosystem: 'maven' },
  { test: /composer\.(json|lock)$/, ecosystem: 'composer' },
  { test: /Cargo\.(toml|lock)$/, ecosystem: 'cargo' },
];

async function findLatestFailedRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<number | undefined> {
  try {
    const runs = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch,
      status: 'completed',
      per_page: 30,
    });
    const failed = runs.data.workflow_runs.find(
      (run) => run.conclusion === 'failure',
    );
    return failed?.id;
  } catch {
    return undefined;
  }
}

/**
 * Figure out which PR to remediate based on the event context:
 *   1. `workflow_run`         — the standard secure trigger (write token).
 *   2. explicit `pr-number`   — manual `workflow_dispatch`.
 *   3. `pull_request`         — direct fallback.
 */
export async function resolveContext(
  octokit: Octokit,
  config: ActionConfig,
): Promise<RemediationContext | null> {
  const { owner, repo } = github.context.repo;
  const payload = github.context.payload;
  const eventName = github.context.eventName;

  // 1. workflow_run
  const workflowRun = payload.workflow_run as
    | {
        id: number;
        head_branch: string;
        head_sha: string;
        conclusion: string | null;
        pull_requests?: Array<{ number: number }>;
      }
    | undefined;

  if (eventName === 'workflow_run' && workflowRun) {
    const headBranch = workflowRun.head_branch;
    let prNumber: number | undefined =
      workflowRun.pull_requests?.[0]?.number;

    if (!prNumber && headBranch) {
      try {
        const prs = await octokit.rest.pulls.list({
          owner,
          repo,
          head: `${owner}:${headBranch}`,
          state: 'open',
        });
        prNumber = prs.data[0]?.number;
      } catch {
        /* ignore — handled below */
      }
    }

    if (!prNumber) {
      logger.info(`No open PR found for branch "${headBranch}".`);
      return null;
    }

    return {
      owner,
      repo,
      prNumber,
      headRef: headBranch,
      headSha: workflowRun.head_sha,
      failedRunId: workflowRun.id,
    };
  }

  // 2. explicit pr-number (manual dispatch)
  if (config.prNumberInput) {
    const pr = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: config.prNumberInput,
    });
    return {
      owner,
      repo,
      prNumber: config.prNumberInput,
      headRef: pr.data.head.ref,
      headSha: pr.data.head.sha,
      failedRunId: await findLatestFailedRun(
        octokit,
        owner,
        repo,
        pr.data.head.ref,
      ),
    };
  }

  // 3. pull_request event
  const pullRequest = payload.pull_request as
    | { number: number; head: { ref: string; sha: string } }
    | undefined;
  if (pullRequest) {
    return {
      owner,
      repo,
      prNumber: pullRequest.number,
      headRef: pullRequest.head.ref,
      headSha: pullRequest.head.sha,
      failedRunId: await findLatestFailedRun(
        octokit,
        owner,
        repo,
        pullRequest.head.ref,
      ),
    };
  }

  return null;
}

export async function getPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestLike> {
  const res = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return res.data as unknown as PullRequestLike;
}

/** A PR counts as a dependency update if the author or branch matches. */
export function isDependencyPr(
  pr: PullRequestLike,
  config: ActionConfig,
): boolean {
  const login = pr.user?.login ?? '';
  if (config.dependencyAuthors.includes(login)) {
    return true;
  }
  return config.branchPrefixes.some((prefix) => pr.head.ref.startsWith(prefix));
}

const TITLE_PATTERNS: RegExp[] = [
  // Renovate: "Update dependency <name> from A to B"
  /update\s+dependency\s+(?<name>\S+)\s+from\s+(?<from>\S+)\s+to\s+v?(?<to>\S+)/i,
  // Renovate: "Update dependency <name> to vB"
  /update\s+dependency\s+(?<name>\S+)\s+to\s+v?(?<to>\S+)/i,
  // Dependabot: "Bump <name> from A to B"
  /bump\s+(?<name>\S+)\s+from\s+(?<from>\S+)\s+to\s+(?<to>\S+)/i,
  // "Update <name> from A to B"
  /update\s+(?<name>\S+)\s+from\s+(?<from>\S+)\s+to\s+(?<to>\S+)/i,
  // Generic: "Bump/Update/Upgrade <name> to vB"
  /(?:bump|update|upgrade)\s+(?<name>\S+)\s+to\s+v?(?<to>\S+)/i,
];

export function parseTitle(title: string): DependencyChange | null {
  for (const pattern of TITLE_PATTERNS) {
    const match = title.match(pattern);
    if (match?.groups?.name) {
      return {
        name: match.groups.name.replace(/[`"']/g, ''),
        fromVersion: match.groups.from,
        toVersion: match.groups.to,
      };
    }
  }
  return null;
}

/**
 * Determine the dependency change for a PR: parse the title, then enrich the
 * ecosystem/manifest from the list of changed manifest files.
 */
export async function getDependencyChange(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
): Promise<DependencyChange | null> {
  const fromTitle = parseTitle(title);

  let manifest: string | undefined;
  let ecosystem: string | undefined;
  try {
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });
    for (const file of files) {
      const match = MANIFEST_ECOSYSTEMS.find((m) => m.test.test(file.filename));
      if (match) {
        manifest = file.filename;
        ecosystem = match.ecosystem;
        break;
      }
    }
  } catch {
    /* listing files is best-effort */
  }

  if (!fromTitle && !manifest) {
    return null;
  }

  return {
    name: fromTitle?.name ?? 'unknown',
    fromVersion: fromTitle?.fromVersion,
    toVersion: fromTitle?.toVersion,
    ecosystem,
    manifest,
  };
}

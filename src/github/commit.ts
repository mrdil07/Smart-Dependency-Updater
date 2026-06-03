/**
 * Writes back to the PR: pushes a fix commit via the Git Data API, posts
 * comments, applies the manual-intervention label, and tracks how many fix
 * attempts have been made (via a hidden marker embedded in bot comments).
 */
import { Octokit } from './client';
import { AiChange } from '../types';
import { logger } from '../logger';

/** Hidden marker embedded in every bot comment to count attempts. */
const ATTEMPT_MARKER_REGEX = /<!--\s*sdu-attempts:(\d+)\s*-->/;

export interface CommitAuthor {
  name: string;
  email: string;
}

export interface AttemptState {
  /** Number of fix attempts already recorded on the PR. */
  count: number;
}

/**
 * Count prior fix attempts by scanning issue comments for the hidden marker.
 * The highest marker value wins (markers are monotonic per attempt).
 */
export async function getAttemptState(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<AttemptState> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  let count = 0;
  for (const comment of comments) {
    const match = comment.body?.match(ATTEMPT_MARKER_REGEX);
    if (match) {
      count = Math.max(count, Number.parseInt(match[1], 10));
    }
  }
  return { count };
}

/**
 * Create a commit on `branch` (parent = `baseSha`) that applies `changes`,
 * using the Git Data API so no local checkout of the branch is required.
 * Returns the new commit SHA.
 */
export async function commitChanges(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  baseSha: string,
  changes: AiChange[],
  message: string,
  author: CommitAuthor,
): Promise<string> {
  const baseCommit = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });

  const tree = await Promise.all(
    changes.map(async (change) => {
      const blob = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: Buffer.from(change.content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      return {
        path: change.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.data.sha,
      };
    }),
  );

  const newTree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.data.tree.sha,
    tree,
  });

  // Omit `date` so GitHub stamps the commit with the current time.
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.data.sha,
    parents: [baseSha],
    author,
    committer: author,
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
    force: false,
  });

  logger.info(`Pushed fix commit ${commit.data.sha} to ${branch}.`);
  return commit.data.sha;
}

/** Post a comment on the PR. */
export async function addComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

/** Ensure the given label exists, then apply it to the PR. */
export async function applyLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  label: string,
): Promise<void> {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: label });
  } catch {
    try {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name: label,
        color: 'b60205',
        description: 'Smart Dependency Updater could not fix this automatically',
      });
    } catch {
      /* label may have been created concurrently — ignore */
    }
  }

  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [label],
  });
}

/** Whether the PR already carries the given label. */
export async function hasLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  label: string,
): Promise<boolean> {
  try {
    const labels = await octokit.paginate(
      octokit.rest.issues.listLabelsOnIssue,
      { owner, repo, issue_number: prNumber, per_page: 100 },
    );
    return labels.some((l) => l.name === label);
  } catch {
    return false;
  }
}

/** Build the hidden attempt marker appended to bot comments. */
export function attemptMarker(attempt: number): string {
  return `\n\n<!-- sdu-attempts:${attempt} -->`;
}

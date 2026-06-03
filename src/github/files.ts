/**
 * Reads repository file contents through the GitHub Contents API at a specific
 * ref, so the action does not depend on a local checkout of the PR branch.
 */
import { Octokit } from './client';

const MAX_FILE_CHARS = 16000;

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
}

/** Read a single file at a ref. Returns null if it does not exist / is binary. */
export async function readFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<ReadFileResult | null> {
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    const data = res.data;
    if (Array.isArray(data) || data.type !== 'file') {
      return null;
    }
    if (typeof data.content !== 'string') {
      return null;
    }
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    // Skip files that look binary (contain NUL bytes).
    if (decoded.includes('\u0000')) {
      return null;
    }
    const truncated = decoded.length > MAX_FILE_CHARS;
    return {
      path,
      content: truncated ? decoded.slice(0, MAX_FILE_CHARS) : decoded,
      truncated,
    };
  } catch {
    return null;
  }
}

/** Read several files, dropping any that cannot be read. */
export async function readFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  paths: string[],
  ref: string,
): Promise<ReadFileResult[]> {
  const results = await Promise.all(
    paths.map((path) => readFile(octokit, owner, repo, path, ref)),
  );
  return results.filter((r): r is ReadFileResult => r !== null);
}

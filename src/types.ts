/**
 * Shared type definitions for Smart Dependency Updater.
 */

/** A dependency version change parsed from a PR (title and/or manifest diff). */
export interface DependencyChange {
  /** Package name, e.g. "lodash" or "requests". */
  name: string;
  /** Previous version, when known. */
  fromVersion?: string;
  /** New version, when known. */
  toVersion?: string;
  /** Package ecosystem, e.g. "npm", "pip", "go", "maven". */
  ecosystem?: string;
  /** Manifest file where the change was detected, e.g. "package.json". */
  manifest?: string;
}

/** A file location extracted from a CI log. */
export interface FileReference {
  path: string;
  line?: number;
  column?: number;
  /** How many times this path appeared in the log (used for ranking). */
  hits: number;
}

/** Result of cleaning and analyzing a raw CI log. */
export interface ParsedLog {
  /** Full cleaned log (ANSI + timestamps stripped). */
  cleaned: string;
  /** A focused excerpt containing the most relevant error context. */
  errorExcerpt: string;
  /** Candidate source files referenced by the errors, ranked by relevance. */
  fileReferences: FileReference[];
}

/** A source file gathered as context for the model. */
export interface CandidateFile {
  path: string;
  content: string;
  truncated: boolean;
}

/** A single file rewrite proposed by the model. */
export interface AiChange {
  path: string;
  /** Full new content of the file. */
  content: string;
}

/** Structured result returned by the model. */
export interface AiResult {
  summary: string;
  changes: AiChange[];
  unableToFix: boolean;
  reason?: string;
}

/** Everything needed to act on a single PR. */
export interface RemediationContext {
  owner: string;
  repo: string;
  prNumber: number;
  /** Head branch name (where the fix commit is pushed). */
  headRef: string;
  /** Head commit SHA (parent of the fix commit). */
  headSha: string;
  /** ID of the failed workflow run whose logs we analyze. */
  failedRunId?: number;
}

/** Final outcome reported via the action's `status` output. */
export type RemediationStatus =
  | 'fixed'
  | 'skipped'
  | 'unable-to-fix'
  | 'manual-intervention'
  | 'no-op';

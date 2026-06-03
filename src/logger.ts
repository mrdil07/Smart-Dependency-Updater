/**
 * Thin wrapper around @actions/core logging so the rest of the code does not
 * depend on the toolkit directly (and so tests can stub it easily).
 */
import * as core from '@actions/core';

export const logger = {
  debug: (message: string): void => core.debug(message),
  info: (message: string): void => core.info(message),
  notice: (message: string): void => core.notice(message),
  warning: (message: string): void => core.warning(message),
  error: (message: string): void => core.error(message),
  group: async <T>(name: string, fn: () => Promise<T>): Promise<T> =>
    core.group(name, fn),
};

export type Logger = typeof logger;

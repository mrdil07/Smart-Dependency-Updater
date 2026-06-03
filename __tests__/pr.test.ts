import { parseTitle, isDependencyPr } from '../src/github/pr';
import { ActionConfig } from '../src/config';

describe('parseTitle', () => {
  it('parses the classic Dependabot "Bump X from A to B" title', () => {
    const change = parseTitle('Bump lodash from 4.17.20 to 4.17.21');
    expect(change).toMatchObject({
      name: 'lodash',
      fromVersion: '4.17.20',
      toVersion: '4.17.21',
    });
  });

  it('parses Renovate-style "Update dependency X to vB" titles', () => {
    const change = parseTitle('Update dependency axios to v1.6.0');
    expect(change?.name).toBe('axios');
    expect(change?.toVersion).toBe('1.6.0');
  });

  it('parses scoped npm packages', () => {
    const change = parseTitle('Bump @types/node from 18.0.0 to 20.0.0');
    expect(change?.name).toBe('@types/node');
    expect(change?.toVersion).toBe('20.0.0');
  });

  it('returns null for non-dependency titles', () => {
    expect(parseTitle('Fix login bug on the dashboard')).toBeNull();
  });
});

describe('isDependencyPr', () => {
  const config = {
    dependencyAuthors: ['dependabot[bot]', 'renovate[bot]'],
    branchPrefixes: ['dependabot/', 'renovate/'],
  } as unknown as ActionConfig;

  it('matches by bot author login', () => {
    const pr = {
      number: 1,
      title: 'Bump x from 1 to 2',
      user: { login: 'dependabot[bot]' },
      head: { ref: 'dependabot/npm_and_yarn/x-2', sha: 'abc' },
    };
    expect(isDependencyPr(pr, config)).toBe(true);
  });

  it('matches by branch prefix when the author differs', () => {
    const pr = {
      number: 2,
      title: 'Bump x',
      user: { login: 'some-human' },
      head: { ref: 'renovate/x-2.x', sha: 'abc' },
    };
    expect(isDependencyPr(pr, config)).toBe(true);
  });

  it('rejects unrelated PRs', () => {
    const pr = {
      number: 3,
      title: 'Add feature',
      user: { login: 'some-human' },
      head: { ref: 'feature/login', sha: 'abc' },
    };
    expect(isDependencyPr(pr, config)).toBe(false);
  });
});

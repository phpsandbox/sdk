import { describe, expect, it, vi } from 'vitest';
import Git from '../../src/git.js';

describe('Git sync targets', () => {
  it('creates a target without selecting the sandbox integration again', async () => {
    const post = vi.fn(async () => ({ data: { id: 'target-123' } }));
    const client = { post } as any;
    const git = new Git({ data: { id: 'notebook-123' } } as any, client);
    await git.targets.create({
      provider: 'github',
      repository: 'acme/project',
      author: { name: 'Automation', email: 'automation@example.com' },
    });

    expect(post).toHaveBeenCalledWith('/notebook/notebook-123/git/targets', {
      provider: 'github',
      repository: 'acme/project',
      author: { name: 'Automation', email: 'automation@example.com' },
    });
  });

  it('synchronizes an existing typed target without resending its integration', async () => {
    const post = vi.fn(async () => ({ data: { id: 'target-123' } }));
    const get = vi.fn(async () => ({ data: { id: 'target/123' } }));
    const git = new Git({ data: { id: 'notebook-123' } } as any, { get, post } as any);

    const target = await git.targets.get('target/123');
    await target.sync({ direction: 'pull', force: true });

    expect(post).toHaveBeenCalledWith('/notebook/notebook-123/git/targets/target%2F123/sync', {
      direction: 'pull',
      force: true,
    });
  });
});

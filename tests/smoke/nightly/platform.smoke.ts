import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { SandboxFixture } from '../support/resources.js';
import {
  createSandboxFixture,
  createTrackedNotebook,
  operation,
} from '../support/resources.js';

describe.sequential('production platform API contract', () => {
  let fixture: SandboxFixture | undefined;

  beforeAll(async () => {
    fixture = await createSandboxFixture('platform');
  });

  afterAll(async () => {
    await fixture?.resources.cleanup();
  });

  test('gets a sandbox through Core', async () => {
    const fetched = await operation('get sandbox from Core', () => (
      fixture!.client.notebook.get(fixture!.sandbox.data.id)
    ));
    fetched.dispose();

    expect(fetched.data.id).toBe(fixture!.sandbox.data.id);
  });

  test('configures, ingests, reads, and resolves notebook feedback', async () => {
    const externalId = `sdk-smoke-${fixture!.environment.runId}`;
    const message = `Feedback smoke for ${fixture!.sandbox.data.id}`;

    const configuration = await operation('configure feedback widget', () => fixture!.sandbox.feedback.configure({
      widget: {
        label: 'Send feedback',
        targets: ['preview'],
        types: ['bug', 'suggestion'],
      },
    }));
    expect(configuration.widget).toMatchObject({
      label: 'Send feedback',
      targets: ['preview'],
      types: ['bug', 'suggestion'],
    });

    const submitted = await operation('submit notebook feedback', () => fixture!.sandbox.feedback.submit({
      author: { externalId },
      message,
      metadata: { runId: fixture!.environment.runId },
      type: 'bug',
    }));
    expect(submitted).toMatchObject({ message, source: 'sdk', status: 'open', type: 'bug' });

    await expect(operation('get notebook feedback', () => fixture!.sandbox.feedback.get(submitted.id)))
      .resolves.toMatchObject({ id: submitted.id, message });

    const openFeedback = await operation('list open SDK feedback', () => fixture!.sandbox.feedback.list({
      source: 'sdk',
      status: 'open',
    }));
    expect(openFeedback.data.some((feedback) => feedback.id === submitted.id)).toBe(true);

    await expect(operation('resolve notebook feedback', () => fixture!.sandbox.feedback.update(submitted.id, {
      status: 'resolved',
    }))).resolves.toMatchObject({ id: submitted.id, status: 'resolved' });

    await expect(operation('disable feedback widget', () => fixture!.sandbox.feedback.configure({ widget: null })))
      .resolves.toEqual({ widget: null });
  });

  test('forks and initializes a sandbox with its parent filesystem', async () => {
    const path = `.phpsandbox-sdk-fork-${fixture!.environment.runId}.txt`;
    const marker = `fork-parent:${fixture!.environment.transport}:${fixture!.sandbox.data.id}\n`;
    const author = 'PHPSandbox SDK Smoke <sdk-smoke@phpsandbox.io>';

    await operation('write fork parent marker', () => fixture!.sandbox.files.write(path, marker));
    await operation('checkpoint fork parent', () => fixture!.sandbox.git.checkpoint(
      author,
      `Fork parent ${fixture!.environment.runId}`,
      'main',
      true,
    ));
    const tracked = await createTrackedNotebook(fixture!, () => fixture!.sandbox.fork());

    await operation('initialize forked sandbox', () => tracked.notebook.ready(), 300_000);
    await expect(operation('read inherited file from fork', () => tracked.notebook.files.readText(path)))
      .resolves.toBe(marker);

    await operation('write fork conflict side', () => tracked.notebook.files.write(path, 'fork-side\n'));
    await operation('checkpoint fork conflict side', () => tracked.notebook.git.checkpoint(
      author,
      `Fork side ${fixture!.environment.runId}`,
      'main',
    ));
    await operation('write parent conflict side', () => fixture!.sandbox.files.write(path, 'parent-side\n'));
    await operation('checkpoint parent conflict side', () => fixture!.sandbox.git.checkpoint(
      author,
      `Parent side ${fixture!.environment.runId}`,
      'main',
    ));

    const diff = await operation('diff fork against parent', () => fixture!.sandbox.git.diff({
      notebookId: tracked.notebook.data.id,
      token: fixture!.environment.token,
      ref: 'main',
    }));
    expect(diff.status).toBe('ready');
    expect(diff.files.some((file) => file.path.endsWith(path))).toBe(true);

    const merge = await operation('merge conflicting fork', () => fixture!.sandbox.git.merge({
      notebookId: tracked.notebook.data.id,
      token: fixture!.environment.token,
      ref: 'main',
      expectedBaseRef: diff.baseRef,
      author,
      message: `Conflict smoke ${fixture!.environment.runId}`,
    }));
    expect(merge.status).toBe('conflict');
    const conflicts = await operation('inspect Git conflicts', () => fixture!.sandbox.git.conflicts());
    expect(conflicts.hasConflicts).toBe(true);
    await operation('abort conflicting merge', () => fixture!.sandbox.git.abortMerge());
    await expect(operation('read parent file after merge abort', () => fixture!.sandbox.files.readText(path)))
      .resolves.toBe('parent-side\n');
  });

  test('round-trips notebook secrets without exposing their value', async () => {
    const name = `SDK_SMOKE_${fixture!.sandbox.data.id.toUpperCase()}`;
    const cleanup = fixture!.resources.register(`secret ${name}`, () => fixture!.sandbox.secrets.delete(name));

    const created = await operation('create notebook secret', () => fixture!.sandbox.secrets.set(name, 'smoke-secret-value'));
    const secrets = await operation('list notebook secrets', () => fixture!.sandbox.secrets.list());

    expect(created.name).toBe(name);
    expect(secrets.some((secret) => secret.name === name)).toBe(true);
    expect(JSON.stringify(secrets)).not.toContain('smoke-secret-value');

    await operation('delete notebook secret', () => fixture!.sandbox.secrets.delete(name));
    cleanup.complete();
  });

  test('sets multiple secrets and injects them into the runtime without disclosure', async () => {
    const prefix = `SDK_BULK_${fixture!.sandbox.data.id.toUpperCase()}`;
    const first = `${prefix}_FIRST`;
    const second = `${prefix}_SECOND`;
    const firstValue = `first-${fixture!.environment.runId}`;
    const secondValue = `second-${fixture!.environment.runId}`;
    const firstCleanup = fixture!.resources.register(`secret ${first}`, () => fixture!.sandbox.secrets.delete(first));
    const secondCleanup = fixture!.resources.register(`secret ${second}`, () => fixture!.sandbox.secrets.delete(second));

    const created = await operation('set multiple notebook secrets', () => fixture!.sandbox.secrets.setMany({
      [first]: firstValue,
      [second]: secondValue,
    }));
    expect(created.map((secret) => secret.name)).toEqual(expect.arrayContaining([first, second]));

    await operation('restart runtime with injected secrets', () => fixture!.sandbox.restart(), 180_000);
    const result = await operation('hash injected runtime secrets', () => fixture!.sandbox.exec([
      'php',
      '-r',
      `echo hash('sha256', getenv('${first}').'|'.getenv('${second}'));`,
    ]));
    expect(result.stdout).toBe(createHash('sha256').update(`${firstValue}|${secondValue}`).digest('hex'));
    expect(result.stdout).not.toContain(firstValue);
    expect(result.stdout).not.toContain(secondValue);

    await fixture!.sandbox.secrets.delete(first);
    firstCleanup.complete();
    await fixture!.sandbox.secrets.delete(second);
    secondCleanup.complete();
  });

  test('enables, reads, and disables preview protection', async () => {
    const cleanup = fixture!.resources.register('preview protection', () => fixture!.sandbox.preview.disable());
    const enabled = await operation('set preview password', () => fixture!.sandbox.preview.setPassword({
      password: `sdk-smoke-${fixture!.sandbox.data.id}`,
    }));

    expect(enabled).toEqual({
      enabled: true,
      expiresAt: expect.any(String),
      token: expect.any(String),
    });
    await expect(operation('read enabled preview protection', () => fixture!.sandbox.preview.get()))
      .resolves.toEqual({
        enabled: true,
        expiresAt: expect.any(String),
        token: expect.any(String),
      });

    await operation('disable preview protection', () => fixture!.sandbox.preview.disable());
    cleanup.complete();

    await expect(operation('read disabled preview protection', () => fixture!.sandbox.preview.get()))
      .resolves.toEqual({ enabled: false });
  });

  test('creates preview sessions and consumes one-time handoffs', async () => {
    const previewUrl = runtimePreviewUrl(fixture!);
    const marker = `preview-${fixture!.sandbox.data.id}`;
    const targetUrl = `${previewUrl.replace(/\/$/, '')}/?sdk-smoke=${fixture!.environment.runId}`;
    const cleanup = fixture!.resources.register('preview session protection', () => fixture!.sandbox.preview.disable());

    await operation('write preview marker', () => fixture!.sandbox.files.write('index.php', `<?php echo '${marker}';`));
    await operation('enable preview session protection', () => fixture!.sandbox.preview.setPassword({
      password: `sdk-session-${fixture!.sandbox.data.id}`,
    }));

    const blocked = await operation('request protected preview without session', () => fetch(targetUrl, {
      redirect: 'manual',
    }));
    expect(blocked.status).toBeGreaterThanOrEqual(300);

    const session = await operation('create preview session', () => fixture!.sandbox.preview.createSession({
      url: targetUrl,
    }));
    const sessionResponse = await operation('request preview with session', () => consumePreviewCredential(session.url));
    expect(sessionResponse.ok).toBe(true);
    await expect(sessionResponse.text()).resolves.toContain(marker);

    const handoff = await operation('create preview handoff', () => fixture!.sandbox.preview.createHandoff({
      previewSessionId: session.previewSessionId,
      expiresInSeconds: 60,
      url: targetUrl,
    }));
    const handoffResponse = await operation('consume preview handoff', () => consumePreviewCredential(handoff.url));
    expect(handoffResponse.ok).toBe(true);
    await expect(handoffResponse.text()).resolves.toContain(marker);

    await fixture!.sandbox.preview.disable();
    cleanup.complete();
  });

  test('captures, reads, and deletes an SMTP message', async () => {
    const subject = `SDK mail ${fixture!.environment.runId} ${fixture!.sandbox.data.id}`;
    const cleanup = fixture!.resources.register('captured mail', () => fixture!.sandbox.mail.disable());
    const state = await operation('enable captured mail', () => fixture!.sandbox.mail.enable());
    expect(state.enabled).toBe(true);

    await operation('restart runtime with mail credentials', () => fixture!.sandbox.restart(), 180_000);
    await operation('send captured SMTP message', () => fixture!.sandbox.files.write('.sdk-smoke-mail.php', smtpScript(subject)));
    const sent = await operation('execute captured SMTP message', () => fixture!.sandbox.exec(['php', '.sdk-smoke-mail.php']));
    expect(sent).toMatchObject({ exitCode: 0, stdout: 'sent' });

    let messageHash = '';
    await vi.waitFor(async () => {
      const messages = await fixture!.sandbox.mail.list();
      const message = messages.data.find((candidate) => candidate.subject === subject);
      expect(message).toBeDefined();
      messageHash = message?.hash ?? '';
    }, { timeout: 30_000, interval: 500 });

    const message = await operation('read captured mail', () => fixture!.sandbox.mail.get(messageHash));
    expect(message.subject).toBe(subject);
    await operation('delete captured mail', () => fixture!.sandbox.mail.delete(messageHash));

    await fixture!.sandbox.mail.disable();
    cleanup.complete();
  });

  test('reads mail, publication, and server state without creating external resources', async () => {
    const mail = await operation('read notebook mail state', () => fixture!.sandbox.mail.status());
    const publication = await operation('read current publication', () => fixture!.sandbox.publication());
    const servers = await operation('list account servers', () => fixture!.client.servers.list());

    expect(mail).toEqual(expect.objectContaining({ enabled: expect.any(Boolean) }));
    expect(publication === null || typeof publication === 'object').toBe(true);
    expect(servers.data).toBeInstanceOf(Array);
  });
});

function runtimePreviewUrl(fixture: SandboxFixture): string {
  const initialized = fixture.sandbox.initialized;
  if (initialized === false || initialized.type !== 'success') {
    throw new Error('Sandbox runtime is not initialized.');
  }

  return initialized.data.previewUrl;
}

async function consumePreviewCredential(url: string): Promise<Response> {
  const credential = await fetch(url, { redirect: 'manual' });
  if (credential.ok) {
    return credential;
  }

  const location = credential.headers.get('location');
  const cookie = credential.headers.get('set-cookie')?.split(';', 1)[0];
  if (location === null || cookie === undefined) {
    return credential;
  }

  return fetch(new URL(location, url), {
    headers: { Cookie: cookie },
  });
}

function smtpScript(subject: string): string {
  return `<?php
$socket = fsockopen(getenv('SMTP_HOST'), (int) getenv('SMTP_PORT'), $errorCode, $errorMessage, 10);
if ($socket === false) { fwrite(STDERR, $errorMessage); exit(1); }
function response($socket): string {
    $response = '';
    do {
        $line = fgets($socket, 515);
        if ($line === false) { break; }
        $response .= $line;
    } while (strlen($line) >= 4 && $line[3] === '-');
    return $response;
}
function command($socket, string $command): string { fwrite($socket, $command."\\r\\n"); return response($socket); }
response($socket);
command($socket, 'EHLO sdk-smoke');
command($socket, 'AUTH PLAIN '.base64_encode("\\0".getenv('SMTP_USERNAME')."\\0".getenv('SMTP_PASSWORD')));
command($socket, 'MAIL FROM:<sdk-smoke@phpsandbox.io>');
command($socket, 'RCPT TO:<recipient@example.test>');
command($socket, 'DATA');
fwrite($socket, "From: SDK Smoke <sdk-smoke@phpsandbox.io>\\r\\nTo: recipient@example.test\\r\\nSubject: ${subject}\\r\\nContent-Type: text/plain\\r\\n\\r\\nmail-smoke\\r\\n.\\r\\n");
response($socket);
command($socket, 'QUIT');
fclose($socket);
echo 'sent';
`;
}

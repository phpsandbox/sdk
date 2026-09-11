import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  readFeedbackReviewerSmokeEnvironment,
  type FeedbackReviewerSmokeEnvironment,
} from '../support/environment.js';
import type { SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation } from '../support/resources.js';

describe.sequential('production feedback widget browser contract', () => {
  let fixture: SandboxFixture | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let previewUrl: string | undefined;
  let reviewer: FeedbackReviewerSmokeEnvironment;

  beforeAll(async () => {
    reviewer = readFeedbackReviewerSmokeEnvironment();
    fixture = await createSandboxFixture('feedback-widget');
    previewUrl = runtimePreviewUrl(fixture);
    await operation('write feedback widget preview fixture', () => fixture!.sandbox.files.write(
      'index.php',
      '<!doctype html><html><head><title>Feedback widget smoke</title></head><body><main>Feedback widget smoke</main></body></html>',
    ));
    await operation('configure feedback widget', () => fixture!.sandbox.feedback.configure({
      widget: {
        label: 'Report smoke feedback',
        targets: ['preview'],
        types: ['bug', 'suggestion'],
      },
    }));

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { height: 720, width: 1_024 } });
  }, 360_000);

  afterAll(async () => {
    await fixture?.sandbox.feedback.configure({ widget: null }).catch(() => undefined);
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await fixture?.resources.cleanup();
  }, 300_000);

  test('submits authenticated feedback through the preview widget', async () => {
    const message = `Widget smoke ${fixture!.environment.runId} for ${fixture!.sandbox.data.id}`;

    await expect.poll(async () => {
      await page!.goto(previewUrl!, { waitUntil: 'domcontentloaded' });
      return page!.locator('[data-ps-feedback-button]').count();
    }, { timeout: 60_000 }).toBe(1);

    await expect(page!.locator('[data-ps-feedback-button]').innerText()).resolves.toBe('Report smoke feedback');
    await page!.locator('[data-ps-feedback-button]').click();
    await page!.locator('.ps-signin').waitFor({ state: 'visible' });

    const popupPromise = page!.context().waitForEvent('page');
    await page!.locator('.ps-signin').click();
    const popup = await popupPromise;
    const authenticationEvents = observeAuthenticationFlow(popup);
    await expect(popup.evaluate(() => window.opener === null)).resolves.toBe(true);
    const popupClosed = popup.waitForEvent('close', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await authenticateReviewer(popup, reviewer, authenticationEvents);
    await waitForAuthenticationPopup(popup, authenticationEvents, popupClosed);

    const form = page!.locator('[data-ps-feedback-dialog] form');
    await form.waitFor({ state: 'visible' });
    await form.locator('select[name="type"]').selectOption('suggestion');
    await form.locator('textarea[name="message"]').fill(message);
    await form.locator('button[type="submit"]').click();
    await expect.poll(() => form.locator('.ps-status').innerText()).toBe('Sent. Thank you!');

    let feedbackId = '';
    await vi.waitFor(async () => {
      const feedback = await fixture!.sandbox.feedback.list({ source: 'widget', status: 'open' });
      const submitted = feedback.data.find((candidate) => candidate.message === message);
      expect(submitted).toMatchObject({
        author: { source: 'phpsandbox' },
        source: 'widget',
        status: 'open',
        type: 'suggestion',
      });
      feedbackId = submitted?.id ?? '';
    }, { timeout: 30_000, interval: 500 });

    await expect(operation('resolve widget feedback', () => fixture!.sandbox.feedback.update(feedbackId, {
      status: 'resolved',
    }))).resolves.toMatchObject({ id: feedbackId, status: 'resolved' });

    await operation('disable feedback widget', () => fixture!.sandbox.feedback.configure({ widget: null }));
    await expect.poll(async () => {
      await page!.reload({ waitUntil: 'domcontentloaded' });
      return page!.locator('[data-ps-feedback-button]').count();
    }, { timeout: 60_000 }).toBe(0);
  }, 180_000);
});

async function authenticateReviewer(
  popup: Page,
  reviewer: FeedbackReviewerSmokeEnvironment,
  authenticationEvents: string[],
): Promise<void> {
  await popup.locator('#email-username-input').waitFor({ state: 'visible', timeout: 30_000 });
  await popup.locator('#email-username-input').fill(reviewer.username);
  await popup.locator('#login-password-input').fill(reviewer.password);
  authenticationEvents.push(`before click ${await loginFormState(popup)}`);
  await popup.locator('#loginBtn').click();
}

async function waitForAuthenticationPopup(
  popup: Page,
  authenticationEvents: string[],
  popupClosed: Promise<boolean>,
): Promise<void> {
  const closed = await popupClosed;
  if (closed) {
    return;
  }

  const url = sanitizedUrl(popup.url());
  const body = await popup.locator('body').innerText().catch(() => 'unreadable response');
  const sessionStatus = await popup.request.get('https://phpsandbox.io/api/user', { maxRedirects: 0 }).then(
    (response) => response.status(),
    () => 0,
  );
  const cookieMetadata = (await popup.context().cookies('https://phpsandbox.io'))
    .map((cookie) => `${cookie.name}[domain=${cookie.domain};path=${cookie.path};sameSite=${cookie.sameSite};secure=${cookie.secure}]`)
    .join(', ');
  throw new Error(
    `Feedback authentication popup remained open at ${url}; session probe HTTP ${sessionStatus}: `
    + `${body.replaceAll(/\s+/g, ' ').slice(0, 500)}; `
    + `events=${authenticationEvents.join(' | ')}; cookies=${cookieMetadata || 'none'}`,
  );
}

function observeAuthenticationFlow(popup: Page): string[] {
  const events: string[] = [];

  popup.on('request', (request) => {
    const url = new URL(request.url());
    if (isAuthenticationUrl(request.url()) || (url.hostname.endsWith('phpsandbox.io') && request.method() !== 'GET')) {
      events.push(
        `request ${request.method()} ${sanitizedUrl(request.url())} navigation=${request.isNavigationRequest()} resource=${request.resourceType()}`,
      );
    }
  });
  popup.on('response', (response) => {
    if (isAuthenticationUrl(response.url())) {
      const location = response.headers().location;
      events.push(
        `response ${response.status()} ${sanitizedUrl(response.url())}${location ? ` location=${sanitizedLocation(location)}` : ''}`,
      );
    }
  });
  popup.on('framenavigated', (frame) => {
    if (frame === popup.mainFrame()) {
      events.push(`navigated ${sanitizedUrl(frame.url())}`);
    }
  });
  popup.on('console', (message) => {
    if (message.type() === 'error') {
      events.push(`console error ${message.text().replaceAll(/\s+/g, ' ').slice(0, 300)}`);
    }
  });
  popup.on('pageerror', (error) => {
    events.push(`page error ${error.message.replaceAll(/\s+/g, ' ').slice(0, 300)}`);
  });

  return events;
}

async function loginFormState(popup: Page): Promise<string> {
  return popup.locator('form.login-form').evaluate((form) => {
    const username = form.querySelector<HTMLInputElement>('#email-username-input');
    const password = form.querySelector<HTMLInputElement>('#login-password-input');
    const loginButton = form.querySelector<HTMLElement>('#loginBtn');
    const nativeButton = loginButton?.matches('button') ? loginButton as HTMLButtonElement : loginButton?.querySelector('button');

    return [
      `action=${(form as HTMLFormElement).action}`,
      `method=${(form as HTMLFormElement).method}`,
      `valid=${(form as HTMLFormElement).checkValidity()}`,
      `usernamePresent=${Boolean(username?.value)}`,
      `passwordPresent=${Boolean(password?.value)}`,
      `loginElement=${loginButton?.tagName ?? 'missing'}`,
      `buttonType=${nativeButton?.type ?? 'missing'}`,
      `buttonDisabled=${nativeButton?.disabled ?? 'missing'}`,
      `windowName=${window.name || 'empty'}`,
      `hasOpener=${window.opener !== null}`,
    ].join(',');
  });
}

function isAuthenticationUrl(value: string): boolean {
  const url = new URL(value);

  return url.hostname === 'phpsandbox.io' && (url.pathname === '/login' || url.pathname.startsWith('/feedback/grant/'));
}

function sanitizedLocation(value: string): string {
  const url = new URL(value, 'https://phpsandbox.io');

  return `${url.origin}${url.pathname}`;
}

function sanitizedUrl(value: string): string {
  const url = new URL(value);

  return `${url.origin}${url.pathname}`;
}

function runtimePreviewUrl(fixture: SandboxFixture): string {
  const initialized = fixture.sandbox.initialized;
  if (initialized === false || initialized.type !== 'success') {
    throw new Error('Sandbox runtime is not initialized.');
  }

  return initialized.data.previewUrl;
}

import type { NotebookPreviewData, NotebookInstance, PublicationInstance } from '../../dist/index.js';

export function previewStateContracts(state: NotebookPreviewData) {
  switch (state.mode) {
    case 'public': {
      const enabled: false = state.enabled;
      // @ts-expect-error Public access has no credential.
      void state.token;
      return enabled;
    }
    case 'password': {
      const token: string = state.token;
      // @ts-expect-error Password access has no email allowlist.
      void state.allowedEmails;
      return token;
    }
    case 'email': {
      const rules: string[] = state.allowedEmails;
      // @ts-expect-error Built-in email access has no external authorization URL.
      void state.authorizationUrl;
      return rules;
    }
    case 'external': {
      const url: string = state.authorizationUrl;
      return url;
    }
  }
}

export async function previewInputContracts(notebook: NotebookInstance, publication: PublicationInstance) {
  await notebook.preview.configure({ mode: 'email', allowedEmails: ['person@example.com'] });
  // @ts-expect-error Email mode requires an allowlist.
  await notebook.preview.configure({ mode: 'email' });
  // @ts-expect-error External mode requires its authorization URL.
  await notebook.preview.configure({ mode: 'external' });
  // @ts-expect-error A password is required for publication password protection.
  await publication.setProtection({ mode: 'password' });
  // @ts-expect-error Email access is configured through notebook.preview.configure().
  await publication.setProtection({ mode: 'email' });
  // @ts-expect-error External access is configured through notebook.preview.configure().
  await publication.setProtection({ mode: 'external' });
  // @ts-expect-error The response must identify its mode.
  const missingMode: NotebookPreviewData = { enabled: false };
  // @ts-expect-error Email responses must include their rules.
  const missingRules: NotebookPreviewData = { enabled: true, mode: 'email', token: 'token', expiresAt: 'expiry' };

  return { missingMode, missingRules };
}

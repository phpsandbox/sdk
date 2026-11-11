import { describe, expect, test } from 'vitest';
import { readProjectFixtureEnvironment } from '../support/environment.js';

describe('project smoke fixture isolation', () => {
  test('selects the configured target without borrowing another target fixture', () => {
    const fixture = readProjectFixtureEnvironment({
      PHPSANDBOX_SMOKE_PROJECT_FIXTURE: 'http',
      PHPSANDBOX_SMOKE_PROJECT_FIXTURES: JSON.stringify({
        http: { projectId: 'project-http', notebookId: 'notebook-http' },
        realtime: { projectId: 'project-realtime', notebookId: 'notebook-realtime' },
      }),
    });

    expect(fixture).toEqual({ projectId: 'project-http', notebookId: 'notebook-http' });
  });

  test('missing workflow fixtures report the operational prerequisite before API requests', () => {
    expect(() => readProjectFixtureEnvironment({ PHPSANDBOX_SMOKE_PROJECT_FIXTURE: 'http' })).toThrow(
      'Configure PHPSANDBOX_SMOKE_PROJECT_FIXTURES'
    );
  });

  test.each([
    { projectId: 'project-http', notebookId: 'other-notebook' },
    { projectId: 'other-project', notebookId: 'notebook-http' },
  ])('rejects projects or compute shared by concurrently scheduled targets', (other) => {
    expect(() =>
      readProjectFixtureEnvironment({
        PHPSANDBOX_SMOKE_PROJECT_FIXTURE: 'http',
        PHPSANDBOX_SMOKE_PROJECT_FIXTURES: JSON.stringify({
          http: { projectId: 'project-http', notebookId: 'notebook-http' },
          realtime: other,
        }),
      })
    ).toThrow('Smoke targets must use separate projects and main notebooks');
  });

  test('local smoke accepts an explicitly supplied disposable project pair', () => {
    expect(
      readProjectFixtureEnvironment({
        PHPSANDBOX_SMOKE_PROJECT_ID: 'project-local',
        PHPSANDBOX_SMOKE_PROJECT_NOTEBOOK_ID: 'notebook-local',
      })
    ).toEqual({ projectId: 'project-local', notebookId: 'notebook-local' });
  });
});

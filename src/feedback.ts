import type { Client, PaginatedApiResponse } from './index.js';

export type FeedbackType = 'bug' | 'suggestion' | 'question' | 'other';
export type FeedbackStatus = 'open' | 'queued' | 'resolved' | 'archived';
export type FeedbackSource = 'sdk' | 'widget';
export type FeedbackWidgetTarget = 'preview' | 'publication';

export interface FeedbackWidgetConfig {
  targets: FeedbackWidgetTarget[];
  label?: string;
  types?: FeedbackType[];
}

export interface ConfigureFeedbackInput {
  widget: FeedbackWidgetConfig | null;
}

export interface SubmitFeedbackInput {
  type: FeedbackType;
  message: string;
  author?: {
    externalId?: string;
    name?: string;
    email?: string;
  };
  context?: {
    url?: string;
    path?: string;
    title?: string;
    userAgent?: string;
    appVersion?: string;
    imageUrls?: string[];
  };
  metadata?: Record<string, unknown>;
}

export interface SubmitFeedbackOptions {
  idempotencyKey?: string;
}

export interface FeedbackData {
  id: string;
  projectId: string;
  type: FeedbackType;
  message: string;
  status: FeedbackStatus;
  source: FeedbackSource;
  author: {
    source: 'external' | 'phpsandbox';
    externalId: string | null;
    phpsandboxUserId: number | null;
    name: string | null;
    email: string | null;
  };
  context: {
    url: string | null;
    path: string | null;
    publication: {
      id: string;
      releaseId: string | null;
    } | null;
  };
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackListOptions {
  type?: FeedbackType;
  status?: FeedbackStatus;
  source?: FeedbackSource;
  page?: number;
}

export interface UpdateFeedbackInput {
  status: FeedbackStatus;
}

export class Feedback {
  public constructor(
    private readonly client: Client,
    private readonly identifier: string
  ) {}

  public async configure(input: ConfigureFeedbackInput): Promise<ConfigureFeedbackInput> {
    const response = await this.client.put<ConfigureFeedbackInput>(this.path('/configuration'), input);

    return response.data;
  }

  public async configuration(): Promise<ConfigureFeedbackInput> {
    const response = await this.client.get<ConfigureFeedbackInput>(this.path('/configuration'));

    return response.data;
  }

  public async submit(input: SubmitFeedbackInput, options: SubmitFeedbackOptions = {}): Promise<FeedbackData> {
    const response = await this.client.post<FeedbackData>(this.path(), input, options);

    return response.data;
  }

  public async list(options: FeedbackListOptions = {}): Promise<PaginatedApiResponse<FeedbackData>> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(options)) {
      if (value !== undefined) {
        query.set(name, String(value));
      }
    }
    return this.client.get<FeedbackData[]>(`${this.path()}${query.size === 0 ? '' : `?${query.toString()}`}`);
  }

  public async get(id: string): Promise<FeedbackData> {
    const response = await this.client.get<FeedbackData>(this.path(`/${encodeURIComponent(id)}`));

    return response.data;
  }

  public async update(id: string, input: UpdateFeedbackInput): Promise<FeedbackData> {
    const response = await this.client.patch<FeedbackData>(this.path(`/${encodeURIComponent(id)}`), input);

    return response.data;
  }

  private path(suffix = ''): string {
    return `/platform/projects/${encodeURIComponent(this.identifier)}/feedback${suffix}`;
  }
}

/** Address project feedback directly without fetching or starting a sandbox. */
export class FeedbackApi {
  public constructor(private readonly client: Client) {}

  public forProject(projectId: string): Feedback {
    return new Feedback(this.client, projectId);
  }

  public forNotebook(notebookId: string): Feedback {
    return new Feedback(this.client, notebookId);
  }
}

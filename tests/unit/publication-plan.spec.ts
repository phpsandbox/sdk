import { describe, expect, it, vi } from "vitest";
import {
  laravelCloudSetupForRepublish,
  PHPSandbox,
  type PublicationRun,
  type PublicationPlan,
} from "../../src/index.js";

async function notebook() {
  return PHPSandbox.rest("token", "https://api.example/v1", {
    fetch: vi.fn(async () =>
      Response.json({
        data: {
          id: "nb",
          status: "running",
          runtimeUrl: "https://runtime.example/actions?ticket=test-ticket",
        },
      }),
    ) as typeof globalThis.fetch,
  }).notebook.get("nb");
}

describe("publication planning", () => {
  it("reuses retained resources after unpublish without changing the saved setup", () => {
    const setup = {
      database: { mode: "create" as const, type: "laravel_mysql" },
      cache: { mode: "reuse" as const, id: "existing" },
      storage: { mode: "create" as const },
      worker: true,
    };
    expect(
      laravelCloudSetupForRepublish(setup, { databaseId: "schema", storageId: "key" }),
    ).toEqual({
      database: { mode: "reuse", id: "schema" },
      cache: { mode: "reuse", id: "existing" },
      storage: { mode: "reuse", id: "key" },
      worker: true,
    });
    expect(setup.database.mode).toBe("create");
    expect(laravelCloudSetupForRepublish(setup)).toEqual(setup);
  });
  it("uses the shared readiness and planning endpoints without starting a deployment", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = PHPSandbox.rest("token", "https://api.example/v1", {
      fetch: vi.fn(async (request: Request) => {
        requests.push({ url: request.url, method: request.method, body: await request.text() });
        return Response.json({
          data: request.url.endsWith("/notebook/nb")
            ? {
                id: "nb",
                status: "running",
                runtimeUrl: "https://runtime.example/actions?ticket=test-ticket",
              }
            : { ready: false, blockers: [{ code: "source.connect" }] },
        });
      }) as typeof globalThis.fetch,
    });
    const nb = await client.notebook.get("nb");
    await nb.publicationReadiness();
    const input = {
      provider: { name: "ssh-server" as const },
      requirements: [{ kind: "database" as const, required: true, engine: "mysql" }],
      resources: { database: { mode: "external" as const } },
    };
    const plan = await nb.planPublication(input);
    expect(plan.ready).toBe(false);
    expect(requests.slice(1)).toEqual([
      { url: "https://api.example/v1/notebook/nb/publication/readiness", method: "GET", body: "" },
      {
        url: "https://api.example/v1/notebook/nb/publication/plan",
        method: "POST",
        body: JSON.stringify(input),
      },
    ]);
    nb.dispose();
  });
  it("does not commit or publish a blocked plan", async () => {
    const nb = await notebook();
    vi.spyOn(nb, "planPublication").mockResolvedValue({
      ready: false,
      blockers: [{ code: "source.connect", message: "Connect GitHub" }],
    } as PublicationPlan);
    const prepare = vi.spyOn(nb, "preparePublicationSource");
    const publish = vi.spyOn(nb, "publish");
    await expect(
      nb.publishPlanned({
        slug: "app",
        provider: { name: "laravel-cloud", region: "eu-central-1" },
      }),
    ).rejects.toThrow("Connect GitHub");
    expect(prepare).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    nb.dispose();
  });
  it("rejects first-publication execution for an existing app before committing", async () => {
    const nb = await notebook();
    vi.spyOn(nb, "planPublication").mockResolvedValue({
      ready: true,
      blockers: [],
      source: { commitAndPush: true },
    } as PublicationPlan);
    vi.spyOn(nb, "publication").mockResolvedValue({} as never);
    const prepare = vi.spyOn(nb, "preparePublicationSource");
    const publish = vi.spyOn(nb, "publish");
    await expect(
      nb.publishPlanned({
        slug: "app",
        provider: { name: "laravel-cloud", region: "eu-central-1" },
      }),
    ).rejects.toThrow("already has a publication");
    expect(prepare).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    nb.dispose();
  });
  it("prepares a clean revision without an empty commit and verifies the pushed revision", async () => {
    const nb = await notebook();
    const sync = vi.fn().mockResolvedValue({ data: { lastCommitSha: "revision" } });
    vi.spyOn(nb.git.targets, "list").mockResolvedValue([
      { data: { default: true, branch: "main" }, sync },
    ] as never);
    vi.spyOn(nb.git, "status").mockResolvedValue({
      initialized: true,
      clean: true,
      branch: "main",
      ref: "revision",
    });
    const checkpoint = vi.spyOn(nb.git, "checkpoint");
    const author = { name: "Author", email: "author@example.com" };
    await expect(nb.preparePublicationSource(author)).resolves.toBe("revision");
    expect(checkpoint).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith({ direction: "push", author });
    sync.mockResolvedValue({ data: { lastCommitSha: "older-revision" } });
    await expect(nb.preparePublicationSource(author)).rejects.toThrow(
      "latest changes have not reached GitHub",
    );
    nb.dispose();
  });
  it("commits a dirty workspace but stops on a branch mismatch", async () => {
    const nb = await notebook();
    const sync = vi.fn().mockResolvedValue({ data: { lastCommitSha: "new-revision" } });
    vi.spyOn(nb.git.targets, "list").mockResolvedValue([
      { data: { default: true, branch: "main" }, sync },
    ] as never);
    const status = vi
      .spyOn(nb.git, "status")
      .mockResolvedValue({ initialized: true, clean: false, branch: "main", ref: "old" });
    const checkpoint = vi.spyOn(nb.git, "checkpoint").mockResolvedValue({ ref: "new-revision" });
    await nb.preparePublicationSource({ name: "Author", email: "author@example.com" });
    expect(checkpoint).toHaveBeenCalledWith(
      "Author <author@example.com>",
      "Prepare publication",
      "main",
      false,
    );
    status.mockResolvedValue({ initialized: true, clean: false, branch: "other", ref: "old" });
    sync.mockClear();
    await expect(
      nb.preparePublicationSource({ name: "Author", email: "author@example.com" }),
    ).rejects.toThrow("Switch to main");
    expect(sync).not.toHaveBeenCalled();
    nb.dispose();
  });
  it("executes the resolved Laravel Cloud setup only after source preparation", async () => {
    const nb = await notebook();
    vi.spyOn(nb, "publication").mockResolvedValue(null);
    const setup = {
      repositoryAccessConfirmed: true,
      database: { mode: "reuse" as const, id: "database" },
    };
    vi.spyOn(nb, "planPublication").mockResolvedValue({
      ready: true,
      blockers: [],
      source: { commitAndPush: true },
      input: { provider: { name: "laravel-cloud", setup } },
    } as PublicationPlan);
    const prepare = vi.spyOn(nb, "preparePublicationSource").mockResolvedValue("revision");
    const publish = vi.spyOn(nb, "publish").mockResolvedValue({} as PublicationRun);
    await nb.publishPlanned(
      {
        slug: "app",
        provider: { name: "laravel-cloud", region: "eu-central-1" },
        resources: { database: setup.database },
      },
      { author: { name: "Author", email: "author@example.com" } },
    );
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]);
    expect(publish.mock.calls[0][0]?.provider).toEqual({
      name: "laravel-cloud",
      region: "eu-central-1",
      setup,
    });
    nb.dispose();
  });
});

import { expect, it } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

it('lists owner and notebook resource inventories through their scoped endpoints', async () => {
  const requests: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(new Request(input, init));
    return Response.json({ data: [], links: {}, meta: { current_page: 1 } });
  };
  const client = PHPSandbox.realtime('token', 'https://api.example/v1', {
    fetch,
  });
  await client.publications.resources.list({
    provider: 'ssh-server',
    kind: 'database',
    type: 'mysql',
    scope: 'server/id',
    page: 2,
  });
  await client.notebook
    .open({
      id: 'nb',
      runtimeUrl: 'https://runtime.example.test',
      gitUrl: 'https://git.example.test',
    })
    .publication.resources.list();
  expect(requests.map((request) => [request.method, request.url])).toEqual([
    ['GET', 'https://api.example/v1/publication-resources?provider=ssh-server&kind=database&type=mysql&scope=server%2Fid&page=2'],
    ['GET', 'https://api.example/v1/notebook/nb/publication/resources'],
  ]);
});

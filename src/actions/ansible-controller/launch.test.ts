import { ConfigReader } from '@backstage/config';
import { registerMswTestHooks } from '@backstage/backend-test-utils';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createAnsibleControllerJobTemplateLaunchAction } from './launch';

const BASE = 'https://aap.example.com/api/v2';

function makeAction(extra: Record<string, unknown> = {}) {
  return createAnsibleControllerJobTemplateLaunchAction({
    config: new ConfigReader({
      integrations: {
        'ansible-controller': [
          {
            name: 'my-controller',
            url: 'https://aap.example.com/',
            username: 'admin',
            password: 'secret',
            pollInterval: 0.01,
            ...extra,
          },
        ],
      },
    }),
  });
}

describe('ansible-controller:job_template:launch', () => {
  const server = setupServer();
  registerMswTestHooks(server);

  function mockController(statuses: string[]) {
    let calls = 0;
    const launchBodies: unknown[] = [];
    const authHeaders: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/job_templates/`, ({ request }) => {
        authHeaders.push(request.headers.get('authorization'));
        const name = new URL(request.url).searchParams.get('name');
        return HttpResponse.json({
          results: name === 'Demo Job Template' ? [{ id: 7 }] : [],
        });
      }),
      http.post(`${BASE}/job_templates/7/launch/`, async ({ request }) => {
        launchBodies.push(await request.json());
        return HttpResponse.json({ job: 42 });
      }),
      http.get(`${BASE}/jobs/42/`, () => {
        const status = statuses[Math.min(calls, statuses.length - 1)];
        calls++;
        return HttpResponse.json({ id: 42, status });
      }),
      http.get(`${BASE}/jobs/42/stdout/`, () =>
        HttpResponse.text('PLAY [all]\nok: [localhost]\n'),
      ),
    );
    return { launchBodies, authHeaders };
  }

  it('exposes a zod-derived input schema', () => {
    const action = makeAction();
    const input = action.schema?.input as any;
    expect(input).toBeDefined();
    expect(input.required).toEqual(
      expect.arrayContaining(['controller', 'job_template']),
    );
    expect(input.required).not.toContain('extra_vars');
    expect(Object.keys(input.properties)).toEqual(
      expect.arrayContaining([
        'controller',
        'job_template',
        'extra_vars',
        'timeout',
      ]),
    );
  });

  it('launches the job template and waits for success', async () => {
    const { launchBodies, authHeaders } = mockController([
      'pending',
      'running',
      'successful',
    ]);
    const ctx = createMockActionContext({
      input: {
        controller: 'my-controller',
        job_template: 'Demo Job Template',
        extra_vars: { foo: 'bar' },
      },
    });
    const info = jest.spyOn(ctx.logger, 'info');

    await makeAction().handler(ctx as any);

    expect(launchBodies).toEqual([{ extra_vars: { foo: 'bar' } }]);
    expect(authHeaders[0]).toBe(
      `Basic ${Buffer.from('admin:secret').toString('base64')}`,
    );
    expect(ctx.output).toHaveBeenCalledWith('job', {
      id: 42,
      status: 'successful',
    });
    expect(info).toHaveBeenCalledWith('ok: [localhost]');
  });

  it('works without extra_vars', async () => {
    const { launchBodies } = mockController(['successful']);
    const ctx = createMockActionContext({
      input: { controller: 'my-controller', job_template: 'Demo Job Template' },
    });
    await makeAction().handler(ctx as any);
    expect(launchBodies).toEqual([{ extra_vars: {} }]);
  });

  it('fails when the job fails', async () => {
    mockController(['running', 'failed']);
    const ctx = createMockActionContext({
      input: { controller: 'my-controller', job_template: 'Demo Job Template' },
    });
    await expect(makeAction().handler(ctx as any)).rejects.toThrow(
      /playbook execution fail/,
    );
    expect(ctx.output).toHaveBeenCalledWith('job', {
      id: 42,
      status: 'failed',
    });
  });

  it('times out when the job never finishes', async () => {
    mockController(['running']);
    const ctx = createMockActionContext({
      input: {
        controller: 'my-controller',
        job_template: 'Demo Job Template',
        timeout: 1,
      },
    });
    await expect(makeAction().handler(ctx as any)).rejects.toThrow(
      /Timed out after 1s/,
    );
  });

  it('fails for unknown controller', async () => {
    const ctx = createMockActionContext({
      input: { controller: 'nope', job_template: 'Demo Job Template' },
    });
    await expect(makeAction().handler(ctx as any)).rejects.toThrow(
      /controller nope has not found/,
    );
  });

  it('fails for unknown job template', async () => {
    mockController(['successful']);
    const ctx = createMockActionContext({
      input: { controller: 'my-controller', job_template: 'Other' },
    });
    await expect(makeAction().handler(ctx as any)).rejects.toThrow(
      /Job template "Other" not found/,
    );
  });

  it('fails on HTTP errors', async () => {
    server.use(
      http.get(`${BASE}/job_templates/`, () =>
        HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 }),
      ),
    );
    const ctx = createMockActionContext({
      input: { controller: 'my-controller', job_template: 'Demo Job Template' },
    });
    await expect(makeAction().handler(ctx as any)).rejects.toThrow(/401/);
  });

  it('supports the AAP gateway api path', async () => {
    server.use(
      http.get('https://aap.example.com/api/controller/v2/job_templates/', () =>
        HttpResponse.json({ results: [] }),
      ),
    );
    const ctx = createMockActionContext({
      input: { controller: 'my-controller', job_template: 'X' },
    });
    await expect(
      makeAction({ apiPath: '/api/controller/v2' }).handler(ctx as any),
    ).rejects.toThrow(/not found/);
  });
});

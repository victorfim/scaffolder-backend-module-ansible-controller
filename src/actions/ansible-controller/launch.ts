import {
  DiscoveryService,
  RootConfigService,
} from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

const DEFAULT_TIMEOUT_SECONDS = 3600;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_API_PATH = '/api/v2';
const FAIL_STATUSES = ['failed', 'error', 'canceled', 'missing'];
const FINAL_STATUSES = ['successful', ...FAIL_STATUSES];

/**
 * Options for {@link createAnsibleControllerJobTemplateLaunchAction}.
 *
 * @public
 */
export interface AnsibleControllerLaunchActionOptions {
  config: RootConfigService;
  /** Kept for backwards compatibility; not used by the action. */
  discovery?: DiscoveryService;
}

/**
 * Creates an `ansible-controller:job_template:launch` Scaffolder action.
 *
 * @remarks
 *
 * Launches a job template on an Ansible Automation Platform / AWX controller
 * configured under `integrations.ansible-controller`, streams the job output to
 * the task log and waits until the job finishes or the timeout is reached.
 *
 * @public
 */
export function createAnsibleControllerJobTemplateLaunchAction(
  options: AnsibleControllerLaunchActionOptions,
) {
  return createTemplateAction({
    id: 'ansible-controller:job_template:launch',
    description:
      'Launch a job template in Ansible controller and wait for it to finish',
    supportsDryRun: false,
    schema: {
      input: {
        controller: z =>
          z
            .string()
            .min(1)
            .describe(
              'Name of the controller configured in integrations.ansible-controller',
            ),
        job_template: z =>
          z.string().min(1).describe('Name of the job template to launch'),
        extra_vars: z =>
          z
            .record(z.string(), z.any())
            .optional()
            .describe('extra_vars passed to the job template'),
        timeout: z =>
          z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              'Maximum time in seconds to wait for the job to finish (default: controller config or 3600)',
            ),
      },
      output: {
        job: z =>
          z
            .record(z.string(), z.any())
            .describe('Final job object returned by the controller'),
      },
    },
    async handler(ctx) {
      const { controller, job_template: jobTemplateName } = ctx.input;
      const extraVars = ctx.input.extra_vars ?? {};

      const controllerConfig = options.config
        .getOptionalConfigArray('integrations.ansible-controller')
        ?.find(c => c.getString('name') === controller);

      if (!controllerConfig) {
        throw new Error(
          `controller ${controller} has not found in integrations.ansible-controller entry in app-config`,
        );
      }

      const username = controllerConfig.getString('username');
      const password = controllerConfig.getString('password');
      const baseUrl = controllerConfig.getString('url').replace(/\/+$/, '');
      const apiPath = (
        controllerConfig.getOptionalString('apiPath') ?? DEFAULT_API_PATH
      ).replace(/\/+$/, '');
      const apiUrl = `${baseUrl}${apiPath}`;
      const timeoutSeconds =
        ctx.input.timeout ??
        controllerConfig.getOptionalNumber('timeout') ??
        DEFAULT_TIMEOUT_SECONDS;
      const pollIntervalMs =
        (controllerConfig.getOptionalNumber('pollInterval') ??
          DEFAULT_POLL_INTERVAL_SECONDS) * 1000;

      const authHeader = `Basic ${Buffer.from(
        `${username}:${password}`,
      ).toString('base64')}`;

      async function request(
        url: string,
        init: { method?: string; body?: unknown } = {},
      ): Promise<Response> {
        const response = await fetch(url, {
          method: init.method ?? 'GET',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: ctx.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(
            `Request to ${url} failed with ${response.status} ${response.statusText}: ${text}`,
          );
        }
        return response;
      }

      const getJson = async (
        url: string,
        init?: { method?: string; body?: unknown },
      ) => (await request(url, init)).json() as Promise<any>;

      const getJobOutput = async (jobId: number): Promise<string> =>
        (await request(`${apiUrl}/jobs/${jobId}/stdout/?format=txt`)).text();

      let printed = 0;
      const logNewOutput = async (jobId: number) => {
        const output = await getJobOutput(jobId);
        if (output.length > printed) {
          for (const line of output.substring(printed).split('\n')) {
            if (line.length > 0) ctx.logger.info(line);
          }
          printed = output.length;
        }
      };

      const sleep = (ms: number) =>
        new Promise<void>((resolve, reject) => {
          if (ctx.signal?.aborted) {
            reject(new Error('Task was cancelled'));
            return;
          }
          let timer: ReturnType<typeof setTimeout> | undefined = undefined;
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Task was cancelled'));
          };
          timer = setTimeout(() => {
            ctx.signal?.removeEventListener('abort', onAbort);
            resolve();
          }, ms);
          ctx.signal?.addEventListener('abort', onAbort, { once: true });
        });

      // 1. Find the job template id by name
      const templates = await getJson(
        `${apiUrl}/job_templates/?name=${encodeURIComponent(jobTemplateName)}`,
      );
      const templateId: number | undefined = templates?.results?.[0]?.id;
      if (!templateId) {
        throw new Error(
          `Job template "${jobTemplateName}" not found in controller ${controller}`,
        );
      }
      ctx.logger.info(`templateId: ${templateId}`);

      // 2. Launch the job template
      const launch = await getJson(
        `${apiUrl}/job_templates/${templateId}/launch/`,
        { method: 'POST', body: { extra_vars: extraVars } },
      );
      const jobId: number | undefined = launch?.job ?? launch?.id;
      if (!jobId) {
        throw new Error(
          `Failed to launch job template "${jobTemplateName}": ${JSON.stringify(
            launch,
          )}`,
        );
      }
      ctx.logger.info(`jobId: ${jobId}`);

      // 3. Poll until the job reaches a final status or the timeout expires
      const deadline = Date.now() + timeoutSeconds * 1000;
      let job = await getJson(`${apiUrl}/jobs/${jobId}/`);
      ctx.logger.info(`Job Status: ${job.status}`);

      while (!FINAL_STATUSES.includes(String(job.status).toLowerCase())) {
        if (Date.now() >= deadline) {
          ctx.output('job', job);
          throw new Error(
            `Timed out after ${timeoutSeconds}s waiting for job ${jobId} (last status: ${job.status})`,
          );
        }
        await sleep(
          Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)),
        );
        await logNewOutput(jobId);
        job = await getJson(`${apiUrl}/jobs/${jobId}/`);
      }

      await logNewOutput(jobId);
      ctx.logger.info(`Job Status: ${job.status}`);
      ctx.output('job', job);

      if (FAIL_STATUSES.includes(String(job.status).toLowerCase())) {
        throw new Error(
          `playbook execution fail. Job ${jobId} status: ${job.status}`,
        );
      }
    },
  });
}

import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import request from 'supertest';
import scaffolderPlugin from '@backstage/plugin-scaffolder-backend';
import scaffolderModule from './index';

describe('scaffolder ansible-controller module', () => {
  it('registers the action in the scaffolder backend', async () => {
    const { server } = await startTestBackend({
      features: [
        scaffolderPlugin,
        scaffolderModule,
        mockServices.rootConfig.factory({
          data: {
            integrations: {
              'ansible-controller': [
                {
                  name: 'my-controller',
                  url: 'https://aap.example.com',
                  username: 'u',
                  password: 'p',
                },
              ],
            },
          },
        }),
      ],
    });

    const res = await request(server)
      .get('/api/scaffolder/v2/actions')
      .set('Authorization', mockCredentials.user.header());

    expect(res.status).toBe(200);
    const action = res.body.find(
      (a: { id: string }) => a.id === 'ansible-controller:job_template:launch',
    );
    expect(action).toBeDefined();
    expect(action.schema.input.required).toEqual(
      expect.arrayContaining(['controller', 'job_template']),
    );
  }, 60000);
});

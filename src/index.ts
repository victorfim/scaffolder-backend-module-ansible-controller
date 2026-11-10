/**
 * The ansible-controller module for @backstage/plugin-scaffolder-backend.
 *
 * @packageDocumentation
 */
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createAnsibleControllerJobTemplateLaunchAction } from './actions/ansible-controller/launch';

export * from './actions';

/**
 * A backend module that registers the `ansible-controller:job_template:launch`
 * action into the scaffolder.
 *
 * @public
 */
export const scaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'ansible-controller',
  register({ registerInit }) {
    registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
        discovery: coreServices.discovery,
        config: coreServices.rootConfig,
      },
      async init({ scaffolderActions, discovery, config }) {
        scaffolderActions.addActions(
          createAnsibleControllerJobTemplateLaunchAction({ discovery, config }),
        );
      },
    });
  },
});

export default scaffolderModule;

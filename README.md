# @mycloudlab/scaffolder-backend-module-ansible-controller

![NPM Version](https://img.shields.io/npm/v/%40mycloudlab%2Fscaffolder-backend-module-ansible-controller)


Plugin used to integrate ansible with backstage.

This plugin allows the execution of an ansible job-template from an action in the template step.

## Compatibility

| Plugin branch / version | Backstage | RHDH |
| --- | --- | --- |
| `rhdh-1.10-compat` | 1.49 (`backend-plugin-api` ^1.8, `plugin-scaffolder-node` ^0.13.1) | 1.10 (Node 24) |
| 0.5.x (npm) | <= 1.3x (`/alpha` extension point) | 1.4 |

From `@backstage/plugin-scaffolder-node` 0.12 on, `scaffolderActionsExtensionPoint` is no longer exported from
`/alpha`, and JSON Schema inputs are ignored. This branch imports the extension point from the package index and
declares the action input with zod.

## install on RHDH

### RHDH 1.10+

RHDH 1.10 loads backend plugins from their dynamic export. Build and export the plugin, then publish it as an OCI
image (or a `.tgz` on a registry the cluster can reach):

```bash
yarn install
yarn tsc
yarn build
npx @red-hat-developer-hub/cli@latest plugin export
npx @red-hat-developer-hub/cli@latest plugin package --tag quay.io/<org>/scaffolder-backend-module-ansible-controller:<version>
```

```yaml
# dynamic-plugins config
plugins:
  - package: oci://quay.io/<org>/scaffolder-backend-module-ansible-controller:<version>!mycloudlab-scaffolder-backend-module-ansible-controller-dynamic
    disabled: false
```

### RHDH 1.4 (npm package 0.5.x)

Check integrity version using command:
```bash
# please change <version> to especific version
curl -sL https://registry.npmjs.org/@mycloudlab/scaffolder-backend-module-ansible-controller/<version> | jq '.dist.integrity' -r
```

```yaml
# add entry dynamic-plugins-rhdh config map
# please change <version> to especific version
    plugins:
      - package: '@mycloudlab/scaffolder-backend-module-ansible-controller@<version>'
        integrity: '<integrity of before command>'
        disabled: false   
```

## how to use

Configure your `app-config.yaml` with this entry.

```yaml
# app-config.yaml

...

integrations:
  ansible-controller:
    - name: my-controller
      url: https://aap.host.com
      username: username
      password: ${AAP_PASSWORD}
      # optional
      # apiPath: /api/controller/v2  # when url points to the AAP 2.5+ gateway (default /api/v2)
      # timeout: 3600                # max seconds to wait for the job (default 3600)
      # pollInterval: 5              # seconds between status checks (default 5)
```

Configure your template call to ansible:

```yaml
# your template
  steps:
    - id: call-ansible
      name: Calling ansible to launch
      action: ansible-controller:job_template:launch
      input:
        controller: my-controller
        job_template: Demo Job Template
        extra_vars:
          execution_count: ${{ parameters.execution_count }}
          fail_execution: ${{ parameters.fail_execution }}
        # optional, overrides the controller timeout (seconds)
        # timeout: 1800
```

Inputs: `controller` (required), `job_template` (required), `extra_vars` (optional object), `timeout` (optional,
seconds). Output: `job`, the final job object returned by the controller. The step fails if the job ends as
`failed`, `error`, `canceled` or `missing`, or if the timeout is reached.


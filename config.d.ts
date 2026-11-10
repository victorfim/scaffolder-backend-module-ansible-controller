export interface Config {
  integrations?: {
    /**
     * Ansible Automation Platform / AWX controllers used by the
     * `ansible-controller:job_template:launch` scaffolder action.
     */
    'ansible-controller'?: Array<{
      /** Name referenced by the `controller` input of the action. */
      name: string;
      /** Base URL of the controller, e.g. https://aap.example.com */
      url: string;
      /** Username for Basic authentication. */
      username: string;
      /**
       * Password for Basic authentication.
       * @visibility secret
       */
      password: string;
      /**
       * Maximum time, in seconds, to wait for a job to finish. Defaults to 3600.
       * Can be overridden per step with the `timeout` input.
       */
      timeout?: number;
      /**
       * API base path. Defaults to /api/v2. Use /api/controller/v2 when
       * `url` points to the AAP 2.5+ platform gateway.
       */
      apiPath?: string;
      /** Interval, in seconds, between job status polls. Defaults to 5. */
      pollInterval?: number;
    }>;
  };
}

import { createTestEnvironment } from '../../../scripts/test-integration.mjs';

export default async function setup() {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const environment = await createTestEnvironment({ withServices: true, signal: controller.signal });
    Object.assign(process.env, environment.env);
    process.env.HANDOFF_TEST_PROJECT = environment.project;
    if (environment.apiControlUrl) process.env.HANDOFF_TEST_API_CONTROL_URL = environment.apiControlUrl;
    if (environment.apiControlToken) process.env.HANDOFF_TEST_API_CONTROL_TOKEN = environment.apiControlToken;
    return async () => {
      try {
        await environment.close();
      } finally {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', interrupt);
      }
    };
  } catch (error) {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    throw error;
  }
}

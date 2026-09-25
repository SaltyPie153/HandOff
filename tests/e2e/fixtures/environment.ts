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
    if (environment.apiPid) process.env.HANDOFF_TEST_API_PID = String(environment.apiPid);
    process.env.HANDOFF_TEST_API_REPLACEMENT_PID_FILE = environment.apiReplacementPidFile;
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

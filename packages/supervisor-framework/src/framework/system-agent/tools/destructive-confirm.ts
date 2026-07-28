export const buildDeleteSkillConfirmToken = (module: string, name: string): string =>
  `delete-skill:${module}:${name}`;

export const buildDeleteRuntimeAgentConfirmToken = (id: string): string =>
  `delete-runtime-agent:${id}`;

export const buildDeleteCronJobConfirmToken = (jobName: string): string =>
  `delete-cron-job:${jobName}`;

export const requireDestructiveConfirmToken = (token: string, expected: string): void => {
  if (token !== expected) {
    throw new Error(`Confirmation required. Re-call with confirmToken: "${expected}"`);
  }
};

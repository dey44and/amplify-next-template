const REQUIRED_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AMPLIFY_DATA_DEFAULT_NAME",
] as const;

type DataClientEnv = {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  AWS_REGION: string;
  AMPLIFY_DATA_DEFAULT_NAME: string;
} & Record<string, unknown>;

export function getDataClientEnv(): DataClientEnv {
  // Keep runtime behavior aligned with Amplify's generated env module,
  // while still giving this repo a stable import path in CI.
  return process.env as unknown as DataClientEnv;
}

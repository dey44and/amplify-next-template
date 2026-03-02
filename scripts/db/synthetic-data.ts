import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import outputs from "../../amplify_outputs.json";

const execFileAsync = promisify(execFile);

const MODEL_NAMES = [
  "UserProfile",
  "MockExam",
  "Task",
  "TaskKey",
  "ExamRequest",
  "ExamAccess",
  "ExamAttempt",
] as const;

const RESTORE_ORDER = [
  "UserProfile",
  "MockExam",
  "Task",
  "TaskKey",
  "ExamRequest",
  "ExamAccess",
  "ExamAttempt",
] as const;

type DynAttr = {
  S?: string;
  N?: string;
  BOOL?: boolean;
  NULL?: boolean;
  M?: Record<string, DynAttr>;
  L?: DynAttr[];
};

type DynItem = Record<string, DynAttr>;

type WriteRequest = {
  PutRequest?: { Item: DynItem };
  DeleteRequest?: { Key: DynItem };
};

type ModelBackup = {
  tableName: string;
  keyNames: string[];
  items: DynItem[];
};

type BackupFile = {
  version: 1;
  createdAt: string;
  appSyncApiId: string;
  region: string;
  models: Partial<Record<(typeof MODEL_NAMES)[number], ModelBackup>>;
};

type DataSource = {
  name?: string;
  type?: string;
  dynamodbConfig?: {
    tableName?: string;
  };
};

type CliContext = {
  command: string;
  profile?: string;
  region: string;
  apiId: string;
  tableSuffix: string;
  args: string[];
};

function parseApiIdFromUrl(url: string) {
  const host = new URL(url).hostname;
  return host.split(".")[0] ?? "";
}

function fail(message: string): never {
  throw new Error(message);
}

function getArg(args: string[], flag: string) {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string) {
  return args.includes(flag);
}

function toPositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    fail(`Invalid value for integer argument: ${value}`);
  }
  return n;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAwsJson(ctx: CliContext, awsArgs: string[]) {
  const args: string[] = ["--region", ctx.region];
  if (ctx.profile) {
    args.push("--profile", ctx.profile);
  }

  args.push(...awsArgs, "--output", "json");

  const { stdout, stderr } = await execFileAsync("aws", args, {
    maxBuffer: 100 * 1024 * 1024,
  });

  if (stderr && stderr.trim()) {
    // keep stderr visible for troubleshooting, but don't fail only on warnings
    process.stderr.write(stderr);
  }

  const text = stdout?.trim();
  if (!text) return {} as Record<string, unknown>;
  return JSON.parse(text) as Record<string, unknown>;
}

async function runAwsJsonWithFile(
  ctx: CliContext,
  awsArgs: string[],
  fileFlag: string,
  payload: unknown
) {
  const tmp = path.join(process.cwd(), `.tmp/aws-${Date.now()}-${Math.random()}.json`);
  await fs.mkdir(path.dirname(tmp), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(payload), "utf8");

  try {
    return await runAwsJson(ctx, [...awsArgs, fileFlag, `file://${tmp}`]);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function getTableName(source: DataSource) {
  const name = source.dynamodbConfig?.tableName;
  return typeof name === "string" ? name : "";
}

async function listAllDataSources(ctx: CliContext) {
  const dataSources: DataSource[] = [];
  let token: string | undefined;

  do {
    const res = await runAwsJson(ctx, [
      "appsync",
      "list-data-sources",
      "--api-id",
      ctx.apiId,
      ...(token ? ["--next-token", token] : []),
    ]);

    const page = Array.isArray(res.dataSources) ? (res.dataSources as DataSource[]) : [];
    dataSources.push(...page);

    token = typeof res.nextToken === "string" ? res.nextToken : undefined;
  } while (token);

  return dataSources;
}

function isAccessDeniedError(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    message.includes("AccessDeniedException") ||
    message.includes("not authorized") ||
    message.includes("Unauthorized")
  );
}

function deterministicTableMap(ctx: CliContext) {
  const map: Record<(typeof MODEL_NAMES)[number], string> = {
    UserProfile: `UserProfile-${ctx.apiId}-${ctx.tableSuffix}`,
    MockExam: `MockExam-${ctx.apiId}-${ctx.tableSuffix}`,
    Task: `Task-${ctx.apiId}-${ctx.tableSuffix}`,
    TaskKey: `TaskKey-${ctx.apiId}-${ctx.tableSuffix}`,
    ExamRequest: `ExamRequest-${ctx.apiId}-${ctx.tableSuffix}`,
    ExamAccess: `ExamAccess-${ctx.apiId}-${ctx.tableSuffix}`,
    ExamAttempt: `ExamAttempt-${ctx.apiId}-${ctx.tableSuffix}`,
  };
  return map;
}

async function discoverModelTables(ctx: CliContext) {
  let sources: DataSource[];
  try {
    sources = await listAllDataSources(ctx);
  } catch (error) {
    if (!isAccessDeniedError(error)) throw error;

    process.stdout.write(
      "No permission for appsync:ListDataSources. Falling back to deterministic table names.\n"
    );
    process.stdout.write(
      `Using suffix '${ctx.tableSuffix}'. Override with --table-suffix if needed.\n`
    );
    return deterministicTableMap(ctx);
  }

  const map: Partial<Record<(typeof MODEL_NAMES)[number], string>> = {};

  const dynSources = sources.filter((source) => source.type === "AMAZON_DYNAMODB");

  for (const modelName of MODEL_NAMES) {
    const exact = dynSources.find((source) => source.name === modelName);
    if (exact) {
      const table = getTableName(exact);
      if (table) {
        map[modelName] = table;
        continue;
      }
    }

    const fallback = dynSources.find((source) => {
      const sourceName = String(source.name ?? "");
      return sourceName.includes(modelName);
    });

    if (fallback) {
      const table = getTableName(fallback);
      if (table) {
        map[modelName] = table;
      }
    }
  }

  const missing = MODEL_NAMES.filter((modelName) => !map[modelName]);
  if (missing.length > 0) {
    process.stdout.write(
      `Could not resolve via data sources for: ${missing.join(", ")}. Using deterministic fallback for missing models.\n`
    );
    const fallback = deterministicTableMap(ctx);
    for (const modelName of missing) {
      map[modelName] = fallback[modelName];
    }
  }

  return map as Record<(typeof MODEL_NAMES)[number], string>;
}

async function scanAllItems(ctx: CliContext, tableName: string) {
  const items: DynItem[] = [];
  let startKey: DynItem | undefined;

  do {
    const res = await runAwsJson(ctx, [
      "dynamodb",
      "scan",
      "--table-name",
      tableName,
      ...(startKey ? ["--exclusive-start-key", JSON.stringify(startKey)] : []),
    ]);

    const pageItems = Array.isArray(res.Items) ? (res.Items as DynItem[]) : [];
    items.push(...pageItems);

    startKey =
      res.LastEvaluatedKey && typeof res.LastEvaluatedKey === "object"
        ? (res.LastEvaluatedKey as DynItem)
        : undefined;
  } while (startKey);

  return items;
}

async function describeKeyNames(ctx: CliContext, tableName: string) {
  const res = await runAwsJson(ctx, [
    "dynamodb",
    "describe-table",
    "--table-name",
    tableName,
  ]);

  const schema = Array.isArray((res.Table as { KeySchema?: unknown[] } | undefined)?.KeySchema)
    ? ((res.Table as { KeySchema?: unknown[] }).KeySchema as Array<{ AttributeName?: string }>)
    : [];

  const keyNames = schema
    .map((entry) => entry.AttributeName)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  if (keyNames.length === 0) {
    fail(`No key schema found for table ${tableName}`);
  }

  return keyNames;
}

function pickKey(item: DynItem, keyNames: string[]) {
  const key: DynItem = {};

  for (const name of keyNames) {
    const value = item[name];
    if (!value) {
      fail(`Missing key attribute ${name} in scanned item`);
    }
    key[name] = value;
  }

  return key;
}

async function batchWrite(ctx: CliContext, tableName: string, requests: WriteRequest[]) {
  let pending = requests.slice();
  let attempt = 0;

  while (pending.length > 0) {
    attempt += 1;
    const next: WriteRequest[] = [];

    for (const part of chunk(pending, 25)) {
      const payload = {
        RequestItems: {
          [tableName]: part,
        },
      };

      const res = await runAwsJsonWithFile(
        ctx,
        ["dynamodb", "batch-write-item"],
        "--request-items",
        payload
      );

      const tableUnprocessed = (res.UnprocessedItems as Record<string, WriteRequest[]> | undefined)?.[
        tableName
      ];
      if (Array.isArray(tableUnprocessed) && tableUnprocessed.length > 0) {
        next.push(...tableUnprocessed);
      }
    }

    if (next.length === 0) {
      return;
    }

    if (attempt >= 10) {
      fail(
        `Failed to process all batch write requests for ${tableName}. Unprocessed items: ${next.length}`
      );
    }

    pending = next;
    await sleep(250 * attempt);
  }
}

async function clearTable(ctx: CliContext, tableName: string) {
  const keyNames = await describeKeyNames(ctx, tableName);
  const items = await scanAllItems(ctx, tableName);

  if (items.length === 0) {
    return;
  }

  const deletes: WriteRequest[] = items.map((item) => ({
    DeleteRequest: {
      Key: pickKey(item, keyNames),
    },
  }));

  await batchWrite(ctx, tableName, deletes);
}

async function clearData(
  ctx: CliContext,
  options: {
    keepUserProfiles: boolean;
  }
) {
  const tableMap = await discoverModelTables(ctx);
  const modelsToClear = MODEL_NAMES.filter((modelName) => {
    if (options.keepUserProfiles && modelName === "UserProfile") return false;
    return true;
  });

  for (const modelName of modelsToClear) {
    const tableName = tableMap[modelName];
    process.stdout.write(`Clearing ${modelName} (${tableName})...\n`);
    await clearTable(ctx, tableName);
  }

  const kept = options.keepUserProfiles ? " Kept UserProfile rows." : "";
  process.stdout.write(`Clear complete.${kept}\n`);
}

function itemString(item: DynItem, key: string) {
  const value = item[key];
  return value?.S;
}

function slug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function weekStartUtc(date: Date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const offset = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function csvToList(value: string | undefined) {
  if (!value) return [] as string[];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseBackup(raw: string): BackupFile {
  const data = JSON.parse(raw) as BackupFile;
  if (data.version !== 1) {
    fail("Unsupported backup version");
  }
  if (!data.models || typeof data.models !== "object") {
    fail("Invalid backup file: missing models");
  }
  return data;
}

async function createBackup(ctx: CliContext, outPath: string) {
  const tableMap = await discoverModelTables(ctx);
  const backup: BackupFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    appSyncApiId: ctx.apiId,
    region: ctx.region,
    models: {},
  };

  for (const modelName of MODEL_NAMES) {
    const tableName = tableMap[modelName];
    process.stdout.write(`Backing up ${modelName} (${tableName})...\n`);

    const [keyNames, items] = await Promise.all([
      describeKeyNames(ctx, tableName),
      scanAllItems(ctx, tableName),
    ]);

    backup.models[modelName] = {
      tableName,
      keyNames,
      items,
    };

    process.stdout.write(`  -> ${items.length} item(s)\n`);
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(backup, null, 2), "utf8");

  process.stdout.write(`Backup saved to ${outPath}\n`);
  return outPath;
}

async function restoreBackup(ctx: CliContext, backupPath: string) {
  const backupRaw = await fs.readFile(backupPath, "utf8");
  const backup = parseBackup(backupRaw);

  const currentMap = await discoverModelTables(ctx);

  for (const modelName of RESTORE_ORDER) {
    const modelBackup = backup.models[modelName];
    if (!modelBackup) continue;

    const currentTable = currentMap[modelName];
    process.stdout.write(`Restoring ${modelName} (${currentTable})...\n`);

    await clearTable(ctx, currentTable);

    const puts: WriteRequest[] = modelBackup.items.map((item) => ({
      PutRequest: { Item: item },
    }));

    if (puts.length > 0) {
      await batchWrite(ctx, currentTable, puts);
    }

    process.stdout.write(`  -> restored ${puts.length} item(s)\n`);
  }

  process.stdout.write("Restore complete.\n");
}

async function detectAdmissionTypesFromData(
  ctx: CliContext,
  tableMap: Record<(typeof MODEL_NAMES)[number], string>
) {
  const typeSet = new Set<string>();

  const [examItems, attemptItems] = await Promise.all([
    scanAllItems(ctx, tableMap.MockExam),
    scanAllItems(ctx, tableMap.ExamAttempt),
  ]);

  for (const item of examItems) {
    const value = itemString(item, "admissionType");
    if (value) typeSet.add(value.trim());
  }

  for (const item of attemptItems) {
    const value = itemString(item, "admissionType");
    if (value) typeSet.add(value.trim());
  }

  return Array.from(typeSet).filter(Boolean);
}

async function detectUserSub(
  ctx: CliContext,
  tableMap: Record<(typeof MODEL_NAMES)[number], string>,
  explicitUserSub?: string
) {
  if (explicitUserSub) return explicitUserSub;

  const profileItems = await scanAllItems(ctx, tableMap.UserProfile);
  const subs = profileItems
    .map((item) => itemString(item, "id"))
    .filter((sub): sub is string => typeof sub === "string" && sub.length > 0);

  if (subs.length === 1) {
    process.stdout.write(`Detected single profile id as user-sub: ${subs[0]}\n`);
    return subs[0];
  }

  if (subs.length > 1) {
    process.stdout.write(
      "Multiple user profiles found. Pass --user-sub to control which user gets synthetic personal evolution.\n"
    );
  } else {
    process.stdout.write(
      "No user profile rows found. Cohort data will still be generated, but your personal line may remain empty.\n"
    );
  }

  return undefined;
}

function syntheticTagInAnswers(item: DynItem) {
  const answers = itemString(item, "answersJson") ?? "";
  return answers.includes("\"__synthetic\":true");
}

function buildSyntheticAttempts(params: {
  admissionTypes: string[];
  weeks: number;
  cohortSize: number;
  userSub?: string;
}) {
  const result: DynItem[] = [];
  const today = new Date();

  for (const admissionType of params.admissionTypes) {
    const typeSlug = slug(admissionType) || "general";

    for (let i = 0; i < params.weeks; i += 1) {
      const weeksAgo = params.weeks - 1 - i;
      const bucket = weekStartUtc(new Date(today.getTime() - weeksAgo * 7 * 24 * 60 * 60 * 1000));
      const progress = params.weeks <= 1 ? 1 : i / (params.weeks - 1);
      const cohortBaseline = 46 + progress * 30 + randomBetween(-3, 3);

      for (let j = 0; j < params.cohortSize; j += 1) {
        const submittedAt = new Date(bucket.getTime() + randomBetween(0.5, 6.5) * 24 * 60 * 60 * 1000);
        const durationMinutes = Math.round(randomBetween(75, 120));
        const startedAt = new Date(submittedAt.getTime() - durationMinutes * 60 * 1000);
        const endedAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

        const score = clamp(cohortBaseline + randomBetween(-14, 14), 18, 99.5);

        result.push({
          id: { S: randomUUID() },
          userId: { S: `synthetic-cohort-${typeSlug}-${j}` },
          examId: { S: `synthetic-exam-${typeSlug}-${(i % 5) + 1}` },
          admissionType: { S: admissionType },
          submittedAt: { S: submittedAt.toISOString() },
          score: { N: score.toFixed(2) },
          maxScore: { N: "100" },
          startedAt: { S: startedAt.toISOString() },
          endedAt: { S: endedAt.toISOString() },
          answersJson: {
            S: JSON.stringify({
              __synthetic: true,
              source: "db-seed-script",
              cohort: true,
              admissionType,
              weekIndex: i,
            }),
          },
          createdAt: { S: submittedAt.toISOString() },
          updatedAt: { S: submittedAt.toISOString() },
        });
      }

      if (params.userSub) {
        const submittedAt = new Date(bucket.getTime() + randomBetween(1, 6) * 24 * 60 * 60 * 1000);
        const durationMinutes = Math.round(randomBetween(80, 110));
        const startedAt = new Date(submittedAt.getTime() - durationMinutes * 60 * 1000);
        const endedAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

        const score = clamp(cohortBaseline + 4 + randomBetween(-9, 9), 20, 100);

        result.push({
          id: { S: randomUUID() },
          userId: { S: params.userSub },
          examId: { S: `synthetic-exam-${typeSlug}-${(i % 5) + 1}` },
          admissionType: { S: admissionType },
          submittedAt: { S: submittedAt.toISOString() },
          score: { N: score.toFixed(2) },
          maxScore: { N: "100" },
          startedAt: { S: startedAt.toISOString() },
          endedAt: { S: endedAt.toISOString() },
          answersJson: {
            S: JSON.stringify({
              __synthetic: true,
              source: "db-seed-script",
              cohort: false,
              admissionType,
              weekIndex: i,
            }),
          },
          createdAt: { S: submittedAt.toISOString() },
          updatedAt: { S: submittedAt.toISOString() },
        });
      }
    }
  }

  return result;
}

async function seedSyntheticAttempts(
  ctx: CliContext,
  options: {
    userSub?: string;
    weeks: number;
    cohortSize: number;
    admissionTypes: string[];
  }
) {
  const tableMap = await discoverModelTables(ctx);
  const attemptTable = tableMap.ExamAttempt;

  const userSub = await detectUserSub(ctx, tableMap, options.userSub);

  const admissionTypes =
    options.admissionTypes.length > 0
      ? options.admissionTypes
      : await detectAdmissionTypesFromData(ctx, tableMap);

  const finalAdmissionTypes = admissionTypes.length
    ? admissionTypes
    : ["Computer Engineering", "Mathematics", "Medicine"];

  process.stdout.write(`Using admission types: ${finalAdmissionTypes.join(", ")}\n`);

  const existing = await scanAllItems(ctx, attemptTable);
  const syntheticDeletes: WriteRequest[] = existing
    .filter((item) => syntheticTagInAnswers(item))
    .map((item) => ({
      DeleteRequest: {
        Key: pickKey(item, ["id"]),
      },
    }));

  if (syntheticDeletes.length > 0) {
    process.stdout.write(`Removing ${syntheticDeletes.length} existing synthetic attempt(s)...\n`);
    await batchWrite(ctx, attemptTable, syntheticDeletes);
  }

  const generated = buildSyntheticAttempts({
    admissionTypes: finalAdmissionTypes,
    weeks: options.weeks,
    cohortSize: options.cohortSize,
    userSub,
  });

  const puts: WriteRequest[] = generated.map((item) => ({
    PutRequest: { Item: item },
  }));

  if (puts.length === 0) {
    process.stdout.write("No synthetic attempts generated.\n");
    return;
  }

  process.stdout.write(`Writing ${puts.length} synthetic attempt(s) into ${attemptTable}...\n`);
  await batchWrite(ctx, attemptTable, puts);

  const userCount = generated.filter((item) => itemString(item, "userId") === userSub).length;
  const cohortCount = generated.length - userCount;

  process.stdout.write(
    `Seed complete. Added ${generated.length} attempt(s): ${userCount} for target user, ${cohortCount} cohort.\n`
  );

  if (!userSub) {
    process.stdout.write(
      "Note: no target user-sub was resolved. You may see only cohort data. Pass --user-sub to include personal evolution.\n"
    );
  }
}

function usage() {
  return `
Usage:
  npx tsx scripts/db/synthetic-data.ts backup [--out <path>] [--profile <aws-profile>] [--region <aws-region>] [--api-id <appsync-api-id>] [--table-suffix <suffix>]
  npx tsx scripts/db/synthetic-data.ts seed [--user-sub <sub>] [--weeks <n>] [--cohort-size <n>] [--admission-types <csv>] [--profile <aws-profile>] [--region <aws-region>] [--api-id <appsync-api-id>] [--table-suffix <suffix>]
  npx tsx scripts/db/synthetic-data.ts restore --backup <path> [--profile <aws-profile>] [--region <aws-region>] [--api-id <appsync-api-id>] [--table-suffix <suffix>]
  npx tsx scripts/db/synthetic-data.ts clear [--keep-user-profiles] [--profile <aws-profile>] [--region <aws-region>] [--api-id <appsync-api-id>] [--table-suffix <suffix>]
  npx tsx scripts/db/synthetic-data.ts demo [--out <path>] [--user-sub <sub>] [--weeks <n>] [--cohort-size <n>] [--admission-types <csv>] [--profile <aws-profile>] [--region <aws-region>] [--api-id <appsync-api-id>] [--table-suffix <suffix>]

Notes:
  - "demo" does: backup -> seed synthetic attempts.
  - "clear" wipes model tables in DynamoDB (Cognito accounts are not touched).
  - "restore" resets all known model tables to the exact backup snapshot.
  - Region defaults to amplify_outputs.json data.aws_region.
  - API id defaults to parsed value from amplify_outputs.json data.url.
  - Table suffix defaults to "NONE" (table format: <Model>-<ApiId>-<Suffix>).
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(usage());
    return;
  }

  const args = argv.slice(1);
  const profile = getArg(args, "--profile");
  const region = getArg(args, "--region") ?? String(outputs.data?.aws_region ?? "");
  const explicitApiId = getArg(args, "--api-id");
  const tableSuffix = getArg(args, "--table-suffix") ?? "NONE";
  const apiId = explicitApiId ?? parseApiIdFromUrl(String(outputs.data?.url ?? ""));

  if (!region) fail("Could not resolve AWS region. Pass --region.");
  if (!apiId) fail("Could not resolve AppSync API id from amplify_outputs.json.");

  const ctx: CliContext = {
    command,
    profile,
    region,
    apiId,
    tableSuffix,
    args,
  };

  process.stdout.write(`Region: ${ctx.region}, ApiId: ${ctx.apiId}, Table suffix: ${ctx.tableSuffix}\n`);

  if (command === "backup") {
    const out =
      getArg(args, "--out") ??
      path.join(process.cwd(), ".tmp", "db-backups", `db-backup-${nowStamp()}.json`);
    await createBackup(ctx, out);
    return;
  }

  if (command === "seed") {
    const userSub = getArg(args, "--user-sub");
    const weeks = toPositiveInt(getArg(args, "--weeks"), 14);
    const cohortSize = toPositiveInt(getArg(args, "--cohort-size"), 28);
    const admissionTypes = csvToList(getArg(args, "--admission-types"));

    await seedSyntheticAttempts(ctx, {
      userSub,
      weeks,
      cohortSize,
      admissionTypes,
    });
    return;
  }

  if (command === "restore") {
    const backupPath = getArg(args, "--backup");
    if (!backupPath) {
      fail("restore requires --backup <path>");
    }

    await restoreBackup(ctx, path.resolve(backupPath));
    return;
  }

  if (command === "clear") {
    const keepUserProfiles = hasFlag(args, "--keep-user-profiles");
    await clearData(ctx, { keepUserProfiles });
    return;
  }

  if (command === "demo") {
    const out =
      getArg(args, "--out") ??
      path.join(process.cwd(), ".tmp", "db-backups", `db-backup-${nowStamp()}.json`);

    const userSub = getArg(args, "--user-sub");
    const weeks = toPositiveInt(getArg(args, "--weeks"), 14);
    const cohortSize = toPositiveInt(getArg(args, "--cohort-size"), 28);
    const admissionTypes = csvToList(getArg(args, "--admission-types"));

    const backupPath = await createBackup(ctx, out);

    await seedSyntheticAttempts(ctx, {
      userSub,
      weeks,
      cohortSize,
      admissionTypes,
    });

    process.stdout.write("\nSynthetic dataset active.\n");
    process.stdout.write(`Restore with:\n`);
    process.stdout.write(`  npx tsx scripts/db/synthetic-data.ts restore --backup ${backupPath}\n`);
    if (ctx.profile) {
      process.stdout.write(`  (with profile) --profile ${ctx.profile}\n`);
    }
    return;
  }

  fail(`Unknown command: ${command}\n${usage()}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});

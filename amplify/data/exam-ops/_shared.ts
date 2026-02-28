type IdentityEvent = {
  identity?: unknown | null;
};

type TaskKeyQueryResult = {
  data?: Array<{ correctAnswer?: string | null } | null> | null;
  errors?: unknown[];
};

type TaskKeyListModel = {
  list: (args: { filter: { taskId: { eq: string } }; limit: number }) => Promise<TaskKeyQueryResult>;
  [key: string]: unknown;
};

type IdentityRecord = Record<string, unknown> & { claims?: Record<string, unknown> };

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function getIdentityRecord(event: IdentityEvent): IdentityRecord | undefined {
  const { identity } = event;
  if (!identity || typeof identity !== "object") return undefined;
  return identity as IdentityRecord;
}

function getClaim(identity: IdentityRecord | undefined, key: string): unknown {
  const claims = identity?.claims;
  if (!claims || typeof claims !== "object") return undefined;
  return claims[key];
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

export function getIdentitySub(event: IdentityEvent): string {
  const identity = getIdentityRecord(event);
  const sub =
    asString(identity?.sub) ??
    asString(getClaim(identity, "sub")) ??
    asString(identity?.username) ??
    asString(identity?.userId) ??
    asString(getClaim(identity, "cognito:username"));

  if (!sub) throw new Error("UNAUTHENTICATED");
  return sub;
}

export function isAdminEvent(event: IdentityEvent) {
  const identity = getIdentityRecord(event);
  const groups = identity?.groups ?? getClaim(identity, "cognito:groups");
  return asStringArray(groups).includes("Admin");
}

export function normalizeAnswer(value: unknown) {
  return String(value ?? "").trim();
}

export async function getCorrectAnswerForTask(taskKeyModel: TaskKeyListModel, taskId: string) {
  const candidateFns = ["listTaskKeysByTaskId", "taskKeysByTaskId", "listByTaskId"];

  for (const fnName of candidateFns) {
    const candidate = taskKeyModel[fnName];
    if (typeof candidate !== "function") continue;

    const res = await (
      candidate as (args: { taskId: string; limit: number }) => Promise<TaskKeyQueryResult>
    )({ taskId, limit: 1 });

    const item = (res.data ?? [])[0];
    return normalizeAnswer(item?.correctAnswer);
  }

  const res = await taskKeyModel.list({
    filter: { taskId: { eq: taskId } },
    limit: 500,
  });

  if (res.errors?.length) {
    console.error("TaskKey.list errors:", res.errors);
  }

  const item = (res.data ?? []).find(Boolean);
  return normalizeAnswer(item?.correctAnswer);
}

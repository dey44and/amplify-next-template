import type { Schema } from "../resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { normalizeOptionsCount, normalizeTopic } from "./_adaptive";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

export const handler: Schema["listArchiveProblems"]["functionHandler"] = async () => {
  const [tasksRes, examsRes] = await Promise.all([
    client.models.Task.list({ limit: 2000 }),
    client.models.MockExam.list({ limit: 500 }),
  ]);

  if (tasksRes.errors?.length) {
    console.error("Task.list errors:", tasksRes.errors);
  }
  if (examsRes.errors?.length) {
    console.error("MockExam.list errors:", examsRes.errors);
  }

  const examsById = new Map<string, string>();
  for (const exam of examsRes.data ?? []) {
    if (!exam?.id) continue;
    examsById.set(exam.id, String(exam.title ?? "Simulare"));
  }

  const items: Schema["ArchiveProblem"]["type"][] = [];
  for (const task of tasksRes.data ?? []) {
    if (!task?.id) continue;

    const examId = task.examId ?? null;
    if (examId && !examsById.has(examId)) {
      // Skip orphan tasks left from deleted exams.
      continue;
    }
    items.push({
      taskId: task.id,
      examId,
      examTitle: examId ? examsById.get(examId) ?? "Simulare" : "Simulare",
      order: task.order ?? null,
      question: task.question ?? "",
      mark: task.mark ?? null,
      topic: normalizeTopic(task.topic),
      optionsCount: normalizeOptionsCount(task.optionsCount),
    });
  }

  items.sort((a, b) => {
    const topicCmp = String(a.topic ?? "").localeCompare(String(b.topic ?? ""), "ro");
    if (topicCmp !== 0) return topicCmp;

    const examCmp = String(a.examTitle ?? "").localeCompare(String(b.examTitle ?? ""), "ro");
    if (examCmp !== 0) return examCmp;

    return Number(a.order ?? 0) - Number(b.order ?? 0);
  });

  return items;
};

import { toTimestamp } from "@/lib/dateTime";

export type ExamWindowLike = {
  startAt?: string | null;
  durationMinutes?: number | null;
};

export type ExamState = "unknown" | "before" | "during" | "after";

export function getExamWindow(exam: ExamWindowLike) {
  const startMs = exam.startAt ? toTimestamp(exam.startAt) : Number.NaN;
  const duration = Number(exam.durationMinutes ?? 0);
  const endMs =
    Number.isFinite(startMs) && Number.isFinite(duration)
      ? startMs + duration * 60_000
      : Number.NaN;
  return { startMs, endMs };
}

export function getExamState(exam: ExamWindowLike, nowMs: number): ExamState {
  const { startMs, endMs } = getExamWindow(exam);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "unknown";
  if (nowMs < startMs) return "before";
  if (nowMs < endMs) return "during";
  return "after";
}

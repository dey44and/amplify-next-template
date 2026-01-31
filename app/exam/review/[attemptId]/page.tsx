"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, signOut } from "aws-amplify/auth";

const client = generateClient<Schema>();

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ExamReviewPage() {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  const attemptId = useMemo(() => params.attemptId, [params.attemptId]);

  const [loginId, setLoginId] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [review, setReview] = useState<any>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);

      // Auth gate
      let user;
      try {
        user = await getCurrentUser();
      } catch {
        router.replace("/login");
        return;
      }
      setLoginId(user.signInDetails?.loginId ?? user.username ?? "");

      // Fetch review via secured query
      const res = await client.queries.getExamReview({ attemptId });

      if (res.errors?.length) {
        console.error(res.errors);
        setErr(res.errors[0]?.message ?? "Failed to load review.");
        setReview(null);
        setLoading(false);
        return;
      }

      setReview(res.data ?? null);
      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setErr("Failed to load review.");
      setLoading(false);
    });
  }, [attemptId, router]);

  const score = Number(review?.score ?? 0);
  const maxScore = Number(review?.maxScore ?? 0);
  const submittedAt = (review?.submittedAt as string | null | undefined) ?? null;

  const items: any[] = Array.isArray(review?.items) ? review.items : [];

  const correctCount = items.filter((x) => !!x?.isCorrect).length;

  return (
    <>
      <SiteHeader
        rightSlot={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="small" style={{ opacity: 0.75 }}>
              {loginId}
            </span>
            <OutlineButton
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </OutlineButton>
          </div>
        }
      />

      <PageShell>
        {loading ? (
          <p className="small">Loading review…</p>
        ) : err ? (
          <Card>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
              Could not load review
            </div>
            <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
              {err}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <OutlineButton onClick={() => router.push("/dashboard")}>
                Back to dashboard
              </OutlineButton>
            </div>
          </Card>
        ) : !review ? (
          <p className="small">No review data.</p>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.7 }}>
                Exam review
              </div>
              <div className="small" style={{ opacity: 0.8 }}>
                Submitted: {formatWhen(submittedAt)}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Back to dashboard
                </OutlineButton>
              </div>
            </div>

            {/* Summary */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
                    Result
                  </div>
                  <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                    Correct: {correctCount} / {items.length}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div className="small" style={{ opacity: 0.75 }}>
                    Score
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 900 }}>
                    {score} / {maxScore}
                  </div>
                </div>
              </div>
            </Card>

            {/* Breakdown */}
            <Card>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -0.3 }}>
                Answer breakdown
              </div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {items.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    No items to show.
                  </p>
                ) : (
                  items
                    .slice()
                    .sort((a, b) => (Number(a?.order ?? 0) - Number(b?.order ?? 0)))
                    .map((it) => {
                      const order = it?.order ?? "—";
                      const mark = Number(it?.mark ?? 0);
                      const earned = Number(it?.earned ?? 0);
                      const isCorrect = !!it?.isCorrect;

                      const question = String(it?.question ?? "");
                      const userAnswer = String(it?.userAnswer ?? "");
                      const correctAnswer = String(it?.correctAnswer ?? "");

                      return (
                        <div
                          key={String(it?.taskId ?? `${order}`)}
                          style={{
                            borderTop: "1px solid var(--border)",
                            paddingTop: 12,
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 900 }}>
                              #{order} • {mark} points
                            </div>
                            <div className="small" style={{ opacity: 0.85 }}>
                              {isCorrect ? "✅ Correct" : "❌ Incorrect"} • Earned: {earned}
                            </div>
                          </div>

                          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                            {question}
                          </div>

                          <div className="small" style={{ display: "grid", gap: 4 }}>
                            <div>
                              <span style={{ fontWeight: 800 }}>Your answer:</span>{" "}
                              <span style={{ opacity: 0.85 }}>{userAnswer || "—"}</span>
                            </div>
                            <div>
                              <span style={{ fontWeight: 800 }}>Correct answer:</span>{" "}
                              <span style={{ opacity: 0.85 }}>{correctAnswer || "—"}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </Card>

            <div className="small" style={{ opacity: 0.75 }}>
              Tip: The result is computed server-side at submission time.
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}

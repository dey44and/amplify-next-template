"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { HeaderUserActions } from "@/components/HeaderUserActions";
import { MathText } from "@/components/MathText";
import { SiteHeader } from "@/components/SiteHeader";
import { PageShell } from "@/components/PageShell";
import { Card, OutlineButton } from "@/components/ui";
import { formatWhen } from "@/lib/dateTime";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();
type ExamReview = Schema["ExamReview"]["type"];
type ReviewItem = Schema["ReviewItem"]["type"];

export default function ExamReviewPage() {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  const attemptId = useMemo(() => params.attemptId, [params.attemptId]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [review, setReview] = useState<ExamReview | null>(null);

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

      // Fetch review via secured query
      const res = await client.queries.getExamReview({ attemptId });

      if (res.errors?.length) {
        console.error(res.errors);
        setErr(res.errors[0]?.message ?? "Încărcarea evaluării a eșuat.");
        setReview(null);
        setLoading(false);
        return;
      }

      setReview(res.data ?? null);
      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setErr("Încărcarea evaluării a eșuat.");
      setLoading(false);
    });
  }, [attemptId, router]);

  const score = Number(review?.score ?? 0);
  const maxScore = Number(review?.maxScore ?? 0);
  const submittedAt = review?.submittedAt ?? null;

  const items: ReviewItem[] = Array.isArray(review?.items)
    ? review.items.filter((item): item is ReviewItem => !!item)
    : [];

  const correctCount = items.filter((x) => !!x?.isCorrect).length;

  return (
    <>
      <SiteHeader rightSlot={<HeaderUserActions />} />

      <PageShell>
        {loading ? (
          <p className="small">Se încarcă evaluarea…</p>
        ) : err ? (
          <Card>
            <div className="section-title">Evaluarea nu a putut fi încărcată</div>
            <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
              {err}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <OutlineButton onClick={() => router.push("/dashboard")}>
                Înapoi la panou
              </OutlineButton>
            </div>
          </Card>
        ) : !review ? (
          <p className="small">Nu există date de evaluare.</p>
        ) : (
          <div className="panel-stack">
            {/* Header */}
            <div className="panel-top-row">
              <div className="page-title">Evaluare examen</div>
              <div className="small" style={{ opacity: 0.8 }}>
                Trimis: {formatWhen(submittedAt)}
              </div>

              <div className="panel-actions">
                <OutlineButton onClick={() => router.push("/dashboard")}>
                  Înapoi la panou
                </OutlineButton>
              </div>
            </div>

            {/* Summary */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div className="section-title">Rezultat</div>
                  <div className="small" style={{ marginTop: 6, opacity: 0.85 }}>
                    Corecte: {correctCount} / {items.length}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div className="small" style={{ opacity: 0.75 }}>
                    Scor
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 760 }}>
                    {score} / {maxScore}
                  </div>
                </div>
              </div>
            </Card>

            {/* Breakdown */}
            <Card>
              <div className="section-title">Detaliere răspunsuri</div>

              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {items.length === 0 ? (
                  <p className="small" style={{ margin: 0 }}>
                    Nu există elemente de afișat.
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
                            <div style={{ fontWeight: 760 }}>
                              #{order} • {mark} puncte
                            </div>
                            <div className="small" style={{ opacity: 0.85 }}>
                              {isCorrect ? "✅ Corect" : "❌ Greșit"} • Obținut: {earned}
                            </div>
                          </div>

                          <MathText text={question} />

                          <div className="small" style={{ display: "grid", gap: 4 }}>
                            <div>
                              <span style={{ fontWeight: 700 }}>Răspunsul tău:</span>{" "}
                              <MathText
                                inline
                                text={userAnswer || "—"}
                                style={{ opacity: 0.85 }}
                              />
                            </div>
                            <div>
                              <span style={{ fontWeight: 700 }}>Răspuns corect:</span>{" "}
                              <MathText
                                inline
                                text={correctAnswer || "—"}
                                style={{ opacity: 0.85 }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </Card>

            <div className="small" style={{ opacity: 0.75 }}>
              Sfat: rezultatul este calculat pe server la momentul trimiterii.
            </div>
          </div>
        )}
      </PageShell>
    </>
  );
}

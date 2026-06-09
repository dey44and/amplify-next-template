import type { Schema } from "../resource";

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { getIdentitySub, isAdminEvent } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const ses = new SESClient({ region: process.env.SES_REGION ?? process.env.AWS_REGION });

function actorSub(event: Parameters<Schema["publishBacEvaluation"]["functionHandler"]>[0]) {
  try {
    return getIdentitySub(event);
  } catch {
    return "admin";
  }
}

function cleanOptional(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function formatWhenRo(iso?: string | null) {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;

  return dt.toLocaleString("ro-RO", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateError(error: unknown) {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return message.slice(0, 900);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendEvaluationEmail(args: {
  to: string;
  simulationId: string;
  title: string;
  subject?: string | null;
  manualGrade: number;
  maxGrade: number;
  gradedAt: string;
  hasFile: boolean;
}) {
  const from = process.env.SES_FROM_EMAIL ?? "noreply@mockexams.ro";
  const appBaseUrl = (process.env.APP_BASE_URL ?? "https://mockexams.ro").replace(/\/+$/, "");
  const url = `${appBaseUrl}/bac/${args.simulationId}`;
  const replyTo = process.env.SES_REPLY_TO_EMAIL?.trim();
  const safeTitle = escapeHtml(args.title);
  const safeSubject = escapeHtml(args.subject ?? "-");
  const safeGrade = escapeHtml(`${args.manualGrade} / ${args.maxGrade}`);
  const safeGradedAt = escapeHtml(formatWhenRo(args.gradedAt));
  const safeUrl = escapeHtml(url);

  const subject = `Evaluarea pentru simularea de bacalaureat este disponibilă - ${args.title}`;
  const textBody = [
    "Mock Exams",
    "",
    "Salut,",
    "",
    "Evaluarea pentru simularea de bacalaureat este disponibilă în platformă.",
    "",
    `Titlu: ${args.title}`,
    `Materie: ${args.subject ?? "-"}`,
    `Punctaj: ${args.manualGrade} / ${args.maxGrade}`,
    `Evaluat la: ${formatWhenRo(args.gradedAt)}`,
    args.hasFile ? "Document evaluator: disponibil în platformă" : null,
    `Link: ${url}`,
    "",
    "Intră în platformă pentru a vedea observațiile evaluatorului.",
    "",
    "Echipa Mock Exams",
    "",
    "© Mock Exams 2026",
  ]
    .filter(Boolean)
    .join("\n");

  const htmlBody = `
    <div style="margin:0;padding:0;background:#f5f7fb;">
      <div style="max-width:640px;margin:0 auto;padding:32px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#17202a;line-height:1.55;">
        <div style="background:#ffffff;border:1px solid #e5e9f2;border-radius:18px;overflow:hidden;">
          <div style="padding:28px 30px 18px;text-align:center;border-bottom:1px solid #eef1f6;">
            <div style="font-size:28px;font-weight:800;letter-spacing:-0.4px;color:#13233a;">Mock Exams</div>
            <div style="margin-top:6px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#5b6b82;">Evaluare disponibilă</div>
          </div>

          <div style="padding:28px 30px 8px;">
            <p style="margin:0 0 16px;font-size:16px;">Salut,</p>
            <p style="margin:0 0 22px;font-size:16px;">
              Evaluarea pentru simularea de bacalaureat este disponibilă în platformă.
            </p>

            <div style="margin:0 0 24px;border:1px solid #e7ebf3;border-radius:14px;overflow:hidden;">
              <div style="padding:13px 16px;background:#f8fafc;font-size:13px;font-weight:800;color:#334155;">Detalii evaluare</div>
              <div style="padding:14px 16px;">
                <div style="margin-bottom:10px;font-size:15px;"><strong>Titlu:</strong> ${safeTitle}</div>
                <div style="margin-bottom:10px;font-size:15px;"><strong>Materie:</strong> ${safeSubject}</div>
                <div style="margin-bottom:10px;font-size:15px;"><strong>Punctaj:</strong> ${safeGrade}</div>
                <div style="font-size:15px;"><strong>Evaluat la:</strong> ${safeGradedAt}</div>
                ${
                  args.hasFile
                    ? `<div style="margin-top:10px;font-size:15px;"><strong>Document evaluator:</strong> disponibil în platformă</div>`
                    : ""
                }
              </div>
            </div>

            <div style="text-align:center;margin:26px 0 24px;">
              <a href="${safeUrl}" style="display:inline-block;background:#13233a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:12px 18px;border-radius:12px;">
                Vezi evaluarea
              </a>
            </div>
          </div>

          <div style="padding:22px 30px 26px;text-align:center;border-top:1px solid #eef1f6;">
            <div style="font-size:16px;font-weight:800;color:#13233a;">Mock Exams</div>
            <div style="margin-top:8px;font-size:12px;color:#7a8798;">&copy; Mock Exams 2026</div>
          </div>
        </div>
      </div>
    </div>
  `;

  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: {
        ToAddresses: [args.to],
      },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
      Message: {
        Subject: {
          Charset: "UTF-8",
          Data: subject,
        },
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: textBody,
          },
          Html: {
            Charset: "UTF-8",
            Data: htmlBody,
          },
        },
      },
    })
  );
}

export const handler: Schema["publishBacEvaluation"]["functionHandler"] = async (event) => {
  if (!isAdminEvent(event)) throw new Error("FORBIDDEN");

  const {
    submissionOwner,
    simulationId,
    manualGrade,
    maxGrade,
    evaluationNotes,
    evaluationFilePath,
    evaluationOriginalName,
    evaluationContentType,
    evaluationSizeBytes,
  } = event.arguments;

  const grade = Number(manualGrade);
  const max = Number(maxGrade);
  if (!submissionOwner || !simulationId) throw new Error("BAC_SUBMISSION_REQUIRED");
  if (!Number.isFinite(grade) || grade < 0) throw new Error("BAC_INVALID_GRADE");
  if (!Number.isFinite(max) || max <= 0) throw new Error("BAC_INVALID_MAX_GRADE");
  if (grade > max) throw new Error("BAC_GRADE_OVER_MAX");

  const [simulationRes, submissionRes, existingEvaluationRes, requestRes] = await Promise.all([
    client.models.BacSimulation.get({ id: simulationId }),
    client.models.BacSubmission.get({ owner: submissionOwner, simulationId }),
    client.models.BacEvaluation.get({ submissionOwner, simulationId }),
    client.models.BacRequest.get({ owner: submissionOwner, simulationId }),
  ]);

  const simulation = simulationRes.data;
  if (!simulation) throw new Error("BAC_SIMULATION_NOT_FOUND");

  const submission = submissionRes.data;
  if (!submission) throw new Error("BAC_SUBMISSION_NOT_FOUND");

  const existing = existingEvaluationRes.data;
  const nowIso = new Date().toISOString();
  const cleanNotes = cleanOptional(evaluationNotes, 12000);

  const nextFilePath = cleanOptional(evaluationFilePath, 1024) ?? existing?.evaluationFilePath ?? null;
  const nextOriginalName =
    cleanOptional(evaluationOriginalName, 240) ?? existing?.evaluationOriginalName ?? null;
  const nextContentType =
    cleanOptional(evaluationContentType, 120) ?? existing?.evaluationContentType ?? null;
  const nextSizeBytes =
    evaluationSizeBytes != null && Number.isFinite(Number(evaluationSizeBytes))
      ? Math.max(0, Math.floor(Number(evaluationSizeBytes)))
      : existing?.evaluationSizeBytes ?? null;

  let emailSentAt = existing?.notificationEmailSentAt ?? null;
  let emailError: string | null = null;
  const shouldNotify = !emailSentAt;
  const requesterEmail = requestRes.data?.requesterEmail;

  if (shouldNotify) {
    if (requesterEmail) {
      try {
        await sendEvaluationEmail({
          to: requesterEmail,
          simulationId,
          title: simulation.title,
          subject: simulation.subject,
          manualGrade: grade,
          maxGrade: max,
          gradedAt: nowIso,
          hasFile: Boolean(nextFilePath),
        });
        emailSentAt = new Date().toISOString();
      } catch (error) {
        emailError = truncateError(error);
        console.error("Bac evaluation email failed:", error);
      }
    } else {
      emailError = "Student email is missing.";
    }
  } else {
    emailError = existing?.notificationEmailError ?? null;
  }

  const payload = {
    submissionOwner,
    simulationId,
    status: "GRADED" as const,
    manualGrade: grade,
    maxGrade: max,
    evaluationNotes: cleanNotes,
    evaluationFilePath: nextFilePath,
    evaluationOriginalName: nextOriginalName,
    evaluationContentType: nextContentType,
    evaluationSizeBytes: nextSizeBytes,
    gradedBy: actorSub(event),
    gradedAt: nowIso,
    updatedAt: nowIso,
    notificationEmailSentAt: emailSentAt,
    notificationEmailError: emailError,
  };

  const result = existing
    ? await client.models.BacEvaluation.update(payload)
    : await client.models.BacEvaluation.create(payload);

  if (result.errors?.length) {
    console.error("BacEvaluation save errors:", result.errors);
    throw new Error("BAC_EVALUATION_SAVE_FAILED");
  }

  if (!result.data) throw new Error("BAC_EVALUATION_SAVE_FAILED");
  return result.data;
};

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

function actorSub(event: Parameters<Schema["decideBacRequest"]["functionHandler"]>[0]) {
  try {
    return getIdentitySub(event);
  } catch {
    return "admin";
  }
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

function getPositiveMinutes(value: unknown, fallback?: unknown) {
  const minutes = Number(value ?? fallback ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function addMinutesIso(iso: string | null | undefined, minutes: number | null) {
  if (!iso || !minutes) return null;
  const startMs = new Date(iso).getTime();
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs + minutes * 60_000).toISOString();
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

async function sendApprovalEmail(args: {
  to: string;
  simulationId: string;
  title: string;
  subject?: string | null;
  startAt?: string | null;
  durationMinutes?: number | null;
  accessWindowMinutes?: number | null;
  note?: string | null;
}) {
  const from = process.env.SES_FROM_EMAIL ?? "noreply@mockexams.ro";
  const appBaseUrl = (process.env.APP_BASE_URL ?? "https://mockexams.ro").replace(/\/+$/, "");
  const url = `${appBaseUrl}/bac/${args.simulationId}`;
  const replyTo = process.env.SES_REPLY_TO_EMAIL?.trim();
  const safeTitle = escapeHtml(args.title);
  const safeSubject = escapeHtml(args.subject ?? "-");
  const safeStart = escapeHtml(formatWhenRo(args.startAt));
  const solveDurationMinutes = getPositiveMinutes(args.durationMinutes);
  const accessWindowMinutes = getPositiveMinutes(args.accessWindowMinutes, args.durationMinutes);
  const windowEndAt = addMinutesIso(args.startAt, accessWindowMinutes);
  const safeWindowEnd = escapeHtml(formatWhenRo(windowEndAt));
  const safeSolveDuration = escapeHtml(solveDurationMinutes ?? "-");
  const safeAccessWindow = escapeHtml(accessWindowMinutes ?? "-");
  const safeNote = args.note ? escapeHtml(args.note) : "";
  const safeUrl = escapeHtml(url);

  const subject = `Confirmare participare la simularea de bacalaureat - ${args.title}`;
  const details = [
    `Titlu: ${args.title}`,
    `Materie: ${args.subject ?? "-"}`,
    `Începe: ${formatWhenRo(args.startAt)}`,
    `Poți începe până la: ${formatWhenRo(windowEndAt)}`,
    `Fereastră de începere: ${accessWindowMinutes ?? "-"} minute`,
    `Timp de lucru după începere: ${solveDurationMinutes ?? "-"} minute`,
    args.note ? `Notă administrator: ${args.note}` : null,
    `Link: ${url}`,
  ].filter(Boolean);

  const textBody = [
    "Mock Exams",
    "",
    "Salut,",
    "",
    "Cererea ta de participare la simularea de bacalaureat a fost aprobată.",
    "",
    ...details,
    "",
    "Subiectul va fi disponibil în platformă conform programării.",
    "",
    "Echipa Mock Exams",
    "",
    "© Mock Exams 2026",
  ].join("\n");

  const htmlBody = `
    <div style="margin:0;padding:0;background:#f5f7fb;">
      <div style="max-width:640px;margin:0 auto;padding:32px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#17202a;line-height:1.55;">
        <div style="background:#ffffff;border:1px solid #e5e9f2;border-radius:18px;overflow:hidden;">
          <div style="padding:28px 30px 18px;text-align:center;border-bottom:1px solid #eef1f6;">
            <div style="font-size:28px;font-weight:800;letter-spacing:-0.4px;color:#13233a;">Mock Exams</div>
            <div style="margin-top:6px;font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#5b6b82;">Confirmare participare</div>
          </div>

          <div style="padding:28px 30px 8px;">
            <p style="margin:0 0 16px;font-size:16px;">Salut,</p>
            <p style="margin:0 0 22px;font-size:16px;">
              Cererea ta de participare la simularea de bacalaureat a fost aprobată.
            </p>

            <div style="margin:0 0 24px;border:1px solid #e7ebf3;border-radius:14px;overflow:hidden;">
              <div style="padding:13px 16px;background:#f8fafc;font-size:13px;font-weight:800;color:#334155;">Detalii simulare</div>
	              <div style="padding:14px 16px;">
	                <div style="margin-bottom:10px;font-size:15px;"><strong>Titlu:</strong> ${safeTitle}</div>
	                <div style="margin-bottom:10px;font-size:15px;"><strong>Materie:</strong> ${safeSubject}</div>
	                <div style="margin-bottom:10px;font-size:15px;"><strong>Începe:</strong> ${safeStart}</div>
	                <div style="margin-bottom:10px;font-size:15px;"><strong>Poți începe până la:</strong> ${safeWindowEnd}</div>
	                <div style="margin-bottom:10px;font-size:15px;"><strong>Fereastră de începere:</strong> ${safeAccessWindow} minute</div>
	                <div style="font-size:15px;"><strong>Timp de lucru:</strong> ${safeSolveDuration} minute din momentul începerii</div>
	                ${safeNote ? `<div style="margin-top:10px;font-size:15px;"><strong>Notă administrator:</strong> ${safeNote}</div>` : ""}
	              </div>
            </div>

            <div style="text-align:center;margin:26px 0 24px;">
              <a href="${safeUrl}" style="display:inline-block;background:#13233a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:12px 18px;border-radius:12px;">
                Deschide simularea de bacalaureat
              </a>
            </div>

            <p style="margin:0 0 22px;font-size:14px;color:#526173;">
	              Subiectul va fi disponibil după ce începi simularea în platformă. Cronometrul personal pornește atunci.
	            </p>
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

export const handler: Schema["decideBacRequest"]["functionHandler"] = async (event) => {
  if (!isAdminEvent(event)) throw new Error("FORBIDDEN");

  const { owner, simulationId, status, note } = event.arguments;
  if (status !== "APPROVED" && status !== "REJECTED") {
    throw new Error("INVALID_STATUS");
  }

  const now = new Date().toISOString();
  const decidedBy = actorSub(event);
  const cleanNote = String(note ?? "").trim() || null;

  const requestRes = await client.models.BacRequest.get({ owner, simulationId });
  const request = requestRes.data;
  if (!request) throw new Error("REQUEST_NOT_FOUND");

  const simulationRes = await client.models.BacSimulation.get({ id: simulationId });
  const simulation = simulationRes.data;
  if (!simulation) throw new Error("BAC_SIMULATION_NOT_FOUND");

  let emailSentAt: string | null = null;
  let emailError: string | null = null;

  if (status === "APPROVED") {
    const existingAccess = await client.models.BacAccess.get({ owner, simulationId });
    if (!existingAccess.data) {
      await client.models.BacAccess.create({
        owner,
        simulationId,
        grantedAt: now,
        grantedBy: decidedBy,
        note: cleanNote,
      });
    }

    if (request.requesterEmail) {
      try {
        await sendApprovalEmail({
          to: request.requesterEmail,
          simulationId,
          title: simulation.title,
          subject: simulation.subject,
          startAt: simulation.startAt,
          durationMinutes: simulation.durationMinutes,
          accessWindowMinutes: simulation.accessWindowMinutes,
          note: cleanNote,
        });
        emailSentAt = new Date().toISOString();
      } catch (error) {
        emailError = truncateError(error);
        console.error("Bac approval email failed:", error);
      }
    } else {
      emailError = "Requester email is missing.";
    }
  }

  const updateRes = await client.models.BacRequest.update({
    owner,
    simulationId,
    status,
    decidedAt: now,
    decidedBy,
    note: cleanNote,
    confirmationEmailSentAt: emailSentAt,
    confirmationEmailError: emailError,
  });

  if (!updateRes.data) throw new Error("REQUEST_UPDATE_FAILED");
  return updateRes.data;
};

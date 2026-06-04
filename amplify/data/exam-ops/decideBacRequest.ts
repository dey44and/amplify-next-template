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
  note?: string | null;
}) {
  const from = process.env.SES_FROM_EMAIL ?? "noreply@mockexams.ro";
  const appBaseUrl = (process.env.APP_BASE_URL ?? "https://mockexams.ro").replace(/\/+$/, "");
  const url = `${appBaseUrl}/bac/${args.simulationId}`;
  const replyTo = process.env.SES_REPLY_TO_EMAIL?.trim();
  const safeTitle = escapeHtml(args.title);
  const safeSubject = escapeHtml(args.subject ?? "-");
  const safeStart = escapeHtml(formatWhenRo(args.startAt));
  const safeDuration = escapeHtml(args.durationMinutes ?? "-");
  const safeNote = args.note ? escapeHtml(args.note) : "";
  const safeUrl = escapeHtml(url);

  const subject = `Confirmare participare Bac - ${args.title}`;
  const details = [
    `Titlu: ${args.title}`,
    `Materie: ${args.subject ?? "-"}`,
    `Începe: ${formatWhenRo(args.startAt)}`,
    `Durată: ${args.durationMinutes ?? "-"} minute`,
    args.note ? `Notă administrator: ${args.note}` : null,
    `Link: ${url}`,
  ].filter(Boolean);

  const textBody = [
    "Salut,",
    "",
    "Cererea ta de participare la simularea Bac a fost aprobată.",
    "",
    ...details,
    "",
    "Subiectul va fi disponibil în platformă conform programării.",
    "",
    "Echipa MockExams",
  ].join("\n");

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #17202a;">
      <p>Salut,</p>
      <p>Cererea ta de participare la simularea Bac a fost aprobată.</p>
      <ul>
        <li><strong>Titlu:</strong> ${safeTitle}</li>
        <li><strong>Materie:</strong> ${safeSubject}</li>
        <li><strong>Începe:</strong> ${safeStart}</li>
        <li><strong>Durată:</strong> ${safeDuration} minute</li>
        ${safeNote ? `<li><strong>Notă administrator:</strong> ${safeNote}</li>` : ""}
      </ul>
      <p><a href="${safeUrl}">Deschide simularea Bac</a></p>
      <p>Subiectul va fi disponibil în platformă conform programării.</p>
      <p>Echipa MockExams</p>
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

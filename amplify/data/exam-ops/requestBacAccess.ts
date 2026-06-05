import type { Schema } from "../resource";

import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { getDataClientEnv } from "./_env";
import { getIdentityEmail, getIdentitySub, getIdentityUsername } from "./_shared";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(getDataClientEnv());
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

const REQUEST_GRACE_MS = 15 * 60_000;

function parseIsoMs(iso?: string | null) {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

function getAttribute(attributes: AttributeType[] | undefined, name: string) {
  return attributes?.find((attribute) => attribute.Name === name)?.Value?.trim() || undefined;
}

function escapeCognitoFilterValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function getUserPoolEmail(args: {
  userPoolId?: string;
  username?: string;
  sub: string;
}) {
  const { userPoolId, username, sub } = args;
  if (!userPoolId) return undefined;

  if (username) {
    try {
      const res = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: username,
        })
      );
      const email = getAttribute(res.UserAttributes, "email");
      if (email) return email;
    } catch (error) {
      console.warn("AdminGetUser email lookup failed:", error);
    }
  }

  try {
    const res = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `sub = "${escapeCognitoFilterValue(sub)}"`,
        Limit: 1,
      })
    );
    return getAttribute(res.Users?.[0]?.Attributes, "email");
  } catch (error) {
    console.warn("ListUsers email lookup failed:", error);
    return undefined;
  }
}

export const handler: Schema["requestBacAccess"]["functionHandler"] = async (event) => {
  const owner = getIdentitySub(event);
  const requesterEmail =
    getIdentityEmail(event) ??
    (await getUserPoolEmail({
      userPoolId: process.env.AUTH_USER_POOL_ID,
      username: getIdentityUsername(event),
      sub: owner,
    }));
  const { simulationId } = event.arguments;

  if (!simulationId) throw new Error("BAC_SIMULATION_REQUIRED");

  const simulationRes = await client.models.BacSimulation.get({ id: simulationId });
  const simulation = simulationRes.data;
  if (!simulation) throw new Error("BAC_SIMULATION_NOT_FOUND");

  const startMs = parseIsoMs(simulation.startAt);
  const durationMinutes = Number(simulation.durationMinutes ?? 0);
  const endMs =
    Number.isFinite(startMs) && Number.isFinite(durationMinutes)
      ? startMs + durationMinutes * 60_000
      : Number.NaN;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || durationMinutes <= 0) {
    throw new Error("BAC_INVALID_WINDOW");
  }
  if (Date.now() > endMs + REQUEST_GRACE_MS) {
    throw new Error("BAC_REQUEST_WINDOW_CLOSED");
  }

  const existingRes = await client.models.BacRequest.get({ owner, simulationId });
  if (existingRes.data) {
    if (requesterEmail && !existingRes.data.requesterEmail) {
      const updateRes = await client.models.BacRequest.update({
        owner,
        simulationId,
        requesterEmail,
      });
      return updateRes.data ?? existingRes.data;
    }
    return existingRes.data;
  }

  if (!requesterEmail) {
    console.warn("Bac request created without requester email.", { owner, simulationId });
  }

  const nowIso = new Date().toISOString();
  const createRes = await client.models.BacRequest.create({
    owner,
    simulationId,
    requesterEmail: requesterEmail ?? null,
    subject: simulation.subject ?? null,
    status: "PENDING",
    requestedAt: nowIso,
  });

  if (createRes.errors?.length) {
    console.error("BacRequest.create errors:", createRes.errors);
  }
  if (!createRes.data) throw new Error("BAC_REQUEST_CREATE_FAILED");

  return createRes.data;
};

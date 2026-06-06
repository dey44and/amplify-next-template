import type { Schema } from "../resource";

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

function getAttribute(attributes: AttributeType[] | undefined, name: string) {
  return attributes?.find((attribute) => attribute.Name === name)?.Value?.trim() || undefined;
}

export const handler: Schema["listAdminUsers"]["functionHandler"] = async () => {
  const userPoolId = process.env.AUTH_USER_POOL_ID;
  if (!userPoolId) throw new Error("ADMIN_USER_POOL_REQUIRED");

  const users: NonNullable<Schema["AdminUserAccount"]["type"]>[] = [];
  let paginationToken: string | undefined;

  do {
    const res = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    for (const user of res.Users ?? []) {
      const owner = getAttribute(user.Attributes, "sub");
      if (!owner) continue;

      users.push({
        owner,
        email: getAttribute(user.Attributes, "email") ?? null,
        username: user.Username ?? null,
        enabled: user.Enabled ?? null,
        status: user.UserStatus ?? null,
        createdAt: user.UserCreateDate?.toISOString() ?? null,
        updatedAt: user.UserLastModifiedDate?.toISOString() ?? null,
      });
    }

    paginationToken = res.PaginationToken;
  } while (paginationToken);

  return users.sort((a, b) => {
    const aCreated = new Date(a.createdAt ?? 0).getTime();
    const bCreated = new Date(b.createdAt ?? 0).getTime();
    return bCreated - aCreated;
  });
};

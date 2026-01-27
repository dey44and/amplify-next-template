import { fetchAuthSession } from "aws-amplify/auth";

export async function isAdmin() {
  const session = await fetchAuthSession();
  const groups =
    (session.tokens?.idToken?.payload?.["cognito:groups"] as string[] | undefined) ?? [];
  return groups.includes("Admin");
}

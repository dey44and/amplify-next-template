import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "mockExamsStorage",
  access: (allow) => ({
    "bac-submissions/{entity_id}/*": [
      allow.entity("identity").to(["read", "write", "delete"]),
      allow.groups(["Admin"]).to(["read", "delete"]),
    ],
    "bac-evaluations/{entity_id}/*": [
      allow.entity("identity").to(["read"]),
      allow.groups(["Admin"]).to(["read", "write", "delete"]),
    ],
  }),
});

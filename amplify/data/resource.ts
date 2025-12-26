import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({

  UserProfile: a.model({
    firstName: a.string(),
    lastName: a.string(),
    county: a.string(),
    age: a.integer(),
    highSchool: a.string(),
  }).authorization((allow) => [allow.owner()]),

  MockExam: a.model({
    title: a.string(),
    admissionType: a.string(),
  }).authorization((allow) => [
    allow.authenticated().to(["read"]),
    allow.group("Admin"),
  ]),

  Task: a.model({
    examId: a.id(),
    order: a.integer(),
    question: a.string(),
    correctAnswer: a.string(),
    mark: a.float(),
  })
    .authorization((allow) => [
      allow.authenticated().to(["read"]),
      allow.group("Admin"),
    ])
    .secondaryIndexes((index) => [index("examId").sortKeys(["order"])]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
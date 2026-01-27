import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  UserProfile: a
    .model({
      userId: a.string(), // Cognito sub
      firstName: a.string(),
      lastName: a.string(),
      county: a.string(),
      age: a.integer(),
      highSchool: a.string(),
    })
    .authorization((allow) => [allow.owner()])
    .secondaryIndexes((index) => [index("userId")]),

  MockExam: a
    .model({
      title: a.string(),
      admissionType: a.string(),
    })
    .authorization((allow) => [
      allow.authenticated().to(["read"]),
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ]),

  // Student-readable questions (no answers here)
  Task: a
    .model({
      examId: a.id(),
      order: a.integer(),
      question: a.string(),
      mark: a.float(),
    })
    .authorization((allow) => [
      allow.authenticated().to(["read"]),
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ])
    .secondaryIndexes((index) => [index("examId").sortKeys(["order"])]),

  // Admin-only answer key
  TaskKey: a
    .model({
      taskId: a.id(),
      correctAnswer: a.string(),
    })
    .authorization((allow) => [
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ])
    .secondaryIndexes((index) => [index("taskId")]),

  // Stores results for statistics/leaderboards
  ExamAttempt: a
    .model({
      userId: a.string(),
      examId: a.id(),
      admissionType: a.string(), // snapshot from MockExam
      submittedAt: a.datetime(),
      score: a.float(),
      maxScore: a.float(),
      // optional later:
      // answersJson: a.string(),
    })
    .authorization((allow) => [
      allow.owner().to(["create", "read"]),
      allow.group("Admin").to(["read"]),
    ])
    .secondaryIndexes((index) => [
      index("userId").sortKeys(["submittedAt"]),
      index("examId").sortKeys(["submittedAt"]),
      index("admissionType").sortKeys(["submittedAt"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});

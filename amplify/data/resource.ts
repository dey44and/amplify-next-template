import { type ClientSchema, a, defineData, defineFunction } from "@aws-amplify/backend";

/* Operation Handlers */
export const listTasksForExamFn = defineFunction({
  entry: "./exam-ops/listTasksForExam.ts",
  resourceGroupName: "data",
});

export const decideExamRequestFn = defineFunction({
  entry: "./exam-ops/decideExamRequest.ts",
  resourceGroupName: "data",
});

export const submitExamAttemptFn = defineFunction({
  entry: "./exam-ops/submitExamAttempt.ts",
  resourceGroupName: "data",
});

export const getExamReviewFn = defineFunction({
  entry: "./exam-ops/getExamReview.ts",
  resourceGroupName: "data",
});

export const getAdmissionPerformanceFn = defineFunction({
  entry: "./exam-ops/getAdmissionPerformance.ts",
  resourceGroupName: "data",
});

const schema = a.schema({
  UserProfile: a
    .model({
      avatarUrl: a.string(),
      firstName: a.string(),
      lastName: a.string(),
      county: a.string(),
      age: a.integer(),
      highSchool: a.string(),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn("id").identityClaim("sub"),
    ]),

  MockExam: a
    .model({
      title: a.string(),
      admissionType: a.string(),
      // SCHEDULING
      startAt: a.datetime(),
      durationMinutes: a.integer(),
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
    allow.group("Admin").to(["create", "read", "update", "delete"]),
    // (allow as any).resource(listTasksForExamFn).to(["read"]),
    // (allow as any).resource(submitExamAttemptFn).to(["read"]),
    // (allow as any).resource(getExamReviewFn).to(["read"]),
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
      // (allow as any).resource(submitExamAttemptFn).to(["read"]),
      // (allow as any).resource(getExamReviewFn).to(["read"]),
    ])
    .secondaryIndexes((index) => [index("taskId")]),

  // Stores results for statistics/leaderboards
  ExamAttempt: a
    .model({
      userId: a.string(),
      examId: a.id(),
      admissionType: a.string(),
      submittedAt: a.datetime(),
      score: a.float(),
      maxScore: a.float(),
      startedAt: a.datetime(),
      endedAt: a.datetime(),
      answersJson: a.string(),
      reviewItemsJson: a.string(),
    })
    .authorization((allow) => [
      // Students can read only their own attempts.
      // Creation is forced through submitExamAttempt mutation (server-side checks).
      allow.ownerDefinedIn("userId").identityClaim("sub").to(["read"]),
      allow.group("Admin").to(["read"]),
      // (allow as any).resource(submitExamAttemptFn).to(["create", "read"]),
      // (allow as any).resource(getExamReviewFn).to(["read"]),
    ]),

  ExamAttemptLock: a
    .model({
      owner: a.string().required(),
      examId: a.id().required(),
      createdAt: a.datetime(),
      finalizedAt: a.datetime(),
      attemptId: a.id(),
    })
    .identifier(["owner", "examId"])
    .authorization((allow) => [
      // Locks are managed only by backend functions.
      allow.group("Admin").to(["read"]),
    ]),

    ExamRequestStatus: a.enum(["PENDING", "APPROVED", "REJECTED"]),

    ExamRequest: a
    .model({
      owner: a.string().required(), // Cognito sub
      examId: a.id().required(),
      admissionType: a.string(),
      status: a.ref("ExamRequestStatus"),
      requestedAt: a.datetime(),
      decidedAt: a.datetime(),
      decidedBy: a.string(),
      note: a.string(),
    })
    .identifier(["owner", "examId"])
    .authorization((allow) => [
      // student can create/read/delete their own request (no update!)
      allow.ownerDefinedIn("owner").identityClaim("sub").to(["create", "read", "delete"]),
      // admin can read/update/delete
      allow.group("Admin").to(["read", "update", "delete"]),
    ])
    .secondaryIndexes((index) => [
      index("owner").sortKeys(["requestedAt"]),
      index("status").sortKeys(["requestedAt"]),
      index("examId").sortKeys(["requestedAt"]),
    ]),

    ExamAccess: a
    .model({
      owner: a.string().required(), // Cognito sub
      examId: a.id().required(),
      grantedAt: a.datetime(),
      grantedBy: a.string(),
      note: a.string(),
    })
    .identifier(["owner", "examId"])
    .authorization((allow) => [
      allow.ownerDefinedIn("owner").identityClaim("sub").to(["read"]),
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ])
    .secondaryIndexes((index) => [
      index("owner").sortKeys(["grantedAt"]),
      index("examId").sortKeys(["grantedAt"]),
    ]),

    ReviewItem: a.customType({
      taskId: a.id().required(),
      order: a.integer(),
      question: a.string(),
      mark: a.float(),
      correctAnswer: a.string(),
      userAnswer: a.string(),
      isCorrect: a.boolean(),
      earned: a.float(),
    }),
    
    ExamReview: a.customType({
      attemptId: a.id().required(),
      examId: a.id().required(),
      submittedAt: a.datetime(),
      score: a.float(),
      maxScore: a.float(),
      items: a.ref("ReviewItem").array(),
    }),

    PerformancePoint: a.customType({
      bucketStart: a.datetime(),
      userAvgPercent: a.float(),
      userCount: a.integer(),
      cohortAvgPercent: a.float(),
      cohortCount: a.integer(),
    }),

    AdmissionPerformance: a.customType({
      admissionType: a.string(),
      userTotalCount: a.integer(),
      cohortTotalCount: a.integer(),
      points: a.ref("PerformancePoint").array(),
    }),

    // Custom query: students call this, function checks ExamAccess
    listTasksForExam: a
    .query()
    .arguments({ examId: a.id().required() })
    .returns(a.ref("Task").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(listTasksForExamFn)),

    // Custom mutation: admin approves/rejects request + grants access
    decideExamRequest: a
      .mutation()
      .arguments({
        owner: a.string().required(),
        examId: a.id().required(),
        status: a.ref("ExamRequestStatus"), // should be APPROVED/REJECTED
        note: a.string(),
      })
      .returns(a.ref("ExamRequest"))
      .authorization((allow) => [allow.group("Admin")])
      .handler(a.handler.function(decideExamRequestFn)),

      submitExamAttempt: a
      .mutation()
      .arguments({
        examId: a.id().required(),
        answersJson: a.string().required(),
        startedAt: a.datetime(), // optional from UI
      })
      .returns(a.ref("ExamAttempt"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitExamAttemptFn)),

      getExamReview: a
      .query()
      .arguments({ attemptId: a.id().required() })
      .returns(a.ref("ExamReview"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getExamReviewFn)),

      getAdmissionPerformance: a
      .query()
      .arguments({
        admissionType: a.string(),
      })
      .returns(a.ref("AdmissionPerformance"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getAdmissionPerformanceFn)),
})
.authorization((allow) => [
  allow.resource(listTasksForExamFn).to(["query"]),
  allow.resource(decideExamRequestFn).to(["query", "mutate"]),
  allow.resource(submitExamAttemptFn).to(["query", "mutate"]),
  allow.resource(getExamReviewFn).to(["query"]),
  allow.resource(getAdmissionPerformanceFn).to(["query"]),
]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});

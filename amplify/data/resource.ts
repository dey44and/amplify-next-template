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

export const getBacPerformanceFn = defineFunction({
  entry: "./exam-ops/getBacPerformance.ts",
  resourceGroupName: "data",
});

export const listArchiveProblemsFn = defineFunction({
  entry: "./exam-ops/listArchiveProblems.ts",
  resourceGroupName: "data",
});

export const recommendAdaptiveTaskFn = defineFunction({
  entry: "./exam-ops/recommendAdaptiveTask.ts",
  resourceGroupName: "data",
});

export const submitPracticeAnswerFn = defineFunction({
  entry: "./exam-ops/submitPracticeAnswer.ts",
  resourceGroupName: "data",
});

export const requestBacAccessFn = defineFunction({
  entry: "./exam-ops/requestBacAccess.ts",
  resourceGroupName: "data",
});

export const decideBacRequestFn = defineFunction({
  entry: "./exam-ops/decideBacRequest.ts",
  resourceGroupName: "data",
  environment: {
    APP_BASE_URL: "https://mockexams.ro",
    SES_FROM_EMAIL: "noreply@mockexams.ro",
  },
});

export const getBacSimulationContentFn = defineFunction({
  entry: "./exam-ops/getBacSimulationContent.ts",
  resourceGroupName: "data",
});

export const submitBacSubmissionFn = defineFunction({
  entry: "./exam-ops/submitBacSubmission.ts",
  resourceGroupName: "data",
});

export const publishBacEvaluationFn = defineFunction({
  entry: "./exam-ops/publishBacEvaluation.ts",
  resourceGroupName: "data",
  environment: {
    APP_BASE_URL: "https://mockexams.ro",
    SES_FROM_EMAIL: "noreply@mockexams.ro",
  },
});

export const listAdminUsersFn = defineFunction({
  entry: "./exam-ops/listAdminUsers.ts",
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
      allow.group("Admin").to(["read"]),
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
    topic: a.string(),
    authorDifficulty: a.string(),
    optionsCount: a.integer(),
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

  UserTopicRating: a
    .model({
      owner: a.string().required(),
      topic: a.string().required(),
      rating: a.float(),
      attempts: a.integer(),
      updatedAt: a.datetime(),
    })
    .identifier(["owner", "topic"])
    .authorization((allow) => [
      allow.ownerDefinedIn("owner").identityClaim("sub").to(["read"]),
      allow.group("Admin").to(["read"]),
    ]),

  TaskDifficultyRating: a
    .model({
      taskId: a.id().required(),
      rating: a.float(),
      attempts: a.integer(),
      updatedAt: a.datetime(),
    })
    .identifier(["taskId"])
    .authorization((allow) => [
      allow.group("Admin").to(["read"]),
    ]),

  PracticeAttempt: a
    .model({
      owner: a.string().required(),
      taskId: a.id().required(),
      topic: a.string(),
      submittedAt: a.datetime(),
      isCorrect: a.boolean(),
      userAnswer: a.string(),
      expectedProb: a.float(),
      optionsCount: a.integer(),
      studentRatingBefore: a.float(),
      studentRatingAfter: a.float(),
      itemRatingBefore: a.float(),
      itemRatingAfter: a.float(),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn("owner").identityClaim("sub").to(["read"]),
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

  BacSimulation: a
    .model({
      title: a.string().required(),
      subject: a.string().required(),
      startAt: a.datetime(),
      durationMinutes: a.integer(),
      accessWindowMinutes: a.integer(),
      maxGrade: a.float(),
    })
    .authorization((allow) => [
      allow.authenticated().to(["read"]),
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ]),

  BacSimulationContent: a
    .model({
      simulationId: a.id().required(),
      instructions: a.string(),
      promptText: a.string(),
    })
    .identifier(["simulationId"])
    .authorization((allow) => [
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ]),

  BacRequestStatus: a.enum(["PENDING", "APPROVED", "REJECTED"]),

  BacRequest: a
    .model({
      owner: a.string().required(), // Cognito sub
      simulationId: a.id().required(),
      requesterEmail: a.email(),
      subject: a.string(),
      status: a.ref("BacRequestStatus"),
      requestedAt: a.datetime(),
      decidedAt: a.datetime(),
      decidedBy: a.string(),
      note: a.string(),
      confirmationEmailSentAt: a.datetime(),
      confirmationEmailError: a.string(),
    })
    .identifier(["owner", "simulationId"])
    .authorization((allow) => [
      // Students can read/delete their own request. Creation goes through
      // requestBacAccess so the backend captures the authenticated email.
      allow.ownerDefinedIn("owner").identityClaim("sub").to(["read", "delete"]),
      allow.group("Admin").to(["read", "update", "delete"]),
    ])
    .secondaryIndexes((index) => [
      index("owner").sortKeys(["requestedAt"]),
      index("status").sortKeys(["requestedAt"]),
      index("simulationId").sortKeys(["requestedAt"]),
    ]),

  BacAccess: a
    .model({
      owner: a.string().required(), // Cognito sub
      simulationId: a.id().required(),
      grantedAt: a.datetime(),
      grantedBy: a.string(),
      note: a.string(),
      startedAt: a.datetime(),
      deadlineAt: a.datetime(),
    })
    .identifier(["owner", "simulationId"])
    .authorization((allow) => [
      allow.ownerDefinedIn("owner").identityClaim("sub").to(["read"]),
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ])
    .secondaryIndexes((index) => [
      index("owner").sortKeys(["grantedAt"]),
      index("simulationId").sortKeys(["grantedAt"]),
    ]),

  BacSubmission: a
    .model({
      owner: a.string().required(), // Cognito sub
      simulationId: a.id().required(),
      submittedAt: a.datetime(),
      updatedAt: a.datetime(),
      solutionFilePath: a.string().required(),
      solutionOriginalName: a.string(),
      solutionContentType: a.string(),
      solutionSizeBytes: a.integer(),
      studentNote: a.string(),
    })
    .identifier(["owner", "simulationId"])
    .authorization((allow) => [
      // Students can read their own submission. Creation/update is forced
      // through submitBacSubmission so the official window is checked server-side.
      allow.ownerDefinedIn("owner").identityClaim("sub").to(["read"]),
      allow.group("Admin").to(["read", "delete"]),
    ])
    .secondaryIndexes((index) => [
      index("owner").sortKeys(["submittedAt"]),
      index("simulationId").sortKeys(["submittedAt"]),
    ]),

  BacEvaluationStatus: a.enum(["DRAFT", "GRADED", "RETURNED"]),

  BacEvaluation: a
    .model({
      submissionOwner: a.string().required(), // Cognito sub
      simulationId: a.id().required(),
      status: a.ref("BacEvaluationStatus"),
      manualGrade: a.float(),
      maxGrade: a.float(),
      evaluationNotes: a.string(),
      evaluationFilePath: a.string(),
      evaluationOriginalName: a.string(),
      evaluationContentType: a.string(),
      evaluationSizeBytes: a.integer(),
      gradedBy: a.string(),
      gradedAt: a.datetime(),
      updatedAt: a.datetime(),
      notificationEmailSentAt: a.datetime(),
      notificationEmailError: a.string(),
    })
    .identifier(["submissionOwner", "simulationId"])
    .authorization((allow) => [
      allow.ownerDefinedIn("submissionOwner").identityClaim("sub").to(["read"]),
      allow.group("Admin").to(["create", "read", "update", "delete"]),
    ])
    .secondaryIndexes((index) => [
      index("simulationId").sortKeys(["gradedAt"]),
      index("status").sortKeys(["gradedAt"]),
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

  BacPerformancePoint: a.customType({
    bucketStart: a.datetime(),
    userAvgPercent: a.float(),
    userCount: a.integer(),
    cohortMedianPercent: a.float(),
    cohortMinPercent: a.float(),
    cohortMaxPercent: a.float(),
    cohortCount: a.integer(),
  }),

  BacPerformance: a.customType({
    subject: a.string(),
    userTotalCount: a.integer(),
    cohortTotalCount: a.integer(),
    minCohortSample: a.integer(),
    points: a.ref("BacPerformancePoint").array(),
  }),

  ArchiveProblem: a.customType({
    taskId: a.id().required(),
    examId: a.id(),
    examTitle: a.string(),
    order: a.integer(),
    question: a.string(),
    mark: a.float(),
    topic: a.string(),
    optionsCount: a.integer(),
  }),

  AdaptiveRecommendation: a.customType({
    status: a.string().required(),
    reason: a.string(),
    taskId: a.id(),
    examId: a.id(),
    examTitle: a.string(),
    question: a.string(),
    topic: a.string(),
    optionsCount: a.integer(),
    expectedCorrectProb: a.float(),
    studentTopicRating: a.float(),
  }),

  PracticeSubmissionResult: a.customType({
    taskId: a.id().required(),
    topic: a.string(),
    isCorrect: a.boolean(),
    correctAnswer: a.string(),
    expectedCorrectProb: a.float(),
    studentTopicRatingBefore: a.float(),
    studentTopicRatingAfter: a.float(),
  }),

  BacSimulationContentView: a.customType({
    simulationId: a.id().required(),
    instructions: a.string(),
    promptText: a.string(),
    startedAt: a.datetime(),
    deadlineAt: a.datetime(),
    accessWindowEndsAt: a.datetime(),
  }),

  ExamTaskPublic: a.customType({
    id: a.id().required(),
    order: a.integer(),
    question: a.string(),
    mark: a.float(),
  }),

  AdminUserAccount: a.customType({
    owner: a.string().required(),
    email: a.email(),
    username: a.string(),
    enabled: a.boolean(),
    status: a.string(),
    createdAt: a.datetime(),
    updatedAt: a.datetime(),
  }),

  // Custom query: students call this, function checks ExamAccess
  listTasksForExam: a
    .query()
    .arguments({ examId: a.id().required() })
    .returns(a.ref("ExamTaskPublic").array())
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

  getBacPerformance: a
    .query()
    .arguments({
      subject: a.string(),
    })
    .returns(a.ref("BacPerformance"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(getBacPerformanceFn)),

  listArchiveProblems: a
    .query()
    .returns(a.ref("ArchiveProblem").array())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(listArchiveProblemsFn)),

  recommendAdaptiveTask: a
    .query()
    .arguments({
      topic: a.string(),
      minProb: a.float(),
      maxProb: a.float(),
    })
    .returns(a.ref("AdaptiveRecommendation"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(recommendAdaptiveTaskFn)),

  submitPracticeAnswer: a
    .mutation()
    .arguments({
      taskId: a.id().required(),
      answer: a.string().required(),
    })
    .returns(a.ref("PracticeSubmissionResult"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(submitPracticeAnswerFn)),

  requestBacAccess: a
    .mutation()
    .arguments({
      simulationId: a.id().required(),
    })
    .returns(a.ref("BacRequest"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(requestBacAccessFn)),

  decideBacRequest: a
    .mutation()
    .arguments({
      owner: a.string().required(),
      simulationId: a.id().required(),
      status: a.ref("BacRequestStatus"),
      note: a.string(),
    })
    .returns(a.ref("BacRequest"))
    .authorization((allow) => [allow.group("Admin")])
    .handler(a.handler.function(decideBacRequestFn)),

  getAuthorizedBacSimulationContent: a
    .query()
    .arguments({ simulationId: a.id().required() })
    .returns(a.ref("BacSimulationContentView"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(getBacSimulationContentFn)),

  submitBacSubmission: a
    .mutation()
    .arguments({
      simulationId: a.id().required(),
      solutionFilePath: a.string().required(),
      solutionOriginalName: a.string(),
      solutionContentType: a.string(),
      solutionSizeBytes: a.integer(),
      studentNote: a.string(),
    })
    .returns(a.ref("BacSubmission"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(submitBacSubmissionFn)),

  publishBacEvaluation: a
    .mutation()
    .arguments({
      submissionOwner: a.string().required(),
      simulationId: a.id().required(),
      manualGrade: a.float().required(),
      maxGrade: a.float().required(),
      evaluationNotes: a.string(),
      evaluationFilePath: a.string(),
      evaluationOriginalName: a.string(),
      evaluationContentType: a.string(),
      evaluationSizeBytes: a.integer(),
    })
    .returns(a.ref("BacEvaluation"))
    .authorization((allow) => [allow.group("Admin")])
    .handler(a.handler.function(publishBacEvaluationFn)),

  listAdminUsers: a
    .query()
    .returns(a.ref("AdminUserAccount").array())
    .authorization((allow) => [allow.group("Admin")])
    .handler(a.handler.function(listAdminUsersFn)),
})
.authorization((allow) => [
  allow.resource(listTasksForExamFn).to(["query"]),
  allow.resource(decideExamRequestFn).to(["query", "mutate"]),
  allow.resource(submitExamAttemptFn).to(["query", "mutate"]),
  allow.resource(getExamReviewFn).to(["query"]),
  allow.resource(getAdmissionPerformanceFn).to(["query"]),
  allow.resource(getBacPerformanceFn).to(["query"]),
  allow.resource(listArchiveProblemsFn).to(["query"]),
  allow.resource(recommendAdaptiveTaskFn).to(["query"]),
  allow.resource(submitPracticeAnswerFn).to(["query", "mutate"]),
  allow.resource(requestBacAccessFn).to(["query", "mutate"]),
  allow.resource(decideBacRequestFn).to(["query", "mutate"]),
  allow.resource(getBacSimulationContentFn).to(["query", "mutate"]),
  allow.resource(submitBacSubmissionFn).to(["query", "mutate"]),
  allow.resource(publishBacEvaluationFn).to(["query", "mutate"]),
  allow.resource(listAdminUsersFn).to(["query"]),
]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "userPool" },
});

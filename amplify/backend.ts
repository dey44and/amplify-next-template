import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { storage } from "./storage/resource.js";

import {
  listTasksForExamFn,
  decideExamRequestFn,
  submitExamAttemptFn,
  getExamReviewFn,
  getAdmissionPerformanceFn,
  listArchiveProblemsFn,
  recommendAdaptiveTaskFn,
  submitPracticeAnswerFn,
  requestBacAccessFn,
  decideBacRequestFn,
  getBacSimulationContentFn,
  submitBacSubmissionFn,
} from "./data/resource.js";

const backend = defineBackend({
  auth,
  data,
  storage,

  // IMPORTANT: expose the functions as backend resources
  listTasksForExamFn,
  decideExamRequestFn,
  submitExamAttemptFn,
  getExamReviewFn,
  getAdmissionPerformanceFn,
  listArchiveProblemsFn,
  recommendAdaptiveTaskFn,
  submitPracticeAnswerFn,
  requestBacAccessFn,
  decideBacRequestFn,
  getBacSimulationContentFn,
  submitBacSubmissionFn,
});

// Allow these lambdas to call the Amplify Data (AppSync GraphQL) API using IAM
const apiArn = backend.data.resources.graphqlApi.arn;

const allowGraphQL = new PolicyStatement({
  actions: ["appsync:GraphQL"],
  resources: [`${apiArn}/*`],
});

backend.listTasksForExamFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.decideExamRequestFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.submitExamAttemptFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.getExamReviewFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.getAdmissionPerformanceFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.listArchiveProblemsFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.recommendAdaptiveTaskFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.submitPracticeAnswerFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.requestBacAccessFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.decideBacRequestFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.getBacSimulationContentFn.resources.lambda.addToRolePolicy(allowGraphQL);
backend.submitBacSubmissionFn.resources.lambda.addToRolePolicy(allowGraphQL);

backend.requestBacAccessFn.resources.cfnResources.cfnFunction.addPropertyOverride(
  "Environment.Variables.AUTH_USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId
);
backend.requestBacAccessFn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:AdminGetUser", "cognito-idp:ListUsers"],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

backend.decideBacRequestFn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["ses:SendEmail"],
    resources: ["*"],
    conditions: {
      StringEquals: {
        "ses:FromAddress": "noreply@mockexams.ro",
      },
    },
  })
);

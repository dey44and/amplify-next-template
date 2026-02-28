import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";

import {
  listTasksForExamFn,
  decideExamRequestFn,
  submitExamAttemptFn,
  getExamReviewFn,
  getAdmissionPerformanceFn,
} from "./data/resource.js";

const backend = defineBackend({
  auth,
  data,

  // IMPORTANT: expose the functions as backend resources
  listTasksForExamFn,
  decideExamRequestFn,
  submitExamAttemptFn,
  getExamReviewFn,
  getAdmissionPerformanceFn,
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

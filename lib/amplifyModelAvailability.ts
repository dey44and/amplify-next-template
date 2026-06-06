type RuntimeModel = {
  list?: unknown;
  get?: unknown;
  create?: unknown;
  update?: unknown;
  delete?: unknown;
};

type RuntimeModels = Record<string, RuntimeModel | undefined>;

function runtimeModels(models: unknown): RuntimeModels {
  return (models ?? {}) as RuntimeModels;
}

export function hasModelMethod(models: unknown, modelName: string, methodName: keyof RuntimeModel) {
  const model = runtimeModels(models)[modelName];
  return typeof model?.[methodName] === "function";
}

export function hasBacModels(models: unknown) {
  return (
    ["BacSimulation", "BacRequest", "BacAccess", "BacSubmission", "BacEvaluation"].every(
      (modelName) => hasModelMethod(models, modelName, "list")
    ) && hasModelMethod(models, "BacSimulationContent", "get")
  );
}

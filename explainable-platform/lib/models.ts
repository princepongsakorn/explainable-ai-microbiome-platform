/** The MLflow registry stage a published model version is in. */
export const PRODUCTION_STAGE = "Production";

export const isProductionStage = (stage?: string | null) => stage === PRODUCTION_STAGE;

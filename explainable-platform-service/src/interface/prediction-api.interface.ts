export interface IBeeswarmResponse {
  explain: string;
}

export interface IHeatmapResponse {
  explain: string;
}

export interface IWaterfallResponse {
  explain: {
    id: string;
    waterfall: string;
  }[];
}

export interface IPredictResponse {
  predict: {
    id: string;
    proba: number;
    class: number;
  }[];
  /** The registry version that answered. */
  model_version?: string | null;
}

/** GET /v1/models/<name>/production */
export interface IProductionVersionResponse {
  name: string;
  version: string;
  run_id: string;
}

export interface IDataframeSplitRequest {
  dataframe_split: {
    columns: string[];
    data: (string | number)[][];
    /**
     * Optional row labels. The Python service uses them as the DataFrame index,
     * which /v1/explain/values then serializes as `sample_ids` — the mapping from
     * a PredictionRecord id to its row in the Explanation matrix.
     */
    index?: string[];
  };
}

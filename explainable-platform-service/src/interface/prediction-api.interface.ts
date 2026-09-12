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
}

export interface IDataframeSplitRequest {
  dataframe_split: {
    columns: string[];
    data: number[][];
    /**
     * Optional row labels. The Python service uses them as the DataFrame index,
     * which /v1/explain/values then serializes as `sample_ids` — the mapping from
     * a PredictionRecord id to its row in the Explanation matrix.
     */
    index?: string[];
  };
}

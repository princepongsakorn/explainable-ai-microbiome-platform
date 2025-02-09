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
    };
  }
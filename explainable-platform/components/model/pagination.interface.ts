import { PredictionClass, PredictionStatus } from "./model.interface";

export interface IPaginationRequestParams {
  page?: number | undefined;
  class?: PredictionClass
  status?: PredictionStatus
}

export interface IPaginationMeta {
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  totalPages: number;
  currentPage: number;
}

export interface IPagination<T> {
  items: T[];
  meta: IPaginationMeta;
}
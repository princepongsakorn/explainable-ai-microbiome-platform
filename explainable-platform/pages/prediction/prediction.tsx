"use client";

import Layout from "@/components/common/Layout";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { IPredictions } from "@/components/model/model.interface";
import Drawer from "react-modern-drawer";
import { getPredictions } from "../api/predict";
import { useSse } from "@/lib/useSse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "react-modern-drawer/dist/index.css";
import { Pagination } from "@/components/ui/Pagination";
import {
  IPagination,
  IPaginationRequestParams,
} from "@/components/model/pagination.interface";
import { useRouter } from "next/router";
import { queryToString } from "@/lib/queryToString";
import {
  invalidateExplanation,
  revalidateExplanation,
  setExplanationProgress,
} from "@/lib/useExplanation";
import {
  GlobalBeeswarmChart,
  GlobalHeatmapChart,
  GlobalImportanceChart,
} from "@/components/shap/ExplanationCharts";

dayjs.extend(utc);
dayjs.extend(timezone);

export function History() {
  const router = useRouter();
  const [predictions, setPredictions] = useState<IPagination<IPredictions>>();
  const [isOpen, setIsOpen] = useState(false);
  const [selectPrediction, setSelectPrediction] = useState<IPredictions>();

  const currentPage = Number(router.query.page) || 1;

  const getPredictionsRecordList = async () => {
    const params: IPaginationRequestParams = {
      page: currentPage,
    };
    const data = await getPredictions(params);
    setPredictions(data);
    return data;
  };

  // Live heatmap/beeswarm updates while the drawer is open on a prediction.
  useSse(
    isOpen && selectPrediction?.id
      ? `/events/predictions/${selectPrediction.id}`
      : null,
    {
      // SSE has no event replay: a 'prediction:explain' emitted while the
      // socket was down is lost. Re-fetch on (re)connect and reconcile the
      // open drawer from the fresh list.
      onOpen() {
        getPredictionsRecordList().then((data) => {
          setSelectPrediction((prev) => {
            if (!prev) return prev;
            return data.items.find((it) => it.id === prev.id) ?? prev;
          });
        });
        // An explanation finished or rebuilt while the socket was down.
        if (selectPrediction?.id) revalidateExplanation(selectPrediction.id);
      },
      onMessage(ev) {
        if (!ev.data) return;
        try {
          const payload = JSON.parse(ev.data);
          const id = selectPrediction?.id;
          if (!id) return;
          // The charts read the explanation over HTTP, so the only thing these
          // events have to do is say when to look again.
          if (ev.event === "prediction:explanation") {
            invalidateExplanation(id);
          } else if (ev.event === "prediction:explanation-progress") {
            setExplanationProgress(id, {
              done: payload.done,
              total: payload.total,
            });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[prediction SSE] bad payload:", err);
        }
      },
    }
  );

  const onHandleChangePage = (page: number) => {
    router.query.page = page?.toString();
    const queryString = queryToString(router.query);
    router.push(`?${queryString}`, undefined, { shallow: true });
  };

  const onViewAll = (id?: string) => {
    if (id) {
      const params = { id };
      const queryString = queryToString(params);
      router.push(`local/?${queryString}`, undefined, {
        shallow: true,
      });
    }
  };

  // Re-fetch when the page changes. Previously this only ran on mount, so
  // paginating left the table showing the first page's data.
  useEffect(() => {
    getPredictionsRecordList();
  }, [currentPage]);

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="text-xl font-medium">Prediction List</div>
        <div className="mt-4 pt-8 overflow-hidden border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full">
          <div className="flex flex-col w-full">
            <table className="w-full text-sm text-left rtl:text-right text-gray-500">
              <thead className="text-gray-700 bg-gray-50 ">
                <tr className="">
                  <th
                    scope="col"
                    className="font-medium rounded-l-lg px-6 py-3"
                  >
                    Prediction Id
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Model
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Record
                  </th>
                  <th
                    scope="col"
                    className="font-medium rounded-r-lg px-6 py-3"
                  >
                    Create At
                  </th>
                </tr>
              </thead>
              <tbody>
                {predictions?.items.map((prediction) => (
                  <tr
                    className="bg-white hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      setIsOpen(true), setSelectPrediction(prediction);
                    }}
                  >
                    <th
                      scope="row"
                      className="px-6 py-5 font-medium text-black whitespace-nowrap"
                    >
                      {prediction.predictionNumber}
                    </th>
                    <td className="text-black px-6 py-5">
                      {prediction.modelName}
                    </td>
                    <td className="text-black px-6 py-5">
                      {prediction.records.total}
                    </td>
                    <td className="text-black px-6 py-5">
                      {dayjs(prediction.createdAt)
                        .tz("Asia/Bangkok")
                        .format("DD-MM-YYYY HH:mm")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            itemsPerPage={predictions?.meta.itemsPerPage || 0}
            totalItems={predictions?.meta.totalItems || 0}
            totalPages={predictions?.meta.totalPages || 0}
            itemCount={predictions?.meta.itemCount || 0}
            className="mt-4"
            onChange={onHandleChangePage}
          />
        </div>
      </div>
      <Drawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        direction="right"
        className="shadow-2xs max-w-4xl overflow-y-auto"
        duration={150}
        size={"60vw"}
      >
        <div className="p-[40px] pt-[40px] overflow-y-auto">
          <div className="flex flex-row justify-between items-center">
            <p className="text-xl font-medium text-gray-800">
              {selectPrediction?.predictionNumber}
            </p>
            <button
              type="button"
              className="py-2.5 px-5 text-sm font-medium text-gray-900 focus:outline-none bg-white rounded-lg border border-gray-200 hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-100"
              onClick={() => onViewAll(selectPrediction?.id)}
            >
              <div className="flex flex-row gap-2">
                View All <ChevronRightIcon className="w-4" />
              </div>
            </button>
          </div>
          <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
            General Information
          </div>
          <div className="flex flex-row justify-between mb-3">
            <p className="font-medium">Model</p>
            <p>{selectPrediction?.modelName}</p>
          </div>
          <div className="flex flex-row justify-between mb-3">
            <p className="font-medium">Record</p>
            <p>{selectPrediction?.records.total}</p>
          </div>
          <div className="flex flex-row justify-between">
            <p className="font-medium">Predict at</p>
            <p>
              {dayjs(selectPrediction?.createdAt)
                .tz("Asia/Bangkok")
                .format("DD-MM-YYYY HH:mm")}
            </p>
          </div>
          <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
            Summary
          </div>
          <div className="flex flex-col mb-3 mt-3">
            <div className="font-medium">Feature importance</div>
            <div className="text-sm py-2 text-gray-500">
              Mean absolute SHAP value per feature across every sample in this
              prediction — how much each taxon moved the model, regardless of
              direction. Drawn in the browser from the explanation values, so the
              number of features shown can be changed without recomputing
              anything.
            </div>
            <GlobalImportanceChart predictionId={selectPrediction?.id} />
          </div>
          <div className="flex flex-col mb-3 mt-3 border-t-[1px] border-[#EAEAEA] pt-3">
            <div className="font-medium">Beeswarm</div>
            <div className="text-sm py-2 text-gray-500">
              One dot per sample per feature. Horizontal position is that
              sample&apos;s SHAP value; colour is its relative abundance, scaled
              within the row so a single dominant taxon cannot wash out the
              others. Interactive — hover a dot for its values.
            </div>
            <GlobalBeeswarmChart predictionId={selectPrediction?.id} />
          </div>
          <div className="flex flex-col mb-3 mt-3 border-t-[1px] border-[#EAEAEA] pt-3">
            <div className="font-medium">Heatmap</div>
            <div className="text-sm py-2 text-gray-500">
              Every sample as a column, every feature as a row, coloured by SHAP
              value — white at zero, red above, blue below. Samples are ordered
              by total attribution, so groups with similar explanations sit
              together. Hover a column to see which sample it is.
            </div>
            <GlobalHeatmapChart predictionId={selectPrediction?.id} />
          </div>
        </div>
      </Drawer>
    </>
  );
}

History.Layout = Layout;
History.title = "Prediction List";
export default History;

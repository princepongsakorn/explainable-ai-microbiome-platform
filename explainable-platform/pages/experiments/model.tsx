"use client";

import Layout from "@/components/common/Layout";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { IPredictions } from "@/components/model/model.interface";
import Drawer from "react-modern-drawer";
import { getPredictions } from "../api/predict";
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
import { queryToString } from "../utils/queryToString";
import { ShapPlotPlaceholder } from "@/components/ui/ImageEmpty/ImageEmpty";
import { Dropdown } from "@/components/ui/Dropdown/Dropdown";
import { getExperimentsList, getExperimentsById } from "../api/experiments";
import {
  IExperiment,
  IExperimentsRunResponse,
  IRun,
} from "@/components/model/experiments.interface";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

export function History() {
  const [experiments, setExperiments] = useState<IExperiment[]>();
  const [selectedExperiments, setSelectedExperiments] = useState<IExperiment>();
  const [runs, setRuns] = useState<IExperimentsRunResponse>();

  useEffect(() => {
    const getExperiments = async () => {
      const data = await getExperimentsList();
      const experiments = data.experiments;
      setExperiments(experiments);
      setSelectedExperiments(experiments[0]);
    };
    getExperiments();
  }, []);

  useEffect(() => {
    setRuns(undefined);
    getExperiment();
  }, [selectedExperiments]);

  const getExperiment = async () => {
    if (selectedExperiments) {
      const data = await getExperimentsById(
        selectedExperiments?.experiment_id,
        { pageToken: "" }
      );
      setRuns(data);
    }
  };

  const loadMoreHandle = async () => {
    if (selectedExperiments && runs?.nextPageToken) {
      const data = await getExperimentsById(
        selectedExperiments?.experiment_id,
        { pageToken: runs?.nextPageToken }
      );
      const runsLoadMore: IExperimentsRunResponse = {
        runs: [...runs.runs, ...data.runs],
        nextPageToken: data.nextPageToken
      };
      setRuns(runsLoadMore);
    }
  };

  const getAllMetricsKeys = (runs?: IRun[]) => {
    if (runs) {
      const keys = new Set<string>();
      runs.forEach((run) => {
        Object.keys(run.data.metrics).forEach((key) => keys.add(key));
      });
      return Array.from(keys);
    }
    return [];
  };

  const getAllParametersKeys = (runs?: IRun[]) => {
    if (runs) {
      const keys = new Set<string>();
      runs.forEach((run) => {
        Object.keys(run.data.parameters).forEach((key) => keys.add(key));
      });
      return Array.from(keys);
    }
    return [];
  };

  const metricsHeaders = getAllMetricsKeys(runs?.runs);
  const parametersHeaders = getAllParametersKeys(runs?.runs);

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="text-xl font-medium">Experiments</div>
        <div
          style={{ height: "calc(100vh - 180px)" }}
          className="mt-4 pt-8 border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full flex flex-row gap-6 overflow-hidden"
        >
          <div className="flex flex-col max-w-[280px] w-1/4">
            <table className="w-full text-sm text-left rtl:text-right text-gray-500">
              <thead className="text-black bg-gray-50 ">
                <tr className="">
                  <th scope="col" className="font-medium px-6 py-3">
                    Experiments
                  </th>
                </tr>
              </thead>
              <tbody>
                {experiments?.map((experiment) => (
                  <tr className={`bg-white hover:bg-gray-50 cursor-pointer ${experiment === selectedExperiments ? "bg-blue-50" : ""}`}>
                    <th
                      scope="row"
                      className="px-4 py-3 font-medium text-black whitespace-nowrap"
                      onClick={() => setSelectedExperiments(experiment)}
                    >
                      {experiment.name}
                    </th>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col flex-1 w-3/4">
            <div className="flex flex-row justify-between mt-2 mb-6 items-center">
              <div className="font-medium text-xl">
                {selectedExperiments?.name}
              </div>
              <div className="flex flex-row gap-3">
                <div
                  className="flex flex-row gap-2 text-sm cursor-pointer px-4 py-2 rounded-full hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                  onClick={getExperiment}
                >
                  Refresh <ArrowPathIcon className="w-5" />
                </div>
              </div>
            </div>
            <div className="hide-scrollbar overflow-scroll border-b-[1px] border-gray-200">
              <table
                style={{ maxHeight: "calc(100vh - 280px)" }}
                className="w-full text-sm text-left rtl:text-right text-gray-500 border-separate border-spacing-0"
              >
                <thead className="text-gray-700 bg-gray-50 z-[1] sticky top-[0]">
                  {metricsHeaders.length > 0 || parametersHeaders.length > 0 ? (
                    <tr className="border-solid border-y-[1px] border-gray-200">
                      <th className="px-6 py-3 bg-gray-50 sticky left-[0] border-y-[1px] border-gray-200"></th>
                      <th
                        className="px-6 py-3 border-y-[1px] border-gray-200"
                        colSpan={2}
                      ></th>
                      {metricsHeaders.length > 0 && (
                        <th
                          className="px-6 py-3 border-y-[1px] border-gray-200"
                          colSpan={metricsHeaders.length}
                        >
                          Metrics
                        </th>
                      )}
                      {parametersHeaders.length > 0 && (
                        <th
                          className="px-6 py-3 border-y-[1px] border-gray-200"
                          colSpan={parametersHeaders.length}
                        >
                          Parameters
                        </th>
                      )}
                    </tr>
                  ) : (
                    <></>
                  )}
                  <tr className="">
                    <th
                      scope="col"
                      className="px-6 py-3 font-medium bg-gray-50 sticky left-[0] border-b-[1px] border-gray-200"
                    >
                      Run Name
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 font-medium border-b-[1px] border-gray-200"
                    >
                      Created
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 font-medium border-b-[1px] border-gray-200"
                    >
                      Duration
                    </th>
                    {metricsHeaders.map((header) => (
                      <th
                        key={header}
                        className="font-medium whitespace-nowrap px-6 py-3 border-b-[1px] border-gray-200"
                      >
                        {header}
                      </th>
                    ))}
                    {parametersHeaders.map((header) => (
                      <th
                        key={header}
                        className="font-medium whitespace-nowrap px-6 py-3 border-b-[1px] border-gray-200"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs?.runs.map((run) => (
                    <tr className="bg-white hover:bg-gray-50 text-black cursor-pointer border-b-[1px] border-gray-200">
                      <th
                        scope="row"
                        className="font-medium bg-white sticky left-[0] whitespace-nowrap border-b-[1px] border-gray-200"
                      >
                        <div className="px-4 py-4 border-r border-gray-300">
                          {run.info.run_name}
                        </div>
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-2 font-normal whitespace-nowrap border-b-[1px] border-gray-200"
                      >
                        {dayjs(run.info.start_time).fromNow()}
                      </th>
                      <th
                        scope="col"
                        className="font-normal px-4 py-2 border-b-[1px] border-gray-200"
                      >
                        {dayjs(run.info.end_time)
                          .diff(dayjs(run.info.start_time), "seconds", true)
                          .toFixed(1)}
                        s
                      </th>
                      {metricsHeaders.map((header) => (
                        <td
                          key={header}
                          className="px-4 py-2 border-b-[1px] border-gray-200"
                        >
                          {run.data.metrics[header] || "-"}
                        </td>
                      ))}
                      {parametersHeaders.map((header) => (
                        <td
                          key={header}
                          className="px-4 py-2 border-b-[1px] border-gray-200"
                        >
                          {run.data.parameters[header] || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {runs?.nextPageToken && (
                <div className="sticky left-[0] w-full px-4 py-2">
                  <div className="flex justify-center py-1">
                    <button
                      type="button"
                      className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-4 py-2 focus:outline-none"
                      onClick={loadMoreHandle}
                    >
                      Load more
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

History.Layout = Layout;
export default History;

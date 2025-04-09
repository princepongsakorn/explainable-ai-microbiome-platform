"use client";

import Layout from "@/components/common/Layout";
import {
  ArrowPathIcon,
  BarsArrowUpIcon,
  BarsArrowDownIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "react-modern-drawer/dist/index.css";
import {
  getExperimentsList,
  getExperimentsById,
  getRunById,
  putPublicModelByRunId,
  putUnPublicModelByRunId,
} from "../api/experiments";
import {
  IExperiment,
  IExperimentsRunResponse,
  IRun,
  IRunDetail,
} from "@/components/model/experiments.interface";
import relativeTime from "dayjs/plugin/relativeTime";
import Drawer from "react-modern-drawer";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

export function History() {
  const [experiments, setExperiments] = useState<IExperiment[]>();
  const [experimentsLoading, setExperimentsLoading] = useState<boolean>(true);
  const [selectedExperiments, setSelectedExperiments] = useState<IExperiment>();
  const [runs, setRuns] = useState<IExperimentsRunResponse>();
  const [runLoading, setRunLoading] = useState<boolean>(true);
  const [sort, setSort] = useState<{ key: string; order: string }>();
  const [isOpen, setIsOpen] = useState(false);
  const [runInfo, setRunInfo] = useState<IRunDetail>();

  useEffect(() => {
    const getExperiments = async () => {
      setExperimentsLoading(true);
      setRunLoading(true)
      const data = await getExperimentsList();
      const experiments = data.experiments;
      setExperimentsLoading(false)
      setExperiments(experiments);
      setSelectedExperiments(experiments[0]);
    };
    getExperiments();
  }, []);

  useEffect(() => {
    setRuns(undefined);
    setSort(undefined);
    getExperiment();
  }, [selectedExperiments]);

  useEffect(() => {
    const getExperimentsByIdAndSort = async () => {
      if (sort && selectedExperiments) {
        const orderBy = sort?.key ? `${sort?.key} ${sort?.order}` : "";
        const data = await getExperimentsById(
          selectedExperiments?.experiment_id,
          { pageToken: "", orderBy: orderBy }
        );
        setRuns(data);
      }
    };
    getExperimentsByIdAndSort();
  }, [sort]);

  const getExperiment = async () => {
    if (selectedExperiments) {
      const orderBy = sort?.key ? `${sort?.key} ${sort?.order}` : "";
      setRunLoading(true);
      const data = await getExperimentsById(
        selectedExperiments?.experiment_id,
        { pageToken: "", orderBy: orderBy }
      );
      setRunLoading(false)
      setRuns(data);
    }
  };

  const loadMoreHandle = async () => {
    if (selectedExperiments && runs?.nextPageToken) {
      const orderBy = sort?.key ? `${sort?.key} ${sort?.order}` : "";
      const data = await getExperimentsById(
        selectedExperiments?.experiment_id,
        { pageToken: runs?.nextPageToken, orderBy }
      );
      const runsLoadMore: IExperimentsRunResponse = {
        runs: [...runs.runs, ...data.runs],
        nextPageToken: data.nextPageToken,
      };
      setRuns(runsLoadMore);
    }
  };

  const handleSort = (col: string) => {
    if (sort?.key === col) {
      const order = sort.order === "DESC" ? "ASC" : "DESC";
      setSort({ key: col, order: order });
    } else {
      setSort({ key: col, order: "DESC" });
    }
  };

  const loadRunInfo = async (id: string) => {
    const run = await getRunById(id);
    if (run.run) {
      setRunInfo(run.run);
      setIsOpen(true);
    }
  };

  const publishModel = async (id?: string) => {
    if (id) {
      await putPublicModelByRunId(id);
    }
  };

  const unPublishModel = async (id?: string) => {
    if (id) {
      await putUnPublicModelByRunId(id);
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
              {experimentsLoading ? (
                <div>
                  <div role="status" className="max-w-sm animate-pulse">
                    {Array(8)
                      .fill("")
                      .map(() => (
                        <div className="h-3 bg-gray-200 rounded-full mb-4 mt-4" />
                      ))}
                  </div>
                </div>
              ) : (
                <tbody>
                  {experiments?.map((experiment) => (
                    <tr
                      className={`hover:bg-gray-50 cursor-pointer rounded-lg ${
                        experiment === selectedExperiments
                          ? "bg-blue-50"
                          : "bg-white"
                      }`}
                    >
                      <th
                        scope="row"
                        className="px-4 py-3 font-medium text-black rounded-lg whitespace-nowrap"
                        onClick={() => setSelectedExperiments(experiment)}
                      >
                        {experiment.name}
                      </th>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          <div className="flex flex-col flex-1 w-3/4">
            <div className="flex flex-row justify-between mt-2 mb-6 items-center">
              {experimentsLoading ? (
                <div role="status" className="w-[280px] animate-pulse">
                  <div className="h-4 bg-gray-300 rounded-full mb-4 mt-4" />
                </div>
              ) : (
                <div className="font-medium text-xl">
                  {selectedExperiments?.name}
                </div>
              )}
              <div className="flex flex-row gap-3">
                <div
                  className="flex flex-row gap-2 text-sm cursor-pointer px-4 py-2 rounded-full hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                  onClick={getExperiment}
                >
                  Refresh <ArrowPathIcon className="w-5" />
                </div>
              </div>
            </div>
            <div className="hide-scrollbar overflow-scroll pb-4 border-b-[1px] border-gray-200">
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
                        colSpan={3}
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
                    <th
                      scope="col"
                      className="px-6 py-3 font-medium border-b-[1px] border-gray-200"
                    >
                      User
                    </th>
                    {metricsHeaders.map((header) => (
                      <th
                        key={header}
                        className="font-medium whitespace-nowrap px-6 py-3 border-b-[1px] border-gray-200 cursor-pointer"
                        onClick={() => handleSort(`metrics.${header}`)}
                      >
                        <div className="flex flex-row gap-2">
                          {header}
                          {sort?.key === `metrics.${header}` ? (
                            sort?.order === "DESC" ? (
                              <BarsArrowUpIcon className="w-5" />
                            ) : (
                              <BarsArrowDownIcon className="w-5" />
                            )
                          ) : null}
                        </div>
                      </th>
                    ))}
                    {parametersHeaders.map((header) => (
                      <th
                        key={header}
                        className="font-medium whitespace-nowrap px-6 py-3 border-b-[1px] border-gray-200 cursor-pointer"
                        onClick={() => handleSort(`parameters.${header}`)}
                      >
                        <div className="flex flex-row gap-2">
                          {header}
                          {sort?.key === `parameters.${header}` ? (
                            sort?.order === "DESC" ? (
                              <BarsArrowDownIcon className="w-5" />
                            ) : (
                              <BarsArrowUpIcon className="w-5" />
                            )
                          ) : null}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                {runLoading ? (
                  <tbody>
                    {Array(10)
                      .fill("")
                      .map(() => (
                        <tr role="status" className="animate-pulse">
                          <th>
                            <div className="h-3 bg-gray-200 rounded-full w-3/4 mt-4"></div>
                          </th>
                          <th>
                            <div className="h-3 bg-gray-200 rounded-full w-3/4 mt-4"></div>
                          </th>
                          <th>
                            <div className="h-3 bg-gray-200 rounded-full w-3/4 mt-4"></div>
                          </th>
                          <th>
                            <div className="h-3 bg-gray-200 rounded-full w-3/4 mt-4"></div>
                          </th>
                        </tr>
                      ))}
                  </tbody>
                ) : (
                  <tbody>
                    {runs?.runs.map((run) => (
                      <tr
                        className="bg-white hover:bg-gray-50 text-black cursor-pointer border-b-[1px] border-gray-200"
                        onClick={() => loadRunInfo(run.info.run_id)}
                      >
                        <th
                          scope="row"
                          className="font-medium bg-white sticky left-[0] whitespace-nowrap border-b-[1px] border-gray-200"
                        >
                          <div className="px-4 py-4 border-r border-gray-200">
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
                        <th
                          scope="col"
                          className="px-4 py-2 font-normal whitespace-nowrap border-b-[1px] border-gray-200"
                        >
                          {run.info.user_id}
                        </th>
                        {metricsHeaders.map((header) => (
                          <td
                            key={header}
                            className={`px-4 py-2 border-b-[1px] border-gray-200 ${
                              sort?.key === `metrics.${header}`
                                ? "bg-blue-50"
                                : ""
                            }`}
                          >
                            {run.data.metrics[header] || "-"}
                          </td>
                        ))}
                        {parametersHeaders.map((header) => (
                          <td
                            key={header}
                            className={`px-4 py-2 border-b-[1px] border-gray-200 ${
                              sort?.key === `metrics.${header}`
                                ? "bg-blue-50"
                                : ""
                            }`}
                          >
                            {run.data.parameters[header] || "-"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                )}
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
        <Drawer
          open={isOpen}
          onClose={() => setIsOpen(false)}
          direction="right"
          className="shadow-2xs max-w-4xl overflow-y-auto"
          duration={150}
          size={"40vw"}
        >
          <div className="p-[40px] pt-[40px] overflow-y-auto">
            <div className="flex flex-row justify-between items-center">
              <p className="text-xl font-medium text-gray-800 mb-2">
                {runInfo?.info.run_name}
              </p>
              <div>
                {runInfo?.models[0].current_stage === "Production" ? (
                  <button
                    type="button"
                    className="focus:outline-none text-white bg-yellow-400 hover:bg-yellow-500 focus:ring-4 focus:ring-yellow-300 font-medium rounded-lg text-sm px-5 py-2.5"
                    onClick={() => unPublishModel(runInfo?.info.run_id)}
                  >
                    Unpublish Model
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 focus:outline-none"
                    onClick={() => publishModel(runInfo?.info.run_id)}
                  >
                    Publish Model
                  </button>
                )}
              </div>
            </div>
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              Run Information
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">User</p>
              <p>{runInfo?.info.user_id}</p>
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Created</p>
              <p>
                {dayjs(runInfo?.info.start_time).format("DD/MM/YYYY")} (
                {dayjs(runInfo?.info.start_time).fromNow()})
              </p>
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Duration</p>
              <p>
                {dayjs(runInfo?.info.end_time)
                  .diff(dayjs(runInfo?.info.start_time), "seconds", true)
                  .toFixed(1)}
                s
              </p>
            </div>
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              Model Information
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Name</p>
              <p>{runInfo?.models[0].name}</p>
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Version</p>
              <p>{runInfo?.models[0].version}</p>
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Current Stage</p>
              <p>
                {runInfo?.models[0].current_stage === "Production"
                  ? "Public"
                  : "Not Public"}
              </p>
            </div>
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              Model Metrics Information
            </div>
            {Object.keys(runInfo?.data.metrics ?? {}).map((metric) => {
              return (
                <div className="flex flex-row justify-between mb-3">
                  <p className="font-medium capitalize">
                    {metric.replaceAll("_", " ")}
                  </p>
                  <p>{runInfo?.data.metrics[metric]}</p>
                </div>
              );
            })}
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              Model Parameters Information
            </div>
            {Object.keys(runInfo?.data.parameters ?? {}).map((parameter) => {
              return (
                <div className="flex flex-row justify-between mb-3">
                  <p className="font-medium">{parameter}</p>
                  <p>{runInfo?.data.parameters[parameter]}</p>
                </div>
              );
            })}
          </div>
        </Drawer>
      </div>
    </>
  );
}

History.Layout = Layout;
export default History;

"use client";

import Layout from "@/components/common/Layout";
import {
  ArrowPathIcon,
  BarsArrowUpIcon,
  BarsArrowDownIcon,
  PencilSquareIcon,
  CheckIcon,
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
  postDescriptionExperiments,
} from "../api/experiments";
import {
  IExperiment,
  IExperimentsRunResponse,
  IRun,
  IRunDetail,
} from "@/components/model/experiments.interface";
import relativeTime from "dayjs/plugin/relativeTime";
import Drawer from "react-modern-drawer";
import { isEmpty, isNil } from "lodash";
import { Modal, Dropdown, Textarea } from "flowbite-react";
import { getModelsType } from "../api/model";
import { IModelType } from "@/components/model/model.interface";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

const PublishModal = (props: {
  isOpen: boolean;
  setIsOpen: any;
  onOk: (data: { model?: IModelType; description?: string }) => void;
  onCancel: any;
}) => {
  const [modelType, setModelType] = useState<IModelType[]>([]);
  const [selectedModelType, setSelectedModelType] = useState<IModelType>();
  const [description, setDescription] = useState<string>();

  useEffect(() => {
    const getType = async () => {
      const modalType = await getModelsType();
      setModelType(modalType);
    };
    getType();
  }, []);

  const onOK = () => {
    if (selectedModelType && description) {
      props.onOk({ model: selectedModelType, description });
      props.setIsOpen(false);
    }
  };

  const onCancel = () => {
    props.onCancel();
    props.setIsOpen(false);
  };

  return (
    <Modal
      theme={{
        header: {
          popup:
            "border-b dark:border-gray-300 border-gray-300 m-6 p-0 pb-4 mb-4",
          close: {
            icon: "text-2xl",
          },
        },
        content: {
          base: "relative h-full w-full md:w-[700px] p-4 md:h-1/2",
          inner:
            "relative flex max-h-[90dvh] flex-col rounded-lg bg-white shadow",
        },
        footer: {
          base: "flex items-center space-x-2 rounded-b border-t border-gray-200 p-6 justify-end",
        },
      }}
      show={props.isOpen}
      size="md"
      onClose={onCancel}
      className="z-[9999] bg-black/20"
      popup
    >
      <Modal.Header>Publish Model to Production</Modal.Header>
      <Modal.Body>
        <div className="pt-0">
          <div className="text-gray-500">
            You are about to publish this model and make it available for use.
            Please provide additional details before proceeding.
          </div>
          <div className="flex flex-col py-2 gap-2">
            <div className="font-medium text-md">Model Type</div>
            <Dropdown
              theme={{
                floating: {
                  target: `w-full justify-start font-medium border-gray-300 ${
                    selectedModelType ? "text-black" : "text-gray-500"
                  }`,
                },
              }}
              label={
                selectedModelType
                  ? `${selectedModelType.name} (${selectedModelType.description}) `
                  : "Select the prediction category"
              }
              arrowIcon={false}
              className="shadow-sm rounded-lg overflow-hidden dark:bg-white"
            >
              {modelType.map((model, index) => (
                <Dropdown.Item
                  onClick={() => setSelectedModelType(model)}
                  className={`flex flex-col items-start ${
                    index + 1 !== modelType.length
                      ? "border-b-[1px] border-[#EAEAEA]"
                      : ""
                  }`}
                >
                  <span className="text-sm font-medium text-black">
                    {model.name} ({model.description})
                  </span>
                </Dropdown.Item>
              ))}
            </Dropdown>
            <div className="font-medium text-md">Description</div>
            <Textarea
              style={{ resize: "none", height: 100 }}
              className="dark:border-gray-300 border-gray-300 bg-white"
              placeholder="Write a short description about this model’s purpose, training data, or usage instructions."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <div className="flex flex-row gap-4">
          <button
            type="button"
            className="py-2.5 px-5 text-sm font-medium text-gray-900 focus:outline-none bg-white rounded-lg border border-gray-200 hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-100"
            onClick={onCancel}
          >
            <div>Cancel</div>
          </button>
          <button
            type="button"
            className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5focus:outline-none"
            onClick={onOK}
          >
            <div>Publish Model</div>
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};
export function Experiments() {
  const [experiments, setExperiments] = useState<IExperiment[]>();
  const [experimentsLoading, setExperimentsLoading] = useState<boolean>(true);
  const [selectedExperiments, setSelectedExperiments] = useState<IExperiment>();
  const [runs, setRuns] = useState<IExperimentsRunResponse>();
  const [runLoading, setRunLoading] = useState<boolean>(true);
  const [sort, setSort] = useState<{ key: string; order: string }>();
  const [isOpen, setIsOpen] = useState(false);
  const [runInfo, setRunInfo] = useState<IRunDetail>();
  const [openModal, setOpenModal] = useState(false);

  // Description
  const [experimentsDescription, setExperimentsDescription] =
    useState<string>();
  const [isEditDescription, setIsEditDescription] = useState<boolean>(false);

  useEffect(() => {
    const getExperiments = async () => {
      setExperimentsLoading(true);
      setRunLoading(true);
      const data = await getExperimentsList();
      const experiments = data.experiments;
      setExperimentsLoading(false);
      setExperiments(experiments);
      setSelectedExperiments(experiments[0]);
    };
    getExperiments();
  }, []);

  useEffect(() => {
    setExperimentsDescription(selectedExperiments?.tags["mlflow.note.content"]);
    setIsEditDescription(false);
  }, [selectedExperiments]);

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
      setRunLoading(false);
      setRuns(data);
    }
  };

  const updateDescriptionExperiments = async () => {
    if (selectedExperiments) {
      setIsEditDescription(false);
      await postDescriptionExperiments(
        selectedExperiments?.experiment_id,
        experimentsDescription
      );
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

  const publishModel = async (
    id: string,
    data: { model?: IModelType; description?: string }
  ) => {
    if (id) {
      await putPublicModelByRunId(id, data);
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
                  <div className="h-4 bg-gray-300 rounded-full mb-2 mt-4" />
                  <div className="h-3 bg-gray-300 w-3/4 rounded-full mb-4 mt-2" />
                </div>
              ) : (
                <div className="w-3/4">
                  <div className="font-medium text-xl">
                    {selectedExperiments?.name}
                  </div>
                  {isEditDescription ? (
                    <div className="flex flex-row items-center gap-2">
                      <input
                        id="description"
                        className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        placeholder="Add Description"
                        value={experimentsDescription}
                        onChange={(e) =>
                          setExperimentsDescription(e.target.value)
                        }
                      />
                      <div
                        className="flex flex-row cursor-pointer items-center"
                        onClick={updateDescriptionExperiments}
                      >
                        <CheckIcon className="text-gray-800 w-5" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-row items-center">
                      <div className={"text-gray-800"}>
                        {experimentsDescription}
                      </div>
                      <div
                        className="flex flex-row cursor-pointer items-center"
                        onClick={() => setIsEditDescription(true)}
                      >
                        <div className="text-gray-400 mr-2">
                          {isEmpty(experimentsDescription) && "Add Description"}
                        </div>
                        <PencilSquareIcon className="text-gray-500 w-5" />
                      </div>
                    </div>
                  )}
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
                          {run.info.user_name}
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
                {runInfo?.models?.[0]?.current_stage === "Production" ? (
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
                    onClick={() => setOpenModal(true)}
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
              <p>{runInfo?.info.user_name}</p>
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
              <p>{runInfo?.models[0]?.name}</p>
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Version</p>
              <p>{runInfo?.models[0]?.version}</p>
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Current Stage</p>
              <p>
                {runInfo?.models[0]?.current_stage === "Production"
                  ? "Public"
                  : "Not Public"}
              </p>
            </div>
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              Model Metrics Information
            </div>
            <table className="w-full table-auto border-collapse">
              <tbody>
                {Object.keys(runInfo?.data.metrics ?? {}).map((metric) => (
                  <tr key={metric} className="border-b">
                    <td className="font-medium capitalize py-2">
                      {metric.replaceAll("_", " ")}
                    </td>
                    <td className="py-2 text-right">
                      {runInfo?.data.metrics[metric]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              Model Parameters Information
            </div>
            <table className="w-full table-auto border-collapse">
              <tbody>
                {Object.keys(runInfo?.data.parameters ?? {}).map(
                  (parameter) => {
                    return (
                      <tr key={parameter} className="border-b">
                        <td className="font-medium capitalize py-2">
                          {parameter}
                        </td>
                        <td className="py-2 text-right">
                          {runInfo?.data.parameters[parameter]}
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>
        </Drawer>
        <PublishModal
          key={runInfo?.info.run_id}
          isOpen={openModal}
          setIsOpen={setOpenModal}
          onCancel={() => {}}
          onOk={(data) => publishModel(runInfo?.info.run_id ?? "", data)}
        />
      </div>
    </>
  );
}

Experiments.Layout = Layout;
export default Experiments;

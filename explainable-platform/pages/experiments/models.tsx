"use client";

import Layout from "@/components/common/Layout";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { IModelInfo, IPredictions } from "@/components/model/model.interface";
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
import {
  getExperimentsList,
  getExperimentsById,
  putUnPublicModelByRunId,
  getExperimentsModelList,
} from "../api/experiments";
import {
  IExperiment,
  IExperimentsRunResponse,
  IRegisteredModelLatestVersions,
  IRun,
  RegisteredModel,
} from "@/components/model/experiments.interface";
import relativeTime from "dayjs/plugin/relativeTime";
import { getModelsList } from "../api/model";

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

export function History() {
  const [models, setModels] = useState<IRegisteredModelLatestVersions[]>();
  const getModels = async () => {
    const resp = await getExperimentsModelList();
    const model = resp.registered_models
      .map((model) => {
        const productionVersion = Array.isArray(model.latest_versions)
          ? model.latest_versions.find((v) => v.current_stage === "Production")
          : null;
        return productionVersion || null;
      })
      .filter((v) => v !== null);
    console.log(model);
    setModels(model);
  };

  useEffect(() => {
    getModels();
  }, []);

  // const getAllMetricsKeys = (models?: RegisteredModel[]) => {
  //   if (models) {
  //     const keys = new Set<string>();
  //     models.forEach((model) => {
  //       Object.keys(model.metrics).forEach((key) => keys.add(key));
  //     });
  //     return Array.from(keys);
  //   }
  //   return [];
  // };

  const unPublishModel = async (id?: string) => {
    if (id) {
      await putUnPublicModelByRunId(id);
    }
  };

  // const metricsHeaders = getAllMetricsKeys(models);

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="flex flex-row justify-between items-center">
          <div className="text-xl font-medium">Registered Models</div>
          <div className="flex flex-row gap-3">
            <div
              className="flex flex-row gap-2 text-sm cursor-pointer px-4 py-2 rounded-full hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
              onClick={getModels}
            >
              Refresh <ArrowPathIcon className="w-5" />
            </div>
          </div>
        </div>
        <div
          style={{ height: "calc(100vh - 180px)" }}
          className="mt-4 pt-8 border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full flex flex-row gap-6 overflow-hidden"
        >
          <div className="w-full hide-scrollbar overflow-scroll border-b-[1px] border-gray-200">
            <table
              style={{ maxHeight: "calc(100vh - 280px)" }}
              className="w-full text-sm text-left rtl:text-right text-gray-500 border-separate border-spacing-0"
            >
              <thead className="text-gray-700 bg-gray-50 z-[1] sticky top-[0]">
                {/* {metricsHeaders.length > 0 ? (
                  <tr className="border-solid border-y-[1px] border-gray-200">
                    <th
                      className="px-6 py-3 bg-gray-50 border-y-[1px] border-gray-200"
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
                    <th className="px-6 py-3 bg-gray-50 border-y-[1px] border-gray-200"></th>
                  </tr>
                ) : (
                  <></>
                )} */}
                <tr className="">
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium bg-gray-50 border-b-[1px] border-gray-200"
                  >
                    Model Name
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium border-b-[1px] border-gray-200"
                  >
                    Production
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium border-b-[1px] border-gray-200"
                  >
                    Created
                  </th>
                  {/* {metricsHeaders.map((header) => (
                    <th
                      key={header}
                      className="font-medium whitespace-nowrap px-6 py-3 border-b-[1px] border-gray-200"
                    >
                      <div className="flex flex-row gap-2">{header}</div>
                    </th>
                  ))} */}
                  <th
                    scope="col"
                    className="px-6 py-3 font-medium border-b-[1px] border-gray-200"
                  ></th>
                </tr>
              </thead>
              <tbody>
                {models?.map((model) => (
                  <tr className="bg-white hover:bg-gray-50 text-black cursor-pointer border-b-[1px] border-gray-200">
                    <td
                      scope="row"
                      className="font-medium whitespace-nowrap border-b-[1px] border-gray-200"
                    >
                      <div className="px-4 py-4 border-r border-gray-300">
                        {model.name}
                      </div>
                    </td>
                    <td
                      scope="col"
                      className="px-4 py-2 font-normal whitespace-nowrap border-b-[1px] border-gray-200"
                    >
                      Version {model.version}
                    </td>
                    <td
                      scope="col"
                      className="px-4 py-2 font-normal whitespace-nowrap border-b-[1px] border-gray-200"
                    >
                      {dayjs(model.creation_timestamp)
                        .tz("Asia/Bangkok")
                        .format("DD-MM-YYYY HH:mm")}
                    </td>
                    {/* {metricsHeaders.map((header) => (
                      <td
                        key={header}
                        className={`px-4 py-2 border-b-[1px] border-gray-200`}
                      >
                        {model.metrics[header] || "-"}
                      </td>
                    ))} */}
                    <td className={`px-4 py-2 border-b-[1px] border-gray-200`}>
                      {/* <button
                        type="button"
                        className="focus:outline-none text-white bg-yellow-400 hover:bg-yellow-500 focus:ring-4 focus:ring-yellow-300 font-medium rounded-lg text-sm px-5 py-2.5"
                        onClick={() => unPublishModel(model.run_id)}
                      >
                        Unpublish Model
                      </button> */}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

History.Layout = Layout;
export default History;

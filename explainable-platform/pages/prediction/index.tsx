"use client";

import Layout from "@/components/common/Layout";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
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

dayjs.extend(utc);
dayjs.extend(timezone);

export function History() {
  const router = useRouter();
  const [predictions, setPredictions] = useState<IPagination<IPredictions>>();
  const [isOpen, setIsOpen] = useState(false);
  const [selectPrediction, setSelectPrediction] = useState<IPredictions>();
  const currentPage = Number(router.query.page) || 1;

  const onHandleChangePage = (page: number) => {
    router.query.page = page?.toString();
    const queryString = queryToString(router.query);
    router.push(`?${queryString}`, undefined, { shallow: true });
  };

  const onViewAll = (id?: string) => {
    if (id) {
      const params = { id };
      const queryString = queryToString(params);
      router.push(`prediction/local/?${queryString}`, undefined, {
        shallow: true,
      });
    }
  };

  useEffect(() => {
    const getPredictionsRecordList = async () => {
      const params: IPaginationRequestParams = {
        page: currentPage,
      };
      const data = await getPredictions(params);
      setPredictions(data);
    };
    getPredictionsRecordList();
  }, []);

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
                      {prediction.id}
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
        className="shadow-2xs max-w-2xl overflow-y-auto"
        duration={150}
        size={"60vw"}
      >
        <div className="p-[40px] pt-[40px] overflow-y-auto">
          <div className="flex flex-row justify-between items-center">
            <p className="text-xl font-medium text-gray-800">
              {selectPrediction?.id}
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
          <div className="flex flex-col mb-3 mt-3 ">
            <div>
              <div className="font-medium">Beeswarm plot</div>
            </div>
            <div className="text-sm py-2 text-gray-500">
              This SHAP beeswarm plot visualizes the impact of each feature on
              the model’s predictions. Each dot represents an individual SHAP
              value, with color indicating the original feature value. The
              distribution of points shows both the magnitude and direction of
              each feature’s effect, highlighting the most influential drivers
              in the dataset.
            </div>
            <ShapPlotPlaceholder
              src={selectPrediction?.beeswarm}
              plotName="Beeswarm plot"
              showShapLabel
            />
          </div>
          <div className="flex flex-col mb-3 mt-3 border-t-[1px] border-[#EAEAEA] pt-3">
            <div className="font-medium">Heatmap plot</div>
            <div className="text-sm py-2 text-gray-500">
              This SHAP heatmap clusters data points based on their explanation
              profiles, not raw feature values. The color intensity shows each
              feature’s contribution to the model’s predictions, revealing
              distinct subpopulations within the dataset.
            </div>
            <ShapPlotPlaceholder
              src={selectPrediction?.heatmap}
              plotName="Heatmap plot"
              showShapLabel
            />
          </div>
        </div>
      </Drawer>
    </>
  );
}

History.Layout = Layout;
export default History;

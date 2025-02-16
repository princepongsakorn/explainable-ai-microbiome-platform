"use client";

import Layout from "@/components/common/Layout";
import {
  ArrowRightIcon,
  InformationCircleIcon,
} from "@heroicons/react/outline";
import { ChangeEvent, useEffect, useState } from "react";
import Papa from "papaparse";
import { getModelsList } from "./api/model";
import {
  IMetrics,
  IModelInfo,
  IPredictions,
  IPredictResponse,
} from "@/components/model/model.interface";
import Drawer from "react-modern-drawer";
import { getPredictions } from "./api/predict";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import "react-modern-drawer/dist/index.css";

dayjs.extend(utc);
dayjs.extend(timezone);

export function History() {
  const [predictions, setPredictions] = useState<IPredictions[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectPrediction, setSelectPrediction] = useState<IPredictions>();

  useEffect(() => {
    const getPredictionsList = async () => {
      const data = await getPredictions();
      setPredictions(data);
    };
    getPredictionsList();
  }, []);

  return (
    <>
      <div className="p-8 justify-items-center">
        <div className="p-4 pt-0 overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] max-w-5xl rounded-md w-4/5">
          <div className="text-xl my-4">Prediction</div>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm text-left rtl:text-right text-gray-500">
              <thead className="text-gray-700 bg-gray-50">
                <tr className="">
                  <th
                    scope="col"
                    className="font-medium rounded-l-lg px-6 py-3"
                  >
                    Id
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
                {predictions.map((prediction) => (
                  <tr
                    className="bg-white border-b border-gray-200 hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      setIsOpen(true), setSelectPrediction(prediction);
                    }}
                  >
                    <th
                      scope="row"
                      className="px-6 py-4 font-medium text-black whitespace-nowrap"
                    >
                      {prediction.id}
                    </th>
                    <td className="text-black px-6 py-4">
                      {prediction.modelName}
                    </td>
                    <td className="text-black px-6 py-4">
                      {prediction.records.total}
                    </td>
                    <td className="text-black px-6 py-4">
                      {dayjs(prediction.createdAt)
                        .tz("Asia/Bangkok")
                        .format("DD-MM-YYYY HH:mm")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <div className="p-[60px] overflow-y-auto">
          <p className="text-xl font-medium text-gray-800">
            {selectPrediction?.id}
          </p>
          <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
            General Information
          </div>
          <div className="flex flex-row justify-between mb-3">
            <p className="font-bold">Model</p>
            <p>{selectPrediction?.modelName}</p>
          </div>
          <div className="flex flex-row justify-between">
            <p className="font-bold">Created At</p>
            <p>
              {dayjs(selectPrediction?.createdAt)
                .tz("Asia/Bangkok")
                .format("DD-MM-YYYY HH:mm")}
            </p>
          </div>
          <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
            Beeswarm plot
          </div>
          <div className="flex flex-row justify-between mb-3 mt-3">
            <img src={selectPrediction?.beeswarm} />
          </div>
          <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
            Heatmap plot
          </div>
          <div className="flex flex-row justify-between mb-3 mt-3">
            <img src={selectPrediction?.heatmap} />
          </div>
        </div>
      </Drawer>
    </>
  );
}

History.Layout = Layout;
export default History;

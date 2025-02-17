import Layout from "@/components/common/Layout";
import { useEffect, useState } from "react";
import {
  IPredictionRecords,
  PredictionClass,
  PredictionStatus,
} from "@/components/model/model.interface";
import { getPredictionRecords } from "../api/predict";
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
import { isNull } from "lodash";
import { ArrowPathIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";

dayjs.extend(utc);
dayjs.extend(timezone);

function usePredictionClass(): PredictionClass {
  const router = useRouter();
  const { class: queryClass } = router.query;

  if (
    typeof queryClass === "string" &&
    Object.values(PredictionClass).includes(queryClass as PredictionClass)
  ) {
    return queryClass as PredictionClass;
  }

  return PredictionClass.ALL;
}

const StatusBox = (status?: PredictionStatus) => {
  switch (status) {
    case PredictionStatus.SUCCESS:
      return (
        <div className="w-fit px-4 py-2 rounded-full font-medium text-xs bg-blue-100 text-blue-800 items-center">
          <div className="justify-center flex gap-2 items-center">
            <div className="w-1 h-1 bg-blue-800 rounded-full" />
            <div>{status}</div>
          </div>
        </div>
      );
    case PredictionStatus.ERROR:
      return (
        <div className="w-fit px-4 py-2 rounded-full font-medium text-xs bg-red-100 text-red-800 items-center">
          <div className="justify-center flex gap-2 items-center">
            <div className="w-1 h-1 bg-red-800 rounded-full" />
            <div>{status}</div>
          </div>
        </div>
      );
    default:
      return (
        <div className="w-fit px-4 py-2 rounded-full font-medium text-xs bg-gray-100 text-gray-800 items-center">
          <div className="justify-center flex gap-2 items-center">
            <div className="w-1 h-1 bg-black rounded-full" />
            <div>{PredictionStatus.PENDING}</div>
          </div>
        </div>
      );
  }
};

export function History() {
  const router = useRouter();
  const [predictions, setPredictions] =
    useState<IPagination<IPredictionRecords>>();

  const predictionClass = usePredictionClass();
  const predictionId = router.query.id as string;
  const currentPage = Number(router.query.page) || 1;

  const onHandleChangePage = (page: number) => {
    const params = { id: predictionId, page: page, class: predictionClass };
    const queryString = queryToString(params);
    router.replace(`?${queryString}`, undefined, { shallow: true });
  };

  const onHandleChangeClass = (_class: PredictionClass) => {
    const params = { id: predictionId, page: 1, class: _class };
    const queryString = queryToString(params);
    router.replace(`?${queryString}`, undefined, { shallow: true });
  };

  const getPredictionsList = async () => {
    if (predictionId) {
      const params: IPaginationRequestParams = {
        page: currentPage,
        class: predictionClass,
      };
      const data = await getPredictionRecords(predictionId, params);
      setPredictions(data);
    }
  };

  useEffect(() => {
    getPredictionsList();
  }, []);

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="text-xl flex flex-row gap-2">
          <div
            className="cursor-pointer text-gray-500 px-2"
            onClick={() => router.back()}
          >
            <ChevronLeftIcon className="w-6" />
          </div>
          <div>
            <div className="font-medium">Prediction: {predictionId}</div>
            <div className="text-base text-gray-500">Model: simple-crc</div>
          </div>
        </div>
        <div className="mt-6 pt-4 overflow-hidden border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full">
          <div className="mb-4 flex flex-row justify-between">
            <ul className="flex flex-wrap text-sm font-medium text-center text-gray-500">
              <li className="me-2">
                <a
                  onClick={() => onHandleChangeClass(PredictionClass.ALL)}
                  className={`cursor-pointer inline-block px-6 py-2 rounded-full ${
                    predictionClass === PredictionClass.ALL
                      ? "text-white bg-blue-600"
                      : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                  }`}
                  aria-current="page"
                >
                  All
                </a>
              </li>
              <li className="me-2">
                <a
                  onClick={() => onHandleChangeClass(PredictionClass.POSITIVE)}
                  className={`cursor-pointer inline-block px-4 py-2 rounded-full ${
                    predictionClass === PredictionClass.POSITIVE
                      ? "text-white bg-blue-600"
                      : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                  }`}
                >
                  Positive
                </a>
              </li>
              <li className="me-2">
                <a
                  onClick={() => onHandleChangeClass(PredictionClass.NEGATIVE)}
                  className={`cursor-pointer inline-block px-4 py-2 rounded-full ${
                    predictionClass === PredictionClass.NEGATIVE
                      ? "text-white bg-blue-600"
                      : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                  }`}
                >
                  Negative
                </a>
              </li>
            </ul>
            <div
              className="flex flex-row gap-2 text-sm cursor-pointer px-4 py-2 rounded-full hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
              onClick={getPredictionsList}
            >
              Refresh <ArrowPathIcon className="w-5" />
            </div>
          </div>
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
                    Probability
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Class
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Predict At
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Status
                  </th>
                  <th
                    scope="col"
                    className="font-medium rounded-r-lg px-6 py-3"
                  ></th>
                </tr>
              </thead>
              <tbody>
                {predictions?.items.map((prediction) => (
                  <tr className="bg-white hover:bg-gray-50 cursor-pointer">
                    <th
                      scope="row"
                      className="px-6 py-5 font-medium text-black whitespace-nowrap"
                    >
                      {prediction.id}
                    </th>
                    <td className="text-black px-6 py-5">
                      {!isNull(prediction.proba)
                        ? `${(Number(prediction.proba) * 100).toFixed(1)}%`
                        : "-"}
                    </td>
                    <td className="text-black px-6 py-5">
                      {!isNull(prediction.class)
                        ? prediction.class === 0
                          ? "Unlikely to have condition"
                          : "Likely to have condition"
                        : "-"}
                    </td>
                    <td className="text-black px-6 py-5">
                      {/* {dayjs(prediction.createdAt)
                        .tz("Asia/Bangkok")
                        .format("DD-MM-YYYY HH:mm")} */}
                    </td>
                    <td className="text-black px-6 py-5">
                      {StatusBox(prediction.status)}
                    </td>
                    <td className="text-black px-6 py-5 underline font-medium">
                      View
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
    </>
  );
}

History.Layout = Layout;
export default History;

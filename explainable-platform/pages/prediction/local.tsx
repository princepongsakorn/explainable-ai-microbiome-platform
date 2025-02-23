import Layout from "@/components/common/Layout";
import { useCallback, useEffect, useState } from "react";
import {
  IPredictionRecords,
  PredictionClass,
  PredictionStatus,
} from "@/components/model/model.interface";
import {
  getPredictionRecords,
  postCancelPredict,
  postRePredict,
} from "../api/predict";
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
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  EllipsisHorizontalIcon,
} from "@heroicons/react/24/outline";
import { Popover } from "flowbite-react";
import Drawer from "react-modern-drawer";
import { ShapPlotPlaceholder } from "@/components/ui/ImageEmpty/ImageEmpty";

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

function usePredictionStatus(): PredictionStatus {
  const router = useRouter();
  const { status: queryStatus } = router.query;

  if (
    typeof queryStatus === "string" &&
    Object.values(PredictionStatus).includes(queryStatus as PredictionStatus)
  ) {
    return queryStatus as PredictionStatus;
  }

  return PredictionStatus.ALL;
}

const StatusBox = (status?: PredictionStatus) => {
  switch (status) {
    case PredictionStatus.SUCCESS:
      return (
        <div className="w-fit px-4 py-2 rounded-full font-medium text-xs bg-green-100 text-green-800 items-center">
          <div className="justify-center flex gap-2 items-center">
            <div className="w-1 h-1 bg-green-800 rounded-full" />
            <div>SUCCESS</div>
          </div>
        </div>
      );
    case PredictionStatus.ERROR:
      return (
        <div className="w-fit px-4 py-2 rounded-full font-medium text-xs bg-red-100 text-red-800 items-center">
          <div className="justify-center flex gap-2 items-center">
            <div className="w-1 h-1 bg-red-800 rounded-full" />
            <div>ERROR</div>
          </div>
        </div>
      );
    case PredictionStatus.IN_PROGRESS:
      return (
        <div className="w-fit px-4 py-2 rounded-full font-medium text-xs bg-blue-100 text-blue-800 items-center">
          <div className="justify-center flex gap-2 items-center">
            <div className="w-1 h-1 bg-blue-800 rounded-full" />
            <div>IN PROGRESS</div>
          </div>
        </div>
      );
    default:
      return (
        <div className="w-fit px-4 py-2 rounded-full font-medium text-xs bg-gray-100 text-gray-800 items-center">
          <div className="justify-center flex gap-2 items-center">
            <div className="w-1 h-1 bg-black rounded-full" />
            <div>PENDING</div>
          </div>
        </div>
      );
  }
};

const DataTable = (props: { selectPrediction: IPredictionRecords }) => {
  const selectPrediction = props.selectPrediction;
  const [filter, setFilter] = useState("");

  const filteredColumnIndices = selectPrediction?.dfColumns
    ?.map((col, index) => ({ col, index }))
    .filter(({ col }) => col.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="flex flex-row justify-between items-center bg-gray-50 px-4 py-2 rounded-lg my-4">
        <div className="font-bold ">Data</div>
        <div>
          <div className="w-60">
            <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none"></div>
            <input
              type="text"
              id="col-search"
              className="bg-gray-10 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full"
              placeholder="Search columns..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left rtl:text-right text-gray-500 w-full">
          <thead className="text-gray-700 bg-gray-50 ">
            <tr className="">
              {filteredColumnIndices?.map(({ col, index }) => (
                <th
                  key={`col-${col}-${index}`}
                  scope="col"
                  className={`font-medium px-6 py-3 whitespace-nowrap italic`}
                >
                  {col.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="">
              {filteredColumnIndices?.map(({ index }) => (
                <td
                  key={`row-${index}`}
                  scope="row"
                  className="px-6 py-5 font-medium text-black whitespace-nowrap"
                >
                  {selectPrediction.dfData?.[index] || "-"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
};

export function History() {
  const router = useRouter();
  const [predictions, setPredictions] =
    useState<IPagination<IPredictionRecords>>();
  const [isOpen, setIsOpen] = useState(false);
  const [selectPrediction, setSelectPrediction] =
    useState<IPredictionRecords>();

  const predictionClass = usePredictionClass();
  const predictionStatus = usePredictionStatus();
  const predictionId = router.query.id as string;
  const currentPage = Number(router.query.page) || 1;

  const onHandleChangePage = (page: number) => {
    const params = { id: predictionId, page: page, class: predictionClass };
    const queryString = queryToString(params);
    router.replace(`?${queryString}`, undefined, { shallow: true });
  };

  const onHandleChangeClass = (_class: PredictionClass) => {
    const params = {
      id: predictionId,
      page: 1,
      class: _class,
      status: predictionStatus,
    };
    const queryString = queryToString(params);
    router.replace(`?${queryString}`, undefined, { shallow: true });
  };

  const onHandleChangeStatus = (status: PredictionStatus) => {
    const params = {
      id: predictionId,
      page: 1,
      class: predictionClass,
      status,
    };
    const queryString = queryToString(params);
    router.replace(`?${queryString}`, undefined, { shallow: true });
  };

  const getPredictionsList = async () => {
    if (predictionId) {
      const params: IPaginationRequestParams = {
        page: currentPage,
        class: predictionClass,
        status: predictionStatus,
      };
      const data = await getPredictionRecords(predictionId, params);
      setPredictions(data);
    }
  };

  const onRepredict = async () => {
    await postRePredict(predictionId);
  };

  const onCancel = async () => {
    await postCancelPredict(predictionId);
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
            <div className="flex flex-row gap-4">
              <ul className="flex flex-wrap gap-2 text-sm font-medium text-center text-gray-500">
                <li>
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
                <li>
                  <a
                    onClick={() =>
                      onHandleChangeClass(PredictionClass.POSITIVE)
                    }
                    className={`cursor-pointer inline-block px-4 py-2 rounded-full ${
                      predictionClass === PredictionClass.POSITIVE
                        ? "text-white bg-blue-600"
                        : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                    }`}
                  >
                    Positive
                  </a>
                </li>
                <li>
                  <a
                    onClick={() =>
                      onHandleChangeClass(PredictionClass.NEGATIVE)
                    }
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
              <div className="w-[1px] h-full bg-gray-200" />
              <ul className="flex flex-wrap gap-2 text-sm font-medium text-center text-gray-500">
                <li>
                  <a
                    onClick={() => onHandleChangeStatus(PredictionStatus.ALL)}
                    className={`cursor-pointer inline-block px-4 py-2 rounded-full ${
                      predictionStatus === PredictionStatus.ALL
                        ? "text-white bg-blue-600"
                        : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                    }`}
                  >
                    All
                  </a>
                </li>
                <li>
                  <a
                    onClick={() =>
                      onHandleChangeStatus(PredictionStatus.SUCCESS)
                    }
                    className={`cursor-pointer inline-block px-4 py-2 rounded-full ${
                      predictionStatus === PredictionStatus.SUCCESS
                        ? "text-white bg-blue-600"
                        : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                    }`}
                  >
                    Success
                  </a>
                </li>
                <li>
                  <a
                    onClick={() =>
                      onHandleChangeStatus(PredictionStatus.PENDING)
                    }
                    className={`cursor-pointer inline-block px-4 py-2 rounded-full ${
                      predictionStatus === PredictionStatus.PENDING
                        ? "text-white bg-blue-600"
                        : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                    }`}
                  >
                    Pending
                  </a>
                </li>
                <li>
                  <a
                    onClick={() =>
                      onHandleChangeStatus(PredictionStatus.IN_PROGRESS)
                    }
                    className={`cursor-pointer inline-block px-4 py-2 rounded-full ${
                      predictionStatus === PredictionStatus.IN_PROGRESS
                        ? "text-white bg-blue-600"
                        : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                    }`}
                  >
                    In progress
                  </a>
                </li>
                <li>
                  <a
                    onClick={() => onHandleChangeStatus(PredictionStatus.ERROR)}
                    className={`cursor-pointer inline-block px-6 py-2 rounded-full ${
                      predictionStatus === PredictionStatus.ERROR
                        ? "text-white bg-blue-600"
                        : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                    }`}
                    aria-current="page"
                  >
                    Error
                  </a>
                </li>
                <Popover
                  aria-labelledby="default-popover"
                  arrow={false}
                  className="outline-none bg-white border-[1px] border-[#EAEAEA] rounded-md shadow-sm"
                  content={
                    <div className="w-60 text-sm text-gray-500 p-2 text-left">
                      <div
                        className="px-3 py-2 hover:text-gray-900 hover:bg-gray-100 rounded-md cursor-pointer"
                        onClick={onRepredict}
                      >
                        <p>Re-run all failed jobs</p>
                      </div>
                      <div
                        className="px-3 py-2 hover:text-gray-900 hover:bg-gray-100 rounded-md cursor-pointer"
                        onClick={onCancel}
                      >
                        <p className="text-red-500">
                          Cancel all in-progress jobs
                        </p>
                      </div>
                    </div>
                  }
                >
                  <div className="p-2 rounded-full hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA] cursor-pointer">
                    <EllipsisHorizontalIcon className="w-5" />{" "}
                  </div>
                </Popover>
              </ul>
            </div>
            <div className="flex flex-row gap-3">
              <div
                className="flex flex-row gap-2 text-sm cursor-pointer px-4 py-2 rounded-full hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                onClick={getPredictionsList}
              >
                Refresh <ArrowPathIcon className="w-5" />
              </div>
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
                    Classification
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Predict At
                  </th>
                  <th
                    scope="col"
                    className="font-medium rounded-r-lg px-6 py-3"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {(predictions?.items?.length ?? 0) > 0 ? (
                  predictions?.items.map((prediction) => (
                    <tr
                      className="bg-white hover:bg-gray-50"
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
                        {!isNull(prediction.proba)
                          ? `${(Number(prediction.proba) * 100).toFixed(1)}%`
                          : "-"}
                      </td>
                      <td className="text-black px-6 py-5">
                        {!isNull(prediction.class)
                          ? prediction.class === 0
                            ? "Probability of negative class"
                            : "Probability of positive class"
                          : "-"}
                      </td>
                      <td className="text-black px-6 py-5">
                        -
                        {/* {dayjs(prediction.createdAt)
                        .tz("Asia/Bangkok")
                        .format("DD-MM-YYYY HH:mm")} */}
                      </td>
                      <td className="text-black px-6 py-5">
                        {StatusBox(prediction.status)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <th colSpan={5}>
                      <div className="flex my-2 h-[500px] w-full items-center justify-center bg-gray-50 text-gray-500 flex flex-col text-sm font-medium rounded-lg">
                        <div className="mb-4">
                          <svg
                            width="60"
                            height="60"
                            viewBox="0 0 130 122"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              fill-rule="evenodd"
                              clip-rule="evenodd"
                              d="M104.927 2.45155C106.478 0.340821 109.446 -0.113245 111.557 1.43736C113.667 2.98797 114.121 5.95607 112.571 8.0668L106.795 15.929C105.244 18.0397 102.276 18.4938 100.166 16.9431C98.0548 15.3925 97.6008 12.4244 99.1514 10.3137L104.927 2.45155ZM109.425 4.33862C108.917 3.96513 108.202 4.0745 107.828 4.58291L102.053 12.4451C101.679 12.9535 101.789 13.6684 102.297 14.0419C102.805 14.4154 103.52 14.306 103.894 13.7976L109.67 5.93544C110.043 5.42704 109.934 4.71211 109.425 4.33862ZM19.4082 49.0359C19.4082 25.9805 38.0983 7.29048 61.1536 7.29048C84.209 7.29048 102.899 25.9805 102.899 49.0359C102.899 72.0913 84.209 90.7813 61.1536 90.7813C38.0983 90.7813 19.4082 72.0913 19.4082 49.0359ZM61.1536 3.69048C36.1101 3.69048 15.8082 23.9923 15.8082 49.0359C15.8082 74.0795 36.1101 94.3813 61.1536 94.3813C69.3864 94.3813 77.1068 92.1873 83.7619 88.3521L89.6476 94.2378C89.4794 96.7392 90.3512 99.2974 92.2632 101.209L110.425 119.371C113.939 122.885 119.638 122.885 123.152 119.371L127.068 115.455C130.583 111.94 130.583 106.241 127.068 102.727L108.907 84.5654C106.995 82.653 104.436 81.7812 101.934 81.9499L96.9101 76.9261C102.919 69.2339 106.499 59.553 106.499 49.0359C106.499 23.9923 86.1972 3.69048 61.1536 3.69048ZM98.0319 83.139L94.5754 79.6825C92.2734 82.1917 89.6925 84.4408 86.8818 86.3809L90.8362 90.3353C91.2203 89.6727 91.696 89.0486 92.2632 88.4814L96.1792 84.5654C96.7461 83.9985 97.3698 83.5231 98.0319 83.139ZM81.9657 43.586C82.8549 43.1414 83.2153 42.0602 82.7707 41.171C82.3261 40.2819 81.2449 39.9215 80.3558 40.3661L66.2329 47.4275C65.6231 47.7324 65.2379 48.3557 65.2379 49.0375C65.2379 49.7192 65.6231 50.3425 66.2329 50.6474L80.3558 57.7088C81.2449 58.1534 82.3261 57.793 82.7707 56.9039C83.2153 56.0147 82.8549 54.9335 81.9657 54.4889L71.0628 49.0375L81.9657 43.586ZM39.5348 41.171C39.0902 42.0602 39.4506 43.1414 40.3398 43.586L51.2427 49.0375L40.3398 54.4889C39.4506 54.9335 39.0902 56.0147 39.5348 56.9039C39.9794 57.793 41.0606 58.1534 41.9497 57.7088L56.0726 50.6474C56.6824 50.3425 57.0676 49.7192 57.0676 49.0375C57.0676 48.3557 56.6824 47.7324 56.0726 47.4275L41.9497 40.3661C41.0606 39.9215 39.9794 40.2819 39.5348 41.171ZM31.1768 49.0354C31.1768 32.4799 44.5977 19.059 61.1532 19.059C77.7087 19.059 91.1295 32.4799 91.1295 49.0354C91.1295 65.5909 77.7087 79.0118 61.1532 79.0118C44.5977 79.0118 31.1768 65.5909 31.1768 49.0354ZM61.1532 15.459C42.6094 15.459 27.5768 30.4917 27.5768 49.0354C27.5768 67.5791 42.6094 82.6118 61.1532 82.6118C79.6969 82.6118 94.7295 67.5791 94.7295 49.0354C94.7295 30.4917 79.6969 15.459 61.1532 15.459ZM124.918 19.8855C124.121 17.3903 121.453 16.0131 118.958 16.8093L109.664 19.775C107.169 20.5711 105.792 23.2393 106.588 25.7344C107.384 28.2295 110.052 29.6068 112.547 28.8106L121.841 25.8449C124.337 25.0487 125.714 22.3806 124.918 19.8855ZM120.053 20.2389C120.654 20.0471 121.296 20.3788 121.488 20.9798C121.68 21.5808 121.348 22.2235 120.747 22.4153L111.453 25.381C110.852 25.5728 110.209 25.241 110.018 24.64C109.826 24.039 110.158 23.3964 110.759 23.2046L120.053 20.2389ZM3.53005 75.8245C1.01556 76.5572 -0.428846 79.1896 0.303879 81.7041C1.03661 84.2186 3.669 85.663 6.18349 84.9303L15.5496 82.201C18.0641 81.4683 19.5085 78.8359 18.7758 76.3214C18.0431 73.8069 15.4107 72.3625 12.8962 73.0952L3.53005 75.8245ZM3.76013 80.697C3.58364 80.0913 3.93155 79.4572 4.53721 79.2807L13.9033 76.5514C14.509 76.375 15.143 76.7229 15.3195 77.3285C15.496 77.9342 15.1481 78.5682 14.5425 78.7447L5.17634 81.474C4.57068 81.6505 3.93662 81.3026 3.76013 80.697ZM13.052 100.582C10.9812 98.9789 10.6025 96.0003 12.2061 93.9295L18.1792 86.2162C19.7828 84.1454 22.7614 83.7667 24.8322 85.3703C26.903 86.9738 27.2817 89.9525 25.6781 92.0233L19.705 99.7366C18.1014 101.807 15.1228 102.186 13.052 100.582ZM15.0524 96.1337C14.6662 96.6324 14.7574 97.3499 15.2562 97.7362C15.755 98.1224 16.4724 98.0312 16.8587 97.5324L22.8318 89.8191C23.218 89.3203 23.1268 88.6028 22.628 88.2166C22.1293 87.8303 21.4118 87.9216 21.0255 88.4203L15.0524 96.1337Z"
                              fill="rgb(107 114 128)"
                            />
                          </svg>
                        </div>
                        <div>No records found.</div>
                      </div>
                    </th>
                  </tr>
                )}
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
        <Drawer
          open={isOpen}
          onClose={() => setIsOpen(false)}
          direction="right"
          className="shadow-2xs max-w-4xl overflow-y-auto"
          duration={150}
          size={"60vw"}
        >
          <div className="p-[40px] pt-[40px]">
            <div className="flex flex-row justify-between items-center">
              <p className="text-xl font-medium text-gray-800">
                {selectPrediction?.id}
              </p>
            </div>
            {selectPrediction?.status === PredictionStatus.ERROR && (
              <>
                <div className="font-bold bg-red-50 px-4 py-2 rounded-lg my-4 text-red-700">
                  Error
                </div>
                <div className="flex flex-row justify-between mb-6">
                  <p className="font-medium text-red-700">
                    {selectPrediction.errorMsg ?? "Unknown error occurred"}
                  </p>
                </div>
              </>
            )}
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              General Information
            </div>
            <div className="flex flex-row justify-between mb-3">
              <p className="font-medium">Probability</p>
              <p>
                {!isNull(selectPrediction?.proba)
                  ? `${(Number(selectPrediction?.proba) * 100).toFixed(1)}%`
                  : "-"}
              </p>
            </div>
            <div className="flex flex-row justify-between">
              <p className="font-medium">Classification </p>
              <p>
                {!isNull(selectPrediction?.class)
                  ? selectPrediction?.class === 0
                    ? "Probability of negative class"
                    : "Probability of positive class"
                  : "-"}
              </p>
            </div>
            <div className="font-bold bg-gray-50 px-4 py-2 rounded-lg my-4">
              Waterfall plot
            </div>
            <div className="flex flex-col mb-3 mt-3 ">
              <div className="text-sm pb-3 text-gray-500">
                This SHAP waterfall plot illustrates how each factor (listed on
                the left) influences the predicted outcome. Blue bars indicate a
                decrease in the likelihood of disease, while red bars indicate
                an increase. By summing these contributions, you can see which
                factors drive the final prediction, offering a clear
                interpretation of the model’s decision.
              </div>
              <ShapPlotPlaceholder
                src={selectPrediction?.waterfall}
                plotName="Waterfall plot"
                showShapLabel
              />
            </div>
            {selectPrediction?.dfColumns && selectPrediction?.dfData && (
              <DataTable
                selectPrediction={selectPrediction}
                key={selectPrediction.id}
              />
            )}
          </div>
        </Drawer>
      </div>
    </>
  );
}

History.Layout = Layout;
export default History;

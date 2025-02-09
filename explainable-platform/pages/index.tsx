import Layout from "@/components/common/Layout";
import {
  ArrowRightIcon,
  InformationCircleIcon,
} from "@heroicons/react/outline";
import { ChangeEvent, useEffect, useState } from "react";
import Papa from "papaparse";
import { getModelsList, postModelPredict } from "./api/model";
import {
  IMetrics,
  IModelInfo,
  IPredictions,
  IPredictResponse,
} from "@/components/model/model.interface";
import { Dropdown } from "flowbite-react";

const PlotLoading = () => {
  const getRandomNumber = (min = 80, max = 200) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };
  return (
    <div
      role="status"
      className="mt-4 animate-pulse border-solid bg-white border-[1px] border-[#EAEAEA] rounded-md max-w-4xl w-4/5 p-4"
    >
      <div className="w-full p-4 mx-auto">
        <div className="h-2.5 bg-gray-200 rounded-full w-32 mb-2.5"></div>
        <div className="w-48 h-2 mb-10 bg-gray-200 rounded-full"></div>

        <div className="space-y-3">
          {Array(8)
            .fill(0)
            .map((_, index) => (
              <div key={index} className="flex items-center space-x-2">
                <div className="justify-items-end w-[200px]">
                  <div
                    style={{ width: getRandomNumber() }}
                    className={`h-4 bg-gray-200 animate-pulse rounded`}
                  ></div>
                </div>

                <div className="flex flex-1">
                  <div
                    style={{
                      width: `${getRandomNumber(10, 20)}%`,
                      marginLeft: `${(8 - index) * 10}%`,
                    }}
                    className="h-6 bg-gray-200 animate-pulse rounded"
                  ></div>
                </div>
              </div>
            ))}
        </div>

        <div className="mt-4 w-full flex">
          <div className={`w-[200px]`} />
          <div className="flex flex-1 justify-between">
            {Array(4)
              .fill(0)
              .map((_, index) => (
                <div
                  key={index}
                  className="h-3 w-10 bg-gray-200 animate-pulse rounded"
                ></div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryPlot = (props: { heatmap?: string; beeswarm?: string }) => {
  enum SummaryType {
    Heatmap = "Heatmap",
    Beeswarm = "Beeswarm",
  }
  const [selected, setSelected] = useState<SummaryType>(SummaryType.Beeswarm);

  return (
    <div className="overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] rounded-md w-full mb-8">
      <div className="flex flex-row gap-4 items-center border-solid bg-white border-b-[1px] border-[#EAEAEA] w-full mb-4 p-4 justify-between">
        <div className="font-xl font-semibold text-black">Summary</div>
        <div className="inline-flex rounded-md shadow-xs" role="group">
          {Object.values(SummaryType).map((type, index) => (
            <button
              key={type}
              type="button"
              className={`inline-flex items-center px-4 py-2 text-sm font-medium border border-gray-200 hover:text-blue-700 ${
                index === 0 ? "rounded-s-lg" : "border-l-[0px] rounded-e-lg"
              } ${
                type === selected
                  ? "text-blue-700 bg-white"
                  : "text-gray-900 bg-[#F2F4F7]"
              }`}
              onClick={() => setSelected(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="ml-4 flex flex-row gap-4">
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#FF0051]" />
            <p>Positive</p>
          </div>
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#008BFB]" />
            <p>Negative</p>
          </div>
        </div>
        <img
          src={`data:image/png;base64,${
            selected === SummaryType.Heatmap ? props.heatmap : props.beeswarm
          }`}
        />
      </div>
    </div>
  );
};

const PredictionPlot = (props: { prediction: IPredictions }) => {
  return (
    <div className="overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] rounded-md w-full mb-8">
      <div className="flex flex-row gap-4 items-center border-solid bg-white border-b-[1px] border-[#EAEAEA] w-full mb-4 p-4">
        <div className="font-xl font-semibold text-black">
          Subject {props.prediction.id}
        </div>
        <div className="h-[32px] border-solid border-l-[1px] border-[#EAEAEA] " />
        <div>
          <div className="font-semibold text-black">
            Prediction Probability: {(props.prediction.proba * 100).toFixed(1)}%{" "}
          </div>
          <div className="text-[#667085]">
            {props.prediction.class === 0
              ? "Unlikely to have condition"
              : "Likely to have condition"}
          </div>
        </div>
      </div>
      <div>
        <div className="ml-4 flex flex-row gap-4">
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#FF0051]" />
            <p>Positive</p>
          </div>
          <div className="flex flex-row gap-1 items-center">
            <div className="w-2 h-2 rounded-full bg-[#008BFB]" />
            <p>Negative</p>
          </div>
        </div>
        <img src={`data:image/png;base64,${props.prediction.plot.waterfall}`} />
      </div>
    </div>
  );
};
export function Home() {
  const [models, setModelName] = useState<IModelInfo[]>([]);
  const [process, setProcess] = useState<number>(0);
  const [csv, setCsv] = useState<any[]>();
  const [model, setModel] = useState<IModelInfo>();
  const [responseBody, setResponseBody] = useState<IPredictResponse>();
  const [isPloting, setIsPloting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const getModels = async () => {
      const data = await getModelsList();
      setModelName(data);
    };
    getModels();
  }, []);

  const getMetrics = (metrics: IMetrics) => {
    const metric: string[] = [];
    if (metrics.accuracy) {
      metric.push(`Accuracy: ${metrics.accuracy * 100}%`);
    }
    if (metrics.roc_auc) {
      metric.push(`Auc: ${metrics.roc_auc}`);
    }
    return metric.join(" / ");
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    if (event?.target?.files?.length) {
      Papa.parse(event.target.files[0], {
        complete: async (result) => {
          setCsv(result?.data);
        },
      });
    }
  };

  const handleSubmit = async () => {
    if (csv && model) {
      try {
        const csvData = csv;
        const headers = csvData[0].slice(1);
        const data = csvData.slice(1);
        const numericData = data.map((row) =>
          row.slice(1).map((cell: any) => parseFloat(cell) || 0)
        );
        const payload = {
          dataframe_split: {
            columns: headers,
            data: numericData,
          },
        };

        setResponseBody(undefined);
        setIsLoading(true);
        setIsPloting(false);
        setProcess(0);

        const predictData = await postModelPredict(
          model.model_name,
          payload,
          (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 0)
            );
            setProcess(percent);
            if (percent === 100) {
              setIsPloting(true);
            }
          }
        );
        setIsLoading(false);
        setIsPloting(false);
        setResponseBody(predictData);
      } catch (err) {
        setIsLoading(false);
        setResponseBody(undefined);
      }
    }
  };

  return (
    <div className="p-8 justify-items-center">
      <div
        className={`overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] max-w-5xl rounded-md w-4/5`}
      >
        <div className="w-full px-[34px] pt-[30px] pb-[24px]">
          <div className="flex flex-row gap-5 w-full">
            <div className="flex flex-1 gap-2">
              <div className="w-2/3">
                <input
                  className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-white focus:outline-none"
                  id="file_input"
                  type="file"
                  onChange={handleFileSelect}
                  disabled={isLoading}
                />
              </div>
              <Dropdown
                theme={{
                  floating: {
                    target: "items-center font-medium border-gray-300",
                  },
                }}
                label={
                  model
                    ? `${model.model_name} v.${model.version} `
                    : "Choose a model"
                }
                arrowIcon={false}
                className="shadow-sm rounded-lg overflow-hidden"
              >
                {models.map((model, index) => (
                  <Dropdown.Item
                    onClick={() => setModel(model)}
                    className={`flex flex-col items-start ${
                      index + 1 !== models.length
                        ? "border-b-[1px] border-[#EAEAEA]"
                        : ""
                    }`}
                  >
                    <span className="text-sm font-medium text-black">
                      {model.model_name} v.{model.version}
                    </span>
                    <span className="text-sm text-gray-500">
                      {getMetrics(model.metrics)}
                    </span>
                  </Dropdown.Item>
                ))}
              </Dropdown>
            </div>
            <div>
              <button
                type="button"
                className="text-gray-900 bg-white border border-gray-300 focus:outline-none hover:bg-gray-100 focus:ring-4 focus:ring-gray-100 font-medium rounded-lg text-sm px-5 py-2.5"
                disabled={isLoading}
                onClick={handleSubmit}
              >
                <ArrowRightIcon className="w-5" />
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-gray-500" id="file_input_help">
            Only <span className="font-semibold text-black">.csv files</span>{" "}
            are supported. Please ensure your data is formatted correctly.
          </p>
        </div>
        <div
          style={{ width: `${process}%` }}
          className={`transition-width duration-300 ease-in-out bg-[#5448DE] h-[2px] ${
            isLoading ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      {isPloting ? (
        <>
          <PlotLoading />
          <PlotLoading />
        </>
      ) : (
        <div className="max-w-4xl w-4/5">
          {responseBody?.summary && (
            <>
              <div className="border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full my-4" />
              <SummaryPlot
                heatmap={responseBody?.summary.heatmap}
                beeswarm={responseBody?.summary.beeswarm}
              />
            </>
          )}
          {responseBody?.predictions.map((prediction) => (
            <PredictionPlot prediction={prediction} />
          ))}
        </div>
      )}
    </div>
  );
}

Home.Layout = Layout;
export default Home;

import Layout from "@/components/common/Layout";
import { ArrowRightIcon } from "@heroicons/react/outline";
import { ChangeEvent, useEffect, useState } from "react";
import Papa from "papaparse";
import {
  getModelsList,
  LocalExplanationPrediction,
  postModelPredict,
} from "./api/model";

export function Home() {
  const [modelsName, setModelName] = useState<string[]>([]);
  const [process, setProcess] = useState<number>(0);
  const [csv, setCsv] = useState<any[]>();
  const [model, setModel] = useState<string>("");
  const [responseBody, setResponseBody] = useState<
    LocalExplanationPrediction[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const getModels = async () => {
      const data = await getModelsList();
      setModelName(data.models);
    };
    getModels();
  }, []);

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
        const headers = csvData[0];
        const data = csvData.slice(1);
        const numericData = data.map((row) =>
          row.map((cell: any) => parseFloat(cell) || 0)
        );
        const payload = {
          dataframe_split: {
            columns: headers,
            data: numericData.filter((row) => row.length === headers.length),
          },
        };
        setResponseBody([]);
        setIsLoading(true);
        setProcess(0);

        const predictData = await postModelPredict(
          model,
          payload,
          (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 0)
            );
            setProcess(percent);
          }
        );

        setIsLoading(false);
        setResponseBody(predictData.local_explanation_predictions);
      } catch (err) {
        setIsLoading(false);
        setResponseBody([]);
      }
    }
  };

  return (
    <div className="p-8 justify-items-center">
      <div
        className={`overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] max-w-4xl rounded-md w-4/5`}
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
              <div>
                <select
                  id="model-select"
                  className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                  disabled={isLoading || modelsName.length === 0}
                  defaultValue={"none"}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="none">Choose a model</option>
                  {modelsName.map((model) => (
                    <option value={model}>{model}</option>
                  ))}
                </select>
              </div>
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
      <div className="max-w-4xl w-4/5">
        <div className="border-solid bg-white border-t-[1px] border-[#EAEAEA] w-full my-4" />
        {responseBody?.map((resp) => (
          <div className="overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] rounded-md w-full">
            <div className="flex flex-row gap-4 items-center border-solid bg-white border-b-[1px] border-[#EAEAEA] w-full mb-4 p-4">
              <div className="font-xl font-semibold text-black">Subject Id 90112</div>
              <div className="h-[32px] border-solid border-l-[1px] border-[#EAEAEA] "/>
              <div>
                <div className="font-semibold text-black">
                  Prediction Probability: {(resp.pred_proba * 100).toFixed(1)}%{" "}
                </div>
                <div className="text-[#667085]">
                  {resp.pred_class === 0
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
              <img src={`data:image/png;base64,${resp.plot}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Home.Layout = Layout;
export default Home;

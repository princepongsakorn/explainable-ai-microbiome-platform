import Layout from "@/components/common/Layout";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { ChangeEvent, useEffect, useState } from "react";
import { getModelsList } from "../api/model";
import {
  ICreatePredictions,
  IMetrics,
  IModelInfo,
  IProductionModelInfo,
} from "@/components/model/model.interface";
import { Dropdown } from "flowbite-react";
import { postModelPredict } from "../api/predict";
import { Modal } from "flowbite-react";
import { useRouter } from "next/router";
import { queryToString } from "../utils/queryToString";
import { isNull, isUndefined } from "lodash";

const UploadModal = (props: {
  isOpen: boolean;
  setIsOpen: any;
  onOk: any;
  onCancel: any;
}) => {
  const onOK = () => {
    props.onOk();
    props.setIsOpen(false);
  };

  const onCancel = () => {
    props.onCancel();
    props.setIsOpen(false);
  };

  return (
    <Modal
      theme={{
        content: {
          base: "relative h-full w-full md:w-[500px] p-4 md:h-1/2",
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
      <Modal.Header />
      <Modal.Body>
        <div className="px-2">
          <div className="text-center font-medium text-lg mb-4">
            Upload Successful & Prediction Created
          </div>
          <div className="text-center text-gray-500">
            Your file has been successfully uploaded, and a prediction request
            has been created. You may proceed to the results page or continue
            uploading additional files.
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <div className="flex flex-row gap-4">
          <button
            type="button"
            className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5focus:outline-none"
            onClick={onOK}
          >
            <div>View Prediction</div>
          </button>
          <button
            type="button"
            className="py-2.5 px-5 text-sm font-medium text-gray-900 focus:outline-none bg-white rounded-lg border border-gray-200 hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-100"
            onClick={onCancel}
          >
            <div>Close</div>
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

const SelectModelModal = (props: {
  models: IProductionModelInfo[];
  selectedModel?: IProductionModelInfo;
  isOpen: boolean;
  setIsOpen: any;
  onOk: (model?: IProductionModelInfo) => void;
  onCancel: () => void;
}) => {
  const [selectedModelType, setSelectedModelType] = useState<string | null>();
  const [selectedModel, setSelectedModel] = useState<IProductionModelInfo>();
  const getModelTypes = Array.from(
    new Set(
      props.models
        .map((m) => m.description.model)
        .filter((model): model is string => !!model)
    )
  );

  useEffect(() => {
    setSelectedModel(props.selectedModel);
    setSelectedModelType(getModelTypes[0]);
  }, [props.models]);

  const getMetrics = (metrics: IMetrics) => {
    const metric: string[] = [];
    if (metrics.accuracy) {
      metric.push(`Accuracy: ${(Number(metrics.accuracy) * 100).toFixed(2)}%`);
    }
    if (metrics.roc_auc) {
      metric.push(`Auc: ${metrics.roc_auc}`);
    }
    return metric.join(" / ");
  };

  const onOK = () => {
    props.onOk(selectedModel);
  };

  const onCancel = () => {
    props.onCancel();
  };

  return (
    <Modal
      theme={{
        content: {
          base: "relative h-full w-full md:w-[1000px] p-4 md:h-1/2",
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
      <Modal.Header className="p-4 pb-0">Choose a Model</Modal.Header>
      <Modal.Body className="p-4">
        <div className="">
          <div className="flex flex-col w-full">
            <ul className="pb-4 flex flex-wrap gap-2 text-sm font-medium text-center text-gray-500">
              {getModelTypes.map((modelType) => (
                <li>
                  <a
                    onClick={() => setSelectedModelType(modelType)}
                    className={`cursor-pointer inline-block px-6 py-2 rounded-full ${
                      selectedModelType === modelType
                        ? "text-white bg-blue-600"
                        : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                    }`}
                    aria-current="page"
                  >
                    {modelType}
                  </a>
                </li>
              ))}
              <li>
                <a
                  onClick={() => setSelectedModelType(null)}
                  className={`cursor-pointer inline-block px-6 py-2 rounded-full ${
                    selectedModelType === null
                      ? "text-white bg-blue-600"
                      : "hover:text-gray-900 hover:bg-gray-100 border-[1px] border-[#EAEAEA]"
                  }`}
                  aria-current="page"
                >
                  Other
                </a>
              </li>
            </ul>
            <table className="w-full text-sm text-left rtl:text-right text-gray-500">
              <thead className="text-gray-700 bg-gray-50 ">
                <tr className="">
                  <th
                    scope="col"
                    className="font-medium rounded-l-lg px-6 py-3"
                  >
                    Model
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Description
                  </th>
                  <th scope="col" className="font-medium px-6 py-3">
                    Metrics
                  </th>
                </tr>
              </thead>
              <tbody>
                {props.models
                  .filter(
                    (model) => model.description.model === selectedModelType
                  )
                  .map((model) => (
                    <tr
                      className={`${
                        selectedModel?.run_id === model.run_id
                          ? "bg-gray-100 hover:bg-gray-200"
                          : "bg-white hover:bg-gray-100"
                      } cursor-pointer`}
                      onClick={() => {
                        setSelectedModel(model);
                      }}
                    >
                      <th
                        scope="row"
                        className="px-6 py-5 font-medium text-black whitespace-nowrap"
                      >
                        {model.name} v.{model.version}
                      </th>
                      <td className="text-black px-6 py-5">
                        {model.description.description || "-"}
                      </td>
                      <td className="text-black px-6 py-5">
                        {getMetrics(model.metrics)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <div className="flex flex-row gap-4">
          <button
            type="button"
            className={`text-white bg-blue-700 ${
              isUndefined(selectedModel) ? "opacity-50" : "hover:bg-blue-800"
            } focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 focus:outline-none`}
            onClick={onOK}
            disabled={isUndefined(selectedModel)}
          >
            <div>Confirm</div>
          </button>
          <button
            type="button"
            className="py-2.5 px-5 text-sm font-medium text-gray-900 focus:outline-none bg-white rounded-lg border border-gray-200 hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-100"
            onClick={onCancel}
          >
            <div>Close</div>
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};
export function Home() {
  const router = useRouter();
  const [key, setKey] = useState<string>(Math.random().toString(36));
  const [models, setModelName] = useState<IProductionModelInfo[]>([]);
  const [model, setModel] = useState<IProductionModelInfo>();
  const [process, setProcess] = useState<number>(0);
  const [csv, setCsv] = useState<File>();
  const [predictData, setPredictData] = useState<ICreatePredictions>();

  const [isLoading, setIsLoading] = useState(false);
  const [openUploadModal, setOpenUploadModal] = useState(false);
  const [openModelModal, setOpenModelModal] = useState(false);

  useEffect(() => {
    const getModels = async () => {
      const data = await getModelsList();
      setModelName(data);
    };
    getModels();
  }, []);

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    if (event?.target?.files?.length) {
      setCsv(event.target.files[0]);
    }
  };

  const handleSubmit = async () => {
    if (csv && model) {
      try {
        setIsLoading(true);
        setProcess(0);
        const predictData = await postModelPredict(
          csv,
          model.name,
          (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 0)
            );
            setProcess(percent);
          }
        );
        setOpenUploadModal(true);
        setPredictData(predictData);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
      }
    }
  };

  const onModalCancel = () => {
    setKey(Math.random().toString(36));
    setPredictData(undefined);
    setCsv(undefined);
    setModel(undefined);
  };

  const onModalOk = () => {
    const id = predictData?.predictionId;
    if (id) {
      const params = { id };
      const queryString = queryToString(params);
      router.push(`prediction/local/?${queryString}`, undefined, {
        shallow: true,
      });
    }
  };

  return (
    <div className="pt-8 justify-items-center">
      <div
        className={`overflow-hidden border-solid bg-white border-[1px] border-[#EAEAEA] max-w-5xl rounded-md w-4/5`}
        key={key}
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
                  accept=".csv"
                />
              </div>
              <div
                className="px-[18px] content-center border-gray-300 text-black text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-white"
                onClick={() => setOpenModelModal(true)}
              >
                {model ? `${model.name} v.${model.version} ` : "Choose a model"}
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
      <SelectModelModal
        models={models}
        selectedModel={model}
        isOpen={openModelModal}
        setIsOpen={setOpenModelModal}
        onCancel={() => {
          setOpenModelModal(false);
        }}
        onOk={(model) => {
          setModel(model);
          setOpenModelModal(false);
        }}
      />
      <UploadModal
        isOpen={openUploadModal}
        setIsOpen={setOpenUploadModal}
        onCancel={onModalCancel}
        onOk={onModalOk}
      />
    </div>
  );
}

Home.Layout = Layout;
export default Home;

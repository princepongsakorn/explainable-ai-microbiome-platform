import Layout from "@/components/common/Layout";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { ChangeEvent, useEffect, useState } from "react";
import { getModelsList } from "../api/model";
import {
  ICreatePredictions,
  IMetrics,
  IModelInfo,
} from "@/components/model/model.interface";
import { Dropdown } from "flowbite-react";
import { postModelPredict } from "../api/predict";
import { Modal } from "flowbite-react";
import { useRouter } from "next/router";
import { queryToString } from "../utils/queryToString";

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
export function Home() {
  const router = useRouter();
  const [key, setKey] = useState<string>(Math.random().toString(36));
  const [models, setModelName] = useState<IModelInfo[]>([]);
  const [process, setProcess] = useState<number>(0);
  const [csv, setCsv] = useState<File>();
  const [model, setModel] = useState<IModelInfo>();
  const [isLoading, setIsLoading] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [predictData, setPredictData] = useState<ICreatePredictions>();

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
          model.model_name,
          (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / (progressEvent.total ?? 0)
            );
            setProcess(percent);
          }
        );
        setOpenModal(true)
        setPredictData(predictData);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
      }
    }
  };

  const onModalCancel = () => {
    setKey(Math.random().toString(36))
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
              <Dropdown
                theme={{
                  floating: {
                    target:
                      "items-center font-medium border-gray-300 text-black",
                  },
                }}
                label={
                  model
                    ? `${model.model_name} v.${model.version} `
                    : "Choose a model"
                }
                arrowIcon={false}
                className="shadow-sm rounded-lg overflow-hidden dark:bg-white"
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
      <UploadModal
        isOpen={openModal}
        setIsOpen={setOpenModal}
        onCancel={onModalCancel}
        onOk={onModalOk}
      />
    </div>
  );
}

Home.Layout = Layout;
export default Home;

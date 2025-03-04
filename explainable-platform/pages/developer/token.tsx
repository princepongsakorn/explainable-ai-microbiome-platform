import Layout from "@/components/common/Layout";
import { WhiteButton } from "@/components/ui/Button/Button";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { getMLFlowTrackingUri } from "../api/mlflow";

export function Tokens() {
  const [token, setToken] = useState<{ username: string; token: string }>();
  const [mlflowUrl, setMlflowUrl] = useState<string>();

  useEffect(() => {
    const getURL = async () => {
      const uri = await getMLFlowTrackingUri();
      setMlflowUrl(uri.url);
    };
    getURL();
    setToken({
      username: "pongsakorn@outlook.com",
      token: "ghp_7oouPsXCxIoADV7hs1F1BgoYTJGAOb1Cnxzv",
    });
  }, []);

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="mb-8">
          <div className="flex flex-row justify-between items-center">
            <div className="text-xl font-medium">
              Tokens for Deploying Models with MLflow
            </div>
          </div>

          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full gap-6 overflow-hidden">
            <div className="text-gray-500">
              The tokens generated here can be used to authenticate and deploy
              machine learning models via MLflow.
            </div>
            <div className="mt-4">
              <div className="flex flex-rows mt-2 gap-4">
                <div>
                  <div>Username</div>
                  <div className="mt-2 py-2 px-4 border-[1px] border-[#EAEAEA] bg-gray-50 w-[400px] rounded-md">
                    {token?.username}
                  </div>
                </div>
                <div>
                  <div>Access tokens</div>
                  <div className="mt-2 py-2 px-4 border-[1px] border-[#EAEAEA] bg-gray-50 w-[500px] rounded-md">
                    {token?.token}
                  </div>
                </div>
                <div className="content-end">
                  <WhiteButton>
                    <div className="flex flex-rows gap-2">
                      <ArrowPathIcon className="w-5" />
                      Generate new token
                    </div>
                  </WhiteButton>
                </div>
              </div>
            </div>
            <div>
              <div className="mt-4">MLflow Tracking URI</div>
              <div className="mt-2 py-2 px-4 border-[1px] border-[#EAEAEA] bg-gray-50 w-[800px] rounded-md">
                {mlflowUrl}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Tokens.Layout = Layout;
export default Tokens;

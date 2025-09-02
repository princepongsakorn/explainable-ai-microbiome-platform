import Layout from "@/components/common/Layout";
import { WhiteButton } from "@/components/ui/Button/Button";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { generateMLFlowToken, getMLFlowToken, getMLFlowTrackingUri } from "../api/mlflow";
import { CodeBlock } from "react-code-block";
import { EXCodeBlock } from "@/components/ui/CodeBlock/CodeBlock";

export function Tokens() {
  const [token, setToken] = useState<{ user: string; token?: string }>();
  const [mlflowUrl, setMlflowUrl] = useState<string>();
  
  useEffect(() => {
    const getURL = async () => {
      const uri = await getMLFlowTrackingUri();
      setMlflowUrl(uri.url);
    };
    const getToken = async () => {
      const token = await getMLFlowToken();
      setToken(token);
    };
    getToken();
    getURL();
  }, []);

  const generateToken = async () => {
    const token = await generateMLFlowToken()
    setToken(token)
  }

  const mlflowCode = `
import mlflow

# Set up MLflow authentication (Place this at the top of your script)
os.environ['MLFLOW_TRACKING_USERNAME'] = "${token?.user ?? 'your-username'}"
os.environ['MLFLOW_TRACKING_PASSWORD'] = "your-access-token"
mlflow.set_tracking_uri("${mlflowUrl}")

# Your MLflow operations go here...
  `;

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="mb-8">
          <div className="flex flex-row justify-between items-center">
            <div className="text-xl font-medium">
              Tokens for Deploying Models with MLflow
            </div>
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full gap-6">
            <div className="text-gray-500">
              Keep your token secure and do not expose it in public
              repositories. If compromised, revoke and regenerate a new one.
            </div>
            <div className="mt-4">
              <div className="flex flex-rows mt-2 gap-4">
                <div>
                  <div>Username</div>
                  <div className="mt-2 py-2 px-4 border-[1px] border-[#EAEAEA] bg-gray-50 w-[400px] rounded-md">
                    {token?.user}
                  </div>
                </div>
                <div>
                  <div>Access tokens</div>
                  <div className="mt-2 py-2 px-4 border-[1px] border-[#EAEAEA] bg-gray-50 w-[500px] rounded-md">
                    {token?.token ?? "-"}
                  </div>
                </div>
                <div className="content-end">
                  <WhiteButton onClick={generateToken}>
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
          <div className="mt-8 text-xl font-medium">
            Using Your Token in a Python Script
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full gap-6">
            <div className="text-gray-500">
              To authenticate MLflow and enable model deployment, include your
              Username, Access Token, and MLflow Tracking URI at the top of your
              Python script. This ensures that your script can securely connect
              to MLflow services.
            </div>
            <div className="mt-4">
              <EXCodeBlock code={mlflowCode} language={"python"} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Tokens.Layout = Layout;
export default Tokens;

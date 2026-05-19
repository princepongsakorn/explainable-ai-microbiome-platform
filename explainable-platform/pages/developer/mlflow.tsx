import Layout from "@/components/common/Layout";
import { useEffect, useState } from "react";
import { getMLFlowToken, getMLFlowTrackingUri } from "../api/mlflow";
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

  const installCode = `pip install mlflow-explainable`;

  const setupCode = `import os
import mlflow
import pandas as pd
from sklearn.model_selection import train_test_split

# Authenticate against the MLflow tracking server
os.environ['MLFLOW_TRACKING_USERNAME'] = "${token?.user ?? 'your-username'}"
os.environ['MLFLOW_TRACKING_PASSWORD'] = "your-access-token"
mlflow.set_tracking_uri("${mlflowUrl ?? 'https://your-mlflow-host'}")

# Load sample CRC data
sample_url = "https://raw.githubusercontent.com/ryzary/shapmat/refs/heads/cv_notebook/data/sample.csv"
sample_crc = pd.read_csv(sample_url, index_col=0)

X = sample_crc.drop(['CRC'], axis=1)
y = sample_crc['CRC']
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)`;

  const rfCode = `from sklearn.ensemble import RandomForestClassifier
from mlflow_explainable import log_explainable_model

model = RandomForestClassifier().fit(X_train, y_train)

with mlflow.start_run():
    mlflow.log_metric("accuracy", model.score(X_test, y_test))
    log_explainable_model(
        model,
        X_train,
        registered_name="sample-rf-crc",
    )`;

  const gbCode = `from sklearn.ensemble import GradientBoostingClassifier
from mlflow_explainable import log_explainable_model

model = GradientBoostingClassifier().fit(X_train, y_train)

with mlflow.start_run():
    log_explainable_model(
        model,
        X_train,
        registered_name="sample-gb-crc",
    )`;

  const xgbCode = `import xgboost as xgb
from mlflow_explainable import log_explainable_model

model = xgb.XGBClassifier(eval_metric="logloss").fit(X_train, y_train)

with mlflow.start_run():
    log_explainable_model(
        model,
        X_train,
        registered_name="sample-xgboost-crc",
        extra_pip_requirements=["xgboost"],
    )`;

  const torchCode = `from mlflow_explainable import log_explainable_model

# GCNTabularWrapper is your own callable that exposes .predict_proba(X)
wrapper = GCNTabularWrapper(gcn, edge_index, device, feature_names)

with mlflow.start_run():
    mlflow.log_metric("accuracy", acc)
    log_explainable_model(
        wrapper,
        X_train,
        registered_name="sample-gcn-crc",
        explainer_kwargs={"algorithm": "permutation"},
        extra_pip_requirements=["torch", "torch_geometric"],
    )`;

  const loadCode = `import mlflow

loaded = mlflow.pyfunc.load_model(model_uri)
impl   = loaded._model_impl.python_model    # ExplainableModel instance

# 1) standard pyfunc predict — returns DataFrame[Y_proba, Y_class]
result = loaded.predict(X)

# 2) SHAP explanation — uniform shape across all explainer types
explanation = impl.shap_explain(X)
# explanation["values"]      shape (n, n_features) or (n, n_features, n_classes)
# explanation["base_values"] shape ()              or (n_classes,) or (n, n_classes)
# explanation["data"]        shape (n, n_features)`;

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="mb-8">
          <div className="mt-8 text-xl font-medium">
            Deploying Your Model with MLflow Explainable
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full gap-6">
            <div className="text-gray-500">
              Use the <code className="font-mono text-gray-700">mlflow-explainable</code>{" "}
              package to log a predictor and its SHAP explainer as a single{" "}
              <code className="font-mono text-gray-700">mlflow.pyfunc</code>{" "}
              artifact. The serving runtime never needs to know whether the
              underlying model is a scikit-learn estimator, an XGBoost booster,
              or a custom torch network — every artifact exposes the same{" "}
              <code className="font-mono text-gray-700">predict</code> /{" "}
              <code className="font-mono text-gray-700">shap_explain</code>{" "}
              contract.
            </div>
          </div>

          <div className="mt-8 text-lg font-medium">Installation</div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full">
            <EXCodeBlock code={installCode} language={"bash"} />
          </div>

          <div className="mt-8 text-lg font-medium">
            Authenticate and load training data
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full">
            <div className="text-gray-500 mb-4">
              Authenticate with your access token and point MLflow at your
              tracking URI before any training run. The snippets below assume
              this block has already executed.
            </div>
            <EXCodeBlock
              lines={["7:9"]}
              code={setupCode}
              language={"python"}
            />
          </div>

          <div className="mt-8 text-lg font-medium">
            sklearn-style model (RandomForest)
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full">
            <div className="text-gray-500 mb-4">
              The simplest case: any scikit-learn estimator that exposes{" "}
              <code className="font-mono text-gray-700">predict_proba</code>.
              <code className="font-mono text-gray-700"> log_explainable_model</code>{" "}
              fits a SHAP explainer on{" "}
              <code className="font-mono text-gray-700">X_train</code> and
              registers the bundle under the given name.
            </div>
            <EXCodeBlock
              lines={["7:11"]}
              code={rfCode}
              language={"python"}
            />
          </div>

          <div className="mt-8 text-lg font-medium">
            Gradient Boosting (sklearn)
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full">
            <EXCodeBlock
              lines={["6:10"]}
              code={gbCode}
              language={"python"}
            />
          </div>

          <div className="mt-8 text-lg font-medium">XGBoost</div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full">
            <div className="text-gray-500 mb-4">
              As of <code className="font-mono text-gray-700">shap</code> 0.49
              the meta-Explainer no longer auto-detects{" "}
              <code className="font-mono text-gray-700">XGBClassifier</code>.{" "}
              <code className="font-mono text-gray-700">log_explainable_model</code>{" "}
              transparently retries with{" "}
              <code className="font-mono text-gray-700">model.predict_proba</code>{" "}
              when this happens, so the user-facing API stays the same. Pass{" "}
              <code className="font-mono text-gray-700">extra_pip_requirements</code>{" "}
              so kserve installs xgboost at load time.
            </div>
            <EXCodeBlock
              lines={["6:12"]}
              code={xgbCode}
              language={"python"}
            />
          </div>

          <div className="mt-8 text-lg font-medium">
            Custom torch model (or any callable wrapper)
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full">
            <div className="text-gray-500 mb-4">
              The library walks the predictor's object graph, collects source
              files of any user-defined classes (skipping stdlib and well-known
              third-party prefixes), and packs them into the artifact via
              MLflow's <code className="font-mono text-gray-700">code_path</code>.
              The serving runtime never needs to import those classes from its
              own codebase.
            </div>
            <EXCodeBlock
              lines={["6:13"]}
              code={torchCode}
              language={"python"}
            />
          </div>

          <div className="mt-8 text-lg font-medium">Loading at serving time</div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full">
            <div className="text-gray-500 mb-4">
              Every registered model — regardless of framework — exposes the
              same two-method runtime contract.
            </div>
            <EXCodeBlock
              lines={[7, 10]}
              code={loadCode}
              language={"python"}
            />
          </div>
        </div>
      </div>
    </>
  );
}

Tokens.Layout = Layout;
export default Tokens;

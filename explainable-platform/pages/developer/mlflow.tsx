import { ReactNode, useEffect, useState } from "react";

import Layout from "@/components/common/Layout";
import { PageHeader } from "@/components/common/PageHeader";
import { EXCodeBlock } from "@/components/ui/CodeBlock/CodeBlock";
import { Separator } from "@/components/ui/separator";
import { getMLFlowToken, getMLFlowTrackingUri } from "../api/mlflow";

/** An identifier inside running text. */
const Code = ({ children }: { children: ReactNode }) => (
  <code
    translate="no"
    className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
  >
    {children}
  </code>
);

const GuideSection = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) => (
  <section aria-labelledby={id} className="flex flex-col gap-4">
    <h2 id={id} className="text-lg font-semibold">
      {title}
    </h2>
    {children}
  </section>
);

const Prose = ({ children }: { children: ReactNode }) => (
  <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground [text-wrap:pretty]">
    {children}
  </p>
);

export function MlflowGuidePage() {
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
    <div className="flex flex-col gap-8 p-8">
      <PageHeader
        title="Deploying Your Model with MLflow Explainable"
        description={
          <>
            Use the <Code>mlflow-explainable</Code> package to log a predictor and its SHAP
            explainer as a single <Code>mlflow.pyfunc</Code> artifact. The serving runtime never
            needs to know whether the underlying model is a scikit-learn estimator, an XGBoost
            booster, or a custom torch network — every artifact exposes the same{" "}
            <Code>predict</Code> / <Code>shap_explain</Code> contract.
          </>
        }
      />

      <GuideSection id="installation" title="Installation">
        <EXCodeBlock code={installCode} language={"bash"} />
      </GuideSection>

      <Separator />

      <GuideSection id="authenticate" title="Authenticate and Load Training Data">
        <Prose>
          Authenticate with your access token and point MLflow at your tracking URI before any
          training run. The snippets below assume this block has already run.
        </Prose>
        <EXCodeBlock lines={["7:9"]} code={setupCode} language={"python"} />
      </GuideSection>

      <Separator />

      <GuideSection id="random-forest" title="sklearn-Style Model (RandomForest)">
        <Prose>
          The simplest case: any scikit-learn estimator that exposes <Code>predict_proba</Code>.{" "}
          <Code>log_explainable_model</Code> fits a SHAP explainer on <Code>X_train</Code> and
          registers the bundle under the given name.
        </Prose>
        <EXCodeBlock lines={["7:11"]} code={rfCode} language={"python"} />
      </GuideSection>

      <Separator />

      <GuideSection id="gradient-boosting" title="Gradient Boosting (sklearn)">
        <EXCodeBlock lines={["6:10"]} code={gbCode} language={"python"} />
      </GuideSection>

      <Separator />

      <GuideSection id="xgboost" title="XGBoost">
        <Prose>
          As of <Code>shap</Code> 0.49 the meta-Explainer no longer auto-detects{" "}
          <Code>XGBClassifier</Code>. <Code>log_explainable_model</Code> transparently retries
          with <Code>model.predict_proba</Code> when this happens, so the user-facing API stays the
          same. Pass <Code>extra_pip_requirements</Code> so kserve installs xgboost at load time.
        </Prose>
        <EXCodeBlock lines={["6:12"]} code={xgbCode} language={"python"} />
      </GuideSection>

      <Separator />

      <GuideSection id="torch" title="Custom Torch Model (or Any Callable Wrapper)">
        <Prose>
          The library walks the predictor’s object graph, collects source files of any
          user-defined classes (skipping stdlib and well-known third-party prefixes), and packs
          them into the artifact via MLflow’s <Code>code_path</Code>. The serving runtime never
          needs to import those classes from its own codebase.
        </Prose>
        <EXCodeBlock lines={["6:13"]} code={torchCode} language={"python"} />
      </GuideSection>

      <Separator />

      <GuideSection id="serving" title="Loading at Serving Time">
        <Prose>
          Every registered model — regardless of framework — exposes the same two-method runtime
          contract.
        </Prose>
        <EXCodeBlock lines={[7, 10]} code={loadCode} language={"python"} />
      </GuideSection>
    </div>
  );
}

MlflowGuidePage.Layout = Layout;
MlflowGuidePage.title = "MLflow and Deployment";
export default MlflowGuidePage;

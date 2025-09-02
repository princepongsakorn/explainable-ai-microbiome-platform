import Layout from "@/components/common/Layout";
import { WhiteButton } from "@/components/ui/Button/Button";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { getMLFlowToken, getMLFlowTrackingUri } from "../api/mlflow";
import { CodeBlock } from "react-code-block";
import { EXCodeBlock } from "@/components/ui/CodeBlock/CodeBlock";
import { url } from "inspector";

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

  const mlflowCode = `
  sample_url = "https://raw.githubusercontent.com/ryzary/shapmat/refs/heads/cv_notebook/data/sample.csv"
  sample_crc = pd.read_csv(sample_url, index_col=0)
  train_data = sample_crc.drop(['CRC'],axis=1)
  train_metadata = sample_crc[['CRC']]
  train_ids = train_data.index
  
  X = train_data.loc[train_ids]
  y = train_metadata['CRC']
  X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
  
  os.environ['MLFLOW_TRACKING_USERNAME'] = "${token?.user ?? 'your-username'}"
  os.environ['MLFLOW_TRACKING_PASSWORD'] = "your-access-token"
  mlflow.set_tracking_uri("${mlflowUrl}")

  # mlflow.set_experiment("sample-rf-crc")
  
  def objective(params):
      with mlflow.start_run() as run:
          params["n_estimators"] = int(params["n_estimators"])
          params["min_samples_leaf"] = int(params['min_samples_leaf'])
          params["min_samples_split"] = int(params['min_samples_split'])
          # Train with tuned RandomForest
          mlflow.log_param("features_bacteria", train_data.shape[1])
          mlflow.log_params(params)
  
          model = RandomForestClassifier(**params).fit(X_train ,y_train)
  
          # Evaluation on test data
          y_pred = model.predict(X_test)
          y_pred_proba = model.predict_proba(X_test)[:, 1] 
          accuracy = accuracy_score(y_test, y_pred)
          precision = precision_score(y_test, y_pred, average='weighted')
          recall = recall_score(y_test, y_pred, average='weighted')
          f1 = f1_score(y_test, y_pred, average='weighted')
          roc_auc = roc_auc_score(y_test, y_pred_proba, multi_class='ovr', average='weighted')
          mlflow.log_metric("accuracy", round(accuracy, 3))
          mlflow.log_metric("precision", round(precision, 3))
          mlflow.log_metric("recall", round(recall, 3))
          mlflow.log_metric("f1", round(f1, 3))
          mlflow.log_metric("roc_auc", round(roc_auc, 3))
  
          print(f"Trial with params: {params}, Accuracy: {accuracy:.4f}")
  
          # Log shap_explainer and model
          log_explainer(model, X_train)
          mlflow.sklearn.log_model( 
              sk_model=model,
              artifact_path="model",
              input_example = X_test[:3],
              signature = infer_signature(X_test[:3], model.predict(X_test[:3]))
          )
          return {"loss": -accuracy, "status": STATUS_OK}
  
  # Search Space
  space = {
      "n_estimators": hp.quniform("n_estimators", 50, 1000, 50),
      "max_depth": hp.choice("max_depth", [10, 20, 50, 100, None]),
      'min_samples_leaf': hp.quniform('min_samples_leaf', 1, 5, 1),
      'min_samples_split': hp.quniform('min_samples_split', 2, 6, 1),
      "class_weight": hp.choice("class_weight", [None, "balanced"]),
      "max_features": hp.choice("max_features", ["sqrt", "log2", None]),
  }
  
  # Run Hyperopt Optimization
  trials = Trials()
  best = fmin(fn=objective, space=space, algo=tpe.suggest, max_evals=50, trials=trials)
  print("Best parameters:", best)`;

  return (
    <>
      <div className="p-8 bg-white h-full">
        <div className="mb-8">
          <div className="mt-8 text-xl font-medium">
            Deploying Your Model with MLflow
          </div>
          <div className="mt-4 pt-4 border-solid border-t-[1px] border-[#EAEAEA] w-full gap-6">
            <div className="text-gray-500">
              To deploy your machine learning model using MLflow, you need to
              authenticate using your Access Token and specify the MLflow
              Tracking URI at the top of your Python script. This ensures that
              MLflow can track and log your model deployment properly.
            </div>
            <div className="mt-4">
              <EXCodeBlock lines={[17, '11:13', '45:50']} code={mlflowCode} language={"python"} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Tokens.Layout = Layout;
export default Tokens;

import mlflow
import mlflow.shap
import mlflow.sklearn
import pandas as pd

import joblib
import shap

from mlflow.models import infer_signature

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.model_selection import cross_validate
from shapmat.abundance_filter import ab_filter

#TODO: Make it to Third-party Package
def log_explainer(model, data, file_path='shap_explainer.pkl'):
    """
    Save a SHAP explainer for the given model and data.

    Parameters:
    model: The trained model to explain.
    data: The data used to initialize the SHAP explainer.
    file_path (str): The file path to save the SHAP explainer (default: 'shap_explainer.pkl').

    Returns:
    str: The file path where the SHAP explainer is saved.
    """
    # Create SHAP explainer
    explainer = shap.Explainer(model, data)

    # Save explainer to file
    with open(file_path, 'wb') as f:
        joblib.dump(explainer, f)

    mlflow.log_artifact(file_path, artifact_path="shap_explainer")

# Log the Dataset to an MLflow run by using the `log_input` API
with mlflow.start_run() as run:
    # Curated CRC (Train data)
    curated_url = "https://raw.githubusercontent.com/ryzary/shapmat/refs/heads/cv_notebook/data/curatedCRC.csv"
    curatedCRC = pd.read_csv(curated_url, index_col=0)
    curatedCRC_abundance = curatedCRC.drop(['study_name','CRC','ajcc_stage'],axis=1)
    curatedCRC_metadata = curatedCRC[['CRC']]
    curatedCRC_dataset = mlflow.data.from_pandas(
        curatedCRC, source=curated_url, name="curated-crc-data", targets="CRC"
    )

    ##
    train_ids = curatedCRC_abundance.index
    X_train = curatedCRC_abundance.loc[train_ids]
    y_train = curatedCRC_metadata['CRC']
    mlflow.log_param("features_bacteria", curatedCRC_abundance.shape[1])

    # data preprocessing filter
    # thr_1 = [1e-7,1e-8,1e-9,1e-10, 1e-12, 1e-15] # candidates for thr_1
    # thr_2 = [0.8,0.9,0.95] # candidates for thr_2
    t1 = 1e-15
    t2 = 0.95
    X_train_filtered = ab_filter(X_train, abundance_threshold=t1, prevalence_threshold=t2)
    mlflow.log_param("t_abundance_threshold", t1)
    mlflow.log_param("t_prevalence_threshold", t2)
    mlflow.log_param("t_features_bacteria", X_train_filtered.shape[1])

    # Train with tuned RandomForest
    params = {"max_depth": None, "random_state": 0, "n_estimators": 500, "class_weight": None}
    mlflow.log_params(params)

    model = RandomForestClassifier(**params).fit(X_train_filtered ,y_train)

    # Evaluation on test data
    rkf = RepeatedStratifiedKFold(n_splits=10,  
                              n_repeats=10,
                              random_state=0)

    scoring_metrics = ['roc_auc', 'accuracy', 'precision', 'recall', 'f1']
    cv_results = cross_validate(
        model, 
        X_train_filtered, 
        y_train, 
        cv=rkf,
        scoring=scoring_metrics,
        return_train_score=True
    )

    mlflow.log_metric("roc_auc", cv_results['test_roc_auc'].mean().round(3))
    mlflow.log_metric("accuracy", cv_results['test_accuracy'].mean().round(3))
    mlflow.log_metric("precision", cv_results['test_precision'].mean().round(3))
    mlflow.log_metric("recall", cv_results['test_recall'].mean().round(3))
    mlflow.log_metric("f1", cv_results['test_f1'].mean().round(3))

    # Log shap_explainer and model
    log_explainer(model, X_train_filtered)
    mlflow.sklearn.log_model(
        sk_model=model,
        artifact_path="model",
        registered_model_name="ryza-rynazal-crc",
        input_example = X_train_filtered[:3],
        signature = infer_signature(X_train_filtered[:3], model.predict(X_train_filtered[:3]))
    )

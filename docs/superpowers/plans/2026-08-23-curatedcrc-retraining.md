# curatedCRC Random Forest Retraining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and execute an isolated, reproducible 802-sample curatedCRC Random Forest experiment with MLflow/SHAP registration, paper-protocol comparison tables, and a deterministic 60-row platform sample.

**Architecture:** A focused Python package separates upstream acquisition/data validation, Track A tuning/registration, Track B evaluation, and SHAP reporting. Thin CLI scripts compose those units, while tests use small fixtures and a local MLflow store. The full workflow reuses the repository's `mlflow_explainable.log_explainable_model` contract but registers only the best ROC-AUC trial under a new Staging-only model name.

**Tech Stack:** Python 3.12, pandas 2.2, NumPy 2.0, scikit-learn 1.6, Hyperopt, MLflow 2.19, SHAP, matplotlib, SHAPMAT pinned to upstream commit `0ca51a9ab9c859fac3305f599a81b2e2206bef49`, pytest.

**Spec:** `docs/superpowers/specs/2026-08-23-curatedcrc-retraining-design.md`

## Global Constraints

- Source data must be the 802-row `shapmat/data/curatedCRC.csv` from SHAPMAT commit `0ca51a9ab9c859fac3305f599a81b2e2206bef49`; the analysis reference is `shapmat_paper` commit `6600175db5984a07b86f2b5591114f39181ff4dc`; the CSV SHA-256 is `8f1258882cbedd1613ae3490f9ec94bbc97c72c041f1ed9f531f43b2030c1a8f`.
- Call `shapmat.abundance_filter.ab_filter` directly with `abundance_threshold=1e-5` and `prevalence_threshold=0.9`; do not reimplement it in production code.
- Expect 864 raw bacterial features and 221 filtered features.
- Preserve upstream cohort identifier `WirbelJ_2018`; document that the paper was published in 2019.
- Track A runs exactly 50 Hyperopt TPE trials in the full execution and logs `roc_auc`, `accuracy`, `precision`, `recall`, and `f1` for every trial.
- Register only the best ROC-AUC trial as `crc-curatedcrc-rf`, transition only its new version to Staging, never archive another version, and never change any Production stage.
- Track B uses `RandomForestClassifier(n_estimators=500, max_depth=None, random_state=0, class_weight=None)` and `RepeatedStratifiedKFold(n_splits=10, n_repeats=10, random_state=0)`.
- The new 60-row export uses seed `42`, contains both classes and all five cohorts in its manifest, and matches the platform schema (`subject_id`, filtered features, `CRC`).
- Do not modify `sample-data/sample.csv`, `sample-data/sample-60-row.csv`, `mlflow-experiments/sample-rf-crc/`, or any existing registered-model stage.

---

## File map

- Create `mlflow-experiments/curatedcrc-rf/curatedcrc/acquire.py`: clone/locate upstream repositories and return immutable provenance.
- Create `mlflow-experiments/curatedcrc-rf/curatedcrc/data.py`: validate, filter, and represent the prepared dataset.
- Create `mlflow-experiments/curatedcrc-rf/curatedcrc/sample.py`: deterministic proportional stratified sampling and manifest creation.
- Create `mlflow-experiments/curatedcrc-rf/curatedcrc/train.py`: Track A search, metric logging, best-run model registration, and Production safety snapshot.
- Create `mlflow-experiments/curatedcrc-rf/curatedcrc/evaluate.py`: fixed-RF cohort CV, Yachida Stage III-IV CV, and LODO.
- Create `mlflow-experiments/curatedcrc-rf/curatedcrc/shap_report.py`: normalize class-1 SHAP values and save/report biomarker evidence.
- Create `mlflow-experiments/curatedcrc-rf/scripts/prepare_data.py`: acquisition, preparation, 60-row export, and provenance CLI.
- Create `mlflow-experiments/curatedcrc-rf/scripts/train_track_a.py`: Track A CLI.
- Create `mlflow-experiments/curatedcrc-rf/scripts/evaluate_track_b.py`: Track B CLI.
- Create `mlflow-experiments/curatedcrc-rf/tests/`: unit/integration coverage for each package boundary.
- Create `mlflow-experiments/curatedcrc-rf/MLproject`, `conda.yaml`, `python_env.yaml`, `pyproject.toml`, `.gitignore`, and `README.md`: reproducible execution environment and documentation.
- Create `sample-data/curatedCRC-60-row.csv` and `sample-data/curatedCRC-60-row.manifest.json`: platform-facing sample and provenance.
- Generate `mlflow-experiments/curatedcrc-rf/outputs/*.csv|*.json|*.png`: Track A/Track B/SHAP evidence.

---

### Task 1: Scaffold the experiment and acquire pinned upstream data

**Files:**
- Create: `mlflow-experiments/curatedcrc-rf/curatedcrc/__init__.py`
- Create: `mlflow-experiments/curatedcrc-rf/curatedcrc/acquire.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/test_acquire.py`
- Create: `mlflow-experiments/curatedcrc-rf/pyproject.toml`
- Create: `mlflow-experiments/curatedcrc-rf/.gitignore`

**Interfaces:**
- Produces: `UpstreamSource(data_path: Path, shapmat_commit: str, paper_commit: str, sha256: str)`.
- Produces: `acquire_upstream(checkout_dir: Path) -> UpstreamSource`.
- Depends on: command-line `git`; no MLflow state.

- [ ] **Step 1: Write failing acquisition tests**

```python
def test_locate_source_records_commits_and_checksum(tmp_path, monkeypatch):
    shapmat = tmp_path / "shapmat"
    paper = tmp_path / "shapmat_paper"
    (shapmat / "data").mkdir(parents=True)
    paper.mkdir()
    csv_path = shapmat / "data" / "curatedCRC.csv"
    csv_path.write_text("subject_id,CRC\ns1,0\n")
    commits = {shapmat: "a" * 40, paper: "b" * 40}
    monkeypatch.setattr(acquire, "git_commit", lambda path: commits[path])

    source = acquire.locate_upstream(tmp_path)

    assert source.data_path == csv_path
    assert source.shapmat_commit == "a" * 40
    assert source.paper_commit == "b" * 40
    assert source.sha256 == hashlib.sha256(csv_path.read_bytes()).hexdigest()


def test_locate_source_rejects_missing_curatedcrc(tmp_path):
    (tmp_path / "shapmat").mkdir()
    (tmp_path / "shapmat_paper").mkdir()
    with pytest.raises(FileNotFoundError, match="curatedCRC.csv"):
        acquire.locate_upstream(tmp_path)
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_acquire.py -v`

Expected: collection fails because `curatedcrc.acquire` does not exist.

- [ ] **Step 3: Implement acquisition and provenance**

Implement these exact public definitions:

```python
SHAPMAT_URL = "https://github.com/ryzary/shapmat.git"
PAPER_URL = "https://github.com/ryzary/shapmat_paper.git"
SHAPMAT_BRANCH = "cv_notebook"
SHAPMAT_COMMIT = "0ca51a9ab9c859fac3305f599a81b2e2206bef49"
PAPER_COMMIT = "6600175db5984a07b86f2b5591114f39181ff4dc"

@dataclass(frozen=True)
class UpstreamSource:
    data_path: Path
    shapmat_commit: str
    paper_commit: str
    sha256: str

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def git_commit(path: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()

def locate_upstream(checkout_dir: Path) -> UpstreamSource:
    shapmat = checkout_dir / "shapmat"
    paper = checkout_dir / "shapmat_paper"
    candidates = [
        shapmat / "data" / "curatedCRC.csv",
        paper / "data" / "curatedCRC.csv",
    ]
    matches = [path for path in candidates if path.is_file()]
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected exactly one curatedCRC.csv in the upstream clones; found {matches}. "
            "Inspect shapmat_paper/scripts/get_data.R to regenerate it."
        )
    return UpstreamSource(
        data_path=matches[0],
        shapmat_commit=git_commit(shapmat),
        paper_commit=git_commit(paper),
        sha256=sha256_file(matches[0]),
    )
```

`acquire_upstream` clones SHAPMAT from `cv_notebook` and clones the paper repository only when their target directories do not exist, checks out `SHAPMAT_COMMIT` and `PAPER_COMMIT` detached, then delegates to `locate_upstream`. Existing directories are never pulled or reset: verify they are Git repositories already at the two pinned commits and fail with an actionable mismatch message otherwise.

- [ ] **Step 4: Run acquisition tests and the package test suite**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_acquire.py -v`

Expected: both tests pass without network access.

- [ ] **Step 5: Commit Task 1**

```bash
git add mlflow-experiments/curatedcrc-rf
git commit -m "feat: acquire pinned curatedCRC upstream data"
```

---

### Task 2: Validate and filter the 802-sample curatedCRC table

**Files:**
- Create: `mlflow-experiments/curatedcrc-rf/curatedcrc/data.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/conftest.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/test_data.py`

**Interfaces:**
- Consumes: `UpstreamSource` from Task 1.
- Produces: `PreparedDataset(X: pd.DataFrame, metadata: pd.DataFrame, provenance: dict[str, object], raw_feature_count: int, filtered_feature_count: int)`.
- Produces: `prepare_dataset(source: UpstreamSource, *, enforce_reference_shape: bool = True) -> PreparedDataset`.

- [ ] **Step 1: Write failing validation/filter tests**

Use a fixture with metadata columns `study_name`, `CRC`, `ajcc_stage` and four numeric bacterial columns. Patch the imported `ab_filter` symbol only to observe the contract:

```python
def test_prepare_dataset_calls_shapmat_with_exact_thresholds(
    curated_source, monkeypatch
):
    calls = []
    def recording_filter(frame, *, abundance_threshold, prevalence_threshold):
        calls.append((frame.columns.tolist(), abundance_threshold, prevalence_threshold))
        return frame[["Fusobacterium_nucleatum", "Peptostreptococcus_stomatis"]]
    monkeypatch.setattr(data, "ab_filter", recording_filter)

    prepared = data.prepare_dataset(curated_source, enforce_reference_shape=False)

    assert calls == [(
        ["Fusobacterium_nucleatum", "Peptostreptococcus_stomatis", "other_a", "other_b"],
        1e-5,
        0.9,
    )]
    assert prepared.X.shape[1] == 2
    assert prepared.metadata.columns.tolist() == ["study_name", "CRC", "ajcc_stage"]
    assert prepared.X.index.name == "subject_id"


def test_prepare_dataset_rejects_wrong_cohort_set(curated_source, monkeypatch):
    frame = pd.read_csv(curated_source.data_path, index_col=0)
    frame.loc[frame.index[0], "study_name"] = "unexpected"
    frame.to_csv(curated_source.data_path)
    with pytest.raises(ValueError, match="cohorts"):
        data.prepare_dataset(curated_source, enforce_reference_shape=False)
```

Add these focused assertions to the same test module:

```python
def test_prepare_dataset_rejects_duplicate_subject_ids(curated_source):
    frame = pd.read_csv(curated_source.data_path, index_col=0)
    frame.index = ["duplicate", "duplicate", *frame.index[2:]]
    frame.to_csv(curated_source.data_path)
    with pytest.raises(ValueError, match="duplicate subject"):
        data.prepare_dataset(curated_source, enforce_reference_shape=False)

def test_prepare_dataset_rejects_non_binary_label(curated_source):
    frame = pd.read_csv(curated_source.data_path, index_col=0)
    frame.iloc[0, frame.columns.get_loc("CRC")] = 2
    frame.to_csv(curated_source.data_path)
    with pytest.raises(ValueError, match="labels"):
        data.prepare_dataset(curated_source, enforce_reference_shape=False)

def test_prepare_dataset_rejects_non_finite_abundance(curated_source):
    frame = pd.read_csv(curated_source.data_path, index_col=0)
    frame.loc[frame.index[0], "other_a"] = np.inf
    frame.to_csv(curated_source.data_path)
    with pytest.raises(ValueError, match="finite"):
        data.prepare_dataset(curated_source, enforce_reference_shape=False)

def test_reference_shape_rejects_wrong_source_checksum(curated_source):
    with pytest.raises(ValueError, match="SHA-256"):
        data.prepare_dataset(curated_source, enforce_reference_shape=True)
```

The real-data integration assertion in Step 4 covers exactly 802 rows, 864 raw features, 221 filtered features, 378 controls, and 424 CRC cases.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_data.py -v`

Expected: fail because `PreparedDataset` and `prepare_dataset` are undefined.

- [ ] **Step 3: Implement the minimal validated preparation pipeline**

```python
EXPECTED_COHORTS = frozenset({
    "YachidaS_2019", "YuJ_2015", "WirbelJ_2018",
    "ZellerG_2014", "VogtmannE_2016",
})
EXPECTED_ROWS = 802
EXPECTED_RAW_FEATURES = 864
EXPECTED_FILTERED_FEATURES = 221
EXPECTED_SHA256 = "8f1258882cbedd1613ae3490f9ec94bbc97c72c041f1ed9f531f43b2030c1a8f"
METADATA_COLUMNS = ["study_name", "CRC", "ajcc_stage"]

@dataclass(frozen=True)
class PreparedDataset:
    X: pd.DataFrame
    metadata: pd.DataFrame
    provenance: dict[str, object]
    raw_feature_count: int
    filtered_feature_count: int
```

`prepare_dataset` reads with `index_col=0`, sets `index.name = "subject_id"`, validates IDs/metadata/labels/cohorts/numeric finite abundances, invokes the imported real `ab_filter`, validates the two named biomarkers remain, and—when `enforce_reference_shape=True`—asserts SHA, 802 rows, 864 raw features, and 221 filtered features. Populate provenance with source paths/commits/SHA, thresholds, row/class/cohort counts, and feature counts.

- [ ] **Step 4: Run tests with the real pinned upstream CSV**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_data.py -v`

Then run a one-line integration assertion against `/tmp/curatedcrc-upstream.t3YONN` and verify `X.shape == (802, 221)`.

Expected: all unit tests pass; integration prints `(802, 221)`.

- [ ] **Step 5: Commit Task 2**

```bash
git add mlflow-experiments/curatedcrc-rf/curatedcrc/data.py mlflow-experiments/curatedcrc-rf/tests
git commit -m "feat: validate and filter curatedCRC data"
```

---

### Task 3: Export a deterministic 60-row platform sample

**Files:**
- Create: `mlflow-experiments/curatedcrc-rf/curatedcrc/sample.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/test_sample.py`
- Create: `mlflow-experiments/curatedcrc-rf/scripts/prepare_data.py`
- Create after execution: `sample-data/curatedCRC-60-row.csv`
- Create after execution: `sample-data/curatedCRC-60-row.manifest.json`

**Interfaces:**
- Consumes: `PreparedDataset`.
- Produces: `select_sample_ids(prepared, *, n=60, random_state=42) -> pd.Index`.
- Produces: `export_platform_sample(prepared, csv_path: Path, manifest_path: Path, *, n=60, random_state=42) -> dict[str, object]`.

- [ ] **Step 1: Write failing sample-contract tests**

```python
def test_export_platform_sample_is_deterministic(prepared_fixture, tmp_path):
    first_csv, first_json = tmp_path / "first.csv", tmp_path / "first.json"
    second_csv, second_json = tmp_path / "second.csv", tmp_path / "second.json"
    first = export_platform_sample(prepared_fixture, first_csv, first_json)
    second = export_platform_sample(prepared_fixture, second_csv, second_json)

    assert first_csv.read_bytes() == second_csv.read_bytes()
    assert first["selected_subject_ids"] == second["selected_subject_ids"]
    exported = pd.read_csv(first_csv)
    assert exported.columns[0] == "subject_id"
    assert exported.columns[-1] == "CRC"
    assert len(exported) == 60
    assert set(exported.CRC) == {0, 1}
    assert set(first["cohort_counts"]) == EXPECTED_COHORTS
    assert "study_name" not in exported.columns
    assert "ajcc_stage" not in exported.columns
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_sample.py -v`

Expected: fail because `export_platform_sample` is missing.

- [ ] **Step 3: Implement proportional stratified selection and export**

Construct strata as `metadata.study_name.astype(str) + "::" + metadata.CRC.astype(str)` and call:

```python
selected_ids, _ = train_test_split(
    prepared.X.index,
    train_size=n,
    random_state=random_state,
    stratify=strata,
)
selected_ids = pd.Index(sorted(selected_ids), name="subject_id")
```

Join `prepared.X.loc[selected_ids]` with the integer `CRC` column, write CSV with `index_label="subject_id"`, and atomically write a sorted/indented JSON manifest containing the seed, source SHA/commits, selected IDs, class/cohort counts, and filtered feature count.

- [ ] **Step 4: Run tests and generate the real sample**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_sample.py -v`

Run: `python scripts/prepare_data.py --checkout-dir /tmp/curatedcrc-upstream.t3YONN --sample-csv ../../sample-data/curatedCRC-60-row.csv --sample-manifest ../../sample-data/curatedCRC-60-row.manifest.json`

Expected: 60 rows, 221 bacterial columns plus `subject_id` and `CRC`, both labels, and all five cohort keys in the manifest.

- [ ] **Step 5: Commit Task 3**

```bash
git add mlflow-experiments/curatedcrc-rf/curatedcrc/sample.py mlflow-experiments/curatedcrc-rf/scripts/prepare_data.py mlflow-experiments/curatedcrc-rf/tests/test_sample.py sample-data/curatedCRC-60-row.csv sample-data/curatedCRC-60-row.manifest.json
git commit -m "feat: add curatedCRC 60-row platform sample"
```

---

### Task 4: Log and select Track A Hyperopt trials by ROC AUC

**Files:**
- Create: `mlflow-experiments/curatedcrc-rf/curatedcrc/train.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/test_train.py`

**Interfaces:**
- Consumes: `PreparedDataset`.
- Produces: `HoldoutSplit(X_train, X_test, y_train, y_test)`.
- Produces: `TrialResult(run_id: str, model: RandomForestClassifier, params: dict[str, object], metrics: dict[str, float])`.
- Produces: `run_hyperopt(prepared, *, max_evals=50, experiment_name="crc-curatedcrc-rf", random_state=0) -> tuple[TrialResult, HoldoutSplit]`.

- [ ] **Step 1: Write failing split/metric tests**

```python
def test_make_holdout_is_stratified_and_reproducible(prepared_fixture):
    first = make_holdout(prepared_fixture, test_size=0.2, random_state=42)
    second = make_holdout(prepared_fixture, test_size=0.2, random_state=42)
    assert first.X_test.index.tolist() == second.X_test.index.tolist()
    assert set(first.X_train.index).isdisjoint(first.X_test.index)
    assert abs(first.y_test.mean() - prepared_fixture.metadata.CRC.mean()) < 0.05


def test_evaluate_model_returns_all_required_metrics(binary_model, holdout):
    metrics = evaluate_model(binary_model, holdout.X_test, holdout.y_test)
    assert set(metrics) == {"roc_auc", "accuracy", "precision", "recall", "f1"}
    assert all(0.0 <= value <= 1.0 for value in metrics.values())
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_train.py -v`

Expected: fail because Track A functions are undefined.

- [ ] **Step 3: Implement split, search space, objective, and best selection**

Use `train_test_split(..., test_size=0.2, random_state=42, stratify=y)`. Define the search space exactly as the spec. Convert Hyperopt numeric values to integers, inject `random_state=0` and `n_jobs=-1`, train one model per MLflow run, and log unrounded metrics:

```python
with mlflow.start_run(run_name=f"hyperopt-trial-{trial_number:02d}") as run:
    mlflow.log_params({**params, "features_bacteria": prepared.filtered_feature_count})
    mlflow.set_tags(provenance_tags(prepared))
    model = RandomForestClassifier(**params, random_state=0, n_jobs=-1)
    model.fit(split.X_train, split.y_train)
    metrics = evaluate_model(model, split.X_test, split.y_test)
    mlflow.log_metrics(metrics)
    result = TrialResult(run.info.run_id, model, params, metrics)
    trial_results.append(result)
    return {"loss": -metrics["roc_auc"], "status": STATUS_OK, "run_id": run.info.run_id}
```

Call `fmin(..., algo=tpe.suggest, max_evals=max_evals, trials=Trials(), rstate=np.random.default_rng(random_state))`, select `max(trial_results, key=lambda item: item.metrics["roc_auc"])`, and reopen/tag that run with `selection_status=best` and `selection_metric=roc_auc`.

- [ ] **Step 4: Add a local file-backed MLflow integration test**

Run two trials against `mlflow.set_tracking_uri(tmp_path.joinpath("mlruns").as_uri())`, monkeypatch the search space to two small forests, and assert each resulting run has all five metrics while only the greatest ROC-AUC run has `selection_status=best`. No registered model is created in this task.

- [ ] **Step 5: Run tests and commit Task 4**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_train.py -v`

```bash
git add mlflow-experiments/curatedcrc-rf/curatedcrc/train.py mlflow-experiments/curatedcrc-rf/tests/test_train.py
git commit -m "feat: tune curatedCRC random forest with MLflow"
```

---

### Task 5: Register only the best explainable model and enforce Staging safety

**Files:**
- Modify: `mlflow-experiments/curatedcrc-rf/curatedcrc/train.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/test_registration.py`
- Create: `mlflow-experiments/curatedcrc-rf/scripts/train_track_a.py`

**Interfaces:**
- Consumes: `TrialResult`, `HoldoutSplit`, and SHAP artifact paths.
- Produces: `RegistrationResult(name: str, version: str, stage: str, production_before: frozenset[tuple[str, str]], production_after: frozenset[tuple[str, str]])`.
- Produces: `register_best_model(best, split, *, registered_name="crc-curatedcrc-rf", extra_artifacts=None) -> RegistrationResult`.

- [ ] **Step 1: Write failing model-registry safety tests**

```python
def test_register_best_uses_contract_and_only_transitions_new_version(monkeypatch):
    client = FakeClient(production={("legacy-crc", "7")})
    calls = []
    monkeypatch.setattr(train, "MlflowClient", lambda: client)
    monkeypatch.setattr(train, "log_explainable_model", lambda **kwargs: FakeInfo("3"))

    result = register_best_model(best_result, split, registered_name="crc-curatedcrc-rf")

    assert client.transitions == [("crc-curatedcrc-rf", "3", "Staging", False)]
    assert result.production_before == result.production_after == frozenset({("legacy-crc", "7")})


def test_register_best_fails_if_production_snapshot_changes(monkeypatch):
    client = FakeClient(production_sequence=[{("legacy", "1")}, {("legacy", "2")}])
    monkeypatch.setattr(train, "MlflowClient", lambda: client)
    monkeypatch.setattr(train, "log_explainable_model", lambda **kwargs: FakeInfo("1"))
    with pytest.raises(RuntimeError, match="Production"):
        register_best_model(best_result, split)
```

- [ ] **Step 2: Run registration tests and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_registration.py -v`

Expected: fail because registry helpers are undefined.

- [ ] **Step 3: Implement version resolution and safety snapshot**

```python
def production_snapshot(client: MlflowClient) -> frozenset[tuple[str, str]]:
    return frozenset(
        (version.name, str(version.version))
        for version in client.search_model_versions()
        if version.current_stage == "Production"
    )

def resolve_version(info, client, name: str, run_id: str) -> str:
    direct = getattr(info, "registered_model_version", None)
    if direct is not None:
        return str(direct)
    matches = [
        item for item in client.search_model_versions(f"name = '{name}'")
        if item.run_id == run_id
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Could not resolve one model version for run {run_id}: {matches}")
    return str(matches[0].version)
```

Within `mlflow.start_run(run_id=best.run_id)`, call the in-repo contract exactly once with the best fitted model and `split.X_train` background. Transition only the resolved version via `client.transition_model_version_stage(..., stage="Staging", archive_existing_versions=False)`. Re-snapshot all Production versions and raise if the set differs. Log `outputs/track_a_registration.json` to the best run.

- [ ] **Step 4: Implement the Track A CLI**

Arguments: `--checkout-dir`, `--tracking-uri` (default `MLFLOW_TRACKING_URI`), `--experiment-name` (default `crc-curatedcrc-rf`), `--registered-name` (fixed default `crc-curatedcrc-rf`), `--max-evals` (default 50), and `--output-dir`. Reject protected legacy names (`sample-rf-crc` and `ryza-rynazal-crc`) while allowing repeatable new versions of `crc-curatedcrc-rf`. The CLI must not set usernames/passwords; MLflow reads them from the environment.

- [ ] **Step 5: Run tests and commit Task 5**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_registration.py tests/test_train.py -v`

```bash
git add mlflow-experiments/curatedcrc-rf/curatedcrc/train.py mlflow-experiments/curatedcrc-rf/scripts/train_track_a.py mlflow-experiments/curatedcrc-rf/tests
git commit -m "feat: register curatedCRC winner as Staging"
```

---

### Task 6: Reproduce cohort CV, Yachida Stage III-IV, and fixed-500 LODO

**Files:**
- Create: `mlflow-experiments/curatedcrc-rf/curatedcrc/evaluate.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/test_evaluate.py`
- Create: `mlflow-experiments/curatedcrc-rf/scripts/evaluate_track_b.py`

**Interfaces:**
- Consumes: `PreparedDataset`.
- Produces: `reference_model() -> RandomForestClassifier`.
- Produces: `evaluate_cohort_cv(prepared) -> pd.DataFrame`.
- Produces: `evaluate_lodo(prepared) -> pd.DataFrame`.

- [ ] **Step 1: Write failing Track B tests**

```python
def test_reference_model_matches_task_brief():
    model = reference_model()
    assert model.get_params()["n_estimators"] == 500
    assert model.get_params()["max_depth"] is None
    assert model.get_params()["random_state"] == 0
    assert model.get_params()["class_weight"] is None


def test_cohort_cv_emits_100_scores_per_group(prepared_fixture, monkeypatch):
    observed = []
    def fake_scores(model, X, y, *, cv, scoring, n_jobs):
        observed.append((len(X), cv.n_splits, cv.n_repeats, scoring))
        return np.linspace(0.6, 0.9, 100)
    monkeypatch.setattr(evaluate, "cross_val_score", fake_scores)
    table = evaluate_cohort_cv(prepared_fixture)
    assert set(table.evaluation_group) == EXPECTED_COHORTS | {"YachidaS_2019_stage_III_IV"}
    assert set(table.fold_count) == {100}
    assert all(item[1:] == (10, 10, "roc_auc") for item in observed)


def test_lodo_never_trains_on_held_out_cohort(prepared_fixture, monkeypatch):
    seen = []
    class RecordingRF:
        def fit(self, X, y): self.train_ids = set(X.index); return self
        def predict_proba(self, X):
            seen.append((self.train_ids, set(X.index)))
            return np.column_stack([np.full(len(X), .4), np.full(len(X), .6)])
    monkeypatch.setattr(evaluate, "reference_model", RecordingRF)
    evaluate_lodo(prepared_fixture)
    assert all(train.isdisjoint(test) for train, test in seen)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_evaluate.py -v`

Expected: fail because Track B functions are missing.

- [ ] **Step 3: Implement cohort CV and Stage III-IV group**

Create one evaluation slice for each `study_name`. Create the stage comparison slice from all Yachida controls plus Yachida CRC rows whose normalized `ajcc_stage` is `iii` or `iv`. Validate both class counts are at least 10. For every slice call `cross_val_score(reference_model(), X_group, y_group, cv=RepeatedStratifiedKFold(10, 10, random_state=0), scoring="roc_auc", n_jobs=1)` and report `mean_auc`, population `std_auc` (`ddof=0`), `min_auc`, `max_auc`, and `fold_count=100`.

- [ ] **Step 4: Implement fixed-500 LODO and CLI output**

For every held-out cohort fit a fresh reference model on all other IDs, calculate `roc_auc_score` from CRC probabilities, and emit held-out/train sample counts. The CLI atomically saves `outputs/track_b_cohort_cv.csv` and `outputs/track_b_lodo.csv`, prints `group: mean ± std`, and prints the paper's reported LODO reference alongside—not merged into—the measured result.

- [ ] **Step 5: Run tests and commit Task 6**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_evaluate.py -v`

```bash
git add mlflow-experiments/curatedcrc-rf/curatedcrc/evaluate.py mlflow-experiments/curatedcrc-rf/scripts/evaluate_track_b.py mlflow-experiments/curatedcrc-rf/tests/test_evaluate.py
git commit -m "feat: reproduce curatedCRC cohort and LODO evaluation"
```

---

### Task 7: Generate SHAP beeswarm and enforce biomarker sanity checks

**Files:**
- Create: `mlflow-experiments/curatedcrc-rf/curatedcrc/shap_report.py`
- Create: `mlflow-experiments/curatedcrc-rf/tests/test_shap_report.py`
- Modify: `mlflow-experiments/curatedcrc-rf/scripts/train_track_a.py`

**Interfaces:**
- Consumes: best model, `HoldoutSplit`, output directory.
- Produces: `normalize_class1_shap(values, n_samples: int, n_features: int) -> np.ndarray`.
- Produces: `create_shap_report(model, X_train, X_test, output_dir, *, top_k=20) -> ShapReport`.

- [ ] **Step 1: Write failing SHAP shape/ranking tests**

```python
@pytest.mark.parametrize("values", [
    [np.zeros((3, 4)), np.ones((3, 4))],
    np.stack([np.zeros((3, 4)), np.ones((3, 4))], axis=-1),
])
def test_normalize_class1_shap_supports_rf_shapes(values):
    actual = normalize_class1_shap(values, n_samples=3, n_features=4)
    assert actual.shape == (3, 4)
    assert np.all(actual == 1)


def test_rank_positive_contributors_uses_positive_class_magnitude():
    values = np.array([[2.0, -5.0], [0.0, -4.0], [1.0, 3.0]])
    ranked = rank_positive_contributors(values, ["positive", "mostly_negative"])
    assert ranked.iloc[0].feature == "positive"
    assert ranked.columns.tolist() == [
        "feature", "mean_positive_shap", "mean_abs_shap", "mean_signed_shap", "positive_rank"
    ]


def test_missing_top20_biomarker_sets_flagged_status(tmp_path):
    report = build_report_from_values(
        values=np.zeros((5, 25)),
        X_test=pd.DataFrame(np.zeros((5, 25)), columns=[
            "Fusobacterium_nucleatum", "Peptostreptococcus_stomatis", *[f"f{i}" for i in range(23)]
        ]),
        output_dir=tmp_path,
        top_k=20,
    )
    assert report.status == "flagged"
    assert set(report.missing_from_top_positive) == {
        "Fusobacterium_nucleatum", "Peptostreptococcus_stomatis"
    }
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_shap_report.py -v`

Expected: fail because SHAP reporting functions are undefined.

- [ ] **Step 3: Implement SHAP normalization, ranking, and artifacts**

Use `shap.Explainer(model, X_train)` and evaluate `X_test`. Normalize list output by choosing element 1; normalize 3-D output by choosing the last-axis class 1 when shape is `(samples, features, 2)`. Reject every other shape. Rank with:

```python
table = pd.DataFrame({
    "feature": feature_names,
    "mean_positive_shap": np.maximum(values, 0.0).mean(axis=0),
    "mean_abs_shap": np.abs(values).mean(axis=0),
    "mean_signed_shap": values.mean(axis=0),
}).sort_values(["mean_positive_shap", "mean_abs_shap"], ascending=False)
table["positive_rank"] = np.arange(1, len(table) + 1)
```

Create a `shap.Explanation` with class-1 values and test data, save `shap.plots.beeswarm(..., show=False)` as a 200-DPI PNG, save the full ranking CSV, and save JSON with both biomarker ranks and `status` (`passed` only if both ranks are ≤20).

- [ ] **Step 4: Attach SHAP evidence to the best MLflow run**

Generate SHAP artifacts before `register_best_model`, pass them through `extra_artifacts` to `log_explainable_model`, and also `mlflow.log_artifacts(output_dir, artifact_path="curatedcrc_results")` while reopening the best run. After registration and Staging transition, exit code 2 if report status is flagged; print both biomarker ranks either way.

- [ ] **Step 5: Run tests and commit Task 7**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_shap_report.py tests/test_registration.py -v`

```bash
git add mlflow-experiments/curatedcrc-rf/curatedcrc/shap_report.py mlflow-experiments/curatedcrc-rf/scripts/train_track_a.py mlflow-experiments/curatedcrc-rf/tests/test_shap_report.py
git commit -m "feat: add curatedCRC SHAP biomarker report"
```

---

### Task 8: Add reproducible environments, commands, and provenance documentation

**Files:**
- Create: `mlflow-experiments/curatedcrc-rf/MLproject`
- Create: `mlflow-experiments/curatedcrc-rf/conda.yaml`
- Create: `mlflow-experiments/curatedcrc-rf/python_env.yaml`
- Create: `mlflow-experiments/curatedcrc-rf/README.md`
- Create: `mlflow-experiments/curatedcrc-rf/outputs/README.md`
- Modify: `mlflow-experiments/curatedcrc-rf/pyproject.toml`

**Interfaces:**
- Consumes all three CLI scripts.
- Produces documented `prepare`, `track_a`, and `track_b` MLproject entry points.

- [ ] **Step 1: Add a failing CLI help smoke test**

```python
@pytest.mark.parametrize("script", [
    "scripts/prepare_data.py", "scripts/train_track_a.py", "scripts/evaluate_track_b.py"
])
def test_cli_help(script):
    result = subprocess.run([sys.executable, script, "--help"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: Run the smoke test and verify RED**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest tests/test_cli.py -v`

Expected: at least one CLI/import/environment contract fails.

- [ ] **Step 3: Add pinned environments and MLproject entry points**

Pin the same core versions as `sample-rf-crc` (`mlflow==2.19.0`, `pandas==2.2.3`, `numpy==2.0.2`, `scikit-learn==1.6.1`, `matplotlib==3.10.0`, `scipy==1.15.1`) plus compatible `hyperopt`, `shap`, `pytest`, the pinned SHAPMAT Git commit, and editable `../extension/mlflow_explainable`. Set MLproject commands so `PYTHONPATH=../extension/mlflow_explainable/src` is present.

- [ ] **Step 4: Document exact provenance and deviations**

README must state source repository/branch/commit/path/checksum, 802 rows, 378 healthy/424 CRC, cohort counts, 864→221 feature filtering, strict `>=90% zeros` behavior, the `WirbelJ_2018` naming fact, sample output details, Track A/Track B commands, environment-only MLflow credentials, new registered name, Staging-only policy, and the paper-vs-task RF estimator-count distinction.

- [ ] **Step 5: Run all fast tests and commit Task 8**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest -v -m "not slow"`

```bash
git add mlflow-experiments/curatedcrc-rf
git commit -m "docs: add curatedCRC experiment runbook"
```

---

### Task 9: Execute the full workflow and capture acceptance evidence

**Files:**
- Generate: `mlflow-experiments/curatedcrc-rf/outputs/track_a_best_run.json`
- Generate: `mlflow-experiments/curatedcrc-rf/outputs/track_a_registration.json`
- Generate: `mlflow-experiments/curatedcrc-rf/outputs/track_a_shap_beeswarm.png`
- Generate: `mlflow-experiments/curatedcrc-rf/outputs/track_a_shap_positive_contributors.csv`
- Generate: `mlflow-experiments/curatedcrc-rf/outputs/track_a_shap_summary.json`
- Generate: `mlflow-experiments/curatedcrc-rf/outputs/track_b_cohort_cv.csv`
- Generate: `mlflow-experiments/curatedcrc-rf/outputs/track_b_lodo.csv`
- Modify: `mlflow-experiments/curatedcrc-rf/README.md`

**Interfaces:**
- Consumes valid `MLFLOW_TRACKING_URI`, `MLFLOW_TRACKING_USERNAME`, and `MLFLOW_TRACKING_PASSWORD` environment variables for the existing server.
- Produces acceptance evidence without any Production mutation.

- [ ] **Step 1: Run the complete local verification suite**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest -v`

Expected: all tests pass with no network dependency except explicitly marked upstream/full-run tests.

- [ ] **Step 2: Capture the remote Production snapshot and verify connectivity**

Use a read-only Python command with `MlflowClient` to save all `(name, version, run_id, metrics)` records whose `current_stage == "Production"` into a temporary JSON file. Do not print credential values.

- [ ] **Step 3: Execute Track B and inspect the table**

Run: `python scripts/evaluate_track_b.py --checkout-dir /tmp/curatedcrc-upstream.t3YONN --output-dir outputs`

Expected: six 100-fold rows (five cohorts plus Yachida Stage III-IV), five LODO rows, and printed mean ± standard deviation. Confirm Yachida Stage III-IV is compared explicitly to 0.82 and LODO results are compared explicitly to 0.723–0.894.

- [ ] **Step 4: Execute all 50 Track A trials, SHAP, registration, and Staging transition**

Run: `python scripts/train_track_a.py --checkout-dir /tmp/curatedcrc-upstream.t3YONN --max-evals 50 --registered-name crc-curatedcrc-rf --output-dir outputs`

Expected: exactly 50 MLflow trial runs with five metrics each, one best-run tag, one new `crc-curatedcrc-rf` model version in Staging, no Production transition, and saved SHAP artifacts. If the biomarker check exits 2, preserve and report the flagged ranks; do not conceal or override it.

- [ ] **Step 5: Query MLflow for acceptance evidence**

Read back the experiment and assert programmatically:

```python
assert len(trial_runs) == 50
assert all(set(run.data.metrics) >= {"roc_auc", "accuracy", "precision", "recall", "f1"} for run in trial_runs)
assert len([run for run in trial_runs if run.data.tags.get("selection_status") == "best"]) == 1
assert registered_version.name == "crc-curatedcrc-rf"
assert registered_version.current_stage == "Staging"
assert production_after == production_before
```

Compare the before/after run metrics for every pre-existing Production run and assert exact equality.

- [ ] **Step 6: Update README with observed results and verify artifacts**

Record the best run ID/parameters/five metrics, registered version/stage, filtered count, Track B table, LODO table, biomarker ranks/status, and Production snapshot equality. Open the beeswarm PNG and visually confirm labels are legible and the plot is not blank.

- [ ] **Step 7: Run verification-before-completion and commit result artifacts**

Run: `cd mlflow-experiments/curatedcrc-rf && pytest -v`

Run a CSV/JSON schema assertion for all generated files and a read-only MLflow acceptance script. Then stage only curatedCRC experiment/sample/result files and commit:

```bash
git add mlflow-experiments/curatedcrc-rf sample-data/curatedCRC-60-row.csv sample-data/curatedCRC-60-row.manifest.json
git commit -m "feat: complete curatedCRC model retraining"
```

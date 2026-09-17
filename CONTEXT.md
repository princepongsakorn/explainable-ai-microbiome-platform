# Explainable AI Microbiome Platform

A platform that runs trained classifiers over gut-microbiome abundance data and explains each
prediction with SHAP. This glossary fixes the vocabulary, because the same concepts currently carry
several names across the Python, NestJS and frontend layers.

## Language

### The data

**Sample**:
One biological specimen from one person, and therefore one row of the input matrix. This is the
canonical term in the explanation payload and in the `shap-charts` package.
_Avoid_: subject, patient, instance, observation, `subject_id`, `patient_ids`, `sample_id`

**Prediction Record**:
The platform's stored representation of one Sample inside one Prediction — it carries the row's
input values, its predicted class and probability, and its processing status. Same real-world thing
as a Sample, named for the platform layer rather than the science.
_Avoid_: using this term inside the explanation payload or the charts package

**Feature**:
One column of the input matrix. In this project a Feature is a taxon written `Genus_species`.
_Avoid_: variable, column, predictor

**Taxon**:
A named group in the bacterial taxonomy. **Species** is the finest level the data carries; **Genus**
is the level above it, obtained by taking the part of a Feature name before the underscore.

**Relative abundance**:
A Feature's value for a Sample — the fraction of that Sample's microbial community belonging to that
taxon. Zero means the taxon was not detected, and is treated as a true zero rather than missing data.

**Species view / Genus view**:
The two levels at which an explanation can be read. The Genus view is produced by summing the SHAP
values and relative abundances of every Species within each Genus.
_Avoid_: aggregation level, rollup, `aggregate_by`

### The explanation

**SHAP value**:
The signed contribution of one Feature to one Sample's model output, relative to the Base value.
Written φ.
_Avoid_: importance, weight, attribution score, contribution (bare)

**Base value**:
The model output the explainer expects before seeing any Feature — SHAP's `E[f(X)]`. Belongs to a
Sample, even when every Sample in a batch happens to share the same one.
_Avoid_: expected value, baseline, intercept, prior

**Model output**:
The value being explained for one Sample, SHAP's `f(x)`. It always equals the Base value plus the sum
of that Sample's SHAP values.
_Avoid_: prediction (that word means the batch job here), score, probability

These _Avoid_ words bind **code, types and prose** — the names a developer reads. They do not bind
what the interface says to a researcher: the frontend deliberately renders `modelOutput` as
"Prediction" and a probability as "Probability", because those are the words its readers use. That
wording lives in one place, `components/shap/chartCopy.ts`, so the two vocabularies cannot leak into
each other.

**Explanation**:
The full set of SHAP values, relative abundances, Base values and Feature names for a set of Samples
— the thing the Python service computes and the charts package draws.
_Avoid_: SHAP output, explanation data, attribution matrix

**Global explanation / Local explanation**:
A Global explanation reads across all Samples in a Prediction; a Local explanation reads a single
Sample. Beeswarm, bar and heatmap are Global; waterfall is Local.
_Avoid_: summary vs individual, population vs patient, aggregate vs single

**Other features row**:
The single row a chart shows in place of every Feature it did not have room to display, carrying the
sum of their SHAP values. Present in beeswarm, bar, waterfall and heatmap.
_Avoid_: remainder, rest, tail, "Sum of N other features" (that is the rendered label, not the term)

**Explainer**:
The SHAP algorithm bound to a trained model, which turns input rows into SHAP values. Fixed at
training time and stored with the model.

### The work

**Prediction**:
One batch job: a set of Samples submitted together against one model, producing a class and
probability per Sample plus one Explanation for the batch.
_Avoid_: run, job, batch, inference (as a noun)

**Model**:
A trained classifier registered in MLflow under a name and version, bundled with its Explainer.

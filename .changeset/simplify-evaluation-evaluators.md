---
'@hypercerts-org/happyview-modules': minor
'@hypercerts-org/api': minor
---

Evaluation evaluators now have one simple shape: a `did`, plus `profile` and `organization` when they were found. The `hydrationStatus` field is gone and missing values are left out instead of `null`. Only the first 100 evaluators in a response are looked up; later ones carry just the `did`. This also fixes `listEvaluations` and `getEvaluation` failing response validation when evaluators were present.

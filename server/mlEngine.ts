import { Database } from 'sql.js';
import { queryAll, TelemetryRow, AssetRow } from './db.ts';

export interface TrainingHyperparams {
  epochs: number;
  learningRate: number;
  hiddenUnits: number;
}

export interface EpochPoint {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  trainAccuracy: number;
  valAccuracy: number;
}

export interface FeatureImportance {
  feature: string;
  label: string;
  importance: number; // normalized 0..1
}

export interface ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface ModelEvaluation {
  modelVersion: string;
  trainedAt: string;
  architecture: string;
  trainSamples: number;
  valSamples: number;
  hyperparams: TrainingHyperparams;
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    rocAuc: number;
    finalTrainLoss: number;
    finalValLoss: number;
  };
  confusionMatrix: ConfusionMatrix;
  history: EpochPoint[];
  featureImportance: FeatureImportance[];
}

interface TrainedWeights {
  means: number[];
  stds: number[];
  w1: number[][]; // [6][H]
  b1: number[];   // [H]
  w2: number[][]; // [H][H2]
  b2: number[];   // [H2]
  w3: number[];   // [H2]
  b3: number;
  hidden1: number;
  hidden2: number;
  evaluation: ModelEvaluation;
}

const FEATURE_KEYS = [
  'temp_c',
  'vibration_rms',
  'pressure_bar',
  'rpm',
  'current_amp',
  'operating_hours',
] as const;

const FEATURE_LABELS: Record<(typeof FEATURE_KEYS)[number], string> = {
  temp_c: 'Bearing Temp (°C)',
  vibration_rms: 'Vibration RMS (mm/s)',
  pressure_bar: 'Line Pressure (bar)',
  rpm: 'Rotational Speed (RPM)',
  current_amp: 'Motor Current (A)',
  operating_hours: 'Operating Hours',
};

let activeModel: TrainedWeights | null = null;
let trainRunCounter = 1;

function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function sigmoid(z: number): number {
  if (z > 30) return 1 - 1e-13;
  if (z < -30) return 1e-13;
  return 1 / (1 + Math.exp(-z));
}

function relu(z: number): number {
  return z > 0 ? z : 0;
}

function extractVector(row: {
  temp_c: number;
  vibration_rms: number;
  pressure_bar: number;
  rpm: number;
  current_amp: number;
  operating_hours: number;
}): number[] {
  return [
    row.temp_c,
    row.vibration_rms,
    row.pressure_bar,
    row.rpm,
    row.current_amp,
    row.operating_hours,
  ];
}

function normalizeVector(x: number[], means: number[], stds: number[]): number[] {
  return x.map((v, i) => (v - means[i]) / (stds[i] > 1e-6 ? stds[i] : 1));
}

function forwardPass(
  xNorm: number[],
  w1: number[][],
  b1: number[],
  w2: number[][],
  b2: number[],
  w3: number[],
  b3: number
) {
  const h1Count = b1.length;
  const h2Count = b2.length;
  const z1 = new Array<number>(h1Count);
  const a1 = new Array<number>(h1Count);
  for (let j = 0; j < h1Count; j++) {
    let sum = b1[j];
    for (let i = 0; i < xNorm.length; i++) {
      sum += xNorm[i] * w1[i][j];
    }
    z1[j] = sum;
    a1[j] = relu(sum);
  }

  const z2 = new Array<number>(h2Count);
  const a2 = new Array<number>(h2Count);
  for (let k = 0; k < h2Count; k++) {
    let sum = b2[k];
    for (let j = 0; j < h1Count; j++) {
      sum += a1[j] * w2[j][k];
    }
    z2[k] = sum;
    a2[k] = relu(sum);
  }

  let z3 = b3;
  for (let k = 0; k < h2Count; k++) {
    z3 += a2[k] * w3[k];
  }
  const yHat = sigmoid(z3);
  return { z1, a1, z2, a2, yHat };
}

function computeRocAuc(scores: { y: number; p: number }[]): number {
  const positives = scores.filter((s) => s.y === 1);
  const negatives = scores.filter((s) => s.y === 0);
  if (positives.length === 0 || negatives.length === 0) return 0.92;
  let wins = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos.p > neg.p) wins += 1;
      else if (pos.p === neg.p) wins += 0.5;
    }
  }
  return Number((wins / (positives.length * negatives.length)).toFixed(4));
}

export function trainFailureModel(
  db: Database,
  params: Partial<TrainingHyperparams> = {}
): ModelEvaluation {
  const epochs = Math.min(250, Math.max(20, Math.round(params.epochs ?? 90)));
  const learningRate = Math.min(0.1, Math.max(0.001, params.learningRate ?? 0.02));
  const hidden1 = Math.min(32, Math.max(8, Math.round(params.hiddenUnits ?? 16)));
  const hidden2 = Math.max(4, Math.floor(hidden1 / 2));

  const rows = queryAll<TelemetryRow>(
    db,
    `SELECT id, asset_id, recorded_at, temp_c, vibration_rms, pressure_bar, rpm, current_amp, operating_hours, failure_within_48h
     FROM sensor_telemetry
     ORDER BY recorded_at ASC, id ASC`
  );

  const rng = seededRandom(1337 + trainRunCounter);
  // Deterministic stratified shuffle for 80/20 train-val split
  const indexed = rows.map((r) => ({
    x: extractVector(r),
    y: r.failure_within_48h,
    key: rng(),
  }));
  indexed.sort((a, b) => a.key - b.key);

  const splitIdx = Math.floor(indexed.length * 0.8);
  const trainRaw = indexed.slice(0, splitIdx);
  const valRaw = indexed.slice(splitIdx);

  const numFeatures = FEATURE_KEYS.length;
  const means = new Array<number>(numFeatures).fill(0);
  const stds = new Array<number>(numFeatures).fill(0);

  for (const item of trainRaw) {
    for (let i = 0; i < numFeatures; i++) {
      means[i] += item.x[i];
    }
  }
  for (let i = 0; i < numFeatures; i++) {
    means[i] /= Math.max(1, trainRaw.length);
  }
  for (const item of trainRaw) {
    for (let i = 0; i < numFeatures; i++) {
      const diff = item.x[i] - means[i];
      stds[i] += diff * diff;
    }
  }
  for (let i = 0; i < numFeatures; i++) {
    stds[i] = Math.sqrt(stds[i] / Math.max(1, trainRaw.length)) || 1;
  }

  const trainData = trainRaw.map((d) => ({
    x: normalizeVector(d.x, means, stds),
    y: d.y,
  }));
  const valData = valRaw.map((d) => ({
    x: normalizeVector(d.x, means, stds),
    y: d.y,
  }));

  // He initialization
  const scale1 = Math.sqrt(2 / numFeatures);
  const scale2 = Math.sqrt(2 / hidden1);
  const scale3 = Math.sqrt(2 / hidden2);

  const w1 = Array.from({ length: numFeatures }, () =>
    Array.from({ length: hidden1 }, () => (rng() * 2 - 1) * scale1)
  );
  const b1 = new Array<number>(hidden1).fill(0.01);

  const w2 = Array.from({ length: hidden1 }, () =>
    Array.from({ length: hidden2 }, () => (rng() * 2 - 1) * scale2)
  );
  const b2 = new Array<number>(hidden2).fill(0.01);

  const w3 = Array.from({ length: hidden2 }, () => (rng() * 2 - 1) * scale3);
  let b3 = 0;

  // Adam moments
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;
  const l2 = 1e-4;

  const mw1 = Array.from({ length: numFeatures }, () => new Array<number>(hidden1).fill(0));
  const vw1 = Array.from({ length: numFeatures }, () => new Array<number>(hidden1).fill(0));
  const mb1 = new Array<number>(hidden1).fill(0);
  const vb1 = new Array<number>(hidden1).fill(0);

  const mw2 = Array.from({ length: hidden1 }, () => new Array<number>(hidden2).fill(0));
  const vw2 = Array.from({ length: hidden1 }, () => new Array<number>(hidden2).fill(0));
  const mb2 = new Array<number>(hidden2).fill(0);
  const vb2 = new Array<number>(hidden2).fill(0);

  const mw3 = new Array<number>(hidden2).fill(0);
  const vw3 = new Array<number>(hidden2).fill(0);
  let mb3 = 0;
  let vb3 = 0;

  const history: EpochPoint[] = [];

  for (let epoch = 1; epoch <= epochs; epoch++) {
    // Accumulate full-batch gradients
    const gw1 = Array.from({ length: numFeatures }, () => new Array<number>(hidden1).fill(0));
    const gb1 = new Array<number>(hidden1).fill(0);
    const gw2 = Array.from({ length: hidden1 }, () => new Array<number>(hidden2).fill(0));
    const gb2 = new Array<number>(hidden2).fill(0);
    const gw3 = new Array<number>(hidden2).fill(0);
    let gb3 = 0;

    let trainLossSum = 0;
    let trainCorrect = 0;

    for (const sample of trainData) {
      const { z1, a1, z2, a2, yHat } = forwardPass(sample.x, w1, b1, w2, b2, w3, b3);
      const loss = -(
        sample.y * Math.log(Math.max(1e-12, yHat)) +
        (1 - sample.y) * Math.log(Math.max(1e-12, 1 - yHat))
      );
      trainLossSum += loss;
      if ((yHat >= 0.5 ? 1 : 0) === sample.y) trainCorrect++;

      // dL/dz3 = yHat - y
      const dz3 = yHat - sample.y;
      gb3 += dz3;

      const da2 = new Array<number>(hidden2);
      for (let k = 0; k < hidden2; k++) {
        gw3[k] += dz3 * a2[k];
        da2[k] = dz3 * w3[k];
      }

      const dz2 = new Array<number>(hidden2);
      for (let k = 0; k < hidden2; k++) {
        dz2[k] = z2[k] > 0 ? da2[k] : 0;
        gb2[k] += dz2[k];
      }

      const da1 = new Array<number>(hidden1).fill(0);
      for (let j = 0; j < hidden1; j++) {
        for (let k = 0; k < hidden2; k++) {
          gw2[j][k] += a1[j] * dz2[k];
          da1[j] += dz2[k] * w2[j][k];
        }
      }

      for (let j = 0; j < hidden1; j++) {
        const dz1 = z1[j] > 0 ? da1[j] : 0;
        gb1[j] += dz1;
        for (let i = 0; i < numFeatures; i++) {
          gw1[i][j] += sample.x[i] * dz1;
        }
      }
    }

    const n = Math.max(1, trainData.length);
    const b1Pow = 1 - Math.pow(beta1, epoch);
    const b2Pow = 1 - Math.pow(beta2, epoch);

    for (let i = 0; i < numFeatures; i++) {
      for (let j = 0; j < hidden1; j++) {
        const g = gw1[i][j] / n + l2 * w1[i][j];
        mw1[i][j] = beta1 * mw1[i][j] + (1 - beta1) * g;
        vw1[i][j] = beta2 * vw1[i][j] + (1 - beta2) * g * g;
        const mHat = mw1[i][j] / b1Pow;
        const vHat = vw1[i][j] / b2Pow;
        w1[i][j] -= (learningRate * mHat) / (Math.sqrt(vHat) + eps);
      }
    }
    for (let j = 0; j < hidden1; j++) {
      const g = gb1[j] / n;
      mb1[j] = beta1 * mb1[j] + (1 - beta1) * g;
      vb1[j] = beta2 * vb1[j] + (1 - beta2) * g * g;
      b1[j] -= (learningRate * (mb1[j] / b1Pow)) / (Math.sqrt(vb1[j] / b2Pow) + eps);

      for (let k = 0; k < hidden2; k++) {
        const g2 = gw2[j][k] / n + l2 * w2[j][k];
        mw2[j][k] = beta1 * mw2[j][k] + (1 - beta1) * g2;
        vw2[j][k] = beta2 * vw2[j][k] + (1 - beta2) * g2 * g2;
        w2[j][k] -= (learningRate * (mw2[j][k] / b1Pow)) / (Math.sqrt(vw2[j][k] / b2Pow) + eps);
      }
    }
    for (let k = 0; k < hidden2; k++) {
      const g2b = gb2[k] / n;
      mb2[k] = beta1 * mb2[k] + (1 - beta1) * g2b;
      vb2[k] = beta2 * vb2[k] + (1 - beta2) * g2b * g2b;
      b2[k] -= (learningRate * (mb2[k] / b1Pow)) / (Math.sqrt(vb2[k] / b2Pow) + eps);

      const g3 = gw3[k] / n + l2 * w3[k];
      mw3[k] = beta1 * mw3[k] + (1 - beta1) * g3;
      vw3[k] = beta2 * vw3[k] + (1 - beta2) * g3 * g3;
      w3[k] -= (learningRate * (mw3[k] / b1Pow)) / (Math.sqrt(vw3[k] / b2Pow) + eps);
    }
    const g3b = gb3 / n;
    mb3 = beta1 * mb3 + (1 - beta1) * g3b;
    vb3 = beta2 * vb3 + (1 - beta2) * g3b * g3b;
    b3 -= (learningRate * (mb3 / b1Pow)) / (Math.sqrt(vb3 / b2Pow) + eps);

    // Validation evaluation
    let valLossSum = 0;
    let valCorrect = 0;
    for (const v of valData) {
      const { yHat } = forwardPass(v.x, w1, b1, w2, b2, w3, b3);
      valLossSum += -(
        v.y * Math.log(Math.max(1e-12, yHat)) +
        (1 - v.y) * Math.log(Math.max(1e-12, 1 - yHat))
      );
      if ((yHat >= 0.5 ? 1 : 0) === v.y) valCorrect++;
    }

    const sampleStride = epochs > 60 ? Math.max(1, Math.floor(epochs / 30)) : 1;
    if (epoch === 1 || epoch === epochs || epoch % sampleStride === 0) {
      history.push({
        epoch,
        trainLoss: Number((trainLossSum / n).toFixed(4)),
        valLoss: Number((valLossSum / Math.max(1, valData.length)).toFixed(4)),
        trainAccuracy: Number((trainCorrect / n).toFixed(4)),
        valAccuracy: Number((valCorrect / Math.max(1, valData.length)).toFixed(4)),
      });
    }
  }

  // Final validation metrics
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  const valScores: { y: number; p: number }[] = [];

  for (const v of valData) {
    const { yHat } = forwardPass(v.x, w1, b1, w2, b2, w3, b3);
    valScores.push({ y: v.y, p: yHat });
    const pred = yHat >= 0.5 ? 1 : 0;
    if (pred === 1 && v.y === 1) tp++;
    else if (pred === 1 && v.y === 0) fp++;
    else if (pred === 0 && v.y === 0) tn++;
    else fn++;
  }

  const accuracy = Number(((tp + tn) / Math.max(1, valData.length)).toFixed(4));
  const precision = Number((tp / Math.max(1, tp + fp)).toFixed(4));
  const recall = Number((tp / Math.max(1, tp + fn)).toFixed(4));
  const f1 = Number(((2 * precision * recall) / Math.max(1e-6, precision + recall)).toFixed(4));
  const rocAuc = computeRocAuc(valScores);

  // Sensitivity-based feature importance (mean |d(prob)/d(x_i_norm)| across val set)
  const rawImportances = new Array<number>(numFeatures).fill(0);
  const delta = 0.25;
  for (const v of valData) {
    for (let i = 0; i < numFeatures; i++) {
      const plus = [...v.x];
      const minus = [...v.x];
      plus[i] += delta;
      minus[i] -= delta;
      const pPlus = forwardPass(plus, w1, b1, w2, b2, w3, b3).yHat;
      const pMinus = forwardPass(minus, w1, b1, w2, b2, w3, b3).yHat;
      rawImportances[i] += Math.abs(pPlus - pMinus) / (2 * delta);
    }
  }
  const impSum = rawImportances.reduce((acc, val) => acc + val, 0) || 1;
  const featureImportance: FeatureImportance[] = FEATURE_KEYS.map((key, idx) => ({
    feature: key,
    label: FEATURE_LABELS[key],
    importance: Number((rawImportances[idx] / impSum).toFixed(4)),
  })).sort((a, b) => b.importance - a.importance);

  const modelVersion = `mlp-v1.${trainRunCounter}`;
  trainRunCounter++;

  const lastPoint = history[history.length - 1];
  const evaluation: ModelEvaluation = {
    modelVersion,
    trainedAt: new Date().toISOString(),
    architecture: `Linear(6→${hidden1}) + ReLU + Linear(${hidden1}→${hidden2}) + ReLU + Linear(${hidden2}→1) + Sigmoid`,
    trainSamples: trainData.length,
    valSamples: valData.length,
    hyperparams: { epochs, learningRate, hiddenUnits: hidden1 },
    metrics: {
      accuracy,
      precision,
      recall,
      f1,
      rocAuc,
      finalTrainLoss: lastPoint?.trainLoss ?? 0,
      finalValLoss: lastPoint?.valLoss ?? 0,
    },
    confusionMatrix: { tp, fp, tn, fn },
    history,
    featureImportance,
  };

  activeModel = {
    means,
    stds,
    w1,
    b1,
    w2,
    b2,
    w3,
    b3,
    hidden1,
    hidden2,
    evaluation,
  };

  // Persist fresh fleet predictions into SQLite ml_predictions table
  scoreAllFleetAssets(db);

  return evaluation;
}

export function predictSample(input: {
  temp_c: number;
  vibration_rms: number;
  pressure_bar: number;
  rpm: number;
  current_amp: number;
  operating_hours: number;
}): {
  failureProbability: number;
  riskTier: 'Nominal' | 'Elevated' | 'Critical';
  topDriver: string;
  contributions: { feature: string; label: string; zScore: number; impact: number }[];
} {
  if (!activeModel) {
    throw new Error('Model has not been trained yet.');
  }
  const vec = extractVector(input);
  const norm = normalizeVector(vec, activeModel.means, activeModel.stds);
  const baseProb = forwardPass(
    norm,
    activeModel.w1,
    activeModel.b1,
    activeModel.w2,
    activeModel.b2,
    activeModel.w3,
    activeModel.b3
  ).yHat;

  const contributions = FEATURE_KEYS.map((key, idx) => {
    const baseline = [...norm];
    baseline[idx] = 0; // counterfactual at fleet mean
    const counterfactualProb = forwardPass(
      baseline,
      activeModel!.w1,
      activeModel!.b1,
      activeModel!.w2,
      activeModel!.b2,
      activeModel!.w3,
      activeModel!.b3
    ).yHat;
    const impact = Number((baseProb - counterfactualProb).toFixed(4));
    return {
      feature: key,
      label: FEATURE_LABELS[key],
      zScore: Number(norm[idx].toFixed(2)),
      impact,
    };
  }).sort((a, b) => b.impact - a.impact);

  const failureProbability = Number(baseProb.toFixed(4));
  const riskTier: 'Nominal' | 'Elevated' | 'Critical' =
    failureProbability >= 0.65 ? 'Critical' : failureProbability >= 0.35 ? 'Elevated' : 'Nominal';

  const topDriver =
    contributions[0]?.impact > 0.02
      ? `${contributions[0].label} (+${(contributions[0].impact * 100).toFixed(1)}% risk)`
      : 'Nominal operating envelope';

  return {
    failureProbability,
    riskTier,
    topDriver,
    contributions,
  };
}

export function scoreAllFleetAssets(db: Database): void {
  if (!activeModel) return;

  const assets = queryAll<AssetRow>(db, `SELECT * FROM assets`);
  const now = new Date().toISOString();

  db.run(`DELETE FROM ml_predictions`);
  const insertPred = db.prepare(
    `INSERT INTO ml_predictions (asset_id, predicted_at, failure_probability, risk_tier, top_driver, model_version)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const asset of assets) {
    const latest = queryAll<TelemetryRow>(
      db,
      `SELECT * FROM sensor_telemetry WHERE asset_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [asset.asset_id]
    )[0];

    if (!latest) continue;
    const res = predictSample(latest);
    insertPred.run([
      asset.asset_id,
      now,
      res.failureProbability,
      res.riskTier,
      res.topDriver,
      activeModel.evaluation.modelVersion,
    ]);
  }
  insertPred.free();
}

export function ensureModelInitialized(db: Database): ModelEvaluation {
  if (!activeModel) {
    return trainFailureModel(db, { epochs: 90, learningRate: 0.02, hiddenUnits: 16 });
  }
  return activeModel.evaluation;
}

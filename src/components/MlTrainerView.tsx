import React, { useEffect, useState } from 'react';
import { Check, Copy, Play, SlidersHorizontal } from 'lucide-react';
import { CodeArtifacts, ModelEvaluation } from '../types';

interface MlTrainerViewProps {
  evaluation: ModelEvaluation | null;
  artifacts: CodeArtifacts | null;
  onModelTrained: (ev: ModelEvaluation, art: CodeArtifacts) => Promise<void>;
}

function TrainingCurvesChart({ evaluation }: { evaluation: ModelEvaluation }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pts = evaluation.history;
  if (pts.length < 2) return null;

  const width = 520;
  const height = 210;
  const padX = 42;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const maxLoss = Math.max(0.8, ...pts.map((p) => Math.max(p.trainLoss, p.valLoss)));
  const toX = (i: number) => padX + (i / (pts.length - 1)) * innerW;
  const toYLoss = (val: number) => padY + innerH - (val / maxLoss) * innerH;
  const toYAcc = (val: number) => padY + innerH - val * innerH;

  const trainLossD = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toYLoss(p.trainLoss).toFixed(1)}`)
    .join(' ');
  const valLossD = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toYLoss(p.valLoss).toFixed(1)}`)
    .join(' ');
  const valAccD = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toYAcc(p.valAccuracy).toFixed(1)}`)
    .join(' ');

  const active = hoverIdx !== null ? pts[hoverIdx] : pts[pts.length - 1];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            BCE Loss &amp; Validation Accuracy Convergence
          </h3>
          <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
            Epoch {active.epoch} · Train Loss {active.trainLoss.toFixed(4)} · Val Loss{' '}
            {active.valLoss.toFixed(4)} · Val Acc {(active.valAccuracy * 100).toFixed(1)}%
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-blue-600 inline-block" />
            Train Loss
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-600 inline-block" />
            Val Loss
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-600 inline-block" />
            Val Accuracy
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-52 cursor-crosshair select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={width - padX}
            y1={padY + innerH * f}
            y2={padY + innerH * f}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        ))}
        <path d={trainLossD} fill="none" stroke="#2563eb" strokeWidth="2" />
        <path d={valLossD} fill="none" stroke="#d97706" strokeWidth="2" strokeDasharray="5 3" />
        <path d={valAccD} fill="none" stroke="#16a34a" strokeWidth="2" />

        {hoverIdx !== null && (
          <line
            x1={toX(hoverIdx)}
            x2={toX(hoverIdx)}
            y1={padY}
            y2={padY + innerH}
            stroke="#94a3b8"
            strokeWidth="1"
          />
        )}

        {pts.map((p, i) => (
          <rect
            key={p.epoch}
            x={toX(i) - innerW / Math.max(1, pts.length * 2)}
            y={padY}
            width={innerW / Math.max(1, pts.length)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}
      </svg>
    </div>
  );
}

export const MlTrainerView: React.FC<MlTrainerViewProps> = ({
  evaluation,
  artifacts,
  onModelTrained,
}) => {
  const [epochs, setEpochs] = useState(evaluation?.hyperparams.epochs ?? 90);
  const [learningRate, setLearningRate] = useState(evaluation?.hyperparams.learningRate ?? 0.02);
  const [hiddenUnits, setHiddenUnits] = useState(evaluation?.hyperparams.hiddenUnits ?? 16);
  const [training, setTraining] = useState(false);

  // What-if Interactive Inference Simulator
  const [simInput, setSimInput] = useState({
    temp_c: 82.0,
    vibration_rms: 3.9,
    pressure_bar: 10.4,
    rpm: 2900,
    current_amp: 58.0,
    operating_hours: 19500,
  });
  const [simResult, setSimResult] = useState<{
    failureProbability: number;
    riskTier: string;
    topDriver: string;
    contributions: { feature: string; label: string; zScore: number; impact: number }[];
  } | null>(null);

  // Exportable Code Tab (PyTorch vs TensorFlow)
  const [codeTab, setCodeTab] = useState<'pytorch' | 'tensorflow'>('pytorch');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ml/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simInput),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && !data.error) setSimResult(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [simInput, evaluation?.modelVersion]);

  const handleTrain = async () => {
    setTraining(true);
    try {
      const resp = await fetch('/api/ml/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epochs, learningRate, hiddenUnits }),
      });
      const data = await resp.json();
      if (resp.ok) {
        await onModelTrained(data.evaluation, data.artifacts);
      }
    } finally {
      setTraining(false);
    }
  };

  const handleCopyCode = async () => {
    if (!artifacts) return;
    const text = codeTab === 'pytorch' ? artifacts.pytorchScript : artifacts.tensorflowScript;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!evaluation) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500">
        Loading neural model telemetry...
      </div>
    );
  }

  const cm = evaluation.confusionMatrix;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Hyperparameter & Architecture Column */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">01. Neural Model Trainer</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Supervised 80/20 split over SQLite <span className="font-mono">sensor_telemetry</span>
              </p>
            </div>
            <SlidersHorizontal className="w-4 h-4 text-slate-400" />
          </div>

          <div className="text-xs bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1">
            <div className="text-slate-500">Active Architecture</div>
            <div className="font-mono text-slate-800 break-words">{evaluation.architecture}</div>
            <div className="text-slate-500 font-mono tabular-nums pt-1">
              {evaluation.trainSamples} train · {evaluation.valSamples} validation samples
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <span>Training Epochs</span>
                <span className="font-mono tabular-nums text-slate-900">{epochs}</span>
              </div>
              <input
                type="range"
                min={20}
                max={200}
                step={10}
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value))}
                className="w-full mt-1.5 accent-blue-600"
              />
            </label>

            <div>
              <div className="text-xs font-medium text-slate-700 mb-1.5">Adam Learning Rate</div>
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-md">
                {[0.005, 0.01, 0.02, 0.05].map((lr) => (
                  <button
                    key={lr}
                    type="button"
                    onClick={() => setLearningRate(lr)}
                    className={`py-1 text-xs font-mono tabular-nums rounded transition-colors ${
                      learningRate === lr
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {lr}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700 mb-1.5">
                Hidden Layer Width (Layer 1)
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md">
                {[8, 16, 32].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setHiddenUnits(w)}
                    className={`py-1 text-xs font-mono tabular-nums rounded transition-colors ${
                      hiddenUnits === w
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {w} units
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTrain}
            disabled={training}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            {training ? 'Training Neural Network...' : 'Retrain Model & Update SQL Predictions'}
          </button>
        </div>

        {/* Right Evaluation Metrics & Charts */}
        <div className="lg:col-span-8 space-y-6">
          {/* Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'ROC-AUC', value: evaluation.metrics.rocAuc.toFixed(4) },
              {
                label: 'Val Accuracy',
                value: `${(evaluation.metrics.accuracy * 100).toFixed(1)}%`,
              },
              {
                label: 'Precision',
                value: `${(evaluation.metrics.precision * 100).toFixed(1)}%`,
              },
              { label: 'Recall', value: `${(evaluation.metrics.recall * 100).toFixed(1)}%` },
              { label: 'F1 Score', value: evaluation.metrics.f1.toFixed(3) },
            ].map((m) => (
              <div key={m.label} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500">{m.label}</div>
                <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          <TrainingCurvesChart evaluation={evaluation} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Feature Sensitivity Importance */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Learned Feature Sensitivity
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Mean gradient attribution across validation telemetry
              </p>
              <div className="space-y-3">
                {evaluation.featureImportance.map((f) => (
                  <div key={f.feature} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-700 font-medium">{f.label}</span>
                      <span className="font-mono tabular-nums text-slate-600">
                        {(f.importance * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-600"
                        style={{ width: `${Math.min(100, f.importance * 100 * 2.2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Validation Confusion Matrix */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                Validation Confusion Matrix
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                48-hour binary failure classification (threshold = 0.50)
              </p>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="border border-emerald-200 bg-emerald-50/50 rounded-md p-4">
                  <div className="text-xs text-emerald-800 font-medium">True Positive</div>
                  <div className="text-2xl font-semibold font-mono tabular-nums text-emerald-900 mt-1">
                    {cm.tp}
                  </div>
                </div>
                <div className="border border-amber-200 bg-amber-50/50 rounded-md p-4">
                  <div className="text-xs text-amber-800 font-medium">False Positive</div>
                  <div className="text-2xl font-semibold font-mono tabular-nums text-amber-900 mt-1">
                    {cm.fp}
                  </div>
                </div>
                <div className="border border-rose-200 bg-rose-50/50 rounded-md p-4">
                  <div className="text-xs text-rose-800 font-medium">False Negative</div>
                  <div className="text-2xl font-semibold font-mono tabular-nums text-rose-900 mt-1">
                    {cm.fn}
                  </div>
                </div>
                <div className="border border-slate-200 bg-slate-50 rounded-md p-4">
                  <div className="text-xs text-slate-600 font-medium">True Negative</div>
                  <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900 mt-1">
                    {cm.tn}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive What-If Inference Simulator */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 mb-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              02. Real-Time Neural Failure Probability Simulator
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Adjust live sensor readings to inspect counterfactual risk drivers and predicted 48h failure probability.
            </p>
          </div>
          {simResult && (
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-xs text-slate-500">Predicted Failure Risk</div>
                <div
                  className={`text-2xl font-semibold font-mono tabular-nums ${
                    simResult.riskTier === 'Critical'
                      ? 'text-rose-700'
                      : simResult.riskTier === 'Elevated'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                  }`}
                >
                  {(simResult.failureProbability * 100).toFixed(1)}% ({simResult.riskTier})
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: 'temp_c', label: 'Bearing Temp (°C)', min: 45, max: 105, step: 0.5 },
              { key: 'vibration_rms', label: 'Vibration RMS (mm/s)', min: 0.5, max: 6.5, step: 0.1 },
              { key: 'pressure_bar', label: 'Line Pressure (bar)', min: 2, max: 200, step: 1 },
              { key: 'rpm', label: 'Speed (RPM)', min: 1000, max: 13000, step: 100 },
              { key: 'current_amp', label: 'Motor Current (A)', min: 20, max: 85, step: 0.5 },
              { key: 'operating_hours', label: 'Operating Hours', min: 2000, max: 35000, step: 500 },
            ].map((field) => {
              const val = simInput[field.key as keyof typeof simInput];
              return (
                <label key={field.key} className="block border border-slate-200 rounded-md p-3">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-slate-700">{field.label}</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {val}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={val}
                    onChange={(e) =>
                      setSimInput((prev) => ({
                        ...prev,
                        [field.key]: Number(e.target.value),
                      }))
                    }
                    className="w-full mt-2 accent-blue-600"
                  />
                </label>
              );
            })}
          </div>

          <div className="lg:col-span-5 border border-slate-200 rounded-md p-4 bg-slate-50/50">
            <h3 className="text-xs font-semibold text-slate-900 mb-3">
              Counterfactual Risk Attribution
            </h3>
            {simResult ? (
              <div className="space-y-2.5">
                {simResult.contributions.map((c) => {
                  const pct = c.impact * 100;
                  return (
                    <div key={c.feature} className="flex items-center justify-between text-xs gap-3">
                      <span className="text-slate-700 truncate">{c.label}</span>
                      <span
                        className={`font-mono tabular-nums shrink-0 ${
                          pct > 2 ? 'text-rose-700 font-medium' : pct < -2 ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {pct >= 0 ? '+' : ''}
                        {pct.toFixed(1)}% (z={c.zScore >= 0 ? '+' : ''}
                        {c.zScore})
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Computing inference...</p>
            )}
          </div>
        </div>
      </div>

      {/* Exportable PyTorch & TensorFlow Training Scripts */}
      {artifacts && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                03. Exportable Python ML Training Pipeline
              </h2>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                <button
                  type="button"
                  onClick={() => setCodeTab('pytorch')}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    codeTab === 'pytorch'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  PyTorch (train_failure_model.py)
                </button>
                <button
                  type="button"
                  onClick={() => setCodeTab('tensorflow')}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    codeTab === 'tensorflow'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  TensorFlow (train_tf_model.py)
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Script'}
            </button>
          </div>
          <pre className="p-5 text-xs font-mono text-slate-800 bg-slate-50 overflow-x-auto leading-relaxed">
            <code>
              {codeTab === 'pytorch' ? artifacts.pytorchScript : artifacts.tensorflowScript}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
};

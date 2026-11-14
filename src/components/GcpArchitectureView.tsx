import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, Copy, Database, Layers } from 'lucide-react';
import { CodeArtifacts } from '../types';

interface GcpArchitectureViewProps {
  artifacts: CodeArtifacts | null;
}

interface PipelineNode {
  id: string;
  stage: string;
  service: string;
  role: string;
  latency: string;
  storageFormat: string;
  scalingStrategy: string;
  details: string[];
}

const PIPELINE_NODES: PipelineNode[] = [
  {
    id: 'ingest',
    stage: '01. Ingestion',
    service: 'Cloud Pub/Sub',
    role: 'Decoupled high-throughput telemetry broker',
    latency: '< 50 ms p99',
    storageFormat: 'Protobuf / Avro sensor frames',
    scalingStrategy: 'Partitioned by plant_location topic; auto-scales to millions of msg/sec.',
    details: [
      'Edge OPC-UA / MQTT gateways batch 6-channel sensor frames (temp, vibration, pressure, RPM, current, hours).',
      'Dead-letter topic captures malformed payloads without halting downstream streaming.',
      'Provides 7-day replay buffer for Dataflow pipeline upgrades or backfills.',
    ],
  },
  {
    id: 'stream',
    stage: '02. Stream ETL',
    service: 'Cloud Dataflow',
    role: 'Apache Beam windowing, feature enrichment & routing',
    latency: '1 - 5 sec window',
    storageFormat: 'Normalized feature vectors',
    scalingStrategy: 'Horizontal autoscaling workers based on Pub/Sub unacked message backlog.',
    details: [
      'Computes rolling RMS, delta-T gradients, and z-score normalization in 60s sliding windows.',
      'Dual-writes: high-frequency time-series append to BigQuery Storage Write API; latest asset snapshot & alerts upsert to Cloud SQL.',
      'Triggers Cloud Run ML scoring webhook when vibration or bearing temperature crosses OEM warning bands.',
    ],
  },
  {
    id: 'oltp',
    stage: '03A. Operational Store',
    service: 'Cloud SQL (PostgreSQL + pgvector)',
    role: 'Low-latency asset state, technician logs & vector embeddings',
    latency: '< 8 ms point lookup',
    storageFormat: 'Relational B-Tree + HNSW pgvector index',
    scalingStrategy: 'Regional HA primary + read replicas dedicated to the Text-to-SQL / RAG agent.',
    details: [
      'Stores normalized assets, maintenance_logs, work orders, and live ml_predictions.',
      'Stores 768-d Gemini embeddings (gemini-embedding-2) inside pgvector for semantic log retrieval.',
      'Serves operational dashboards and technician mobile apps with ACID guarantees.',
    ],
  },
  {
    id: 'olap',
    stage: '03B. Data Warehouse',
    service: 'BigQuery',
    role: 'Petabyte-scale historical telemetry & fleet-wide SQL analytics',
    latency: '0.8 - 2.5 sec scan',
    storageFormat: 'Capacitor columnar, partitioned & clustered',
    scalingStrategy: 'Serverless slot autoscaling; daily DATE(recorded_at) partitioning + CLUSTER BY asset_id.',
    details: [
      'Partitioning by DATE(recorded_at) and clustering by (asset_id, failure_within_48h) cuts analytical query scan costs by >90%.',
      'BigQuery Storage Write API ingests millions of rows/sec with zero batch-load lag.',
      'Federated EXTERNAL_QUERY joins historical BigQuery sensor windows directly with Cloud SQL maintenance logs.',
    ],
  },
  {
    id: 'ml',
    stage: '04. ML Training & Serving',
    service: 'Vertex AI & BigQuery ML',
    role: 'Scheduled retraining, drift monitoring & real-time inference',
    latency: '15 ms online prediction',
    storageFormat: 'PyTorch / SavedModel + BigQuery ML DNN',
    scalingStrategy: 'Vertex AI Pipelines retrain weekly on 90-day BigQuery snapshots; Cloud Run / Vertex Endpoint auto-scales replicas.',
    details: [
      'BigQuery ML enables rapid SQL-native baseline models (DNN_CLASSIFIER / LOGISTIC_REG) without data movement.',
      'Custom PyTorch / TensorFlow MLP trains on Vertex AI Training with GPU/CPU spot VMs reading via BigQuery Storage Read API.',
      'Vertex Model Monitoring tracks feature skew (e.g., seasonal ambient temp shift) and alerts if ROC-AUC drops below 0.88.',
    ],
  },
  {
    id: 'agent',
    stage: '05. AI Engineering',
    service: 'Cloud Run + Gemini API',
    role: 'Hybrid Text-to-SQL & RAG Reliability Assistant',
    latency: '1.1 - 2.4 sec end-to-end',
    storageFormat: 'Stateless container + IAM read-only DB role',
    scalingStrategy: 'Scale-to-zero or min-instances=1 Cloud Run service with strict least-privilege SQL role.',
    details: [
      'Routes analytical aggregations ("90-day failure trends by plant") to BigQuery and operational queries ("open work orders & logs") to Cloud SQL.',
      'Executes generated SQL under a strictly read-only database service account with statement timeout and row limits.',
      'Fuses live SQL rows with pgvector-retrieved maintenance logs and OEM manuals before Gemini synthesis.',
    ],
  },
];

export const GcpArchitectureView: React.FC<GcpArchitectureViewProps> = ({ artifacts }) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('olap');
  const [assetCount, setAssetCount] = useState<number>(2500);
  const [intervalSec, setIntervalSec] = useState<number>(10);
  const [retentionDays, setRetentionDays] = useState<number>(365);
  const [copiedSql, setCopiedSql] = useState(false);

  const selectedNode = useMemo(
    () => PIPELINE_NODES.find((n) => n.id === selectedNodeId) ?? PIPELINE_NODES[3],
    [selectedNodeId]
  );

  // Realistic GCP capacity & cost projection math
  const metrics = useMemo(() => {
    const eventsPerSec = assetCount / intervalSec;
    const eventsPerDay = eventsPerSec * 86400;
    const bytesPerEvent = 160; // uncompressed JSON/row ~160 bytes
    const rawGbPerDay = (eventsPerDay * bytesPerEvent) / 1e9;
    const compressionRatio = 0.22; // BigQuery Capacitor ~4.5x compression
    const storedTbTotal = (rawGbPerDay * retentionDays * compressionRatio) / 1000;
    // BigQuery Storage Write API (~$0.025 per GB after free tier) + Active/Long-term storage (~$20/TB/mo)
    const monthlyIngestionGb = rawGbPerDay * 30;
    const streamingCostMonthly = Math.max(0, (monthlyIngestionGb - 2000) * 0.025);
    const storageCostMonthly = storedTbTotal * 20;
    const cloudSqlMonthly = assetCount > 5000 ? 420 : assetCount > 1000 ? 185 : 75;

    return {
      eventsPerSec: eventsPerSec.toFixed(1),
      eventsPerDayMillions: (eventsPerDay / 1e6).toFixed(2),
      rawGbPerDay: rawGbPerDay.toFixed(2),
      storedTbTotal: storedTbTotal.toFixed(2),
      estimatedMonthlyUsd: Math.round(streamingCostMonthly + storageCostMonthly + cloudSqlMonthly),
    };
  }, [assetCount, intervalSec, retentionDays]);

  const handleCopySql = async () => {
    if (!artifacts) return;
    await navigator.clipboard.writeText(artifacts.bigquerySql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 1800);
  };

  return (
    <div className="space-y-6">
      {/* Architecture Topology Section */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            01. Google Cloud Production Data Warehouse &amp; ML Pipeline
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Select any stage in the pipeline below to inspect how local SQLite + MLP prototypes scale to BigQuery, Cloud SQL, and Vertex AI.
          </p>
        </div>

        {/* Interactive Pipeline Nodes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-stretch">
          {PIPELINE_NODES.map((node, index) => {
            const active = node.id === selectedNodeId;
            return (
              <div key={node.id} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`flex-1 text-left p-3.5 rounded-md border transition-colors flex flex-col justify-between ${
                    active
                      ? 'bg-blue-50/70 border-blue-600'
                      : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <div>
                    <div className="text-xs font-mono text-slate-500">{node.stage}</div>
                    <div className="text-sm font-semibold text-slate-900 mt-1">{node.service}</div>
                  </div>
                  <div className="mt-3 text-xs font-mono tabular-nums text-blue-700">
                    {node.latency}
                  </div>
                </button>
                {index < PIPELINE_NODES.length - 1 && (
                  <div className="hidden lg:flex items-center text-slate-300 shrink-0">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Selected Node Deep-Dive Panel */}
        <div className="border border-slate-200 rounded-md p-5 bg-slate-50/40 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-3">
            <div className="text-xs font-mono text-slate-500">{selectedNode.stage}</div>
            <h3 className="text-base font-semibold text-slate-900">{selectedNode.service}</h3>
            <p className="text-sm text-slate-700">{selectedNode.role}</p>
            <div className="pt-2 space-y-2 text-xs">
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">Storage / Wire Format</span>
                <span className="font-mono text-slate-800">{selectedNode.storageFormat}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">Target Latency</span>
                <span className="font-mono text-slate-800">{selectedNode.latency}</span>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">Scaling Strategy</span>
                <span className="text-slate-800">{selectedNode.scalingStrategy}</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6 space-y-2.5">
            <div className="text-xs font-semibold text-slate-900">
              Engineering Implementation Notes
            </div>
            <ul className="space-y-2 text-xs text-slate-700 list-disc pl-4 leading-relaxed">
              {selectedNode.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Interactive Fleet Scaling & BigQuery Cost Simulator */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            02. Warehouse Ingestion &amp; Storage Scale Simulator
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Model daily Pub/Sub throughput, BigQuery partitioned table growth, and hybrid Cloud SQL + BigQuery sizing as your monitored fleet expands.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block border border-slate-200 rounded-md p-3.5">
            <div className="flex justify-between text-xs font-medium text-slate-700">
              <span>Fleet Asset Count</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {assetCount.toLocaleString()} assets
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={25000}
              step={50}
              value={assetCount}
              onChange={(e) => setAssetCount(Number(e.target.value))}
              className="w-full mt-2 accent-blue-600"
            />
          </label>

          <label className="block border border-slate-200 rounded-md p-3.5">
            <div className="flex justify-between text-xs font-medium text-slate-700">
              <span>Sensor Polling Interval</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                Every {intervalSec}s
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
              className="w-full mt-2 accent-blue-600"
            />
          </label>

          <label className="block border border-slate-200 rounded-md p-3.5">
            <div className="flex justify-between text-xs font-medium text-slate-700">
              <span>BigQuery Partition Retention</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {retentionDays} days
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={1095}
              step={15}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="w-full mt-2 accent-blue-600"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="border border-slate-200 rounded-md p-4 bg-slate-50/50">
            <div className="text-xs text-slate-500">Pub/Sub Throughput</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {metrics.eventsPerSec} <span className="text-xs font-normal text-slate-500">msg/s</span>
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-4 bg-slate-50/50">
            <div className="text-xs text-slate-500">Daily Telemetry Rows</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {metrics.eventsPerDayMillions} <span className="text-xs font-normal text-slate-500">M/day</span>
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-4 bg-slate-50/50">
            <div className="text-xs text-slate-500">Raw Daily Ingestion</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {metrics.rawGbPerDay} <span className="text-xs font-normal text-slate-500">GB/day</span>
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-4 bg-slate-50/50">
            <div className="text-xs text-slate-500">BigQuery Compressed</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
              {metrics.storedTbTotal} <span className="text-xs font-normal text-slate-500">TB</span>
            </div>
          </div>
          <div className="border border-slate-200 rounded-md p-4 bg-slate-50/50">
            <div className="text-xs text-slate-500">Est. DB + Stream Spend</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-blue-700">
              ${metrics.estimatedMonthlyUsd.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-500">/mo</span>
            </div>
          </div>
        </div>

        {/* Hybrid Routing Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="border border-slate-200 rounded-md p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Database className="w-4 h-4 text-blue-600" />
              Cloud SQL (PostgreSQL) — Operational OLTP + RAG Store
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Handles point lookups by <span className="font-mono">asset_id</span>, latest machine risk scores (<span className="font-mono">ml_predictions</span>), transactional work orders, and <span className="font-mono">pgvector</span> similarity search over maintenance logs in &lt;10 ms.
            </p>
          </div>
          <div className="border border-slate-200 rounded-md p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Layers className="w-4 h-4 text-blue-600" />
              BigQuery — Analytical OLAP + ML Feature Warehouse
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Handles multi-month fleet aggregations, sliding-window feature generation, and BigQuery ML training across billions of time-series rows using <span className="font-mono">DATE(recorded_at)</span> partitioning and <span className="font-mono">CLUSTER BY asset_id</span>.
            </p>
          </div>
        </div>
      </div>

      {/* BigQuery Partitioned DDL & Federated Query Artifact */}
      {artifacts && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                03. BigQuery Partitioned Schema, BigQuery ML &amp; Cloud SQL Federated Query
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Production SQL blueprint synced with your current neural network hyperparameters.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopySql}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {copiedSql ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedSql ? 'Copied' : 'Copy BigQuery SQL'}
            </button>
          </div>
          <pre className="p-5 text-xs font-mono text-slate-800 bg-slate-50 overflow-x-auto leading-relaxed">
            <code>{artifacts.bigquerySql}</code>
          </pre>
        </div>
      )}
    </div>
  );
};

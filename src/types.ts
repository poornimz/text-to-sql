export interface AssetTelemetry {
  id: number;
  asset_id: string;
  recorded_at: string;
  temp_c: number;
  vibration_rms: number;
  pressure_bar: number;
  rpm: number;
  current_amp: number;
  operating_hours: number;
  failure_within_48h: number;
}

export interface AssetPrediction {
  prediction_id: number;
  asset_id: string;
  predicted_at: string;
  failure_probability: number;
  risk_tier: 'Nominal' | 'Elevated' | 'Critical';
  top_driver: string;
  model_version: string;
}

export interface FleetAsset {
  asset_id: string;
  name: string;
  category: string;
  plant_location: string;
  manufacturer: string;
  install_date: string;
  criticality: 'Tier-1' | 'Tier-2' | 'Tier-3';
  nominal_rpm: number;
  max_temp_c: number;
  max_vibration_rms: number;
  latestTelemetry: AssetTelemetry | null;
  prediction: AssetPrediction | null;
  trend: { temp_c: number; vibration_rms: number; recorded_at: string }[];
  logCount: number;
  criticalLogCount: number;
}

export interface FleetSummary {
  totalAssets: number;
  criticalCount: number;
  elevatedCount: number;
  nominalCount: number;
  totalTelemetryRows: number;
  totalLogs: number;
  modelVersion: string;
  rocAuc: number;
}

export interface MaintenanceLog {
  log_id: string;
  asset_id: string;
  logged_at: string;
  technician: string;
  severity: 'Info' | 'Warning' | 'Critical';
  fault_code: string;
  summary: string;
  resolution_notes: string;
  asset_name?: string;
  plant_location?: string;
  relevanceScore?: number;
}

export interface EpochPoint {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  trainAccuracy: number;
  valAccuracy: number;
}

export interface ModelEvaluation {
  modelVersion: string;
  trainedAt: string;
  architecture: string;
  trainSamples: number;
  valSamples: number;
  hyperparams: {
    epochs: number;
    learningRate: number;
    hiddenUnits: number;
  };
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    rocAuc: number;
    finalTrainLoss: number;
    finalValLoss: number;
  };
  confusionMatrix: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  history: EpochPoint[];
  featureImportance: {
    feature: string;
    label: string;
    importance: number;
  }[];
}

export interface CodeArtifacts {
  pytorchScript: string;
  tensorflowScript: string;
  pythonAgentScript: string;
  bigquerySql: string;
}

export interface SqlExecutionResult {
  columns: string[];
  rows: Record<string, unknown>[];
  executionMs: number;
  rowCount: number;
}

export interface AgentQueryResponse {
  question: string;
  intent: 'sql_only' | 'rag_only' | 'hybrid';
  reasoning: string;
  sqlQuery: string | null;
  sqlResult: SqlExecutionResult | null;
  sqlError: string | null;
  sqlRepaired: boolean;
  retrievedLogs: MaintenanceLog[];
  answer: string;
  recommendedActions: string[];
  followUpQuestions: string[];
  latencyMs: number;
}

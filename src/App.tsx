import { useCallback, useEffect, useState } from 'react';
import { CodeArtifacts, FleetAsset, FleetSummary, ModelEvaluation } from './types';
import { FleetTelemetryView } from './components/FleetTelemetryView';
import { MlTrainerView } from './components/MlTrainerView';
import { RagSqlAgentView } from './components/RagSqlAgentView';
import { GcpArchitectureView } from './components/GcpArchitectureView';

type ActiveTab = 'fleet' | 'ml' | 'agent' | 'gcp';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('fleet');
  const [assets, setAssets] = useState<FleetAsset[]>([]);
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [schemaDdl, setSchemaDdl] = useState<string>('');
  const [fleetLoading, setFleetLoading] = useState<boolean>(true);
  const [scoringBusy, setScoringBusy] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<ModelEvaluation | null>(null);
  const [artifacts, setArtifacts] = useState<CodeArtifacts | null>(null);
  const [queuedAgentQuestion, setQueuedAgentQuestion] = useState<string | null>(null);

  const loadFleet = useCallback(async () => {
    setFleetLoading(true);
    try {
      const resp = await fetch('/api/fleet');
      const data = await resp.json();
      if (resp.ok) {
        setAssets(data.assets ?? []);
        setSummary(data.summary ?? null);
        setSchemaDdl(data.schemaDdl ?? '');
      }
    } finally {
      setFleetLoading(false);
    }
  }, []);

  const loadMlStatus = useCallback(async () => {
    const resp = await fetch('/api/ml/status');
    const data = await resp.json();
    if (resp.ok) {
      setEvaluation(data.evaluation);
      setArtifacts(data.artifacts);
    }
  }, []);

  useEffect(() => {
    loadFleet();
    loadMlStatus();
  }, [loadFleet, loadMlStatus]);

  const handleScoreFleet = async () => {
    setScoringBusy(true);
    try {
      await fetch('/api/ml/score-fleet', { method: 'POST' });
      await loadFleet();
    } finally {
      setScoringBusy(false);
    }
  };

  const handleModelTrained = async (ev: ModelEvaluation, art: CodeArtifacts) => {
    setEvaluation(ev);
    setArtifacts(art);
    await loadFleet();
  };

  const handleAskAgentAboutAsset = (assetId: string) => {
    setQueuedAgentQuestion(
      `Analyze the latest sensor readings, failure probability, and recent maintenance logs for asset ${assetId}. What maintenance actions are recommended?`
    );
    setActiveTab('agent');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Three-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('fleet')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            TurbineOps
          </button>

          {/* Zone 2: 4 concise single-line text navigation links */}
          <nav className="flex items-center gap-6 overflow-x-auto h-full" aria-label="Primary workspaces">
            {(
              [
                { id: 'fleet', label: 'Fleet Telemetry' },
                { id: 'ml', label: 'ML Failure Model' },
                { id: 'agent', label: 'Text-to-SQL & RAG' },
                { id: 'gcp', label: 'GCP Architecture' },
              ] as const
            ).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`h-full inline-flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'border-blue-600 text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleScoreFleet}
              disabled={scoringBusy}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {scoringBusy ? 'Scoring Fleet...' : 'Score All Assets'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        {activeTab === 'fleet' && (
          <FleetTelemetryView
            assets={assets}
            summary={summary}
            loading={fleetLoading}
            onRefreshFleet={loadFleet}
            onAskAgentAboutAsset={handleAskAgentAboutAsset}
          />
        )}

        {activeTab === 'ml' && (
          <MlTrainerView
            evaluation={evaluation}
            artifacts={artifacts}
            onModelTrained={handleModelTrained}
          />
        )}

        {activeTab === 'agent' && (
          <RagSqlAgentView
            schemaDdl={schemaDdl}
            artifacts={artifacts}
            initialQuestion={queuedAgentQuestion}
            onClearInitialQuestion={() => setQueuedAgentQuestion(null)}
          />
        )}

        {activeTab === 'gcp' && <GcpArchitectureView artifacts={artifacts} />}
      </main>
    </div>
  );
}

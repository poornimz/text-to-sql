import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, Plus, Search, X } from 'lucide-react';
import { FleetAsset, FleetSummary, MaintenanceLog, AssetTelemetry } from '../types';

interface FleetTelemetryViewProps {
  assets: FleetAsset[];
  summary: FleetSummary | null;
  loading: boolean;
  onRefreshFleet: () => Promise<void>;
  onAskAgentAboutAsset: (assetId: string) => void;
}

function RiskGlyph({ tier }: { tier?: 'Nominal' | 'Elevated' | 'Critical' }) {
  if (tier === 'Critical') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Critical
      </span>
    );
  }
  if (tier === 'Elevated') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <Activity className="w-3.5 h-3.5 shrink-0" />
        Elevated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      Nominal
    </span>
  );
}

function MiniSparkline({ points, threshold }: { points: number[]; threshold: number }) {
  if (points.length < 2) return null;
  const width = 96;
  const height = 24;
  const min = Math.min(...points, threshold * 0.65);
  const max = Math.max(...points, threshold * 1.05);
  const range = Math.max(0.01, max - min);

  const pathD = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const latest = points[points.length - 1];
  const strokeColor = latest >= threshold ? '#dc2626' : latest >= threshold * 0.8 ? '#d97706' : '#2563eb';

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0" aria-hidden="true">
      <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AssetWaveformChart({
  telemetry,
  maxTemp,
  maxVib,
}: {
  telemetry: AssetTelemetry[];
  maxTemp: number;
  maxVib: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (telemetry.length === 0) return null;

  const width = 560;
  const height = 180;
  const padX = 36;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const temps = telemetry.map((t) => t.temp_c);
  const vibs = telemetry.map((t) => t.vibration_rms);
  const tMin = Math.min(...temps, 45);
  const tMax = Math.max(...temps, maxTemp + 5);
  const vMin = 0;
  const vMax = Math.max(...vibs, maxVib + 0.5);

  const toX = (idx: number) => padX + (idx / Math.max(1, telemetry.length - 1)) * innerW;
  const toTempY = (val: number) => padY + innerH - ((val - tMin) / Math.max(1, tMax - tMin)) * innerH;
  const toVibY = (val: number) => padY + innerH - ((val - vMin) / Math.max(0.5, vMax - vMin)) * innerH;

  const tempPath = telemetry
    .map((t, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toTempY(t.temp_c).toFixed(1)}`)
    .join(' ');
  const vibPath = telemetry
    .map((t, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toVibY(t.vibration_rms).toFixed(1)}`)
    .join(' ');

  const activePoint = hoverIdx !== null ? telemetry[hoverIdx] : telemetry[telemetry.length - 1];

  return (
    <div className="border border-slate-200 bg-white rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">48-Hour Sensor Telemetry Trend</h4>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {activePoint
              ? `${activePoint.recorded_at.slice(0, 16).replace('T', ' ')} UTC · ${activePoint.temp_c.toFixed(1)} °C · ${activePoint.vibration_rms.toFixed(2)} mm/s`
              : 'Hover points to inspect'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-blue-600 inline-block" />
            Temp (°C)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-600 inline-block" />
            Vibration (mm/s)
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44 select-none cursor-crosshair"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padY + innerH * frac;
          return (
            <line
              key={frac}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          );
        })}

        {/* OEM Max Temp Threshold line */}
        <line
          x1={padX}
          x2={width - padX}
          y1={toTempY(maxTemp)}
          y2={toTempY(maxTemp)}
          stroke="#ef4444"
          strokeDasharray="4 4"
          strokeWidth="1"
        />

        <path d={tempPath} fill="none" stroke="#2563eb" strokeWidth="2" />
        <path d={vibPath} fill="none" stroke="#d97706" strokeWidth="2" />

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

        {telemetry.map((pt, i) => (
          <rect
            key={pt.id}
            x={toX(i) - innerW / Math.max(1, telemetry.length * 2)}
            y={padY}
            width={innerW / Math.max(1, telemetry.length)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}
      </svg>
    </div>
  );
}

export const FleetTelemetryView: React.FC<FleetTelemetryViewProps> = ({
  assets,
  summary,
  loading,
  onRefreshFleet,
  onAskAgentAboutAsset,
}) => {
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'All' | 'Critical' | 'Elevated' | 'Nominal'>('All');
  const [plantFilter, setPlantFilter] = useState<string>('All');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetDetail, setAssetDetail] = useState<{
    asset: FleetAsset;
    telemetry: AssetTelemetry[];
    logs: MaintenanceLog[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Live Telemetry Injection Modal/Panel State
  const [showIngest, setShowIngest] = useState(false);
  const [ingestForm, setIngestForm] = useState({
    asset_id: 'PUMP-204',
    temp_c: 87.5,
    vibration_rms: 4.95,
    pressure_bar: 9.2,
    rpm: 2820,
    current_amp: 63.4,
    operating_hours: 19450,
  });
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMessage, setIngestMessage] = useState<string | null>(null);

  const plants = useMemo(() => {
    const set = new Set(assets.map((a) => a.plant_location));
    return ['All', ...Array.from(set)];
  }, [assets]);

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      if (riskFilter !== 'All' && a.prediction?.risk_tier !== riskFilter) return false;
      if (plantFilter !== 'All' && a.plant_location !== plantFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          a.asset_id.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.plant_location.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [assets, riskFilter, plantFilter, search]);

  useEffect(() => {
    if (!selectedAssetId) {
      setAssetDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/fleet/${encodeURIComponent(selectedAssetId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && !data.error) {
          setAssetDetail(data);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAssetId]);

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngestBusy(true);
    setIngestMessage(null);
    try {
      const resp = await fetch('/api/telemetry/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ingestForm),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Ingestion failed');
      setIngestMessage(
        `Inserted reading into SQLite and scored ${ingestForm.asset_id}: ${(data.prediction.failureProbability * 100).toFixed(1)}% failure probability (${data.prediction.riskTier}).`
      );
      await onRefreshFleet();
      if (selectedAssetId === ingestForm.asset_id) {
        const detailResp = await fetch(`/api/fleet/${encodeURIComponent(selectedAssetId)}`);
        const detailData = await detailResp.json();
        setAssetDetail(detailData);
      }
    } catch (err) {
      setIngestMessage(err instanceof Error ? err.message : 'Failed to ingest reading.');
    } finally {
      setIngestBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Fleet KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Monitored Fleet Assets</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {summary ? summary.totalAssets : '—'}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              3 global plants
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Critical 48h Failure Risk</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-rose-700">
              {summary ? summary.criticalCount : '—'}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {summary ? `${summary.elevatedCount} elevated · ${summary.nominalCount} nominal` : ''}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Active Neural Model ROC-AUC</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-blue-700">
              {summary ? summary.rocAuc.toFixed(3) : '—'}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {summary?.modelVersion ?? 'mlp-v1.1'}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">SQLite Telemetry &amp; Logs</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {summary ? summary.totalTelemetryRows : '—'}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {summary ? `${summary.totalLogs} indexed logs` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Filter & Action Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by asset ID, machine, or plant..."
              className="pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-md bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 w-64"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(['All', 'Critical', 'Elevated', 'Nominal'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setRiskFilter(tier)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  riskFilter === tier
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tier}
              </button>
            ))}
          </div>

          <select
            value={plantFilter}
            onChange={(e) => setPlantFilter(e.target.value)}
            aria-label="Filter by plant location"
            className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          >
            {plants.map((p) => (
              <option key={p} value={p}>
                {p === 'All' ? 'All Facilities' : p}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowIngest((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          {showIngest ? 'Close Telemetry Injector' : 'Inject Live Telemetry'}
        </button>
      </div>

      {/* Optional Live Telemetry Ingestion Drawer */}
      {showIngest && (
        <form
          onSubmit={handleIngestSubmit}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Simulate Live Sensor Telemetry Ingestion
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Writes a new observation into SQLite <span className="font-mono">sensor_telemetry</span> and updates neural failure probabilities immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowIngest(false)}
              className="text-slate-400 hover:text-slate-600 p-1"
              aria-label="Close telemetry injector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Asset ID</span>
              <select
                value={ingestForm.asset_id}
                onChange={(e) => setIngestForm((f) => ({ ...f, asset_id: e.target.value }))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-white"
              >
                {assets.map((a) => (
                  <option key={a.asset_id} value={a.asset_id}>
                    {a.asset_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Temp (°C)</span>
              <input
                type="number"
                step="0.1"
                value={ingestForm.temp_c}
                onChange={(e) => setIngestForm((f) => ({ ...f, temp_c: Number(e.target.value) }))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Vib (mm/s)</span>
              <input
                type="number"
                step="0.05"
                value={ingestForm.vibration_rms}
                onChange={(e) =>
                  setIngestForm((f) => ({ ...f, vibration_rms: Number(e.target.value) }))
                }
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Press (bar)</span>
              <input
                type="number"
                step="0.1"
                value={ingestForm.pressure_bar}
                onChange={(e) =>
                  setIngestForm((f) => ({ ...f, pressure_bar: Number(e.target.value) }))
                }
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">RPM</span>
              <input
                type="number"
                value={ingestForm.rpm}
                onChange={(e) => setIngestForm((f) => ({ ...f, rpm: Number(e.target.value) }))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Current (A)</span>
              <input
                type="number"
                step="0.1"
                value={ingestForm.current_amp}
                onChange={(e) =>
                  setIngestForm((f) => ({ ...f, current_amp: Number(e.target.value) }))
                }
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Hours</span>
              <input
                type="number"
                value={ingestForm.operating_hours}
                onChange={(e) =>
                  setIngestForm((f) => ({ ...f, operating_hours: Number(e.target.value) }))
                }
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-md"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {ingestMessage ? (
              <p className="text-xs font-medium text-blue-700 font-mono">{ingestMessage}</p>
            ) : (
              <span className="text-xs text-slate-500">
                Tip: Try setting Vibration &gt; 4.5 mm/s and Temp &gt; 85 °C on any asset to trigger Critical risk.
              </span>
            )}
            <button
              type="submit"
              disabled={ingestBusy}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {ingestBusy ? 'Writing to SQLite...' : 'Insert & Score Reading'}
            </button>
          </div>
        </form>
      )}

      {/* Main Fleet Grid + Optional Asset Detail Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className={selectedAssetId ? 'xl:col-span-7' : 'xl:col-span-12'}>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                01. Fleet Sensor Telemetry &amp; 48-Hour Failure Risk
              </h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                Showing {filteredAssets.length} of {assets.length} assets
              </span>
            </div>

            {loading ? (
              <div className="p-8 space-y-3">
                {[1, 2, 3, 4, 5].map((k) => (
                  <div key={k} className="h-10 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-slate-700">No matching fleet assets</p>
                <p className="text-xs text-slate-500 mt-1">
                  Adjust your risk filter or facility search query to view monitored machines.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setRiskFilter('All');
                    setPlantFilter('All');
                  }}
                  className="mt-3 px-3.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Asset</th>
                      <th className="py-2.5 px-3">Facility &amp; Class</th>
                      <th className="py-2.5 px-3 text-right">Temp (°C)</th>
                      <th className="py-2.5 px-3 text-right">Vib (mm/s)</th>
                      <th className="py-2.5 px-3 text-right">48h Trend</th>
                      <th className="py-2.5 px-3 text-right">Fail Prob</th>
                      <th className="py-2.5 px-4">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredAssets.map((asset) => {
                      const tel = asset.latestTelemetry;
                      const prob = asset.prediction?.failure_probability ?? 0;
                      const isSelected = selectedAssetId === asset.asset_id;
                      return (
                        <tr
                          key={asset.asset_id}
                          onClick={() =>
                            setSelectedAssetId((prev) =>
                              prev === asset.asset_id ? null : asset.asset_id
                            )
                          }
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="font-mono text-xs font-semibold text-slate-900">
                              {asset.asset_id}
                            </div>
                            <div className="text-xs text-slate-600 truncate max-w-[200px]">
                              {asset.name}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="text-xs text-slate-700">{asset.plant_location}</div>
                            <div className="text-xs text-slate-500">
                              {asset.category} · {asset.criticality}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-900">
                            {tel ? tel.temp_c.toFixed(1) : '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-900">
                            {tel ? tel.vibration_rms.toFixed(2) : '—'}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex justify-end">
                              <MiniSparkline
                                points={asset.trend.map((t) => t.vibration_rms)}
                                threshold={asset.max_vibration_rms}
                              />
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-xs font-semibold text-slate-900">
                            {(prob * 100).toFixed(1)}%
                          </td>
                          <td className="py-3 px-4">
                            <RiskGlyph tier={asset.prediction?.risk_tier} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Selected Asset Diagnostic Panel */}
        {selectedAssetId && (
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
            {detailLoading || !assetDetail ? (
              <div className="space-y-3 py-6">
                <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
                <div className="h-40 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <div className="text-xs font-mono text-slate-500">
                      {assetDetail.asset.asset_id} · {assetDetail.asset.manufacturer} · Installed{' '}
                      {assetDetail.asset.install_date}
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 mt-1">
                      {assetDetail.asset.name}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedAssetId(null)}
                    className="p-1 text-slate-400 hover:text-slate-700"
                    aria-label="Close asset detail"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
                    <div className="text-slate-500">Failure Prob</div>
                    <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                      {(
                        (assets.find((a) => a.asset_id === selectedAssetId)?.prediction
                          ?.failure_probability ?? 0) * 100
                      ).toFixed(1)}
                      %
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
                    <div className="text-slate-500">Max Temp Spec</div>
                    <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                      {assetDetail.asset.max_temp_c} °C
                    </div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
                    <div className="text-slate-500">Max Vib Spec</div>
                    <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                      {assetDetail.asset.max_vibration_rms} mm/s
                    </div>
                  </div>
                </div>

                <AssetWaveformChart
                  telemetry={assetDetail.telemetry}
                  maxTemp={assetDetail.asset.max_temp_c}
                  maxVib={assetDetail.asset.max_vibration_rms}
                />

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-slate-900">
                      Recent Maintenance &amp; OEM Logs ({assetDetail.logs.length})
                    </h4>
                    <button
                      type="button"
                      onClick={() => onAskAgentAboutAsset(assetDetail.asset.asset_id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                    >
                      Diagnose with AI Agent
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {assetDetail.logs.map((log) => (
                      <div key={log.log_id} className="p-3 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono font-semibold text-slate-800">
                            {log.log_id} · {log.fault_code}
                          </span>
                          <span
                            className={`font-medium ${
                              log.severity === 'Critical'
                                ? 'text-rose-700'
                                : log.severity === 'Warning'
                                  ? 'text-amber-700'
                                  : 'text-slate-500'
                            }`}
                          >
                            {log.severity} · {log.logged_at.slice(0, 10)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed">{log.summary}</p>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Action: {log.resolution_notes}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

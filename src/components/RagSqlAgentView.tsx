import React, { useEffect, useState } from 'react';
import { Check, Copy, Database, Play, Search, Sparkles } from 'lucide-react';
import { AgentQueryResponse, CodeArtifacts, SqlExecutionResult } from '../types';

interface RagSqlAgentViewProps {
  schemaDdl: string;
  artifacts: CodeArtifacts | null;
  initialQuestion?: string | null;
  onClearInitialQuestion?: () => void;
}

const STARTER_PROMPTS = [
  'Which Tier-1 assets have failure probability above 60% and what fault codes were logged recently?',
  'Compare average bearing temperature and vibration RMS across all three plant locations.',
  'What do OEM guidelines say about PUMP-204 cavitation and CNC-108 ceramic bearing thresholds?',
  'Show the 5 highest temperature readings recorded in sensor_telemetry with their asset names.',
];

const DEFAULT_SQL = `SELECT
  a.asset_id,
  a.name,
  a.plant_location,
  ROUND(p.failure_probability * 100, 1) AS fail_pct,
  p.risk_tier,
  p.top_driver
FROM assets a
JOIN ml_predictions p ON p.asset_id = a.asset_id
ORDER BY p.failure_probability DESC;`;

export const RagSqlAgentView: React.FC<RagSqlAgentViewProps> = ({
  schemaDdl,
  artifacts,
  initialQuestion,
  onClearInitialQuestion,
}) => {
  const [question, setQuestion] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [history, setHistory] = useState<AgentQueryResponse[]>([]);

  // Right Inspector Tabs: SQL Console, Schema DDL, Python Agent
  const [inspectorTab, setInspectorTab] = useState<'sql' | 'schema' | 'python'>('sql');
  const [sqlInput, setSqlInput] = useState(DEFAULT_SQL);
  const [sqlBusy, setSqlBusy] = useState(false);
  const [sqlResult, setSqlResult] = useState<SqlExecutionResult | null>(null);
  const [sqlErr, setSqlErr] = useState<string | null>(null);
  const [copiedPython, setCopiedPython] = useState(false);

  const runSqlConsole = async (queryStr: string) => {
    setSqlBusy(true);
    setSqlErr(null);
    try {
      const resp = await fetch('/api/sql/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: queryStr }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'SQL execution error');
      setSqlResult(data);
    } catch (err) {
      setSqlErr(err instanceof Error ? err.message : 'SQL execution failed.');
    } finally {
      setSqlBusy(false);
    }
  };

  useEffect(() => {
    runSqlConsole(DEFAULT_SQL);
  }, []);

  const executeAgentQuery = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setAgentBusy(true);
    setAgentError(null);
    try {
      const resp = await fetch('/api/agent/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Agent query failed.');
      setHistory((prev) => [data as AgentQueryResponse, ...prev]);
      if (data.sqlQuery) {
        setSqlInput(data.sqlQuery);
        if (data.sqlResult) setSqlResult(data.sqlResult);
      }
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Failed to run Text-to-SQL / RAG agent.');
    } finally {
      setAgentBusy(false);
    }
  };

  useEffect(() => {
    if (initialQuestion) {
      executeAgentQuery(initialQuestion);
      onClearInitialQuestion?.();
    }
  }, [initialQuestion]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeAgentQuery(question);
  };

  const handleCopyPython = async () => {
    if (!artifacts) return;
    await navigator.clipboard.writeText(artifacts.pythonAgentScript);
    setCopiedPython(true);
    setTimeout(() => setCopiedPython(false), 1800);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Main Text-to-SQL + RAG Agent Workspace */}
      <div className="xl:col-span-7 space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              01. Natural Language Text-to-SQL &amp; Maintenance Log RAG Agent
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Gemini translates your question into read-only SQLite <span className="font-mono">SELECT</span> queries, retrieves relevant technician logs via BM25 scoring, and synthesizes a grounded report.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about sensor telemetry, failure risk, fault codes, or OEM thresholds..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={agentBusy || !question.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {agentBusy ? 'Querying Agent...' : 'Run Agent Query'}
            </button>
          </form>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-500">Suggested Engineering Queries</div>
            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={agentBusy}
                  onClick={() => executeAgentQuery(prompt)}
                  className="text-left px-3 py-1.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {agentError && (
            <div className="border border-rose-200 bg-rose-50 text-rose-800 rounded-md p-3 text-xs">
              {agentError}
            </div>
          )}
        </div>

        {/* Agent Response History */}
        {agentBusy && history.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
            <div className="h-4 w-2/3 bg-slate-100 rounded animate-pulse" />
            <div className="h-20 bg-slate-100 rounded animate-pulse" />
            <div className="h-24 bg-slate-100 rounded animate-pulse" />
          </div>
        )}

        {history.length === 0 && !agentBusy && (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
            <Database className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <h3 className="text-sm font-medium text-slate-900">Ready for Hybrid SQL + Log Queries</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Select any suggested query above or enter your own question to inspect live SQL generation, execution results, and cited technician logs.
            </p>
          </div>
        )}

        {history.map((item, idx) => (
          <div key={`${item.question}-${idx}`} className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
            {/* Header & Grounded Answer */}
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-mono">
                <span>
                  Mode: {item.intent} · Latency: {item.latencyMs} ms
                  {item.sqlRepaired ? ' · SQL Auto-Repaired' : ''}
                </span>
                <span>{item.retrievedLogs.length} RAG logs cited</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900">{item.question}</h3>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {item.answer}
              </p>

              {item.recommendedActions.length > 0 && (
                <div className="pt-2">
                  <div className="text-xs font-semibold text-slate-900 mb-1.5">
                    Recommended Reliability Actions
                  </div>
                  <ul className="space-y-1 text-xs text-slate-700 list-disc pl-4">
                    {item.recommendedActions.map((act, i) => (
                      <li key={i}>{act}</li>
                    ))}
                  </ul>
                </div>
              )}

              {item.followUpQuestions.length > 0 && (
                <div className="pt-2 flex flex-wrap gap-2">
                  {item.followUpQuestions.map((fq) => (
                    <button
                      key={fq}
                      type="button"
                      disabled={agentBusy}
                      onClick={() => executeAgentQuery(fq)}
                      className="text-xs text-blue-700 hover:text-blue-800 bg-blue-50/70 hover:bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1 transition-colors text-left"
                    >
                      {fq}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Generated SQL + Execution Output */}
            {item.sqlQuery && (
              <div className="p-5 space-y-3 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    Generated Read-Only SQLite Query
                  </span>
                  <div className="flex items-center gap-3">
                    {item.sqlResult && (
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        {item.sqlResult.rowCount} rows · {item.sqlResult.executionMs} ms
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setInspectorTab('sql');
                        setSqlInput(item.sqlQuery ?? '');
                        runSqlConsole(item.sqlQuery ?? '');
                      }}
                      className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                    >
                      Open in SQL Console
                    </button>
                  </div>
                </div>
                <pre className="p-3 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-800 overflow-x-auto">
                  <code>{item.sqlQuery}</code>
                </pre>

                {item.sqlError && (
                  <p className="text-xs text-rose-700 font-mono">{item.sqlError}</p>
                )}

                {item.sqlResult && item.sqlResult.rows.length > 0 && (
                  <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-mono">
                          {item.sqlResult.columns.map((col) => (
                            <th key={col} className="py-2 px-3 font-medium whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                        {item.sqlResult.rows.slice(0, 10).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50">
                            {item.sqlResult!.columns.map((col) => (
                              <td key={col} className="py-2 px-3 text-slate-800 whitespace-nowrap">
                                {row[col] === null || row[col] === undefined
                                  ? 'NULL'
                                  : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Retrieved RAG Maintenance Logs */}
            {item.retrievedLogs.length > 0 && (
              <div className="p-5 space-y-2.5">
                <div className="text-xs font-semibold text-slate-900">
                  Retrieved RAG Maintenance &amp; OEM Log Excerpts
                </div>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                  {item.retrievedLogs.map((log) => (
                    <div key={log.log_id} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between font-mono text-slate-600">
                        <span className="font-semibold text-slate-900">
                          [{log.log_id}] {log.asset_id} · {log.fault_code}
                        </span>
                        <span>
                          {log.severity} · BM25 {log.relevanceScore?.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-slate-700">{log.summary}</p>
                      <p className="text-slate-500">Resolution: {log.resolution_notes}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Right Column: Live SQLite Console, Schema DDL & Python Code */}
      <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'sql', label: 'SQL Console' },
                { id: 'schema', label: 'Schema DDL' },
                { id: 'python', label: 'Python Agent' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setInspectorTab(t.id)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  inspectorTab === t.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-mono text-slate-500">SQLite Read-Only</span>
        </div>

        {inspectorTab === 'sql' && (
          <div className="p-4 space-y-4">
            <textarea
              value={sqlInput}
              onChange={(e) => setSqlInput(e.target.value)}
              rows={8}
              spellCheck={false}
              aria-label="SQLite query editor"
              className="w-full p-3 text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {sqlResult ? `${sqlResult.rowCount} rows (${sqlResult.executionMs} ms)` : ''}
              </span>
              <button
                type="button"
                disabled={sqlBusy}
                onClick={() => runSqlConsole(sqlInput)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md whitespace-nowrap"
              >
                <Play className="w-3 h-3" />
                {sqlBusy ? 'Executing...' : 'Execute SELECT'}
              </button>
            </div>

            {sqlErr && (
              <div className="p-3 text-xs font-mono text-rose-700 bg-rose-50 border border-rose-200 rounded-md">
                {sqlErr}
              </div>
            )}

            {sqlResult && (
              <div className="overflow-x-auto border border-slate-200 rounded-md max-h-96">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-mono text-slate-600 sticky top-0">
                      {sqlResult.columns.map((c) => (
                        <th key={c} className="py-2 px-3 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {sqlResult.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {sqlResult.columns.map((c) => (
                          <td key={c} className="py-2 px-3 text-slate-800 whitespace-nowrap">
                            {r[c] === null || r[c] === undefined ? 'NULL' : String(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {inspectorTab === 'schema' && (
          <div className="p-4">
            <pre className="p-3 text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-md overflow-x-auto leading-relaxed">
              <code>{schemaDdl}</code>
            </pre>
          </div>
        )}

        {inspectorTab === 'python' && artifacts && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-600">agent_rag_sql.py</span>
              <button
                type="button"
                onClick={handleCopyPython}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-50"
              >
                {copiedPython ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedPython ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="p-3 text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-md overflow-x-auto leading-relaxed max-h-[540px]">
              <code>{artifacts.pythonAgentScript}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

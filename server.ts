import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  AssetRow,
  executeReadOnlySql,
  getDb,
  MaintenanceLogRow,
  PredictionRow,
  queryAll,
  SQL_SCHEMA_DDL,
  TelemetryRow,
} from './server/db.ts';
import {
  ensureModelInitialized,
  predictSample,
  scoreAllFleetAssets,
  trainFailureModel,
} from './server/mlEngine.ts';
import { runTextToSqlRagAgent } from './server/ragSqlAgent.ts';
import { generateCodeArtifacts } from './server/codeTemplates.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Initialize SQLite database & baseline neural model
  const db = await getDb();
  let currentEvaluation = ensureModelInitialized(db);

  // GET /api/fleet — full fleet overview with latest telemetry + ML risk + log counts
  app.get('/api/fleet', async (_req, res) => {
    try {
      const assets = queryAll<AssetRow>(db, `SELECT * FROM assets ORDER BY asset_id ASC`);
      const predictions = queryAll<PredictionRow>(db, `SELECT * FROM ml_predictions`);
      const predMap = new Map(predictions.map((p) => [p.asset_id, p]));

      const enriched = assets.map((asset) => {
        const latestTel = queryAll<TelemetryRow>(
          db,
          `SELECT * FROM sensor_telemetry WHERE asset_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1`,
          [asset.asset_id]
        )[0];

        const recentTrend = queryAll<{ temp_c: number; vibration_rms: number; recorded_at: string }>(
          db,
          `SELECT temp_c, vibration_rms, recorded_at FROM sensor_telemetry WHERE asset_id = ? ORDER BY recorded_at ASC, id ASC LIMIT 24`,
          [asset.asset_id]
        );

        const logStats = queryAll<{ total: number; critical: number }>(
          db,
          `SELECT COUNT(*) AS total, SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) AS critical
           FROM maintenance_logs WHERE asset_id = ?`,
          [asset.asset_id]
        )[0];

        return {
          ...asset,
          latestTelemetry: latestTel ?? null,
          prediction: predMap.get(asset.asset_id) ?? null,
          trend: recentTrend,
          logCount: Number(logStats?.total ?? 0),
          criticalLogCount: Number(logStats?.critical ?? 0),
        };
      });

      const totalTelemetryRows = queryAll<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count FROM sensor_telemetry`
      )[0]?.count ?? 0;

      const totalLogs = queryAll<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count FROM maintenance_logs`
      )[0]?.count ?? 0;

      res.json({
        assets: enriched,
        summary: {
          totalAssets: enriched.length,
          criticalCount: enriched.filter((a) => a.prediction?.risk_tier === 'Critical').length,
          elevatedCount: enriched.filter((a) => a.prediction?.risk_tier === 'Elevated').length,
          nominalCount: enriched.filter((a) => a.prediction?.risk_tier === 'Nominal').length,
          totalTelemetryRows,
          totalLogs,
          modelVersion: currentEvaluation.modelVersion,
          rocAuc: currentEvaluation.metrics.rocAuc,
        },
        schemaDdl: SQL_SCHEMA_DDL,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load fleet.' });
    }
  });

  // GET /api/fleet/:assetId — full time series and maintenance logs for one asset
  app.get('/api/fleet/:assetId', async (req, res) => {
    try {
      const { assetId } = req.params;
      const asset = queryAll<AssetRow>(db, `SELECT * FROM assets WHERE asset_id = ?`, [assetId])[0];
      if (!asset) {
        return res.status(404).json({ error: `Asset ${assetId} not found.` });
      }
      const telemetry = queryAll<TelemetryRow>(
        db,
        `SELECT * FROM sensor_telemetry WHERE asset_id = ? ORDER BY recorded_at ASC, id ASC`,
        [assetId]
      );
      const logs = queryAll<MaintenanceLogRow>(
        db,
        `SELECT * FROM maintenance_logs WHERE asset_id = ? ORDER BY logged_at DESC`,
        [assetId]
      );
      const prediction = queryAll<PredictionRow>(
        db,
        `SELECT * FROM ml_predictions WHERE asset_id = ? LIMIT 1`,
        [assetId]
      )[0] ?? null;

      res.json({ asset, telemetry, logs, prediction });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load asset.' });
    }
  });

  // POST /api/telemetry/ingest — insert a new live telemetry reading & re-score fleet
  app.post('/api/telemetry/ingest', async (req, res) => {
    try {
      const {
        asset_id,
        temp_c,
        vibration_rms,
        pressure_bar,
        rpm,
        current_amp,
        operating_hours,
      } = req.body as {
        asset_id: string;
        temp_c: number;
        vibration_rms: number;
        pressure_bar: number;
        rpm: number;
        current_amp: number;
        operating_hours: number;
      };

      const asset = queryAll<AssetRow>(db, `SELECT * FROM assets WHERE asset_id = ?`, [asset_id])[0];
      if (!asset) {
        return res.status(404).json({ error: `Asset ${asset_id} not found.` });
      }

      const pred = predictSample({
        temp_c: Number(temp_c),
        vibration_rms: Number(vibration_rms),
        pressure_bar: Number(pressure_bar),
        rpm: Number(rpm),
        current_amp: Number(current_amp),
        operating_hours: Number(operating_hours),
      });

      const recordedAt = new Date().toISOString();
      const failureLabel = pred.failureProbability >= 0.5 ? 1 : 0;

      db.run(
        `INSERT INTO sensor_telemetry (asset_id, recorded_at, temp_c, vibration_rms, pressure_bar, rpm, current_amp, operating_hours, failure_within_48h)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          asset_id,
          recordedAt,
          Number(temp_c),
          Number(vibration_rms),
          Number(pressure_bar),
          Math.round(Number(rpm)),
          Number(current_amp),
          Math.round(Number(operating_hours)),
          failureLabel,
        ]
      );

      scoreAllFleetAssets(db);
      res.json({ status: 'ingested', recordedAt, prediction: pred });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Telemetry ingest failed.' });
    }
  });

  // GET /api/ml/status — current model evaluation + artifacts
  app.get('/api/ml/status', (_req, res) => {
    const artifacts = generateCodeArtifacts(currentEvaluation.hyperparams);
    res.json({ evaluation: currentEvaluation, artifacts });
  });

  // POST /api/ml/train — retrain neural network on SQLite historical telemetry
  app.post('/api/ml/train', (req, res) => {
    try {
      const { epochs, learningRate, hiddenUnits } = req.body as {
        epochs?: number;
        learningRate?: number;
        hiddenUnits?: number;
      };
      currentEvaluation = trainFailureModel(db, { epochs, learningRate, hiddenUnits });
      const artifacts = generateCodeArtifacts(currentEvaluation.hyperparams);
      res.json({ evaluation: currentEvaluation, artifacts });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Training failed.' });
    }
  });

  // POST /api/ml/score-fleet — re-score all assets into SQL ml_predictions
  app.post('/api/ml/score-fleet', (_req, res) => {
    try {
      scoreAllFleetAssets(db);
      const predictions = queryAll<PredictionRow>(db, `SELECT * FROM ml_predictions`);
      res.json({ updated: predictions.length, predictions });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Fleet scoring failed.' });
    }
  });

  // POST /api/ml/predict — interactive what-if sensor inference
  app.post('/api/ml/predict', (req, res) => {
    try {
      const { temp_c, vibration_rms, pressure_bar, rpm, current_amp, operating_hours } = req.body;
      const result = predictSample({
        temp_c: Number(temp_c),
        vibration_rms: Number(vibration_rms),
        pressure_bar: Number(pressure_bar),
        rpm: Number(rpm),
        current_amp: Number(current_amp),
        operating_hours: Number(operating_hours),
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Prediction failed.' });
    }
  });

  // POST /api/agent/query — Gemini Text-to-SQL + RAG Agent
  app.post('/api/agent/query', async (req, res) => {
    try {
      const { question } = req.body as { question?: string };
      if (!question || !question.trim()) {
        return res.status(400).json({ error: 'Please provide a natural language question.' });
      }
      const result = await runTextToSqlRagAgent(db, question.trim());
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent query failed.';
      res.status(500).json({ error: message });
    }
  });

  // POST /api/sql/execute — Direct read-only SQL execution in SQLite Inspector
  app.post('/api/sql/execute', (req, res) => {
    try {
      const { sql } = req.body as { sql?: string };
      if (!sql) {
        return res.status(400).json({ error: 'SQL statement is required.' });
      }
      const result = executeReadOnlySql(db, sql);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'SQL execution error.' });
    }
  });

  // GET /api/logs — browse maintenance logs
  app.get('/api/logs', (_req, res) => {
    const logs = queryAll<MaintenanceLogRow & { asset_name: string; plant_location: string }>(
      db,
      `SELECT l.*, a.name AS asset_name, a.plant_location
       FROM maintenance_logs l
       JOIN assets a ON a.asset_id = l.asset_id
       ORDER BY l.logged_at DESC`
    );
    res.json({ logs });
  });

  // Serve Vite in dev or static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TurbineOps server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

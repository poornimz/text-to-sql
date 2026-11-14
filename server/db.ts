import initSqlJs, { Database } from 'sql.js';

export interface AssetRow {
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
}

export interface TelemetryRow {
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

export interface MaintenanceLogRow {
  log_id: string;
  asset_id: string;
  logged_at: string;
  technician: string;
  severity: 'Info' | 'Warning' | 'Critical';
  fault_code: string;
  summary: string;
  resolution_notes: string;
}

export interface PredictionRow {
  prediction_id: number;
  asset_id: string;
  predicted_at: string;
  failure_probability: number;
  risk_tier: 'Nominal' | 'Elevated' | 'Critical';
  top_driver: string;
  model_version: string;
}

export const SQL_SCHEMA_DDL = `
CREATE TABLE assets (
  asset_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  plant_location TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  install_date TEXT NOT NULL,
  criticality TEXT NOT NULL,
  nominal_rpm INTEGER NOT NULL,
  max_temp_c REAL NOT NULL,
  max_vibration_rms REAL NOT NULL
);

CREATE TABLE sensor_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL REFERENCES assets(asset_id),
  recorded_at TEXT NOT NULL,
  temp_c REAL NOT NULL,
  vibration_rms REAL NOT NULL,
  pressure_bar REAL NOT NULL,
  rpm INTEGER NOT NULL,
  current_amp REAL NOT NULL,
  operating_hours INTEGER NOT NULL,
  failure_within_48h INTEGER NOT NULL
);

CREATE TABLE maintenance_logs (
  log_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(asset_id),
  logged_at TEXT NOT NULL,
  technician TEXT NOT NULL,
  severity TEXT NOT NULL,
  fault_code TEXT NOT NULL,
  summary TEXT NOT NULL,
  resolution_notes TEXT NOT NULL
);

CREATE TABLE ml_predictions (
  prediction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL REFERENCES assets(asset_id),
  predicted_at TEXT NOT NULL,
  failure_probability REAL NOT NULL,
  risk_tier TEXT NOT NULL,
  top_driver TEXT NOT NULL,
  model_version TEXT NOT NULL
);
`.trim();

let dbInstance: Database | null = null;

function createRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(SQL_SCHEMA_DDL);

  const assets: AssetRow[] = [
    {
      asset_id: 'TURB-01',
      name: 'Centrifugal Gas Compressor A1',
      category: 'Turbine Compressor',
      plant_location: 'Austin Fab 1',
      manufacturer: 'Siemens Energy',
      install_date: '2022-03-14',
      criticality: 'Tier-1',
      nominal_rpm: 3600,
      max_temp_c: 88,
      max_vibration_rms: 4.5,
    },
    {
      asset_id: 'PUMP-204',
      name: 'High-Pressure Coolant Pump B4',
      category: 'Centrifugal Pump',
      plant_location: 'Austin Fab 1',
      manufacturer: 'Flowserve',
      install_date: '2023-01-22',
      criticality: 'Tier-1',
      nominal_rpm: 2950,
      max_temp_c: 82,
      max_vibration_rms: 4.0,
    },
    {
      asset_id: 'CNC-108',
      name: '5-Axis Precision Spindle #8',
      category: 'CNC Spindle',
      plant_location: 'Munich Assembly',
      manufacturer: 'DMG Mori',
      install_date: '2021-11-05',
      criticality: 'Tier-1',
      nominal_rpm: 12000,
      max_temp_c: 76,
      max_vibration_rms: 2.8,
    },
    {
      asset_id: 'GEAR-09',
      name: 'Planetary Drive Gearbox G9',
      category: 'Industrial Gearbox',
      plant_location: 'Munich Assembly',
      manufacturer: 'Flender',
      install_date: '2020-07-19',
      criticality: 'Tier-2',
      nominal_rpm: 1480,
      max_temp_c: 85,
      max_vibration_rms: 4.2,
    },
    {
      asset_id: 'HYD-302',
      name: 'Servo Hydraulic Stamping Press',
      category: 'Hydraulic Press',
      plant_location: 'Osaka Plant 3',
      manufacturer: 'Komatsu',
      install_date: '2022-09-10',
      criticality: 'Tier-1',
      nominal_rpm: 1750,
      max_temp_c: 79,
      max_vibration_rms: 3.6,
    },
    {
      asset_id: 'CHIL-14',
      name: 'Twin-Screw Process Chiller C14',
      category: 'Thermal Chiller',
      plant_location: 'Austin Fab 1',
      manufacturer: 'Trane Industrial',
      install_date: '2023-06-02',
      criticality: 'Tier-2',
      nominal_rpm: 2400,
      max_temp_c: 75,
      max_vibration_rms: 3.5,
    },
    {
      asset_id: 'PUMP-211',
      name: 'Boiler Feedwater Booster P211',
      category: 'Centrifugal Pump',
      plant_location: 'Munich Assembly',
      manufacturer: 'Sulzer',
      install_date: '2021-04-18',
      criticality: 'Tier-1',
      nominal_rpm: 3100,
      max_temp_c: 84,
      max_vibration_rms: 4.0,
    },
    {
      asset_id: 'CNC-115',
      name: 'High-Torque Milling Spindle #15',
      category: 'CNC Spindle',
      plant_location: 'Osaka Plant 3',
      manufacturer: 'Makino',
      install_date: '2024-01-11',
      criticality: 'Tier-2',
      nominal_rpm: 10500,
      max_temp_c: 74,
      max_vibration_rms: 2.6,
    },
    {
      asset_id: 'TURB-04',
      name: 'Auxiliary Steam Turbine T4',
      category: 'Turbine Compressor',
      plant_location: 'Osaka Plant 3',
      manufacturer: 'Mitsubishi Heavy',
      install_date: '2020-02-27',
      criticality: 'Tier-1',
      nominal_rpm: 3580,
      max_temp_c: 90,
      max_vibration_rms: 4.4,
    },
    {
      asset_id: 'GEAR-12',
      name: 'Conveyor Helical Reducer R12',
      category: 'Industrial Gearbox',
      plant_location: 'Austin Fab 1',
      manufacturer: 'SEW-Eurodrive',
      install_date: '2023-08-29',
      criticality: 'Tier-3',
      nominal_rpm: 1180,
      max_temp_c: 80,
      max_vibration_rms: 3.8,
    },
    {
      asset_id: 'HYD-309',
      name: 'Forging Line Accumulator Pump',
      category: 'Hydraulic Press',
      plant_location: 'Munich Assembly',
      manufacturer: 'Bosch Rexroth',
      install_date: '2022-12-03',
      criticality: 'Tier-2',
      nominal_rpm: 1800,
      max_temp_c: 81,
      max_vibration_rms: 3.7,
    },
    {
      asset_id: 'CHIL-19',
      name: 'Cleanroom Glycol Loop Chiller',
      category: 'Thermal Chiller',
      plant_location: 'Osaka Plant 3',
      manufacturer: 'Carrier',
      install_date: '2024-03-19',
      criticality: 'Tier-2',
      nominal_rpm: 2200,
      max_temp_c: 74,
      max_vibration_rms: 3.3,
    },
  ];

  const insertAsset = db.prepare(
    `INSERT INTO assets (asset_id, name, category, plant_location, manufacturer, install_date, criticality, nominal_rpm, max_temp_c, max_vibration_rms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const a of assets) {
    insertAsset.run([
      a.asset_id,
      a.name,
      a.category,
      a.plant_location,
      a.manufacturer,
      a.install_date,
      a.criticality,
      a.nominal_rpm,
      a.max_temp_c,
      a.max_vibration_rms,
    ]);
  }
  insertAsset.free();

  // Deterministic realistic sensor profiles:
  // PUMP-204, CNC-108, TURB-04 are currently experiencing progressive degradation
  // GEAR-09, HYD-302 are moderately elevated; others are nominal.
  const assetRiskProfiles: Record<
    string,
    { baseTemp: number; tempDrift: number; baseVib: number; vibDrift: number; baseHours: number; basePress: number; baseAmp: number }
  > = {
    'TURB-01': { baseTemp: 68, tempDrift: 0.1, baseVib: 1.6, vibDrift: 0.02, baseHours: 14200, basePress: 14.2, baseAmp: 46 },
    'PUMP-204': { baseTemp: 76, tempDrift: 0.72, baseVib: 3.1, vibDrift: 0.11, baseHours: 19400, basePress: 11.4, baseAmp: 58 },
    'CNC-108': { baseTemp: 69, tempDrift: 0.58, baseVib: 2.2, vibDrift: 0.08, baseHours: 23800, basePress: 6.4, baseAmp: 42 },
    'GEAR-09': { baseTemp: 74, tempDrift: 0.35, baseVib: 2.6, vibDrift: 0.04, baseHours: 27100, basePress: 4.8, baseAmp: 39 },
    'HYD-302': { baseTemp: 71, tempDrift: 0.28, baseVib: 2.3, vibDrift: 0.04, baseHours: 16500, basePress: 185.0, baseAmp: 51 },
    'CHIL-14': { baseTemp: 59, tempDrift: 0.05, baseVib: 1.2, vibDrift: 0.01, baseHours: 9800, basePress: 9.8, baseAmp: 34 },
    'PUMP-211': { baseTemp: 67, tempDrift: 0.12, baseVib: 1.8, vibDrift: 0.02, baseHours: 17900, basePress: 12.1, baseAmp: 44 },
    'CNC-115': { baseTemp: 61, tempDrift: 0.06, baseVib: 1.1, vibDrift: 0.01, baseHours: 6400, basePress: 6.8, baseAmp: 31 },
    'TURB-04': { baseTemp: 81, tempDrift: 0.68, baseVib: 3.3, vibDrift: 0.10, baseHours: 29400, basePress: 15.6, baseAmp: 64 },
    'GEAR-12': { baseTemp: 63, tempDrift: 0.08, baseVib: 1.4, vibDrift: 0.01, baseHours: 8200, basePress: 4.2, baseAmp: 28 },
    'HYD-309': { baseTemp: 66, tempDrift: 0.15, baseVib: 1.7, vibDrift: 0.02, baseHours: 12700, basePress: 178.0, baseAmp: 45 },
    'CHIL-19': { baseTemp: 57, tempDrift: 0.04, baseVib: 1.0, vibDrift: 0.01, baseHours: 5100, basePress: 9.5, baseAmp: 29 },
  };

  const rng = createRng(4207);
  const baseEpochMs = new Date('2026-11-12T00:00:00Z').getTime();

  const insertTel = db.prepare(
    `INSERT INTO sensor_telemetry (asset_id, recorded_at, temp_c, vibration_rms, pressure_bar, rpm, current_amp, operating_hours, failure_within_48h)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const a of assets) {
    const prof = assetRiskProfiles[a.asset_id];
    for (let step = 0; step < 24; step++) {
      const ts = new Date(baseEpochMs + step * 2 * 3600 * 1000).toISOString();
      const noiseT = (rng() - 0.5) * 2.4;
      const noiseV = (rng() - 0.5) * 0.25;
      const noiseP = (rng() - 0.5) * 0.6;
      const noiseA = (rng() - 0.5) * 3.0;

      const temp_c = Number((prof.baseTemp + prof.tempDrift * step + noiseT).toFixed(2));
      const vibration_rms = Number(Math.max(0.4, prof.baseVib + prof.vibDrift * step + noiseV).toFixed(3));
      const pressure_bar = Number(Math.max(1.2, prof.basePress - (prof.vibDrift * step * 1.4) + noiseP).toFixed(2));
      const rpm = Math.round(a.nominal_rpm * (1 + (rng() - 0.5) * 0.03 - (prof.vibDrift > 0.07 ? 0.035 : 0)));
      const current_amp = Number((prof.baseAmp + prof.tempDrift * step * 0.55 + noiseA).toFixed(2));
      const operating_hours = prof.baseHours + step * 2;

      // Ground-truth failure physics for supervised neural net training:
      const thermalRatio = temp_c / a.max_temp_c;
      const vibRatio = vibration_rms / a.max_vibration_rms;
      const ampStress = current_amp / 55;
      const ageFactor = operating_hours / 25000;
      const logit = -6.2 + 4.4 * thermalRatio + 4.6 * vibRatio + 1.1 * ampStress + 0.85 * ageFactor + (rng() - 0.5) * 0.45;
      const prob = 1 / (1 + Math.exp(-logit));
      const failure_within_48h = prob > 0.54 ? 1 : 0;

      insertTel.run([
        a.asset_id,
        ts,
        temp_c,
        vibration_rms,
        pressure_bar,
        rpm,
        current_amp,
        operating_hours,
        failure_within_48h,
      ]);
    }
  }
  insertTel.free();

  const logs: MaintenanceLogRow[] = [
    {
      log_id: 'LOG-01',
      asset_id: 'PUMP-204',
      logged_at: '2026-11-13T14:20:00Z',
      technician: 'M. Alvarez',
      severity: 'Critical',
      fault_code: 'VIB-402',
      summary: 'High-frequency acoustic cavitation and radial vibration spike above 4.8 mm/s RMS on Pump B4 outboard bearing.',
      resolution_notes: 'Inspected suction strainer; partial impeller wear observed. Scheduled mechanical seal and SKF 6309 bearing kit replacement within 24h.',
    },
    {
      log_id: 'LOG-02',
      asset_id: 'PUMP-204',
      logged_at: '2026-11-10T09:15:00Z',
      technician: 'S. Chen',
      severity: 'Warning',
      fault_code: 'TMP-218',
      summary: 'Bearing housing temperature drifted +7.4 C above baseline during peak glycol coolant loop demand.',
      resolution_notes: 'Flushed cooling jacket and topped up ISO VG 46 synthetic lubricant; monitored vibration harmonic at 2x line frequency.',
    },
    {
      log_id: 'LOG-03',
      asset_id: 'TURB-04',
      logged_at: '2026-11-13T18:45:00Z',
      technician: 'K. Takahashi',
      severity: 'Critical',
      fault_code: 'THR-901',
      summary: 'Exhaust end journal bearing temperature reached 94.2 C accompanied by 5.1 mm/s shaft displacement.',
      resolution_notes: 'Thermal expansion misalignment suspected on coupling flange. Laser shaft alignment and thrust pad clearance check queued for next shift.',
    },
    {
      log_id: 'LOG-04',
      asset_id: 'TURB-04',
      logged_at: '2026-11-04T11:30:00Z',
      technician: 'K. Takahashi',
      severity: 'Warning',
      fault_code: 'LUB-114',
      summary: 'Lube oil header pressure dipped 1.4 bar below nominal due to clogged duplex filter element.',
      resolution_notes: 'Switched to bank B filter cartridge and replaced 10-micron element. Oil sample sent for ferrography wear particle analysis.',
    },
    {
      log_id: 'LOG-05',
      asset_id: 'CNC-108',
      logged_at: '2026-11-13T16:10:00Z',
      technician: 'L. Weber',
      severity: 'Critical',
      fault_code: 'SPD-505',
      summary: 'Spindle #8 ceramic angular-contact bearing harmonics exceeded 3.4 mm/s RMS at 12,000 RPM finishing pass.',
      resolution_notes: 'Reduced spindle speed cap to 85% pending cartridge swap. Drawbar clamping force measured at 14.2 kN (nominal 16.0 kN).',
    },
    {
      log_id: 'LOG-06',
      asset_id: 'CNC-108',
      logged_at: '2026-10-28T07:50:00Z',
      technician: 'L. Weber',
      severity: 'Info',
      fault_code: 'MNT-102',
      summary: 'Routine 23,000-hour spindle taper runout calibration and air-oil mist lubricator verification.',
      resolution_notes: 'Taper runout measured 0.003 mm; oil-air mist pulse interval adjusted to 6 minutes.',
    },
    {
      log_id: 'LOG-07',
      asset_id: 'GEAR-09',
      logged_at: '2026-11-12T20:05:00Z',
      technician: 'J. Becker',
      severity: 'Warning',
      fault_code: 'GRB-310',
      summary: 'Gear mesh frequency sidebands rising on Planetary Drive G9 stage-2 ring gear; oil sump temp at 81.5 C.',
      resolution_notes: 'Collected 100 mL gear oil sample; mild brass cage particles detected. Planned borescope tooth pitting inspection.',
    },
    {
      log_id: 'LOG-08',
      asset_id: 'HYD-302',
      logged_at: '2026-11-12T13:40:00Z',
      technician: 'H. Sato',
      severity: 'Warning',
      fault_code: 'HYD-209',
      summary: 'Proportional relief valve chattering during 185-bar dwell phase causing minor pressure oscillation.',
      resolution_notes: 'Bled pilot line air pocket and recalibrated LVDT spool feedback gain; pressure ripple reduced by 60%.',
    },
    {
      log_id: 'LOG-09',
      asset_id: 'TURB-01',
      logged_at: '2026-11-11T10:00:00Z',
      technician: 'M. Alvarez',
      severity: 'Info',
      fault_code: 'INS-001',
      summary: 'Quarterly vibration spectrum baseline and dry-gas seal leakage verification on Compressor A1.',
      resolution_notes: 'All axial/radial proximity probes nominal (< 1.8 mm/s RMS). Primary vent flow steady.',
    },
    {
      log_id: 'LOG-10',
      asset_id: 'PUMP-211',
      logged_at: '2026-11-09T15:25:00Z',
      technician: 'J. Becker',
      severity: 'Info',
      fault_code: 'MNT-108',
      summary: 'Replaced gland packing sleeve and checked motor-pump coupling elastomer spider on Boiler Booster P211.',
      resolution_notes: 'Zero weeping at 12.1 bar discharge. Motor current balanced across all three phases.',
    },
    {
      log_id: 'LOG-11',
      asset_id: 'CHIL-14',
      logged_at: '2026-11-08T08:30:00Z',
      technician: 'S. Chen',
      severity: 'Info',
      fault_code: 'THM-044',
      summary: 'Condenser tube brush cleaning and refrigerant superheat calibration completed.',
      resolution_notes: 'Approach temperature improved by 1.9 C; compressor amp draw down 4.2%.',
    },
    {
      log_id: 'LOG-12',
      asset_id: 'CNC-115',
      logged_at: '2026-11-07T19:15:00Z',
      technician: 'H. Sato',
      severity: 'Info',
      fault_code: 'CAL-019',
      summary: 'Ballbar circularity diagnostic and spindle thermal growth compensation update.',
      resolution_notes: 'Circularity error 0.004 mm within ISO 230-4 tolerance.',
    },
    {
      log_id: 'LOG-13',
      asset_id: 'GEAR-12',
      logged_at: '2026-11-06T12:00:00Z',
      technician: 'M. Alvarez',
      severity: 'Info',
      fault_code: 'LUB-088',
      summary: 'Scheduled breather desiccant cartridge swap and torque arm bushing inspection.',
      resolution_notes: 'No backlash play detected; synthetic gear oil clean.',
    },
    {
      log_id: 'LOG-14',
      asset_id: 'HYD-309',
      logged_at: '2026-11-05T16:40:00Z',
      technician: 'L. Weber',
      severity: 'Warning',
      fault_code: 'HYD-177',
      summary: 'Nitrogen bladder pre-charge pressure on Accumulator Bank 2 measured 15% below spec.',
      resolution_notes: 'Recharged nitrogen bladder to 145 bar and leak-tested Schrader valve core.',
    },
    {
      log_id: 'LOG-15',
      asset_id: 'CHIL-19',
      logged_at: '2026-11-03T09:10:00Z',
      technician: 'K. Takahashi',
      severity: 'Info',
      fault_code: 'CLN-012',
      summary: 'Glycol concentration check (35% propylene glycol) and VFD harmonic filter audit.',
      resolution_notes: 'Freeze protection verified to -18 C; VFD DC bus ripple nominal.',
    },
    {
      log_id: 'LOG-16',
      asset_id: 'PUMP-204',
      logged_at: '2026-10-22T22:15:00Z',
      technician: 'M. Alvarez',
      severity: 'Warning',
      fault_code: 'SEAL-301',
      summary: 'Minor intermittent weepage observed on mechanical seal flush port during cold startup.',
      resolution_notes: 'Adjusted Plan 53A barrier fluid pressure +0.8 bar above stuffing box; weeping ceased.',
    },
    {
      log_id: 'LOG-17',
      asset_id: 'TURB-04',
      logged_at: '2026-10-19T14:00:00Z',
      technician: 'K. Takahashi',
      severity: 'Warning',
      fault_code: 'VIB-315',
      summary: '1x synchronous rotor unbalance peak increased from 2.1 to 2.9 mm/s after boiler steam carryover event.',
      resolution_notes: 'Performed offline walnut-shell rotor wash; balance partially restored pending full overhaul.',
    },
    {
      log_id: 'LOG-18',
      asset_id: 'CNC-108',
      logged_at: '2026-10-14T11:20:00Z',
      technician: 'J. Becker',
      severity: 'Warning',
      fault_code: 'TMP-204',
      summary: 'Chiller return line flow sensor triggered low-flow warning causing transient spindle stator heating.',
      resolution_notes: 'Cleared scale debris from Y-strainer; stator jacket delta-T stabilized at 4.5 C.',
    },
    {
      log_id: 'LOG-19',
      asset_id: 'TURB-01',
      logged_at: '2026-10-09T08:45:00Z',
      technician: 'S. Chen',
      severity: 'Info',
      fault_code: 'OEM-GUIDE',
      summary: 'OEM Siemens Compressor Operating Envelope Standard: Maintain radial vibration <= 4.5 mm/s RMS and bearing temp <= 88 C.',
      resolution_notes: 'Automated trip interlock configured at 95 C bearing metal temperature or 7.1 mm/s RMS ISO 10816 Zone D.',
    },
    {
      log_id: 'LOG-20',
      asset_id: 'PUMP-204',
      logged_at: '2026-10-05T10:30:00Z',
      technician: 'S. Chen',
      severity: 'Info',
      fault_code: 'OEM-GUIDE',
      summary: 'OEM Flowserve Pump Maintenance Protocol: Cavitation occurs when suction pressure drops below NPSHr; inspect strainers if vibration > 3.5 mm/s.',
      resolution_notes: 'Recommended bearing grease relubrication every 4,000 hours; full overhaul threshold at 20,000 operating hours.',
    },
    {
      log_id: 'LOG-21',
      asset_id: 'GEAR-09',
      logged_at: '2026-10-02T15:00:00Z',
      technician: 'L. Weber',
      severity: 'Info',
      fault_code: 'OEM-GUIDE',
      summary: 'OEM Flender Gearbox Standard: Oil sump steady-state temperature should not exceed 85 C; gear mesh sidebands indicate tooth flank wear.',
      resolution_notes: 'Synthetic PAO ISO VG 320 drain interval is 10,000 hours or upon TAN > 1.5 mg KOH/g.',
    },
    {
      log_id: 'LOG-22',
      asset_id: 'CNC-108',
      logged_at: '2026-09-28T13:10:00Z',
      technician: 'L. Weber',
      severity: 'Info',
      fault_code: 'OEM-GUIDE',
      summary: 'OEM DMG Mori Spindle Specification: Hybrid ceramic bearing RMS vibration above 2.8 mm/s at >10,000 RPM signals preload loss or spalling.',
      resolution_notes: 'Immediate speed derating to 80% advised if temp exceeds 76 C or drawbar force drops below 14.5 kN.',
    },
  ];

  const insertLog = db.prepare(
    `INSERT INTO maintenance_logs (log_id, asset_id, logged_at, technician, severity, fault_code, summary, resolution_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const l of logs) {
    insertLog.run([
      l.log_id,
      l.asset_id,
      l.logged_at,
      l.technician,
      l.severity,
      l.fault_code,
      l.summary,
      l.resolution_notes,
    ]);
  }
  insertLog.free();

  dbInstance = db;
  return db;
}

export function queryAll<T = Record<string, unknown>>(db: Database, sql: string, params: (string | number | null)[] = []): T[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export interface SafeSqlExecutionResult {
  columns: string[];
  rows: Record<string, unknown>[];
  executionMs: number;
  rowCount: number;
}

const FORBIDDEN_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i;

export function executeReadOnlySql(db: Database, rawSql: string): SafeSqlExecutionResult {
  const cleaned = rawSql.trim().replace(/;+\s*$/, '');
  if (!cleaned) {
    throw new Error('SQL query is empty.');
  }
  if (cleaned.includes(';')) {
    throw new Error('Multiple SQL statements are not permitted.');
  }
  if (!/^(SELECT|WITH)\b/i.test(cleaned)) {
    throw new Error('Only read-only SELECT or WITH queries are permitted.');
  }
  if (FORBIDDEN_SQL_PATTERN.test(cleaned)) {
    throw new Error('Mutation or DDL keywords are blocked in read-only SQL mode.');
  }

  const start = performance.now();
  const stmt = db.prepare(cleaned);
  const columns = stmt.getColumnNames();
  const rows: Record<string, unknown>[] = [];
  let count = 0;
  while (stmt.step()) {
    if (count < 100) {
      rows.push(stmt.getAsObject());
    }
    count++;
  }
  stmt.free();
  const executionMs = Number((performance.now() - start).toFixed(2));

  return {
    columns,
    rows,
    executionMs,
    rowCount: count,
  };
}

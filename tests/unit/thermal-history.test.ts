import { describe, expect, it } from 'vitest';
import {
  parseExternalSnapshot,
  unavailableSensors,
  type ExternalSensor,
  type ExternalSnapshot,
} from '../../packages/application-ui/src/external-sensors';
import {
  TemperatureHistory,
  chartSegments,
  chartRanges,
  defaultThresholds,
  temperatureWarning,
  sensorKey,
  MAX_HISTORY_POINTS,
  MAX_HISTORY_SENSORS,
  MAX_SENSOR_POINTS,
} from '../../packages/application-ui/src/thermal-history';
const sensor = (at = 100000, id = '/temperature/0'): ExternalSensor => ({
  hardwareId: '/intelcpu/0',
  hardwareName: 'Mock CPU',
  category: 'cpu',
  sensorId: id,
  sensorName: 'Package',
  kind: 'temperature',
  unit: 'celsius',
  value: 90,
  observedAt: at,
  measuredAt: null,
  availability: 'available',
  deviceMatch: 'unmatched',
});
const snapshot = (at = 100000, sensors = [sensor(at)]): ExternalSnapshot => ({
  ...unavailableSensors('connected'),
  observedAt: at,
  sensors,
});
describe('bounded, honest session history', () => {
  it('keeps real observations only, ignores cached and out-of-order observations', () => {
    const history = new TemperatureHistory();
    history.observe(snapshot(), 100000);
    history.observe(snapshot(), 101000);
    history.observe(snapshot(99000), 101000);
    expect(history.get(sensorKey(sensor()))).toEqual([[100000, 90]]);
    history.observe(snapshot(105000), 105000);
    expect(history.pointCount).toBe(2);
  });
  it('missing readings and shutdown create gaps, never zero values or interpolated samples', () => {
    const history = new TemperatureHistory();
    history.observe(snapshot(), 100000);
    history.observe(snapshot(105000, []), 105000);
    history.observe(unavailableSensors('Server stopped'), 110000);
    history.observe(snapshot(120000), 120000);
    expect(history.get(sensorKey(sensor()))).toEqual([
      [100000, 90],
      [105000, null],
      [120000, 90],
    ]);
    expect(chartSegments(history.get(sensorKey(sensor())), 120000, 1)).toEqual([
      [[100000, 90]],
      [[120000, 90]],
    ]);
  });
  it.each(['missing', 'unsupported', 'stale', 'ambiguous'] as const)(
    'does not record %s values',
    (availability) => {
      const history = new TemperatureHistory();
      history.observe(snapshot(100000, [{ ...sensor(), value: null, availability }]), 100000);
      expect(history.pointCount).toBe(0);
    },
  );
  it('rejects stale, future, duplicate and invalid observations for history and warnings', () => {
    for (const now of [99999, 115001]) {
      const history = new TemperatureHistory();
      history.observe(snapshot(), now);
      expect(history.pointCount).toBe(0);
      expect(temperatureWarning(sensor(), now, true, defaultThresholds)).toBe(false);
    }
    const duplicate = parseExternalSnapshot(snapshot(100000, [sensor(), sensor()]));
    expect(duplicate.sensors.every((s) => s.availability === 'ambiguous' && s.value === null)).toBe(
      true,
    );
    const history = new TemperatureHistory();
    history.observe(duplicate, 100000);
    expect(history.pointCount).toBe(0);
    for (const value of [null, NaN, Infinity, -101, 201])
      expect(temperatureWarning({ ...sensor(), value }, 100000, true, defaultThresholds)).toBe(
        false,
      );
    expect(() =>
      parseExternalSnapshot(
        snapshot(
          100000,
          Array.from({ length: 4097 }, () => sensor()),
        ),
      ),
    ).toThrow();
  });
  it('duplicate hardware names remain separate source identities', () => {
    const a = sensor(),
      b = { ...a, hardwareId: '/amdcpu/0' };
    const history = new TemperatureHistory();
    history.observe(snapshot(100000, [a, b]), 100000);
    expect(history.entries()).toHaveLength(2);
    expect(sensorKey(a)).not.toBe(sensorKey(b));
  });
  it('caps sensor cardinality, per-sensor observations, total observations and age', () => {
    const history = new TemperatureHistory();
    for (let i = 0; i < 800; i++) {
      const at = 100000 + i * 4000;
      history.observe(
        snapshot(
          at,
          Array.from({ length: 70 }, (_, index) => sensor(at, `/temperature/${index}`)),
        ),
        at,
      );
    }
    expect(history.entries()).toHaveLength(MAX_HISTORY_SENSORS);
    expect(history.pointCount).toBeLessThanOrEqual(MAX_HISTORY_POINTS);
    expect(history.truncated).toBe(true);
    expect(history.entries().every(([, series]) => series.points.length <= MAX_SENSOR_POINTS)).toBe(
      true,
    );
    history.prune(100000 + 800 * 4000 + 3600001);
    expect(history.entries()).toHaveLength(0);
  });
  it('caps a single series under faster synthetic input and resets all session state', () => {
    const history = new TemperatureHistory();
    for (let i = 0; i < 1000; i++) history.observe(snapshot(100000 + i), 100000 + i);
    expect(history.pointCount).toBe(MAX_SENSOR_POINTS);
    history.clear();
    expect(history.pointCount).toBe(0);
    expect(history.truncated).toBe(false);
    history.observe(snapshot(), 100000);
    expect(history.pointCount).toBe(1);
  });
  it('supports bounded ranges and breaks a chart at missing time intervals', () => {
    expect(chartRanges).toEqual([1, 5, 15, 30, 60]);
    expect(
      chartSegments(
        [
          [100000, 40],
          [105000, 42],
          [125001, 44],
          [126000, null],
          [130000, 43],
          [200000, 20],
        ],
        130000,
        1,
      ),
    ).toEqual([
      [
        [100000, 40],
        [105000, 42],
      ],
      [[125001, 44]],
      [[130000, 43]],
    ]);
    expect(chartSegments([[100000, 40]], 200000, 1)).toEqual([]);
  });
  it('warnings are opt-in, category-specific, configurable and only fresh', () => {
    expect(temperatureWarning(sensor(), 100000, false, defaultThresholds)).toBe(false);
    expect(temperatureWarning(sensor(), 100000, true, defaultThresholds)).toBe(true);
    expect(temperatureWarning(sensor(), 100000, true, { ...defaultThresholds, cpu: 91 })).toBe(
      false,
    );
    expect(
      temperatureWarning({ ...sensor(), category: 'unsupported' }, 100000, true, defaultThresholds),
    ).toBe(false);
    expect(temperatureWarning(sensor(), 100000, true, { ...defaultThresholds, cpu: NaN })).toBe(
      false,
    );
  });
});

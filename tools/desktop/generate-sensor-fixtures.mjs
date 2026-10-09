// Synthetic public-contract fixtures; no data captured from a PC.
import { mkdirSync, writeFileSync } from 'node:fs';
const directory = 'tests/fixtures/sensors';
mkdirSync(directory, { recursive: true });
let index;
function node(Text, Children = [], fields = {}) {
  return { id: index++, Text, Min: '', Value: '', Max: '', ImageURL: '', Children, ...fields };
}
function hardware(name, HardwareId, values) {
  const sensors = values.map(([Text, RawValue], i) =>
    node(Text, [], {
      SensorId: `${HardwareId}/temperature/${i}`,
      Type: 'Temperature',
      Value: RawValue,
      RawValue,
      RawMin: '',
      RawMax: '',
    }),
  );
  return node(name, [node('Temperatures', sensors)], { HardwareId });
}
function save(name, devices) {
  index = 0;
  const children = devices();
  const root = node('Sensor', [node('Mock computer', children)], {
    Version: '0.9.6',
    Min: 'Min',
    Value: 'Value',
    Max: 'Max',
  });
  writeFileSync(`${directory}/${name}.json`, JSON.stringify(root, null, 2) + '\n');
}
function motherboard(name, chip) {
  return node(name, [hardware('Mock sensor chip', chip, [['System', '33 °C']])], {
    HardwareId: '/motherboard',
  });
}
save('intel-nvidia', () => [
  hardware('Intel Core i7 (synthetic)', '/intelcpu/0', [['CPU Package', '45,5 °C']]),
  hardware('NVIDIA GeForce (synthetic)', '/gpu-nvidia/0', [['GPU Core', '48 °C']]),
  hardware('Intel integrated graphics (synthetic)', '/gpu-intel/0', [['GPU Core', '40 °C']]),
  motherboard('ASUS motherboard (synthetic)', '/lpc/nct6798d/0'),
  hardware('Samsung NVMe (synthetic)', '/nvme/0', [['Composite', '37 °C']]),
  hardware('WD SATA SSD (synthetic)', '/ssd/0', [['Temperature', '31 °C']]),
  hardware('Seagate HDD (synthetic)', '/hdd/0', [['Temperature', '30 °C']]),
  hardware('DDR5 DIMM (synthetic)', '/memory/dimm/0', [
    ['Module', '35 °C'],
    ['Thermal Sensor High Limit', '85 °C'],
  ]),
]);
save('amd-integrated', () => [
  hardware('AMD Ryzen (synthetic)', '/amdcpu/0', [['CPU (Tctl/Tdie)', '122 °F']]),
  hardware('AMD Radeon integrated (synthetic)', '/gpu-amd/0', [['GPU Core', '44 °C']]),
  motherboard('MSI motherboard (synthetic)', '/lpc/it8688e/0'),
]);
save('duplicate-names', () => [
  hardware('Identical SSD name (synthetic)', '/nvme/0', [['Composite', '36 °C']]),
  hardware('Identical SSD name (synthetic)', '/nvme/1', [['Composite', '38 °C']]),
]);
save('absent', () => [
  node('CPU with no temperature', [], { HardwareId: '/intelcpu/0' }),
  node('RAM with no temperature', [], { HardwareId: '/ram' }),
]);
writeFileSync(`${directory}/malformed.json`, '{"Version":"0.9.6","Children":"not-an-array"}\n');

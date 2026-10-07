import { motherboardComponents } from '@cortex/3d-engine';
import { useViewerStore } from './store';
import { Icon, type IconName } from '../icons';
const icons: Record<string, IconName> = {
  board: 'box',
  socket: 'chip',
  dimm: 'layers',
  pcie: 'grid',
  m2: 'box',
  heatsink: 'layers',
  power: 'chip',
  io: 'grid',
};
export default function ComponentList() {
  const selected = useViewerStore((s) => s.selected);
  const select = useViewerStore((s) => s.select);
  return (
    <nav className="component-list" aria-label="Motherboard components">
      <div className="section-label">
        COMPONENTS <span>{motherboardComponents.length.toString().padStart(2, '0')}</span>
      </div>
      <div className="component-list-items">
        {motherboardComponents.map((component, i) => (
          <button
            key={component.id}
            className={selected === component.id ? 'component-button active' : 'component-button'}
            aria-pressed={selected === component.id}
            onClick={() => select(component.id)}
          >
            <Icon name={icons[component.kind] ?? 'box'} size={16} />
            <span>{component.label}</span>
            <small>{(i + 1).toString().padStart(2, '0')}</small>
          </button>
        ))}
      </div>
      <div className="list-note">
        <Icon name="info" size={15} />
        <span>Select a region in the model or use this component list.</span>
      </div>
    </nav>
  );
}

import { motherboardComponents, type ComponentId } from '@cortex/3d-engine';
export default function FallbackDiagram({
  selected,
  onSelect,
  exploded,
}: {
  selected: ComponentId | null;
  onSelect(id: ComponentId): void;
  exploded: boolean;
}) {
  return (
    <div className="fallback-model" data-testid="fallback-diagram">
      <svg
        role="img"
        aria-label="Motherboard component diagram. Use the component list to select regions."
        viewBox="-142 -170 284 350"
      >
        <rect x="-122" y="-152.5" width="244" height="305" rx="4" className="diagram-pcb" />
        {motherboardComponents
          .filter((c) => c.kind !== 'board')
          .map((c) => (
            <g
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={selected === c.id ? 'diagram-region selected' : 'diagram-region'}
              transform={`translate(${c.position[0]} ${c.position[2] - (exploded ? c.explode * 0.1 : 0)})`}
            >
              <title>{c.label}</title>
              <rect
                x={-c.size[0] / 2}
                y={-c.size[2] / 2}
                width={c.size[0]}
                height={c.size[2]}
                rx="2"
              />
              {['socket', 'heatsink'].includes(c.kind) && (
                <text textAnchor="middle" dominantBaseline="middle">
                  {c.kind === 'socket' ? 'CPU' : c.id.includes('chipset') ? 'CHIPSET' : 'VRM'}
                </text>
              )}
            </g>
          ))}
        <text x="-95" y="-15" className="diagram-brand">
          CORTEX / ATX
        </text>
      </svg>
      <span className="diagram-caption">2D component diagram · illustrative layout</span>
    </div>
  );
}

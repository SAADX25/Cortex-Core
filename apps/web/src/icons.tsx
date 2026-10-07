import type { CSSProperties } from 'react';
export type IconName =
  | 'chip'
  | 'grid'
  | 'arrow'
  | 'layers'
  | 'eye'
  | 'reset'
  | 'focus'
  | 'expand'
  | 'info'
  | 'check'
  | 'close'
  | 'chevron'
  | 'box';
const paths: Record<IconName, string> = {
  chip: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 5 9 5 9-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  reset: 'M4 9a8 8 0 1 1 0 6M4 3v6h6',
  focus: 'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6M9 12h6m-3-3v6',
  expand: 'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6',
  info: 'M12 16v-5m0-3v.1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7',
  box: 'm12 3 9 5v9l-9 5-9-5V8l9-5zm0 10v9M3 8l9 5 9-5',
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}

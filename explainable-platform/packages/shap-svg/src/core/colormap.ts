import colormaps from "../../fixtures/colormaps.json";

export type ColormapName = "red_blue" | "red_white_blue";

const tables = colormaps as Record<ColormapName, string[]>;

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

function hexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

/** Samples a captured SHAP colour map, interpolating adjacent LUT entries in sRGB. */
export function sampleColormap(name: ColormapName, t: number): string {
  if (!Number.isFinite(t)) {
    throw new RangeError(`colormap position must be finite, received ${String(t)}`);
  }

  const table = tables[name];
  if (!table) throw new RangeError(`unknown colormap ${String(name)}`);

  const position = Math.max(0, Math.min(1, t)) * (table.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;
  const lower = table[lowerIndex];
  const upper = table[upperIndex];

  const red = channel(lower, 1) + (channel(upper, 1) - channel(lower, 1)) * fraction;
  const green = channel(lower, 3) + (channel(upper, 3) - channel(lower, 3)) * fraction;
  const blue = channel(lower, 5) + (channel(upper, 5) - channel(lower, 5)) * fraction;
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

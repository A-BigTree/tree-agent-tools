export const GRIDS_KEY = "multi-repo.grids";

export function planRows(plan, children) {
  const rows = [];
  for (const step of plan) {
    rows[step.row] ??= [];
    rows[step.row][step.col] = children[step.child] ?? null;
  }
  return rows.map((row) => row.filter(Boolean));
}

export function widthFix(rows, colsByAddress) {
  for (const [row, rowCells] of rows.entries()) {
    const count = rowCells.length;
    if (count < 2) continue;
    const values = rowCells.map((address) => Number(colsByAddress.get(address)) || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!total) continue;
    let cumulative = 0;
    for (let index = 0; index < count - 1; index++) {
      cumulative += values[index];
      const target = (total * (index + 1)) / count;
      const diff = cumulative - target;
      if (Math.abs(diff) > 1) return { row, index, delta: Math.round(-diff) };
    }
  }
  return null;
}

export function heightFix(rows, rowsByAddress) {
  const firsts = rows.map((row) => row[0]).filter(Boolean);
  const count = firsts.length;
  if (count < 2) return null;
  const values = firsts.map((address) => Number(rowsByAddress.get(address)) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  let cumulative = 0;
  for (let index = 0; index < count - 1; index++) {
    cumulative += values[index];
    const target = (total * (index + 1)) / count;
    const diff = cumulative - target;
    if (Math.abs(diff) > 1) return { index, delta: Math.round(-diff) };
  }
  return null;
}

export function resizePx(deltaCells, pxPerCell) {
  return Math.round(deltaCells * pxPerCell);
}

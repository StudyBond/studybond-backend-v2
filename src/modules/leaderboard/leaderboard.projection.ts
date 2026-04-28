export function hasBoundaryTieAmbiguity(
  projectedPrimaryScores: number[],
  boundaryScore: number,
  globalBoundaryCount: number
): boolean {
  const projectedBoundaryCount = projectedPrimaryScores.filter((score) => score === boundaryScore).length;
  return globalBoundaryCount > projectedBoundaryCount;
}

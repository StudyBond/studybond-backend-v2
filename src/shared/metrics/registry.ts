export interface MetricLabels {
  [key: string]: string | number | boolean;
}

export interface MetricSeriesPoint {
  labels: MetricLabels;
  value: number;
}

interface HistogramPoint {
  bucketCounts: number[];
  sum: number;
  count: number;
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 2000, 5000];

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function normalizeLabelValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function labelsToKey(labels?: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const entries = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${normalizeLabelValue(value)}`);
  return entries.join(',');
}

function labelsToPrometheus(labels?: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const entries = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${normalizeLabelValue(value).replace(/"/g, '\\"')}"`);
  return `{${entries.join(',')}}`;
}

function mergeLabels(base: MetricLabels | undefined, extra: MetricLabels): MetricLabels {
  return {
    ...(base || {}),
    ...extra
  };
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly gauges = new Map<string, Map<string, number>>();
  private readonly histograms = new Map<string, Map<string, HistogramPoint>>();
  private readonly labelsBySeries = new Map<string, MetricLabels>();
  private readonly histogramBuckets = new Map<string, number[]>();

  private rememberLabels(metricName: string, labelKey: string, labels?: MetricLabels): void {
    const composed = `${metricName}::${labelKey}`;
    if (labels && !this.labelsBySeries.has(composed)) {
      this.labelsBySeries.set(composed, labels);
    }
  }

  incrementCounter(name: string, value = 1, labels?: MetricLabels): void {
    const metricName = sanitizeMetricName(name);
    const labelKey = labelsToKey(labels);
    const series = this.counters.get(metricName) ?? new Map<string, number>();
    const current = series.get(labelKey) ?? 0;
    series.set(labelKey, current + value);
    this.counters.set(metricName, series);
    this.rememberLabels(metricName, labelKey, labels);
  }

  setGauge(name: string, value: number, labels?: MetricLabels): void {
    const metricName = sanitizeMetricName(name);
    const labelKey = labelsToKey(labels);
    const series = this.gauges.get(metricName) ?? new Map<string, number>();
    series.set(labelKey, value);
    this.gauges.set(metricName, series);
    this.rememberLabels(metricName, labelKey, labels);
  }

  observeHistogram(name: string, value: number, labels?: MetricLabels, buckets: number[] = DEFAULT_BUCKETS): void {
    const metricName = sanitizeMetricName(name);
    const labelKey = labelsToKey(labels);
    const series = this.histograms.get(metricName) ?? new Map<string, HistogramPoint>();
    const existing = series.get(labelKey) ?? {
      bucketCounts: buckets.map(() => 0),
      sum: 0,
      count: 0
    };

    for (let index = 0; index < buckets.length; index += 1) {
      if (value <= buckets[index]) {
        existing.bucketCounts[index] += 1;
      }
    }
    existing.sum += value;
    existing.count += 1;
    series.set(labelKey, existing);
    this.histograms.set(metricName, series);
    this.histogramBuckets.set(metricName, buckets);
    this.rememberLabels(metricName, labelKey, labels);
  }

  private matchesFilter(labels: MetricLabels, filter?: MetricLabels): boolean {
    if (!filter) return true;
    return Object.entries(filter).every(([key, value]) => labels[key] === value);
  }

  getCounterSeries(name: string, filter?: MetricLabels): MetricSeriesPoint[] {
    const metricName = sanitizeMetricName(name);
    const series = this.counters.get(metricName);
    if (!series) return [];

    const points: MetricSeriesPoint[] = [];
    for (const [labelKey, value] of series.entries()) {
      const labels = this.labelsBySeries.get(`${metricName}::${labelKey}`) || {};
      if (!this.matchesFilter(labels, filter)) continue;
      points.push({ labels, value });
    }

    return points;
  }

  getGaugeSeries(name: string, filter?: MetricLabels): MetricSeriesPoint[] {
    const metricName = sanitizeMetricName(name);
    const series = this.gauges.get(metricName);
    if (!series) return [];

    const points: MetricSeriesPoint[] = [];
    for (const [labelKey, value] of series.entries()) {
      const labels = this.labelsBySeries.get(`${metricName}::${labelKey}`) || {};
      if (!this.matchesFilter(labels, filter)) continue;
      points.push({ labels, value });
    }

    return points;
  }

  getCounterTotal(name: string, filter?: MetricLabels): number {
    return this.getCounterSeries(name, filter)
      .reduce((total, point) => total + point.value, 0);
  }

  getGaugeTotal(name: string, filter?: MetricLabels): number {
    return this.getGaugeSeries(name, filter)
      .reduce((total, point) => total + point.value, 0);
  }

  toPrometheus(): string {
    const lines: string[] = [];

    for (const [metric, series] of this.counters.entries()) {
      lines.push(`# TYPE ${metric} counter`);
      for (const [labelKey, value] of series.entries()) {
        const labels = this.labelsBySeries.get(`${metric}::${labelKey}`);
        lines.push(`${metric}${labelsToPrometheus(labels)} ${value}`);
      }
    }

    for (const [metric, series] of this.gauges.entries()) {
      lines.push(`# TYPE ${metric} gauge`);
      for (const [labelKey, value] of series.entries()) {
        const labels = this.labelsBySeries.get(`${metric}::${labelKey}`);
        lines.push(`${metric}${labelsToPrometheus(labels)} ${value}`);
      }
    }

    for (const [metric, series] of this.histograms.entries()) {
      lines.push(`# TYPE ${metric} histogram`);
      const buckets = this.histogramBuckets.get(metric) ?? DEFAULT_BUCKETS;

      for (const [labelKey, point] of series.entries()) {
        const labels = this.labelsBySeries.get(`${metric}::${labelKey}`);
        let cumulative = 0;
        for (let index = 0; index < buckets.length; index += 1) {
          cumulative += point.bucketCounts[index];
          lines.push(
            `${metric}_bucket${labelsToPrometheus(mergeLabels(labels, { le: buckets[index] }))} ${cumulative}`
          );
        }

        lines.push(
          `${metric}_bucket${labelsToPrometheus(mergeLabels(labels, { le: '+Inf' }))} ${point.count}`
        );
        lines.push(`${metric}_sum${labelsToPrometheus(labels)} ${point.sum}`);
        lines.push(`${metric}_count${labelsToPrometheus(labels)} ${point.count}`);
      }
    }

    return `${lines.join('\n')}\n`;
  }
}

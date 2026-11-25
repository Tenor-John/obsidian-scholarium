export type PlotToolName = 'inspect_dataset' | 'get_plot_context' | 'render_plot' | 'revise_plot';
export type PlotKind = 'line' | 'scatter' | 'bar';
export type PlotToolStatus = 'success' | 'needs_user_confirmation' | 'error';

export interface PlotAnnotation {
  id?: string;
  type: 'hline' | 'vline';
  value: number;
  label?: string;
}

export interface SchDataPlotChartStyle {
  theme?: 'publication' | 'soft' | 'dark';
  markers?: 'auto' | 'all' | 'none';
  show_grid?: boolean;
  line_width?: number;
  x_range?: [number, number] | null;
  y_range?: [number, number] | null;
  annotations?: PlotAnnotation[];
  series_colors?: Record<string, string>;
  fig_size?: [number, number];
  spines?: Partial<Record<'top' | 'right' | 'left' | 'bottom', boolean>>;
  border_width?: number;
  title_size?: number;
  label_size?: number;
  tick_size?: number;
  x_label?: string | null;
  y_label?: string | null;
  legend?: 'bottom' | 'right' | 'none';
  marker_size?: number;
  line_style?: 'solid' | 'dashed' | 'dotted';
  tick_count?: number;
}

export interface PlotRecipe {
  plot_kind: PlotKind;
  title?: string;
  x_column: string;
  y_columns: string[];
  chart_style?: SchDataPlotChartStyle;
}

export interface InspectDatasetInput {
  dataset_path: string;
  sample_rows?: number;
}

export interface GetPlotContextInput {
  target_manifest_id?: string;
  plot_id?: string;
}

export interface RenderPlotInput {
  dataset_path: string;
  recipe: PlotRecipe;
}

export interface PlotManifestPatch {
  title?: string;
  chart_style?: SchDataPlotChartStyle;
  series_updates?: Array<{ id: string; color?: string }>;
  annotations_upsert?: Array<{
    id: string;
    type?: 'hline' | 'vline';
    value?: number;
    label?: string;
  }>;
  remove_ids?: string[];
}

export interface RevisePlotInput {
  target_manifest_id: string;
  base_version: number;
  revision_reason: string;
  patch: PlotManifestPatch;
  save_mode?: 'new_version';
}

export interface PlotToolInputMap {
  inspect_dataset: InspectDatasetInput;
  get_plot_context: GetPlotContextInput;
  render_plot: RenderPlotInput;
  revise_plot: RevisePlotInput;
}

export interface PlotExecutionOptions {
  output_root?: string;
  active_target_manifest_id?: string;
  researcher_confirmed?: boolean;
  researcher_save_mode?: 'new_version' | 'overwrite';
}

export interface PlotToolWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggested_fix?: string;
}

export interface PlotManifestSummary {
  plot_id: string;
  target_manifest_id: string;
  version: number;
  title: string;
  chart_type: PlotKind;
  x_column: string;
  series_list: Array<{ id: string; y_column: string; color?: string }>;
  annotations_list: Array<{ id: string; type: 'hline' | 'vline'; value: number; label?: string }>;
  style: {
    theme: string;
    show_grid: boolean;
    legend: string;
    x_range: [number, number] | null;
    y_range: [number, number] | null;
  };
}

export interface ColumnMappingEntry {
  id?: string;
  requested: string;
  resolved: string | null;
  status: 'matched' | 'substituted' | 'dropped' | 'missing' | 'not_numeric';
}

export interface PlotToolObservation {
  schema_version: 1;
  status: PlotToolStatus;
  tool: 'render_plot' | 'revise_plot';
  plot_id: string;
  target_manifest_id: string;
  current_version: number;
  svg_path: string;
  manifest_path: string;
  manifest_summary: PlotManifestSummary | null;
  column_mapping: {
    status: 'verified' | 'changed' | 'invalid';
    x: ColumnMappingEntry;
    series: ColumnMappingEntry[];
  } | null;
  warnings: PlotToolWarning[];
  audit: {
    dataset_path: string;
    dataset_hash: string;
    dataset_readonly: true;
    parent_manifest_id: string | null;
    parent_version: number | null;
    save_mode: 'new_version' | 'overwrite';
    revision_reason?: string;
  } | null;
  error?: { code: string; message: string; retryable: boolean };
}

export interface InspectDatasetObservation {
  schema_version: 1;
  status: PlotToolStatus;
  tool: 'inspect_dataset';
  dataset: {
    path: string;
    sha256?: string;
    rows: number;
    columns: number;
    encoding?: string;
    delimiter?: string;
    readonly: true;
  };
  columns: Array<{
    name: string;
    inferred_type: 'numeric' | 'text';
    missing_count: number;
    non_missing_count: number;
    numeric_count: number;
    numeric_range?: [number, number];
  }>;
  sample: Array<Record<string, string | null>>;
  warnings: PlotToolWarning[];
  error?: { code: string; message: string; retryable: boolean };
}

export interface PlotContextObservation {
  schema_version: 1;
  status: PlotToolStatus;
  tool: 'get_plot_context';
  active: PlotManifestSummary | null;
  versions: Array<{
    target_manifest_id: string;
    version: number;
    created_at: string;
    svg_path: string;
    manifest_path: string;
  }>;
  warnings: PlotToolWarning[];
  error?: { code: string; message: string; retryable: boolean };
}

export interface PlotToolObservationMap {
  inspect_dataset: InspectDatasetObservation;
  get_plot_context: PlotContextObservation;
  render_plot: PlotToolObservation;
  revise_plot: PlotToolObservation;
}

export interface PlotToolClient {
  execute<N extends PlotToolName>(
    name: N,
    input: PlotToolInputMap[N],
    options?: PlotExecutionOptions,
  ): Promise<PlotToolObservationMap[N]>;
  inspect_dataset(input: InspectDatasetInput): Promise<InspectDatasetObservation>;
  get_plot_context(input: GetPlotContextInput, options?: PlotExecutionOptions): Promise<PlotContextObservation>;
  render_plot(input: RenderPlotInput, options?: PlotExecutionOptions): Promise<PlotToolObservation>;
  revise_plot(input: RevisePlotInput, options?: PlotExecutionOptions): Promise<PlotToolObservation>;
}

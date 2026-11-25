import { schMaterialBridgeJson } from './material-bridge';
import type {
  GetPlotContextInput,
  InspectDatasetInput,
  PlotExecutionOptions,
  PlotToolClient,
  PlotToolInputMap,
  PlotToolName,
  PlotToolObservationMap,
  RenderPlotInput,
  RevisePlotInput,
} from './plot-tool-types';

interface PlotPluginLike {
  app: {
    vault: {
      adapter: {
        getBasePath?: () => string;
      };
    };
  };
}

export function schCreatePlotToolClient(plugin: PlotPluginLike): PlotToolClient {
  async function execute<N extends PlotToolName>(
    name: N,
    input: PlotToolInputMap[N],
    options: PlotExecutionOptions = {},
  ): Promise<PlotToolObservationMap[N]> {
    const workspace = plugin.app.vault.adapter.getBasePath?.();
    if (!workspace) throw new Error('当前 Vault 不是本地桌面 Vault，无法使用绘图工具');
    const response = await schMaterialBridgeJson(plugin, `/v1/plot-tools/${name}`, {
      method: 'POST',
      body: JSON.stringify({
        arguments: input,
        context: {
          workspace,
          output_root: options.output_root,
          active_target_manifest_id: options.active_target_manifest_id,
          researcher_confirmed: options.researcher_confirmed === true,
          researcher_save_mode: options.researcher_save_mode || 'new_version',
        },
      }),
    }) as { observation?: PlotToolObservationMap[N] };
    if (!response || !response.observation) throw new Error('绘图工具运行时未返回 Observation');
    return response.observation;
  }

  return {
    execute,
    inspect_dataset: (input: InspectDatasetInput) => execute('inspect_dataset', input),
    get_plot_context: (input: GetPlotContextInput, options: PlotExecutionOptions = {}) => execute('get_plot_context', input, options),
    render_plot: (input: RenderPlotInput, options: PlotExecutionOptions = {}) => execute('render_plot', input, options),
    revise_plot: (input: RevisePlotInput, options: PlotExecutionOptions = {}) => execute('revise_plot', input, options),
  };
}

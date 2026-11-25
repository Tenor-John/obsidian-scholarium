import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('plot', Path(__file__).with_name('generate_plot.py'))
plot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plot)
rows = [{'x': '1', 'a': '2', 'b': '5'}, {'x': '2', 'a': '4', 'b': '3'}]
svg, _ = plot.svg_chart(rows, 'x', ['a', 'b'], 'line', 'test', plot.chart_style({'show_peaks': True}))
assert 'data-series="a" data-x="2" data-y="4"' in svg
assert 'data-series="b" data-x="1" data-y="5"' in svg
assert 'peak-marker' not in plot.svg_chart(rows, 'x', ['a'], 'line', 'test', plot.chart_style({}))[0]
print('peak tests passed')

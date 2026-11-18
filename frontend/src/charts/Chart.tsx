import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  init,
  use,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core';
import { BarChart, ChordChart, GraphChart, SankeyChart } from 'echarts/charts';
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';

use([
  BarChart,
  GraphChart,
  SankeyChart,
  ChordChart,
  LabelLayout,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
  SVGRenderer,
]);

export function Chart({
  option,
  label,
  graph = false,
  height,
  fitOption,
}: {
  option: EChartsCoreOption;
  label: string;
  graph?: boolean;
  height?: number;
  fitOption?: (width: number, height: number) => EChartsCoreOption;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const currentOptions = useRef({ option, fitOption });
  currentOptions.current = { option, fitOption };
  useEffect(() => {
    if (!element.current) return;
    const instance = init(element.current, undefined, { renderer: 'svg' });
    chart.current = instance;
    const observer = new ResizeObserver(() => {
      instance.resize();
      const current = currentOptions.current;
      instance.setOption(
        current.fitOption
          ? current.fitOption(instance.getWidth(), instance.getHeight())
          : current.option,
        { notMerge: true }
      );
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = chart.current;
    if (instance)
      instance.setOption(
        fitOption
          ? fitOption(instance.getWidth(), instance.getHeight())
          : option,
        { notMerge: true }
      );
  }, [option, fitOption]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [expanded]);
  return (
    <div className={`chart-frame ${expanded ? 'chart-expanded' : ''}`}>
      {graph && (
        <button
          type="button"
          className="secondary chart-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? 'collapseChart' : 'expandChart')}
        </button>
      )}
      <div
        ref={element}
        className={`echart ${graph ? 'echart-graph' : 'echart-timeline'}`}
        style={expanded ? { height: '100%' } : height ? { height } : undefined}
        role="img"
        aria-label={label}
      />
    </div>
  );
}

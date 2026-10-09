// Tree-shaken ECharts registration — only the chart families + components we use,
// SVG renderer (SSR/jsdom safe, crisp vectors, no canvas dependency).
import * as echarts from "echarts/core";
import { BarChart, GaugeChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  SVGRenderer,
]);

export { echarts };
export type { EChartsType } from "echarts/core";

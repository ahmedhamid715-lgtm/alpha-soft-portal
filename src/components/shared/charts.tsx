"use client"

import {
  Area,
  AreaChart as RechartsAreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as RechartsLineChart,
  Pie,
  PieChart as RechartsPieChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

/**
 * Chart primitives, applying the dataviz skill's rules: one axis (never
 * dual-axis), thin recessive gridlines, a legend whenever there's more
 * than one series, tooltips always on (an HTML/SVG chart is interactive
 * by default), and the validated categorical palette from globals.css
 * (--chart-1..5) — never an ad hoc color per chart. See
 * docs/architecture/design-system.md "Data visualization" for the
 * validation results and why brand-primary (--chart-1) always needs a
 * visible label, not color alone, at this contrast against the dark
 * surface.
 */

export type { ChartConfig }

const compactNumberFormatter = new Intl.NumberFormat("en-US", { notation: "compact" })
/**
 * Y-axis tick formatter. Without it, a fixed narrow axis width clips large
 * values (e.g. "60,000" rendering as a visually-truncated "000") — compact
 * notation ("60K") is also the better choice on its own merits: shorter
 * labels leave more width for the plot itself, in keeping with the
 * restrained/dense aesthetic.
 */
function compactNumber(value: number): string {
  return compactNumberFormatter.format(value)
}

interface SeriesChartProps {
  data: Record<string, unknown>[]
  config: ChartConfig
  xKey: string
  /** Data keys to plot, in the fixed categorical order they should color from (--chart-1 first). */
  seriesKeys: string[]
  className?: string
}

export function LineChart({ data, config, xKey, seriesKeys, className }: SeriesChartProps) {
  return (
    <ChartContainer config={config} className={className}>
      <RechartsLineChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} tickFormatter={compactNumber} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {seriesKeys.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {seriesKeys.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </RechartsLineChart>
    </ChartContainer>
  )
}

export function AreaChart({ data, config, xKey, seriesKeys, className }: SeriesChartProps) {
  return (
    <ChartContainer config={config} className={className}>
      <RechartsAreaChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
        <defs>
          {seriesKeys.map((key) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.35} />
              <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} tickFormatter={compactNumber} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {seriesKeys.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {seriesKeys.map((key) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            fill={`url(#fill-${key})`}
          />
        ))}
      </RechartsAreaChart>
    </ChartContainer>
  )
}

export function BarChart({ data, config, xKey, seriesKeys, className }: SeriesChartProps) {
  return (
    <ChartContainer config={config} className={className}>
      <RechartsBarChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} tickFormatter={compactNumber} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {seriesKeys.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {seriesKeys.map((key) => (
          <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={[4, 4, 0, 0]} maxBarSize={40} />
        ))}
      </RechartsBarChart>
    </ChartContainer>
  )
}

interface DonutChartProps {
  data: Record<string, unknown>[]
  config: ChartConfig
  dataKey: string
  nameKey: string
  className?: string
}

/**
 * Used sparingly per the dataviz skill's guidance — a handful of slices
 * with direct labels via the legend, not a substitute for a bar chart on
 * more than ~5 categories.
 *
 * `config` keys for a donut/pie MUST equal the actual values in the data's
 * `nameKey` field (unlike Bar/Line/Area, where config keys match the series
 * dataKey) AND must be valid CSS custom-idents — shadcn's ChartStyle embeds
 * them verbatim as `--color-${key}`, so a key containing a space silently
 * produces an invalid declaration and that slice renders unfilled. Use
 * kebab-case data values (e.g. "website-dev") and put the human-readable
 * text in `label` instead, which is what the legend/tooltip actually render.
 */
export function DonutChart({ data, config, dataKey, nameKey, className }: DonutChartProps) {
  const keys = Object.keys(config)
  return (
    <ChartContainer config={config} className={className}>
      <RechartsPieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey={nameKey} hideLabel />} />
        <Pie data={data} dataKey={dataKey} nameKey={nameKey} innerRadius={56} outerRadius={84} strokeWidth={2}>
          {data.map((entry, index) => (
            <Cell key={index} fill={`var(--color-${keys[index % keys.length]})`} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey={nameKey} />} />
      </RechartsPieChart>
    </ChartContainer>
  )
}

import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { Skeleton } from "./ui";

const PlotlyComponent = createPlotlyComponent(Plotly);

/** A server-built figure (same builder as the slide PNGs), restyled for the app. */
export function ServerFigure({ set, name, height = 340 }: { set: string; name: string; height?: number }) {
  const { data, error, loading } = useFetch(() => api.figure(set, name), [set, name]);
  if (loading) return <Skeleton className="w-full" />;
  if (error || !data) return <div className="py-10 text-center text-sm text-subtle">Chart not available for this result set.</div>;
  const layout = {
    ...data.layout,
    height,
    autosize: true,
    title: undefined,
    font: { ...(data.layout.font ?? {}), family: "IBM Plex Sans, Helvetica Neue, Arial, sans-serif", size: 13 },
    margin: { l: 8, r: 24, t: 36, b: 48 },
    legend: { ...(data.layout.legend ?? {}), orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom", font: { size: 12, color: "#525252" } },
  };
  return (
    <PlotlyComponent
      data={data.data}
      layout={layout}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%", height }}
      useResizeHandler
    />
  );
}

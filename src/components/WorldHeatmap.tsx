import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import * as d3 from "d3";
import "leaflet/dist/leaflet.css";

type CountryDatum = { name: string; value: number; detail: string };

const GEOJSON_URL =
  "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";

// CSV file lives in /public — edit it to update the heatmap.
// Expected columns: iso_a3,name,value,detail
const CSV_URL = "/heatmap-data.csv";

const WorldHeatmap = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const [hovered, setHovered] = useState<{
    name: string;
    value: number | null;
    detail: string | null;
    x: number;
    y: number;
  } | null>(null);

  const dataRef = useRef<Record<string, CountryDatum>>({});

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    const map = L.map(mapRef.current, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 6,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: false,
    });
    leafletRef.current = map;

    // Subtle dark base
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd" }
    ).addTo(map);

    const colorScale = d3
      .scaleSequential<string>()
      .domain([0, 100])
      .interpolator(d3.interpolateHsl("#bfdbfe", "#0a1f44"));

    const styleFor = (val: number | undefined) => ({
      fillColor: val !== undefined ? colorScale(val) : "hsl(220 15% 25%)",
      weight: 0.5,
      color: "hsl(0 0% 100% / 0.3)",
      fillOpacity: val !== undefined ? 0.85 : 0.25,
    });

    fetch(GEOJSON_URL)
      .then((r) => r.json())
      .then((geo) => {
        L.geoJSON(geo, {
          style: (feature) => {
            const id = feature?.properties?.ISO_A3 || feature?.id;
            return styleFor(COUNTRY_DATA[id]?.value);
          },
          onEachFeature: (feature, layer) => {
            const id = feature?.properties?.ISO_A3 || (feature?.id as string);
            const data = COUNTRY_DATA[id];
            const fallbackName = feature?.properties?.ADMIN || feature?.properties?.name || "Unknown";

            layer.on({
              mouseover: (e) => {
                const l = e.target as L.Path;
                l.setStyle({ weight: 2, color: "hsl(0 0% 100%)", fillOpacity: 1 });
                l.bringToFront();
              },
              mousemove: (e) => {
                const oe = (e as L.LeafletMouseEvent).originalEvent;
                setHovered({
                  name: data?.name ?? fallbackName,
                  value: data?.value ?? null,
                  detail: data?.detail ?? null,
                  x: oe.clientX,
                  y: oe.clientY,
                });
              },
              mouseout: (e) => {
                (e.target as L.Path).setStyle(styleFor(data?.value));
                setHovered(null);
              },
            });
          },
        }).addTo(map);
      });

    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-full">
      <div ref={mapRef} className="h-full w-full" style={{ background: "hsl(222 47% 8%)" }} />

      {/* Legend */}
      <div className="absolute bottom-6 left-6 z-[1000] rounded-lg bg-card/90 p-4 shadow-lg backdrop-blur">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-card-foreground">
          Index Value
        </div>
        <div
          className="h-3 w-48 rounded"
          style={{
            background: "linear-gradient(to right, #bfdbfe, #0a1f44)",
          }}
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>Low (0)</span>
          <span>High (100)</span>
        </div>
      </div>

      {/* Title */}
      <div className="absolute top-6 left-6 z-[1000] rounded-lg bg-card/90 p-4 shadow-lg backdrop-blur">
        <h1 className="text-lg font-bold text-card-foreground">Global Heatmap</h1>
        <p className="text-xs text-muted-foreground">Hover a country for details</p>
      </div>

      {/* Tooltip */}
      {hovered && (
        <div
          className="pointer-events-none fixed z-[1001] min-w-[180px] rounded-lg border border-border bg-popover p-3 shadow-xl"
          style={{
            left: hovered.x + 14,
            top: hovered.y + 14,
          }}
        >
          <div className="text-sm font-bold text-popover-foreground">{hovered.name}</div>
          {hovered.value !== null ? (
            <>
              <div className="mt-1 text-xs text-muted-foreground">{hovered.detail}</div>
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-sm"
                  style={{
                    background: d3
                      .scaleSequential<string>()
                      .domain([0, 100])
                      .interpolator(d3.interpolateHsl("#bfdbfe", "#0a1f44"))(hovered.value),
                  }}
                />
                <span className="text-sm font-semibold text-popover-foreground">
                  Value: {hovered.value}
                </span>
              </div>
            </>
          ) : (
            <div className="mt-1 text-xs text-muted-foreground">No data available</div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorldHeatmap;

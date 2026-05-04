import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import * as d3 from "d3";
import "leaflet/dist/leaflet.css";

// CSV columns (from upload):
// countries Of Organisation,Country of Origin,Count,Zero% Club,Articles/Negative,
// Journalist Name,Photo,Biases (per Kutniti),Owner Name (Highest Shareholder),Owner Photo,Organization
const CSV_URL = "/heatmap-data.csv";
const GEOJSON_URL =
  "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";

// Map free-text country labels in the CSV to ISO_A3 codes used by the GeoJSON.
const NAME_TO_ISO: Record<string, string> = {
  USA: "USA",
  "UNITED STATES": "USA",
  UK: "GBR",
  "UNITED KINGDOM": "GBR",
  BELGIUM: "BEL",
  NETHERLANDS: "NLD",
  GERMANY: "DEU",
  AUSTRALIA: "AUS",
  QATAR: "QAT",
  INDIA: "IND",
  FRANCE: "FRA",
  CANADA: "CAN",
  CHINA: "CHN",
  RUSSIA: "RUS",
  JAPAN: "JPN",
  SPAIN: "ESP",
  ITALY: "ITA",
  BRAZIL: "BRA",
  MEXICO: "MEX",
  ARGENTINA: "ARG",
  "SOUTH AFRICA": "ZAF",
  EGYPT: "EGY",
  NIGERIA: "NGA",
  KENYA: "KEN",
  "SAUDI ARABIA": "SAU",
};

const toIso = (raw: string): string[] => {
  if (!raw) return [];
  // handles "USA/UK" -> ["USA","GBR"]
  return raw
    .split(/[\/,&]/)
    .map((s) => s.trim().toUpperCase())
    .map((s) => NAME_TO_ISO[s])
    .filter(Boolean);
};

const parsePct = (s: string): number | null => {
  if (!s) return null;
  const m = s.match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : null;
};

type Journalist = {
  name: string;
  photo: string;
  organisation: string;
  orgCountryIsos: string[];
  originIsos: string[];
  biasPct: number | null;
  biasNote: string;
  owner: string;
};

const WorldHeatmap = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const layerByIso = useRef<Record<string, L.Path[]>>({});
  const baseStyleByIso = useRef<Record<string, L.PathOptions>>({});

  const [journalists, setJournalists] = useState<Journalist[]>([]);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  const [highlightIsos, setHighlightIsos] = useState<string[]>([]);

  // Aggregate per-country (avg bias %) for heatmap
  const countryStats = useMemo(() => {
    const acc: Record<string, { sum: number; n: number; name: string }> = {};
    journalists.forEach((j) => {
      if (j.biasPct == null) return;
      j.orgCountryIsos.forEach((iso) => {
        if (!acc[iso]) acc[iso] = { sum: 0, n: 0, name: iso };
        acc[iso].sum += j.biasPct!;
        acc[iso].n += 1;
      });
    });
    const out: Record<string, { value: number; count: number }> = {};
    Object.entries(acc).forEach(([iso, v]) => {
      out[iso] = { value: v.sum / v.n, count: v.n };
    });
    return out;
  }, [journalists]);

  const journalistsByIso = useMemo(() => {
    const m: Record<string, Journalist[]> = {};
    journalists.forEach((j) =>
      j.orgCountryIsos.forEach((iso) => {
        (m[iso] ||= []).push(j);
      }),
    );
    return m;
  }, [journalists]);

  // Load CSV
  useEffect(() => {
    d3.csv(CSV_URL).then((rows) => {
      const list: Journalist[] = rows.map((r: any) => ({
        name: (r["Journalist Name"] || "").trim(),
        photo: (r["Photo"] || "").trim(),
        organisation: (r["Organization"] || "").trim(),
        orgCountryIsos: toIso(r["countries Of Organisation"] || ""),
        originIsos: toIso(r["Country of Origin"] || ""),
        biasPct: parsePct(r["Articles/Negative"] || ""),
        biasNote: (r["Biases (per Kutniti)"] || "").trim(),
        owner: (r["Owner Name (Highest Shareholder)"] || "").trim(),
      }));
      setJournalists(list);
    });
  }, []);

  // Init map once
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;
    const map = L.map(mapRef.current, {
      center: [25, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 6,
      worldCopyJump: true,
      attributionControl: false,
    });
    leafletRef.current = map;
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd" },
    ).addTo(map);
    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, []);

  // Render GeoJSON layer when stats change
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    let geoLayer: L.GeoJSON | null = null;

    // Higher % negative = darker (more "bias")
    const colorScale = d3
      .scaleSequential<string>()
      .domain([60, 100])
      .interpolator(d3.interpolateHsl("#fde68a", "#7f1d1d"));

    const styleFor = (iso: string): L.PathOptions => {
      const stat = countryStats[iso];
      return {
        fillColor: stat ? colorScale(stat.value) : "hsl(220 15% 22%)",
        weight: 0.5,
        color: "hsl(0 0% 100% / 0.25)",
        fillOpacity: stat ? 0.85 : 0.2,
      };
    };

    fetch(GEOJSON_URL)
      .then((r) => r.json())
      .then((geo) => {
        layerByIso.current = {};
        baseStyleByIso.current = {};
        geoLayer = L.geoJSON(geo, {
          style: (feature) => {
            const p = feature?.properties || {};
            const iso = p["ISO3166-1-Alpha-3"] || p.ISO_A3 || p.iso_a3 || (feature?.id as string);
            const s = styleFor(iso);
            baseStyleByIso.current[iso] = s;
            return s;
          },
          onEachFeature: (feature, layer) => {
            const iso = feature?.properties?.ISO_A3 || (feature?.id as string);
            (layerByIso.current[iso] ||= []).push(layer as L.Path);
            const stat = countryStats[iso];
            const name =
              feature?.properties?.ADMIN ||
              feature?.properties?.name ||
              iso;

            (layer as L.Path).on({
              mouseover: () => {
                setHoverIso(iso);
                (layer as L.Path).setStyle({
                  weight: 2,
                  color: "hsl(0 0% 100%)",
                  fillOpacity: 1,
                });
                (layer as L.Path).bringToFront();
              },
              mouseout: () => {
                setHoverIso(null);
                if (!highlightIsos.includes(iso) && selectedIso !== iso) {
                  (layer as L.Path).setStyle(baseStyleByIso.current[iso]);
                }
              },
              click: () => {
                if (stat) setSelectedIso(iso);
              },
            });

            if (stat) {
              (layer as L.Path).bindTooltip(
                `<strong>${name}</strong><br/>Avg negative coverage: ${stat.value.toFixed(1)}%<br/>${stat.count} journalist${stat.count > 1 ? "s" : ""}`,
                { sticky: true, direction: "top", className: "leaflet-custom-tip" },
              );
            }
          },
        }).addTo(map);
      });

    return () => {
      if (geoLayer) geoLayer.remove();
    };
  }, [countryStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply origin-highlight styling
  useEffect(() => {
    Object.entries(layerByIso.current).forEach(([iso, layers]) => {
      const base = baseStyleByIso.current[iso];
      if (!base) return;
      const isHi = highlightIsos.includes(iso);
      layers.forEach((l) => {
        if (isHi) {
          l.setStyle({
            ...base,
            fillColor: "hsl(45 100% 60%)",
            color: "hsl(45 100% 70%)",
            weight: 2.5,
            fillOpacity: 0.95,
          });
          l.bringToFront();
        } else if (selectedIso !== iso && hoverIso !== iso) {
          l.setStyle(base);
        }
      });
    });
  }, [highlightIsos, selectedIso, hoverIso]);

  const selectedJournalists = selectedIso ? journalistsByIso[selectedIso] || [] : [];
  const selectedStat = selectedIso ? countryStats[selectedIso] : null;

  return (
    <div className="relative h-screen w-full">
      <div
        ref={mapRef}
        className="h-full w-full"
        style={{ background: "hsl(222 47% 8%)" }}
      />

      {/* Title */}
      <div className="absolute top-6 left-6 z-[1000] max-w-sm rounded-lg bg-card/90 p-4 shadow-lg backdrop-blur">
        <h1 className="text-lg font-bold text-card-foreground">
          Global Media Bias Heatmap
        </h1>
        <p className="text-xs text-muted-foreground">
          Color = avg % negative coverage by organisation country. Click a country
          to see journalists.
        </p>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-6 z-[1000] rounded-lg bg-card/90 p-4 shadow-lg backdrop-blur">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-card-foreground">
          % Negative Coverage
        </div>
        <div
          className="h-3 w-48 rounded"
          style={{ background: "linear-gradient(to right, #fde68a, #7f1d1d)" }}
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>60%</span>
          <span>100%</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: "hsl(45 100% 60%)" }}
          />
          Highlighted = journalist origin
        </div>
      </div>

      {/* Side panel */}
      {selectedIso && (
        <div className="absolute top-6 right-6 z-[1000] flex max-h-[calc(100vh-3rem)] w-96 flex-col rounded-lg bg-card/95 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between border-b border-border p-4">
            <div>
              <div className="text-sm font-semibold text-card-foreground">
                {selectedIso}
              </div>
              {selectedStat && (
                <div className="text-xs text-muted-foreground">
                  Avg {selectedStat.value.toFixed(1)}% negative ·{" "}
                  {selectedStat.count} journalist
                  {selectedStat.count > 1 ? "s" : ""}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedIso(null);
                setHighlightIsos([]);
              }}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {selectedJournalists.map((j, idx) => (
              <div
                key={idx}
                onMouseEnter={() => setHighlightIsos(j.originIsos)}
                onMouseLeave={() => setHighlightIsos([])}
                className="group mb-2 flex cursor-pointer gap-3 rounded-lg border border-transparent p-2 transition hover:border-border hover:bg-muted/50"
              >
                <img
                  src={
                    j.photo && j.photo !== "N/A"
                      ? j.photo
                      : "/placeholder.svg"
                  }
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/placeholder.svg";
                  }}
                  alt={j.name}
                  className="h-12 w-12 flex-shrink-0 rounded-full border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-card-foreground">
                    {j.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {j.organisation}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                    {j.biasPct != null && (
                      <span className="rounded bg-destructive/20 px-1.5 py-0.5 font-semibold text-destructive">
                        {j.biasPct}% neg
                      </span>
                    )}
                    {j.originIsos.map((iso) => (
                      <span
                        key={iso}
                        className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold text-amber-600 group-hover:bg-amber-500/40"
                      >
                        Origin: {iso}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] italic text-muted-foreground">
                    {j.biasNote}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorldHeatmap;

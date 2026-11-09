import type { SearchCriteria, SortKey } from "./types";

const SORTS: SortKey[] = ["price", "distance", "rating"];

/** Launch city shown when a page is reached with no city in the URL (e.g. the
 *  header's bare "Browse scooters" link). */
export const DEFAULT_CITY = "Dehradun";

/** Default window: Rishikesh demand is same-day, so today 10am -> today 10pm. */
export function defaultWindow(): { pickupAt: string; returnAt: string } {
  const pickup = new Date();
  pickup.setHours(10, 0, 0, 0);
  const ret = new Date();
  ret.setHours(22, 0, 0, 0);
  return { pickupAt: toIsoWithOffset(pickup), returnAt: toIsoWithOffset(ret) };
}

/** Always emit an explicit offset. A naked local datetime prices a different
 *  calendar day for anyone whose device clock is not on IST. */
export function toIsoWithOffset(d: Date): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseSearchParams(search: string): SearchCriteria {
  const p = new URLSearchParams(search);
  const win = defaultWindow();
  const sort = p.get("sort") as SortKey | null;

  return {
    city: p.get("city") ?? "",
    shopId: p.get("shopId") ?? undefined,
    pickupAt: p.get("pickupAt") ?? win.pickupAt,
    returnAt: p.get("returnAt") ?? win.returnAt,
    minPrice: num(p.get("minPrice")),
    maxPrice: num(p.get("maxPrice")),
    modelId: p.get("modelId") ?? undefined,
    make: p.get("make") ? p.get("make")!.split(",") : undefined,
    minRating: num(p.get("minRating")),
    maxDistanceKm: num(p.get("maxDistanceKm")),
    bodyType: p.get("bodyType") ? p.get("bodyType")!.split(",") : undefined,
    fuelType: p.get("fuelType")
      ? (p.get("fuelType")!.split(",") as ("PETROL" | "ELECTRIC")[])
      : undefined,
    minEngineCc: num(p.get("minEngineCc")),
    maxEngineCc: num(p.get("maxEngineCc")),
    seatingCapacity: num(p.get("seatingCapacity")),
    // Only ever written as "true" — "false" would be parsed as truthy upstream.
    fullyVerified: p.get("fullyVerified") === "true" ? true : undefined,
    sort: sort && SORTS.includes(sort) ? sort : "price",
    page: num(p.get("page")) ?? 1,
  };
}

export function toSearchParams(c: Partial<SearchCriteria>): string {
  const p = new URLSearchParams();
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || v === false) return;
    p.set(k, String(v));
  };
  put("city", c.city);
  put("shopId", c.shopId);
  put("pickupAt", c.pickupAt);
  put("returnAt", c.returnAt);
  put("minPrice", c.minPrice);
  put("maxPrice", c.maxPrice);
  put("modelId", c.modelId);
  put("make", c.make && c.make.length > 0 ? c.make.join(",") : undefined);
  put("minRating", c.minRating);
  put("maxDistanceKm", c.maxDistanceKm);
  put("bodyType", c.bodyType && c.bodyType.length > 0 ? c.bodyType.join(",") : undefined);
  put("fuelType", c.fuelType && c.fuelType.length > 0 ? c.fuelType.join(",") : undefined);
  put("minEngineCc", c.minEngineCc);
  put("maxEngineCc", c.maxEngineCc);
  put("seatingCapacity", c.seatingCapacity);
  put("fullyVerified", c.fullyVerified);
  if (c.sort && c.sort !== "price") p.set("sort", c.sort);
  if (c.page && c.page > 1) p.set("page", String(c.page));
  return p.toString();
}

/** "MOTORCYCLE" -> "Motorcycle". The values are free text server-side, so
 *  this formats whatever arrives rather than mapping a fixed list. */
export function bodyTypeLabel(bodyType: string): string {
  return bodyType.charAt(0) + bodyType.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Which filters are active, for the removable chip row. Each chip carries
 *  its own removal patch — needed for `make`/`fuelType` since removing one
 *  selected value must keep the others, not clear the whole filter. */
export function activeFilters(c: SearchCriteria): { key: string; label: string; clear: Partial<SearchCriteria> }[] {
  const out: { key: string; label: string; clear: Partial<SearchCriteria> }[] = [];
  for (const bt of c.bodyType ?? []) {
    out.push({
      key: `bodyType:${bt}`,
      label: bodyTypeLabel(bt),
      clear: { bodyType: c.bodyType!.filter((v) => v !== bt) },
    });
  }
  for (const ft of c.fuelType ?? []) {
    out.push({
      key: `fuelType:${ft}`,
      label: ft === "ELECTRIC" ? "Electric" : "Petrol",
      clear: { fuelType: c.fuelType!.filter((v) => v !== ft) },
    });
  }
  for (const m of c.make ?? []) {
    out.push({ key: `make:${m}`, label: m, clear: { make: c.make!.filter((v) => v !== m) } });
  }
  if (c.maxPrice)
    out.push({
      key: "maxPrice",
      label: `Under ₹${Math.round(c.maxPrice / 100).toLocaleString("en-IN")}`,
      clear: { maxPrice: undefined },
    });
  if (c.maxDistanceKm)
    out.push({ key: "maxDistanceKm", label: `Within ${c.maxDistanceKm} km`, clear: { maxDistanceKm: undefined } });
  if (c.minRating)
    out.push({ key: "minRating", label: `${c.minRating}★ and up`, clear: { minRating: undefined } });
  if (c.seatingCapacity)
    out.push({
      key: "seatingCapacity",
      label: `${c.seatingCapacity} seats`,
      clear: { seatingCapacity: undefined },
    });
  if (c.minEngineCc || c.maxEngineCc)
    out.push({
      key: "minEngineCc",
      label: `${c.minEngineCc ?? 0}–${c.maxEngineCc ?? "∞"} cc`,
      clear: { minEngineCc: undefined, maxEngineCc: undefined },
    });
  if (c.fullyVerified)
    out.push({ key: "fullyVerified", label: "Fully verified only", clear: { fullyVerified: undefined } });
  return out;
}

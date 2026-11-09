/** Mirrors apps/Backend/src/Routes/user/Search/searchService.ts exactly. */
export interface Licence {
  licenceNumber: string;
  issuingAuthority: string | null;
  validUntil: string | null;
}

export interface SearchOffer {
  vehicleId: string;
  shopId: string;
  shopName: string;
  shopPhone: string | null;
  shopAddress: string;
  shopLatitude: number | null;
  shopLongitude: number | null;
  /** paise — per-day rate for the first day of the window */
  pricePerDay: number;
  /** paise — the rental subtotal for the whole window */
  totalAmount: number;
  /** paise — refundable, held by the shop */
  securityDeposit: number;
  rating: number | null;
  reviewCount: number;
  distanceKm: number | null;
  licence: Licence | null;
}

export interface SearchModel {
  id: string;
  make: string;
  model: string;
  imageKey: string | null;
  fuelType: "PETROL" | "ELECTRIC" | null;
  engineCc: number | null;
  bodyType: string | null;
  seatingCapacity: number | null;
}

export interface SearchResult {
  model: SearchModel;
  primaryOffer: SearchOffer;
  /** number of offers that matched the active filters */
  offerCount: number;
  /** vehicleIds of every available unit of this model at this shop, ranked like primaryOffer */
  offerVehicleIds: string[];
}

export interface VehicleDetail {
  vehicleId: string;
  modelId: string;
  make: string;
  model: string;
  imageKey: string | null;
  fuelType: "PETROL" | "ELECTRIC" | null;
  engineCc: number | null;
  bodyType: string | null;
  seatingCapacity: number | null;
  shopId: string;
  shopName: string;
  shopPhone: string | null;
  shopAddress: string;
  shopLatitude: number | null;
  shopLongitude: number | null;
  rating: number | null;
  reviewCount: number;
  /** paise */
  amount: number;
  /** paise */
  weekendAmount: number;
  /** paise */
  securityDeposit: number;
  /** paise */
  lateFeeAmount: number;
  licence: Licence | null;
}

/** Mirrors apps/Backend/src/Routes/user/Shops/shopProfileService.ts exactly. */
export interface ShopHours {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface ShopLicence {
  licenceNumber: string;
  issuingAuthority: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
}

export interface ShopProfile {
  shopId: string;
  name: string;
  ownerName: string | null;
  phone: string | null;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  rating: number | null;
  reviewCount: number;
  memberSince: string;
  hours: ShopHours[];
  licences: ShopLicence[];
  bodyTypes: string[];
}

export type SortKey = "price" | "distance" | "rating";

export interface SearchCriteria {
  city: string;
  /** scopes results to one shop's inventory, ignoring city — used by the shop page */
  shopId?: string;
  pickupAt: string;
  returnAt: string;
  minPrice?: number;
  maxPrice?: number;
  modelId?: string;
  make?: string[];
  minRating?: number;
  maxDistanceKm?: number;
  /** `vehicle_models.body_type` values, e.g. SCOOTER / MOTORCYCLE — free text server-side, so not a union */
  bodyType?: string[];
  fuelType?: ("PETROL" | "ELECTRIC")[];
  minEngineCc?: number;
  maxEngineCc?: number;
  seatingCapacity?: number;
  fullyVerified?: boolean;
  sort: SortKey;
  page: number;
}

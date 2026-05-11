import type { RestaurantOrder } from "@/app/lib/domain/restaurant";

export const DEFAULT_ORGANIZATION_ID = "org-valsentra";
export const DEFAULT_ORGANIZATION_NAME = "Valsentra Restaurant Group";
export const DEFAULT_LOCATION_ID = "loc-primary";
export const DEFAULT_LOCATION_NAME = "Primary Location";

export type OrganizationContext = {
  organizationId: string;
  organizationName: string;
  locationId: string;
  locationName: string;
};

export function normalizeOrganizationId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : DEFAULT_ORGANIZATION_ID;
}

export function normalizeLocationId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : DEFAULT_LOCATION_ID;
}

export function normalizeLocationName(value: unknown, locationId?: string) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (locationId && locationId !== DEFAULT_LOCATION_ID) return locationId;
  return DEFAULT_LOCATION_NAME;
}

export function getOrderOrganizationContext(
  row: Record<string, any>
): OrganizationContext {
  const organizationId = normalizeOrganizationId(
    row.organization_id ?? row.organizationId
  );
  const locationId = normalizeLocationId(row.location_id ?? row.locationId);

  return {
    organizationId,
    organizationName:
      row.organization_name ?? row.organizationName ?? DEFAULT_ORGANIZATION_NAME,
    locationId,
    locationName: normalizeLocationName(
      row.location_name ?? row.locationName,
      locationId
    ),
  };
}

export function getOrderLocationKey(order: Pick<RestaurantOrder, "locationId">) {
  return normalizeLocationId(order.locationId);
}

export function getOrderOrganizationKey(
  order: Pick<RestaurantOrder, "organizationId">
) {
  return normalizeOrganizationId(order.organizationId);
}

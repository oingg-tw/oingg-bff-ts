import { AppError } from "@/shared/errorHandler.js";

export interface FieldRef {
  metricKey: string;
  fieldKey: string;
}

/** Parses a "<metricKey>.<fieldKey>" reference (the format filterCatalog fields are addressed by). */
export function parseFieldRef(field: string): FieldRef {
  const dotIndex = field.indexOf(".");
  if (dotIndex <= 0 || dotIndex === field.length - 1) {
    throw new AppError(`Invalid field reference "${field}", expected "<metricKey>.<fieldKey>"`, 400);
  }
  return { metricKey: field.slice(0, dotIndex), fieldKey: field.slice(dotIndex + 1) };
}

export function toFieldRefString(metricKey: string, fieldKey: string): string {
  return `${metricKey}.${fieldKey}`;
}

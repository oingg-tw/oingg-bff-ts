import { AppError } from "../../shared/errorHandler.js";
import { parseFieldRef, toFieldRefString } from "../../shared/fieldRef.js";
import { findFilterField } from "../filterCatalog/index.js";
import { listColumnPreferences, replaceColumnPreferences } from "./screenerColumns.repository.js";

export interface ScreenerColumnPreferenceView {
  field: string;
  metricName: string;
  fieldName: string;
}

export async function getColumnPreferences(firebaseUid: string): Promise<ScreenerColumnPreferenceView[]> {
  const rows = await listColumnPreferences(firebaseUid);

  return Promise.all(
    rows.map(async (row) => {
      const lookup = await findFilterField(row.metricKey, row.fieldKey);
      return {
        field: toFieldRefString(row.metricKey, row.fieldKey),
        metricName: lookup?.metricName ?? row.metricKey,
        fieldName: lookup?.fieldName ?? row.fieldKey,
      };
    }),
  );
}

/** Validates every field exists in the filter catalog, then replaces the user's whole column set (order preserved). */
export async function setColumnPreferences(firebaseUid: string, fields: string[]): Promise<void> {
  const uniqueFields = [...new Set(fields)];
  const parsed = uniqueFields.map((field) => ({ field, ...parseFieldRef(field) }));

  for (const { field, metricKey, fieldKey } of parsed) {
    const lookup = await findFilterField(metricKey, fieldKey);
    if (!lookup) {
      throw new AppError(`Unknown field "${field}"`, 400);
    }
  }

  await replaceColumnPreferences(
    firebaseUid,
    parsed.map(({ metricKey, fieldKey }) => ({ metricKey, fieldKey })),
  );
}

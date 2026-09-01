export interface Company {
  companyId: string;
  /** Null when analysis-ts has no short name on file for this company. */
  companyName: string | null;
}

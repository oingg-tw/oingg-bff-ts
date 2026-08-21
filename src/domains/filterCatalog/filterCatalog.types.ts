export interface FilterField {
  key: string;
  name: string;
  period: string;
}

export interface FilterMetric {
  key: string;
  name: string;
  path: string;
  fields: FilterField[];
}

export interface FilterCategory {
  key: string;
  name: string;
  metrics: FilterMetric[];
}

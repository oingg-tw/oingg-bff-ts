export interface Holding {
  id: string;
  symbol: string;
  quantity: number;
  averageCost: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

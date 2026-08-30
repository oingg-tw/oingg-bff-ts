export interface Holding {
  id: number;
  symbol: string;
  quantity: number;
  averageCost: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TipBreakdownPayload = {
  store_number: string | null;
  total_payins: number;
  total_tips: number;
};

export type TipBreakdownSection = {
  store_number: string | null;
  store_label: string | null;
  date_range: string | null;
  payload: TipBreakdownPayload[];
};

export type TipBreakdownParseResult = {
  sections: TipBreakdownSection[];
  payload: TipBreakdownPayload[];
  warnings: string[];
};

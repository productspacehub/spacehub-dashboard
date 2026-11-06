import { CASHIN_CATEGORY_COLORS } from "@/components/CashinDailyChart";
import type { RevenueCategory } from "@/lib/revenueAccrual";

// Same validated palette as Cash-in: rent takes New Rent's slot.
export const REVENUE_COLORS: Record<RevenueCategory, string> = {
  rent: CASHIN_CATEGORY_COLORS.newRent,
  lateFee: CASHIN_CATEGORY_COLORS.lateFee,
  item: CASHIN_CATEGORY_COLORS.item,
  unclassified: CASHIN_CATEGORY_COLORS.unclassified,
};

export const REVENUE_LABELS: Record<RevenueCategory, string> = {
  rent: "Sewa",
  lateFee: "Late fee",
  item: "Barang",
  unclassified: "Tidak terklasifikasi",
};

export const REVENUE_ORDER: RevenueCategory[] = ["rent", "lateFee", "item", "unclassified"];

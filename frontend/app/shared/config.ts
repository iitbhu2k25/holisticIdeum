import tunnel from "@/tunnel.json";

// Browser-visible service URLs. Set NEXT_PUBLIC_* in .env.local for other deployments.
// Falls back to active Cloudflare tunnel URL if present in tunnel.json.
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || tunnel.API_URL || "http://localhost:9000";
export const GEOSERVER_URL =
  process.env.NEXT_PUBLIC_GEOSERVER_URL ||
  (tunnel.GEOSERVER_URL ? `${tunnel.GEOSERVER_URL}/geoserver` : "http://localhost:9090/geoserver");

// Workspace the backend publishes uploaded datasets into (backend/app/api/service/datasets/geoserver_publish.py)
export const UPLOADS_WORKSPACE = "dss_uploads";

export const DATASET_CATEGORIES = [
  { key: "aviral", label: "Aviral Ganga", stageIndex: 0, color: "#0284c7" },
  { key: "nirmal", label: "Nirmal Ganga", stageIndex: 1, color: "#0d9488" },
  { key: "jan", label: "Jan Ganga", stageIndex: 2, color: "#7c3aed" },
  { key: "arth", label: "Arth Ganga", stageIndex: 3, color: "#d97706" },
  { key: "gyan", label: "Gyan Ganga", stageIndex: 4, color: "#4f46e5" },
  { key: "jeevant", label: "Jeevant Ganga", stageIndex: 5, color: "#16a34a" },
] as const;

export type DatasetCategory = (typeof DATASET_CATEGORIES)[number]["key"];

export const categoryForStage = (stageIndex: number) =>
  DATASET_CATEGORIES.find((c) => c.stageIndex === stageIndex) ?? DATASET_CATEGORIES[0];

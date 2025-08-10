export interface IR {
  app_type: "spa_api" | "crud_d1" | "webhook";
  name: string;
  features?: string[];
  api_routes: Array<{ path: string; method: "GET" | "POST" | "PUT" | "DELETE" }>;
  pages: string[];
  bindings?: {
    D1?: Array<{ name: string; database?: string }>;
    KV?: Array<{ name: string }>;
  };
}
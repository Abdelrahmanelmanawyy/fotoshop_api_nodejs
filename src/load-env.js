import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Must load before any module reads process.env (ESM imports are hoisted).
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"),
  override: true,
});

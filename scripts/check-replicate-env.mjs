import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const raw = fs.readFileSync(envPath, "utf8");

const before = process.env.REPLICATE_API_TOKEN;
dotenv.config({ path: envPath, override: true });
const fileToken = raw.match(/REPLICATE_API_TOKEN=(.+)/)?.[1]?.trim();
if (before && fileToken && before !== fileToken) {
  console.log("WARNING: Windows had a different REPLICATE_API_TOKEN than .env (fixed with override:true)");
}

const replicateLines = raw.split(/\r?\n/).filter((l) => l.includes("REPLICATE"));

console.log("env_file:", envPath);
console.log("env_exists:", fs.existsSync(envPath));
console.log("replicate_lines_count:", replicateLines.length);

for (const line of replicateLines) {
  const eq = line.indexOf("=");
  const key = line.slice(0, eq).trim();
  const val = line.slice(eq + 1);
  console.log("key:", key);
  console.log("raw_value_length:", val.length);
  console.log("trimmed_length:", val.trim().length);
  console.log("has_space_after_r8:", /r8_\s/.test(val));
  console.log("wrapped_in_quotes:", /^["'].*["']$/.test(val.trim()));
  console.log("has_leading_trailing_space:", val !== val.trim());
}

const token = process.env.REPLICATE_API_TOKEN ?? "";
console.log("dotenv_token_length:", token.length);
console.log("dotenv_has_space_after_r8:", /r8_\s/.test(token));
console.log("dotenv_starts_r8:", token.startsWith("r8_"));

const res = await fetch("https://api.replicate.com/v1/account", {
  headers: { Authorization: `Bearer ${token}` },
});
console.log("replicate_http_status:", res.status);
if (!res.ok) {
  const body = await res.text();
  console.log("replicate_error:", body.slice(0, 200));
}

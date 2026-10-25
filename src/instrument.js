// Must be the FIRST import of src/index.js so error reporting is active before
// anything else loads. load-env.js runs here too because SENTRY_DSN lives in .env.
import "./load-env.js";
import { initErrorReporting } from "./core/errorReporting.js";

initErrorReporting();

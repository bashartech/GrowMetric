import { startWorker } from "./index.js";

void startWorker().catch((error) => {
  console.error("Worker exited with an error.", error);
  process.exit(1);
});
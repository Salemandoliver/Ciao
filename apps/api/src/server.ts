import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startWorkerLoop, startPayoutSweep } from "./worker-loop.js";
import { bootstrapBizCredential } from "./db/biz-bootstrap.js";

const app = await buildApp();

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Ciao API listening on :${config.port}`);
  // First-console-credential bootstrap: no-op unless BIZ_BOOTSTRAP_* are set.
  await bootstrapBizCredential(app.log);
  // Railway single-service mode: run the timer worker in-process unless a
  // dedicated worker service is deployed (WORKER_MODE=external).
  if (process.env.WORKER_MODE !== "external") {
    startWorkerLoop(app.log);
    startPayoutSweep(app.log);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

/** Dedicated worker entry (Railway second service, WORKER_MODE=external on API). */
import pino from "pino";
import { startWorkerLoop, startPayoutSweep } from "./worker-loop.js";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
log.info("Ciao worker starting");
startWorkerLoop(log);
startPayoutSweep(log);

// Keep process alive.
setInterval(() => {}, 1 << 30);
